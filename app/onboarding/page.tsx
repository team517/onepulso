"use client";
import { useEffect, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Stage = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  order: number;
};

type Client = {
  id: string;
  name: string;
  slug: string;
  username: string;
  password: string;
  email?: string;
  project_title?: string;
  contact_name?: string;
  admin_notes?: string;
  completed_stage_ids: string[];
  current_stage_id?: string;
  status_message?: string;
  created_at: string;
  updated_at: string;
};

const BG = "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)";

export default function OnboardingPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showNewClient, setShowNewClient] = useState(false);
  const [showStagesModal, setShowStagesModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const [s, c] = await Promise.all([
      fetch("/api/onboarding/stages").then((r) => r.json()),
      fetch("/api/onboarding/clients").then((r) => r.json()),
    ]);
    setStages(s.stages || []);
    setClients(c.clients || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  const selected = selectedId ? clients.find((c) => c.id === selectedId) : null;

  function progressPct(c: Client): number {
    if (stages.length === 0) return 0;
    const done = c.completed_stage_ids.filter((id) => stages.some((s) => s.id === id)).length;
    const inProgress = c.current_stage_id && !c.completed_stage_ids.includes(c.current_stage_id) ? 0.5 : 0;
    return Math.round(((done + inProgress) / stages.length) * 100);
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" }}>
      <DashboardNav />
      <main style={{ flex: 1, padding: "32px 40px", overflow: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", color: "#0f172a" }}>
              Onboarding
            </h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14.5 }}>
              Da de alta un cliente, crea su URL de acceso y actualiza su progreso del proyecto.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowStagesModal(true)} style={btnGhost}>
              ⚙ Gestionar fases ({stages.length})
            </button>
            <button onClick={() => setShowNewClient(true)} style={btnPrimary}>
              + Nuevo cliente
            </button>
          </div>
        </div>

        {/* Empty state */}
        {!loading && clients.length === 0 && (
          <div style={card}>
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>◉</div>
              <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#0f172a" }}>Aún no has añadido clientes</h2>
              <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14 }}>
                {stages.length === 0
                  ? "Empieza por crear las fases del proceso, luego añade tu primer cliente."
                  : "Crea tu primer cliente y comparte la URL con él."}
              </p>
              {stages.length === 0 ? (
                <button onClick={() => setShowStagesModal(true)} style={btnPrimary}>
                  Crear fases del proceso
                </button>
              ) : (
                <button onClick={() => setShowNewClient(true)} style={btnPrimary}>
                  + Crear primer cliente
                </button>
              )}
            </div>
          </div>
        )}

        {/* Client list */}
        {!loading && clients.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20, alignItems: "start" }}>
            {/* Left column: list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {clients.map((c) => {
                const pct = progressPct(c);
                const isActive = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      ...cardItem,
                      borderColor: isActive ? "#0071e3" : "rgba(15,23,42,0.08)",
                      boxShadow: isActive ? "0 4px 16px rgba(0,113,227,0.18)" : "0 1px 3px rgba(15,23,42,0.04)",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em" }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                          {c.project_title || "Sin proyecto definido"}
                        </div>
                      </div>
                      <div style={{
                        background: pct === 100 ? "rgba(34,197,94,0.1)" : "rgba(0,113,227,0.08)",
                        color: pct === 100 ? "#16a34a" : "#0071e3",
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                      }}>
                        {pct}%
                      </div>
                    </div>
                    <ProgressBar pct={pct} thin />
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "#64748b" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                        <span style={{ flexShrink: 0 }}>✉</span>
                        <span style={{
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          color: c.email ? "#0071e3" : "#cbd5e1",
                          fontWeight: c.email ? 600 : 500,
                          fontStyle: c.email ? "normal" : "italic",
                        }}>
                          {c.email || "(sin email)"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ flexShrink: 0 }}>🔗</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>/o/{c.slug}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right column: detail */}
            <div>
              {selected ? (
                <ClientDetail
                  client={selected}
                  stages={stages}
                  onChange={async (patch) => {
                    const res = await fetch(`/api/onboarding/clients/${selected.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    });
                    const data = await res.json();
                    if (data.client) {
                      setClients((arr) => arr.map((c) => (c.id === data.client.id ? data.client : c)));
                      showToast("✓ Guardado");
                    }
                  }}
                  onDelete={async () => {
                    if (!confirm(`¿Eliminar ${selected.name}? Esta acción no se puede deshacer.`)) return;
                    await fetch(`/api/onboarding/clients/${selected.id}`, { method: "DELETE" });
                    setClients((arr) => arr.filter((c) => c.id !== selected.id));
                    setSelectedId(null);
                    showToast("✓ Cliente eliminado");
                  }}
                  onCopyLink={() => {
                    const url = `${window.location.origin}/o/${selected.slug}`;
                    navigator.clipboard.writeText(url);
                    showToast("✓ URL copiada");
                  }}
                  onCopyCredentials={() => {
                    const url = `${window.location.origin}/o/${selected.slug}`;
                    const text = `Hola ${selected.contact_name || ""}, accede al panel del proyecto:\n\nURL: ${url}\nUsuario: ${selected.username}\nContraseña: ${selected.password}`;
                    navigator.clipboard.writeText(text);
                    showToast("✓ Credenciales copiadas");
                  }}
                />
              ) : (
                <div style={{ ...card, textAlign: "center", padding: "48px 24px", color: "#94a3b8" }}>
                  Selecciona un cliente para ver el detalle.
                </div>
              )}
            </div>
          </div>
        )}

        {loading && <div style={{ color: "#64748b" }}>Cargando…</div>}

        {/* Modals */}
        {showNewClient && (
          <NewClientModal
            onClose={() => setShowNewClient(false)}
            onCreated={(c) => {
              setClients((arr) => [...arr, c]);
              setSelectedId(c.id);
              setShowNewClient(false);
              showToast("✓ Cliente creado");
            }}
          />
        )}

        {showStagesModal && (
          <StagesModal
            stages={stages}
            onClose={() => setShowStagesModal(false)}
            onChange={setStages}
          />
        )}

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: "#0f172a", color: "#fff", padding: "10px 20px", borderRadius: 10,
            fontSize: 13.5, fontWeight: 500, boxShadow: "0 8px 24px rgba(15,23,42,0.25)",
            zIndex: 100,
          }}>
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}

/* ────────────────  Helper components  ──────────────── */

function ProgressBar({ pct, thin = false }: { pct: number; thin?: boolean }) {
  return (
    <div style={{
      width: "100%",
      height: thin ? 6 : 10,
      background: "rgba(15,23,42,0.08)",
      borderRadius: 999,
      overflow: "hidden",
    }}>
      <div style={{
        width: `${pct}%`,
        height: "100%",
        background: pct === 100
          ? "linear-gradient(90deg, #22c55e, #16a34a)"
          : "linear-gradient(90deg, #0071e3, #3b82f6)",
        transition: "width 0.4s cubic-bezier(.4,0,.2,1)",
      }} />
    </div>
  );
}

function ClientDetail({
  client, stages, onChange, onDelete, onCopyLink, onCopyCredentials,
}: {
  client: Client;
  stages: Stage[];
  onChange: (patch: Partial<Client>) => Promise<void>;
  onDelete: () => Promise<void>;
  onCopyLink: () => void;
  onCopyCredentials: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [projectTitle, setProjectTitle] = useState(client.project_title || "");
  const [contactName, setContactName] = useState(client.contact_name || "");
  const [email, setEmail] = useState(client.email || "");
  const [username, setUsername] = useState(client.username);
  const [password, setPassword] = useState(client.password);
  const [statusMsg, setStatusMsg] = useState(client.status_message || "");
  const [adminNotes, setAdminNotes] = useState(client.admin_notes || "");
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    setName(client.name);
    setProjectTitle(client.project_title || "");
    setContactName(client.contact_name || "");
    setEmail(client.email || "");
    setUsername(client.username);
    setPassword(client.password);
    setStatusMsg(client.status_message || "");
    setAdminNotes(client.admin_notes || "");
  }, [client.id]);

  const pct = (() => {
    if (stages.length === 0) return 0;
    const done = client.completed_stage_ids.filter((id) => stages.some((s) => s.id === id)).length;
    const inProgress = client.current_stage_id && !client.completed_stage_ids.includes(client.current_stage_id) ? 0.5 : 0;
    return Math.round(((done + inProgress) / stages.length) * 100);
  })();

  async function toggleStage(stageId: string) {
    const isDone = client.completed_stage_ids.includes(stageId);
    const next = isDone
      ? client.completed_stage_ids.filter((id) => id !== stageId)
      : [...client.completed_stage_ids, stageId];
    await onChange({ completed_stage_ids: next });
  }

  async function setCurrent(stageId: string | null) {
    await onChange({ current_stage_id: stageId || undefined });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header card with progress */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>{client.name}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{client.project_title || "Sin proyecto"}</div>
            {/* Email destacado */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              marginTop: 10,
              padding: "5px 10px",
              background: client.email ? "rgba(0,113,227,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${client.email ? "rgba(0,113,227,0.2)" : "rgba(245,158,11,0.25)"}`,
              borderRadius: 999,
              fontSize: 12,
              color: client.email ? "#0071e3" : "#b45309",
              fontWeight: 600,
            }}>
              ✉ {client.email || "Sin email — añade uno abajo para conectar el Unibox"}
              {client.email && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(client.email!);
                  }}
                  style={{
                    background: "transparent", border: "none",
                    cursor: "pointer", padding: "0 0 0 4px",
                    fontSize: 11, opacity: 0.7,
                  }}
                  title="Copiar email"
                >📋</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: pct === 100 ? "#16a34a" : "#0071e3", letterSpacing: "-0.03em", flexShrink: 0 }}>
            {pct}%
          </div>
        </div>
        <ProgressBar pct={pct} />
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onCopyLink} style={btnGhost}>🔗 Copiar URL</button>
          <button onClick={onCopyCredentials} style={btnGhost}>📋 Copiar acceso</button>
          <a href={`/o/${client.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: "none" }}>
            ↗ Ver como cliente
          </a>
          <button onClick={onDelete} style={{ ...btnGhost, color: "#dc2626", borderColor: "rgba(220,38,38,0.2)" }}>
            🗑 Eliminar
          </button>
        </div>
      </div>

      {/* Stages list */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 12, letterSpacing: "-0.01em" }}>
          Fases del proyecto
        </div>
        {stages.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: "12px 0" }}>
            Aún no hay fases definidas. Crea fases en "Gestionar fases".
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stages.map((s, idx) => {
              const isDone = client.completed_stage_ids.includes(s.id);
              const isCurrent = client.current_stage_id === s.id;
              return (
                <div key={s.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: isDone ? "rgba(34,197,94,0.06)" : isCurrent ? "rgba(0,113,227,0.06)" : "#fff",
                  border: `1px solid ${isDone ? "rgba(34,197,94,0.25)" : isCurrent ? "rgba(0,113,227,0.25)" : "rgba(15,23,42,0.08)"}`,
                  borderRadius: 10,
                }}>
                  <button
                    onClick={() => toggleStage(s.id)}
                    style={{
                      width: 24, height: 24, borderRadius: "50%",
                      border: `2px solid ${isDone ? "#16a34a" : "rgba(15,23,42,0.18)"}`,
                      background: isDone ? "#16a34a" : "#fff",
                      color: "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                    title={isDone ? "Marcar pendiente" : "Marcar completado"}
                  >
                    {isDone ? "✓" : ""}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a" }}>
                      {idx + 1}. {s.icon} {s.title}
                    </div>
                    {s.description && (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{s.description}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setCurrent(isCurrent ? null : s.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 8,
                      border: `1px solid ${isCurrent ? "#0071e3" : "rgba(15,23,42,0.12)"}`,
                      background: isCurrent ? "#0071e3" : "#fff",
                      color: isCurrent ? "#fff" : "#475569",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {isCurrent ? "● En curso" : "○ Marcar en curso"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Datos del cliente */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em" }}>
            Datos del cliente
          </div>
          <div style={{
            fontSize: 10.5, color: "#94a3b8", letterSpacing: "0.04em",
            textTransform: "uppercase", fontWeight: 600,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            ✏ Auto-guardado al salir del campo
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Nombre cliente / empresa">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== client.name && onChange({ name })}
              style={input}
            />
          </Field>
          <Field label="Persona de contacto">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              onBlur={() => contactName !== (client.contact_name || "") && onChange({ contact_name: contactName })}
              style={input}
            />
          </Field>
          <Field label="Nombre del proyecto">
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              onBlur={() => projectTitle !== (client.project_title || "") && onChange({ project_title: projectTitle })}
              style={input}
            />
          </Field>
          <Field label="URL pública">
            <input value={`/o/${client.slug}`} readOnly style={{ ...input, background: "#f8fafc" }} />
          </Field>
          <Field label="Email del cliente (para enlazar Unibox)">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => email !== (client.email || "") && onChange({ email: email || undefined })}
              style={input}
              placeholder="cliente@empresa.com"
            />
          </Field>
          <Field label="Usuario">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => username !== client.username && onChange({ username })}
              style={input}
            />
          </Field>
          <Field label="Contraseña">
            <div style={{ position: "relative" }}>
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => password !== client.password && onChange({ password })}
                style={{ ...input, paddingRight: 70 }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "transparent", border: "none", color: "#64748b", fontSize: 11,
                  cursor: "pointer", padding: "4px 8px",
                }}
              >
                {showPwd ? "Ocultar" : "Ver"}
              </button>
            </div>
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="Mensaje al cliente (aparece bajo la barra de progreso)">
            <input
              value={statusMsg}
              onChange={(e) => setStatusMsg(e.target.value)}
              onBlur={() => statusMsg !== (client.status_message || "") && onChange({ status_message: statusMsg })}
              style={input}
              placeholder="Ej: Estamos en revisión de diseño, te contactaremos en 48h."
            />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field label="Notas internas (sólo admin, no las ve el cliente)">
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              onBlur={() => adminNotes !== (client.admin_notes || "") && onChange({ admin_notes: adminNotes })}
              rows={3}
              style={{ ...input, resize: "vertical", fontFamily: "inherit" }}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: "#64748b",
        letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 5,
      }}>{label}</div>
      {children}
    </label>
  );
}

function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Client) => void }) {
  const [name, setName] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          project_title: projectTitle || undefined,
          contact_name: contactName || undefined,
          email: email || undefined,
          username: username || undefined,
          password: password || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error al crear cliente");
        return;
      }
      onCreated(data.client);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Nuevo cliente">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Nombre cliente / empresa *">
          <input value={name} onChange={(e) => setName(e.target.value)} style={input} autoFocus required />
        </Field>
        <Field label="Persona de contacto">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} style={input} placeholder="Ej: Juan García" />
        </Field>
        <Field label="Nombre del proyecto">
          <input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} style={input} placeholder="Ej: Web corporativa v2" />
        </Field>
        <Field label="Email del cliente (debe coincidir con el del Unibox)">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} placeholder="cliente@empresa.com" />
        </Field>
        <Field label="Usuario de login (opcional, por defecto = slug)">
          <input value={username} onChange={(e) => setUsername(e.target.value)} style={input} placeholder="Se generará automáticamente" />
        </Field>
        <Field label="Contraseña (opcional, se genera automática)">
          <input value={password} onChange={(e) => setPassword(e.target.value)} style={input} placeholder="Se generará automáticamente" />
        </Field>

        {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancelar</button>
          <button type="submit" disabled={loading} style={btnPrimary}>
            {loading ? "Creando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StagesModal({ stages, onClose, onChange }: { stages: Stage[]; onClose: () => void; onChange: (s: Stage[]) => void }) {
  const [list, setList] = useState<Stage[]>(stages);
  const [newTitle, setNewTitle] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [newDesc, setNewDesc] = useState("");

  async function add() {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/onboarding/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, icon: newIcon || undefined, description: newDesc || undefined }),
    });
    const data = await res.json();
    if (data.stage) {
      const next = [...list, data.stage].sort((a, b) => a.order - b.order);
      setList(next);
      onChange(next);
      setNewTitle("");
      setNewIcon("");
      setNewDesc("");
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar esta fase? Se quitará de todos los clientes.")) return;
    await fetch(`/api/onboarding/stages/${id}`, { method: "DELETE" });
    const next = list.filter((s) => s.id !== id);
    setList(next);
    onChange(next);
  }

  async function updateTitle(id: string, title: string) {
    await fetch(`/api/onboarding/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const next = list.map((s) => (s.id === id ? { ...s, title } : s));
    setList(next);
    onChange(next);
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = list.findIndex((s) => s.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;
    const next = [...list];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setList(next);
    const ordered = next.map((s) => s.id);
    const res = await fetch("/api/onboarding/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ordered }),
    });
    const data = await res.json();
    if (data.stages) {
      setList(data.stages);
      onChange(data.stages);
    }
  }

  return (
    <Modal onClose={onClose} title="Fases del proceso" wide>
      <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>
        Define los pasos por los que pasa cada proyecto (los mismos para todos los clientes).
        Luego marcas cuáles están completados desde el detalle de cada cliente.
      </p>

      {/* Lista */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {list.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 16 }}>
            Aún no hay fases. Añade la primera ↓
          </div>
        )}
        {list.map((s, idx) => (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", background: "#fff",
            border: "1px solid rgba(15,23,42,0.08)", borderRadius: 10,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <button onClick={() => move(s.id, -1)} disabled={idx === 0} style={chevronBtn}>▲</button>
              <button onClick={() => move(s.id, +1)} disabled={idx === list.length - 1} style={chevronBtn}>▼</button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", minWidth: 24 }}>{idx + 1}.</div>
            <input
              defaultValue={`${s.icon ? s.icon + " " : ""}${s.title}`}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim();
                if (v && v !== `${s.icon ? s.icon + " " : ""}${s.title}`) updateTitle(s.id, v);
              }}
              style={{ ...input, flex: 1 }}
            />
            <button onClick={() => remove(s.id)} style={{ ...btnGhost, color: "#dc2626", padding: "6px 10px", fontSize: 12 }}>
              🗑
            </button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div style={{
        background: "rgba(0,113,227,0.04)",
        border: "1px dashed rgba(0,113,227,0.2)",
        borderRadius: 10,
        padding: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#0071e3", marginBottom: 10, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          + Añadir fase
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8, marginBottom: 10 }}>
          <input
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            placeholder="🎨"
            style={{ ...input, textAlign: "center", fontSize: 16 }}
            maxLength={3}
          />
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título de la fase (ej: Diseño UI)"
            style={input}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
        </div>
        <input
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Descripción opcional"
          style={{ ...input, marginBottom: 10 }}
        />
        <button onClick={add} style={btnPrimary} disabled={!newTitle.trim()}>
          Añadir fase
        </button>
      </div>

      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Cerrar</button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title, wide = false }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200, padding: 20,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 18, padding: "26px 28px",
        maxWidth: wide ? 640 : 460, width: "100%",
        maxHeight: "85vh", overflow: "auto",
        boxShadow: "0 24px 80px rgba(15,23,42,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0f172a" }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", fontSize: 22, color: "#94a3b8",
            cursor: "pointer", padding: 4, lineHeight: 1,
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ────────────────  Styles  ──────────────── */

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 16,
  padding: "20px 22px",
  boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
};

const cardItem: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 14,
  padding: "14px 16px",
  cursor: "pointer",
  transition: "all 0.15s ease",
  fontFamily: "inherit",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.12)",
  borderRadius: 9,
  color: "#0f172a",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "9px 18px",
  background: "#0071e3",
  border: "none",
  borderRadius: 10,
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "-0.01em",
  boxShadow: "0 2px 6px rgba(0,113,227,0.25)",
  fontFamily: "inherit",
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.12)",
  borderRadius: 10,
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const chevronBtn: React.CSSProperties = {
  width: 18, height: 14,
  background: "transparent", border: "none",
  color: "#94a3b8", cursor: "pointer", padding: 0,
  fontSize: 9, lineHeight: 1,
};
