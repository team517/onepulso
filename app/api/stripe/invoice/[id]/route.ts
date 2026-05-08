import { NextRequest, NextResponse } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * DELETE /api/stripe/invoice/:id
 * - draft → delete (borrado real)
 * - open  → void (anular)
 * - paid  → no se puede borrar (Stripe no lo permite); se puede emitir nota de crédito
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe no configurado" }, { status: 500 });
  }
  const { id } = await ctx.params;

  try {
    const stripe = getStripe();
    const inv = await stripe.invoices.retrieve(id);

    if (inv.status === "draft") {
      await stripe.invoices.del(id);
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    if (inv.status === "open" || inv.status === "uncollectible") {
      const voided = await stripe.invoices.voidInvoice(id);
      return NextResponse.json({ ok: true, action: "voided", status: voided.status });
    }

    if (inv.status === "paid") {
      return NextResponse.json(
        { error: "No se puede eliminar una factura ya pagada. Crea una nota de crédito desde Stripe si necesitas reembolsar." },
        { status: 400 }
      );
    }

    if (inv.status === "void") {
      return NextResponse.json({ ok: true, action: "already_void" });
    }

    return NextResponse.json({ error: `Estado no soportado: ${inv.status}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
