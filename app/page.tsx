"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardNav from "./components/DashboardNav";

export default function DashboardHome() {
  const [campaigns, setCampaigns]       = useState<any[]>([]);
  const [memory, setMemory]             = useState<any[]>([]);
  const [instantly, setInstantly]       = useState<any>(null);
  const [linkedinStatus, setLinkedin]   = useState<any>(null);
  const [gmailStatus, setGmail]         = useState<any>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/campaigns").then(r => r.json()).catch(() => ({ records: [] })),
      fetch("/api/memory").then(r => r.json()).catch(() => ({ entries: [] })),
      fetch("/api/instantly/status").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/linkedin/status").then(r => r.json()).catch(() => ({ connected: false })),
      fetch("/api/email/status").then(r => r.json()).catch(() => ({ connected: false })),
    ]).then(([c, m, ins, li, gm]) => {
      setCampaigns(c.records ?? []);
      setMemory(m.entries ?? []);
      setInstantly(ins);
      setLinkedin(li);
      setGmail(gm);
      setLoading(false);
    });
  }, []);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  const totalLeads = campaigns.reduce((s: number, c: any) => s + (c.leads_uploaded ?? 0), 0);
  const linkedinPosts = linkedinStatus?.posts_count ?? 0;

  return (
    <div className="dash-shell">
      <DashboardNav />

      <div className="dash-content">
        {/* Header con breadcrumbs estilo design system */}
        <div className="dash-page-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
            <span style={{ color: "var(--t4)" }}>OnePulso</span>
            <span style={{ color: "var(--t5)" }}>›</span>
            <span style={{ color: "var(--t1)", fontWeight: 600 }}>Dashboard</span>
          </div>
          <div className="dash-page-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)", marginRight: 6 }}>
              <span className={`status-dot ${instantly?.connected ? "status-dot--green" : "status-dot--red"}`} />
              Instantly {instantly?.connected ? "conectado" : "desconectado"}
            </div>
            <Link
              href="/campaigns"
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 16px",
                background: "linear-gradient(135deg, #f9a603 0%, #f59e3a 30%, #d15cfe 100%)",
                color: "#fff",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(209,92,254,0.30), 0 1px 0 rgba(0,0,0,0.08) inset",
                letterSpacing: "-0.01em",
              }}
            >+ Crear</Link>
          </div>
        </div>

        {/* Content */}
        <div className="dash-home">
          {/* Hero card con gradiente brand */}
          <div className="dash-hero">
            <div className="dash-hero-pill">
              <span className="dash-hero-pill-dot" />
              Operación en vivo · {now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h1 className="dash-hero-title">{greeting} 👋</h1>
            <p className="dash-hero-sub">
              Tienes <strong>{loading ? "—" : campaigns.length}</strong> campañas activas en Instantly
              {memory.length > 0 && <> y <strong>{memory.length}</strong> notas en memoria</>}.
              Aquí tienes el resumen de tu plataforma.
            </p>
            <div className="dash-hero-actions">
              <Link href="/seguimientos" className="dash-hero-btn dash-hero-btn--soft">
                ↗ Ir a Seguimientos
              </Link>
              <Link href="/campaigns" className="dash-hero-btn dash-hero-btn--solid">
                + Nueva campaña
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card-top">
                <div className="stat-card-icon stat-card-icon--blue">📧</div>
                <span className={`stat-card-change ${instantly?.connected ? "stat-card-change--up" : "stat-card-change--neutral"}`}>
                  {instantly?.connected ? "activo" : "sin conectar"}
                </span>
              </div>
              <div>
                <div className="stat-card-value">{loading ? "—" : campaigns.length}</div>
                <div className="stat-card-label">Campañas en Instantly</div>
              </div>
              <Sparkline color="#0566ea" />
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <div className="stat-card-icon stat-card-icon--green">🧠</div>
                <span className="stat-card-change stat-card-change--up">memoria</span>
              </div>
              <div>
                <div className="stat-card-value">{loading ? "—" : memory.length}</div>
                <div className="stat-card-label">Notas en memoria IA</div>
              </div>
              <Sparkline color="#1f8a5b" />
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <div className="stat-card-icon stat-card-icon--amber">👥</div>
                <span className="stat-card-change stat-card-change--neutral">leads</span>
              </div>
              <div>
                <div className="stat-card-value">{loading ? "—" : totalLeads.toLocaleString()}</div>
                <div className="stat-card-label">Leads totales subidos</div>
              </div>
              <Sparkline color="#f9a603" />
            </div>

            <div className="stat-card">
              <div className="stat-card-top">
                <div className="stat-card-icon stat-card-icon--purple">💼</div>
                <span className={`stat-card-change ${linkedinStatus?.connected ? "stat-card-change--up" : "stat-card-change--neutral"}`}>
                  {linkedinStatus?.connected ? linkedinStatus.name?.split(" ")[0] ?? "activo" : "sin conectar"}
                </span>
              </div>
              <div>
                <div className="stat-card-value">{loading ? "—" : linkedinPosts}</div>
                <div className="stat-card-label">Posts LinkedIn</div>
              </div>
              <Sparkline color="#d15cfe" />
            </div>
          </div>

          {/* Module cards */}
          <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>
              Módulos
            </h2>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Accede rápido a cada herramienta</span>
          </div>

          <div className="dash-modules">
            {/* Campaigns */}
            <Link href="/campaigns" className="dash-module-card">
              <div className="dash-module-icon-wrap dash-module-icon-wrap--blue">📧</div>
              <div>
                <div className="dash-module-title">Campañas de email</div>
                <div className="dash-module-desc">
                  Genera cold emails con IA, sube leads y crea campañas en Instantly desde un chat con memoria.
                </div>
              </div>
              <div className="dash-module-footer">
                <span className="dash-module-stat">
                  <strong>{campaigns.length}</strong> campañas · <strong>{memory.length}</strong> notas
                </span>
                <span className="dash-module-cta">
                  Abrir →
                </span>
              </div>
            </Link>

            {/* Seguimientos */}
            <Link href="/seguimientos" className="dash-module-card">
              <div className="dash-module-icon-wrap dash-module-icon-wrap--green">💬</div>
              <div>
                <div className="dash-module-title">Seguimientos</div>
                <div className="dash-module-desc">
                  Conecta tu Gmail. Gestiona respuestas, programa follow-ups y deja que la IA detecte interés.
                </div>
              </div>
              <div className="dash-module-footer">
                <span className="dash-module-stat">
                  Gmail: <strong style={{ color: gmailStatus?.connected ? "#30d158" : "var(--text-faint)" }}>
                    {gmailStatus?.connected ? gmailStatus.display_name ?? "conectado" : "sin conectar"}
                  </strong>
                </span>
                <span className="dash-module-cta">Abrir →</span>
              </div>
            </Link>

            {/* LinkedIn */}
            <Link href="/linkedin" className="dash-module-card">
              <div className="dash-module-icon-wrap dash-module-icon-wrap--brand">💼</div>
              <div>
                <div className="dash-module-title">LinkedIn automático</div>
                <div className="dash-module-desc">
                  Redacta posts con IA, programa publicaciones y gestiona tu calendario de contenido.
                </div>
              </div>
              <div className="dash-module-footer">
                <span className="dash-module-stat">
                  LinkedIn: <strong style={{ color: linkedinStatus?.connected ? "#30d158" : "var(--text-faint)" }}>
                    {linkedinStatus?.connected ? linkedinStatus.name ?? "conectado" : "sin conectar"}
                  </strong>
                </span>
                <span className="dash-module-cta">Abrir →</span>
              </div>
            </Link>
          </div>

          {/* Recent campaigns */}
          {campaigns.length > 0 && (
            <div>
              <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 8 }}>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)" }}>
                  Campañas recientes
                </h2>
              </div>
              <div style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                overflow: "hidden",
              }}>
                {campaigns.slice(0, 5).map((c: any, i: number) => (
                  <Link
                    key={c.id}
                    href="/campaigns"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "14px 20px",
                      borderBottom: i < Math.min(campaigns.length, 5) - 1 ? "1px solid var(--border)" : "none",
                      gap: 16,
                      transition: "background 0.15s",
                      color: "inherit",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-elev-2)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: "rgba(0,113,227,0.1)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, flexShrink: 0,
                    }}>
                      📧
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                        {c.steps_count} pasos · {c.variants_per_step?.reduce((a: number, b: number) => a + b, 0) ?? 0} variantes
                        {c.leads_uploaded ? ` · ${c.leads_uploaded} leads` : ""}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10.5, fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "rgba(0,113,227,0.1)",
                      color: "#5eaeff",
                      flexShrink: 0,
                    }}>
                      activa
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Sparkline minimal: SVG con polyline + área suave. Pseudo-aleatoria pero
 * determinista por color para que no parpadee entre renders.
 */
function Sparkline({ color, height = 32, points = 12 }: { color: string; height?: number; points?: number }) {
  // Seed fija por color para curva consistente entre re-renders.
  const seed = color.charCodeAt(1) + color.charCodeAt(3);
  const data: number[] = [];
  let v = 50 + (seed % 30);
  for (let i = 0; i < points; i++) {
    const trend = ((seed >> i) & 1) ? 5 : -3;
    v = Math.max(15, Math.min(90, v + trend + ((seed * (i + 1)) % 9) - 4));
    data.push(v);
  }
  const w = 100;
  const step = w / (points - 1);
  const poly = data.map((y, i) => `${(i * step).toFixed(1)},${(100 - y).toFixed(1)}`).join(" ");
  const area = `0,100 ${poly} ${w},100`;
  const gradId = `spark-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", marginTop: 4 }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline points={poly} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
