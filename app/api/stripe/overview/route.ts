import { NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * GET /api/stripe/overview?range=30d
 * Devuelve:
 *  - balance (available + pending)
 *  - métricas: cobrado pagadas, por cobrar abiertas
 *  - serie temporal de ingresos cobrados (charges)
 *  - lista de facturas
 */
export async function GET(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const url = new URL(req.url);
  const range = url.searchParams.get("range") || "30d";
  const days =
    range === "7d"  ? 7  :
    range === "3m"  ? 90 :
    range === "1y"  ? 365 :
    30;

  try {
    const stripe = getStripe();
    const since = Math.floor(Date.now() / 1000) - days * 86400;

    const [balance, invoices, charges] = await Promise.all([
      stripe.balance.retrieve(),
      stripe.invoices.list({ limit: 100 }),
      stripe.charges.list({ limit: 100, created: { gte: since } }),
    ]);

    const currency = (balance.available[0]?.currency ?? "eur").toLowerCase();

    const available = balance.available.find(b => b.currency === currency)?.amount ?? 0;
    const pending   = balance.pending.find(b => b.currency === currency)?.amount ?? 0;

    // Cobrado = facturas pagadas
    const paid = invoices.data
      .filter(i => i.status === "paid")
      .reduce((s, i) => s + (i.amount_paid || 0), 0);

    // Por cobrar = facturas abiertas (open)
    const openInvoices = invoices.data.filter(i => i.status === "open");
    const dueAmount = openInvoices.reduce((s, i) => s + (i.amount_due || 0), 0);

    // Serie temporal: agrupar charges por día
    const byDay: Record<string, number> = {};
    for (const ch of charges.data) {
      if (ch.status !== "succeeded") continue;
      if (ch.refunded) continue;
      const d = new Date(ch.created * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      byDay[key] = (byDay[key] ?? 0) + (ch.amount - (ch.amount_refunded ?? 0));
    }

    // Generar lista cronológica
    const series: { date: string; amount: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      series.push({ date: key, amount: byDay[key] ?? 0 });
    }

    const seriesTotal = series.reduce((s, p) => s + p.amount, 0);

    // Facturas para tabla
    const invoiceRows = invoices.data.slice(0, 50).map(i => ({
      id: i.id,
      number: i.number,
      customer_name: (i as any).customer_name,
      customer_email: (i as any).customer_email,
      amount: i.amount_due || i.amount_paid || 0,
      currency: i.currency,
      status: i.status,
      created: i.created,
      due_date: i.due_date,
      hosted_invoice_url: i.hosted_invoice_url,
      invoice_pdf: i.invoice_pdf,
    }));

    return NextResponse.json({
      configured: true,
      currency,
      metrics: {
        available,
        pending,
        paid,
        paid_count: invoices.data.filter(i => i.status === "paid").length,
        due: dueAmount,
        due_count: openInvoices.length,
      },
      series,
      seriesTotal,
      range,
      invoices: invoiceRows,
    });
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: e.message }, { status: 500 });
  }
}
