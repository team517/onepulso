"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DashboardNav from "../../components/DashboardNav";

export default function UniboxAdminDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [unibox, setUnibox] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // CSV upload
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadView, setUploadView] = useState<"idle" | "loading" | "stream" | "done">("idle");
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [streamLog, setStreamLog] = useState<{ email: string; phase: string; message: string }[]>([]);
  const [streamProgress, setStreamProgress] = useState({ index: 0, total: 0, ok: 0, fail: 0 });

  // Filter / sort
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error" | "pending">("all");

  async function load() {
    setLoading(true);
    const [uRes, aRes] = await Promise.all([
      fetch(`/api/uniboxes/${id}`),
      fetch(`/api/uniboxes/${id}/accounts`),
    ]);
    if (uRes.ok) setUnibox(await uRes.json());
    if (aRes.ok) setAccounts(await aRes.json());
    setLoading(false);
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function uploadCsv(file: File) {
    setUploadView("loading");
    setUploadResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`/api/uniboxes/${id}/accounts/upload-csv`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error");
      setUploadResult(data);
      await load();
      if (data.new_ids && data.new_ids.length) {
        connectStream(data.new_ids);
      } else {
        setUploadView("done");
      }
    } catch (e: any) {
      alert("Error: " + e.message);
      setUploadView("idle");
    }
  }

  function connectStream(ids: string[]) {
    setUploadView("stream");
    setStreamLog([]);
    setStreamProgress({ index: 0, total: ids.length, ok: 0, fail: 0 });

    const es = new EventSource(`/api/uniboxes/${id}/sync-stream?ids=${encodeURIComponent(ids.join(","))}`);
    es.addEventListener("progress", (e: any) => {
      const d = JSON.parse(e.data);
      setStreamProgress((p) => ({
        ...p,
        index: d.index,
        ok: p.ok + (d.phase === "ok" ? 1 : 0),
        fail: p.fail + (d.phase === "error" ? 1 : 0),
      }));
      setStreamLog((log) => [...log, { email: d.email, phase: d.phase, message: d.message }]);
    });
    es.addEventListener("done", () => {
      es.close();
      setUploadView("done");
      load();
    });
    es.onerror = () => { es.close(); setUploadView("done"); };
  }

  async function syncAll() {
    const ids = accounts.map((a: any) => a.id);
    connectStream(ids);
  }

  async function syncOne(accountId: string) {
    connectStream([accountId]);
  }

  async function deleteAccount(accountId: string, email: string) {
    if (!confirm(`¿Eliminar la cuenta "${email}"? Se borrarán sus mensajes sincronizados.`)) return;
    try {
      const r = await fetch(`/api/uniboxes/${id}/accounts/${accountId}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert("Error: " + (j.error || `HTTP ${r.status}`));
        return;
      }
      await load();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  // Filtrar cuentas
  const filteredAccounts = accounts.filter((a) => {
    if (filter) {
      const q = filter.toLowerCase();
      const fullName = `${a.first_name || ""} ${a.last_name || ""}`.toLowerCase();
      const matches =
        a.email?.toLowerCase().includes(q) ||
        fullName.includes(q) ||
        a.imap_host?.toLowerCase().includes(q) ||
        a.smtp_host?.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (statusFilter === "ok" && !a.last_sync) return false;
    if (statusFilter === "ok" && a.last_error) return false;
    if (statusFilter === "error" && !a.last_error) return false;
    if (statusFilter === "pending" && (a.last_sync || a.last_error)) return false;
    return true;
  });

  // Conteos por estado
  const counts = {
    all: accounts.length,
    ok: accounts.filter((a) => a.last_sync && !a.last_error).length,
    error: accounts.filter((a) => a.last_error).length,
    pending: accounts.filter((a) => !a.last_sync && !a.last_error).length,
  };

  if (loading) return (<div className="dash-shell"><DashboardNav /><div className="dash-content" style={mainStyle}>Cargando…</div></div>);
  if (!unibox) return (<div className="dash-shell"><DashboardNav /><div className="dash-content" style={mainStyle}>Unibox no encontrada</div></div>);

  const clientUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/u/${id}/login`;

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={mainStyle}>
        <Link href="/uniboxes" style={backStyle}>← Volver</Link>
        <div style={headerStyle}>
          <div>
            <h1 style={h1Style}>{unibox.title}</h1>
            <div style={subStyle}>
              Cliente: <code style={codeStyle}>{unibox.client_email}</code> ·
              URL acceso: <a href={clientUrl} target="_blank" rel="noreferrer" style={{ color: "#0071e3" }}>{clientUrl}</a>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnGhost} onClick={() => fileInput.current?.click()}>+ Subir CSV de cuentas</button>
            <button style={btnPrimary} onClick={syncAll} disabled={accounts.length === 0}>Sincronizar todo</button>
          </div>
          <input ref={fileInput} type="file" accept=".csv" hidden
            onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
        </div>

        {/* Stats */}
        <div style={statsRow}>
          <div style={statCard}>
            <div style={statLabel}>Cuentas</div>
            <div style={statValue}>{accounts.length}</div>
          </div>
          <div style={statCard}>
            <div style={statLabel}>Última sync</div>
            <div style={{ ...statValue, fontSize: 14 }}>
              {unibox.last_sync ? new Date(unibox.last_sync).toLocaleString("es") : "Nunca"}
            </div>
          </div>
          <div style={statCard}>
            <div style={statLabel}>Filtro warmup</div>
            <div style={{ ...statValue, color: unibox.warmup_filter ? "#10b981" : "#94a3b8", fontSize: 14 }}>
              {unibox.warmup_filter ? "Activo" : "Desactivado"}
            </div>
          </div>
        </div>

        {/* Upload progress views */}
        {uploadView === "loading" && (
          <div style={progCard}>
            <div style={spinnerStyle}></div>
            <div style={{ fontWeight: 600, marginTop: 12 }}>Procesando CSV…</div>
          </div>
        )}

        {uploadView === "stream" && (
          <div style={progCard}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              Conectando cuentas {streamProgress.index} / {streamProgress.total}
            </div>
            <div style={{ ...progBar, marginBottom: 12 }}>
              <div style={{ ...progFill, width: `${(streamProgress.index / Math.max(streamProgress.total, 1)) * 100}%` }} />
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 12, marginBottom: 12 }}>
              <span style={{ color: "#10b981" }}>✓ {streamProgress.ok} conectadas</span>
              <span style={{ color: "#dc2626" }}>✗ {streamProgress.fail} fallidas</span>
            </div>
            <div style={logStyle}>
              {streamLog.slice(-50).map((l, i) => (
                <div key={i} style={{ color: l.phase === "ok" ? "#10b981" : l.phase === "error" ? "#dc2626" : "#64748b" }}>
                  <b>{l.email}</b> · {l.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {uploadView === "done" && uploadResult && (
          <div style={successCard}>
            <b>✓ {uploadResult.added} cuenta(s) añadida(s)</b> ·
            {uploadResult.skipped_dup || 0} duplicada(s) · {uploadResult.skipped_err || 0} con error
            <button style={{ ...btnGhost, marginLeft: 12 }} onClick={() => setUploadView("idle")}>Cerrar</button>
          </div>
        )}

        {/* Accounts list */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 32, marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <h2 style={h2Style}>Cuentas <span style={{ color: "#94a3b8", fontWeight: 500 }}>· {accounts.length}</span></h2>
          {accounts.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="🔎 Buscar email, nombre, host…"
                style={{
                  padding: "8px 12px", border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 8, fontSize: 12.5, outline: "none",
                  width: 240, fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <FilterChip label={`Todas`} count={counts.all} active={statusFilter === "all"} color="#0071e3" onClick={() => setStatusFilter("all")} />
                <FilterChip label="OK" count={counts.ok} active={statusFilter === "ok"} color="#10b981" onClick={() => setStatusFilter("ok")} />
                <FilterChip label="Error" count={counts.error} active={statusFilter === "error"} color="#dc2626" onClick={() => setStatusFilter("error")} />
                <FilterChip label="Sin sync" count={counts.pending} active={statusFilter === "pending"} color="#94a3b8" onClick={() => setStatusFilter("pending")} />
              </div>
            </div>
          )}
        </div>

        {accounts.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ marginBottom: 12 }}>Aún no hay cuentas en esta unibox.</div>
            <button style={btnPrimary} onClick={() => fileInput.current?.click()}>Subir CSV</button>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div style={emptyStyle}>
            Sin resultados para tu filtro. <button style={{ ...btnGhost, marginLeft: 8 }} onClick={() => { setFilter(""); setStatusFilter("all"); }}>Limpiar</button>
          </div>
        ) : (
          <div style={tableCard}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Nombre</th>
                  <th style={thStyle}>Servidores</th>
                  <th style={{ ...thStyle, width: 130 }}>Estado</th>
                  <th style={{ ...thStyle, width: 140 }}>Última sync</th>
                  <th style={{ ...thStyle, width: 110, textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((a) => {
                  const status: "ok" | "error" | "pending" = a.last_error
                    ? "error"
                    : a.last_sync
                    ? "ok"
                    : "pending";
                  return (
                    <tr key={a.id} className="ub-row">
                      <td style={tdStyle}>
                        <code style={{
                          background: "rgba(0,113,227,0.06)", color: "#0071e3",
                          padding: "3px 9px", borderRadius: 6,
                          fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
                          fontWeight: 600,
                        }}>{a.email}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 13 }}>
                          {[a.first_name, a.last_name].filter(Boolean).join(" ") || <span style={{ color: "#cbd5e1" }}>—</span>}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                          <div title="IMAP (recepción)"><span style={{ color: "#94a3b8" }}>↓</span> {a.imap_host}:{a.imap_port}</div>
                          <div title="SMTP (envío)"><span style={{ color: "#94a3b8" }}>↑</span> {a.smtp_host}:{a.smtp_port}</div>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <StatusPill status={status} error={a.last_error} />
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "#64748b" }}>
                        {a.last_sync ? (
                          <span title={new Date(a.last_sync).toLocaleString("es")}>
                            {fmtRelative(a.last_sync)}
                          </span>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>nunca</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4 }}>
                          <button
                            onClick={() => syncOne(a.id)}
                            title="Sincronizar esta cuenta"
                            style={{
                              padding: "5px 8px",
                              background: "transparent",
                              border: "1px solid rgba(15,23,42,0.1)",
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: "pointer",
                              color: "#475569",
                            }}
                          >↻</button>
                          <button
                            onClick={() => deleteAccount(a.id, a.email)}
                            title="Eliminar cuenta"
                            style={{
                              padding: "5px 8px",
                              background: "transparent",
                              border: "1px solid rgba(220,38,38,0.18)",
                              borderRadius: 6,
                              fontSize: 12,
                              cursor: "pointer",
                              color: "#dc2626",
                            }}
                          >🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 28 }}>
          <Link href={`/u/${id}/inbox`} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>
            Abrir bandeja del cliente →
          </Link>
        </div>

        <style jsx>{`
          .ub-row { border-bottom: 1px solid rgba(15,23,42,0.04); transition: background 0.12s; }
          .ub-row:hover { background: #f8fafc; }
          .ub-row:last-child { border-bottom: none; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "5px 11px",
        background: active ? color : "transparent",
        color: active ? "#fff" : "#64748b",
        border: `1px solid ${active ? color : "rgba(15,23,42,0.12)"}`,
        borderRadius: 99, fontSize: 11.5, fontWeight: 600,
        cursor: "pointer", fontFamily: "inherit",
        transition: "all 0.15s",
      }}
    >
      {label}
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 18, height: 16, padding: "0 5px",
        background: active ? "rgba(255,255,255,0.22)" : "#f1f5f9",
        color: active ? "#fff" : "#475569",
        fontSize: 10.5, fontWeight: 700, borderRadius: 99,
      }}>{count}</span>
    </button>
  );
}

function StatusPill({ status, error }: { status: "ok" | "error" | "pending"; error?: string }) {
  if (status === "ok") {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 99,
        background: "rgba(16,185,129,0.1)", color: "#047857",
        fontSize: 11, fontWeight: 700,
      }}>● Conectada</span>
    );
  }
  if (status === "error") {
    return (
      <span
        title={error}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 9px", borderRadius: 99,
          background: "rgba(220,38,38,0.1)", color: "#b91c1c",
          fontSize: 11, fontWeight: 700, maxWidth: 120,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >⚠ {(error || "Error").slice(0, 18)}</span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 99,
      background: "#f1f5f9", color: "#64748b",
      fontSize: 11, fontWeight: 600,
    }}>○ Sin sincronizar</span>
  );
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d}d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

// ---------- styles ----------
const mainStyle: React.CSSProperties = {
  padding: "32px 40px",
  overflowY: "auto",
  fontFamily: "inherit",
};
const backStyle: React.CSSProperties = {
  color: "#0071e3", fontSize: 13, textDecoration: "none", display: "inline-block", marginBottom: 14,
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginBottom: 28,
};
const h1Style: React.CSSProperties = { margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" };
const h2Style: React.CSSProperties = { margin: "32px 0 12px", fontSize: 16, fontWeight: 600, color: "#0f172a" };
const subStyle: React.CSSProperties = { fontSize: 13, color: "#64748b" };
const codeStyle: React.CSSProperties = {
  background: "#f1f5f9", padding: "2px 8px", borderRadius: 5,
  fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
};
const statsRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 };
const statCard: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 12, padding: "14px 18px",
};
const statLabel: React.CSSProperties = { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 };
const statValue: React.CSSProperties = { fontSize: 24, fontWeight: 700, marginTop: 4, color: "#0f172a" };

const btnPrimary: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  background: "#fff", color: "#0f172a", border: "1px solid rgba(15,23,42,0.12)",
  padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer",
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: "center", color: "#94a3b8",
  background: "#fff", borderRadius: 12, border: "1px dashed rgba(15,23,42,0.12)",
};

const tableCard: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 12, overflow: "hidden",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "11px 14px", background: "#f8fafc",
  fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em",
  fontWeight: 600, borderBottom: "1px solid rgba(15,23,42,0.06)",
};
const trStyle: React.CSSProperties = { borderBottom: "1px solid rgba(15,23,42,0.04)" };
const tdStyle: React.CSSProperties = { padding: "11px 14px", verticalAlign: "middle" };

const progCard: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 12, padding: 20, marginBottom: 20,
};
const progBar: React.CSSProperties = {
  height: 6, background: "#f1f5f9", borderRadius: 4, overflow: "hidden",
};
const progFill: React.CSSProperties = {
  height: "100%", background: "linear-gradient(90deg, #6366f1, #818cf8)", transition: "width 0.3s",
};
const logStyle: React.CSSProperties = {
  background: "#0f172a", color: "#cbd5e1", padding: 12, borderRadius: 8,
  fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, maxHeight: 220, overflow: "auto",
};
const spinnerStyle: React.CSSProperties = {
  width: 32, height: 32, margin: "0 auto",
  border: "3px solid #e2e8f0", borderTopColor: "#0071e3", borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};
const successCard: React.CSSProperties = {
  background: "#ecfdf5", border: "1px solid rgba(16,185,129,0.3)",
  padding: "14px 18px", borderRadius: 10, marginBottom: 20, fontSize: 13,
};
