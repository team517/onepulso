"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Stage = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  order: number;
};

type ClientView = {
  id: string;
  name: string;
  slug: string;
  email?: string;
  project_title?: string;
  contact_name?: string;
  status_message?: string;
  completed_stage_ids: string[];
  current_stage_id?: string;
  updated_at: string;
};

type LinkedUnibox = { id: string; title: string; email: string } | null;

export default function ClientPortalPage() {
  const params = useParams<{ slug: string }>();
  const slug = (params?.slug || "").toLowerCase();

  const [phase, setPhase] = useState<"loading" | "login" | "dashboard">("loading");
  const [data, setData] = useState<{ client: ClientView; stages: Stage[]; percent: number; linked_unibox: LinkedUnibox } | null>(null);

  async function loadMe() {
    try {
      const res = await fetch(`/api/onboarding-client/me?slug=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setPhase("dashboard");
      } else {
        setPhase("login");
      }
    } catch {
      setPhase("login");
    }
  }

  useEffect(() => {
    if (slug) loadMe();
  }, [slug]);

  if (phase === "loading") {
    return (
      <div style={loadingScreen}>
        <div style={{ color: "#64748b", fontSize: 14 }}>Cargando…</div>
      </div>
    );
  }

  if (phase === "login") {
    return <LoginScreen slug={slug} onSuccess={loadMe} />;
  }

  if (!data) return null;
  return <Dashboard slug={slug} data={data} onLogout={() => { setData(null); setPhase("login"); }} onRefresh={loadMe} />;
}

/* ────────────────────  LOGIN  ──────────────────── */

function LoginScreen({ slug, onSuccess }: { slug: string; onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding-client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        onSuccess();
      } else {
        setError(data.error || "Error al iniciar sesión");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Decorative blobs */}
      <div style={{
        position: "fixed", top: "10%", left: "15%", width: 500, height: 500,
        background: "radial-gradient(ellipse at center, rgba(0,113,227,0.08) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />
      <div style={{
        position: "fixed", bottom: "10%", right: "15%", width: 400, height: 400,
        background: "radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56,
            background: "linear-gradient(145deg, #0d2244, #1a3a6e)",
            borderRadius: 16, marginBottom: 20,
            boxShadow: "0 8px 24px rgba(13,34,68,0.25)",
          }}>
            <span style={{ fontSize: 24 }}>⚡</span>
          </div>
          <h1 style={{
            color: "#0f172a", fontSize: 28, fontWeight: 700,
            margin: "0 0 6px", letterSpacing: "-0.04em",
          }}>
            Portal de proyecto
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
            Accede para ver el progreso de tu proyecto
          </p>
        </div>

        <div style={{
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 20,
          padding: "32px 28px",
          boxShadow: "0 4px 24px rgba(15,23,42,0.08)",
        }}>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 18 }}>
              <label style={labelBase}>Usuario</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={inputBase}
                placeholder="tu-usuario"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 26 }}>
              <label style={labelBase}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputBase}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10, padding: "10px 14px",
                color: "#dc2626", fontSize: 13.5, marginBottom: 18,
              }}>{error}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: 12,
              background: loading ? "rgba(0,113,227,0.5)" : "#0071e3",
              border: "none", borderRadius: 12,
              color: "#fff", fontSize: 15, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
            }}>
              {loading ? "Entrando…" : "Acceder"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 28 }}>
          onepulso platform © 2026
        </p>
      </div>
    </div>
  );
}

/* ────────────────────  DASHBOARD  ──────────────────── */

function Dashboard({ slug, data, onLogout, onRefresh }: {
  slug: string;
  data: { client: ClientView; stages: Stage[]; percent: number; linked_unibox: LinkedUnibox };
  onLogout: () => void;
  onRefresh: () => void;
}) {
  const { client, stages, percent, linked_unibox } = data;
  const [ssoState, setSsoState] = useState<"idle" | "loading" | "error">("idle");
  const [ssoError, setSsoError] = useState("");

  async function openUnibox() {
    setSsoState("loading");
    setSsoError("");
    try {
      const res = await fetch("/api/onboarding-client/unibox-sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const d = await res.json();
      if (res.ok && d.uniboxId) {
        // Vinculado → SSO directo a la bandeja
        window.location.href = `/u/${d.uniboxId}/inbox`;
        return;
      }
      // No vinculado todavía → mensaje claro
      setSsoState("error");
      setSsoError(d.error || "Tu bandeja aún no está disponible");
    } catch {
      setSsoState("error");
      setSsoError("Error de conexión");
    }
  }
  const isDone = (id: string) => client.completed_stage_ids.includes(id);
  const isCurrent = (id: string) => client.current_stage_id === id;

  // Refresh cada 30s
  useEffect(() => {
    const t = setInterval(onRefresh, 30_000);
    return () => clearInterval(t);
  }, [onRefresh]);

  async function logout() {
    await fetch("/api/onboarding-client/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    onLogout();
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)",
      fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
      WebkitFontSmoothing: "antialiased",
      padding: "32px 20px 60px",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 32,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 40, height: 40,
              background: "linear-gradient(145deg, #0d2244, #1a3a6e)",
              borderRadius: 12,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 12px rgba(13,34,68,0.2)",
            }}>
              <span style={{ fontSize: 18 }}>⚡</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em" }}>
                onepulso
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>portal de proyecto</div>
            </div>
          </div>
          <button onClick={logout} style={{
            background: "transparent", border: "1px solid rgba(15,23,42,0.12)",
            padding: "7px 14px", borderRadius: 10,
            color: "#475569", fontSize: 12.5, fontWeight: 500,
            cursor: "pointer",
          }}>
            Cerrar sesión
          </button>
        </div>

        {/* Hero card */}
        <div style={{
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 24,
          padding: "36px 32px",
          boxShadow: "0 4px 24px rgba(15,23,42,0.06)",
          marginBottom: 20,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* subtle gradient accent */}
          <div style={{
            position: "absolute", top: 0, right: 0, width: 240, height: 240,
            background: "radial-gradient(circle at center, rgba(0,113,227,0.07) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />

          <div style={{ position: "relative" }}>
            {client.contact_name && (
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
                Hola {client.contact_name} 👋
              </div>
            )}
            <h1 style={{
              margin: "0 0 8px", fontSize: 28, fontWeight: 700,
              color: "#0f172a", letterSpacing: "-0.03em",
            }}>
              {client.project_title || client.name}
            </h1>
            <p style={{ margin: "0 0 28px", color: "#64748b", fontSize: 14.5 }}>
              Este es el estado actual de tu proyecto con onepulso.
            </p>

            {/* Big percent + bar */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <div style={{
                fontSize: 56, fontWeight: 700,
                color: percent === 100 ? "#16a34a" : "#0071e3",
                letterSpacing: "-0.04em", lineHeight: 1,
              }}>
                {percent}<span style={{ fontSize: 28, opacity: 0.6 }}>%</span>
              </div>
              <div style={{ color: "#94a3b8", fontSize: 13 }}>completado</div>
            </div>

            <div style={{
              width: "100%", height: 14,
              background: "rgba(15,23,42,0.06)",
              borderRadius: 999, overflow: "hidden",
            }}>
              <div style={{
                width: `${percent}%`, height: "100%",
                background: percent === 100
                  ? "linear-gradient(90deg, #22c55e, #16a34a)"
                  : "linear-gradient(90deg, #0071e3, #3b82f6, #60a5fa)",
                transition: "width 0.6s cubic-bezier(.4,0,.2,1)",
                boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
              }} />
            </div>

            {client.status_message && (
              <div style={{
                marginTop: 20,
                padding: "12px 16px",
                background: "rgba(0,113,227,0.06)",
                border: "1px solid rgba(0,113,227,0.18)",
                borderRadius: 12,
                color: "#0f172a",
                fontSize: 14,
                lineHeight: 1.55,
              }}>
                💬 {client.status_message}
              </div>
            )}
          </div>
        </div>

        {/* Mi Unibox card — siempre visible */}
        {(() => {
          const isLinked = !!linked_unibox;
          const subtitle = ssoState === "error"
            ? `⚠ ${ssoError}`
            : isLinked
              ? `Accede a tu bandeja unificada — ${linked_unibox!.email}`
              : client.email
                ? `Aún no hay bandeja asignada a ${client.email}. Tu gestor te avisará en cuanto esté lista.`
                : "Pide a tu gestor que vincule tu email para acceder a tu bandeja.";
          return (
            <button
              onClick={openUnibox}
              disabled={ssoState === "loading"}
              style={{
                width: "100%",
                textAlign: "left",
                background: isLinked
                  ? "linear-gradient(145deg, #0d2244 0%, #1a3a6e 60%, #2756a8 100%)"
                  : "linear-gradient(145deg, #1e293b 0%, #334155 100%)",
                border: "none",
                borderRadius: 20,
                padding: "22px 26px",
                boxShadow: isLinked
                  ? "0 8px 28px rgba(13,34,68,0.28)"
                  : "0 4px 16px rgba(30,41,59,0.15)",
                marginBottom: 20,
                cursor: ssoState === "loading" ? "wait" : "pointer",
                color: "#fff",
                fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 18,
                transition: "transform 0.2s ease, box-shadow 0.2s ease",
                position: "relative", overflow: "hidden",
                opacity: isLinked ? 1 : 0.88,
              }}
              onMouseEnter={(e) => {
                if (ssoState !== "loading") {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = isLinked
                    ? "0 12px 32px rgba(13,34,68,0.35)"
                    : "0 8px 24px rgba(30,41,59,0.25)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = isLinked
                  ? "0 8px 28px rgba(13,34,68,0.28)"
                  : "0 4px 16px rgba(30,41,59,0.15)";
              }}
            >
              {/* sparkle accent */}
              <div style={{
                position: "absolute", top: -40, right: -40,
                width: 200, height: 200,
                background: "radial-gradient(circle at center, rgba(255,255,255,0.12), transparent 70%)",
                pointerEvents: "none",
              }} />
              <div style={{
                width: 52, height: 52,
                background: "rgba(255,255,255,0.14)",
                borderRadius: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.2)",
              }}>
                ✉
              </div>
              <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                <div style={{ fontSize: 11.5, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                  Bandeja de correo
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {isLinked ? `Mi Unibox · ${linked_unibox!.title}` : "Mi Unibox"}
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 3 }}>
                  {subtitle}
                </div>
              </div>
              <div style={{
                fontSize: 22, opacity: 0.8,
                flexShrink: 0, paddingRight: 4,
                position: "relative",
              }}>
                {ssoState === "loading" ? "⋯" : isLinked ? "→" : "🔒"}
              </div>
            </button>
          );
        })()}

        {/* Stages timeline */}
        <div style={{
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 20,
          padding: "28px 28px 16px",
          boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
        }}>
          <h2 style={{
            margin: "0 0 22px", fontSize: 16, fontWeight: 700,
            color: "#0f172a", letterSpacing: "-0.01em",
          }}>
            Fases del proyecto
          </h2>

          {stages.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>
              Aún no se han definido las fases del proyecto.
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              {/* Vertical line */}
              <div style={{
                position: "absolute", left: 17, top: 18, bottom: 18,
                width: 2,
                background: "rgba(15,23,42,0.08)",
                zIndex: 0,
              }} />

              {stages.map((s, idx) => {
                const done = isDone(s.id);
                const current = isCurrent(s.id);
                return (
                  <div key={s.id} style={{
                    position: "relative",
                    display: "flex", gap: 16,
                    paddingBottom: idx === stages.length - 1 ? 6 : 22,
                  }}>
                    {/* Dot */}
                    <div style={{
                      width: 36, height: 36,
                      borderRadius: "50%",
                      background: done
                        ? "linear-gradient(145deg, #22c55e, #16a34a)"
                        : current
                          ? "linear-gradient(145deg, #0071e3, #3b82f6)"
                          : "#fff",
                      border: done || current ? "none" : "2px solid rgba(15,23,42,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: done || current ? "#fff" : "#94a3b8",
                      fontSize: 14, fontWeight: 700,
                      flexShrink: 0,
                      zIndex: 1,
                      boxShadow: done
                        ? "0 4px 12px rgba(34,197,94,0.3)"
                        : current
                          ? "0 4px 12px rgba(0,113,227,0.3)"
                          : "none",
                      transition: "all 0.3s ease",
                    }}>
                      {done ? "✓" : current ? (
                        <span style={{
                          width: 10, height: 10, borderRadius: "50%",
                          background: "#fff",
                          animation: "pulse 1.5s ease-in-out infinite",
                        }} />
                      ) : idx + 1}
                    </div>

                    <div style={{ flex: 1, paddingTop: 6 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 600,
                        color: done || current ? "#0f172a" : "#64748b",
                        letterSpacing: "-0.01em",
                      }}>
                        {s.icon && <span style={{ marginRight: 6 }}>{s.icon}</span>}
                        {s.title}
                        {current && (
                          <span style={{
                            marginLeft: 10,
                            display: "inline-block",
                            background: "rgba(0,113,227,0.1)",
                            color: "#0071e3",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                          }}>
                            En curso
                          </span>
                        )}
                        {done && (
                          <span style={{
                            marginLeft: 10,
                            display: "inline-block",
                            background: "rgba(34,197,94,0.1)",
                            color: "#16a34a",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                          }}>
                            Completado
                          </span>
                        )}
                      </div>
                      {s.description && (
                        <div style={{
                          fontSize: 13, color: "#64748b",
                          marginTop: 4, lineHeight: 1.55,
                        }}>
                          {s.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{
          textAlign: "center", marginTop: 24,
          color: "#94a3b8", fontSize: 11.5, letterSpacing: "0.02em",
        }}>
          Actualizado {new Date(client.updated_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })} · onepulso platform © 2026
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(0.75); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────  Styles shared  ──────────────────── */

const loadingScreen: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
};

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.12)",
  borderRadius: 10,
  color: "#0f172a",
  fontSize: 14.5,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelBase: React.CSSProperties = {
  display: "block",
  color: "#64748b",
  fontSize: 11.5,
  fontWeight: 600,
  marginBottom: 7,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};
