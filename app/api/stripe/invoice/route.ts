import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/invoice
 * Body: {
 *   customer_id?: string,                   // si ya existe
 *   new_customer?: { name,email,phone,address,tax_id,tax_type }, // si hay que crearlo
 *   items: [{ description, amount, quantity? }],
 *   currency?: string,
 *   description?: string,                   // memo
 *   footer?: string,
 *   days_until_due?: number,                // 30 por defecto
 *   send_email?: boolean,                   // enviarla por email auto
 *   create_payment_link?: boolean,          // genera además un link de pago
 *   collection_method?: "send_invoice" | "charge_automatically",
 * }
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const stripe = getStripe();

    // 1) Resolver customer
    let customerId: string = body.customer_id;
    if (!customerId && body.new_customer) {
      const c = await stripe.customers.create({
        email: body.new_customer.email,
        name: body.new_customer.name,
        phone: body.new_customer.phone || undefined,
        address: body.new_customer.address ? {
          line1: body.new_customer.address.line1 || undefined,
          line2: body.new_customer.address.line2 || undefined,
          city: body.new_customer.address.city || undefined,
          postal_code: body.new_customer.address.postal_code || undefined,
          state: body.new_customer.address.state || undefined,
          country: body.new_customer.address.country || "ES",
        } : undefined,
        metadata: { source: "onepulso-platform" },
      });
      customerId = c.id;

      if (body.new_customer.tax_id) {
        try {
          await stripe.customers.createTaxId(customerId, {
            type: body.new_customer.tax_type || "eu_vat",
            value: body.new_customer.tax_id,
          });
        } catch (e) { /* ignore */ }
      }
    }

    if (!customerId) {
      return NextResponse.json({ error: "Falta cliente (customer_id o new_customer)" }, { status: 400 });
    }

    const items: { description: string; amount: number; quantity?: number }[] = body.items || [];
    if (items.length === 0) {
      return NextResponse.json({ error: "Añade al menos una línea" }, { status: 400 });
    }

    const currency = (body.currency || "eur").toLowerCase();
    const collectionMethod = body.collection_method || "send_invoice";
    const daysUntilDue = body.days_until_due ?? 30;

    // 2) Crear factura primero (en draft)
    const invoiceCreate: any = {
      customer: customerId,
      collection_method: collectionMethod,
      currency,
      description: body.description || undefined,
      footer: body.footer || undefined,
      pending_invoice_items_behavior: "exclude",
      auto_advance: false,
    };
    if (collectionMethod === "send_invoice") {
      invoiceCreate.days_until_due = daysUntilDue;
    }
    const invoice = await stripe.invoices.create(invoiceCreate);

    // 3) Añadir líneas atadas a la factura
    for (const it of items) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        currency,
        unit_amount: Math.round(Number(it.amount)),
        quantity: Math.max(1, Math.round(Number(it.quantity ?? 1))),
        description: it.description,
      });
    }

    // 4) Finalizar (genera PDF + hosted_invoice_url)
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    // 5) Enviar por email si se pide
    if (body.send_email && collectionMethod === "send_invoice") {
      try {
        await stripe.invoices.sendInvoice(invoice.id);
      } catch (e) {
        console.warn("[stripe] sendInvoice falló:", e);
      }
    }

    // 6) Payment link adicional si se pide (opcional)
    let paymentLinkUrl: string | null = null;
    if (body.create_payment_link) {
      try {
        const totalAmount = items.reduce((s, it) => s + Math.round(Number(it.amount)) * (it.quantity ?? 1), 0);
        const product = await stripe.products.create({
          name: body.description || "Pago factura",
          metadata: { invoice_id: invoice.id },
        });
        const price = await stripe.prices.create({
          product: product.id,
          currency,
          unit_amount: totalAmount,
        });
        const link = await stripe.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }],
        });
        paymentLinkUrl = link.url;
      } catch (e) {
        console.warn("[stripe] payment-link falló:", e);
      }
    }

    return NextResponse.json({
      invoice_id: finalized.id,
      number: finalized.number,
      hosted_invoice_url: finalized.hosted_invoice_url,
      invoice_pdf: finalized.invoice_pdf,
      status: finalized.status,
      payment_link_url: paymentLinkUrl,
      sent: !!body.send_email,
    });
  } catch (e: any) {
    console.error("[stripe-invoice] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
