"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DashboardNav from "../components/DashboardNav";

type EmailStatus = {
  connected: boolean;
  email?: string;
  display_name?: string;
  send_aliases?: string[];
};

type DynamicStatus = "han_respondido" | "esperando" | "en_curso" | "cerrado" | "obsoleto";

type ThreadSummary = {
  id: string;
  subject: string;
  participants: string[];
  contact_email: string;
  contact_name: string;
  message_count: number;
  last_inbound_at?: string;
  last_outbound_at?: string;
  last_direction?: "outbound" | "inbound";
  last_date?: string;
  status: string;
  dynamic_status: DynamicStatus;
  followups_count: number;
  followups_pending: number;
  preview: string;
  updated_at: string;
};

type Message = {
  id: string;
  direction: "outbound" | "inbound";
  from: string;
  to: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  date: string;
};

type Followup = {
  id: string;
  thread_id: string;
  body_html: string;
  scheduled_at: string;
  status: string;
  origin: string;
  sent_at?: string;
  error?: string;
};

type Thread = {
  id: string;
  subject: string;
  participants: string[];
  status: string;
  messages: Message[];
  followups: Followup[];
  notes?: string;
  auto_pilot?: boolean;
};

type ScheduledFollowup = Followup & { thread: { id: string; subject: string; participants: string[] } };

type Tab = "han_respondido" | "esperando" | "calendario" | "secuencias" | "cerrados" | "todos";

const TAB_DEFS: Array<{ key: Tab; label: string; icon: string; description: string }> = [
  { key: "han_respondido", label: "Han respondido", icon: "📬", description: "Necesitan respuesta tuya" },
  { key: "esperando", label: "Esperando", icon: "⏳", description: "Has enviado, sin reply aún" },
  { key: "calendario", label: "Calendario", icon: "📅", description: "Vista mensual de follow-ups" },
  { key: "secuencias", label: "Secuencias", icon: "🔁", description: "Plantillas de seguimiento" },
  { key: "cerrados", label: "Cerrados", icon: "✓", description: "Conversaciones finalizadas" },
  { key: "todos", label: "Todos", icon: "📋", description: "Todos los hilos" },
];

type SequenceStep = {
  delay_days: number;
  body_html: string;
  send_if_no_reply: boolean;
  note?: string;
};
type Sequence = {
  id: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  created_at: string;
  updated_at: string;
};

