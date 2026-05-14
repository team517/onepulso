"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DashboardNav from "../components/DashboardNav";

type ToolEvent = { type: "tool_use" | "tool_result"; data: any };
type Message = {
  role: "user" | "assistant";
  text?: string;
  events?: ToolEvent[];
};

type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Campaign = {
  id: string;
  name: string;
  niche?: string;
  goal?: string;
  steps_count: number;
  variants_per_step: number[];
  leads_uploaded?: number;
  conversation_id?: string;
  created_at: string;
};

type MemEntry = {
  slug: string;
  title: string;
  category: string;
  content: string;
  updated: string;
};

const SUGGESTED = [
  "Crea una campaña para captar SaaS B2B en España",
  "Crea una campaña para mi cliente https://acme.com — quieren llegar a directores de marketing",
  "Crea otra campaña como la última pero cambiando ángulo",
  "Lista las campañas que tengo",
];

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [memory, setMemory] = useState<MemEntry[]>([]);
  const [tab, setTab] = useState<"memory" | "skills" | "config">("memory");
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([]);
  const [skillInput, setSkillInput] = useState("");
  const [installingSkill, setInstallingSkill] = useState(false);
  const [skillFeedback, setSkillFeedback] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<{ name: string; description: string; content: string } | null>(null);
  const [memTitle, setMemTitle] = useState("");
  const [memCat, setMemCat] = useState("identity");
  const [memContent, setMemContent] = useState("");
  const [instantlyStatus, setInstantlyStatus] = useState<{
    connected: boolean;
    count?: number;
    active_title?: string;
    plan_label?: string;
    renews_at?: string;
    days_remaining?: number;
  } | null>(null);
  const [instantlyModalOpen, setInstantlyModalOpen] = useState(false);
  const [instantlyAccounts, setInstantlyAccounts] = useState<any[]>([]);
  const [newAcctTitle, setNewAcctTitle] = useState("");
  const [newAcctKey, setNewAcctKey] = useState("");
  const [newAcctRenews, setNewAcctRenews] = useState("");
  const [newAcctPlan, setNewAcctPlan] = useState("");
  const [newAcctIsOwner, setNewAcctIsOwner] = useState(false);
  const [newAcctClientCompany, setNewAcctClientCompany] = useState("");
  const [newAcctClientContact, setNewAcctClientContact] = useState("");
  const [savingAcct, setSavingAcct] = useState(false);
  const [editingAcctId, setEditingAcctId] = useState<string | null>(null);
  const [editAcct, setEditAcct] = useState<any>({});
  const [editAcctRenews, setEditAcctRenews] = useState("");
  const [editAcctPlan, setEditAcctPlan] = useState("");
  const [refreshingLeads, setRefreshingLeads] = useState(false);

  async function loadInstantlyAccounts() {
    try {
      const j = await fetch("/api/instantly/accounts").then(r => r.json());
      setInstantlyAccounts(j.accounts ?? []);
    } catch {}
  }

  async function addInstantlyAccount() {
    if (!newAcctTitle.trim() || !newAcctKey.trim()) return;
    setSavingAcct(true);
    try {
      const r = await fetch("/api/instantly/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newAcctTitle,
          api_key: newAcctKey,
          renews_at: newAcctRenews ? new Date(newAcctRenews).toISOString() : undefined,
          plan_label: newAcctPlan.trim() || undefined,
          is_owner: newAcctIsOwner,
          client_company: newAcctClientCompany.trim() || undefined,
          client_contact: newAcctClientContact.trim() || undefined,
        }),
      }).then(r => r.json());
      if (r.error) {
        alert("⚠️ " + r.error);
      } else {
        setNewAcctTitle("");
        setNewAcctKey("");
        setNewAcctRenews("");
        setNewAcctPlan("");
        setNewAcctIsOwner(false);
        setNewAcctClientCompany("");
        setNewAcctClientContact("");
        await loadInstantlyAccounts();
        await fetch("/api/instantly/status").then(r => r.json()).then(setInstantlyStatus);
      }
    } finally { setSavingAcct(false); }
  }

  async function markAsOwner(id: string, title: string) {
    if (!confirm(`¿Marcar "${title}" como TU cuenta principal (onepulso)?\n\nSerá la cuenta por defecto cada vez que vuelvas a la app.`)) return;
    await fetch(`/api/instantly/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_owner: true }),
    });
    await loadInstantlyAccounts();
  }

  async function backToOwner() {
    await fetch("/api/instantly/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate_owner" }),
    });
    await loadInstantlyAccounts();
    await fetch("/api/instantly/status").then(r => r.json()).then(setInstantlyStatus);
  }

  function startEditAccount(a: any) {
    setEditingAcctId(a.id);
    setEditAcctRenews(a.renews_at ? a.renews_at.slice(0, 10) : "");
    setEditAcctPlan(a.plan_label || "");
    setEditAcct({
      title: a.title || "",
      client_company: a.client_company || "",
      client_contact: a.client_contact || "",
      instantly_email: a.instantly_email || "",
      client_email: a.client_email || "",
      client_phone: a.client_phone || "",
      notes: a.notes || "",
      api_key: "", // No precargar la API key (queda oculta), solo cambiar si tipean
    });
  }

  async function saveEditAccount(id: string) {
    const patch: any = {
      title: editAcct.title || undefined,
      renews_at: editAcctRenews ? new Date(editAcctRenews).toISOString() : "",
      plan_label: editAcctPlan,
      client_company: editAcct.client_company ?? "",
      client_contact: editAcct.client_contact ?? "",
      instantly_email: editAcct.instantly_email ?? "",
      client_email: editAcct.client_email ?? "",
      client_phone: editAcct.client_phone ?? "",
      notes: editAcct.notes ?? "",
    };
    if (editAcct.api_key && editAcct.api_key.trim()) patch.api_key = editAcct.api_key.trim();
    await fetch(`/api/instantly/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setEditingAcctId(null);
    await loadInstantlyAccounts();
    await fetch("/api/instantly/status").then(r => r.json()).then(setInstantlyStatus);
  }

  async function refreshLeadsCount() {
    if (refreshingLeads) return;
    setRefreshingLeads(true);
    try {
      const r = await fetch("/api/campaigns/refresh-leads", { method: "POST" }).then((r) => r.json());
      if (r.ok) {
        await refreshAll();
        alert(`✓ Actualizado · ${r.updated} de ${r.total_campaigns_checked} campañas\n\nLos contadores ahora reflejan los leads REALES en Instantly.`);
      } else {
        alert("⚠️ " + (r.error || "Error desconocido"));
      }
    } catch (e: any) {
      alert("⚠️ " + e.message);
    } finally {
      setRefreshingLeads(false);
    }
  }

  async function setActiveInstantly(id: string) {
    await fetch(`/api/instantly/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    await loadInstantlyAccounts();
    await fetch("/api/instantly/status").then(r => r.json()).then(setInstantlyStatus);
  }

  async function deleteInstantlyAccount(id: string, title: string) {
    if (!confirm(`¿Eliminar la cuenta "${title}"?`)) return;
    await fetch(`/api/instantly/accounts/${id}`, { method: "DELETE" });
    await loadInstantlyAccounts();
  }
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; text: string; size: number }>>([]);
  const [attaching, setAttaching] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  const streamRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshAll();
    fetch("/api/instantly/status")
      .then((r) => r.json())
      .then((d) => setInstantlyStatus({ connected: d.connected, count: d.campaigns_count }))
      .catch(() => setInstantlyStatus({ connected: false }));
    loadInstantlyAccounts(); // cargar también las cuentas al inicio para el switcher
  }, []);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function refreshAll() {
    const [cRes, mRes, convRes, sRes] = await Promise.all([
      fetch("/api/campaigns").then((r) => r.json()),
      fetch("/api/memory").then((r) => r.json()),
      fetch("/api/conversations").then((r) => r.json()),
      fetch("/api/skills?scope=campaigns").then((r) => r.json()),
    ]);
    setCampaigns(cRes.records ?? []);
    setMemory(mRes.entries ?? []);
    setConversations(convRes.items ?? []);
    setSkills(sRes.skills ?? []);
  }

  async function installSkill() {
    if (!skillInput.trim() || installingSkill) return;
    setInstallingSkill(true);
    setSkillFeedback("Descargando… esto puede tardar 10-60s la primera vez.");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: skillInput.trim(), scope: "campaigns" }),
      });
      const data = await res.json();
      if (data.installed?.length) {
        const names = data.installed.map((s: any) => s.name).join(", ");
        setSkillFeedback(`✓ Descargada: ${names}`);
        setSkillInput("");
      } else if (data.error) {
        setSkillFeedback(`⚠️ ${data.error.slice(0, 280)}`);
      } else {
        setSkillFeedback(
          "Sin skill detectada. Verifica el formato — ej. 'owner/repo@skill'."
        );
      }
    } catch (e: any) {
      setSkillFeedback(`⚠️ ${e.message}`);
    } finally {
      setInstallingSkill(false);
      refreshAll();
      setTimeout(() => setSkillFeedback(null), 12000);
    }
  }

  async function viewSkill(name: string) {
    const r = await fetch(`/api/skills/${encodeURIComponent(name)}`).then((r) => r.json());
    if (r.skill) setOpenSkill(r.skill);
  }

  async function loadConversation(id: string) {
    const res = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    if (res.conversation) {
      setCurrentConvId(id);
      setMessages(res.conversation.messages ?? []);
      setAttachments([]);
      setInput("");
    }
  }

  function newConversation() {
    setCurrentConvId(null);
    setMessages([]);
    setAttachments([]);
    setInput("");
  }

  async function deleteConv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("¿Borrar esta conversación?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (currentConvId === id) newConversation();
    refreshAll();
  }

  async function persistConversation(updated: Message[], explicitId?: string) {
    const id = explicitId ?? currentConvId;
    if (!id) return;
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: updated }),
    });
    refreshAll();
  }

  async function send(text: string) {
    // Solo contar adjuntos "ready" para validar
    const readyAttachments = (attachments as any[]).filter((a) => a.status === "ready" || (!a.status && a.text));
    if ((!text.trim() && readyAttachments.length === 0) || busy) return;

    // Avisar si hay adjuntos en error o aún subiendo
    const uploading = (attachments as any[]).filter((a) => a.status === "uploading");
    if (uploading.length > 0) {
      alert(`Espera, aún se están subiendo ${uploading.length} archivo(s)…`);
      return;
    }

    const attachBlock = readyAttachments.length
      ? readyAttachments
          .map((a) => `[ARCHIVO ADJUNTO: ${a.name}]\n${a.text}\n[FIN ARCHIVO]`)
          .join("\n\n")
      : "";
    const userVisible = readyAttachments.length
      ? `${text}${text ? "\n\n" : ""}📎 ${readyAttachments.map((a) => a.name).join(", ")}`
      : text;
    const userForApi = attachBlock ? `${attachBlock}\n\n${text}` : text;

    const next: Message[] = [...messages, { role: "user", text: userVisible }];
    setMessages(next);
    setInput("");
    setAttachments([]);
    setBusy(true);

    // Crear conversación ya AHORA si no existe — para que campañas creadas en esta llamada queden enlazadas.
    let convId = currentConvId;
    if (!convId) {
      const created = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_text: text }),
      }).then((r) => r.json());
      convId = created.conversation.id;
      setCurrentConvId(convId);
    }

    try {
      const apiMsgs = messages
        .map((m) => ({ role: m.role, content: m.text ?? "" }))
        .concat([{ role: "user", content: userForApi }]);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMsgs, conversation_id: convId }),
      });
      const data = await res.json();
      let finalMessages: Message[];
      if (data.error) {
        finalMessages = [...next, { role: "assistant", text: `⚠️ ${data.error}` }];
      } else {
        const events: ToolEvent[] = [];
        let finalText = "";
        for (const ev of data.events ?? []) {
          if (ev.type === "text") finalText += ev.data;
          else events.push(ev);
        }
        finalMessages = [...next, { role: "assistant", text: finalText, events }];
      }
      setMessages(finalMessages);
      persistConversation(finalMessages, convId ?? undefined);
    } catch (e: any) {
      const errMsg: Message[] = [...next, { role: "assistant", text: `⚠️ ${e.message}` }];
      setMessages(errMsg);
      persistConversation(errMsg, convId ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveMem() {
    if (!memTitle.trim() || !memContent.trim()) return;
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: memTitle, category: memCat, content: memContent }),
    });
    setMemTitle("");
    setMemContent("");
    refreshAll();
  }

  async function delMem(slug: string) {
    await fetch("/api/memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    refreshAll();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", memCat);
      await fetch("/api/memory/upload", { method: "POST", body: fd }).catch(() => {});
    }
    setUploading(false);
    refreshAll();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    uploadFiles(e.dataTransfer.files);
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttaching(true);
    // 1. Crear chips optimistas (uploading) inmediatamente
    const pending = Array.from(files).map((f) => ({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      size: f.size,
      text: "",
      status: "uploading" as const,
      error: undefined as string | undefined,
      rowCount: undefined as number | undefined,
      _file: f,
    }));
    setAttachments((prev) => [...prev, ...pending.map(({ _file, ...rest }) => rest)]);

    // 2. Subir cada uno en paralelo y actualizar su chip.
    //    Modo binario directo (x-filename header) — más fiable que multipart/FormData,
    //    que en algunos navegadores/proxies da 'Failed to parse body as FormData'.
    await Promise.all(
      pending.map(async (p) => {
        try {
          const ab = await p._file.arrayBuffer();
          const res = await fetch("/api/chat/attach", {
            method: "POST",
            headers: {
              "x-filename": encodeURIComponent(p._file.name),
              "Content-Type": "application/octet-stream",
            },
            body: ab,
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j?.error || `HTTP ${res.status}`);
          }
          const data = await res.json();
          if (!data?.name) throw new Error("Respuesta inválida del servidor");
          setAttachments((prev) =>
            prev.map((a: any) =>
              a.id === p.id
                ? {
                    ...a,
                    name: data.name,
                    text: data.text,
                    size: data.size,
                    status: "ready" as const,
                    rowCount: data.row_count,
                    columns: data.columns,
                    fileId: data.file_id,
                    kind: data.kind,
                  }
                : a
            )
          );
        } catch (e: any) {
          setAttachments((prev) =>
            prev.map((a: any) =>
              a.id === p.id
                ? { ...a, status: "error" as const, error: e?.message || "Error al subir" }
                : a
            )
          );
        }
      })
    );
    setAttaching(false);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a: any) => a.id !== id));
  }

  function onComposerDrop(e: React.DragEvent) {
    e.preventDefault();
    attachFiles(e.dataTransfer.files);
  }

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content campaigns-inner">
      {/* Sidebar — conversaciones */}
      <aside className="sidebar">
        <div className="sidebar-inner-header">
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-faint)", fontWeight: 600, marginBottom: 8 }}>
            Copiloto IA
          </div>
        </div>
        <button className="new-btn" onClick={newConversation}>
          + Nueva conversación
        </button>

        <div className="section-label">Conversaciones</div>
        <div className="section-list section-list--scroll">
          {conversations.length === 0 ? (
            <div className="list-empty">Sin historial</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${currentConvId === c.id ? "conv-item--active" : ""}`}
                onClick={() => loadConversation(c.id)}
                title={new Date(c.updated_at).toLocaleString()}
              >
                <div className="conv-item-title">{c.title}</div>
                <button
                  className="conv-item-del"
                  onClick={(e) => deleteConv(c.id, e)}
                  aria-label="Borrar conversación"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div className="section-label">Campañas creadas</div>
        <div className="section-list">
          {campaigns.length === 0 ? (
            <div className="list-empty">Aún no has creado ninguna</div>
          ) : (
            campaigns.map((c) => (
              <div
                key={c.id}
                className={`campaign-item ${c.conversation_id ? "campaign-item--linked" : ""}`}
                title={c.conversation_id ? "Click para abrir su chat" : "Sin chat asociado (creada antes del historial)"}
                onClick={() => c.conversation_id && loadConversation(c.conversation_id)}
                style={{ cursor: c.conversation_id ? "pointer" : "default" }}
              >
                <div className="campaign-item-title">{c.name}</div>
                <div className="campaign-item-meta">
                  <span>{c.steps_count} steps</span>
                  <span className="dot" />
                  <span>
                    {c.variants_per_step.reduce((a, b) => a + b, 0)} variantes
                  </span>
                  {c.leads_uploaded ? (
                    <>
                      <span className="dot" />
                      <span>{c.leads_uploaded} leads</span>
                    </>
                  ) : null}
                  {c.conversation_id ? (
                    <>
                      <span className="dot" />
                      <span style={{ color: "var(--accent)" }}>💬</span>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main — chat */}
      <main className="main">
        <div className="chat-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="chat-title">Copiloto</div>
              <div className="chat-subtitle">
                {instantlyStatus?.connected ? (
                  <>
                    <span style={{ color: "#22c55e" }}>● </span>
                    Trabajando con <strong>{instantlyStatus.active_title || "(sin cuenta)"}</strong>
                    {" · "}{instantlyStatus.count} campañas
                  </>
                ) : instantlyStatus ? (
                  <span style={{ color: "var(--error)" }}>● Instantly: error de conexión</span>
                ) : (
                  <span>● comprobando…</span>
                )}
                {" · "}{memory.length} notas
              </div>
            </div>
            <button
              onClick={() => { setInstantlyModalOpen(true); loadInstantlyAccounts(); }}
              style={{
                padding: "7px 13px",
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text-dim)",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
              title="Gestionar cuentas de Instantly"
            >
              ⚙️ Gestionar cuentas
            </button>
          </div>

          {/* Quick switcher: chips owner + clientes */}
          {instantlyAccounts.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {instantlyAccounts.map((a) => {
                const isActive = a.active;
                const isOwner = a.is_owner;
                return (
                  <button
                    key={a.id}
                    onClick={() => !isActive && setActiveInstantly(a.id)}
                    title={
                      isOwner
                        ? `Tu cuenta principal (onepulso)${a.plan_label ? " · " + a.plan_label : ""}`
                        : `Cuenta de cliente${a.client_company ? " · " + a.client_company : ""}${a.plan_label ? " · " + a.plan_label : ""}`
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "5px 11px",
                      background: isActive
                        ? (isOwner ? "linear-gradient(135deg, #0071e3, #1d4ed8)" : "linear-gradient(135deg, #8b5cf6, #6d28d9)")
                        : "#fff",
                      color: isActive ? "#fff" : "var(--text-dim)",
                      border: `1px solid ${isActive ? "transparent" : "var(--border)"}`,
                      borderRadius: 99,
                      fontSize: 11.5,
                      fontWeight: isActive ? 700 : 600,
                      cursor: isActive ? "default" : "pointer",
                      fontFamily: "inherit",
                      transition: "all 0.15s",
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{isOwner ? "🏠" : "👤"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</span>
                    {typeof a.days_remaining === "number" && a.days_remaining <= 7 && (
                      <span style={{
                        fontSize: 9.5,
                        padding: "1px 5px",
                        borderRadius: 99,
                        background: isActive ? "rgba(255,255,255,0.2)" : "rgba(239,68,68,0.15)",
                        color: isActive ? "#fff" : "#dc2626",
                        fontWeight: 700,
                      }}>{a.days_remaining}d</span>
                    )}
                  </button>
                );
              })}
              {/* Botón "← onepulso" cuando estás en cliente */}
              {(() => {
                const active = instantlyAccounts.find((a) => a.active);
                const owner = instantlyAccounts.find((a) => a.is_owner);
                if (!owner || active?.is_owner) return null;
                return (
                  <button
                    onClick={backToOwner}
                    style={{
                      padding: "5px 11px",
                      background: "transparent",
                      color: "var(--accent)",
                      border: "1px dashed var(--accent)",
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title={`Volver a tu cuenta ${owner.title}`}
                  >
                    ← Volver a {owner.title}
                  </button>
                );
              })()}
            </div>
          )}
        </div>

        <div className="chat-stream" ref={streamRef}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">¿Qué montamos hoy?</div>
              <div>
                Crea campañas, redacta secuencias, sube leads y recuerda todo lo
                que aprenda sobre tu negocio para próximas conversaciones.
              </div>
              <div className="empty-prompts">
                {SUGGESTED.map((p) => (
                  <button key={p} className="empty-prompt" onClick={() => send(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`message message-${m.role}`}>
                {m.role === "user" ? (
                  <div className="bubble">{m.text}</div>
                ) : (
                  <div className="message-assistant">
                    {m.events?.map((ev, j) => (
                      <div key={j} className="tool-event">
                        <div className="tool-event-name">
                          {ev.type === "tool_use"
                            ? `→ ${ev.data.name}(${truncate(JSON.stringify(ev.data.input), 80)})`
                            : `← ${ev.data.name}`}
                        </div>
                        {ev.type === "tool_result" && (
                          <div>{truncate(ev.data.output, 500)}</div>
                        )}
                      </div>
                    ))}
                    {m.text && <div className="assistant-text">{m.text}</div>}
                  </div>
                )}
              </div>
            ))
          )}
          {busy && (
            <div className="message">
              <div className="thinking">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                pensando…
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          <div
            className="composer-inner"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onComposerDrop}
          >
            {attachments.length > 0 && (
              <div className="attach-chips">
                {(attachments as any[]).map((a) => {
                  const status = a.status ?? (a.text ? "ready" : "ready");
                  const isUploading = status === "uploading";
                  const isError = status === "error";
                  const isCsv = a.kind === "csv" || a.name?.toLowerCase().endsWith(".csv") || a.name?.toLowerCase().endsWith(".tsv");
                  return (
                    <div
                      key={a.id || a.name}
                      className="attach-chip"
                      style={{
                        background: isError ? "rgba(239,68,68,0.08)" :
                                    isUploading ? "rgba(245,158,11,0.08)" :
                                    isCsv ? "rgba(16,185,129,0.08)" : undefined,
                        border: `1px solid ${
                          isError ? "rgba(239,68,68,0.35)" :
                          isUploading ? "rgba(245,158,11,0.35)" :
                          isCsv ? "rgba(16,185,129,0.35)" : "var(--border)"
                        }`,
                        color: isError ? "#b91c1c" :
                               isUploading ? "#b45309" :
                               isCsv ? "#047857" : undefined,
                      }}
                      title={isError ? a.error : isCsv ? `${a.rowCount ?? "?"} filas · ${(a.columns ?? []).join(", ")}` : a.name}
                    >
                      <span className="attach-icon" style={{
                        display: "inline-block",
                        animation: isUploading ? "spin 1s linear infinite" : "none",
                      }}>
                        {isError ? "⚠" : isUploading ? "⏳" : isCsv ? "📊" : "📎"}
                      </span>
                      <span className="attach-name" style={{ fontWeight: 600 }}>{a.name}</span>
                      {isUploading ? (
                        <span className="attach-size" style={{ fontStyle: "italic" }}>subiendo… ({formatSize(a.size)})</span>
                      ) : isError ? (
                        <span className="attach-size" style={{ color: "#b91c1c", fontWeight: 600 }}>error: {a.error}</span>
                      ) : isCsv && typeof a.rowCount === "number" ? (
                        <span className="attach-size" style={{ fontWeight: 600 }}>{a.rowCount.toLocaleString()} leads · {formatSize(a.size)}</span>
                      ) : (
                        <span className="attach-size">{formatSize(a.size)}</span>
                      )}
                      <button
                        className="attach-remove"
                        onClick={() => removeAttachment(a.id)}
                        aria-label="Quitar"
                        title="Quitar"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Escribe lo que quieres que haga, pega una URL para extraer info de la web, o arrastra archivos…"
            />
            <input
              ref={chatFileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              accept=".txt,.md,.csv,.tsv,.json,.pdf,.docx,.log,.yaml,.yml"
              onChange={(e) => {
                attachFiles(e.target.files);
                if (chatFileInputRef.current) chatFileInputRef.current.value = "";
              }}
            />
            <button
              className="attach-btn"
              onClick={() => chatFileInputRef.current?.click()}
              aria-label="Adjuntar archivo"
              title="Adjuntar archivo"
              disabled={busy}
            >
              📎
            </button>
            <button
              className="send-btn"
              disabled={busy || (!input.trim() && attachments.length === 0)}
              onClick={() => send(input)}
              aria-label="Enviar"
            >
              ↑
            </button>
          </div>
          <div className="composer-hint">
            Enter envía · Shift+Enter nueva línea · 📎 archivos · 🌐 pega una URL y la IA extraerá lo que hacen
          </div>
        </div>
      </main>

      {/* Right panel — memoria */}
      <aside className="right-panel">
        <div className="right-tabs">
          <button
            className={`right-tab ${tab === "memory" ? "active" : ""}`}
            onClick={() => setTab("memory")}
          >
            Memoria
          </button>
          <button
            className={`right-tab ${tab === "skills" ? "active" : ""}`}
            onClick={() => setTab("skills")}
          >
            Skills
          </button>
          <button
            className={`right-tab ${tab === "config" ? "active" : ""}`}
            onClick={() => setTab("config")}
          >
            Config
          </button>
        </div>
        <div className="right-content">
          {tab === "memory" ? (
            <>
              <div className="memory-add">
                <input
                  placeholder="Título (ej. 'Mi ICP')"
                  value={memTitle}
                  onChange={(e) => setMemTitle(e.target.value)}
                />
                <select
                  value={memCat}
                  onChange={(e) => setMemCat(e.target.value)}
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                    padding: "8px 10px",
                    fontSize: 13,
                  }}
                >
                  <option value="identity">identity</option>
                  <option value="icp">icp</option>
                  <option value="value-prop">value-prop</option>
                  <option value="framework">framework</option>
                  <option value="niche">niche</option>
                  <option value="examples-good">examples-good</option>
                  <option value="examples-bad">examples-bad</option>
                </select>
                <textarea
                  placeholder="Contenido…"
                  value={memContent}
                  onChange={(e) => setMemContent(e.target.value)}
                />
                <button className="btn-primary" onClick={saveMem}>
                  Guardar texto
                </button>
              </div>

              <div
                className="drop-zone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  accept=".txt,.md,.csv,.tsv,.json,.pdf,.docx,.log,.yaml,.yml"
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                {uploading ? (
                  <span>Subiendo…</span>
                ) : (
                  <>
                    <strong>+ Subir archivos</strong>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
                      .pdf .docx .md .txt .csv .json (drag & drop o click)
                    </span>
                  </>
                )}
              </div>
              {memory.length === 0 ? (
                <div className="list-empty">Sin memoria todavía. Añade la primera arriba.</div>
              ) : (
                memory.map((m) => (
                  <div key={m.slug} className="memory-item">
                    <div className="memory-cat">{m.category}</div>
                    <div className="memory-title">{m.title}</div>
                    <div className="memory-content">{m.content}</div>
                    <button className="delete-btn" onClick={() => delMem(m.slug)}>
                      borrar
                    </button>
                  </div>
                ))
              )}
            </>
          ) : tab === "skills" ? (
            <>
              <div className="memory-add">
                <input
                  placeholder="Pega link de skill o owner/repo@skill"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") installSkill();
                  }}
                />
                <button
                  className="btn-primary"
                  onClick={installSkill}
                  disabled={installingSkill || !skillInput.trim()}
                >
                  {installingSkill ? "Descargando…" : "Descargar skill"}
                </button>
                {skillFeedback && (
                  <div
                    style={{
                      fontSize: 12,
                      color: skillFeedback.startsWith("✓") ? "#22c55e" : "var(--text-dim)",
                      padding: "6px 0",
                    }}
                  >
                    {skillFeedback}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "0 0 14px", lineHeight: 1.5 }}>
                Ejemplos:<br />
                · <code>coreyhaines31/marketingskills@cold-email</code><br />
                · <code>https://skills.sh/vercel-labs/skills/find-skills</code><br />
                Las skills viven en <code>.agents/skills/</code> y Claude las usa bajo demanda cuando aplican a tu petición.
              </div>
              {skills.length === 0 ? (
                <div className="list-empty">Sin skills instaladas todavía.</div>
              ) : (
                skills.map((s) => (
                  <div
                    key={s.name}
                    className="memory-item"
                    style={{ cursor: "pointer" }}
                    onClick={() => viewSkill(s.name)}
                    title="Ver contenido"
                  >
                    <div className="memory-cat">skill</div>
                    <div className="memory-title">{s.name}</div>
                    <div className="memory-content">{s.description}</div>
                  </div>
                ))
              )}

              {openSkill && (
                <div className="modal-backdrop" onClick={() => setOpenSkill(null)}>
                  <div className="modal" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <div>
                        <div className="modal-title">{openSkill.name}</div>
                        <div className="modal-sub">{openSkill.description}</div>
                      </div>
                      <button className="modal-close" onClick={() => setOpenSkill(null)} aria-label="Cerrar">×</button>
                    </div>
                    <div className="modal-body">
                      <pre>{openSkill.content}</pre>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.7 }}>
              <p style={{ marginBottom: 8, color: "var(--text)" }}>
                <strong>Configuración</strong>
              </p>
              <p>Las API keys se leen de <code>.env.local</code>:</p>
              <ul style={{ marginLeft: 18, marginTop: 6 }}>
                <li><code>ANTHROPIC_API_KEY</code></li>
                <li><code>INSTANTLY_API_KEY</code></li>
              </ul>
              <p style={{ marginTop: 14 }}>
                La memoria se guarda en <code>data/memory/*.md</code> — puedes editar los archivos a mano si quieres.
              </p>
              <p style={{ marginTop: 14 }}>
                El historial de campañas vive en <code>data/campaigns.json</code>.
              </p>
            </div>
          )}
        </div>
      </aside>
      </div>

      {/* Modal: Gestionar cuentas de Instantly */}
      {instantlyModalOpen && (
        <div
          onClick={() => setInstantlyModalOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "grid", placeItems: "center",
            zIndex: 100, backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 18,
              width: "92%", maxWidth: 580,
              maxHeight: "90vh", overflowY: "auto",
              padding: 26,
              boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  ⚙️ Gestionar cuentas de Instantly
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4 }}>
                  Añade varias cuentas y cambia entre ellas. Toda la memoria y la IA se comparten.
                </div>
              </div>
              <button
                onClick={() => setInstantlyModalOpen(false)}
                style={{ background: "transparent", border: "none", fontSize: 22, color: "var(--text-faint)", cursor: "pointer" }}
              >×</button>
            </div>

            {/* Lista de cuentas */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "var(--text-faint)",
                marginBottom: 8,
              }}>
                Cuentas guardadas ({instantlyAccounts.length})
              </div>
              {instantlyAccounts.length === 0 ? (
                <div style={{
                  padding: "16px 14px", textAlign: "center",
                  background: "var(--bg-elev-2)", borderRadius: 10,
                  color: "var(--text-faint)", fontSize: 13,
                }}>
                  Aún no hay cuentas. Añade la primera abajo.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {instantlyAccounts.map((a) => (
                    <div key={a.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "11px 13px",
                      background: a.is_owner ? "rgba(0,113,227,0.05)" : a.active ? "rgba(139,92,246,0.05)" : "#fff",
                      border: "1px solid",
                      borderColor: a.is_owner ? "rgba(0,113,227,0.3)" : a.active ? "rgba(139,92,246,0.3)" : "var(--border)",
                      borderLeft: a.is_owner ? "4px solid #0071e3" : a.active ? "4px solid #8b5cf6" : "1px solid var(--border)",
                      borderRadius: 11,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>
                            {a.is_owner ? "🏠" : "👤"} {a.title}
                          </span>
                          {a.is_owner && (
                            <span style={{
                              fontSize: 9.5, fontWeight: 700,
                              padding: "2px 7px", borderRadius: 99,
                              background: "rgba(0,113,227,0.15)", color: "#0071e3",
                              letterSpacing: "0.04em",
                            }}>MÍA · ONEPULSO</span>
                          )}
                          {a.active && (
                            <span style={{
                              fontSize: 9.5, fontWeight: 700,
                              padding: "2px 7px", borderRadius: 99,
                              background: "rgba(34,197,94,0.15)", color: "#15803d",
                              letterSpacing: "0.04em",
                            }}>ACTIVA</span>
                          )}
                          {!a.is_owner && a.client_company && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              padding: "2px 7px", borderRadius: 99,
                              background: "rgba(139,92,246,0.12)", color: "#7c3aed",
                            }}>Cliente: {a.client_company}</span>
                          )}
                          {a.plan_label && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              padding: "2px 7px", borderRadius: 99,
                              background: "rgba(99,102,241,0.12)", color: "#4f46e5",
                            }}>{a.plan_label}</span>
                          )}
                          {typeof a.days_remaining === "number" && (
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              padding: "2px 7px", borderRadius: 99,
                              background:
                                a.days_remaining <= 3 ? "rgba(239,68,68,0.12)" :
                                a.days_remaining <= 10 ? "rgba(245,158,11,0.12)" :
                                "rgba(34,197,94,0.12)",
                              color:
                                a.days_remaining <= 3 ? "#dc2626" :
                                a.days_remaining <= 10 ? "#b45309" :
                                "#15803d",
                            }}>
                              ⏳ {a.days_remaining} día{a.days_remaining !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                          {a.api_key_masked}
                        </div>
                        {editingAcctId !== a.id && (
                          <>
                            {a.renews_at && (
                              <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>
                                Renueva el {new Date(a.renews_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                              </div>
                            )}
                            {(a.instantly_email || a.client_email || a.client_phone || a.client_contact) && (
                              <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {a.instantly_email && <span>✉ Instantly: <code style={{ fontSize: 10, color: "var(--text-dim)" }}>{a.instantly_email}</code></span>}
                                {a.client_contact && <span>👤 {a.client_contact}</span>}
                                {a.client_email && <span>📧 {a.client_email}</span>}
                                {a.client_phone && <span>📞 {a.client_phone}</span>}
                              </div>
                            )}
                            {a.notes && (
                              <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 4, fontStyle: "italic", background: "var(--bg-elev-2)", padding: "4px 8px", borderRadius: 6 }}>
                                📝 {a.notes}
                              </div>
                            )}
                          </>
                        )}

                        {/* Inline editor — completo */}
                        {editingAcctId === a.id && (
                          <div style={{ marginTop: 10, padding: 12, background: "var(--bg-elev-2)", borderRadius: 9, display: "flex", flexDirection: "column", gap: 8 }}>
                            <EditField label="Título" value={editAcct.title} onChange={(v) => setEditAcct({ ...editAcct, title: v })} placeholder="Ej: Cliente Acme" />
                            {!a.is_owner && (
                              <>
                                <EditField label="Empresa del cliente" value={editAcct.client_company} onChange={(v) => setEditAcct({ ...editAcct, client_company: v })} placeholder="Ej: Acme S.L." />
                                <EditField label="Persona de contacto" value={editAcct.client_contact} onChange={(v) => setEditAcct({ ...editAcct, client_contact: v })} placeholder="Ej: Juan Pérez" />
                                <EditField label="Email del cliente (tú escribes aquí)" value={editAcct.client_email} onChange={(v) => setEditAcct({ ...editAcct, client_email: v })} placeholder="juan@acme.com" />
                                <EditField label="Teléfono del cliente" value={editAcct.client_phone} onChange={(v) => setEditAcct({ ...editAcct, client_phone: v })} placeholder="+34 ..." />
                              </>
                            )}
                            <EditField label="Email con el que entra a Instantly" value={editAcct.instantly_email} onChange={(v) => setEditAcct({ ...editAcct, instantly_email: v })} placeholder={a.is_owner ? "team@onepulso.online" : "user@cliente.com"} />
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>Plan</label>
                                <input value={editAcctPlan} onChange={(e) => setEditAcctPlan(e.target.value)} placeholder="Growth, Pro…" style={inputSm} />
                              </div>
                              <div>
                                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>Renueva</label>
                                <input type="date" value={editAcctRenews} onChange={(e) => setEditAcctRenews(e.target.value)} style={inputSm} />
                              </div>
                            </div>
                            <div>
                              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>API Key <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— vacío = no cambiar</span></label>
                              <input type="password" value={editAcct.api_key} onChange={(e) => setEditAcct({ ...editAcct, api_key: e.target.value })} placeholder="••••••••" style={{ ...inputSm, fontFamily: "var(--font-mono)" }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)" }}>Notas</label>
                              <textarea value={editAcct.notes} onChange={(e) => setEditAcct({ ...editAcct, notes: e.target.value })} placeholder="Cualquier nota interna sobre este cliente…" rows={2} style={{ ...inputSm, resize: "vertical", fontFamily: "inherit" }} />
                            </div>
                            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                              <button onClick={() => saveEditAccount(a.id)} style={{ padding: "7px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>💾 Guardar</button>
                              <button onClick={() => setEditingAcctId(null)} style={{ padding: "7px 14px", background: "transparent", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: "var(--text-dim)" }}>Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {editingAcctId !== a.id && (
                        <button
                          onClick={() => startEditAccount(a)}
                          title="Editar fecha de renovación / plan"
                          style={{
                            padding: "6px 9px", background: "transparent", color: "var(--text-faint)",
                            border: "1px solid var(--border)", borderRadius: 8,
                            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >✏️</button>
                      )}
                      {!a.is_owner && (
                        <button
                          onClick={() => markAsOwner(a.id, a.title)}
                          title="Marcar como mi cuenta principal (onepulso)"
                          style={{
                            padding: "6px 9px", background: "transparent", color: "#0071e3",
                            border: "1px solid rgba(0,113,227,0.3)", borderRadius: 8,
                            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >🏠</button>
                      )}
                      {!a.active && (
                        <button
                          onClick={() => setActiveInstantly(a.id)}
                          style={{
                            padding: "6px 11px",
                            background: a.is_owner
                              ? "linear-gradient(135deg, #0071e3, #1d4ed8)"
                              : "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                            color: "#fff",
                            border: "none", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                            cursor: "pointer", fontFamily: "inherit",
                          }}
                        >Usar</button>
                      )}
                      {!a.is_owner && (
                        <button
                          onClick={() => deleteInstantlyAccount(a.id, a.title)}
                          title="Eliminar"
                          style={{
                            padding: "6px 9px", background: "transparent", color: "var(--text-faint)",
                            border: "1px solid var(--border)", borderRadius: 8,
                            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Formulario añadir nueva */}
            <div style={{
              padding: 14,
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border)",
              borderRadius: 12,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "var(--text-dim)",
                marginBottom: 8,
              }}>
                + Añadir cuenta
              </div>
              {/* Tipo: mía vs cliente */}
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setNewAcctIsOwner(true)}
                  style={{
                    flex: 1, padding: "8px 10px",
                    background: newAcctIsOwner ? "linear-gradient(135deg, #0071e3, #1d4ed8)" : "#fff",
                    color: newAcctIsOwner ? "#fff" : "var(--text-dim)",
                    border: `1.5px solid ${newAcctIsOwner ? "transparent" : "var(--border)"}`,
                    borderRadius: 9, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >🏠 Mía (onepulso)</button>
                <button
                  type="button"
                  onClick={() => setNewAcctIsOwner(false)}
                  style={{
                    flex: 1, padding: "8px 10px",
                    background: !newAcctIsOwner ? "linear-gradient(135deg, #8b5cf6, #6d28d9)" : "#fff",
                    color: !newAcctIsOwner ? "#fff" : "var(--text-dim)",
                    border: `1.5px solid ${!newAcctIsOwner ? "transparent" : "var(--border)"}`,
                    borderRadius: 9, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >👤 Cliente</button>
              </div>
              <input
                value={newAcctTitle}
                onChange={(e) => setNewAcctTitle(e.target.value)}
                placeholder={newAcctIsOwner ? "Título: ej. onepulso" : "Título: ej. cliente Acme"}
                style={{
                  width: "100%", padding: "9px 11px",
                  background: "#fff", border: "1px solid var(--border)",
                  borderRadius: 9, fontSize: 13, color: "var(--text)",
                  outline: "none", boxSizing: "border-box", marginBottom: 8,
                  fontFamily: "inherit",
                }}
              />
              <input
                value={newAcctKey}
                onChange={(e) => setNewAcctKey(e.target.value)}
                placeholder="API key de Instantly"
                type="password"
                style={{
                  width: "100%", padding: "9px 11px",
                  background: "#fff", border: "1px solid var(--border)",
                  borderRadius: 9, fontSize: 13, color: "var(--text)",
                  outline: "none", boxSizing: "border-box", marginBottom: 8,
                  fontFamily: "var(--font-mono)",
                }}
              />
              {!newAcctIsOwner && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input
                    value={newAcctClientCompany}
                    onChange={(e) => setNewAcctClientCompany(e.target.value)}
                    placeholder="Empresa del cliente"
                    style={{
                      width: "100%", padding: "8px 10px",
                      background: "#fff", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12.5, color: "var(--text)",
                      outline: "none", boxSizing: "border-box", fontFamily: "inherit",
                    }}
                  />
                  <input
                    value={newAcctClientContact}
                    onChange={(e) => setNewAcctClientContact(e.target.value)}
                    placeholder="Contacto"
                    style={{
                      width: "100%", padding: "8px 10px",
                      background: "#fff", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12.5, color: "var(--text)",
                      outline: "none", boxSizing: "border-box", fontFamily: "inherit",
                    }}
                  />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>Plan (opcional)</label>
                  <input
                    value={newAcctPlan}
                    onChange={(e) => setNewAcctPlan(e.target.value)}
                    placeholder="Growth, Pro, Trial…"
                    style={{
                      width: "100%", padding: "8px 10px",
                      background: "#fff", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12.5, color: "var(--text)",
                      outline: "none", boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>Renueva el (opcional)</label>
                  <input
                    type="date"
                    value={newAcctRenews}
                    onChange={(e) => setNewAcctRenews(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 10px",
                      background: "#fff", border: "1px solid var(--border)",
                      borderRadius: 8, fontSize: 12.5, color: "var(--text)",
                      outline: "none", boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>
              <button
                onClick={addInstantlyAccount}
                disabled={savingAcct || !newAcctTitle.trim() || !newAcctKey.trim()}
                style={{
                  width: "100%", padding: "10px 14px",
                  background: "var(--accent)", color: "#fff",
                  border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                  opacity: (savingAcct || !newAcctTitle.trim() || !newAcctKey.trim()) ? 0.5 : 1,
                  boxShadow: "0 2px 8px rgba(0,113,227,0.25)",
                }}
              >
                {savingAcct ? "Guardando..." : "Añadir cuenta"}
              </button>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5 }}>
                💡 La API key se guarda en Postgres. Tu memoria y skills se comparten entre todas las cuentas.
              </div>
            </div>

            {/* Sección: sincronizar leads reales desde Instantly */}
            <div style={{
              marginTop: 16, padding: 14,
              background: "linear-gradient(135deg, rgba(0,113,227,0.04), rgba(0,113,227,0.08))",
              border: "1px solid rgba(0,113,227,0.25)",
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                🔄 Sincronizar leads reales desde Instantly
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, marginBottom: 10 }}>
                Si subiste leads desde fuera de la plataforma (Instantly UI, CSV directo, etc.), los contadores aquí pueden estar desactualizados. Esto recorre tus campañas en la cuenta activa y trae el conteo REAL.
              </div>
              <button
                onClick={refreshLeadsCount}
                disabled={refreshingLeads}
                style={{
                  padding: "8px 14px",
                  background: refreshingLeads ? "var(--bg-elev-3)" : "linear-gradient(135deg, #0071e3, #1d4ed8)",
                  color: refreshingLeads ? "var(--text-dim)" : "#fff",
                  border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                  cursor: refreshingLeads ? "wait" : "pointer", fontFamily: "inherit",
                  boxShadow: refreshingLeads ? "none" : "0 2px 8px rgba(0,113,227,0.25)",
                }}
              >
                {refreshingLeads ? "Sincronizando… (puede tardar 30-60s)" : "🔄 Refrescar contadores ahora"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputSm: React.CSSProperties = {
  padding: "7px 10px",
  border: "1px solid var(--border)",
  borderRadius: 7,
  fontSize: 12.5,
  fontFamily: "inherit",
  background: "#fff",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
  color: "var(--text)",
};

function EditField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 3 }}>{label}</label>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputSm} />
    </div>
  );
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
