"use client";

import Link from "next/link";

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export default function Landing() {
  return (
    <div className="landing">
      <button
        onClick={logout}
        style={{
          position: "fixed",
          top: "16px",
          right: "20px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px",
          color: "#9ca3af",
          fontSize: "13px",
          padding: "6px 14px",
          cursor: "pointer",
          zIndex: 100,
          transition: "all 0.2s",
        }}
        onMouseEnter={e => {
          (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
          (e.target as HTMLButtonElement).style.color = "#fff";
        }}
        onMouseLeave={e => {
          (e.target as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
          (e.target as HTMLButtonElement).style.color = "#9ca3af";
        }}
      >
        Cerrar sesión
      </button>
      <div className="landing-brand">
        <span className="brand-wordmark" style={{ fontSize: 56 }}>onepulso</span>
        <span className="brand-c" style={{ fontSize: 18, top: -28 }}>©</span>
      </div>
      <div className="landing-sub">platform</div>

      <div className="landing-grid landing-grid-3">
        <Link href="/campaigns" className="landing-card">
          <div className="landing-card-icon">📧</div>
          <div className="landing-card-title">Automatizar campañas</div>
          <div className="landing-card-desc">
            Generar cold email con memoria, subir leads y crear campañas en Instantly desde un chat.
          </div>
        </Link>

        <Link href="/seguimientos" className="landing-card">
          <div className="landing-card-icon">💬</div>
          <div className="landing-card-title">Seguimientos</div>
          <div className="landing-card-desc">
            Conecta tu Gmail. Envía emails, recibe respuestas, programa follow-ups manuales o por IA.
          </div>
        </Link>

        <Link href="/linkedin" className="landing-card">
          <div className="landing-card-icon">💼</div>
          <div className="landing-card-title">LinkedIn automático</div>
          <div className="landing-card-desc">
            Redactar posts con IA, programarlos y publicarlos en tu cuenta a la fecha y hora elegidas.
          </div>
        </Link>
      </div>
    </div>
  );
}