export default function SeguimientosPage() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [view, setView] = useState<"list" | "thread" | "compose" | "connect">("list");
  const [tab, setTab] = useState<Tab>("han_respondido");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

  // Connect form
  const [connEmail, setConnEmail] = useState("");
  const [connPass, setConnPass] = useState("");
  const [connDisplay, setConnDisplay] = useState("");
  const [connProvider, setConnProvider] = useState<"gmail" | "outlook">("gmail");
  const [connSaving, setConnSaving] = useState(false);

  // Compose
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  // Reply
  const [replyHtml, setReplyHtml] = useState("");
  const [replyHint, setReplyHint] = useState("");
  const [replying, setReplying] = useState(false);

  // Search Gmail (importar conversaciones existentes)
  const [searchOpen, setSearchOpen] = useState(false);
  const [gmailQuery, setGmailQuery] = useState("");
  const [gmailSearching, setGmailSearching] = useState(false);
  const [gmailResults, setGmailResults] = useState<any[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [foldersSearched, setFoldersSearched] = useState<string[]>([]);
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [aliasesInput, setAliasesInput] = useState("");
  const [allFollowups, setAllFollowups] = useState<ScheduledFollowup[]>([]);
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Sequences
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [seqEditOpen, setSeqEditOpen] = useState(false);
  const [seqEditing, setSeqEditing] = useState<Sequence | null>(null);
  const [aiSeqDesc, setAiSeqDesc] = useState("");
  const [aiSeqGenerating, setAiSeqGenerating] = useState(false);
  const [composeSequenceId, setComposeSequenceId] = useState<string>("");

  // Schedule followup
  const [fuOpen, setFuOpen] = useState(false);
  const [fuBody, setFuBody] = useState("");
  const [fuWhen, setFuWhen] = useState("");
  const [fuOrigin, setFuOrigin] = useState<"manual" | "ai_assisted" | "ai_auto">("manual");
  const [fuDateExtraction, setFuDateExtraction] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshStatus();
    refreshThreads();
    refreshSequences();
    const t = setInterval(() => {
      refreshThreads();
      if (thread) loadThread(thread.id);
    }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchGmail() {
    if (!gmailQuery.trim()) return;
    setGmailSearching(true);
    setGmailResults([]);
    try {
      const r = await fetch("/api/email/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: gmailQuery.trim(), max: 30 }),
      }).then((r) => r.json());
      if (r.error) setFeedback("⚠️ " + r.error);
      else {
        setGmailResults(r.threads ?? []);
        setFoldersSearched(r.folders_searched ?? []);
      }
    } finally {
      setGmailSearching(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function importGmailThread(t: any) {
    setImporting(t.key);
    try {
      const otherParticipant = t.participants.find((p: string) => p.toLowerCase() !== status?.email?.toLowerCase()) ?? t.participants[0];
      const r = await fetch("/api/email/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gm_thrid: t.hits.find((h: any) => h.gm_thrid)?.gm_thrid,
          subject_seed: t.subject,
          participant_seed: otherParticipant,
        }),
      }).then((r) => r.json());
      if (r.error) {
        setFeedback("⚠️ " + r.error);
      } else {
        setFeedback(`✓ Importado: ${r.imported} mensajes nuevos (${r.skipped} ya existían)`);
        setSearchOpen(false);
        setGmailQuery("");
        setGmailResults([]);
        await refreshThreads();
        loadThread(r.thread_id);
      }
    } finally {
      setImporting(null);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  async function refreshSequences() {
    const r = await fetch("/api/email/sequences").then((r) => r.json());
    setSequences(r.sequences ?? []);
  }
  async function saveSeq(seq: Sequence) {
    const r = await fetch("/api/email/sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seq),
    }).then((r) => r.json());
    setSeqEditOpen(false);
    setSeqEditing(null);
    refreshSequences();
    setFeedback("✓ Secuencia guardada");
    setTimeout(() => setFeedback(null), 4000);
  }
  async function delSeq(id: string) {
    if (!confirm("¿Borrar secuencia?")) return;
    await fetch(`/api/email/sequences/${id}`, { method: "DELETE" });
    refreshSequences();
  }
  async function generateSeqAI() {
    if (!aiSeqDesc.trim()) return;
    setAiSeqGenerating(true);
    try {
      const r = await fetch("/api/email/sequences/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiSeqDesc }),
      }).then((r) => r.json());
      if (r.error) {
        setFeedback("⚠️ " + r.error);
      } else {
        const seq: Sequence = {
          id: "",
          ...r.sequence,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setSeqEditing(seq);
        setSeqEditOpen(true);
        setAiSeqDesc("");
      }
    } finally {
      setAiSeqGenerating(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  async function refreshStatus() {
    const s = await fetch("/api/email/config").then((r) => r.json());
    setStatus(s);
    if (!s.connected) setView("connect");
    else if (view === "connect") setView("list");
  }
  async function refreshThreads() {
    const r = await fetch("/api/email/threads").then((r) => r.json());
    setThreads(r.threads ?? []);
    const fr = await fetch("/api/email/followups").then((r) => r.json()).catch(() => ({ items: [] }));
    setAllFollowups(fr.items ?? []);
  }

  async function toggleAutopilot() {
    if (!thread) return;
    const newVal = !thread.auto_pilot;
    setFeedback(newVal ? "Activando auto-pilot…" : "Desactivando…");
    const r = await fetch(`/api/email/threads/${thread.id}/autopilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newVal }),
    }).then((r) => r.json());
    if (r.error) {
      setFeedback("⚠️ " + r.error);
    } else {
      setFeedback(newVal ? "✓ Auto-pilot activado. La IA gestionará nuevas respuestas." : "✓ Auto-pilot desactivado.");
      loadThread(thread.id);
    }
    setTimeout(() => setFeedback(null), 5000);
  }
  async function loadThread(id: string) {
    const r = await fetch(`/api/email/threads/${id}`).then((r) => r.json());
    setThread(r.thread ?? null);
    setView("thread");
    setReplyHtml("");
    setReplyHint("");
  }

  // Filtros por tab + search
  const filtered = useMemo(() => {
    let list = threads;
    if (tab === "han_respondido") list = list.filter((t) => t.dynamic_status === "han_respondido");
    else if (tab === "esperando") list = list.filter((t) => t.dynamic_status === "esperando");
    else if (tab === "cerrados") list = list.filter((t) => t.dynamic_status === "cerrado" || t.dynamic_status === "obsoleto");
    else if (tab === "calendario") list = list.filter((t) => t.followups_pending > 0);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject?.toLowerCase().includes(q) ||
          t.contact_email?.toLowerCase().includes(q) ||
          t.contact_name?.toLowerCase().includes(q) ||
          t.preview?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [threads, tab, search]);

  // Counts por tab
  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      han_respondido: threads.filter((t) => t.dynamic_status === "han_respondido").length,
      esperando: threads.filter((t) => t.dynamic_status === "esperando").length,
      calendario: threads.reduce((sum, t) => sum + (t.followups_pending ?? 0), 0),
      secuencias: 0,
      cerrados: threads.filter((t) => t.dynamic_status === "cerrado" || t.dynamic_status === "obsoleto").length,
      todos: threads.length,
    };
    return c;
  }, [threads]);

  async function connect() {
    if (!connEmail.trim() || !connPass.trim()) return;
    setConnSaving(true);
    setFeedback("Conectando…");
    try {
      const r = await fetch("/api/email/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: connEmail.trim(),
          app_password: connPass.trim(),
          display_name: connDisplay.trim(),
          provider: connProvider,
        }),
      });
      const d = await r.json();
      if (d.smtp_ok && d.imap_ok) {
        setFeedback("✓ Conectado correctamente.");
        setConnPass("");
        refreshStatus();
        refreshThreads();
      } else {
        const errs = [];
        if (!d.smtp_ok) errs.push(`SMTP: ${d.smtp_error}`);
        if (!d.imap_ok) errs.push(`IMAP: ${d.imap_error}`);
        setFeedback("⚠️ " + errs.join(" | "));
      }
    } finally {
      setConnSaving(false);
      setTimeout(() => setFeedback(null), 8000);
    }
  }

  async function disconnect() {
    if (!confirm("¿Desconectar la cuenta?")) return;
    await fetch("/api/email/config", { method: "DELETE" });
    refreshStatus();
  }

  async function syncInboxNow() {
    setSyncing(true);
    setFeedback("Sincronizando inbox…");
    try {
      const r = await fetch("/api/email/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 14, max: 50 }),
      }).then((r) => r.json());
      if (r.error) setFeedback("⚠️ " + r.error);
      else setFeedback(`✓ ${r.new_messages} nuevos mensajes`);
      refreshThreads();
    } finally {
      setSyncing(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function sendCompose() {
    if (!to || !subject || !bodyHtml) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("to", to);
      fd.append("subject", subject);
      fd.append("body_html", bodyHtml);
      for (const f of files) fd.append("attachments", f);
      const r = await fetch("/api/email/send", { method: "POST", body: fd });
      const d = await r.json();
      if (d.error) setFeedback("⚠️ " + d.error);
      else {
        // Si seleccionó secuencia, aplicarla al thread recién creado
        if (composeSequenceId && d.thread_id) {
          await fetch("/api/email/sequences/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sequence_id: composeSequenceId, thread_id: d.thread_id }),
          }).catch(() => null);
          setFeedback("✓ Enviado + secuencia programada");
        } else {
          setFeedback("✓ Enviado");
        }
        setTo("");
        setSubject("");
        setBodyHtml("<p></p>");
        setFiles([]);
        setComposeSequenceId("");
        if (fileRef.current) fileRef.current.value = "";
        await refreshThreads();
        loadThread(d.thread_id);
      }
    } finally {
      setSending(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function sendReply() {
    if (!thread || !replyHtml) return;
    setSending(true);
    try {
      const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
      const recipient =
        thread.participants.find((p) => !status?.email || p.toLowerCase() !== status.email.toLowerCase()) ??
        lastInbound?.from ??
        thread.participants[0];
      const fd = new FormData();
      fd.append("to", recipient);
      fd.append("subject", thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`);
      fd.append("body_html", replyHtml);
      fd.append("thread_id", thread.id);
      const r = await fetch("/api/email/send", { method: "POST", body: fd });
      const d = await r.json();
      if (d.error) setFeedback("⚠️ " + d.error);
      else {
        setFeedback("✓ Respuesta enviada");
        setReplyHtml("");
        loadThread(thread.id);
      }
    } finally {
      setSending(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function aiReply() {
    if (!thread) return;
    setReplying(true);
    try {
      const r = await fetch("/api/email/ai/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: thread.id, hint: replyHint }),
      }).then((r) => r.json());
      if (r.body_html) setReplyHtml(r.body_html);
      if (r.error) setFeedback("⚠️ " + r.error);
    } finally {
      setReplying(false);
    }
  }

  async function detectDate() {
    if (!thread) return;
    const r = await fetch("/api/email/ai/extract-date", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: thread.id }),
    }).then((r) => r.json());
    setFuDateExtraction(r);
    if (r.has_date && r.date_iso) {
      const d = new Date(r.date_iso);
      const offset = d.getTimezoneOffset() * 60000;
      setFuWhen(new Date(d.getTime() - offset).toISOString().slice(0, 16));
      setFuOrigin("ai_auto");
    }
  }

  async function openSchedule() {
    if (!thread) return;
    setFuBody(replyHtml || "");
    setFuWhen("");
    setFuDateExtraction(null);
    setFuOpen(true);
    detectDate();
    if (!replyHtml) {
      const r = await fetch("/api/email/ai/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: thread.id, hint: "Esto será un follow-up programado" }),
      }).then((r) => r.json());
      if (r.body_html) setFuBody(r.body_html);
    }
  }

  async function saveFollowup() {
    if (!thread || !fuBody || !fuWhen) return;
    const r = await fetch("/api/email/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: thread.id,
        body_html: fuBody,
        scheduled_at: new Date(fuWhen).toISOString(),
        origin: fuOrigin,
      }),
    }).then((r) => r.json());
    if (r.error) setFeedback("⚠️ " + r.error);
    else {
      setFeedback("✓ Follow-up programado");
      setFuOpen(false);
      loadThread(thread.id);
      refreshThreads();
    }
    setTimeout(() => setFeedback(null), 5000);
  }

  async function cancelFollowup(id: string) {
    if (!confirm("¿Cancelar este follow-up?")) return;
    await fetch(`/api/email/followups/${id}`, { method: "DELETE" });
    if (thread) loadThread(thread.id);
    refreshThreads();
  }

  async function markClosed() {
    if (!thread) return;
    await fetch(`/api/email/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    refreshThreads();
    loadThread(thread.id);
  }

  function fmt(d?: string) {
    if (!d) return "";
    return new Date(d).toLocaleString();
  }
  function fmtRelative(d?: string) {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `hace ${days}d`;
    return new Date(d).toLocaleDateString();
  }

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content seg-app">
      <header className="seg-header">
        <div>
          <div className="dash-page-title">Seguimientos</div>
          {status?.connected && <div className="dash-page-subtitle">{status.display_name || status.email}</div>}
        </div>
        <div className="seg-status">
          {status?.connected ? (
            <>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{status.display_name || status.email}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{status.email}</div>
              </div>
              <button className="btn-ghost" onClick={() => setSearchOpen(true)} title="Buscar en Gmail (inbox + enviados)">
                🔎 Buscar
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setAliasesInput((status?.send_aliases ?? []).join(", "));
                  setAliasesOpen(true);
                }}
                title="Alias desde los que envías emails"
              >
                ⚙️ Alias
              </button>
              <button className="btn-ghost" onClick={syncInboxNow} disabled={syncing} title="Sincronizar inbox">
                {syncing ? "..." : "↻"}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setView("compose");
                  setThread(null);
                }}
              >
                + Nuevo
              </button>
              <button className="btn-ghost" onClick={disconnect}>Desconectar</button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => setView("connect")}>Conectar Gmail</button>
          )}
        </div>
      </header>

      {feedback && <div className="li-banner">{feedback}</div>}

      {!status?.connected ? (
        <main className="seg-content">
          <ConnectView
            email={connEmail} setEmail={setConnEmail}
            pass={connPass} setPass={setConnPass}
            display={connDisplay} setDisplay={setConnDisplay}
            provider={connProvider} setProvider={setConnProvider}
            connect={connect} saving={connSaving}
          />
        </main>
      ) : (
        <>
          <nav className="seg-tabs">
            {TAB_DEFS.map((t) => (
              <button
                key={t.key}
                className={`seg-tab ${tab === t.key ? "active" : ""}`}
                onClick={() => {
                  setTab(t.key);
                  setView("list");
                  setThread(null);
                }}
                title={t.description}
              >
                <span className="seg-tab-icon">{t.icon}</span>
                <span className="seg-tab-label">{t.label}</span>
                <span className={`seg-tab-count ${counts[t.key] > 0 && t.key === "han_respondido" ? "seg-tab-count-action" : ""}`}>
                  {counts[t.key]}
                </span>
              </button>
            ))}
          </nav>

          <div className={`seg-main-2col ${tab === "secuencias" ? "seg-main-1col" : ""}`}>
            {tab !== "secuencias" && (
            <aside className="seg-sidebar">
              <input
                className="li-input"
                style={{ marginBottom: 12 }}
                placeholder="🔎 Buscar por nombre, asunto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="seg-thread-list">
                {filtered.length === 0 ? (
                  <div className="list-empty">
                    {tab === "han_respondido" && "Nadie te ha respondido todavía."}
                    {tab === "esperando" && "No tienes mensajes pendientes."}
                    {(tab as string) === "programados" && "Sin follow-ups programados."}
                    {tab === "cerrados" && "Ningún hilo cerrado."}
                    {tab === "todos" && "Sin hilos. Envía tu primer email."}
                  </div>
                ) : (
                  filtered.map((t) => (
                    <ThreadCard
                      key={t.id}
                      t={t}
                      active={thread?.id === t.id}
                      onClick={() => loadThread(t.id)}
                      fmtRelative={fmtRelative}
                    />
                  ))
                )}
              </div>
            </aside>
            )}

            <main className="seg-content seg-content-2col">
              {view === "compose" && (
                <ComposeView
                  to={to}
                  setTo={setTo}
                  subject={subject}
                  setSubject={setSubject}
                  bodyHtml={bodyHtml}
                  setBodyHtml={setBodyHtml}
                  files={files}
                  setFiles={setFiles}
                  fileRef={fileRef}
                  sending={sending}
                  send={sendCompose}
                  sequences={sequences}
                  composeSequenceId={composeSequenceId}
                  setComposeSequenceId={setComposeSequenceId}
                />
              )}

              {tab === "secuencias" && (
                <SequencesView
                  sequences={sequences}
                  onNew={() => {
                    setSeqEditing({
                      id: "",
                      name: "",
                      description: "",
                      steps: [],
                      created_at: "",
                      updated_at: "",
                    });
                    setSeqEditOpen(true);
                  }}
                  onEdit={(s) => {
                    setSeqEditing(s);
                    setSeqEditOpen(true);
                  }}
                  onDelete={delSeq}
                  aiDesc={aiSeqDesc}
                  setAiDesc={setAiSeqDesc}
                  aiGenerating={aiSeqGenerating}
                  generateAI={generateSeqAI}
                />
              )}

              {view === "thread" && thread && (
                <ThreadView
                  thread={thread}
                  myEmail={status?.email ?? ""}
                  fmt={fmt}
                  fmtRelative={fmtRelative}
                  replyHtml={replyHtml}
                  setReplyHtml={setReplyHtml}
                  replyHint={replyHint}
                  setReplyHint={setReplyHint}
                  aiReply={aiReply}
                  replying={replying}
                  sendReply={sendReply}
                  sending={sending}
                  openSchedule={openSchedule}
                  cancelFollowup={cancelFollowup}
                  markClosed={markClosed}
                  toggleAutopilot={toggleAutopilot}
                  sequences={sequences}
                  applySequenceToThread={async (seqId: string) => {
                    const r = await fetch("/api/email/sequences/apply", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ sequence_id: seqId, thread_id: thread.id }),
                    }).then((r) => r.json());
                    if (r.error) setFeedback("⚠️ " + r.error);
                    else {
                      setFeedback(`✓ Secuencia aplicada: ${r.scheduled} follow-ups programados`);
                      loadThread(thread.id);
                    }
                    setTimeout(() => setFeedback(null), 5000);
                  }}
                />
              )}

              {tab === "calendario" && !thread && (
                <CalendarView
                  followups={allFollowups}
                  month={calMonth}
                  setMonth={setCalMonth}
                  onClickThread={(tid) => loadThread(tid)}
                  fmt={fmt}
                />
              )}

              {view === "list" && !thread && (
                <div className="seg-empty-hero">
                  <div style={{ fontSize: 44, marginBottom: 12 }}>{TAB_DEFS.find((t) => t.key === tab)?.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                    {TAB_DEFS.find((t) => t.key === tab)?.label}
                  </div>
                  <div style={{ color: "var(--text-dim)", maxWidth: 360 }}>
                    {TAB_DEFS.find((t) => t.key === tab)?.description}. Selecciona un hilo en la izquierda para verlo.
                  </div>
                </div>
              )}
            </main>
          </div>
        </>
      )}

      {aliasesOpen && (
        <div className="modal-backdrop" onClick={() => setAliasesOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Alias de envío</div>
                <div className="modal-sub">
                  Si envías desde alias de Gmail (ej: team@onepulso.online), añádelos aquí. Sin esto, esos emails se marcarán como recibidos.
                </div>
              </div>
              <button className="modal-close" onClick={() => setAliasesOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="li-row">
                <label className="li-label">Aliases (separados por coma)</label>
                <textarea
                  className="li-textarea"
                  rows={3}
                  value={aliasesInput}
                  onChange={(e) => setAliasesInput(e.target.value)}
                  placeholder="team@onepulso.online, xavi@onepulso.com"
                />
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
                  Tu cuenta principal ({status?.email}) ya cuenta como propia.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={async () => {
                    const aliases = aliasesInput
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.includes("@"));
                    await fetch("/api/email/config", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ send_aliases: aliases }),
                    });
                    setAliasesOpen(false);
                    refreshStatus();
                    setFeedback("✓ Alias guardados");
                    setTimeout(() => setFeedback(null), 4000);
                  }}
                >
                  Guardar
                </button>
                <button className="btn-ghost" onClick={() => setAliasesOpen(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="modal-backdrop" onClick={() => setSearchOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: "85vh" }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Buscar en tu Gmail</div>
                <div className="modal-sub">Busca en inbox + enviados. Click en un resultado para importarlo a seguimientos.</div>
              </div>
              <button className="modal-close" onClick={() => setSearchOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  className="li-input"
                  style={{ flex: 1 }}
                  placeholder="Email del contacto, palabra del subject, dominio…"
                  value={gmailQuery}
                  onChange={(e) => setGmailQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchGmail(); }}
                  autoFocus
                />
                <button className="btn-primary" onClick={searchGmail} disabled={gmailSearching || !gmailQuery.trim()}>
                  {gmailSearching ? "Buscando…" : "Buscar"}
                </button>
              </div>

              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 14 }}>
                Tip Gmail: usa sintaxis avanzada — <code>from:juan@empresa.com</code>, <code>to:cliente@x.com</code>, <code>subject:propuesta</code>, <code>after:2026/01/01</code>. Para encontrar emails que TÚ enviaste a alguien usa <code>to:su_email</code>.
              </div>
              {foldersSearched.length > 0 && (
                <div style={{ fontSize: 11, color: "#6ee7b7", marginBottom: 12 }}>
                  📁 Buscado en: {foldersSearched.join(", ")}
                </div>
              )}

              {gmailResults.length === 0 && !gmailSearching && (
                <div className="list-empty">Escribe arriba y pulsa "Buscar".</div>
              )}

              {gmailResults.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {gmailResults.map((t: any) => {
                    const otherParts = t.participants.filter((p: string) => p.toLowerCase() !== status?.email?.toLowerCase());
                    return (
                      <div
                        key={t.key}
                        style={{
                          padding: 12,
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          background: "var(--bg)",
                          cursor: importing ? "default" : "pointer",
                        }}
                        onClick={() => !importing && importGmailThread(t)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.subject}</span>
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{new Date(t.last_date).toLocaleDateString()}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>
                          {otherParts.join(", ")}{" · "}{t.msg_count} mensaje{t.msg_count > 1 ? "s" : ""}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.45 }}>
                          {t.hits[0]?.preview || ""}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {importing === t.key ? (
                            <span style={{ fontSize: 12, color: "var(--accent)" }}>Importando…</span>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--accent)" }}>→ Click para importar a seguimientos</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {seqEditOpen && seqEditing && (
        <SequenceEditor
          seq={seqEditing}
          onSave={(s) => saveSeq(s)}
          onClose={() => {
            setSeqEditOpen(false);
            setSeqEditing(null);
          }}
        />
      )}

      {fuOpen && (
        <div className="modal-backdrop" onClick={() => setFuOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Programar follow-up</div>
                <div className="modal-sub">Se enviará automáticamente a la fecha indicada</div>
              </div>
              <button className="modal-close" onClick={() => setFuOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {fuDateExtraction?.has_date && (
                <div className="seg-ai-detection">
                  🤖 IA detectó: <strong>"{fuDateExtraction.date_text}"</strong>.
                  Sugiere {new Date(fuDateExtraction.date_iso).toLocaleString()} (confianza: {fuDateExtraction.confidence}).
                </div>
              )}
              <div className="li-row">
                <label className="li-label">Fecha y hora</label>
                <input type="datetime-local" className="li-input" value={fuWhen} onChange={(e) => setFuWhen(e.target.value)} />
              </div>
              <div className="li-row">
                <label className="li-label">Texto (HTML)</label>
                <textarea className="li-textarea" rows={12} value={fuBody} onChange={(e) => setFuBody(e.target.value)} />
              </div>
              <div className="li-row">
                <label className="li-label">Origen</label>
                <select
                  value={fuOrigin}
                  onChange={(e) => setFuOrigin(e.target.value as any)}
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: "8px 10px", fontSize: 13 }}
                >
                  <option value="manual">Manual</option>
                  <option value="ai_assisted">IA con mi revisión</option>
                  <option value="ai_auto">IA detectó fecha automáticamente</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-primary" onClick={saveFollowup} disabled={!fuBody || !fuWhen}>Programar</button>
                <button className="btn-ghost" onClick={() => setFuOpen(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ============== Componentes ==============

function ThreadCard({
  t, active, onClick, fmtRelative,
}: { t: ThreadSummary; active: boolean; onClick: () => void; fmtRelative: (d?: string) => string }) {
  const initials = (t.contact_name || t.contact_email)
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const colorIdx = (t.contact_email.charCodeAt(0) ?? 0) % 6;
  return (
    <div
      className={`seg-card-thread seg-status-${t.dynamic_status} ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <div className={`seg-avatar seg-avatar-${colorIdx}`}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="seg-card-row">
          <span className="seg-card-name">{t.contact_name || t.contact_email.split("@")[0]}</span>
          <span className="seg-card-time">{fmtRelative(t.last_date)}</span>
        </div>
        <div className="seg-card-subject">{t.subject || "(sin asunto)"}</div>
        <div className="seg-card-preview">{t.preview}</div>
        <div className="seg-card-badges">
          <StatusBadge status={t.dynamic_status} />
          {t.followups_pending > 0 && <span className="seg-pill seg-pill-fu">📅 {t.followups_pending}</span>}
          <span className="seg-pill seg-pill-msg">{t.message_count} msg</span>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DynamicStatus }) {
  const map: Record<DynamicStatus, { label: string; cls: string }> = {
    han_respondido: { label: "respondido", cls: "han_respondido" },
    esperando: { label: "esperando", cls: "esperando" },
    en_curso: { label: "en curso", cls: "en_curso" },
    cerrado: { label: "cerrado", cls: "cerrado" },
    obsoleto: { label: "obsoleto", cls: "obsoleto" },
  };
  const m = map[status];
  return <span className={`seg-pill seg-pill-${m.cls}`}>{m.label}</span>;
}

