"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardNav from "../components/DashboardNav";

type Unibox = {
  id: string;
  title: string;
  client_email: string;
  warmup_filter: boolean;
  created_at: string;
  last_sync?: string | null;
};

export default function UniboxesAdminPage() {
  const [items, setItems] = useState<Unibox[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ url: string; email: string; password: string } | null>(null);

  // form state
  const [title, setTitle] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPassword, setClientPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/uniboxes");
    if (r.ok) setItems(await r.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function genPwd() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let p = "";
    for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setClientPassword(p);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const r = await fetch("/api/uniboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, client_email: clientEmail, client_password: clientPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error");
      setCreatedInfo({
        url: `${window.location.origin}/u/${data.id}/login`,
        email: clientEmail,
        password: clientPassword,
      });
      setShowCreate(false);
      setTitle(""); setClientEmail(""); setClientPassword("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`¿Eliminar la unibox "${title}" con todas sus cuentas y mensajes?`)) return;
    await fetch(`/api/uniboxes/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <>
      <DashboardNav />
      <main style={mainStyle}>
        <div style={headerStyle}>
          <div>
            <h1 style={h1Style}>Unibox</h1>
            <p style={subStyle}>Portales de bandeja unificada para tus clientes</p>
          </div>
          <button style={btnPrimary} onClick={() => setShowCreate(true)}>
            + Crear unibox
          </button>
        </div>

        {createdInfo && (
          <div style={successCard}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>✓ Unibox creada</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Envía estos datos al cliente:</div>
            <div style={kvRow}><b>URL</b><code style={codeStyle}>{createdInfo.url}</code></div>
            <div style={kvRow}><b>Email</b><code style={codeStyle}>{createdInfo.email}</code></div>
            <div style={kvRow}><b>Contraseña</b><code style={codeStyle}>{createdInfo.password}</code></div>
            <button style={btnGhost} onClick={() => setCreatedInfo(null)}>Cerrar</button>
          </div>
        )}

        {loading ? (
          <div style={emptyStyle}>Cargando…</div>
        ) : items.length === 0 ? (
          <div style={emptyStyle}>Aún no hay uniboxes. Crea la primera.</div>
        ) : (
          <div style={gridStyle}>
            {items.map((u) => (
              <Link key={u.id} href={`/uniboxes/${u.id}`} style={cardStyle}>
                <div style={cardHeadStyle}>
                  <div>
                    <div style={cardTitleStyle}>{u.title}</div>
                    <div style={cardEmailStyle}>{u.client_email}</div>
                  </div>
                  <span style={{ fontSize: 22 }}>✉</span>
                </div>
                <div style={cardMetaStyle}>
                  <span>Creada {new Date(u.created_at).toLocaleDateString("es")}</span>
                  {u.warmup_filter && <span style={chipStyle}>Filtro warmup</span>}
                </div>
                <button
                  style={btnDanger}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(u.id, u.title); }}
                >
                  Eliminar
                </button>
              </Link>
            ))}
          </div>
        )}

        {showCreate && (
          <div style={modalBg} onClick={() => setShowCreate(false)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Nueva unibox</h2>
              <form onSubmit={handleCreate}>
                <label style={labelStyle}>Título / Nombre del cliente</label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Cliente ACME" required />

                <label style={labelStyle}>Email de acceso del cliente</label>
                <input style={inputStyle} type="email" value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="cliente@empresa.com" required />

                <label style={labelStyle}>Contraseña</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={clientPassword}
                    onChange={(e) => setClientPassword(e.target.value)}
                    placeholder="••••••••" required minLength={6} />
                  <button type="button" style={btnGhost} onClick={genPwd}>Generar</button>
                </div>

                {error && <div style={errorBox}>{error}</div>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                  <button type="button" style={btnGhost} onClick={() => setShowCreate(false)}>Cancelar</button>
                  <button type="submit" style={btnPrimary} disabled={creating}>
                    {creating ? "Creando…" : "Crear unibox"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

// ---------- inline styles (Apple-ish, matches login look) ----------
const mainStyle: React.CSSProperties = {
  marginLeft: 240, padding: "40px 48px", minHeight: "100vh",
  background: "linear-gradient(145deg, #f5f7fb 0%, #ffffff 100%)",
  fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28,
};
const h1Style: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" };
const subStyle: React.CSSProperties = { margin: "4px 0 0", color: "#64748b", fontSize: 14 };

const gridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16,
};
const cardStyle: React.CSSProperties = {
  display: "block", textDecoration: "none", color: "#0f172a",
  background: "#fff", border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 14, padding: 18,
  boxShadow: "0 2px 8px rgba(15,23,42,0.04)", transition: "all 0.2s",
};
const cardHeadStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12,
};
const cardTitleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 16, marginBottom: 2 };
const cardEmailStyle: React.CSSProperties = { fontSize: 12, color: "#64748b" };
const cardMetaStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", display: "flex", gap: 8, alignItems: "center", marginBottom: 12,
};
const chipStyle: React.CSSProperties = {
  background: "rgba(99,102,241,0.1)", color: "#6366f1",
  padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600,
};

const btnPrimary: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600,
  cursor: "pointer", letterSpacing: "-0.01em",
};
const btnGhost: React.CSSProperties = {
  background: "#fff", color: "#0f172a", border: "1px solid rgba(15,23,42,0.12)",
  padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  background: "transparent", color: "#dc2626", border: "1px solid rgba(220,38,38,0.2)",
  padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  padding: 60, textAlign: "center", color: "#94a3b8",
  background: "#fff", borderRadius: 14, border: "1px dashed rgba(15,23,42,0.08)",
};

const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
  display: "grid", placeItems: "center", zIndex: 1000, backdropFilter: "blur(4px)",
};
const modalCard: React.CSSProperties = {
  background: "#fff", borderRadius: 16, padding: 28, width: "90%", maxWidth: 460,
  boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#64748b",
  textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid rgba(15,23,42,0.12)",
  borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};
const errorBox: React.CSSProperties = {
  marginTop: 14, padding: "10px 14px", background: "rgba(239,68,68,0.06)",
  border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#dc2626", fontSize: 13,
};

const successCard: React.CSSProperties = {
  background: "#ecfdf5", border: "1px solid rgba(16,185,129,0.3)",
  padding: 18, borderRadius: 12, marginBottom: 20,
};
const kvRow: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", margin: "6px 0", fontSize: 13,
};
const codeStyle: React.CSSProperties = {
  background: "#fff", padding: "4px 10px", borderRadius: 6,
  fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
  border: "1px solid rgba(15,23,42,0.08)", userSelect: "all",
};
