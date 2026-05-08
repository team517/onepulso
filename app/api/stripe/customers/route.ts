import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/** GET /api/stripe/customers?q=texto — lista (busca por email/name si hay q) */
export async function GET(req: NextRequest) {
  if (!isStripeConfigured()) return NextResponse.json({ customers: [] });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  try {
    const stripe = getStripe();

    // Si hay query, usamos search; si no, list
    let data: any[];
    if (q) {
      const r = await stripe.customers.search({
        query: `email:'${q.replace(/'/g, "")}*' OR name:'${q.replace(/'/g, "")}*'`,
        limit: 20,
      });
      data = r.data;
    } else {
      const r = await stripe.customers.list({ limit: 50 });
      data = r.data;
    }

    return NextResponse.json({
      customers: data.map(c => ({
        id: c.id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        address: c.address,
        metadata: c.metadata,
        tax_ids_count: c.tax_ids?.total_count ?? 0,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, customers: [] }, { status: 500 });
  }
}

/** POST /api/stripe/customers — crea un cliente nuevo */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const stripe = getStripe();

    const customer = await stripe.customers.create({
      email: body.email,
      name: body.name,
      phone: body.phone || undefined,
      address: body.address ? {
        line1: body.address.line1 || undefined,
        line2: body.address.line2 || undefined,
        city: body.address.city || undefined,
        postal_code: body.address.postal_code || undefined,
        state: body.address.state || undefined,
        country: body.address.country || "ES",
      } : undefined,
      metadata: {
        source: "onepulso-platform",
        tax_id: body.tax_id || "",
      },
    });

    // Si tienen NIF/CIF/VAT, crear tax id
    if (body.tax_id) {
      try {
        await stripe.customers.createTaxId(customer.id, {
          type: body.tax_type || "eu_vat",
          value: body.tax_id,
        });
      } catch (e) {
        console.warn("[stripe] tax_id inválido o ya existente:", e);
      }
    }

    return NextResponse.json({
      id: customer.id,
      email: customer.email,
      name: customer.name,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
