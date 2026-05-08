import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 * Endpoint para eventos de Stripe.
 * Configura el endpoint en Stripe Dashboard → Developers → Webhooks
 * URL: https://tu-dominio.com/api/stripe/webhook
 * Eventos recomendados:
 *   - checkout.session.completed
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid
 *   - invoice.payment_failed
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Falta firma o webhook secret" }, { status: 400 });
  }

  const body = await req.text();
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (e: any) {
    console.error("[stripe-webhook] verify failed:", e.message);
    return NextResponse.json({ error: `Webhook signature failed: ${e.message}` }, { status: 400 });
  }

  console.log(`[stripe-webhook] event: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed":
      console.log("[stripe-webhook] suscripción creada:", (event.data.object as any).customer);
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      console.log("[stripe-webhook] sub actualizada:", (event.data.object as any).id);
      break;
    case "invoice.paid":
      console.log("[stripe-webhook] factura pagada:", (event.data.object as any).id);
      break;
    case "invoice.payment_failed":
      console.warn("[stripe-webhook] pago fallido:", (event.data.object as any).id);
      break;
  }

  return NextResponse.json({ received: true });
}
