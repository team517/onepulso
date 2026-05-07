"use client";

import Link from "next/link";

export default function Landing() {
  return (
    <div className="landing">
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