function ConnectView(p: any) {
  return (
    <section className="seg-card" style={{ maxWidth: 600, margin: "40px auto" }}>
      <h2 className="li-h2">Conectar tu cuenta de email</h2>
      <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 16, lineHeight: 1.55 }}>
        Para Gmail necesitas una <strong>app password</strong>: ve a
        {" "}<a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>myaccount.google.com/apppasswords</a>,
        crea una con nombre "onepulso" y pégala aquí. <strong>No es tu contraseña normal de Gmail.</strong>
      </div>
      <div className="li-row">
        <label className="li-label">Proveedor</label>
        <select
          value={p.provider}
          onChange={(e) => p.setProvider(e.target.value)}
          style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: "8px 10px", fontSize: 13 }}
        >
          <option value="gmail">Gmail / Google Workspace</option>
          <option value="outlook">Outlook / Office 365</option>
        </select>
      </div>
      <div className="li-row">
        <label className="li-label">Email</label>
        <input className="li-input" type="email" value={p.email} onChange={(e) => p.setEmail(e.target.value)} placeholder="tu@gmail.com" />
      </div>
      <div className="li-row">
        <label className="li-label">App password</label>
        <input className="li-input" type="password" value={p.pass} onChange={(e) => p.setPass(e.target.value)} placeholder="xxxx xxxx xxxx xxxx" />
      </div>
      <div className="li-row">
        <label className="li-label">Nombre a mostrar (opcional)</label>
        <input className="li-input" value={p.display} onChange={(e) => p.setDisplay(e.target.value)} placeholder="Xavi Riera" />
      </div>
      <button className="btn-primary" onClick={p.connect} disabled={p.saving || !p.email || !p.pass}>
        {p.saving ? "Probando conexión…" : "Conectar"}
      </button>
    </section>
  );
}

