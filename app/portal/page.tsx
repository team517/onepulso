"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ClientPortalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/client-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/seguimientos");
      } else {
        setError(data.error || "Credenciales incorrectas");
      }
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafbfc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        padding: "32px 20px",
      }}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: "-0.04em",
              color: "#0a0d14",
            }}
          >
            onepulso
            <span style={{ display: "inline-flex", gap: 3, marginLeft: 6, marginTop: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#848689" }} />
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0a0d14" }} />
            </span>
          </div>
          <h1
            style={{
              margin: "16px 0 6px",
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: "-0.03em",
              color: "#0a0d14",
            }}
          >
            Acceso cliente
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>
            Entra para gestionar tus seguimientos y personalización.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: "#fff",
            border: "1px solid #eceef1",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 12px 40px rgba(15,23,42,0.06)",
          }}
        >
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            placeholder="tucorreo@empresa.com"
            style={inputStyle}
          />
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", margin: "16px 0 6px" }}>
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            style={inputStyle}
          />

          {error && (
            <div
              style={{
                marginTop: 14,
                padding: "9px 12px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 9,
                fontSize: 12.5,
                color: "#b91c1c",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 18,
              padding: "12px 16px",
              background: loading ? "#9ca3af" : "#0a0d14",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14.5,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 18, fontSize: 12.5, color: "#9ca3af" }}>
          ¿Eres el administrador? <a href="/login" style={{ color: "#6b7280", fontWeight: 600 }}>Entra por aquí</a>
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  fontSize: 14,
  color: "#0a0d14",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
