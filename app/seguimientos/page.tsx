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
  contact_name?: string;
  contact_context?: string;
  tone?: string;
  objective?: string;
  custom_prompt?: string;
  contract_alert?: {
    detected_at: string;
    excerpt: string;
    acknowledged?: boolean;
  };
};

type ContractAlert = {
  thread_id: string;
  subject: string;
  contact_email: string;
  contact_name: string;
  excerpt: string;
  detected_at: string;
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
  const [autopilotWizardOpen, setAutopilotWizardOpen] = useState(false);
  const [contractAlerts, setContractAlerts] = useState<ContractAlert[]>([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [storageStatus, setStorageStatus] = useState<any>(null);
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
  const [composeAutopilotAfter, setComposeAutopilotAfter] = useState(false);

  // Schedule followup
  const [fuOpen, setFuOpen] = useState(false);
  const [fuBody, setFuBody] = useState("");
  const [fuWhen, setFuWhen] = useState("");
  const [fuSteps, setFuSteps] = useState<Array<{ when: string; body: string }>>([]);
  const [fuOrigin, setFuOrigin] = useState<"manual" | "ai_assisted" | "ai_auto">("manual");
  const [fuDateExtraction, setFuDateExtraction] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshStatus();
    refreshThreads();
    refreshSequences();
    loadContractAlerts();
    loadPendingApprovals();
    loadStorageStatus();
    const intervalMs = thread ? 12000 : 30000;
    let syncCounter = 0;
    const t = setInterval(() => {
      refreshThreads();
      loadContractAlerts();
      loadPendingApprovals();
      if (thread) loadThread(thread.id);
      syncCounter++;
      if (syncCounter % 2 === 0) {
        fetch("/api/email/sync", { method: "POST" }).catch(() => {});
      }
      // Cada ~1 min disparar el cron tick para que envíe los follow-ups vencidos
      // (mantiene scheduler alive incluso si Railway reinicia el proceso)
      if (syncCounter % 5 === 0) {
        fetch("/api/cron/tick").catch(() => {});
      }
    }, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

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
    // Si está OFF → abrir wizard para configurar antes de activar
    if (!thread.auto_pilot) {
      setAutopilotWizardOpen(true);
      return;
    }
    // Si está ON → desactivar directamente
    setFeedback("Desactivando…");
    const r = await fetch(`/api/email/threads/${thread.id}/autopilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }).then((r) => r.json());
    if (r.error) {
      setFeedback("⚠️ " + r.error);
    } else {
      setFeedback("✓ Auto-pilot desactivado.");
      loadThread(thread.id);
    }
    setTimeout(() => setFeedback(null), 5000);
  }

  async function activateAutopilotWithConfig(cfg: {
    contact_name: string;
    contact_context: string;
    tone: string;
    objective: string;
    custom_prompt: string;
    plan_now?: boolean;
    num_steps?: number;
    strategy?: string;
    send_first_immediately?: boolean;
    custom_days?: number[];
    default_hour?: number;
  }) {
    if (!thread) return;
    setFeedback("Activando auto-pilot…");
    const r = await fetch(`/api/email/threads/${thread.id}/autopilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        contact_name: cfg.contact_name,
        contact_context: cfg.contact_context,
        tone: cfg.tone,
        objective: cfg.objective,
        custom_prompt: cfg.custom_prompt,
      }),
    }).then((r) => r.json());

    if (r.error) {
      setFeedback("⚠️ " + r.error);
      setTimeout(() => setFeedback(null), 5000);
      return;
    }

    // Si se pidió planificar la secuencia, llamar al planificador
    if (cfg.plan_now) {
      setFeedback(
        cfg.send_first_immediately
          ? `🚀 Enviando el primero AHORA y programando ${(cfg.num_steps ?? 5) - 1} más…`
          : `🤖 Diseñando secuencia de ${cfg.num_steps ?? 5} follow-ups…`
      );
      try {
        const planRes = await fetch(`/api/email/threads/${thread.id}/plan-sequence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            num_steps: cfg.num_steps ?? 5,
            strategy: cfg.strategy ?? "Equilibrada",
            custom_days: cfg.custom_days,
            send_first_immediately: cfg.send_first_immediately === true,
            default_hour: cfg.default_hour ?? 10,
          }),
        }).then(r => r.json());

        if (planRes.error) {
          setFeedback("⚠️ Auto-pilot ON pero error planificando: " + planRes.error);
        } else {
          const sentMsg = planRes.sent_now > 0 ? `${planRes.sent_now} enviados ya · ` : "";
          setFeedback(`✓ Auto-pilot activado · ${sentMsg}${planRes.scheduled} programados en el calendario`);
        }
      } catch (e: any) {
        setFeedback("⚠️ Error: " + e.message);
      }
    } else {
      setFeedback("✓ Auto-pilot activado. La IA gestionará nuevas respuestas.");
    }

    setAutopilotWizardOpen(false);
    loadThread(thread.id);
    setTimeout(() => setFeedback(null), 8000);
  }

  async function acknowledgeContract(threadId: string) {
    await fetch(`/api/email/threads/${threadId}/autopilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledge_contract: true }),
    });
    loadContractAlerts();
    if (thread?.id === threadId) loadThread(threadId);
  }

  async function loadContractAlerts() {
    try {
      const j = await fetch("/api/email/contract-alerts").then(r => r.json());
      setContractAlerts(j.alerts ?? []);
    } catch {}
  }

  async function loadStorageStatus() {
    try {
      const j = await fetch("/api/debug/storage").then(r => r.json());
      setStorageStatus(j);
    } catch {}
  }

  async function forceSendNow() {
    setFeedback("⏳ Disparando envío de follow-ups vencidos…");
    try {
      const r = await fetch("/api/cron/tick").then(r => r.json());
      if (r.ok) {
        setFeedback(`✓ Tick ejecutado · ${r.sent} enviados · ${r.failed} fallaron`);
        refreshThreads();
      } else {
        setFeedback("⚠️ " + (r.error || "Error desconocido"));
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    }
    setTimeout(() => setFeedback(null), 8000);
  }

  async function manualSaveCheck() {
    setFeedback("⏳ Verificando guardado en Postgres…");
    try {
      const j = await fetch("/api/debug/storage").then(r => r.json());
      setStorageStatus(j);
      if (j.postgres?.connected && j.has_database_url) {
        const kv = j.postgres.kv_rows || "0";
        const blob = j.postgres.blob_rows || "0";
        setFeedback(`✓ Todo guardado en Postgres · ${kv} registros · ${blob} archivos`);
      } else if (!j.has_database_url) {
        setFeedback("⚠️ DATABASE_URL no configurado. Los datos NO se guardan.");
      } else {
        setFeedback("⚠️ Postgres no responde. " + (j.postgres?.error || "Error desconocido"));
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    }
    setTimeout(() => setFeedback(null), 6000);
  }

  async function loadPendingApprovals() {
    try {
      const j = await fetch("/api/email/followups/pending").then(r => r.json());
      setPendingApprovals(j.pending ?? []);
    } catch {}
  }

  async function approvePending(id: string, sendNow: boolean) {
    setFeedback(sendNow ? "📧 Enviando…" : "✓ Programado");
    try {
      const r = await fetch(`/api/email/followups/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send_now: sendNow }),
      }).then(r => r.json());
      if (r.error) setFeedback("⚠️ " + r.error);
      else {
        setFeedback(sendNow ? "✓ Enviado" : "✓ Programado");
        await loadPendingApprovals();
        if (thread) loadThread(thread.id);
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    }
    setTimeout(() => setFeedback(null), 4000);
  }

  async function cancelPending(id: string) {
    if (!confirm("¿Cancelar este borrador del autopilot?")) return;
    await fetch(`/api/email/followups/${id}/approve`, { method: "DELETE" });
    await loadPendingApprovals();
    if (thread) loadThread(thread.id);
  }

  async function editPendingBody(id: string, newBody: string) {
    await fetch(`/api/email/followups/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body_html: newBody, send_now: true }),
    });
    await loadPendingApprovals();
    if (thread) loadThread(thread.id);
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
          setFeedback("✓ Hilo creado · escuchando respuestas en bandeja");
        }
        setTo("");
        setSubject("");
        setBodyHtml("<p></p>");
        setFiles([]);
        setComposeSequenceId("");
        if (fileRef.current) fileRef.current.value = "";
        await refreshThreads();
        await loadThread(d.thread_id);
        // Si quería autopilot, abrir wizard tras crear hilo
        if (composeAutopilotAfter) {
          setTimeout(() => setAutopilotWizardOpen(true), 400);
        }
      }
    } finally {
      setSending(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  async function aiComposeFirst(opts: {
    contact_name?: string;
    objective?: string;
    topic?: string;
    tone?: string;
  }): Promise<{ subject?: string; body_html?: string; error?: string }> {
    if (!to.trim()) return { error: "Pon primero el email destinatario" };
    try {
      const r = await fetch("/api/email/ai/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          include_subject: true,
          ...opts,
        }),
      }).then(r => r.json());
      return r;
    } catch (e: any) {
      return { error: e.message };
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

  const [fuAiLoading, setFuAiLoading] = useState(false);
  async function aiGenerateFuBody() {
    if (!thread || fuAiLoading) return;
    setFuAiLoading(true);
    try {
      const hint = fuSteps.length > 0
        ? `Este es el paso ${fuSteps.length + 1} de una secuencia de follow-ups programados. Programado para ${fuWhen || "fecha próxima"}. Aporta valor nuevo, no repitas lo anterior.`
        : `Este es un follow-up programado para ${fuWhen || "fecha próxima"}. Tono natural, breve, con CTA claro.`;
      const r = await fetch("/api/email/ai/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: thread.id, hint }),
      }).then((r) => r.json());
      if (r.body_html) setFuBody(r.body_html);
      else if (r.error) setFeedback("⚠️ " + r.error);
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setFuAiLoading(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  }

  function addStep() {
    if (!fuBody || !fuWhen) return;
    setFuSteps((prev) => [...prev, { when: fuWhen, body: fuBody }]);
    // limpiar para el siguiente
    setFuBody("");
    setFuWhen("");
  }

  function removeStep(i: number) {
    setFuSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveFollowup() {
    if (!thread) return;
    // Combinar el paso actual (si lo hay) con los pasos ya añadidos
    const allSteps = [...fuSteps];
    if (fuBody && fuWhen) {
      allSteps.push({ when: fuWhen, body: fuBody });
    }
    if (allSteps.length === 0) return;

    let okCount = 0;
    for (const step of allSteps) {
      const r = await fetch("/api/email/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: thread.id,
          body_html: step.body,
          scheduled_at: new Date(step.when).toISOString(),
          origin: fuOrigin,
        }),
      }).then((r) => r.json()).catch(() => ({ error: "fallo" }));
      if (!r.error) okCount++;
    }

    if (okCount === 0) {
      setFeedback("⚠️ No se pudo programar ningún follow-up");
    } else {
      setFeedback(`✓ ${okCount} follow-up${okCount > 1 ? "s" : ""} programados · se cancelan si el prospect responde`);
      setFuSteps([]);
      setFuBody("");
      setFuWhen("");
      setFuOpen(false);
      if (thread) loadThread(thread.id);
    }
  }

  async function deleteThreadFromList(id: string) {
    setFeedback("Eliminando hilo…");
    try {
      await fetch(`/api/email/threads/${id}`, { method: "DELETE" });
      if (thread?.id === id) setThread(null);
      await refreshThreads();
      setFeedback("✓ Hilo eliminado");
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    }
    setTimeout(() => setFeedback(null), 4000);
  }

  async function cancelFollowup(id: string) {
    if (!confirm("¿Cancelar este follow-up?")) return;
    await fetch(`/api/email/followups/${id}`, { method: "DELETE" });
    if (thread) loadThread(thread.id);
    refreshThreads();
  }

  async function sendNowFollowup(id: string) {
    if (!confirm("¿Enviar AHORA este follow-up?\n\nSe enviará inmediatamente, sin esperar a la fecha programada.")) return;
    setFeedback("🚀 Enviando…");
    try {
      const r = await fetch(`/api/email/followups/${id}/send-now`, { method: "POST" }).then(r => r.json());
      if (r.error) {
        setFeedback("⚠️ " + r.error);
      } else {
        setFeedback(`✓ Enviado a ${r.sent_to}`);
        if (thread) loadThread(thread.id);
        refreshThreads();
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    }
    setTimeout(() => setFeedback(null), 5000);
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

      {/* Banner: aviso si Postgres no está conectado en producción */}
      {storageStatus && (!storageStatus.has_database_url || (storageStatus.postgres && !storageStatus.postgres.connected)) && (
        <div style={{
          background: "linear-gradient(135deg, #fef2f2, #fee2e2)",
          border: "2px solid #dc2626",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 18,
          display: "flex", gap: 14, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#991b1b", marginBottom: 4 }}>
              ¡ATENCIÓN! Tus datos NO se están guardando permanentemente.
            </div>
            <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.55, marginBottom: 8 }}>
              Railway no tiene la variable <code style={{ background: "#fecaca", padding: "1px 5px", borderRadius: 4 }}>DATABASE_URL</code> conectada al servicio. Por eso los seguimientos desaparecen cuando el servidor se reinicia.
            </div>
            <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.6, background: "rgba(255,255,255,0.5)", padding: "10px 12px", borderRadius: 8 }}>
              <strong>Cómo arreglarlo (2 min):</strong><br/>
              1. Ve a <a href="https://railway.app" target="_blank" rel="noreferrer" style={{ color: "#dc2626", fontWeight: 700 }}>railway.app</a> → tu proyecto → click en el servicio <strong>web</strong> (no en Postgres)<br/>
              2. Pestaña <strong>Variables</strong> → <strong>+ New Variable</strong> → <strong>Add Reference</strong><br/>
              3. Selecciona <strong>Postgres</strong> → variable <strong>DATABASE_URL</strong> → Add<br/>
              4. Espera 1-2 min al redeploy y refresca esta página
            </div>
          </div>
          <button
            onClick={loadStorageStatus}
            style={{
              padding: "6px 12px", background: "#dc2626", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            }}
          >
            Recomprobar
          </button>
        </div>
      )}

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
              <a className="btn-ghost" href="/seguimientos/calendario" title="Ver calendario de seguimientos programados" style={{ textDecoration: "none" }}>
                📅 Calendario
              </a>
              <button className="btn-ghost" onClick={() => setMemoryOpen(true)} title="Memoria que el autopilot usa al redactar">
                🧠 Memoria
              </button>
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
                onClick={forceSendNow}
                title="Forzar envío de follow-ups vencidos ahora"
                style={{
                  padding: "7px 14px",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 2px 8px rgba(245,158,11,0.3)",
                }}
              >
                🚀 Enviar ahora
              </button>
              <button
                onClick={manualSaveCheck}
                title="Verificar que todo está guardado en Postgres"
                style={{
                  padding: "7px 14px",
                  background: storageStatus?.postgres?.connected
                    ? "linear-gradient(135deg, #10b981, #059669)"
                    : storageStatus?.has_database_url === false
                      ? "linear-gradient(135deg, #ef4444, #dc2626)"
                      : "linear-gradient(135deg, #0071e3, #1d4ed8)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: "0 2px 8px rgba(15,23,42,0.15)",
                }}
              >
                {storageStatus?.postgres?.connected ? "✓ Guardado" :
                 storageStatus?.has_database_url === false ? "⚠ Sin DB" :
                 "💾 Guardar"}
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
                      onDelete={() => deleteThreadFromList(t.id)}
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
                  autopilotAfter={composeAutopilotAfter}
                  setAutopilotAfter={setComposeAutopilotAfter}
                  aiCompose={aiComposeFirst}
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
                  sendNowFollowup={sendNowFollowup}
                  reloadThread={() => loadThread(thread.id)}
                  markClosed={markClosed}
                  deleteThread={deleteThreadFromList}
                  myEmail={status?.email}
                  toggleAutopilot={toggleAutopilot}
                  sequences={sequences}
                  applySequenceToThread={async (seqId: string): Promise<{ ok: boolean; scheduled?: number; error?: string }> => {
                    if (!thread) return { ok: false, error: "Hilo no seleccionado" };
                    if (!seqId)  return { ok: false, error: "Selecciona una secuencia" };
                    setFeedback("⏳ Aplicando secuencia…");
                    try {
                      const r = await fetch("/api/email/sequences/apply", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sequence_id: seqId, thread_id: thread.id }),
                      }).then((r) => r.json());
                      if (r.error) {
                        setFeedback("⚠️ " + r.error);
                        setTimeout(() => setFeedback(null), 5000);
                        return { ok: false, error: r.error };
                      }
                      setFeedback(`✓ Secuencia aplicada · ${r.scheduled} follow-ups programados`);
                      await loadThread(thread.id);
                      setTimeout(() => setFeedback(null), 5000);
                      return { ok: true, scheduled: r.scheduled };
                    } catch (e: any) {
                      setFeedback("⚠️ " + e.message);
                      setTimeout(() => setFeedback(null), 5000);
                      return { ok: false, error: e.message };
                    }
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Programar follow-ups</div>
                <div className="modal-sub">Añade uno o varios pasos · si el prospect responde, se cancelan automáticamente</div>
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

              {/* Lista de pasos ya añadidos */}
              {fuSteps.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>
                    📅 Pasos programados ({fuSteps.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {fuSteps.map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 12px",
                        background: "var(--bg-elev-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 9,
                      }}>
                        <div style={{
                          minWidth: 28, height: 28, borderRadius: 99,
                          background: "var(--accent)", color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700,
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {new Date(s.when).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                            {s.body.replace(/<[^>]+>/g, " ").slice(0, 80)}
                          </div>
                        </div>
                        <button
                          onClick={() => removeStep(i)}
                          style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-faint)", padding: "4px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Atajos rápidos de fecha */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {[
                  { label: "Mañana 9:00", days: 1, hour: 9 },
                  { label: "+3 días 9:00", days: 3, hour: 9 },
                  { label: "+7 días 9:00", days: 7, hour: 9 },
                  { label: "+14 días 9:00", days: 14, hour: 9 },
                  { label: "+30 días 9:00", days: 30, hour: 9 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + preset.days);
                      d.setHours(preset.hour, 0, 0, 0);
                      // Format para datetime-local: YYYY-MM-DDTHH:mm
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setFuWhen(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                    }}
                    style={{
                      padding: "5px 11px",
                      background: "var(--bg-elev-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 99, fontSize: 11.5, fontWeight: 600,
                      color: "var(--text-dim)", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="li-row">
                <label className="li-label">Fecha y hora</label>
                <input type="datetime-local" className="li-input" value={fuWhen} onChange={(e) => setFuWhen(e.target.value)} />
              </div>
              <div className="li-row">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label className="li-label" style={{ margin: 0 }}>Texto (HTML)</label>
                  <button
                    onClick={aiGenerateFuBody}
                    disabled={fuAiLoading || !thread}
                    style={{
                      padding: "5px 12px",
                      background: "linear-gradient(135deg, rgba(99,102,241,0.1), rgba(0,113,227,0.1))",
                      border: "1px solid var(--accent)",
                      borderRadius: 8,
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "var(--accent)",
                      cursor: fuAiLoading ? "wait" : "pointer",
                      fontFamily: "inherit",
                      opacity: fuAiLoading ? 0.6 : 1,
                    }}
                    title="Generar texto con IA basándose en el hilo y la fecha"
                  >
                    {fuAiLoading ? "🪄 Creando…" : "✨ Crear con IA"}
                  </button>
                </div>
                <textarea className="li-textarea" rows={10} value={fuBody} onChange={(e) => setFuBody(e.target.value)} />
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={addStep}
                  disabled={!fuBody || !fuWhen}
                  style={{
                    padding: "9px 14px",
                    background: "#fff", color: "var(--accent)",
                    border: "1.5px solid var(--accent)",
                    borderRadius: 9, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit",
                    opacity: (!fuBody || !fuWhen) ? 0.5 : 1,
                  }}
                >
                  + Añadir otro paso
                </button>
                <button
                  className="btn-primary"
                  onClick={saveFollowup}
                  disabled={fuSteps.length === 0 && (!fuBody || !fuWhen)}
                >
                  🚀 Programar {fuSteps.length + (fuBody && fuWhen ? 1 : 0)} follow-up
                  {(fuSteps.length + (fuBody && fuWhen ? 1 : 0)) !== 1 ? "s" : ""}
                </button>
                <button className="btn-ghost" onClick={() => { setFuOpen(false); setFuSteps([]); }}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Contract alerts banner (flotante arriba a la derecha) */}
      {contractAlerts.length > 0 && (
        <div style={{
          position: "fixed", top: 20, right: 20,
          zIndex: 50, display: "flex", flexDirection: "column", gap: 10,
          maxWidth: 380,
        }}>
          {contractAlerts.map(a => (
            <div key={a.thread_id} style={{
              background: "#fff",
              border: "1.5px solid rgba(245,158,11,0.4)",
              borderLeft: "4px solid #f59e0b",
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>📝</span>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>
                  Petición de contrato
                </div>
                <button
                  onClick={() => acknowledgeContract(a.thread_id)}
                  style={{
                    marginLeft: "auto", background: "transparent", border: "none",
                    color: "var(--text-faint)", cursor: "pointer", fontSize: 16,
                  }}
                  title="Marcar como visto"
                >×</button>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                {a.contact_name}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 6 }}>
                {a.subject}
              </div>
              <div style={{
                fontSize: 12, color: "var(--text-dim)",
                background: "var(--bg-elev-3)", padding: "7px 10px",
                borderRadius: 8, fontStyle: "italic",
                lineHeight: 1.5,
                maxHeight: 80, overflow: "hidden",
              }}>
                "{a.excerpt.slice(0, 180)}{a.excerpt.length > 180 ? "..." : ""}"
              </div>
              <button
                onClick={() => { loadThread(a.thread_id); }}
                style={{
                  marginTop: 8, padding: "6px 12px",
                  background: "#f59e0b", color: "#fff",
                  border: "none", borderRadius: 8,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  width: "100%",
                }}
              >
                Abrir hilo y responder →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Banner de aprobaciones pendientes (Autopilot generó respuesta, pide confirmación) */}
      {pendingApprovals.length > 0 && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 60, display: "flex", flexDirection: "column", gap: 10,
          width: "92%", maxWidth: 640,
        }}>
          {pendingApprovals.map(pa => (
            <PendingApprovalCard
              key={pa.id}
              item={pa}
              onApprove={(sendNow) => approvePending(pa.id, sendNow)}
              onCancel={() => cancelPending(pa.id)}
              onEditAndSend={(body) => editPendingBody(pa.id, body)}
            />
          ))}
        </div>
      )}

      {/* Autopilot Setup Wizard */}
      {autopilotWizardOpen && thread && (
        <AutopilotWizard
          thread={thread}
          onClose={() => setAutopilotWizardOpen(false)}
          onActivate={activateAutopilotWithConfig}
        />
      )}

      {/* Memoria Seguimientos */}
      {memoryOpen && (
        <SeguimientosMemoryModal onClose={() => setMemoryOpen(false)} />
      )}
    </div>
  );
}

// ============== Autopilot Setup Wizard ==============

function AutopilotWizard({
  thread,
  onClose,
  onActivate,
}: {
  thread: Thread;
  onClose: () => void;
  onActivate: (cfg: {
    contact_name: string;
    contact_context: string;
    tone: string;
    objective: string;
    custom_prompt: string;
    plan_now: boolean;
    num_steps: number;
    strategy: string;
    send_first_immediately: boolean;
    custom_days: number[];
    default_hour: number;
  }) => void;
}) {
  const initialName =
    thread.contact_name ||
    (() => {
      const prospect = thread.participants.find(p => !/onepulso\.online$/i.test(p))
        || thread.participants[0] || "";
      const local = prospect.split("@")[0] || "";
      return local
        .replace(/[._-]+/g, " ")
        .split(" ").filter(Boolean)
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(" ");
    })();

  const [contactName, setContactName] = useState(initialName);
  const [contactContext, setContactContext] = useState(thread.contact_context || "");
  const [tone, setTone] = useState(thread.tone || "Directo, personal, sin floritura. Castellano España.");
  const [objective, setObjective] = useState(thread.objective || "Cerrar reunión de 10-15 min para enseñar el producto.");
  const [customPrompt, setCustomPrompt] = useState(thread.custom_prompt || "");
  const [activating, setActivating] = useState(false);

  // Sequence planning
  const [planNow, setPlanNow] = useState(true);
  const [numSteps, setNumSteps] = useState(5);
  const [strategy, setStrategy] = useState("Equilibrada: recordatorio suave → caso/valor → pregunta → último intento");
  const [sendFirstNow, setSendFirstNow] = useState(false);
  const [customDaysMode, setCustomDaysMode] = useState<"preset" | "custom">("preset");
  const [customDays, setCustomDays] = useState("0, 3, 7, 14, 21");
  const [defaultHour, setDefaultHour] = useState(10);

  // Presets de espaciado según numSteps
  const PRESET_DAYS: Record<number, number[]> = {
    3:  [0, 4, 10],
    5:  [0, 3, 7, 14, 21],
    7:  [0, 2, 5, 9, 14, 21, 30],
    10: [0, 2, 4, 7, 11, 16, 22, 30, 45, 60],
  };

  // Cuando cambia numSteps en modo preset, sincronizar customDays
  useEffect(() => {
    if (customDaysMode === "preset") {
      setCustomDays((PRESET_DAYS[numSteps] || []).join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numSteps, customDaysMode]);

  const TONE_PRESETS = [
    { label: "Directo y técnico", value: "Directo y técnico. Datos concretos. Sin emojis. Castellano España." },
    { label: "Cercano y amigable", value: "Cercano, amigable, conversacional. Tuteamos. Castellano España." },
    { label: "Formal corporate", value: "Formal pero natural. Castellano España. Sin coloquialismos." },
    { label: "Breve y al grano", value: "Frases muy cortas. Una idea por mensaje. Sin rodeos. Castellano España." },
  ];

  const OBJECTIVE_PRESETS = [
    "Cerrar reunión de 10-15 min para enseñar el producto.",
    "Conseguir trial gratuito de 14 días.",
    "Enviar propuesta económica formal.",
    "Avanzar a llamada con decision-maker.",
    "Cerrar venta del plan Pro.",
  ];

  function activate() {
    setActivating(true);
    const parsedDays = customDays
      .split(",")
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 0 && n <= 365);

    onActivate({
      contact_name: contactName.trim(),
      contact_context: contactContext.trim(),
      tone: tone.trim(),
      objective: objective.trim(),
      custom_prompt: customPrompt.trim(),
      plan_now: planNow,
      num_steps: numSteps,
      strategy: strategy.trim(),
      send_first_immediately: sendFirstNow,
      custom_days: parsedDays,
      default_hour: defaultHour,
    });
  }

  const STRATEGIES = [
    { id: "Equilibrada: recordatorio suave → caso/valor → pregunta → último intento", label: "⚖️ Equilibrada", desc: "Mezcla recordatorio + valor + pregunta" },
    { id: "Agresiva: persistente, mucho CTA, último intento contundente", label: "🔥 Agresiva", desc: "Más insistente, CTAs fuertes" },
    { id: "Suave: aporta valor sin pedir nada hasta el final", label: "🌱 Suave", desc: "Aporta valor antes de pedir" },
    { id: "Educativa: cada follow-up enseña algo (caso, dato, insight)", label: "📚 Educativa", desc: "Casos, datos, insights" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "grid", placeItems: "center",
        zIndex: 100, backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 18,
          width: "92%", maxWidth: 600, maxHeight: "92vh", overflowY: "auto",
          padding: 28,
          boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700,
              letterSpacing: "-0.02em", color: "var(--text)",
            }}>
              🤖 Configurar Autopilot
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
              Define cómo quieres que la IA gestione las respuestas con <strong>{thread.participants.find(p => !/onepulso\.online$/i.test(p))}</strong>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              fontSize: 22, color: "var(--text-faint)", cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* Cómo funciona */}
        <div style={{
          marginTop: 14, marginBottom: 16,
          background: "rgba(0,113,227,0.06)",
          border: "1px solid rgba(0,113,227,0.18)",
          borderRadius: 12, padding: "11px 14px",
          fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "var(--accent)" }}>Cómo funciona:</strong> cuando el contacto te responda, la IA leerá el mensaje, extraerá fechas
          (ej. "finales de la semana que viene" → viernes 17:00), redactará la respuesta usando este contexto y la programará
          en el calendario. Si te <strong>pide contrato/propuesta</strong>, se pausa y te avisa.
        </div>

        {/* Nombre del contacto */}
        <label style={wLabel}>Nombre del contacto</label>
        <input
          value={contactName}
          onChange={e => setContactName(e.target.value)}
          placeholder="Ej: Ahmed Smith"
          style={wInput}
        />

        {/* Contexto */}
        <label style={{ ...wLabel, marginTop: 14 }}>
          Contexto del contacto <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— qué sabes de él/ella</span>
        </label>
        <textarea
          value={contactContext}
          onChange={e => setContactContext(e.target.value)}
          rows={4}
          placeholder={`Ej:
- CTO de SaaS B2B de 30 personas
- Hablamos del trial del módulo de IA
- Le interesa la integración con HubSpot
- Objeción anterior: precio comparado con Lemlist`}
          style={{ ...wInput, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55 }}
        />

        {/* Tono */}
        <label style={{ ...wLabel, marginTop: 14 }}>Tono de las respuestas</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {TONE_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              onClick={() => setTone(p.value)}
              style={{
                padding: "5px 12px", borderRadius: 99,
                border: "1px solid",
                borderColor: tone === p.value ? "var(--accent)" : "var(--border)",
                background: tone === p.value ? "var(--accent-soft)" : "#fff",
                color: tone === p.value ? "var(--accent)" : "var(--text-dim)",
                fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              }}
            >{p.label}</button>
          ))}
        </div>
        <textarea
          value={tone}
          onChange={e => setTone(e.target.value)}
          rows={2}
          style={{ ...wInput, resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
        />

        {/* Objetivo */}
        <label style={{ ...wLabel, marginTop: 14 }}>Objetivo del seguimiento</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {OBJECTIVE_PRESETS.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setObjective(o)}
              style={{
                padding: "5px 12px", borderRadius: 99,
                border: "1px solid",
                borderColor: objective === o ? "var(--accent)" : "var(--border)",
                background: objective === o ? "var(--accent-soft)" : "#fff",
                color: objective === o ? "var(--accent)" : "var(--text-dim)",
                fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              }}
            >{o.length > 36 ? o.slice(0, 36) + "..." : o}</button>
          ))}
        </div>
        <input
          value={objective}
          onChange={e => setObjective(e.target.value)}
          placeholder="Ej: Cerrar reunión de 30 min con el CTO"
          style={wInput}
        />

        {/* Prompt extra */}
        <label style={{ ...wLabel, marginTop: 14 }}>
          Instrucciones extra <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>(opcional)</span>
        </label>
        <textarea
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          rows={3}
          placeholder={`Ej:
- Nunca menciones precios sin que él los pregunte
- Si propone reunión, ofrécele Calendly: cal.com/onepulso
- Hablamos en español aunque escriba en inglés`}
          style={{ ...wInput, resize: "vertical", fontFamily: "inherit" }}
        />

        {/* PLANIFICACIÓN DE SECUENCIA */}
        <div style={{
          marginTop: 18, padding: 16,
          background: "linear-gradient(135deg, rgba(0,113,227,0.05), rgba(99,102,241,0.04))",
          border: "1.5px solid rgba(0,113,227,0.2)",
          borderRadius: 14,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: 10, justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>
                🚀 Planificar secuencia ahora
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                La IA generará {numSteps} follow-ups y los meterá en el calendario al instante
              </div>
            </div>
            {/* Toggle */}
            <div
              onClick={() => setPlanNow(!planNow)}
              style={{
                width: 44, height: 24, borderRadius: 999, flexShrink: 0,
                background: planNow ? "var(--accent)" : "var(--bg-elev-3)",
                position: "relative", cursor: "pointer", transition: "background 0.18s",
              }}
            >
              <div style={{
                position: "absolute", top: 2, left: planNow ? 22 : 2,
                width: 20, height: 20, borderRadius: 999, background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.18s",
              }} />
            </div>
          </div>

          {planNow && (
            <>
              {/* Number of steps */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <label style={{ ...wLabel, marginBottom: 0, flexShrink: 0 }}>Cuántos follow-ups</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[3, 5, 7, 10].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNumSteps(n)}
                      style={{
                        width: 36, height: 32, borderRadius: 8,
                        border: "1px solid",
                        borderColor: numSteps === n ? "var(--accent)" : "var(--border)",
                        background: numSteps === n ? "var(--accent)" : "#fff",
                        color: numSteps === n ? "#fff" : "var(--text-dim)",
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>

              {/* Strategy */}
              <label style={wLabel}>Estrategia</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {STRATEGIES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStrategy(s.id)}
                    style={{
                      textAlign: "left", padding: "8px 10px",
                      borderRadius: 9,
                      border: "1px solid",
                      borderColor: strategy === s.id ? "var(--accent)" : "var(--border)",
                      background: strategy === s.id ? "var(--accent-soft)" : "#fff",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <div style={{
                      fontSize: 12.5, fontWeight: 700,
                      color: strategy === s.id ? "var(--accent)" : "var(--text)",
                      marginBottom: 2,
                    }}>{s.label}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.4 }}>
                      {s.desc}
                    </div>
                  </button>
                ))}
              </div>

              {/* Días entre follow-ups (preset / custom) */}
              <label style={{ ...wLabel, marginTop: 14 }}>Días entre cada follow-up</label>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setCustomDaysMode("preset");
                    setCustomDays((PRESET_DAYS[numSteps] || []).join(", "));
                  }}
                  style={{
                    padding: "5px 12px", borderRadius: 8,
                    border: "1px solid",
                    borderColor: customDaysMode === "preset" ? "var(--accent)" : "var(--border)",
                    background: customDaysMode === "preset" ? "var(--accent-soft)" : "#fff",
                    color: customDaysMode === "preset" ? "var(--accent)" : "var(--text-dim)",
                    fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  }}
                >Preset</button>
                <button
                  type="button"
                  onClick={() => setCustomDaysMode("custom")}
                  style={{
                    padding: "5px 12px", borderRadius: 8,
                    border: "1px solid",
                    borderColor: customDaysMode === "custom" ? "var(--accent)" : "var(--border)",
                    background: customDaysMode === "custom" ? "var(--accent-soft)" : "#fff",
                    color: customDaysMode === "custom" ? "var(--accent)" : "var(--text-dim)",
                    fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  }}
                >Personalizado</button>
              </div>
              <input
                value={customDays}
                onChange={e => {
                  setCustomDays(e.target.value);
                  setCustomDaysMode("custom");
                }}
                placeholder="0, 3, 7, 14, 21"
                style={{ ...wInput, fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
              <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4 }}>
                Ej: <code>0, 2, 5, 10</code> = primer follow-up hoy, luego día 2, día 5, día 10
              </div>

              {/* Hora del envío */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
                <label style={{ ...wLabel, marginBottom: 0 }}>Hora de envío</label>
                <select
                  value={defaultHour}
                  onChange={e => setDefaultHour(parseInt(e.target.value))}
                  style={{ ...wInput, width: 110, fontFamily: "inherit" }}
                >
                  {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  (hora local española)
                </span>
              </div>

              {/* Send first immediately */}
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                marginTop: 14, padding: 12,
                background: sendFirstNow ? "rgba(245,158,11,0.08)" : "var(--bg-elev-2)",
                border: "1px solid",
                borderColor: sendFirstNow ? "rgba(245,158,11,0.3)" : "var(--border)",
                borderRadius: 12,
                cursor: "pointer",
              }}
                onClick={() => setSendFirstNow(!sendFirstNow)}
              >
                <div style={{
                  width: 36, height: 20, borderRadius: 99, flexShrink: 0,
                  background: sendFirstNow ? "#f59e0b" : "var(--bg-elev-3)",
                  position: "relative", marginTop: 2,
                  transition: "background 0.18s",
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: sendFirstNow ? 18 : 2,
                    width: 16, height: 16, borderRadius: 99, background: "#fff",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.18s",
                  }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: sendFirstNow ? "#92400e" : "var(--text)" }}>
                    🚀 Enviar el primer follow-up AHORA
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.5 }}>
                    Envía inmediatamente el step 1 por email. Los siguientes se quedan programados en el calendario.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Botones */}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={wBtnSecondary}>Cancelar</button>
          <button
            onClick={activate}
            disabled={activating || !contactName.trim() || !objective.trim()}
            style={{
              ...wBtnPrimary, flex: 1,
              opacity: (activating || !contactName.trim() || !objective.trim()) ? 0.5 : 1,
            }}
          >
            {activating
              ? (planNow ? `🤖 Generando ${numSteps} follow-ups...` : "Activando...")
              : (planNow ? `🚀 Activar y planificar ${numSteps} follow-ups` : "🤖 Activar Autopilot")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== Memoria de Seguimientos ==============

function SeguimientosMemoryModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ slug?: string; title: string; content: string } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/memory").then(r => r.json());
      // Mostrar solo las de seguimientos + las generales (que el autopilot usa todas)
      setEntries(r.entries ?? []);
    } finally { setLoading(false); }
  }

  async function save() {
    if (!editing || !editing.title.trim() || !editing.content.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: editing.slug,
          title: editing.title.trim(),
          category: "seguimientos",
          content: editing.content.trim(),
        }),
      });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(slug: string) {
    if (!confirm("¿Eliminar esta entrada de memoria?")) return;
    await fetch("/api/memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    await load();
  }

  const seguimientosEntries = entries.filter(e => e.category === "seguimientos");
  const otherEntries = entries.filter(e => e.category !== "seguimientos");

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
      display: "grid", placeItems: "center", zIndex: 100, backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 18,
        width: "92%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto",
        padding: 26,
        boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700,
              letterSpacing: "-0.02em", color: "var(--text)",
            }}>
              🧠 Memoria de Seguimientos
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.5 }}>
              Conocimiento que la IA usará al redactar en autopilot. Ej: tu tono, propuesta de valor, casos de éxito, objeciones típicas.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none",
            fontSize: 22, color: "var(--text-faint)", cursor: "pointer",
          }}>×</button>
        </div>

        {/* Editor */}
        {editing ? (
          <div style={{
            background: "var(--bg-elev-2)", border: "1px solid var(--border)",
            borderRadius: 14, padding: 16, marginBottom: 14,
          }}>
            <label style={wLabel}>Título</label>
            <input
              value={editing.title}
              onChange={e => setEditing({ ...editing, title: e.target.value })}
              placeholder="Ej: Mi propuesta de valor"
              style={wInput}
            />
            <label style={{ ...wLabel, marginTop: 10 }}>Contenido</label>
            <textarea
              value={editing.content}
              onChange={e => setEditing({ ...editing, content: e.target.value })}
              rows={6}
              placeholder={`Ej:
- Vendemos plataforma SaaS de outreach con IA
- Pricing: 99€/mes (Pro) y 299€/mes (Team)
- Caso de éxito: HubSpot Partners cerró 12 deals en 30 días`}
              style={{ ...wInput, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setEditing(null)} style={wBtnSecondary}>Cancelar</button>
              <button
                onClick={save}
                disabled={saving || !editing.title.trim() || !editing.content.trim()}
                style={{
                  ...wBtnPrimary, flex: 1,
                  opacity: (saving || !editing.title.trim() || !editing.content.trim()) ? 0.5 : 1,
                }}
              >
                {saving ? "Guardando..." : "💾 Guardar"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing({ title: "", content: "" })}
            style={{
              ...wBtnPrimary, width: "100%", marginBottom: 14,
              padding: "11px 16px", fontSize: 13.5,
            }}
          >
            + Añadir nueva entrada
          </button>
        )}

        {/* Lista */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--text-faint)", fontSize: 12 }}>
            Cargando…
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 }}>
              Para seguimientos ({seguimientosEntries.length})
            </div>
            {seguimientosEntries.length === 0 ? (
              <div style={{ padding: 14, textAlign: "center", color: "var(--text-faint)", fontSize: 12.5, background: "var(--bg-elev-2)", borderRadius: 10 }}>
                Aún no hay memoria específica de seguimientos
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {seguimientosEntries.map(e => (
                  <MemoryCard key={e.slug} entry={e} onEdit={() => setEditing(e)} onDelete={() => remove(e.slug)} />
                ))}
              </div>
            )}

            {otherEntries.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)", marginTop: 16, marginBottom: 8 }}>
                  Memoria global compartida ({otherEntries.length}) — la IA también la usa
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {otherEntries.map(e => (
                    <MemoryCard key={e.slug} entry={e} onEdit={() => setEditing(e)} onDelete={() => remove(e.slug)} muted />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MemoryCard({ entry, onEdit, onDelete, muted }: { entry: any; onEdit: () => void; onDelete: () => void; muted?: boolean }) {
  return (
    <div style={{
      background: muted ? "var(--bg-elev-2)" : "#fff",
      border: "1px solid var(--border)",
      borderRadius: 12, padding: "11px 14px",
      transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {entry.title}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
            {entry.category}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} style={{
            padding: "4px 9px", fontSize: 11, fontWeight: 600,
            border: "1px solid var(--border)", borderRadius: 7,
            background: "#fff", color: "var(--text-dim)", cursor: "pointer",
          }}>Editar</button>
          <button onClick={onDelete} style={{
            padding: "4px 9px", fontSize: 11, fontWeight: 600,
            border: "1px solid rgba(239,68,68,0.2)", borderRadius: 7,
            background: "rgba(239,68,68,0.06)", color: "#dc2626", cursor: "pointer",
          }}>×</button>
        </div>
      </div>
      <div style={{
        fontSize: 12, color: "var(--text-dim)",
        whiteSpace: "pre-wrap", lineHeight: 1.55,
        maxHeight: 100, overflowY: "auto",
      }}>
        {entry.content}
      </div>
    </div>
  );
}

const wLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6,
};
const wInput: React.CSSProperties = {
  width: "100%", padding: "10px 13px", background: "var(--bg-elev-2)",
  border: "1.5px solid var(--border)", borderRadius: 10,
  fontSize: 13.5, color: "var(--text)", outline: "none", boxSizing: "border-box",
};
const wBtnPrimary: React.CSSProperties = {
  padding: "10px 16px", background: "var(--accent)", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700,
  cursor: "pointer", boxShadow: "0 2px 8px rgba(0,113,227,0.25)", fontFamily: "inherit",
};
const wBtnSecondary: React.CSSProperties = {
  padding: "10px 16px", background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10, fontSize: 13.5,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

// ============== Pending Approval Card (Autopilot espera tu OK) ==============

function PendingApprovalCard({
  item,
  onApprove,
  onCancel,
  onEditAndSend,
}: {
  item: any;
  onApprove: (sendNow: boolean) => void;
  onCancel: () => void;
  onEditAndSend: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState<string>(item.body_html || "");
  const [busy, setBusy] = useState(false);

  const scheduledDate = new Date(item.scheduled_at);
  const now = new Date();
  const isFuture = scheduledDate > now;

  function fmtDate(d: Date) {
    return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div style={{
      background: "#ffffff",
      border: "1.5px solid rgba(67,97,238,0.4)",
      borderLeft: "5px solid #4361ee",
      borderRadius: 14,
      padding: "14px 16px",
      boxShadow: "0 12px 32px rgba(15,23,42,0.18)",
      animation: "msgIn 0.3s ease-out",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }}>
            Autopilot quiere enviar a {item.contact_name}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
            {item.contact_email} · {isFuture ? `Programado para ${fmtDate(scheduledDate)}` : "Listo para enviar"}
          </div>
        </div>
        <button
          onClick={onCancel}
          title="Cancelar borrador"
          style={{ background: "transparent", border: "none", fontSize: 18, color: "var(--text-faint)", cursor: "pointer" }}
        >×</button>
      </div>

      {item.last_inbound_excerpt && (
        <div style={{
          fontSize: 11.5, color: "var(--text-dim)",
          background: "var(--bg-elev-2)",
          padding: "7px 10px", borderRadius: 8,
          marginBottom: 10, fontStyle: "italic",
        }}>
          📨 Te dijo: <span style={{ color: "var(--text)" }}>"{item.last_inbound_excerpt.slice(0, 140)}{item.last_inbound_excerpt.length > 140 ? "..." : ""}"</span>
        </div>
      )}

      {editing ? (
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          style={{
            width: "100%", padding: "9px 11px",
            border: "1px solid var(--border)", borderRadius: 9,
            fontSize: 12.5, fontFamily: "inherit", resize: "vertical",
            color: "var(--text)", outline: "none",
            boxSizing: "border-box", marginBottom: 10,
          }}
        />
      ) : (
        <div
          style={{
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "9px 12px",
            fontSize: 12.5, color: "var(--text)",
            lineHeight: 1.55, marginBottom: 10,
            maxHeight: 180, overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: item.body_html }}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {editing ? (
          <>
            <button
              onClick={() => { setBusy(true); onEditAndSend(body); }}
              disabled={busy}
              style={btnConfirm}
            >
              {busy ? "Enviando…" : "📧 Enviar editado"}
            </button>
            <button
              onClick={() => { setEditing(false); setBody(item.body_html); }}
              style={btnGhost}
            >
              Volver
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setBusy(true); onApprove(true); }}
              disabled={busy}
              style={btnConfirm}
            >
              {busy ? "Enviando…" : "✓ Confirmar y enviar"}
            </button>
            {isFuture && (
              <button
                onClick={() => onApprove(false)}
                style={btnSecondaryStyle}
              >
                ⏰ Programar para {fmtDate(scheduledDate)}
              </button>
            )}
            <button onClick={() => setEditing(true)} style={btnGhost}>
              ✏️ Editar
            </button>
            <button onClick={onCancel} style={btnDanger}>
              Descartar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const btnConfirm: React.CSSProperties = {
  padding: "9px 16px", background: "var(--accent)", color: "#fff",
  border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
  cursor: "pointer", boxShadow: "0 2px 8px rgba(67,97,238,0.3)",
  fontFamily: "inherit",
};
const btnSecondaryStyle: React.CSSProperties = {
  padding: "9px 14px", background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 9, fontSize: 12.5,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px", background: "transparent", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 9, fontSize: 12.5,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const btnDanger: React.CSSProperties = {
  padding: "9px 14px", background: "transparent", color: "var(--error)",
  border: "1px solid rgba(239,68,68,0.25)", borderRadius: 9, fontSize: 12.5,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

// ============== Aplicar secuencia card ==============

function ApplySequenceCard({
  sequences,
  apply,
}: {
  sequences: Sequence[];
  apply: (seqId: string) => Promise<{ ok: boolean; scheduled?: number; error?: string }>;
}) {
  const [selected, setSelected] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleApply() {
    if (!selected) {
      setDone({ ok: false, msg: "Elige una secuencia primero" });
      return;
    }
    setApplying(true);
    setDone(null);
    try {
      const r = await apply(selected);
      if (r.ok) {
        setDone({ ok: true, msg: `✓ ${r.scheduled} follow-ups programados` });
        setSelected("");
      } else {
        setDone({ ok: false, msg: "⚠️ " + (r.error || "Error desconocido") });
      }
    } catch (e: any) {
      setDone({ ok: false, msg: "⚠️ " + e.message });
    } finally {
      setApplying(false);
      setTimeout(() => setDone(null), 6000);
    }
  }

  return (
    <div className="seg-action-card" style={{ cursor: "default" }}>
      <div className="seg-action-icon">🔁</div>
      <div className="seg-action-title">Aplicar secuencia</div>
      <div className="seg-action-desc">Plantilla de follow-ups con delays automáticos. Se cancelan solos si el prospect responde.</div>

      {sequences.length === 0 ? (
        <div style={{
          fontSize: 11.5, color: "var(--text-faint)", marginTop: 8,
          padding: "8px 10px", background: "var(--bg-elev-2)",
          border: "1px solid var(--border)", borderRadius: 8,
        }}>
          Aún no hay secuencias creadas. Ve a la pestaña <strong>Secuencias</strong> arriba para crear una.
        </div>
      ) : (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={applying}
            style={{
              marginTop: 8,
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              padding: "9px 11px",
              fontSize: 12.5,
              width: "100%",
              fontFamily: "inherit",
              cursor: applying ? "not-allowed" : "pointer",
            }}
          >
            <option value="">— Elige una secuencia —</option>
            {sequences.map((s: Sequence) => (
              <option key={s.id} value={s.id}>{s.name} ({s.steps.length} steps)</option>
            ))}
          </select>

          <button
            onClick={handleApply}
            disabled={!selected || applying}
            style={{
              marginTop: 8,
              padding: "9px 14px",
              background: selected && !applying ? "var(--accent)" : "var(--bg-elev-3)",
              color: selected && !applying ? "#fff" : "var(--text-faint)",
              border: "none",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: selected && !applying ? "pointer" : "not-allowed",
              width: "100%",
              fontFamily: "inherit",
              boxShadow: selected && !applying ? "0 2px 8px rgba(0,113,227,0.25)" : "none",
              transition: "all 0.15s",
            }}
          >
            {applying ? "⏳ Aplicando…" : "🔁 Aplicar secuencia"}
          </button>

          {done && (
            <div style={{
              marginTop: 8,
              padding: "7px 11px",
              background: done.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)",
              border: "1px solid",
              borderColor: done.ok ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)",
              color: done.ok ? "#059669" : "#dc2626",
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
            }}>
              {done.msg}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============== Bubble de mensaje (chat) ==============

function MsgBubble({
  direction, initials, from, date, bodyHtml, fullHtml, hasQuoted,
}: {
  direction: "inbound" | "outbound";
  initials: string;
  from: string;
  date: string;
  bodyHtml: string;
  fullHtml: string;
  hasQuoted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`seg-msg seg-msg-${direction}`}>
      <div className="seg-msg-avatar">{initials}</div>
      <div className="seg-msg-bubble">
        <div className="seg-msg-head">
          <span className="seg-msg-from">{from}</span>
          <span className="seg-msg-date">{date}</span>
        </div>
        <div
          className="seg-msg-body"
          dangerouslySetInnerHTML={{ __html: expanded ? fullHtml : bodyHtml }}
        />
        {hasQuoted && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              marginTop: 8,
              padding: "4px 10px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text-faint)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {expanded ? "▴ Ocultar historial" : "▾ Mostrar historial citado"}
          </button>
        )}
      </div>
    </div>
  );
}

// ============== Componentes ==============

function ThreadCard({
  t, active, onClick, fmtRelative, onDelete,
}: {
  t: ThreadSummary;
  active: boolean;
  onClick: () => void;
  fmtRelative: (d?: string) => string;
  onDelete: () => void;
}) {
  const initials = (t.contact_name || t.contact_email)
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  const colorIdx = (t.contact_email.charCodeAt(0) ?? 0) % 6;

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirm(`¿Eliminar el hilo de ${t.contact_name || t.contact_email}?\n\nSe quitará de la lista (no se borra el email en Gmail).`)) {
      onDelete();
    }
  }

  return (
    <div
      className={`seg-card-thread seg-status-${t.dynamic_status} ${active ? "active" : ""}`}
      onClick={onClick}
      style={{ position: "relative" }}
    >
      <button
        onClick={handleDelete}
        title="Eliminar de la lista"
        style={{
          position: "absolute", top: 8, right: 8,
          width: 22, height: 22, borderRadius: 6,
          background: "transparent", border: "1px solid var(--border)",
          color: "var(--text-faint)", fontSize: 12, lineHeight: 1,
          cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.5, transition: "opacity 0.15s, background 0.15s",
          zIndex: 2,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = "1";
          e.currentTarget.style.background = "rgba(239,68,68,0.1)";
          e.currentTarget.style.color = "#dc2626";
          e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = "0.5";
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-faint)";
          e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        ✕
      </button>
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiName, setAiName] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiObjective, setAiObjective] = useState("Cerrar reunión de 15 min para enseñarle el producto.");
  const [aiTone, setAiTone] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function generate() {
    if (!p.to.trim()) {
      setAiError("Pon primero el email destinatario");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await p.aiCompose({
        contact_name: aiName.trim(),
        objective: aiObjective.trim(),
        topic: aiTopic.trim(),
        tone: aiTone.trim(),
      });
      if (r.error) {
        setAiError(r.error);
      } else {
        if (r.subject) p.setSubject(r.subject);
        if (r.body_html) p.setBodyHtml(r.body_html);
        setAiOpen(false);
      }
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <section className="seg-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 className="li-h2" style={{ margin: 0 }}>Nuevo email</h2>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
          ✉️ Crea un hilo · respuestas se cargan automáticamente
        </div>
      </div>

      <div className="li-row">
        <label className="li-label">Para</label>
        <input className="li-input" value={p.to} onChange={(e: any) => p.setTo(e.target.value)} placeholder="email@destinatario.com" />
      </div>

      {/* AI assistant */}
      <div style={{
        margin: "10px 0", padding: 12,
        background: "linear-gradient(135deg, rgba(0,113,227,0.05), rgba(99,102,241,0.04))",
        border: "1px solid rgba(0,113,227,0.18)",
        borderRadius: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
              ✨ Redactar primer email con IA
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
              La IA usará tu memoria + objetivo para escribir asunto y cuerpo
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAiOpen(!aiOpen)}
            style={{
              padding: "7px 14px", border: "1px solid var(--accent)",
              background: aiOpen ? "var(--accent)" : "#fff",
              color: aiOpen ? "#fff" : "var(--accent)",
              borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {aiOpen ? "Cerrar" : "Abrir IA"}
          </button>
        </div>

        {aiOpen && (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                value={aiName}
                onChange={e => setAiName(e.target.value)}
                placeholder="Nombre del contacto (opcional)"
                style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, background: "#fff" }}
              />
              <input
                value={aiTone}
                onChange={e => setAiTone(e.target.value)}
                placeholder="Tono (ej: directo, técnico)"
                style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, background: "#fff" }}
              />
            </div>
            <textarea
              value={aiTopic}
              onChange={e => setAiTopic(e.target.value)}
              rows={2}
              placeholder="Sobre qué quieres hablarle. Ej: Vimos que abristeis oficina en Madrid, ofrecemos plataforma SaaS para outreach..."
              style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical", background: "#fff" }}
            />
            <input
              value={aiObjective}
              onChange={e => setAiObjective(e.target.value)}
              placeholder="Objetivo del email (qué quieres conseguir)"
              style={{ padding: "8px 11px", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, background: "#fff" }}
            />
            {aiError && <div style={{ fontSize: 11.5, color: "var(--error)" }}>⚠️ {aiError}</div>}
            <button
              type="button"
              onClick={generate}
              disabled={aiLoading}
              style={{
                padding: "9px 14px", background: "var(--accent)", color: "#fff",
                border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
                cursor: "pointer", boxShadow: "0 2px 8px rgba(0,113,227,0.25)",
                opacity: aiLoading ? 0.6 : 1,
              }}
            >
              {aiLoading ? "🪄 Redactando…" : "✨ Generar asunto + cuerpo"}
            </button>
          </div>
        )}
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
        <label className="li-label">📎 Adjuntos</label>
        <input ref={p.fileRef} type="file" multiple onChange={(e: any) => p.setFiles(Array.from(e.target.files ?? []))} />
        {p.files.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>📎 {p.files.map((f: File) => f.name).join(", ")}</div>
        )}
      </div>

      {/* OPCIONES TRAS ENVIAR */}
      <div style={{
        marginTop: 14, padding: 14,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 10 }}>
          Tras enviar este email
        </div>

        {/* Toggle autopilot */}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 10 }}>
          <div
            onClick={() => p.setAutopilotAfter(!p.autopilotAfter)}
            style={{
              width: 36, height: 20, borderRadius: 999, flexShrink: 0,
              background: p.autopilotAfter ? "var(--accent)" : "var(--bg-elev-3)",
              position: "relative", marginTop: 2, transition: "background 0.18s",
            }}
          >
            <div style={{
              position: "absolute", top: 2, left: p.autopilotAfter ? 18 : 2,
              width: 16, height: 16, borderRadius: 999, background: "#fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.18s",
            }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              🤖 Activar autopilot y planificar follow-ups
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 1 }}>
              Tras enviar abrirá el wizard del autopilot para que configures contexto, tono, objetivo y secuencia
            </div>
          </div>
        </label>

        <div className="li-row" style={{ margin: 0 }}>
          <label className="li-label" style={{ fontSize: 11 }}>O aplicar secuencia ya guardada (alternativo)</label>
          <select
            value={p.composeSequenceId}
            onChange={(e) => p.setComposeSequenceId(e.target.value)}
            style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: "8px 10px", fontSize: 13, width: "100%" }}
          >
            <option value="">— Sin secuencia automática —</option>
            {p.sequences.map((s: Sequence) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.steps.length} steps)
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={p.send}
        disabled={p.sending || !p.to || !p.subject}
        style={{ marginTop: 14, width: "100%" }}
      >
        {p.sending ? "Enviando…" : `📧 Enviar y crear hilo${p.autopilotAfter ? " · luego configurar autopilot" : ""}`}
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
  const [syncing, setSyncing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMsgIdRef = useRef<string>("");

  // Auto-scroll cuando llega un mensaje nuevo
  useEffect(() => {
    const lastId = t.messages[t.messages.length - 1]?.id;
    if (lastId && lastId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastId;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 80);
    }
  }, [t.messages]);

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch("/api/email/sync", { method: "POST" });
      await p.reloadThread?.();
    } finally {
      setSyncing(false);
    }
  }

  // Mezclar mensajes + follow-ups programados como timeline única
  const timeline: any[] = [
    ...t.messages.map(m => ({ kind: "msg", date: m.date, item: m })),
    ...(t.followups || [])
      .filter((f: any) => f.status === "scheduled")
      .map((f: any) => ({ kind: "ghost", date: f.scheduled_at, item: f })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  function getInitials(email: string): string {
    const local = email.split("@")[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (local.slice(0, 2)).toUpperCase();
  }

  /** Quita la historia citada de un email (lo que estaba antes del "On X, Y wrote:" / "El X, Y escribió:" / blockquotes) */
  function stripQuoted(html: string): { clean: string; hasQuoted: boolean } {
    if (!html) return { clean: "", hasQuoted: false };
    let s = html;

    // Cortar en patrones típicos de cita
    const cutMarkers = [
      /<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i,
      /<blockquote[^>]*type=["']cite["']/i,
      /<blockquote/i,
      /<div[^>]*>\s*-----\s*Original Message\s*-----/i,
      /\bEl\s+\w+[,]\s*\d+\s+\w+\s+\d+\s+a\s+las\s+\d+:\d+/i,                     // "El jue, 19 mar 2026 a las 12:20"
      /\bEl\s+[\d/]+,\s*[^\n<]+escribió:/i,
      /\bOn\s+\w+,\s+\w+\s+\d+,\s+\d+\s+at\s+\d+:\d+[^<]*wrote:/i,
      /\bDe:\s*[^\n<]+\n*\s*<br\s*\/?>\s*Enviado:/i,
      /<div[^>]*>\s*De:\s*[^<]+/i,
    ];
    for (const re of cutMarkers) {
      const m = s.match(re);
      if (m && m.index !== undefined && m.index > 50) {
        s = s.slice(0, m.index);
        return { clean: s.trim(), hasQuoted: true };
      }
    }
    return { clean: s, hasQuoted: false };
  }

  return (
    <>
      <section className="seg-card seg-thread-head">
        <div style={{ flex: 1 }}>
          <h2 className="li-h2" style={{ marginBottom: 4 }}>{t.subject}</h2>
          <div style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 10 }}>
            Con {t.participants.filter((x: string) => x !== p.myEmail).join(", ")}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--success)" }}>
              <span className="seg-sync-dot" /> escuchando respuestas
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={syncNow}
            disabled={syncing}
            title="Sincronizar ahora con Gmail"
            style={{
              padding: "7px 13px",
              background: syncing ? "var(--bg-elev-3)" : "#fff",
              border: "1px solid var(--border)",
              borderRadius: 9, fontSize: 12, fontWeight: 600,
              color: "var(--text-dim)", cursor: syncing ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {syncing ? "⏳ Sincronizando…" : "↻ Sincronizar"}
          </button>
          {t.status !== "closed" && (
            <button className="btn-ghost-sm" onClick={p.markClosed} title="Marcar como cerrado">
              Cerrar hilo
            </button>
          )}
          <button
            onClick={() => {
              if (confirm(`¿Eliminar el contacto y todo el hilo de ${t.participants.filter((x: string) => x !== p.myEmail).join(", ")}?\n\nEsto borra los mensajes y follow-ups asociados de la plataforma (no afecta a Gmail).`)) {
                p.deleteThread(t.id);
              }
            }}
            title="Eliminar contacto y hilo"
            style={{
              padding: "7px 13px",
              background: "transparent",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 9, fontSize: 12, fontWeight: 600,
              color: "var(--error)", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            🗑 Eliminar contacto
          </button>
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

        <ApplySequenceCard sequences={p.sequences} apply={p.applySequenceToThread} />

        <button className="seg-action-card" onClick={p.openSchedule}>
          <div className="seg-action-icon">📅</div>
          <div className="seg-action-title">Programar follow-up</div>
          <div className="seg-action-desc">
            La IA detecta fechas en la respuesta del prospect y autocompleta. Manual también.
          </div>
        </button>
      </section>

      <section className="seg-messages">
        {timeline.map((entry, idx) => {
          if (entry.kind === "msg") {
            const m: Message = entry.item;
            const isOut = m.direction === "outbound";
            const initials = isOut ? "TÚ" : getInitials(m.from || "??");
            const rawHtml = m.body_html || `<p>${(m.body_text ?? "").replace(/\n/g, "<br>")}</p>`;
            const { clean, hasQuoted } = stripQuoted(rawHtml);
            return (
              <MsgBubble
                key={`m-${m.id}`}
                direction={m.direction}
                initials={initials}
                from={isOut ? "Tú" : m.from}
                date={p.fmt(m.date)}
                bodyHtml={clean}
                fullHtml={rawHtml}
                hasQuoted={hasQuoted}
              />
            );
          }
          // Ghost: follow-up programado
          const f = entry.item;
          return (
            <div key={`f-${f.id}`} className="seg-msg seg-msg-outbound seg-msg-ghost">
              <div className="seg-msg-avatar">🤖</div>
              <div className="seg-msg-bubble">
                <div className="seg-msg-ghost-label">
                  📅 Programado · se enviará {p.fmt(f.scheduled_at)} · {f.origin}
                </div>
                <div className="seg-msg-body" style={{ maxHeight: "none", overflow: "visible" }} dangerouslySetInnerHTML={{ __html: f.body_html }} />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => p.sendNowFollowup(f.id)}
                    style={{
                      padding: "5px 11px",
                      background: "linear-gradient(135deg, #f59e0b, #d97706)",
                      color: "#fff", border: "none", borderRadius: 8,
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    🚀 Enviar ahora
                  </button>
                  <button
                    onClick={() => p.cancelFollowup(f.id)}
                    style={{
                      padding: "5px 11px",
                      background: "transparent",
                      color: "#92400e", border: "1px solid rgba(245,158,11,0.4)",
                      borderRadius: 8, fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
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
                <div className="li-post-text" dangerouslySetInnerHTML={{ __html: f.body_html }} />
                {f.error && <div className="li-post-err">{f.error}</div>}
                {f.status === "scheduled" && (
                  <div className="li-post-actions" style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      onClick={() => p.sendNowFollowup(f.id)}
                      style={{
                        padding: "6px 14px",
                        background: "linear-gradient(135deg, #f59e0b, #d97706)",
                        color: "#fff", border: "none", borderRadius: 9,
                        fontSize: 12, fontWeight: 700, cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(245,158,11,0.3)",
                        fontFamily: "inherit",
                      }}
                    >
                      🚀 Enviar AHORA
                    </button>
                    <button className="btn-ghost-sm" onClick={() => p.cancelFollowup(f.id)}>
                      Cancelar
                    </button>
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