function ComposeView(p: any) {
  return (
    <section className="seg-card">
      <h2 className="li-h2">Nuevo email</h2>
      <div className="li-row">
        <label className="li-label">Para</label>
        <input className="li-input" value={p.to} onChange={(e: any) => p.setTo(e.target.value)} placeholder="email@destinatario.com" />
      </div>
      <div className="li-row">
        <label className="li-label">Asunto</label>
        <input className="li-input" value={p.subject} onChange={(e: any) => p.setSubject(e.target.value)} placeholder="Asunto del email" />
      </div>
      <div className="li-row">
        <label className="li-label">Cuerpo (HTML permitido: &lt;p&gt; &lt;strong&gt; &lt;br&gt;)</label>
        <textarea className="li-textarea" rows={14} value={p.bodyHtml} onChange={(e: any) => p.setBodyHtml(e.target.value)} />
      </div>
      <div className="li-row">
        <label className="li-label">Adjuntos</label>
        <input ref={p.fileRef} type="file" multiple onChange={(e: any) => p.setFiles(Array.from(e.target.files ?? []))} />
        {p.files.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>📎 {p.files.map((f: File) => f.name).join(", ")}</div>
        )}
      </div>
      <div className="li-row">
        <label className="li-label">Aplicar secuencia tras enviar (opcional)</label>
        <select
          value={p.composeSequenceId}
          onChange={(e) => p.setComposeSequenceId(e.target.value)}
          style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: "8px 10px", fontSize: 13 }}
        >
          <option value="">— Sin secuencia automática —</option>
          {p.sequences.map((s: Sequence) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.steps.length} steps)
            </option>
          ))}
        </select>
        {p.composeSequenceId && (
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
            Tras enviar, se programarán automáticamente los follow-ups de la secuencia. Se cancelan solos si el prospect responde.
          </div>
        )}
      </div>
      <button className="btn-primary" onClick={p.send} disabled={p.sending || !p.to || !p.subject}>
        {p.sending ? "Enviando…" : "Enviar"}
      </button>
    </section>
  );
}

