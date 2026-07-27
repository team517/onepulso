"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const NAV = [
  { href: "/",              label: "Inicio",        icon: "⊞", exact: true },
  { href: "/campaigns",    label: "Campañas",      icon: "✦", exact: false },
  { href: "/personalizacion", label: "Personalización", icon: "✺", exact: false },
  { href: "/clientes",     label: "Clientes",      icon: "◑", exact: false },
  { href: "/seguimientos", label: "Seguimientos",  icon: "◈", exact: false },
  { href: "/onboarding",   label: "Onboarding",    icon: "◉", exact: false },
  { href: "/estudios",     label: "Estudios",      icon: "◬", exact: false },
  { href: "/uniboxes",     label: "Unibox",        icon: "✉", exact: false },
  { href: "/tareas",       label: "Tareas",        icon: "✓", exact: false },
  { href: "/notas",        label: "Notas",         icon: "✎", exact: false },
  { href: "/documentos",   label: "Documentos",    icon: "▤", exact: false },
  { href: "/gastos",       label: "Gastos",        icon: "€", exact: false },
  { href: "/linkedin",     label: "LinkedIn",      icon: "◆", exact: false },
  { href: "/facturacion",  label: "Facturación",   icon: "◇", exact: false },
];

export default function DashboardNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Cerrar drawer al cambiar de ruta
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Lock body scroll cuando el drawer está abierto en móvil
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const activeItem = NAV.find((item) =>
    item.exact ? path === item.href : path.startsWith(item.href)
  );

  return (
    <>
      {/* Topbar móvil: hamburguesa + título del módulo actual (solo visible <768px) */}
      <div className="dash-mobile-topbar">
        <button
          onClick={() => setOpen(true)}
          className="dash-mobile-burger"
          aria-label="Abrir menú"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div className="dash-mobile-brand">
          <div className="dash-mobile-brand-logo">O</div>
          <div className="dash-mobile-brand-title">
            {activeItem?.label || "onepulso"}
          </div>
        </div>
      </div>

      {/* Overlay para cerrar el drawer en móvil */}
      {open && <div className="dash-nav-scrim" onClick={() => setOpen(false)} />}

      <nav className={`dash-nav ${open ? "is-open" : ""}`}>
        {/* Brand */}
        <div className="dash-nav-brand">
          <div className="dash-nav-logo">
            <span className="dash-nav-logo-mark" style={{ fontFamily: "var(--font-sans)" }}>O</span>
          </div>
          <div>
            <div className="dash-brand-word">onepulso<span className="dash-brand-c">©</span></div>
            <div className="dash-brand-tagline">platform</div>
          </div>
          {/* Cerrar (solo móvil) */}
          <button
            onClick={() => setOpen(false)}
            className="dash-nav-close"
            aria-label="Cerrar menú"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </div>

        {/* Nav links */}
        <div className="dash-nav-links">
          <div className="dash-section-label">MÓDULOS</div>
          {NAV.map(item => {
            const active = item.exact
              ? path === item.href
              : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-nav-item ${active ? "dash-nav-item--active" : ""}`}
              >
                <span className="dash-nav-icon">{item.icon}</span>
                <span className="dash-nav-label">{item.label}</span>
                {active && <span className="dash-nav-active-dot" />}
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <div className="dash-nav-foot">
          <div className="dash-nav-user">
            <div className="dash-nav-avatar">T</div>
            <div className="dash-nav-user-info">
              <div className="dash-nav-user-name">team</div>
              <div className="dash-nav-user-email">onepulso.online</div>
            </div>
          </div>
          <button className="dash-nav-item dash-nav-item--logout" onClick={logout}>
            <span className="dash-nav-icon" style={{ fontSize: 14 }}>⟵</span>
            <span className="dash-nav-label">Cerrar sesión</span>
          </button>
        </div>
      </nav>
    </>
  );
}
