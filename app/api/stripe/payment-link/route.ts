import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/payment-link
 * Body: { amount: number (en céntimos), description: string, currency?: string }
 * Crea un Payment Link de Stripe que puedes compartir.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amount: number = Math.round(Number(body.amount));
    const currency: string = (body.currency || "eur").toLowerCase();
    const description: string = (body.description || "Pago").slice(0, 250);

    if (!amount || amount < 50) {
      return NextResponse.json(
        { error: "El importe debe ser al menos 0.50" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // 1) Crear un product on-the-fly
    const product = await stripe.products.create({
      name: description,
      metadata: { source: "onepulso-platform", type: "payment-link" },
    });

    // 2) Crear el price asociado
    const price = await stripe.prices.create({
      product: product.id,
      currency,
      unit_amount: amount,
    });

    // 3) Crear el payment link
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      after_completion: { type: "hosted_confirmation" },
    });

    return NextResponse.json({
      id: link.id,
      url: link.url,
      amount,
      currency,
      description,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET — lista de payment links existentes */
export async function GET() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ links: [] });
  }
  try {
    const stripe = getStripe();
    const links = await stripe.paymentLinks.list({ limit: 20, active: true });

    // Para cada link, intentar obtener el price/product para mostrar info
    const enriched = await Promise.all(
      links.data.map(async (l) => {
        try {
          const lineItems = await stripe.paymentLinks.listLineItems(l.id, { limit: 1 });
          const item = lineItems.data[0];
          return {
            id: l.id,
            url: l.url,
            active: l.active,
            description: item?.description || "Payment Link",
            amount: item?.amount_total || 0,
            currency: item?.currency || "eur",
          };
        } catch {
          return {
            id: l.id,
            url: l.url,
            active: l.active,
            description: "Payment Link",
            amount: 0,
            currency: "eur",
          };
        }
      })
    );

    return NextResponse.json({ links: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, links: [] }, { status: 500 });
  }
}
