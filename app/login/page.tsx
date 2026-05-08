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
    padding: "12px 14px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "10px",
    color: "#f5f5f7",
    fontSize: "15px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
    WebkitAppearance: "none",
  };

  const labelBase: React.CSSProperties = {
    display: "block",
    color: "#98989d",
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "7px",
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Subtle glow */}
      <div style={{
        position: "fixed",
        top: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "700px",
        height: "500px",
        background: "radial-gradient(ellipse at center, rgba(0,113,227,0.06) 0%, transparent 70%)",
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
        <div style={{ textAlign: "center", marginBottom: "44px" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "52px",
            height: "52px",
            background: "linear-gradient(145deg, #1a1a1a, #0d0d0d)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "14px",
            marginBottom: "20px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}>
            <span style={{ fontSize: "22px", lineHeight: 1 }}>⚡</span>
          </div>

          <h1 style={{
            color: "#f5f5f7",
            fontSize: "28px",
            fontWeight: 700,
            margin: "0 0 6px",
            letterSpacing: "-0.04em",
            fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif",
          }}>
            onepulso
          </h1>

          <p style={{
            color: "#636366",
            fontSize: "14px",
            margin: 0,
            letterSpacing: "0.01em",
          }}>
            Inicia sesión para continuar
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "20px",
          padding: "32px 28px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}>
          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelBase}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="team@onepulso.online"
                required
                style={inputBase}
                onFocus={e => {
                  e.target.style.borderColor = "rgba(0,113,227,0.6)";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(0,113,227,0.1)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(255,255,255,0.1)";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelBase}>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputBase}
                onFocus={e => {
                  e.target.style.borderColor = "rgba(0,113,227,0.6)";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(0,113,227,0.1)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(255,255,255,0.1)";
                  e.target.style.boxShadow   = "none";
                }}
              />
            </div>

            {/* Remember me */}
            <div style={{ marginBottom: "28px" }}>
              <label style={labelBase}>Mantener sesión</label>
              <select
                value={remember}
                onChange={e => setRemember(e.target.value)}
                style={{
                  ...inputBase,
                  cursor: "pointer",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2398989d' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 14px center",
                  paddingRight: "36px",
                }}
              >
                <option value="1"  style={{ background: "#111" }}>1 día</option>
                <option value="7"  style={{ background: "#111" }}>7 días</option>
                <option value="30" style={{ background: "#111" }}>30 días</option>
                <option value="90" style={{ background: "#111" }}>3 meses</option>
              </select>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: "rgba(255,69,58,0.08)",
                border: "1px solid rgba(255,69,58,0.2)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: "#ff6961",
                fontSize: "13.5px",
                marginBottom: "20px",
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
                padding: "13px",
                background: loading ? "rgba(0,113,227,0.5)" : "#0071e3",
                border: "none",
                borderRadius: "12px",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "-0.01em",
                fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
                transition: "background 0.2s ease, transform 0.15s ease",
                transform: "translateY(0)",
              }}
              onMouseEnter={e => {
                if (!loading) (e.target as HTMLButtonElement).style.background = "#0077ed";
              }}
              onMouseLeave={e => {
                if (!loading) (e.target as HTMLButtonElement).style.background = "#0071e3";
              }}
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: "center",
          color: "#3a3a3c",
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
