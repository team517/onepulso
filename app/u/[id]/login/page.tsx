"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/unibox-client/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }

      // Redirigir al inbox
      router.push(`/u/${id}/inbox`);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>📧 Unibox</h1>
        <p style={subtitleStyle}>Accede a tu bandeja unificada</p>

        <form onSubmit={handleLogin} style={formStyle}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              style={inputStyle}
              disabled={loading}
              required
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
              disabled={loading}
              required
            />
          </div>

          {error && <div style={errorStyle}>{error}</div>}

          <button
            type="submit"
            style={buttonStyle}
            disabled={loading}
          >
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: "12px",
  padding: "40px",
  width: "100%",
  maxWidth: "400px",
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: "28px",
  fontWeight: "700",
  color: "#0f172a",
};

const subtitleStyle: React.CSSProperties = {
  margin: "0 0 32px",
  fontSize: "14px",
  color: "#64748b",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "600",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  fontSize: "14px",
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 0.2s",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#fee2e2",
  border: "1px solid #fecaca",
  borderRadius: "8px",
  color: "#dc2626",
  fontSize: "13px",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  color: "white",
  border: "none",
  borderRadius: "8px",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
  transition: "opacity 0.2s",
};

