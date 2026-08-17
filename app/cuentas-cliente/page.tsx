"use client";
import { useEffect, useState } from "react";
import DashboardNav from "@/app/components/DashboardNav";

type ClientAccount = {
  id: string;
  email: string;
  name?: string;
  active: boolean;
  created_at: string;
};

export default function CuentasClientePage() {
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/client-accounts").then((r) => r.json());
      setAccounts(r.accounts ?? []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setMsg(null);
    try {
      const r = await fetch("/api/client-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      }).then((r) => r.json());
      if (r.error) {
        setMsg("⚠️ " + r.error);
      } else {
        setMsg("✓ Cliente creado. Dale el email y la contraseña y que entre en /portal");
        setEmail("");
        setName("");
        setPassword("");
        await load();
      }
    } finally {
      setCreating(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  async function toggleActive(a: ClientAccount) {
    await fetch(`/api/client-accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !a.active }),
    });
    await load();
  }

  async function resetPassword(a: ClientAccount) {
    const pw = prompt(`Nueva contraseña para ${a.email} (mín. 6 caracteres):`);
    if (!pw) return;
    const r = await fetch(`/api/client-accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    }).then((r) => r.json());
    setMsg(r.error ? "⚠️ " + r.error : "✓ Contraseña actualizada");
    setTimeout(() => setMsg(null), 5000);
  }

  async function remove(a: ClientAccount) {
    if (!confirm(`¿Eliminar el cliente ${a.email}? Sus seguimientos y personalización quedarán inaccesibles.`)) return;
    await fetch(`/api/client-accounts/${a.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg, #0b0e14)" }}>
      <DashboardNav />
      <main style={{ flex: 1, padding: "32px 28px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 4 }}>
          Cuentas cliente
        </h1>
        <p style={{ color: "var(--text-dim, #94a3b8)", fontSize: 14, marginBottom: 24 }}>
          Crea accesos para tus clientes. Cada cliente entra en <code>/portal</code> y solo ve
          <strong> Seguimientos</strong> y <strong>Personalización</strong>, con sus datos y su
          correo totalmente separados de los tuyos.
        </p>

        {/* Crear */}
        <form
          onSubmit={create}
          style={{
            background: "var(--bg-elev, #131722)",
            border: "1px solid var(--border, #232a3a)",
            borderRadius: 14,
            padding: 18,
            marginBottom: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Email del cliente</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Nombre (opcional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Contraseña</label>
            <input type="text" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6" style={fieldStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: msg?.startsWith("⚠️") ? "#f87171" : "#4ade80" }}>{msg}</span>
            <button
              type="submit"
              disabled={creating}
              style={{ padding: "10px 18px", background: "#4361ee", color: "#fff", border: "none", borderRadius: 9, fontWeight: 700, fontSize: 13.5, cursor: creating ? "default" : "pointer" }}
            >
              {creating ? "Creando…" : "+ Crear cliente"}
            </button>
          </div>
        </form>

        {/* Lista */}
        {loading ? (
          <div style={{ color: "var(--text-dim, #94a3b8)" }}>Cargando…</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: "var(--text-dim, #94a3b8)", fontSize: 14 }}>Aún no hay clientes. Crea el primero arriba.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {accounts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  background: "var(--bg-elev, #131722)",
                  border: "1px solid var(--border, #232a3a)",
                  borderRadius: 12,
                  padding: "13px 16px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {a.name || a.email}
                    {!a.active && <span style={{ marginLeft: 8, fontSize: 11, color: "#f87171", fontWeight: 600 }}>desactivado</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim, #94a3b8)" }}>{a.email}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => toggleActive(a)} style={btnGhost}>{a.active ? "Desactivar" : "Activar"}</button>
                  <button onClick={() => resetPassword(a)} style={btnGhost}>Contraseña</button>
                  <button onClick={() => remove(a)} style={{ ...btnGhost, color: "#f87171" }}>Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--text-dim, #94a3b8)", marginBottom: 5 };
const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  border: "1px solid var(--border, #232a3a)",
  borderRadius: 9,
  background: "var(--bg, #0b0e14)",
  color: "var(--text, #e5e7eb)",
  fontSize: 13.5,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "7px 12px",
  background: "transparent",
  border: "1px solid var(--border, #232a3a)",
  borderRadius: 8,
  color: "var(--text, #e5e7eb)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};
