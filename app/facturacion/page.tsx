"use client";

import { useEffect, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Sub = {
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  plan_name: string;
  amount: number;
  currency: string;
  interval: string;
} | null;

type Invoice = {
  id: string;
  number: string | null;
  amount_paid: number;
  amount_due: number;
  currency: string;
  status: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

type StatusData = {
  configured: boolean;
  connected: boolean;
  message?: string;
  customer?: { id: string; email: string; name: string };
  subscription?: Sub;
  invoices?: Invoice[];
  error?: string;
};

export default function FacturacionPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const r = await fetch("/api/stripe/status");
      const j = await r.json();
      setData(j);
    } catch (e: any) {
      setData({ configured: false, connected: false, error: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function openPortal() {
    setActionLoading("portal");
    try {
      const r = await fetch("/api/stripe/portal", { method: "POST" });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else alert(j.error || "Error abriendo portal");
    } finally {
      setActionLoading(null);
    }
  }

  async function startCheckout() {
    setActionLoading("checkout");
    try {
      const r = await fetch("/api/stripe/checkout", { method: "POST" });
      const j = await r.json();
      if (j.url) window.location.href = j.url;
      else alert(j.error || "Error creando checkout");
    } finally {
      setActionLoading(null);
    }
  }

  function fmtMoney(amount: number, currency: string) {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format((amount ?? 0) / 100);
  }

  function fmtDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString("es-ES", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  const sub = data?.subscription;
  const isActive = sub?.status === "active" || sub?.status === "trialing";

  return (
    <div className="dash-shell">
      <DashboardNav />

      <div className="dash-content">
        {/* Header */}
        <div className="dash-page-header">
          <div>
            <div className="dash-page-title">Facturación</div>
            <div className="dash-page-subtitle">Gestiona tu suscripción y método de pago</div>
          </div>
          <div className="dash-page-actions">
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--text-dim)",
            }}>
              <span className={`status-dot ${data?.connected ? "status-dot--green" : "status-dot--red"}`} />
              Stripe {data?.connected ? "conectado" : "no configurado"}
            </div>
          </div>
        </div>

        <div className="dash-home">
          {loading && (
            <div className="loading-pulse"><span /><span /><span /></div>
          )}

          {!loading && !data?.configured && (
            <div style={{
              background: "#ffffff", border: "1px solid var(--border)",
              borderRadius: 18, padding: 32, boxShadow: "var(--shadow-sm)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
              <h2 style={{
                fontFamily: "var(--font-display)",
                fontSize: 20, fontWeight: 700, color: "var(--text)",
                marginBottom: 8, letterSpacing: "-0.02em",
              }}>
                Stripe no está configurado
              </h2>
              <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 18, maxWidth: 520, marginInline: "auto" }}>
                Para activar facturación, añade estas variables en tu entorno (Railway → Variables):
              </p>
              <div style={{
                background: "var(--bg-elev-3)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "14px 18px", textAlign: "left",
                fontFamily: "var(--font-mono)", fontSize: 12.5,
                color: "var(--text)", maxWidth: 520, marginInline: "auto",
                lineHeight: 1.9,
              }}>
                STRIPE_SECRET_KEY=sk_live_...<br />
                STRIPE_DEFAULT_PRICE_ID=price_...<br />
                STRIPE_WEBHOOK_SECRET=whsec_...<br />
                STRIPE_OWNER_EMAIL=team@onepulso.online
              </div>
              <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 16 }}>
                Los obtienes en{" "}
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  Stripe Dashboard
                </a>
              </p>
            </div>
          )}

          {!loading && data?.configured && data?.error && (
            <div style={{
              background: "var(--error-bg)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: 14, padding: "14px 18px", color: "var(--error)",
              fontSize: 13.5,
            }}>
              <strong>Error de Stripe:</strong> {data.error}
            </div>
          )}

          {!loading && data?.connected && (
            <>
              {/* Subscription card */}
              <div style={{
                background: "#ffffff",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: 28,
                boxShadow: "var(--shadow-sm)",
                marginBottom: 18,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: "var(--text-faint)",
                      letterSpacing: "0.08em", textTransform: "uppercase",
                      marginBottom: 8,
                    }}>
                      Plan actual
                    </div>
                    {sub ? (
                      <>
                        <div style={{
                          fontFamily: "var(--font-display)", fontSize: 26,
                          fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text)",
                          marginBottom: 4,
                        }}>
                          {sub.plan_name || "Plan activo"}
                        </div>
                        <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
                          {fmtMoney(sub.amount, sub.currency)} / {sub.interval === "month" ? "mes" : sub.interval}
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span className={`stat-card-change ${isActive ? "stat-card-change--up" : "stat-card-change--neutral"}`}>
                            {sub.status}
                          </span>
                          {sub.cancel_at_period_end && (
                            <span className="stat-card-change stat-card-change--error">se cancelará</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 10 }}>
                          {sub.cancel_at_period_end ? "Termina el " : "Próxima renovación: "}
                          <strong style={{ color: "var(--text-dim)" }}>{fmtDate(sub.current_period_end)}</strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{
                          fontFamily: "var(--font-display)", fontSize: 22,
                          fontWeight: 700, color: "var(--text)", marginBottom: 4,
                        }}>
                          Sin suscripción activa
                        </div>
                        <div style={{ fontSize: 13.5, color: "var(--text-dim)" }}>
                          Activa un plan para empezar a usar la plataforma sin límites.
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {sub ? (
                      <button
                        onClick={openPortal}
                        disabled={actionLoading === "portal"}
                        style={{
                          padding: "10px 18px",
                          background: "var(--accent)",
                          color: "#fff", border: "none",
                          borderRadius: 11, fontSize: 13.5, fontWeight: 600,
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(0,113,227,0.25)",
                        }}
                      >
                        {actionLoading === "portal" ? "Abriendo..." : "Gestionar plan"}
                      </button>
                    ) : (
                      <button
                        onClick={startCheckout}
                        disabled={actionLoading === "checkout"}
                        style={{
                          padding: "10px 20px",
                          background: "var(--accent)",
                          color: "#fff", border: "none",
                          borderRadius: 11, fontSize: 13.5, fontWeight: 600,
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(0,113,227,0.25)",
                        }}
                      >
                        {actionLoading === "checkout" ? "Cargando..." : "Suscribirse →"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Customer info */}
              <div style={{
                background: "#ffffff", border: "1px solid var(--border)",
                borderRadius: 18, padding: 22, boxShadow: "var(--shadow-sm)",
                marginBottom: 18,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              }}>
                <div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: "var(--text-faint)",
                    letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4,
                  }}>
                    Cuenta de facturación
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                    {data.customer?.email}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                    Customer ID: <code style={{ fontFamily: "var(--font-mono)" }}>{data.customer?.id}</code>
                  </div>
                </div>
                <button
                  onClick={openPortal}
                  disabled={actionLoading === "portal"}
                  style={{
                    padding: "8px 16px",
                    background: "transparent", color: "var(--text-dim)",
                    border: "1px solid var(--border-medium)",
                    borderRadius: 10, fontSize: 12.5, fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cambiar método de pago
                </button>
              </div>

              {/* Invoices */}
              <div style={{ marginBottom: 12 }}>
                <h2 style={{
                  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600,
                  color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 12,
                }}>
                  Facturas recientes
                </h2>
              </div>

              <div style={{
                background: "#ffffff", border: "1px solid var(--border)",
                borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-sm)",
              }}>
                {(!data.invoices || data.invoices.length === 0) ? (
                  <div style={{
                    padding: "32px 20px", textAlign: "center",
                    color: "var(--text-faint)", fontSize: 13.5,
                  }}>
                    Aún no hay facturas.
                  </div>
                ) : (
                  data.invoices.map((inv, i) => (
                    <div
                      key={inv.id}
                      style={{
                        display: "flex", alignItems: "center",
                        padding: "14px 20px", gap: 16,
                        borderBottom: i < data.invoices!.length - 1 ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: inv.status === "paid" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 16, flexShrink: 0,
                      }}>
                        {inv.status === "paid" ? "✓" : "•"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13.5, fontWeight: 600, color: "var(--text)",
                          letterSpacing: "-0.01em",
                        }}>
                          {inv.number || inv.id}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                          {fmtDate(inv.created)} · {inv.status}
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                        {fmtMoney(inv.amount_paid || inv.amount_due, inv.currency)}
                      </div>
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12, fontWeight: 600, color: "var(--accent)",
                            padding: "5px 12px", borderRadius: 8,
                            background: "var(--accent-soft)",
                          }}
                        >
                          Ver
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
