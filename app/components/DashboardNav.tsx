"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/",              label: "Inicio",        icon: "🏠", exact: true },
  { href: "/campaigns",    label: "Campañas",      icon: "✉️", exact: false },
  { href: "/seguimientos", label: "Seguimientos",  icon: "💬", exact: false },
  { href: "/linkedin",     label: "LinkedIn",      icon: "💼", exact: false },
];

export default function DashboardNav() {
  const path = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="dash-nav">
      {/* Brand */}
      <div className="dash-nav-brand">
        <div className="dash-nav-logo">
          <span className="dash-nav-logo-mark">⚡</span>
        </div>
        <div>
          <div className="dash-brand-word">onepulso<span className="dash-brand-c">©</span></div>
          <div className="dash-brand-tagline">platform</div>
        </div>
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
  );
}