function SequencesView(p: {
  sequences: Sequence[];
  onNew: () => void;
  onEdit: (s: Sequence) => void;
  onDelete: (id: string) => void;
  aiDesc: string;
  setAiDesc: (v: string) => void;
  aiGenerating: boolean;
  generateAI: () => void;
}) {
  return (
    <section className="seg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 className="li-h2" style={{ marginBottom: 0 }}>Secuencias de follow-up</h2>
        <button className="btn-primary" onClick={p.onNew}>+ Nueva secuencia</button>
      </div>

      <div style={{ marginBottom: 24, padding: 14, background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)" }}>
        <div className="li-label" style={{ marginBottom: 8 }}>✨ Generar con IA</div>
        <textarea
          className="li-textarea"
          rows={3}
          placeholder="Ej: 'Secuencia de 4 follow-ups para ICP de SaaS B2B en España. El primero a los 3 días recordando el gancho. El segundo con un caso real. El tercero cualificación. El cuarto breakup.'"
          value={p.aiDesc}
          onChange={(e) => p.setAiDesc(e.target.value)}
        />
        <button className="btn-ghost" style={{ marginTop: 8 }} onClick={p.generateAI} disabled={p.aiGenerating || !p.aiDesc.trim()}>
          {p.aiGenerating ? "Generando…" : "Generar secuencia"}
        </button>
      </div>

      {p.sequences.length === 0 ? (
        <div className="list-empty">Sin secuencias todavía. Crea una manualmente o pídesela a la IA arriba.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {p.sequences.map((s) => (
            <div key={s.id} className="seg-seq-card">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                {s.description && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{s.description}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {s.steps.map((step, i) => (
                    <span key={i} className="seg-pill seg-pill-fu" title={step.note ?? ""}>
                      +{step.delay_days}d
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-ghost-sm" onClick={() => p.onEdit(s)}>Editar</button>
                <button className="btn-ghost-sm" onClick={() => p.onDelete(s.id)}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SequenceEditor({
  seq,
  onSave,
  onClose,
}: {
  seq: Sequence;
  onSave: (s: Sequence) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<Sequence>(seq);
  function updateStep(i: number, patch: Partial<SequenceStep>) {
    const steps = [...s.steps];
    steps[i] = { ...steps[i], ...patch };
    setS({ ...s, steps });
  }
  function addStep() {
    const last = s.steps[s.steps.length - 1];
    setS({
      ...s,
      steps: [
        ...s.steps,
        {
          delay_days: last ? 4 : 3,
          body_html: "<p>{{firstName}},</p>\n<p>...</p>\n<p>Un saludo,<br>Xavi</p>",
          send_if_no_reply: true,
          note: "",
        },
      ],
    });
  }
  function removeStep(i: number) {
    const steps = s.steps.filter((_, idx) => idx !== i);
    setS({ ...s, steps });
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{seq.id ? "Editar secuencia" : "Nueva secuencia"}</div>
            <div className="modal-sub">Cada step se programa a +N días del anterior. Se cancela automáticamente si el prospect responde.</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="li-row">
            <label className="li-label">Nombre</label>
            <input className="li-input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Ej: Standard 4-step B2B" />
          </div>
          <div className="li-row">
            <label className="li-label">Descripción</label>
            <input className="li-input" value={s.description ?? ""} onChange={(e) => setS({ ...s, description: e.target.value })} />
          </div>

          <div style={{ marginTop: 14, fontWeight: 600, fontSize: 13 }}>Steps</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {s.steps.map((step, i) => (
              <div key={i} className="seg-step-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Step {i + 1}</strong>
                  <button className="btn-ghost-sm" onClick={() => removeStep(i)}>×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, marginTop: 8 }}>
                  <div>
                    <label className="li-label">Delay (días)</label>
                    <input
                      type="number"
                      min={0}
                      className="li-input"
                      value={step.delay_days}
                      onChange={(e) => updateStep(i, { delay_days: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="li-label">Nota (propósito del step)</label>
                    <input className="li-input" value={step.note ?? ""} onChange={(e) => updateStep(i, { note: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="li-label">Cuerpo (HTML)</label>
                  <textarea
                    className="li-textarea"
                    rows={6}
                    value={step.body_html}
                    onChange={(e) => updateStep(i, { body_html: e.target.value })}
                  />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={step.send_if_no_reply}
                    onChange={(e) => updateStep(i, { send_if_no_reply: e.target.checked })}
                  />
                  Cancelar automáticamente si el prospect responde antes
                </label>
              </div>
            ))}
            <button className="btn-ghost" onClick={addStep}>+ Añadir step</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn-primary" onClick={() => onSave(s)} disabled={!s.name || s.steps.length === 0}>
              Guardar
            </button>
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarView(p: {
  followups: ScheduledFollowup[];
  month: Date;
  setMonth: (d: Date) => void;
  onClickThread: (id: string) => void;
  fmt: (d?: string) => string;
}) {
  const monthStart = new Date(p.month.getFullYear(), p.month.getMonth(), 1);
  const days: Date[] = [];
  const first = new Date(monthStart);
  const dow = (first.getDay() + 6) % 7; // 0=Mon
  first.setDate(first.getDate() - dow);
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    days.push(d);
  }

  const byDay = new Map<string, ScheduledFollowup[]>();
  for (const f of p.followups) {
    const d = new Date(f.scheduled_at);
    const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(f);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const monthLabel = p.month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="seg-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 className="li-h2" style={{ marginBottom: 0 }}>Calendario de follow-ups</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="li-cal-nav" onClick={() => p.setMonth(new Date(p.month.getFullYear(), p.month.getMonth() - 1, 1))}>‹</button>
          <span style={{ fontWeight: 600, textTransform: "capitalize", minWidth: 140, textAlign: "center" }}>{monthLabel}</span>
          <button className="li-cal-nav" onClick={() => p.setMonth(new Date(p.month.getFullYear(), p.month.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      <div className="li-cal-weekdays">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div key={d} className="li-cal-wk">{d}</div>
        ))}
      </div>
      <div className="li-cal-grid">
        {days.map((d, i) => {
          const k = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
          const dayFus = byDay.get(k) ?? [];
          const isOther = d.getMonth() !== p.month.getMonth();
          const isToday = k === todayKey;
          return (
            <div
              key={i}
              className={`li-cal-day ${isOther ? "li-cal-day--other" : ""} ${isToday ? "li-cal-day--today" : ""}`}
              style={{ minHeight: 88, cursor: "default" }}
            >
              <div className="li-cal-day-num">{d.getDate()}</div>
              <div className="li-cal-day-posts">
                {dayFus.map((f) => (
                  <div
                    key={f.id}
                    className={`li-cal-chip li-cal-chip-${f.status}`}
                    title={`${f.thread.subject} - ${new Date(f.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onClickThread(f.thread_id);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="li-cal-chip-time">
                      {new Date(f.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="li-cal-chip-text">
                      {f.thread.subject?.slice(0, 22)}
                      {f.origin === "ai_auto" ? " 🤖" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="li-cal-legend">
        <span><span className="li-dot li-dot-scheduled" /> programado</span>
        <span>🤖 = generado por IA en auto-pilot</span>
      </div>
    </section>
  );
}

function ThreadView(p: any) {
  const t: Thread = p.thread;
  const [seqMenuOpen, setSeqMenuOpen] = useState(false);
  return (
    <>
      <section className="seg-card seg-thread-head">
        <div style={{ flex: 1 }}>
          <h2 className="li-h2" style={{ marginBottom: 4 }}>{t.subject}</h2>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Con {t.participants.filter((x: string) => x !== p.myEmail).join(", ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {t.status !== "closed" && (
            <button className="btn-ghost-sm" onClick={p.markClosed} title="Marcar como cerrado">
              Cerrar hilo
            </button>
          )}
        </div>
      </section>

      {/* Acciones grandes */}
      <section className="seg-actions-grid">
        <button
          className={`seg-action-card ${t.auto_pilot ? "seg-action-card--active" : ""}`}
          onClick={p.toggleAutopilot}
        >
          <div className="seg-action-icon">{t.auto_pilot ? "🤖" : "✨"}</div>
          <div className="seg-action-title">
            {t.auto_pilot ? "Auto-pilot ON" : "Activar Auto-pilot IA"}
          </div>
          <div className="seg-action-desc">
            {t.auto_pilot
              ? "La IA detecta cada respuesta del prospect, extrae fechas y programa la siguiente acción automáticamente."
              : "Que la IA gestione esta conversación: detecta fechas en sus respuestas y programa el follow-up sola."}
          </div>
        </button>

        <div className="seg-action-card" style={{ cursor: "default" }}>
          <div className="seg-action-icon">🔁</div>
          <div className="seg-action-title">Aplicar secuencia</div>
          <div className="seg-action-desc">Aplica una plantilla de follow-ups con delays automáticos.</div>
          {p.sequences.length === 0 ? (
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
              Sin secuencias. Créalas en pestaña "Secuencias".
            </div>
          ) : (
            <select
              onChange={(e) => {
                if (e.target.value) p.applySequenceToThread(e.target.value);
                e.target.value = "";
              }}
              style={{
                marginTop: 8,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                padding: "8px 10px",
                fontSize: 12,
                width: "100%",
              }}
              defaultValue=""
            >
              <option value="">— Elige una secuencia —</option>
              {p.sequences.map((s: Sequence) => (
                <option key={s.id} value={s.id}>{s.name} ({s.steps.length} steps)</option>
              ))}
            </select>
          )}
        </div>

        <button className="seg-action-card" onClick={p.openSchedule}>
          <div className="seg-action-icon">📅</div>
          <div className="seg-action-title">Programar follow-up</div>
          <div className="seg-action-desc">
            La IA detecta fechas en la respuesta del prospect y autocompleta. Manual también.
          </div>
        </button>
      </section>

      <section className="seg-messages">
        {t.messages.map((m: Message) => (
          <div key={m.id} className={`seg-msg seg-msg-${m.direction}`}>
            <div className="seg-msg-head">
              <span className="seg-msg-from">{m.direction === "outbound" ? "Tú" : m.from}</span>
              <span className="seg-msg-date">{p.fmt(m.date)}</span>
            </div>
            <div className="seg-msg-body" dangerouslySetInnerHTML={{ __html: m.body_html || `<p>${(m.body_text ?? "").replace(/\n/g, "<br>")}</p>` }} />
          </div>
        ))}
      </section>

      {t.followups.length > 0 && (
        <section className="seg-card">
          <h3 className="li-h2" style={{ fontSize: 13 }}>Follow-ups</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {t.followups.map((f: Followup) => (
              <div key={f.id} className={`li-post li-post-${f.status}`}>
                <div className="li-post-head">
                  <span className={`li-badge li-badge-${f.status}`}>{f.status}</span>
                  <span className="li-post-when">
                    {f.status === "scheduled" ? "envío " + p.fmt(f.scheduled_at) : f.status === "sent" ? "enviado " + p.fmt(f.sent_at) : f.scheduled_at}
                    {" · "}{f.origin}
                  </span>
                </div>
                <div className="li-post-text" dangerouslySetInnerHTML={{ __html: f.body_html.slice(0, 400) }} />
                {f.error && <div className="li-post-err">{f.error}</div>}
                {f.status === "scheduled" && (
                  <div className="li-post-actions">
                    <button className="btn-ghost-sm" onClick={() => p.cancelFollowup(f.id)}>Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="seg-card">
        <h3 className="li-h2" style={{ fontSize: 13 }}>Responder</h3>
        <div className="li-row">
          <label className="li-label">Pista para la IA (opcional)</label>
          <input className="li-input" value={p.replyHint} onChange={(e: any) => p.setReplyHint(e.target.value)} placeholder="Ej: 'sé más directo y propón el martes 10:00'" />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn-ghost" onClick={p.aiReply} disabled={p.replying}>
            {p.replying ? "Generando…" : "✨ Sugerir respuesta IA"}
          </button>
          <button className="btn-ghost" onClick={p.openSchedule}>📅 Programar follow-up</button>
        </div>
        <textarea className="li-textarea" rows={10} value={p.replyHtml} onChange={(e: any) => p.setReplyHtml(e.target.value)} placeholder="<p>Tu respuesta aquí...</p>" />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn-primary" onClick={p.sendReply} disabled={!p.replyHtml || p.sending}>
            {p.sending ? "Enviando…" : "Enviar ahora"}
          </button>
        </div>
      </section>
    </>
  );
}
