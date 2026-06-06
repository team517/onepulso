"use client";
import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Inbox CLIENTE — versión limpia y robusta.
 * Funcionalidad: ver cuentas, mensajes, responder, reenviar, eliminar.
 * Reutiliza los mismos endpoints que /u/[id]/inbox.
 */
export default function ClienteInboxPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [me, setMe] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "received" | "sent">("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<any>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // 1) Auth check
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/unibox-client/me", { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        if (!d?.authenticated || d?.uniboxId !== id) {
          router.replace(`/c/${id}/login`);
          return;
        }
        setMe(d);
      } catch {
        if (!cancelled) router.replace(`/c/${id}/login`);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, router]);

  // 2) Cargar cuentas + mensajes cuando hay sesión
  useEffect(() => {
    if (!me) return;
    fetch(`/api/uniboxes/${id}/accounts`).then(r => r.ok ? r.json() : []).then((d) => {
      if (Array.isArray(d)) setAccounts(d);
    }).catch(() => {});
    loadMessages();
  }, [me, id]);

  // 3) Refresh cuando cambia cuenta seleccionada
  useEffect(() => { if (me) loadMessages(); }, [selectedAccountId]);

  // 4) Auto-refresh suave cada 30s
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => {
      if (!document.hidden) loadMessages();
    }, 30_000);
    return () => clearInterval(t);
  }, [me]);

  async function loadMessages() {
    try {
      const p = new URLSearchParams();
      if (selectedAccountId) p.set("account", selectedAccountId);
      p.set("all", "1");
      const r = await fetch(`/api/uniboxes/${id}/messages?${p}`);
      if (r.ok) {
        const d = await r.json();
        setMessages(d.messages || []);
      }
    } catch {}
  }

  async function syncAll() {
    setLoading(true);
    try {
      await fetch(`/api/uniboxes/${id}/sync-all`, { method: "POST" });
      await loadMessages();
    } catch {}
    setLoading(false);
  }

  async function logout() {
    await fetch("/api/unibox-client/logout", { method: "POST" }).catch(() => {});
    router.replace(`/c/${id}/login`);
  }

  async function deleteMessage(accountId: string, uid: number) {
    if (!confirm("¿Eliminar este mensaje de la bandeja?")) return;
    setMessages(prev => prev.filter(m => !(m.accountId === accountId && m.uid === uid)));
    if (selectedMsg && selectedMsg.uid === uid && selectedMsg.accountId === accountId) {
      setSelectedMsg(null);
    }
    try {
      await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}`, { method: "DELETE" });
    } catch {}
  }

  function replyTo(m: any) {
    const subj = /^re:\s*/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
    const fromAddr = (m.fromAddress || (m.from || "").match(/<([^>]+)>/)?.[1] || m.from || "").trim();
    const quote = `<br><br><div style="border-left:3px solid #cbd5e1;padding-left:10px;color:#475569;font-size:13px">
      <div><strong>${escapeHtml(m.from || "")}</strong> · ${escapeHtml(new Date(m.date).toLocaleString("es"))}</div>
      <div style="margin-top:6px">${escapeHtml(m.preview || "")}</div>
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: fromAddr,
      subject: subj,
      body: quote,
      inReplyTo: m.messageId,
      references: (m.references || []).join(" "),
    });
    setComposeOpen(true);
  }

  function forwardMsg(m: any) {
    const subj = /^fwd?:\s*/i.test(m.subject || "") ? m.subject : `Fwd: ${m.subject || ""}`;
    const fwdBlock = `<br><br><div style="border-top:1px solid #ddd;padding-top:10px;color:#475569;font-size:13px">
      <div><strong>---------- Mensaje reenviado ----------</strong></div>
      <div><strong>De:</strong> ${escapeHtml(m.from || "")}</div>
      <div><strong>Fecha:</strong> ${escapeHtml(new Date(m.date).toLocaleString("es"))}</div>
      <div><strong>Asunto:</strong> ${escapeHtml(m.subject || "")}</div>
      <div style="margin-top:10px">${escapeHtml(m.preview || "")}</div>
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: "",
      subject: subj,
      body: fwdBlock,
    });
    setComposeOpen(true);
  }

  function newCompose() {
    setComposeData({
      accountId: accounts[0]?.id || "",
      to: "",
      subject: "",
      body: "",
    });
    setComposeOpen(true);
  }

  const myEmails = useMemo(
    () => new Set(accounts.map(a => (a.email || "").toLowerCase())),
    [accounts]
  );
  const isOutbound = (m: any) => {
    if (typeof m.uid === "number" && m.uid < 0) return true;
    const fa = (m.fromAddress || m.from || "").toLowerCase();
    if (fa && myEmails.has(fa)) return true;
    const match = (m.from || "").match(/<([^>]+)>/);
    if (match && myEmails.has(match[1].toLowerCase())) return true;
    return false;
  };

  const filtered = useMemo(() => {
    let list = messages;
    if (filter === "received") list = list.filter(m => !isOutbound(m));
    else if (filter === "sent") list = list.filter(isOutbound);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        (m.from || "").toLowerCase().includes(q) ||
        (m.subject || "").toLowerCase().includes(q) ||
        (m.preview || "").toLowerCase().includes(q)
      );
    }
    return list.slice(0, 300);
  }, [messages, filter, search, accounts]);

  if (authChecking) {
    return (
      <div style={loadingScreen}>
        <div style={spinner} />
        <div style={{ marginTop: 14, color: "#64748b", fontSize: 14 }}>Cargando…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div style={appShell}>
      <aside style={sidebar}>
        <div style={brandRow}>
          <div style={logoBox}>✉</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{me.title || "Unibox"}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{me.clientEmail}</div>
          </div>
        </div>

        <button style={composeBtn} onClick={newCompose}>+ Redactar</button>

        <div style={sectionTitle}>FILTROS</div>
        <button
          style={{ ...folderBtn, ...(filter === "all" ? folderActive : {}) }}
          onClick={() => setFilter("all")}
        >📥 Todos · {messages.length}</button>
        <button
          style={{ ...folderBtn, ...(filter === "received" ? folderActive : {}) }}
          onClick={() => setFilter("received")}
        >📨 Recibidos</button>
        <button
          style={{ ...folderBtn, ...(filter === "sent" ? folderActive : {}) }}
          onClick={() => setFilter("sent")}
        >📤 Enviados</button>

        <div style={sectionTitle}>BANDEJAS</div>
        <div style={accountList}>
          <button
            style={{ ...accountBtn, ...(selectedAccountId === null ? accountActive : {}) }}
            onClick={() => setSelectedAccountId(null)}
          >
            <div style={{ fontWeight: 600 }}>Todas las cuentas</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{accounts.length} buzones</div>
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              style={{ ...accountBtn, ...(selectedAccountId === a.id ? accountActive : {}) }}
              onClick={() => setSelectedAccountId(a.id)}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{[a.first_name, a.last_name].filter(Boolean).join(" ") || a.imap_host}</div>
            </button>
          ))}
        </div>

        <button style={ghostBtn} onClick={syncAll} disabled={loading}>
          {loading ? "Sincronizando…" : "↻ Sincronizar"}
        </button>
        <button style={{ ...ghostBtn, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <section style={listPane}>
        <div style={toolbar}>
          <input
            type="text"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
          />
        </div>
        <div style={messagesList}>
          {filtered.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <div>No hay mensajes</div>
              <button onClick={syncAll} style={{ ...ghostBtn, marginTop: 14, display: "inline-block", width: "auto", padding: "8px 16px" }}>↻ Sincronizar ahora</button>
            </div>
          ) : (
            filtered.map((m) => {
              const isSelected = selectedMsg && selectedMsg.uid === m.uid && selectedMsg.accountId === m.accountId;
              const outbound = isOutbound(m);
              return (
                <div
                  key={`${m.accountId}-${m.uid}`}
                  onClick={() => setSelectedMsg(m)}
                  style={{ ...msgItem, ...(isSelected ? msgItemActive : {}) }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                      {outbound ? `→ ${m.to || ""}` : (m.fromName || m.from || "")}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, marginLeft: 8 }}>
                      {fmtDate(m.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#334155", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.subject || "(sin asunto)"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(m.preview || "").substring(0, 120)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section style={detailPane}>
        {!selectedMsg ? (
          <div style={emptyDetail}>
            <div style={{ fontSize: 56, opacity: 0.3, marginBottom: 14 }}>✉</div>
            <div style={{ fontSize: 15, color: "#94a3b8" }}>Selecciona un mensaje</div>
          </div>
        ) : (
          <MessageDetail
            m={selectedMsg}
            uniboxId={id}
            onReply={() => replyTo(selectedMsg)}
            onForward={() => forwardMsg(selectedMsg)}
            onDelete={() => deleteMessage(selectedMsg.accountId, selectedMsg.uid)}
          />
        )}
      </section>

      {composeOpen && (
        <ComposeModal
          uniboxId={id}
          accounts={accounts}
          initial={composeData}
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); loadMessages(); }}
        />
      )}
    </div>
  );
}

function MessageDetail({ m, uniboxId, onReply, onForward, onDelete }: any) {
  const [full, setFull] = useState<any>(null);

  useEffect(() => {
    setFull(null);
    fetch(`/api/uniboxes/${uniboxId}/messages/${m.accountId}/${m.uid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setFull(d))
      .catch(() => {});
  }, [m.accountId, m.uid, uniboxId]);

  return (
    <div style={detailContent}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a", flex: 1, minWidth: 200 }}>
          {m.subject || "(sin asunto)"}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onReply} style={actionBtn}>↩ Responder</button>
          <button onClick={onForward} style={actionBtnSecondary}>↪ Reenviar</button>
          <button onClick={onDelete} style={{ ...actionBtnSecondary, color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }}>🗑</button>
        </div>
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
        <div><strong>De:</strong> {m.from || m.fromAddress}</div>
        {m.to && <div style={{ marginTop: 3 }}><strong>Para:</strong> {m.to}</div>}
        <div style={{ marginTop: 3, color: "#64748b" }}>{new Date(m.date).toLocaleString("es")}</div>
      </div>

      {!full ? (
        <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>Cargando contenido…</div>
      ) : full.html ? (
        <div dangerouslySetInnerHTML={{ __html: full.html }} style={{ lineHeight: 1.55, fontSize: 14, color: "#0f172a" }} />
      ) : (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#0f172a", lineHeight: 1.55, margin: 0 }}>
          {full.text || m.preview || "(sin contenido)"}
        </pre>
      )}
    </div>
  );
}

