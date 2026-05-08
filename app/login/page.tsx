"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState("7");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: parseInt(remember) }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/");
      } else {
        setError(data.error || "Credenciales incorrectas");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  const inputBase: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    background: "#ffffff",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: "10px",
    color: "#0f172a",
    fontSize: "14.5px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    WebkitAppearance: "none",
  };

  const labelBase: React.CSSProperties = {
    display: "block",
    color: "#64748b",
    fontSize: "11.5px",
    fontWeight: 600,
    marginBottom: "7px",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Decorative background blobs */}
      <div style={{
        position: "fixed",
        top: "10%",
        left: "15%",
        width: "500px",
        height: "500px",
        background: "radial-gradient(ellipse at center, rgba(0,113,227,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{
        position: "fixed",
        bottom: "10%",
        right: "15%",
        width: "400px",
        height: "400px",
        background: "radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      <div style={{
        width: "100%",
        maxWidth: "400px",
        padding: "0 24px",
        position: "relative",
        zIndex: 1,
      }}>

        {/* Logo mark */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            background: "linear-gradient(145deg, #0d2244, #1a3a6e)",
            borderRadius: "16px",
            marginBottom: "20px",
            boxShadow: "0 8px 24px rgba(13,34,68,0.25), 0 2px 6px rgba(13,34,68,0.15)",
          }}>
            <span style={{ fontSize: "24px", lineHeight: 1 }}>⚡</span>
          </div>

          <h1 style={{
            color: "#0f172a",
            fontSize: "28px",
            fontWeight: 700,
            margin: "0 0 6px",
            letterSpacing: "-0.04em",
            fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif",
          }}>
            onepulso
          </h1>

          <p style={{
            color: "#64748b",
            fontSize: "14px",
            margin: 0,
            letterSpacing: "0.01em",
          }}>
            Inicia sesión para continuar
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#ffffff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: "20px",
          padding: "32px 28px",
          boxShadow: "0 4px 24px rgba(15,23,42,0.08), 0 1px 4px rgba(15,23,42,0.04)",
        }}>
          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: "18px" }}>
              <label style={labelBase}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="team@onepulso.online"
                required
                style={inputBase}
                onFocus={e => {
                  e.target.style.borderColor = "#0071e3";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(0,113,227,0.12)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(15,23,42,0.12)";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: "18px" }}>
              <label style={labelBase}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputBase}
                onFocus={e => {
                  e.target.style.borderColor = "#0071e3";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(0,113,227,0.12)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(15,23,42,0.12)";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Remember me */}
            <div style={{ marginBottom: "26px" }}>
              <label style={labelBase}>Mantener sesión</label>
              <select
                value={remember}
                onChange={e => setRemember(e.target.value)}
                style={{
                  ...inputBase,
                  cursor: "pointer",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 14px center",
                  paddingRight: "36px",
                }}
              >
                <option value="1">1 día</option>
                <option value="7">7 días</option>
                <option value="30">30 días</option>
                <option value="90">3 meses</option>
              </select>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: "#dc2626",
                fontSize: "13.5px",
                marginBottom: "18px",
                letterSpacing: "0.01em",
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px",
                background: loading ? "rgba(0,113,227,0.5)" : "#0071e3",
                border: "none",
                borderRadius: "12px",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "-0.01em",
                fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
                transition: "background 0.2s ease, box-shadow 0.2s ease",
                boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
              }}
              onMouseEnter={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.background = "#005bb5";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(0,113,227,0.4)";
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.background = "#0071e3";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(0,113,227,0.3)";
                }
              }}
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: "center",
          color: "#94a3b8",
          fontSize: "12px",
          marginTop: "28px",
          letterSpacing: "0.02em",
        }}>
          onepulso platform © 2026
        </p>
      </div>
    </div>
  );
}
