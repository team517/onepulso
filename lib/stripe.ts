import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY no está configurada en las variables de entorno");
  }
  _stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
  return _stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Recupera (o crea) el customer asociado al email del usuario */
export async function getOrCreateCustomer(email: string, name?: string): Promise<Stripe.Customer> {
  const stripe = getStripe();

  // Buscar primero
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];

  return await stripe.customers.create({
    email,
    name: name || email,
    metadata: { source: "onepulso-platform" },
  });
}

/** Devuelve la suscripción activa del customer (si la hay) */
export async function getActiveSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 5,
    expand: ["data.default_payment_method"],
  });

  // Priorizar active > trialing > past_due
  const order = ["active", "trialing", "past_due", "incomplete"];
  for (const status of order) {
    const sub = subs.data.find(s => s.status === status);
    if (sub) return sub;
  }
  return subs.data[0] ?? null;
}

/** Lista las facturas recientes del customer */
export async function getInvoices(customerId: string, limit = 10): Promise<Stripe.Invoice[]> {
  const stripe = getStripe();
  const list = await stripe.invoices.list({ customer: customerId, limit });
  return list.data;
}

export const STRIPE_OWNER_EMAIL = process.env.STRIPE_OWNER_EMAIL || "team@onepulso.online";
