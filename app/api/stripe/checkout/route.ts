import { NextRequest, NextResponse } from "next/server";
import { getStripe, getOrCreateCustomer, isStripeConfigured, STRIPE_OWNER_EMAIL } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/checkout
 * Body: { priceId: string }
 * Returns: { url: string }
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const priceId: string = body.priceId || process.env.STRIPE_DEFAULT_PRICE_ID || "";

    if (!priceId) {
      return NextResponse.json(
        { error: "Falta priceId. Configura STRIPE_DEFAULT_PRICE_ID o pásalo en el body." },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const customer = await getOrCreateCustomer(STRIPE_OWNER_EMAIL);

    const origin = req.headers.get("origin") || `https://${req.headers.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/facturacion?status=success`,
      cancel_url: `${origin}/facturacion?status=cancel`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