function ComposeModal({ uniboxId, accounts, initial, onClose, onSent }: any) {
  const [accountId, setAccountId] = useState(initial.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(initial.to || "");
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!to.trim()) { setError("Falta destinatario"); return; }
    setSending(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("accountId", accountId);
      fd.append("to", to);
      fd.append("subject", subject);
      fd.append("body", body);
      if (initial.inReplyTo) fd.append("inReplyTo", initial.inReplyTo);
      if (initial.references) fd.append("references", initial.references);
      const r = await fetch(`/api/uniboxes/${uniboxId}/send`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Error enviando");
      onSent();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{initial.inReplyTo ? "Responder" : "Nuevo mensaje"}</div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          <label style={composeLabel}>De</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={composeInput}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <label style={composeLabel}>Para</label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="destinatario@empresa.com"
            style={composeInput}
          />

          <label style={composeLabel}>Asunto</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Asunto del email"
            style={composeInput}
          />

          <label style={composeLabel}>Mensaje</label>
          <div
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
            dangerouslySetInnerHTML={{ __html: body }}
            style={{ ...composeInput, minHeight: 200, padding: 12, outline: "none" }}
          />

          {error && <div style={errorBox}>{error}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={cancelBtn}>Cancelar</button>
          <button onClick={send} disabled={sending} style={sendBtn}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function fmtDate(d: string): string {
  if (!d) return "";
  const date = new Date(d);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

const appShell: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "240px 360px 1fr", height: "100vh",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  background: "#fff", color: "#0f172a",
};
const sidebar: React.CSSProperties = {
  background: "#f8fafc", borderRight: "1px solid #e2e8f0",
  padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10, overflow: "hidden",
};
const brandRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "0 4px 8px",
  borderBottom: "1px solid #e2e8f0", marginBottom: 4,
};
const logoBox: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "linear-gradient(145deg, #6366f1, #818cf8)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 17, color: "#fff",
};
const composeBtn: React.CSSProperties = {
  padding: "10px 12px", background: "#0071e3", color: "#fff",
  border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: "#94a3b8",
  letterSpacing: "0.05em", textTransform: "uppercase", padding: "12px 6px 4px",
};
const folderBtn: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", background: "transparent", border: 0,
  borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#334155", fontFamily: "inherit",
};
const folderActive: React.CSSProperties = {
  background: "rgba(99,102,241,0.1)", color: "#4f46e5", fontWeight: 700,
};
const accountList: React.CSSProperties = {
  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2,
};
const accountBtn: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", background: "transparent", border: 0,
  borderRadius: 8, cursor: "pointer", fontFamily: "inherit", color: "#334155",
};
const accountActive: React.CSSProperties = {
  background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)",
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 12px", background: "#fff", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 12.5, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const listPane: React.CSSProperties = {
  borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden",
};
const toolbar: React.CSSProperties = { padding: "12px 14px", borderBottom: "1px solid #e2e8f0" };
const searchInput: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8,
  fontSize: 13.5, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const messagesList: React.CSSProperties = {
  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
};
const msgItem: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
};
const msgItemActive: React.CSSProperties = { background: "rgba(99,102,241,0.08)" };
const emptyState: React.CSSProperties = {
  padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13.5,
};
const detailPane: React.CSSProperties = { overflow: "auto", background: "#fff" };
const emptyDetail: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", textAlign: "center",
};
const detailContent: React.CSSProperties = { padding: "28px 32px", maxWidth: 900 };
const actionBtn: React.CSSProperties = {
  padding: "7px 14px", background: "#0071e3", color: "#fff", border: 0,
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const actionBtnSecondary: React.CSSProperties = {
  padding: "7px 14px", background: "#fff", border: "1px solid #cbd5e1", color: "#475569",
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const loadingScreen: React.CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", background: "#fafbfc",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
};
const spinner: React.CSSProperties = {
  width: 28, height: 28, border: "3px solid #e2e8f0",
  borderTopColor: "#0071e3", borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
};
const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalCard: React.CSSProperties = {
  background: "#fff", borderRadius: 14, width: "100%", maxWidth: 600,
  margin: 20, overflow: "hidden", boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
};
const modalHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 20px", borderBottom: "1px solid #e2e8f0",
};
const closeBtn: React.CSSProperties = {
  background: 0, border: 0, fontSize: 18, cursor: "pointer", color: "#64748b",
};
const modalFooter: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px",
  borderTop: "1px solid #e2e8f0", background: "#f8fafc",
};
const cancelBtn: React.CSSProperties = {
  padding: "8px 16px", background: "#fff", border: "1px solid #cbd5e1",
  borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#475569",
};
const sendBtn: React.CSSProperties = {
  padding: "8px 20px", background: "#0071e3", color: "#fff", border: 0,
  borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const composeLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#64748b",
  letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 14, marginBottom: 5,
};
const composeInput: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 13.5, outline: "none", fontFamily: "inherit",
  boxSizing: "border-box", background: "#fff",
};
const errorBox: React.CSSProperties = {
  marginTop: 14, padding: "10px 14px", background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8,
  color: "#dc2626", fontSize: 13,
};
