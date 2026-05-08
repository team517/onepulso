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

  // Donut ring helper
  function Ring({ pct, color }: { pct: number; color: string }) {
    const r = 28, circ = 2 * Math.PI * r;
    const offset = circ - (pct / 100) * circ;
    return (
      <svg width="68" height="68" className="stat-ring">
        <circle className="stat-ring-track" cx="34" cy="34" r={r} />
        <circle
          className={`stat-ring-fill stat-ring-fill--${color}`}
          cx="34" cy="34" r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
    );
  }

  return (
    <div className="dash-shell">
      <DashboardNav />

      <div className="dash-content">
        {/* Header */}
        <div className="dash-page-header">
          <div>
            <div className="dash-page-title">Dashboard</div>
            <div className="dash-page-subtitle">
              {now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          <div className="dash-page-actions">
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-faint)", background: "var(--bg-elev-2)", padding: "6px 14px", borderRadius: 99, border: "1px solid var(--border)" }}>
              <span className={`status-dot ${instantly?.connected ? "status-dot--green" : "status-dot--red"}`} />
              Instantly {instantly?.connected ? "conectado" : "desconectado"}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="dash-home">
          {/* Greeting */}
          <div style={{ marginBottom: 24 }}>
            <h1 className="dash-home-title">{greeting} 👋</h1>
            <p className="dash-home-subtitle">Aquí tienes el resumen de tu plataforma.</p>
          </div>

          {/* Stats */}
          <div className="stat-grid">
            {/* Campañas */}
            <div className="stat-card">
              <div className="stat-card-left">
                <div className="stat-card-icon stat-card-icon--blue">✉️</div>
                <div className="stat-card-value">{loading ? "—" : campaigns.length}</div>
                <div className="stat-card-label">Campañas Instantly</div>
                <span className={`stat-card-change ${instantly?.connected ? "stat-card-change--up" : "stat-card-change--neutral"}`}>
                  {instantly?.connected ? "● activo" : "● sin conectar"}
                </span>
              </div>
              <div className="stat-card-ring">
                <Ring pct={instantly?.connected ? 72 : 0} color="blue" />
              </div>
            </div>

            {/* Memoria */}
            <div className="stat-card">
              <div className="stat-card-left">
                <div className="stat-card-icon stat-card-icon--green">🧠</div>
                <div className="stat-card-value">{loading ? "—" : memory.length}</div>
                <div className="stat-card-label">Notas en memoria IA</div>
                <span className="stat-card-change stat-card-change--up">● memoria activa</span>
              </div>
              <div className="stat-card-ring">
                <Ring pct={memory.length > 0 ? Math.min(100, memory.length * 10) : 5} color="green" />
              </div>
            </div>

            {/* Leads */}
            <div className="stat-card">
              <div className="stat-card-left">
                <div className="stat-card-icon stat-card-icon--amber">👥</div>
                <div className="stat-card-value">{loading ? "—" : totalLeads.toLocaleString()}</div>
                <div className="stat-card-label">Leads totales subidos</div>
                <span className="stat-card-change stat-card-change--neutral">● leads</span>
              </div>
              <div className="stat-card-ring">
                <Ring pct={totalLeads > 0 ? 65 : 0} color="amber" />
              </div>
            </div>

            {/* LinkedIn */}
            <div className="stat-card">
              <div className="stat-card-left">
                <div className="stat-card-icon stat-card-icon--purple">💼</div>
                <div className="stat-card-value">{loading ? "—" : linkedinPosts}</div>
                <div className="stat-card-label">Posts LinkedIn</div>
                <span className={`stat-card-change ${linkedinStatus?.connected ? "stat-card-change--up" : "stat-card-change--neutral"}`}>
                  {linkedinStatus?.connected ? `● ${linkedinStatus.name?.split(" ")[0] ?? "activo"}` : "● sin conectar"}
                </span>
              </div>
              <div className="stat-card-ring">
                <Ring pct={linkedinStatus?.connected ? Math.min(100, linkedinPosts * 5 + 20) : 0} color="purple" />
              </div>
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
              <div className="dash-module-icon-wrap">📧</div>
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
              <div className="dash-module-icon-wrap">💬</div>
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
              <div className="dash-module-icon-wrap">💼</div>
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
