"use client";

import Link from "next/link";

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export default function Landing() {
  return (
    <div className="landing">
      {/* Logout */}
      <button
        onClick={logout}
        style={{
          position: "fixed",
          top: "18px",
          right: "22px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          color: "#636366",
          fontSize: "13px",
          fontWeight: 400,
          padding: "7px 16px",
          cursor: "pointer",
          zIndex: 100,
          transition: "all 0.2s ease",
          fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
          letterSpacing: "0.01em",
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
          (e.target as HTMLButtonElement).style.color = "#f5f5f7";
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
          (e.target as HTMLButtonElement).style.color = "#636366";
        }}
      >
        Cerrar sesión
      </button>

      {/* Brand */}
      <div className="landing-brand">
        <span className="brand-wordmark" style={{ fontSize: 52 }}>onepulso</span>
        <span className="brand-c" style={{ fontSize: 11, top: -24 }}>©</span>
      </div>
      <div className="landing-sub">platform</div>

      {/* Cards */}
      <div className="landing-grid landing-grid-3">
        <Link href="/campaigns" className="landing-card">
          <div className="landing-card-icon">📧</div>
          <div className="landing-card-title">Automatizar campañas</div>
          <div className="landing-card-desc">
            Genera cold emails con memoria, sube leads y crea campañas en Instantly desde un chat.
          </div>
        </Link>

        <Link href="/seguimientos" className="landing-card">
          <div className="landing-card-icon">💬</div>
          <div className="landing-card-title">Seguimientos</div>
          <div className="landing-card-desc">
            Conecta tu Gmail. Envía emails, recibe respuestas y programa follow-ups manuales o por IA.
          </div>
        </Link>

        <Link href="/linkedin" className="landing-card">
          <div className="landing-card-icon">💼</div>
          <div className="landing-card-title">LinkedIn automático</div>
          <div className="landing-card-desc">
            Redacta posts con IA, prográmalos y publícalos en tu cuenta a la fecha y hora elegidas.
          </div>
        </Link>
      </div>
    </div>
  );
}
