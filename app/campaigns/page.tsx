"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  "Crea una campaña 'SaaS B2B Q3' con framework investigación → problema → solución → CTA, para CTOs de SaaS en España",
  "Listame las campañas que tengo en Instantly",
  "Lee mi memoria y dime qué sabes de mí",
  "Guarda en memoria que mi tono es profesional pero cercano, sin jerga corporate",
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
  const [instantlyStatus, setInstantlyStatus] = useState<{ connected: boolean; count?: number } | null>(null);
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
    if ((!text.trim() && attachments.length === 0) || busy) return;

    const attachBlock = attachments.length
      ? attachments
          .map((a) => `[ARCHIVO ADJUNTO: ${a.name}]\n${a.text}\n[FIN ARCHIVO]`)
          .join("\n\n")
      : "";
    const userVisible = attachments.length
      ? `${text}${text ? "\n\n" : ""}📎 ${attachments.map((a) => a.name).join(", ")}`
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
    const added: Array<{ name: string; text: string; size: number }> = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/chat/attach", { method: "POST", body: fd });
        const data = await res.json();
        if (data.name) added.push({ name: data.name, text: data.text, size: data.size });
      } catch {
        /* skip */
      }
    }
    setAttachments((prev) => [...prev, ...added]);
    setAttaching(false);
  }

  function onComposerDrop(e: React.DragEvent) {
    e.preventDefault();
    attachFiles(e.dataTransfer.files);
  }

  return (
    <div className="app">
      {/* Sidebar — campañas */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link href="/" className="brand-link">
            <div className="brand">
              <span className="brand-wordmark">onepulso</span>
              <span className="brand-c">©</span>
            </div>
            <div className="brand-sub">campañas</div>
          </Link>
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
        <div className="chat-header">
          <div>
            <div className="chat-title">Copiloto</div>
            <div className="chat-subtitle">
              {instantlyStatus?.connected ? (
                <>
                  <span style={{ color: "#22c55e" }}>● </span>
                  Instantly conectado · {instantlyStatus.count} campañas
                </>
              ) : instantlyStatus ? (
                <span style={{ color: "var(--error)" }}>● Instantly: error de conexión</span>
              ) : (
                <span>● comprobando…</span>
              )}
              {" · "}
              {memory.length} notas en memoria
            </div>
          </div>
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
                {attachments.map((a, i) => (
                  <div key={i} className="attach-chip">
                    <span className="attach-icon">📎</span>
                    <span className="attach-name">{a.name}</span>
                    <span className="attach-size">{formatSize(a.size)}</span>
                    <button
                      className="attach-remove"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Quitar"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {attaching && <span className="attach-loading">subiendo…</span>}
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
              placeholder="Escribe lo que quieres que haga, o arrastra archivos aquí…"
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
            Enter envía · Shift+Enter nueva línea · 📎 o arrastra para adjuntar
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
