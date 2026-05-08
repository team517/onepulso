import { NextRequest, NextResponse } from "next/server";
import { getStripe, getOrCreateCustomer, isStripeConfigured, STRIPE_OWNER_EMAIL } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/portal
 * Crea una sesión del Customer Portal de Stripe
 * para que el usuario gestione método de pago, cancele, vea facturas, etc.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  try {
    const stripe = getStripe();
    const customer = await getOrCreateCustomer(STRIPE_OWNER_EMAIL);

    const origin = req.headers.get("origin") || `https://${req.headers.get("host")}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${origin}/facturacion`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
