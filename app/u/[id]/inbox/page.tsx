"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

export default function InboxPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/unibox-client/me", {
          cache: "no-store",
        });

        if (!res.ok) {
          router.push(`/u/${id}/login`);
          return;
        }

        const data = await res.json();
        if (!data.authenticated) {
          router.push(`/u/${id}/login`);
          return;
        }

        setUser(data);
      } catch (err: any) {
        setError(err.message || "Error loading user");
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      checkAuth();
    }
  }, [id, router]);

  async function handleLogout() {
    await fetch("/api/unibox-client/logout", { method: "POST" });
    router.push(`/u/${id}/login`);
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingStyle}>Cargando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={errorBoxStyle}>
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()} style={buttonStyle}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>📧 {user.title}</h1>
          <p style={emailStyle}>{user.email}</p>
        </div>
        <button onClick={handleLogout} style={logoutButtonStyle}>
          Cerrar sesión
        </button>
      </div>

      <div style={contentStyle}>
        <div style={inboxStyle}>
          <h2 style={sectionTitleStyle}>Bandeja de entrada</h2>
          <div style={emptyStateStyle}>
            <p>📭 No hay mensajes</p>
            <p style={emptySubtitleStyle}>Tu bandeja está vacía</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const headerStyle: React.CSSProperties = {
  background: "white",
  borderBottom: "1px solid #e2e8f0",
  padding: "20px 32px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const titleStyle: React.CSSProperties = {
  margin: "0",
  fontSize: "24px",
  fontWeight: "700",
  color: "#0f172a",
};

const emailStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: "13px",
  color: "#64748b",
};

const contentStyle: React.CSSProperties = {
  padding: "32px",
  maxWidth: "1200px",
  margin: "0 auto",
};

const inboxStyle: React.CSSProperties = {
  background: "white",
  borderRadius: "12px",
  padding: "24px",
  border: "1px solid #e2e8f0",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: "0 0 20px",
  fontSize: "18px",
  fontWeight: "600",
  color: "#0f172a",
};

const emptyStateStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "60px 20px",
  color: "#94a3b8",
};

const emptySubtitleStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: "13px",
  color: "#cbd5e1",
};

const loadingStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  fontSize: "16px",
  color: "#64748b",
};

const errorBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "100vh",
  padding: "20px",
  textAlign: "center",
  color: "#dc2626",
};

const logoutButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#ef4444",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: "600",
  cursor: "pointer",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "#667eea",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: "600",
  cursor: "pointer",
  marginTop: "16px",
};

