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
    padding: "12px 15px",
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "12px",
    color: "#ffffff",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "'DM Sans', -apple-system, 'SF Pro Text', Arial, sans-serif",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
    WebkitAppearance: "none",
  };

  const labelBase: React.CSSProperties = {
    display: "block",
    color: "rgba(255,255,255,0.5)",
    fontSize: "11px",
    fontWeight: 700,
    marginBottom: "7px",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    fontFamily: "'DM Sans', -apple-system, 'SF Pro Text', Arial, sans-serif",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #11047a 0%, #1a237e 40%, #0d1b6e 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', -apple-system, 'SF Pro Text', Arial, sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Decorative glows */}
      <div style={{
        position: "fixed",
        top: "-10%",
        right: "10%",
        width: "600px",
        height: "600px",
        background: "radial-gradient(ellipse at center, rgba(67,97,238,0.35) 0%, transparent 65%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />
      <div style={{
        position: "fixed",
        bottom: "-10%",
        left: "5%",
        width: "500px",
        height: "500px",
        background: "radial-gradient(ellipse at center, rgba(123,97,255,0.2) 0%, transparent 65%)",
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
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "60px",
            height: "60px",
            background: "linear-gradient(135deg, #4361ee 0%, #7b61ff 100%)",
            borderRadius: "18px",
            marginBottom: "20px",
            boxShadow: "0 8px 28px rgba(67,97,238,0.5)",
          }}>
            <span style={{ fontSize: "26px", lineHeight: 1 }}>⚡</span>
          </div>

          <h1 style={{
            color: "#ffffff",
            fontSize: "30px",
            fontWeight: 700,
            margin: "0 0 6px",
            letterSpacing: "-0.03em",
            fontFamily: "'DM Sans', -apple-system, 'SF Pro Display', Arial, sans-serif",
          }}>
            onepulso
          </h1>

          <p style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: "14px",
            margin: 0,
          }}>
            Inicia sesión para continuar
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "24px",
          padding: "34px 30px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
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
                  e.target.style.borderColor = "rgba(67,97,238,0.8)";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(67,97,238,0.25)";
                  e.target.style.background  = "rgba(255,255,255,0.1)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(255,255,255,0.12)";
                  e.target.style.boxShadow   = "none";
                  e.target.style.background  = "rgba(255,255,255,0.07)";
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
                  e.target.style.borderColor = "rgba(67,97,238,0.8)";
                  e.target.style.boxShadow   = "0 0 0 3px rgba(67,97,238,0.25)";
                  e.target.style.background  = "rgba(255,255,255,0.1)";
                }}
                onBlur={e => {
                  e.target.style.borderColor = "rgba(255,255,255,0.12)";
                  e.target.style.boxShadow   = "none";
                  e.target.style.background  = "rgba(255,255,255,0.07)";
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
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(255,255,255,0.5)' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 14px center",
                  paddingRight: "36px",
                  colorScheme: "dark",
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
                background: "rgba(238,93,80,0.12)",
                border: "1px solid rgba(238,93,80,0.3)",
                borderRadius: "12px",
                padding: "10px 14px",
                color: "#fca5a5",
                fontSize: "13.5px",
                marginBottom: "18px",
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
                background: loading ? "rgba(67,97,238,0.5)" : "linear-gradient(135deg, #4361ee 0%, #7b61ff 100%)",
                border: "none",
                borderRadius: "14px",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "-0.01em",
                fontFamily: "'DM Sans', -apple-system, 'SF Pro Text', Arial, sans-serif",
                transition: "all 0.2s ease",
                boxShadow: "0 6px 24px rgba(67,97,238,0.5)",
              }}
              onMouseEnter={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 10px 30px rgba(67,97,238,0.6)";
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 24px rgba(67,97,238,0.5)";
                }
              }}
            >
              {loading ? "Iniciando sesión…" : "Iniciar sesión →"}
            </button>

          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: "center",
          color: "rgba(255,255,255,0.2)",
          fontSize: "12px",
          marginTop: "28px",
          letterSpacing: "0.03em",
        }}>
          onepulso platform © 2026
        </p>
      </div>
    </div>
  );
}
