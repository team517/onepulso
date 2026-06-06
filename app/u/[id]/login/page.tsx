"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ClientUniboxLoginPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [uniboxTitle, setUniboxTitle] = useState<string>("");

  // Si ya está autenticado para esta unibox, saltar al inbox.
  useEffect(() => {
    fetch("/api/unibox-client/me").then(r => r.json()).then((d) => {
      if (d.authenticated && d.uniboxId === id) router.push(`/u/${id}/inbox`);
    }).catch(() => {});
  }, [id, router]);

  // Intentar resolver el nombre del unibox para mostrarlo
  useEffect(() => {
    fetch(`/api/uniboxes/${id}/public-info`).then(r => r.ok ? r.json() : null).then((d) => {
      if (d?.title) setUniboxTitle(d.title);
    }).catch(() => {});
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/unibox-client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, uniboxId: id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Credenciales incorrectas");
      router.push(`/u/${id}/inbox`);
    } catch (e: any) {
      setError(e.message);
      // Pequeña vibración del card
      const card = document.getElementById("login-card");
      if (card) {
        card.style.animation = "shake 0.4s";
        setTimeout(() => { card.style.animation = ""; }, 400);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style jsx global>{`
        @keyframes float-blob-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -30px) scale(1.1); }
        }
        @keyframes float-blob-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 40px) scale(1.05); }
        }
        @keyframes float-blob-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, 30px) scale(0.95); }
        }
        @keyframes fade-up {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        button[type="submit"]:hover:not(:disabled) {
          transform: translateY(-1px);
          background-position: 100% 0%;
          box-shadow: 0 14px 36px -6px rgba(209,92,254,0.55), inset 0 -2px 0 rgba(0,0,0,0.06);
        }
        button[type="submit"]:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>

      <div style={pageBg}>
        {/* Blobs animados de fondo */}
        <div style={{ ...blob, top: "-10%", left: "-10%", width: 600, height: 600, background: "radial-gradient(circle, rgba(249,166,3,0.25), transparent 70%)", animation: "float-blob-1 18s ease-in-out infinite" }} />
        <div style={{ ...blob, bottom: "-15%", right: "-10%", width: 700, height: 700, background: "radial-gradient(circle, rgba(209,92,254,0.22), transparent 70%)", animation: "float-blob-2 22s ease-in-out infinite" }} />
        <div style={{ ...blob, top: "30%", right: "20%", width: 400, height: 400, background: "radial-gradient(circle, rgba(99,102,241,0.18), transparent 70%)", animation: "float-blob-3 25s ease-in-out infinite" }} />

        {/* Grid pattern overlay sutil */}
        <div style={gridOverlay} />

        <div style={contentWrapper}>
          {/* Branding header */}
          <div style={{ textAlign: "center", marginBottom: 36, animation: "fade-up 0.6s ease-out" }}>
            <div style={logoMark}>
              <span style={{ position: "relative", zIndex: 1 }}>✉</span>
            </div>
            <h1 style={brandTitle}>onepulso</h1>
            <div style={brandSubtitle}>
              <span style={{ background: "linear-gradient(90deg, #f9a603, #d15cfe, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", backgroundSize: "200% 100%", animation: "gradient-shift 4s ease-in-out infinite", fontWeight: 700 }}>
                Unibox
              </span>
              {" · "}Tu bandeja unificada
            </div>
          </div>

          {/* Login card */}
          <div id="login-card" style={cardStyle}>
            {uniboxTitle && (
              <div style={uniboxBadge}>
                <span style={{ ...statusDot, animation: "pulse-dot 2s ease-in-out infinite" }} />
                {uniboxTitle}
              </div>
            )}

            <h2 style={cardTitle}>Iniciar sesión</h2>
            <p style={cardSubtitle}>Accede a tu unibox de campañas</p>

            <form onSubmit={handleSubmit} autoComplete="on">
              <label style={labelStyle} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@empresa.com"
                required
                autoComplete="email"
                autoFocus
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(209,92,254,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(209,92,254,0.12)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(15,23,42,0.12)"; e.currentTarget.style.boxShadow = "none"; }}
              />

              <label style={{ ...labelStyle, marginTop: 18 }} htmlFor="password">Contraseña</label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: 44 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(209,92,254,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(209,92,254,0.12)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(15,23,42,0.12)"; e.currentTarget.style.boxShadow = "none"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  style={eyeButton}
                  tabIndex={-1}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>

              {error && (
                <div style={errorBox}>
                  <span style={{ fontSize: 14 }}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" disabled={loading} style={{ ...submitStyle, opacity: loading ? 0.7 : 1, cursor: loading ? "default" : "pointer" }}>
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={spinner} />
                    Verificando…
                  </span>
                ) : (
                  <>Iniciar sesión <span style={{ fontSize: 14, marginLeft: 4 }}>→</span></>
                )}
              </button>
            </form>

            <div style={hintBox}>
              <strong>¿No tienes acceso?</strong> Contacta con tu administrador de onepulso para que te genere las credenciales.
            </div>
          </div>

          {/* Footer */}
          <div style={footerStyle}>
            <span style={{ opacity: 0.55 }}>Powered by</span>
            <span style={{ background: "linear-gradient(90deg, #f9a603, #d15cfe)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontWeight: 700, marginLeft: 4 }}>
              onepulso platform
            </span>
            <span style={{ opacity: 0.4, marginLeft: 8 }}>· © 2026</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTILOS
// ─────────────────────────────────────────────────────────────────────────────

const pageBg: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(145deg, #fafbfc 0%, #f4f1ff 50%, #fff5e8 100%)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  position: "relative",
  overflow: "hidden",
  padding: "40px 20px",
};

const blob: React.CSSProperties = {
  position: "absolute",
  borderRadius: "50%",
  filter: "blur(60px)",
  pointerEvents: "none",
  willChange: "transform",
};

const gridOverlay: React.CSSProperties = {
  position: "absolute", inset: 0,
  backgroundImage: "linear-gradient(rgba(15,23,42,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.025) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
  pointerEvents: "none",
  maskImage: "radial-gradient(ellipse 60% 70% at 50% 40%, black 50%, transparent 100%)",
  WebkitMaskImage: "radial-gradient(ellipse 60% 70% at 50% 40%, black 50%, transparent 100%)",
};

const contentWrapper: React.CSSProperties = {
  width: "100%", maxWidth: 430,
  position: "relative", zIndex: 1,
};

const logoMark: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 64, height: 64, borderRadius: 18,
  background: "linear-gradient(145deg, #f9a603, #d15cfe)",
  marginBottom: 18, fontSize: 28, color: "white",
  boxShadow: "0 16px 40px rgba(209,92,254,0.35), inset 0 -2px 0 rgba(255,255,255,0.18)",
  position: "relative",
};

const brandTitle: React.CSSProperties = {
  color: "#0f172a", fontSize: 32, fontWeight: 800,
  margin: "0 0 8px", letterSpacing: "-0.04em",
  fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
};

const brandSubtitle: React.CSSProperties = {
  color: "#64748b", fontSize: 14.5, margin: 0,
  letterSpacing: "-0.005em",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.85)",
  border: "1px solid rgba(255,255,255,0.6)",
  borderRadius: 22, padding: "36px 32px 28px",
  boxShadow: "0 24px 64px -16px rgba(15,23,42,0.15), 0 6px 24px -6px rgba(209,92,254,0.08)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  animation: "fade-up 0.7s ease-out 0.1s backwards",
};

const uniboxBadge: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "5px 12px 5px 10px",
  background: "linear-gradient(135deg, rgba(249,166,3,0.10), rgba(209,92,254,0.10))",
  border: "1px solid rgba(209,92,254,0.18)",
  borderRadius: 99,
  fontSize: 11.5, fontWeight: 700, color: "#9a3fc7",
  letterSpacing: "-0.005em",
  marginBottom: 16,
  textTransform: "uppercase",
};

const statusDot: React.CSSProperties = {
  display: "inline-block",
  width: 7, height: 7, borderRadius: "50%",
  background: "#10b981",
};

const cardTitle: React.CSSProperties = {
  color: "#0f172a", fontSize: 22, fontWeight: 700,
  margin: "0 0 4px", letterSpacing: "-0.02em",
};

const cardSubtitle: React.CSSProperties = {
  color: "#64748b", fontSize: 13.5, margin: "0 0 24px",
};

const labelStyle: React.CSSProperties = {
  display: "block", color: "#475569", fontSize: 11.5, fontWeight: 700,
  marginBottom: 7, letterSpacing: "0.04em", textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", background: "#fff",
  border: "1px solid rgba(15,23,42,0.12)", borderRadius: 11,
  color: "#0f172a", fontSize: 14.5, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const eyeButton: React.CSSProperties = {
  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
  background: "transparent", border: "none", cursor: "pointer",
  fontSize: 15, padding: 8, lineHeight: 1, color: "#64748b",
  borderRadius: 8,
};

const errorBox: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.10))",
  border: "1px solid rgba(239,68,68,0.25)",
  borderRadius: 11, padding: "11px 14px",
  color: "#b91c1c", fontSize: 13.5, fontWeight: 500,
  marginTop: 14,
  display: "flex", alignItems: "flex-start", gap: 8,
};

const submitStyle: React.CSSProperties = {
  width: "100%", padding: "13px 16px", marginTop: 22,
  background: "linear-gradient(135deg, #f9a603, #d15cfe)",
  backgroundSize: "200% 100%",
  border: "none", borderRadius: 12,
  color: "#fff", fontSize: 15, fontWeight: 700,
  letterSpacing: "-0.01em",
  boxShadow: "0 10px 28px -6px rgba(209,92,254,0.45), inset 0 -2px 0 rgba(0,0,0,0.06)",
  fontFamily: "inherit",
  transition: "transform 0.1s, box-shadow 0.15s, background-position 0.3s",
};

const spinner: React.CSSProperties = {
  display: "inline-block",
  width: 14, height: 14,
  border: "2px solid rgba(255,255,255,0.35)",
  borderTopColor: "#fff",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const hintBox: React.CSSProperties = {
  marginTop: 20,
  padding: "11px 14px",
  background: "rgba(15,23,42,0.025)",
  border: "1px solid rgba(15,23,42,0.06)",
  borderRadius: 10,
  fontSize: 12, color: "#64748b", lineHeight: 1.55,
};

const footerStyle: React.CSSProperties = {
  textAlign: "center", color: "#94a3b8", fontSize: 12,
  marginTop: 32, fontWeight: 500,
  animation: "fade-up 0.8s ease-out 0.3s backwards",
};
