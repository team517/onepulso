import { NextResponse } from "next/server";
import {
  getStripe,
  getOrCreateCustomer,
  getActiveSubscription,
  getInvoices,
  isStripeConfigured,
  STRIPE_OWNER_EMAIL,
} from "@/lib/stripe";

export const runtime = "nodejs";

export async function GET() {
  if (!isStripeConfigured()) {
    return NextResponse.json({
      configured: false,
      connected: false,
      message: "STRIPE_SECRET_KEY no está configurada",
    });
  }

  try {
    const customer = await getOrCreateCustomer(STRIPE_OWNER_EMAIL);
    const sub = await getActiveSubscription(customer.id);
    const invoices = await getInvoices(customer.id, 10);

    return NextResponse.json({
      configured: true,
      connected: true,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
      },
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            current_period_end: (sub as any).current_period_end,
            cancel_at_period_end: sub.cancel_at_period_end,
            plan_name: sub.items.data[0]?.price?.nickname || sub.items.data[0]?.price?.id,
            amount: sub.items.data[0]?.price?.unit_amount,
            currency: sub.items.data[0]?.price?.currency,
            interval: sub.items.data[0]?.price?.recurring?.interval,
          }
        : null,
      invoices: invoices.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { configured: true, connected: false, error: e.message },
      { status: 500 }
    );
  }
}
