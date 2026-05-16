"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

type Msg = any;
type Account = any;

export default function ClientInboxPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [me, setMe] = useState<any>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [warmupCount, setWarmupCount] = useState(0);
  const [showWarmup, setShowWarmup] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<any>({});
  const [syncing, setSyncing] = useState(false);

  // Init
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/unibox-client/me");
      const d = await r.json();
      if (!d.authenticated || d.uniboxId !== id) {
        router.push(`/u/${id}/login`);
        return;
      }
      setMe(d);
      await Promise.all([loadAccounts(), loadMessages()]);
    })();
  }, [id]);

  async function loadAccounts() {
    const r = await fetch(`/api/uniboxes/${id}/accounts`);
    if (r.ok) setAccounts(await r.json());
  }

  async function loadMessages() {
    const p = new URLSearchParams();
    if (selectedAccount) p.set("account", selectedAccount);
    if (showWarmup) p.set("show_warmup", "1");
    const r = await fetch(`/api/uniboxes/${id}/messages?${p}`);
    if (r.ok) {
      const d = await r.json();
      setMessages(d.messages || []);
      setWarmupCount(d.warmupCount || 0);
    }
  }

  useEffect(() => { if (me) loadMessages(); }, [selectedAccount, showWarmup]);

  // Auto-refresh every 45s (solo recarga caché — el sync IMAP corre en backend)
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => loadMessages(), 45_000);
    return () => clearInterval(t);
  }, [me, selectedAccount, showWarmup]);

  // Sync IMAP completo cada 2 min mientras el usuario tenga la página abierta.
  // Es ADEMÁS del scheduler de backend (que también sincroniza cada 2 min).
  useEffect(() => {
    if (!me || accounts.length === 0) return;
    const doSync = async () => {
      try {
        await fetch(`/api/uniboxes/${id}/sync-all`, { method: "POST" });
        await loadMessages();
      } catch {}
    };
    // Lanzar uno al cargar (3s después para no bloquear primer paint)
    const initial = setTimeout(doSync, 3000);
    // Y cada 2 min mientras esté abierta
    const interval = setInterval(doSync, 2 * 60_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, accounts.length, id]);

  async function openMessage(accountId: string, uid: number) {
    const r = await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}`);
    if (r.ok) {
      const m = await r.json();
      setSelectedMsg({ ...m, accountId });
    }
  }

  async function logout() {
    await fetch("/api/unibox-client/logout", { method: "POST" });
    router.push(`/u/${id}/login`);
  }

  async function syncAll() {
    if (accounts.length === 0) return;
    setSyncing(true);
    const ids = accounts.map(a => a.id).join(",");
    const es = new EventSource(`/api/uniboxes/${id}/sync-stream?ids=${ids}`);
    es.addEventListener("done", async () => {
      es.close();
      setSyncing(false);
      await loadMessages();
    });
    es.onerror = () => { es.close(); setSyncing(false); };
  }

  async function clearAllMessages() {
    if (!confirm("¿Eliminar TODOS los mensajes de la bandeja?\n\nLas cuentas IMAP permanecen conectadas. Si quieres recuperar los mensajes válidos, pulsa luego 'Sincronizar todo'.")) return;
    try {
      const r = await fetch(`/api/uniboxes/${id}/messages?mode=all`, { method: "DELETE" }).then((r) => r.json());
      if (r.ok) {
        await loadMessages();
      } else {
        alert("Error: " + (r.error || "desconocido"));
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  function replyTo(m: any) {
    const replyAddr = m.fromAddress || m.from || "";
    const subj = /^re:/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
    const dateStr = new Date(m.date).toLocaleString("es");
    const quoted = `<br><br><div style="border-left:3px solid #ccc;padding-left:10px;color:#666;margin-top:14px">
      <div style="font-size:12px;color:#888">El ${dateStr}, ${m.from || ""} escribió:</div>
      <br>${m.html || (m.text || "").replace(/\n/g, "<br>")}
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: replyAddr,
      subject: subj,
      body: quoted,
      inReplyTo: m.messageId,
      references: (m.references || []).join(" "),
    });
    setComposeOpen(true);
  }

  function newCompose() {
    setComposeData({
      accountId: accounts[0]?.id || "",
      to: "", subject: "", body: "",
    });
    setComposeOpen(true);
  }

  if (!me) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Cargando…</div>;

  const filtered = search
    ? messages.filter(m =>
        (m.from || "").toLowerCase().includes(search.toLowerCase()) ||
        (m.subject || "").toLowerCase().includes(search.toLowerCase()) ||
        (m.preview || "").toLowerCase().includes(search.toLowerCase()))
    : messages;

  // Build thread for selected msg
  const normSubj = (s: string) => (s || "").replace(/^\s*(re|fwd|rv|fw)\s*:\s*/gi, "").trim().toLowerCase();
  const thread = selectedMsg
    ? messages.filter(x => {
        if (x.accountId !== selectedMsg.accountId) return false;
        if (x.uid === selectedMsg.uid) return false;
        if (selectedMsg.messageId && (x.inReplyTo === selectedMsg.messageId || (x.references || []).includes(selectedMsg.messageId))) return true;
        if (normSubj(x.subject) === normSubj(selectedMsg.subject) && normSubj(selectedMsg.subject)) return true;
        return false;
      }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : [];

  return (
    <div style={appStyle}>
      <aside style={sidebarStyle}>
        <div style={brandRow}>
          <div style={logoMark}>✉</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{me.title}</div>
            <div style={{ fontSize: 11, color: "#8b94a7" }}>{me.clientEmail}</div>
          </div>
        </div>

        <button style={composeBtn} onClick={newCompose}>+ Redactar</button>

        <div style={sectionTitle}>BANDEJAS</div>
        <div style={accountList}>
          <div
            style={{ ...accountItem, ...(selectedAccount === null ? activeAccount : {}) }}
            onClick={() => setSelectedAccount(null)}
          >
            <div style={dotStyle}></div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={accountEmail}>Todas las cuentas</div>
              <div style={accountHost}>{accounts.length} buzones</div>
            </div>
          </div>
          {accounts.map(a => (
            <div key={a.id}
              style={{ ...accountItem, ...(selectedAccount === a.id ? activeAccount : {}) }}
              onClick={() => setSelectedAccount(a.id)}
            >
              <div style={{ ...dotStyle, background: a.last_error ? "#ef4444" : "#10b981" }} title={a.last_error || "OK"}></div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={accountEmail}>{a.email}</div>
                <div style={accountHost}>{[a.first_name, a.last_name].filter(Boolean).join(" ") || a.imap_host}</div>
              </div>
            </div>
          ))}
        </div>

        <button style={ghostBtn} onClick={syncAll} disabled={syncing}>
          {syncing ? "Sincronizando…" : "↻ Sincronizar todo"}
        </button>
        <button style={{ ...ghostBtn, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <section style={listPaneStyle}>
        <div style={toolbarStyle}>
          <input
            type="text"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchStyle}
          />
          {warmupCount > 0 && (
            <button style={linkBtn} onClick={() => setShowWarmup(!showWarmup)}>
              {showWarmup ? `Ocultar warmup (${warmupCount})` : `Mostrar warmup (${warmupCount})`}
            </button>
          )}
          {messages.length > 0 && (
            <button
              style={{ ...linkBtn, color: "#dc2626", marginLeft: "auto" }}
              onClick={clearAllMessages}
              title="Borrar todos los mensajes de la bandeja"
            >
              🗑 Eliminar mensajes
            </button>
          )}
        </div>
        <div style={messagesList}>
          {filtered.length === 0 ? (
            <div style={emptyStyle}>No hay mensajes en la bandeja.</div>
          ) : filtered.map(m => {
            const isSelected = selectedMsg && selectedMsg.uid === m.uid && selectedMsg.accountId === m.accountId;
            const acc = accounts.find(a => a.id === m.accountId);
            return (
              <div key={`${m.accountId}-${m.uid}`}
                style={{ ...messageItem, ...(isSelected ? activeMessage : {}), ...(m.unread ? unreadMessage : {}) }}
                onClick={() => openMessage(m.accountId, m.uid)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <div style={{ fontSize: 13, fontWeight: m.unread ? 700 : 500, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {acc && <span style={accTag}>{acc.email.split("@")[0]}</span>}
                    {m.fromName || m.from}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDate(m.date)}</div>
                </div>
                <div style={{ fontSize: 13, color: m.unread ? "#0f172a" : "#475569", fontWeight: m.unread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.subject || "(sin asunto)"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.preview}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={viewPaneStyle}>
        {!selectedMsg ? (
          <div style={placeholderStyle}>
            <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>✉</div>
            <div>Selecciona un mensaje para verlo</div>
          </div>
        ) : (
          <div style={{ padding: "28px 36px", overflowY: "auto", height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em", flex: 1 }}>
                {selectedMsg.subject || "(sin asunto)"}
              </h2>
              <button style={replyBtnStyle} onClick={() => replyTo(selectedMsg)}>↩ Responder</button>
            </div>
            <div style={{ paddingBottom: 18, borderBottom: "1px solid #e2e8f0", marginBottom: 18, fontSize: 13, color: "#64748b" }}>
              <div><b style={{ color: "#0f172a" }}>De:</b> {selectedMsg.from}</div>
              <div><b style={{ color: "#0f172a" }}>Para:</b> {selectedMsg.to}</div>
              <div><b style={{ color: "#0f172a" }}>Fecha:</b> {new Date(selectedMsg.date).toLocaleString("es")}</div>
            </div>
            <div
              style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937" }}
              dangerouslySetInnerHTML={{
                __html: selectedMsg.html
                  ? selectedMsg.html.replace(/<script[\s\S]*?<\/script>/gi, "")
                  : escapeHtml(selectedMsg.text || "").replace(/\n/g, "<br>")
              }}
            />
            {selectedMsg.attachments && selectedMsg.attachments.length > 0 && (
              <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selectedMsg.attachments.map((a: any, i: number) => (
                  <div key={i} style={attachChip}>📎 {a.filename || "adjunto"} <span style={{ color: "#94a3b8" }}>({Math.round((a.size || 0) / 1024)} KB)</span></div>
                ))}
              </div>
            )}
            {thread.length > 0 && (
              <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                  Hilo ({thread.length + 1} mensajes)
                </div>
                {thread.map(t => (
                  <div key={t.uid} style={threadItem} onClick={() => openMessage(t.accountId, t.uid)}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{t.fromName || t.from}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDate(t.date)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.preview}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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

// -------------- compose modal --------------
function ComposeModal({ uniboxId, accounts, initial, onClose, onSent }: any) {
  const [accountId, setAccountId] = useState(initial.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = body || "";
  }, []);

  function exec(cmd: string) {
    document.execCommand(cmd, false);
  }

  function insertLink() {
    const url = prompt("URL:", "https://");
    if (!url) return;
    document.execCommand("createLink", false, url);
  }

  async function send() {
    if (!to.trim()) return alert("Falta destinatario");
    setSending(true);
    const fd = new FormData();
    fd.append("accountId", accountId);
    fd.append("to", to);
    fd.append("cc", cc);
    fd.append("bcc", bcc);
    fd.append("subject", subject);
    fd.append("body", editorRef.current?.innerHTML || "");
    if (initial.inReplyTo) fd.append("inReplyTo", initial.inReplyTo);
    if (initial.references) fd.append("references", initial.references);
    for (const f of files) fd.append("attachments", f);
    try {
      const r = await fetch(`/api/uniboxes/${uniboxId}/send`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      onSent();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalCardLarge} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontWeight: 600 }}>{initial.inReplyTo ? "Responder" : "Nuevo mensaje"}</div>
          <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          <label style={composeLabel}>De</label>
          <select style={composeInput} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <label style={composeLabel}>Para</label>
          <input style={composeInput} value={to} onChange={(e) => setTo(e.target.value)} placeholder="destinatario@..." />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={composeLabel}>CC</label>
              <input style={composeInput} value={cc} onChange={(e) => setCc(e.target.value)} />
            </div>
            <div>
              <label style={composeLabel}>CCO</label>
              <input style={composeInput} value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </div>
          </div>

          <label style={composeLabel}>Asunto</label>
          <input style={composeInput} value={subject} onChange={(e) => setSubject(e.target.value)} />

          <label style={composeLabel}>Mensaje</label>
          <div style={editorToolbar}>
            <button type="button" onClick={() => exec("bold")} style={toolBtn}><b>B</b></button>
            <button type="button" onClick={() => exec("italic")} style={toolBtn}><i>I</i></button>
            <button type="button" onClick={() => exec("underline")} style={toolBtn}><u>U</u></button>
            <button type="button" onClick={insertLink} style={toolBtn}>🔗 Enlace</button>
            <button type="button" onClick={() => fileRef.current?.click()} style={toolBtn}>📎 Adjuntar</button>
            <input type="file" ref={fileRef} multiple hidden onChange={(e) => {
              if (e.target.files) setFiles([...files, ...Array.from(e.target.files)]);
              e.target.value = "";
            }} />
          </div>
          <div
            ref={editorRef}
            contentEditable
            style={editorStyle}
          />
          {files.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {files.map((f, i) => (
                <span key={i} style={attachChip}>
                  📎 {f.name}{" "}
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    style={{ background: "none", border: 0, color: "#64748b", cursor: "pointer" }}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button onClick={send} disabled={sending} style={primaryBtn}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------- helpers --------------
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es", { month: "short", day: "numeric" });
}
function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

// -------------- styles --------------
const appStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "260px 380px 1fr",
  height: "100vh", overflow: "hidden",
  background: "#fff",
  fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
};
const sidebarStyle: React.CSSProperties = {
  background: "#f8fafc", borderRight: "1px solid #e2e8f0",
  display: "flex", flexDirection: "column", padding: "18px 14px", gap: 14,
};
const brandRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "0 4px" };
const logoMark: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #818cf8)",
  display: "grid", placeItems: "center",
  color: "white", fontWeight: 700, fontSize: 18,
};
const composeBtn: React.CSSProperties = {
  background: "linear-gradient(180deg, #818cf8, #6366f1)",
  color: "#fff", border: "none", padding: "10px 14px", borderRadius: 9,
  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  boxShadow: "0 4px 12px rgba(99,102,241,0.35)",
};
const ghostBtn: React.CSSProperties = {
  background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0",
  padding: "9px 14px", borderRadius: 9, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const primaryBtn: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11, color: "#8b94a7", letterSpacing: "0.08em", padding: "8px 6px 4px", fontWeight: 600,
};
const accountList: React.CSSProperties = { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 };
const accountItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "9px 10px", borderRadius: 8, cursor: "pointer",
};
const activeAccount: React.CSSProperties = { background: "rgba(99,102,241,0.1)" };
const dotStyle: React.CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "#10b981", flexShrink: 0 };
const accountEmail: React.CSSProperties = { fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const accountHost: React.CSSProperties = { fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const listPaneStyle: React.CSSProperties = {
  background: "#fff", borderRight: "1px solid #e2e8f0",
  display: "flex", flexDirection: "column", overflow: "hidden",
};
const toolbarStyle: React.CSSProperties = { padding: "14px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8 };
const searchStyle: React.CSSProperties = {
  width: "100%", background: "#f1f5f9", border: "1px solid transparent",
  padding: "9px 12px", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "inherit",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: 0, color: "#6366f1", fontSize: 11, cursor: "pointer",
  textAlign: "left", padding: 0, fontFamily: "inherit", fontWeight: 600,
};
const messagesList: React.CSSProperties = { flex: 1, overflowY: "auto" };
const messageItem: React.CSSProperties = {
  padding: "13px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
  display: "flex", flexDirection: "column", gap: 3,
};
const activeMessage: React.CSSProperties = { background: "rgba(99,102,241,0.08)" };
const unreadMessage: React.CSSProperties = {};
const accTag: React.CSSProperties = {
  display: "inline-block", fontSize: 10, background: "#f1f5f9",
  color: "#64748b", padding: "1px 6px", borderRadius: 4, marginRight: 6,
};

const viewPaneStyle: React.CSSProperties = { background: "#fafbfc", overflow: "hidden" };
const placeholderStyle: React.CSSProperties = {
  height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  color: "#94a3b8",
};
const replyBtnStyle: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  cursor: "pointer", flexShrink: 0,
};
const attachChip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#f1f5f9", padding: "4px 10px", borderRadius: 6, fontSize: 12,
};
const threadItem: React.CSSProperties = {
  padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 8, marginBottom: 6, cursor: "pointer",
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13,
};

const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
  display: "grid", placeItems: "center", zIndex: 1000,
};
const modalCardLarge: React.CSSProperties = {
  background: "#fff", borderRadius: 14, width: "90%", maxWidth: 720,
  maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
};
const composeLabel: React.CSSProperties = {
  display: "block", fontSize: 10.5, color: "#64748b",
  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
  marginTop: 12, marginBottom: 5,
};
const composeInput: React.CSSProperties = {
  width: "100%", padding: "8px 11px", border: "1px solid #e2e8f0",
  borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};
const editorToolbar: React.CSSProperties = {
  display: "flex", gap: 4, padding: 8,
  background: "#f8fafc", border: "1px solid #e2e8f0", borderBottom: "none",
  borderRadius: "8px 8px 0 0",
};
const toolBtn: React.CSSProperties = {
  background: "transparent", border: 0, color: "#64748b",
  padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
};
const editorStyle: React.CSSProperties = {
  minHeight: 200, maxHeight: 320, overflowY: "auto",
  background: "#fff", border: "1px solid #e2e8f0", borderTop: "none",
  borderRadius: "0 0 8px 8px",
  padding: "12px 14px", fontSize: 14, lineHeight: 1.55, outline: "none",
};
