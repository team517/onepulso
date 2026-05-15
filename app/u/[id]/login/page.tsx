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

  // If already authenticated for this unibox, jump straight to inbox
  useEffect(() => {
    fetch("/api/unibox-client/me").then(r => r.json()).then((d) => {
      if (d.authenticated && d.uniboxId === id) router.push(`/u/${id}/inbox`);
    });
  }, [id, router]);

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={pageBg}>
      <div style={{ position: "fixed", top: "10%", left: "15%", width: 500, height: 500, background: "radial-gradient(ellipse at center, rgba(0,113,227,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "10%", right: "15%", width: 400, height: 400, background: "radial-gradient(ellipse at center, rgba(99,102,241,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={logoMark}>✉</div>
          <h1 style={brandStyle}>Unibox</h1>
          <p style={taglineStyle}>Tu bandeja unificada</p>
        </div>

        <div style={cardStyle}>
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@empresa.com" required style={inputStyle} />

            <label style={{ ...labelStyle, marginTop: 16 }}>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" required style={inputStyle} />

            {error && <div style={errorBox}>{error}</div>}

            <button type="submit" disabled={loading} style={{ ...submitStyle, marginTop: 22 }}>
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>
          </form>
        </div>

        <p style={footerStyle}>Powered by onepulso · © 2026</p>
      </div>
    </div>
  );
}

const pageBg: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
};
const logoMark: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 56, height: 56, borderRadius: 16,
  background: "linear-gradient(145deg, #6366f1, #818cf8)",
  marginBottom: 20, fontSize: 24, color: "white",
  boxShadow: "0 8px 24px rgba(99,102,241,0.3)",
};
const brandStyle: React.CSSProperties = {
  color: "#0f172a", fontSize: 28, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.04em",
};
const taglineStyle: React.CSSProperties = { color: "#64748b", fontSize: 14, margin: 0 };
const cardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 20, padding: "32px 28px",
  boxShadow: "0 4px 24px rgba(15,23,42,0.08)",
};
const labelStyle: React.CSSProperties = {
  display: "block", color: "#64748b", fontSize: 11.5, fontWeight: 600,
  marginBottom: 7, letterSpacing: "0.05em", textTransform: "uppercase",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", background: "#fff",
  border: "1px solid rgba(15,23,42,0.12)", borderRadius: 10,
  color: "#0f172a", fontSize: 14.5, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};
const errorBox: React.CSSProperties = {
  background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
  borderRadius: 10, padding: "10px 14px", color: "#dc2626", fontSize: 13.5,
  marginTop: 14,
};
const submitStyle: React.CSSProperties = {
  width: "100%", padding: 12,
  background: "#0071e3", border: "none", borderRadius: 12,
  color: "#fff", fontSize: 15, fontWeight: 600,
  cursor: "pointer", letterSpacing: "-0.01em",
  boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
  fontFamily: "inherit",
};
const footerStyle: React.CSSProperties = {
  textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 28,
};
