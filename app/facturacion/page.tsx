"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Invoice = {
  id: string;
  number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  amount: number;
  currency: string;
  status: string;
  created: number;
  due_date: number | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

type PaymentLink = {
  id: string;
  url: string;
  active: boolean;
  description: string;
  amount: number;
  currency: string;
};

type Customer = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  address: any;
  metadata: any;
  tax_ids_count: number;
};

type Overview = {
  configured: boolean;
  currency: string;
  metrics: {
    available: number;
    pending: number;
    paid: number;
    paid_count: number;
    due: number;
    due_count: number;
  };
  series: { date: string; amount: number }[];
  seriesTotal: number;
  range: string;
  invoices: Invoice[];
  error?: string;
};

const RANGES = [
  { id: "7d",  label: "7 días"   },
  { id: "30d", label: "30 días"  },
  { id: "3m",  label: "3 meses"  },
  { id: "1y",  label: "1 año"    },
];

const STATUS_FILTERS = [
  { id: "all",   label: "Todas"     },
  { id: "paid",  label: "Pagadas"   },
  { id: "open",  label: "Pendientes" },
  { id: "uncollectible", label: "No pagadas" },
  { id: "void",  label: "Anuladas"  },
];

export default function FacturacionPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<string>("30d");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [stripeConnected, setStripeConnected] = useState(true);

  useEffect(() => { load(range); /* eslint-disable-next-line */ }, [range]);
  useEffect(() => { loadLinks(); }, []);

  async function load(r: string) {
    setLoading(true);
    try {
      const j = await fetch(`/api/stripe/overview?range=${r}`).then(x => x.json());
      setStripeConnected(!!j.configured);
      setData(j);
    } finally { setLoading(false); }
  }

  async function loadLinks() {
    try {
      const j = await fetch("/api/stripe/payment-link").then(x => x.json());
      setLinks(j.links ?? []);
    } catch {}
  }

  async function deleteInvoice(inv: Invoice) {
    const action =
      inv.status === "draft" ? "eliminar"
      : inv.status === "paid" ? null
      : "anular";

    if (!action) {
      alert("No se puede eliminar una factura pagada. Si necesitas reembolsar, hazlo desde Stripe (nota de crédito).");
      return;
    }

    const ok = confirm(
      `¿Seguro que quieres ${action} la factura ${inv.number || inv.id.slice(0, 12)}?\n\nImporte: ${(inv.amount / 100).toFixed(2)} €`
    );
    if (!ok) return;

    try {
      const r = await fetch(`/api/stripe/invoice/${inv.id}`, { method: "DELETE" });
      const j = await r.json();
      if (j.error) {
        alert(j.error);
        return;
      }
      await load(range);
    } catch (e: any) {
      alert(e.message);
    }
  }

  function fmtMoney(amount: number, currency: string = "eur") {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format((amount ?? 0) / 100);
  }

  function fmtDate(ts: number | null) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString("es-ES", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  const invoicesFiltered = useMemo(() => {
    if (!data?.invoices) return [];
    // "Todas" excluye las anuladas — solo aparecen cuando se filtra explícitamente
    if (statusFilter === "all") return data.invoices.filter(i => i.status !== "void");
    return data.invoices.filter(i => i.status === statusFilter);
  }, [data, statusFilter]);

  const voidCount = useMemo(
    () => data?.invoices?.filter(i => i.status === "void").length ?? 0,
    [data]
  );

  if (!stripeConnected && !loading) return <NotConfigured />;

  return (
    <div className="dash-shell">
      <DashboardNav />

      <div className="dash-content">
        <div className="dash-page-header">
          <div>
            <div className="dash-page-title">Facturación</div>
            <div className="dash-page-subtitle">
              <span style={{ fontWeight: 500 }}>stripe</span> · {data?.invoices?.length ?? 0} facturas
            </div>
          </div>
          <div className="dash-page-actions">
            <a
              href="https://dashboard.stripe.com/settings/branding"
              target="_blank" rel="noreferrer"
              style={btnSecondary}
            >
              🎨 Logo y branding
            </a>
            <button onClick={() => load(range)} style={btnSecondary}>↻ Actualizar</button>
            <button onClick={() => setShowInvoiceModal(true)} style={btnPrimary}>
              + Nueva factura
            </button>
          </div>
        </div>

        <div className="dash-home" style={{ paddingTop: 22 }}>
          {/* Stats */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14, marginBottom: 18,
          }}>
            <MetricCard label="Disponible en Stripe" value={fmtMoney(data?.metrics?.available ?? 0, data?.currency)} subtitle="Saldo liquidado" color="#0f172a" />
            <MetricCard label="En tránsito" value={fmtMoney(data?.metrics?.pending ?? 0, data?.currency)} subtitle="Pendiente de liquidar" color="#0071e3" />
            <MetricCard label="Cobrado" value={fmtMoney(data?.metrics?.paid ?? 0, data?.currency)} subtitle={`${data?.metrics?.paid_count ?? 0} pagadas`} color="#10b981" />
            <MetricCard label="Por cobrar" value={fmtMoney(data?.metrics?.due ?? 0, data?.currency)} subtitle={`${data?.metrics?.due_count ?? 0} abiertas`} color="#f59e0b" />
          </div>

          {/* Chart */}
          <div style={{
            background: "#fff", border: "1px solid var(--border)",
            borderRadius: 18, padding: "20px 22px",
            marginBottom: 18, boxShadow: "var(--shadow-sm)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
                  Ingresos cobrados
                </div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
                  {fmtMoney(data?.seriesTotal ?? 0, data?.currency)} en {RANGES.find(r => r.id === range)?.label.toLowerCase()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, background: "var(--bg-elev-3)", padding: 3, borderRadius: 9 }}>
                {RANGES.map(r => (
                  <button key={r.id} onClick={() => setRange(r.id)}
                    style={{
                      padding: "5px 12px", borderRadius: 7, border: "none",
                      background: range === r.id ? "#fff" : "transparent",
                      color: range === r.id ? "var(--text)" : "var(--text-dim)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      boxShadow: range === r.id ? "var(--shadow-sm)" : "none",
                    }}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              {data?.series && data.series.length > 0
                ? <LineChart series={data.series} currency={data.currency} />
                : <div style={{ height: 220, display: "grid", placeItems: "center", color: "var(--text-faint)", fontSize: 13 }}>Sin datos</div>}
            </div>
          </div>

          {/* Payment Links */}
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={h2Style}>Links de pago activos</h2>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{links.length} activos</span>
          </div>
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", marginBottom: 26, boxShadow: "var(--shadow-sm)" }}>
            {links.length === 0 ? (
              <div style={{ padding: "26px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 }}>
                Crea facturas y se generarán links automáticamente.
              </div>
            ) : links.map((l, i) => (
              <div key={l.id} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "13px 18px",
                borderBottom: i < links.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(0,113,227,0.1)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🔗</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{l.url}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{fmtMoney(l.amount, l.currency)}</div>
                <button onClick={() => navigator.clipboard.writeText(l.url)} style={{ padding: "6px 13px", border: "1px solid var(--border)", background: "var(--bg-elev-3)", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer" }}>Copiar</button>
                <a href={l.url} target="_blank" rel="noreferrer" style={{ padding: "6px 13px", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>Abrir →</a>
              </div>
            ))}
          </div>

          {/* Invoices header / filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ ...h2Style, marginRight: "auto" }}>Facturas</h2>
            {STATUS_FILTERS.map(f => {
              const count =
                f.id === "all"   ? (data?.invoices?.filter(i => i.status !== "void").length ?? 0)
                : (data?.invoices?.filter(i => i.status === f.id).length ?? 0);
              return (
                <button key={f.id} onClick={() => setStatusFilter(f.id)}
                  style={{
                    padding: "6px 14px", borderRadius: 8, border: "1px solid",
                    borderColor: statusFilter === f.id ? "var(--accent)" : "var(--border)",
                    background: statusFilter === f.id ? "var(--accent-soft)" : "#fff",
                    color: statusFilter === f.id ? "var(--accent)" : "var(--text-dim)",
                    fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  {f.label}
                  {count > 0 && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 700,
                      padding: "1px 6px", borderRadius: 999,
                      background: statusFilter === f.id ? "var(--accent)" : "var(--bg-elev-3)",
                      color: statusFilter === f.id ? "#fff" : "var(--text-faint)",
                      lineHeight: 1.4,
                    }}>{count}</span>
                  )}
                </button>
              );
            })}
            <div style={{ marginLeft: 12, fontSize: 11.5, color: "var(--success)", display: "flex", alignItems: "center", gap: 6 }}>
              <span className="status-dot status-dot--green" /> Stripe conectado
            </div>
          </div>

          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
            {loading ? (
              <div className="loading-pulse"><span/><span/><span/></div>
            ) : invoicesFiltered.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 }}>
                No hay facturas en este filtro.
              </div>
            ) : (
              <>
                <div style={{
                  display: "grid", gridTemplateColumns: "100px 1fr 110px 110px 110px 100px 150px",
                  gap: 12, padding: "10px 18px",
                  background: "var(--bg-elev-3)",
                  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: "var(--text-faint)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <div>Nº</div><div>Cliente</div><div>Fecha</div>
                  <div>Vencimiento</div><div>Importe</div><div>Estado</div><div>Acciones</div>
                </div>
                {invoicesFiltered.map((inv, i) => (
                  <div key={inv.id} style={{
                    display: "grid", gridTemplateColumns: "100px 1fr 110px 110px 110px 100px 150px",
                    gap: 12, padding: "13px 18px", alignItems: "center",
                    borderBottom: i < invoicesFiltered.length - 1 ? "1px solid var(--border)" : "none",
                    fontSize: 13,
                  }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-dim)" }}>
                      {inv.number || inv.id.slice(0, 12)}
                    </div>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{inv.customer_name || "—"}</div>
                      {inv.customer_email && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{inv.customer_email}</div>}
                    </div>
                    <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{fmtDate(inv.created)}</div>
                    <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{fmtDate(inv.due_date)}</div>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{fmtMoney(inv.amount, inv.currency)}</div>
                    <div><StatusBadge status={inv.status} /></div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {inv.hosted_invoice_url && (
                        <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer"
                          style={{ padding: "5px 9px", borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11, fontWeight: 600 }}>
                          Ver
                        </a>
                      )}
                      {inv.invoice_pdf && (
                        <a href={inv.invoice_pdf} target="_blank" rel="noreferrer"
                          style={{ padding: "5px 9px", borderRadius: 7, background: "var(--bg-elev-3)", color: "var(--text-dim)", fontSize: 11, fontWeight: 600 }}>
                          PDF
                        </a>
                      )}
                      <button
                        onClick={() => deleteInvoice(inv)}
                        title={
                          inv.status === "paid"  ? "Pagada · no se puede eliminar"
                          : inv.status === "void" ? "Ya anulada"
                          : inv.status === "draft" ? "Eliminar borrador"
                          : "Anular factura"
                        }
                        style={{
                          padding: "5px 8px", borderRadius: 7,
                          background: "transparent",
                          color: "var(--text-faint)",
                          border: "1px solid var(--border)",
                          fontSize: 12, cursor: "pointer",
                          opacity: (inv.status === "paid" || inv.status === "void") ? 0.5 : 1,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => {
                          if (inv.status === "paid" || inv.status === "void") return;
                          e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                          e.currentTarget.style.color = "var(--error)";
                          e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-faint)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {showInvoiceModal && (
        <InvoiceModal
          onClose={() => setShowInvoiceModal(false)}
          onCreated={() => { setShowInvoiceModal(false); load(range); loadLinks(); }}
        />
      )}
    </div>
  );
}

/* ─── Components ─── */
function MetricCard({ label, value, subtitle, color }: { label: string; value: string; subtitle: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: "16px 18px", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", color, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; text: string }> = {
    paid:          { bg: "rgba(16,185,129,0.1)",  fg: "#059669", text: "Pagada" },
    open:          { bg: "rgba(245,158,11,0.1)",  fg: "#b45309", text: "Pendiente" },
    void:          { bg: "rgba(100,116,139,0.1)", fg: "#475569", text: "Anulada" },
    draft:         { bg: "rgba(148,163,184,0.1)", fg: "#64748b", text: "Borrador" },
    uncollectible: { bg: "rgba(239,68,68,0.1)",   fg: "#dc2626", text: "No pagada" },
  };
  const cfg = map[status] || { bg: "var(--bg-elev-3)", fg: "var(--text-dim)", text: status };
  return (
    <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.fg }}>
      {cfg.text}
    </span>
  );
}

function LineChart({ series, currency }: { series: { date: string; amount: number }[]; currency: string }) {
  const W = 800, H = 220, PAD = { top: 12, right: 8, bottom: 28, left: 50 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(...series.map(p => p.amount), 1);
  const niceMax = Math.ceil(max / 100) * 100 || 100;

  const points = series.map((p, i) => ({
    x: PAD.left + (i / Math.max(series.length - 1, 1)) * innerW,
    y: PAD.top + innerH - (p.amount / niceMax) * innerH,
    ...p,
  }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${points[points.length-1]?.x ?? PAD.left} ${PAD.top + innerH} L ${PAD.left} ${PAD.top + innerH} Z`;

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (niceMax / yTicks) * i;
    return { v, y: PAD.top + innerH - (v / niceMax) * innerH };
  });
  const labelEvery = Math.max(1, Math.floor(series.length / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 240, display: "block" }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0071e3" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0071e3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="rgba(15,23,42,0.06)" strokeDasharray="3 4" />
          <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="10.5" fill="#94a3b8">
            {(t.v / 100).toFixed(2)} €
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={i} x={p.x} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#94a3b8">
            {new Date(p.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
          </text>
        ) : null
      )}
      <path d={areaPath} fill="url(#areaGrad)" />
      <path d={path} fill="none" stroke="#0071e3" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.filter(p => p.amount > 0).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="#fff" stroke="#0071e3" strokeWidth="2" />
      ))}
    </svg>
  );
}

/* ─── Invoice Modal ─── */
function InvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<"customer" | "details" | "review" | "done">("customer");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({
    name: "", email: "", phone: "", tax_id: "",
    line1: "", line2: "", city: "", postal_code: "", state: "", country: "ES",
  });
  const [items, setItems] = useState<{ description: string; amount: string; quantity: string }[]>([
    { description: "", amount: "", quantity: "1" },
  ]);
  const [description, setDescription] = useState("");
  const [footer, setFooter] = useState("Gracias por confiar en onepulso · team@onepulso.online");
  const [daysUntilDue, setDaysUntilDue] = useState("30");
  const [sendEmail, setSendEmail] = useState(true);
  const [createPaymentLink, setCreatePaymentLink] = useState(true);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [usingNew, setUsingNew] = useState(false);

  useEffect(() => {
    fetch("/api/stripe/customers").then(r => r.json()).then(j => setCustomers(j.customers ?? []));
  }, []);

  async function searchCustomers(q: string) {
    setSearch(q);
    const j = await fetch(`/api/stripe/customers?q=${encodeURIComponent(q)}`).then(r => r.json());
    setCustomers(j.customers ?? []);
  }

  function addLine() {
    setItems(prev => [...prev, { description: "", amount: "", quantity: "1" }]);
  }
  function updateLine(i: number, key: "description" | "amount" | "quantity", v: string) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: v } : it));
  }
  function removeLine(i: number) {
    setItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }

  const total = items.reduce((s, it) => {
    const amt = parseFloat(it.amount || "0") * parseInt(it.quantity || "1");
    return s + (isNaN(amt) ? 0 : amt);
  }, 0);

  async function submit() {
    setCreating(true);
    try {
      const payload: any = {
        items: items
          .filter(it => it.description && it.amount)
          .map(it => ({
            description: it.description,
            amount: Math.round(parseFloat(it.amount) * 100),
            quantity: parseInt(it.quantity || "1"),
          })),
        currency: "eur",
        description,
        footer,
        days_until_due: parseInt(daysUntilDue),
        collection_method: "send_invoice",
        send_email: sendEmail,
        create_payment_link: createPaymentLink,
      };

      if (selectedCustomer) {
        payload.customer_id = selectedCustomer.id;
      } else {
        payload.new_customer = {
          name: newCustomer.name,
          email: newCustomer.email,
          phone: newCustomer.phone,
          tax_id: newCustomer.tax_id,
          tax_type: "eu_vat",
          address: {
            line1: newCustomer.line1, line2: newCustomer.line2,
            city: newCustomer.city, postal_code: newCustomer.postal_code,
            state: newCustomer.state, country: newCustomer.country,
          },
        };
      }

      const r = await fetch("/api/stripe/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.error) {
        alert(j.error);
      } else {
        setResult(j);
        setStep("done");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div onClick={onClose} style={modalBackdrop}>
      <div onClick={e => e.stopPropagation()} style={{
        ...modalBox, width: "92%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Nueva factura
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>
              Paso {step === "customer" ? 1 : step === "details" ? 2 : step === "review" ? 3 : 4} de 3
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 20, color: "var(--text-faint)", cursor: "pointer" }}>×</button>
        </div>

        <StepBar step={step} />

        {/* Step 1 — Customer */}
        {step === "customer" && (
          <>
            <div style={{ display: "flex", gap: 6, marginTop: 16, marginBottom: 12 }}>
              <button onClick={() => setUsingNew(false)} style={{
                ...tabStyle, background: !usingNew ? "var(--accent-soft)" : "var(--bg-elev-3)",
                color: !usingNew ? "var(--accent)" : "var(--text-dim)",
              }}>👤 Cliente existente</button>
              <button onClick={() => setUsingNew(true)} style={{
                ...tabStyle, background: usingNew ? "var(--accent-soft)" : "var(--bg-elev-3)",
                color: usingNew ? "var(--accent)" : "var(--text-dim)",
              }}>+ Nuevo cliente</button>
            </div>

            {!usingNew ? (
              <>
                <input
                  placeholder="Buscar por nombre o email..."
                  value={search}
                  onChange={e => searchCustomers(e.target.value)}
                  style={inputStyle}
                />
                <div style={{
                  marginTop: 12, maxHeight: 280, overflowY: "auto",
                  border: "1px solid var(--border)", borderRadius: 10,
                }}>
                  {customers.length === 0 ? (
                    <div style={{ padding: 16, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                      Sin clientes. Usa "+ Nuevo cliente".
                    </div>
                  ) : customers.map((c, i) => (
                    <div key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      style={{
                        padding: "10px 14px", cursor: "pointer",
                        borderBottom: i < customers.length - 1 ? "1px solid var(--border)" : "none",
                        background: selectedCustomer?.id === c.id ? "var(--accent-soft)" : "transparent",
                      }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)" }}>
                        {c.name || c.email || "Sin nombre"}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{c.email}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Nombre / Empresa" value={newCustomer.name} onChange={v => setNewCustomer(p => ({ ...p, name: v }))} required />
                  <Input label="Email" type="email" value={newCustomer.email} onChange={v => setNewCustomer(p => ({ ...p, email: v }))} required />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Teléfono" value={newCustomer.phone} onChange={v => setNewCustomer(p => ({ ...p, phone: v }))} />
                  <Input label="NIF / CIF / VAT" placeholder="ESB12345678" value={newCustomer.tax_id} onChange={v => setNewCustomer(p => ({ ...p, tax_id: v }))} />
                </div>
                <Input label="Dirección" value={newCustomer.line1} onChange={v => setNewCustomer(p => ({ ...p, line1: v }))} />
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 10 }}>
                  <Input label="C.P." value={newCustomer.postal_code} onChange={v => setNewCustomer(p => ({ ...p, postal_code: v }))} />
                  <Input label="Ciudad" value={newCustomer.city} onChange={v => setNewCustomer(p => ({ ...p, city: v }))} />
                  <Input label="Provincia" value={newCustomer.state} onChange={v => setNewCustomer(p => ({ ...p, state: v }))} />
                </div>
                <Input label="País (ISO 2)" value={newCustomer.country} onChange={v => setNewCustomer(p => ({ ...p, country: v }))} />

                {/* Paste / Drop zone with AI extraction */}
                <PasteExtract
                  onExtract={data => {
                    setNewCustomer(p => ({
                      ...p,
                      name: data.name ?? p.name,
                      email: data.email ?? p.email,
                      phone: data.phone ?? p.phone,
                      tax_id: data.tax_id ?? p.tax_id,
                      line1: data.address?.line1 ?? p.line1,
                      line2: data.address?.line2 ?? p.line2,
                      city: data.address?.city ?? p.city,
                      postal_code: data.address?.postal_code ?? p.postal_code,
                      state: data.address?.state ?? p.state,
                      country: data.address?.country ?? p.country,
                    }));
                  }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={onClose} style={btnSecondary}>Cancelar</button>
              <button
                onClick={() => setStep("details")}
                disabled={(!selectedCustomer && !usingNew) || (usingNew && (!newCustomer.name || !newCustomer.email))}
                style={{ ...btnPrimary, flex: 1, opacity: ((!selectedCustomer && !usingNew) || (usingNew && (!newCustomer.name || !newCustomer.email))) ? 0.5 : 1 }}
              >
                Siguiente →
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Details */}
        {step === "details" && (
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Líneas de la factura</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 32px", gap: 6 }}>
                  <input placeholder="Concepto"
                    value={it.description}
                    onChange={e => updateLine(i, "description", e.target.value)}
                    style={inputStyle} />
                  <input placeholder="Cant." type="number" min="1"
                    value={it.quantity}
                    onChange={e => updateLine(i, "quantity", e.target.value)}
                    style={inputStyle} />
                  <input placeholder="Importe €" type="number" step="0.01"
                    value={it.amount}
                    onChange={e => updateLine(i, "amount", e.target.value)}
                    style={inputStyle} />
                  <button onClick={() => removeLine(i)} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-faint)", cursor: "pointer" }}>×</button>
                </div>
              ))}
            </div>
            <button onClick={addLine} style={{ ...btnSecondary, padding: "7px 14px", fontSize: 12, marginBottom: 14 }}>
              + Añadir línea
            </button>

            <div style={{ background: "var(--bg-elev-3)", padding: 10, borderRadius: 10, marginBottom: 14, fontSize: 13.5, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-dim)" }}>Total</span>
              <span style={{ color: "var(--text)" }}>{total.toFixed(2)} €</span>
            </div>

            <label style={labelStyle}>Concepto / memo</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ej. Servicios profesionales · Mayo 2026"
              style={inputStyle} />

            <label style={{ ...labelStyle, marginTop: 12 }}>Texto al pie</label>
            <textarea value={footer} onChange={e => setFooter(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />

            <label style={{ ...labelStyle, marginTop: 12 }}>Días hasta vencimiento</label>
            <input type="number" min="1" value={daysUntilDue}
              onChange={e => setDaysUntilDue(e.target.value)}
              style={{ ...inputStyle, maxWidth: 140 }} />

            <div style={{ marginTop: 14, padding: 12, background: "var(--bg-elev-2)", borderRadius: 12, display: "grid", gap: 8 }}>
              <Toggle checked={sendEmail} onChange={setSendEmail}
                label="Enviar factura por email automáticamente"
                hint="Stripe la mandará al email del cliente con el botón de pago" />
              <Toggle checked={createPaymentLink} onChange={setCreatePaymentLink}
                label="Generar también un payment link"
                hint="Para compartir por WhatsApp/SMS además del email" />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button onClick={() => setStep("customer")} style={btnSecondary}>← Atrás</button>
              <button
                onClick={() => setStep("review")}
                disabled={items.filter(i => i.description && i.amount).length === 0}
                style={{ ...btnPrimary, flex: 1, opacity: items.filter(i => i.description && i.amount).length === 0 ? 0.5 : 1 }}
              >
                Revisar →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === "review" && (
          <div style={{ marginTop: 14 }}>
            <div style={{ background: "var(--bg-elev-2)", borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                Cliente
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginTop: 4 }}>
                {selectedCustomer?.name || newCustomer.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                {selectedCustomer?.email || newCustomer.email}
              </div>

              <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />

              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>
                Líneas ({items.filter(i => i.description && i.amount).length})
              </div>
              {items.filter(i => i.description && i.amount).map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 13 }}>
                  <span style={{ color: "var(--text-dim)" }}>{it.description} · ×{it.quantity}</span>
                  <span style={{ fontWeight: 600 }}>{(parseFloat(it.amount) * parseInt(it.quantity || "1")).toFixed(2)} €</span>
                </div>
              ))}
              <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700 }}>
                <span>Total</span><span>{total.toFixed(2)} €</span>
              </div>
            </div>

            <div style={{ background: "rgba(0,113,227,0.06)", padding: "10px 14px", borderRadius: 10, fontSize: 12.5, color: "var(--accent)", marginBottom: 14 }}>
              {sendEmail && <div>📧 Se enviará por email al cliente</div>}
              {createPaymentLink && <div>🔗 Se generará link de pago compartible</div>}
              <div>⏱ Vence en {daysUntilDue} días</div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep("details")} style={btnSecondary}>← Atrás</button>
              <button onClick={submit} disabled={creating} style={{ ...btnPrimary, flex: 1 }}>
                {creating ? "Creando..." : "Crear y enviar factura ✓"}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Done */}
        {step === "done" && result && (
          <div style={{ marginTop: 14 }}>
            <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", padding: 16, borderRadius: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, color: "#065f46", fontSize: 15, marginBottom: 4 }}>
                ✓ Factura {result.number} creada
              </div>
              <div style={{ fontSize: 13, color: "#047857" }}>
                {result.sent ? "Enviada por email al cliente." : "Lista para enviar."}
              </div>
            </div>

            {result.hosted_invoice_url && (
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>URL de la factura</label>
                <input readOnly value={result.hosted_invoice_url}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }} />
              </div>
            )}
            {result.payment_link_url && (
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Link de pago compartible</label>
                <input readOnly value={result.payment_link_url}
                  onClick={e => (e.target as HTMLInputElement).select()}
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }} />
                <button onClick={() => navigator.clipboard.writeText(result.payment_link_url!)}
                  style={{ ...btnSecondary, marginTop: 6, fontSize: 12 }}>Copiar link</button>
              </div>
            )}
            {result.invoice_pdf && (
              <a href={result.invoice_pdf} target="_blank" rel="noreferrer"
                style={{ ...btnSecondary, display: "inline-block", marginTop: 8, textDecoration: "none" }}>
                Descargar PDF
              </a>
            )}

            <button onClick={onCreated} style={{ ...btnPrimary, width: "100%", marginTop: 16 }}>
              Hecho
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepBar({ step }: { step: string }) {
  const steps = ["customer", "details", "review"];
  const active = steps.indexOf(step);
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
      {steps.map((s, i) => (
        <div key={s} style={{
          flex: 1, height: 3, borderRadius: 999,
          background: i <= active ? "var(--accent)" : "var(--bg-elev-3)",
        }} />
      ))}
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, required }: any) {
  return (
    <div>
      <label style={labelStyle}>{label}{required && <span style={{ color: "var(--error)" }}> *</span>}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

function PasteExtract({ onExtract }: { onExtract: (data: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function processImage(dataUrl: string) {
    setLoading(true); setError(null); setSuccess(null);
    try {
      const r = await fetch("/api/stripe/extract-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const j = await r.json();
      if (j.error) {
        setError(j.error);
      } else if (j.extracted) {
        onExtract(j.extracted);
        setSuccess("✓ Datos extraídos y rellenados");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function processText(text: string) {
    if (!text.trim()) return;
    setLoading(true); setError(null); setSuccess(null);
    try {
      const r = await fetch("/api/stripe/extract-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (j.error) setError(j.error);
      else if (j.extracted) {
        onExtract(j.extracted);
        setSuccess("✓ Datos extraídos y rellenados");
        setPasteText("");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = ev => processImage(String(ev.target?.result));
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = ev => processImage(String(ev.target?.result));
      reader.readAsDataURL(file);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => processImage(String(ev.target?.result));
    reader.readAsDataURL(file);
  }

  return (
    <div style={{
      marginTop: 6,
      padding: 14,
      background: "linear-gradient(135deg, rgba(0,113,227,0.04), rgba(99,102,241,0.04))",
      border: "1.5px dashed " + (dragOver ? "var(--accent)" : "rgba(0,113,227,0.3)"),
      borderRadius: 14,
      transition: "border-color 0.15s",
    }}
      onPaste={handlePaste}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      tabIndex={0}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>✨</span>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.02em" }}>
          Auto-rellenar con IA
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginBottom: 10 }}>
        Pega una captura de pantalla (Ctrl+V), arrastra una imagen, o pega texto con los datos del cliente — la IA extraerá nombre, email, NIF, dirección y los rellenará automáticamente.
      </div>

      <textarea
        value={pasteText}
        onChange={e => setPasteText(e.target.value)}
        placeholder="O pega aquí el texto con los datos de facturación..."
        rows={3}
        style={{
          width: "100%", padding: "9px 11px",
          border: "1px solid var(--border)", borderRadius: 9,
          background: "#fff", fontSize: 12.5, color: "var(--text)",
          outline: "none", resize: "vertical", fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label
          style={{
            ...btnSecondary,
            padding: "7px 12px", fontSize: 12, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          📎 Subir imagen
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {pasteText.trim() && (
          <button
            onClick={() => processText(pasteText)}
            disabled={loading}
            style={{ ...btnPrimary, padding: "7px 14px", fontSize: 12 }}
          >
            {loading ? "Analizando..." : "Extraer del texto"}
          </button>
        )}
        {loading && <span style={{ fontSize: 11.5, color: "var(--accent)" }}>🪄 Analizando con IA...</span>}
        {success && <span style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 600 }}>{success}</span>}
        {error && <span style={{ fontSize: 11.5, color: "var(--error)" }}>⚠ {error}</span>}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 36, height: 20, borderRadius: 999, flexShrink: 0,
        background: checked ? "var(--accent)" : "var(--bg-elev-3)",
        position: "relative", transition: "background 0.18s",
        marginTop: 2,
      }}>
        <div style={{
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: 999, background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.18s",
        }} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 1 }}>{hint}</div>}
      </div>
    </label>
  );
}

function NotConfigured() {
  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content">
        <div className="dash-page-header">
          <div>
            <div className="dash-page-title">Facturación</div>
            <div className="dash-page-subtitle">Stripe no configurado</div>
          </div>
        </div>
        <div className="dash-home" style={{ display: "grid", placeItems: "center" }}>
          <div style={{ maxWidth: 540, textAlign: "center", background: "#fff", border: "1px solid var(--border)", borderRadius: 18, padding: 36 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Stripe no está configurado
            </h2>
            <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 8 }}>
              Añade <code>STRIPE_SECRET_KEY</code> en Railway o en <code>.env.local</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Styles ─── */
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em",
  textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 13px", background: "var(--bg-elev-2)",
  border: "1.5px solid var(--border)", borderRadius: 10,
  fontSize: 13.5, color: "var(--text)", outline: "none", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", background: "var(--accent)", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600,
  cursor: "pointer", boxShadow: "0 2px 8px rgba(0,113,227,0.25)", fontFamily: "inherit",
};
const btnSecondary: React.CSSProperties = {
  padding: "9px 14px", background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10, fontSize: 13,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
  display: "inline-block",
};
const tabStyle: React.CSSProperties = {
  flex: 1, padding: "9px 10px", border: "none", borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const h2Style: React.CSSProperties = {
  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700,
  color: "var(--text)", letterSpacing: "-0.02em",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "grid", placeItems: "center", zIndex: 100, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 18, padding: 26,
  boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
};
