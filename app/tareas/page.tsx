"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Task = {
  id: string;
  title: string;
  description?: string;
  due_at?: string;
  status: "pending" | "done";
  priority: "low" | "medium" | "high";
  client_thread_id?: string;
  client_email?: string;
  client_name?: string;
  created_at: string;
  completed_at?: string;
  reminder_sent_at?: string;
};

type ThreadSummary = {
  id: string;
  subject: string;
  contact_email: string;
  contact_name: string;
};

type Filter = "all" | "pending" | "done" | "overdue" | "today" | "week";

export default function TareasPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // Form state
  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fDueDate, setFDueDate] = useState("");
  const [fDueTime, setFDueTime] = useState("10:00");
  const [fPriority, setFPriority] = useState<"low" | "medium" | "high">("medium");
  const [fClientThreadId, setFClientThreadId] = useState<string>("");
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [tsr, thr] = await Promise.all([
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/email/threads").then((r) => r.json()).catch(() => ({ threads: [] })),
      ]);
      setTasks(tsr.tasks ?? []);
      setThreads(
        (thr.threads ?? []).map((t: any) => ({
          id: t.id,
          subject: t.subject,
          contact_email: t.contact_email,
          contact_name: t.contact_name,
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, []);

  function openCreate() {
    setEditing(null);
    setFTitle("");
    setFDesc("");
    setFDueDate("");
    setFDueTime("10:00");
    setFPriority("medium");
    setFClientThreadId("");
    setFError(null);
    setModalOpen(true);
  }

  function openEdit(t: Task) {
    setEditing(t);
    setFTitle(t.title);
    setFDesc(t.description || "");
    if (t.due_at) {
      const d = new Date(t.due_at);
      setFDueDate(d.toISOString().slice(0, 10));
      setFDueTime(d.toTimeString().slice(0, 5));
    } else {
      setFDueDate("");
      setFDueTime("10:00");
    }
    setFPriority(t.priority);
    setFClientThreadId(t.client_thread_id || "");
    setFError(null);
    setModalOpen(true);
  }

  async function saveTask() {
    setFError(null);
    if (!fTitle.trim()) {
      setFError("El título es obligatorio.");
      return;
    }

    // Validar fecha si la hay
    let due_at: string | undefined;
    if (fDueDate) {
      // El input date devuelve YYYY-MM-DD; validamos rango de año razonable
      const yearMatch = fDueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!yearMatch) {
        setFError(`Fecha inválida: "${fDueDate}". Usa el formato dd/mm/yyyy con año de 4 dígitos.`);
        return;
      }
      const year = parseInt(yearMatch[1], 10);
      const nowYear = new Date().getFullYear();
      if (year < nowYear - 1 || year > nowYear + 10) {
        setFError(`El año ${year} no es razonable. Usa entre ${nowYear - 1} y ${nowYear + 10}.`);
        return;
      }
      const d = new Date(`${fDueDate}T${fDueTime || "10:00"}:00`);
      if (isNaN(d.getTime())) {
        setFError(`No pude interpretar la fecha "${fDueDate} ${fDueTime}". Vuelve a seleccionarla.`);
        return;
      }
      try {
        due_at = d.toISOString();
      } catch (e: any) {
        setFError(`Fecha fuera de rango: ${e.message || "error desconocido"}`);
        return;
      }
    }

    setFSaving(true);
    try {
      const client = threads.find((th) => th.id === fClientThreadId);
      const payload = {
        title: fTitle.trim(),
        description: fDesc.trim() || undefined,
        due_at,
        priority: fPriority,
        client_thread_id: fClientThreadId || undefined,
        client_email: client?.contact_email,
        client_name: client?.contact_name,
      };

      let res: Response;
      if (editing) {
        res = await fetch(`/api/tasks/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            reminder_sent_at: editing.due_at !== due_at ? undefined : editing.reminder_sent_at,
          }),
        });
      } else {
        res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setFError(j?.error || `Error del servidor: ${res.status} ${res.statusText}`);
        return;
      }

      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFError(`Error: ${e?.message || String(e)}`);
    } finally {
      setFSaving(false);
    }
  }

  async function toggleDone(t: Task) {
    await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: t.status === "done" ? "pending" : "done" }),
    });
    load();
  }

  async function removeTask(t: Task) {
    if (!confirm(`¿Eliminar la tarea "${t.title}"?`)) return;
    await fetch(`/api/tasks/${t.id}`, { method: "DELETE" });
    load();
  }

  const counts = useMemo(() => {
    const now = Date.now();
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const endWeek = new Date(); endWeek.setDate(endWeek.getDate() + 7);
    return {
      all: tasks.length,
      pending: tasks.filter((t) => t.status === "pending").length,
      done: tasks.filter((t) => t.status === "done").length,
      overdue: tasks.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() < now).length,
      today: tasks.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() >= startToday.getTime() && new Date(t.due_at).getTime() <= endToday.getTime()).length,
      week: tasks.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() <= endWeek.getTime() && new Date(t.due_at).getTime() >= now).length,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const endWeek = new Date(); endWeek.setDate(endWeek.getDate() + 7);

    let list = tasks.slice();
    if (filter === "pending") list = list.filter((t) => t.status === "pending");
    else if (filter === "done") list = list.filter((t) => t.status === "done");
    else if (filter === "overdue") list = list.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() < now);
    else if (filter === "today") list = list.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() <= endToday.getTime());
    else if (filter === "week") list = list.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at).getTime() <= endWeek.getTime());

    // Pendientes ordenadas por due_at ascendente; las sin fecha al final. Done por completed_at desc.
    if (filter === "done") {
      list.sort((a, b) => new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime());
    } else {
      list.sort((a, b) => {
        const av = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bv = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        return av - bv;
      });
    }
    return list;
  }, [tasks, filter]);

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 32px", overflow: "auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              ✓ Tareas
            </h1>
            <p style={{ color: "var(--text-dim)", marginTop: 6, fontSize: 13.5, maxWidth: 540 }}>
              Organiza tu trabajo. Recibe un email a <code style={{ background: "var(--bg-elev-2)", padding: "2px 6px", borderRadius: 5, fontSize: 12 }}>xaviriera03@gmail.com</code> cuando una tarea con fecha se acerque al vencimiento.
            </p>
          </div>
          <button onClick={openCreate} className="t-btn-primary">+ Nueva tarea</button>
        </header>

        {/* Filtros */}
        <div className="t-filter-bar">
          <FilterChip label="Pendientes" count={counts.pending} active={filter === "pending"} onClick={() => setFilter("pending")} color="#0071e3" />
          <FilterChip label="Vencidas" count={counts.overdue} active={filter === "overdue"} onClick={() => setFilter("overdue")} color="#ef4444" />
          <FilterChip label="Hoy" count={counts.today} active={filter === "today"} onClick={() => setFilter("today")} color="#f59e0b" />
          <FilterChip label="Esta semana" count={counts.week} active={filter === "week"} onClick={() => setFilter("week")} color="#8b5cf6" />
          <FilterChip label="Completadas" count={counts.done} active={filter === "done"} onClick={() => setFilter("done")} color="#22c55e" />
          <FilterChip label="Todas" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} color="#64748b" />
        </div>

        {/* Lista */}
        {loading ? (
          <div className="loading-pulse"><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className="t-empty">
            <div style={{ fontSize: 44, marginBottom: 10 }}>🌿</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
              {filter === "done" ? "Aún no has completado ninguna tarea" :
               filter === "overdue" ? "Sin tareas vencidas" :
               filter === "today" ? "Nada para hoy" :
               filter === "week" ? "Tranquilo, semana despejada" :
               "Empieza creando tu primera tarea"}
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: 13.5 }}>
              Pulsa <strong>+ Nueva tarea</strong> arriba para añadir una.
            </div>
          </div>
        ) : (
          <div className="t-list">
            {filtered.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => toggleDone(t)} onEdit={() => openEdit(t)} onDelete={() => removeTask(t)} />
            ))}
          </div>
        )}
      </div>

      {/* Modal nueva / editar */}
      {modalOpen && (
        <div onClick={() => !fSaving && setModalOpen(false)} className="t-modal-backdrop">
          <div onClick={(e) => e.stopPropagation()} className="t-modal">
            <div className="t-modal-head">
              <h3>{editing ? "Editar tarea" : "Nueva tarea"}</h3>
              <button onClick={() => setModalOpen(false)} disabled={fSaving} className="t-modal-close">×</button>
            </div>

            <label className="t-label">Título *</label>
            <input
              className="t-input"
              value={fTitle}
              onChange={(e) => setFTitle(e.target.value)}
              placeholder="Ej: Enviar propuesta a Juan"
              autoFocus
            />

            <label className="t-label">Descripción <span className="t-label-opt">opcional</span></label>
            <textarea
              className="t-input"
              rows={3}
              value={fDesc}
              onChange={(e) => setFDesc(e.target.value)}
              placeholder="Notas, contexto, lo que tengas que recordar…"
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label className="t-label">Fecha</label>
                <input
                  type="date"
                  className="t-input"
                  value={fDueDate}
                  min={new Date().toISOString().slice(0, 10)}
                  max={(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 10); return d.toISOString().slice(0, 10); })()}
                  onChange={(e) => { setFDueDate(e.target.value); setFError(null); }}
                />
              </div>
              <div>
                <label className="t-label">Hora</label>
                <input
                  type="time"
                  className="t-input"
                  value={fDueTime}
                  onChange={(e) => { setFDueTime(e.target.value); setFError(null); }}
                  disabled={!fDueDate}
                />
              </div>
            </div>

            <label className="t-label">Prioridad</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["low", "medium", "high"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setFPriority(p)}
                  className={`t-pri-chip t-pri-${p} ${fPriority === p ? "active" : ""}`}
                >
                  {p === "low" ? "○ Baja" : p === "medium" ? "◐ Media" : "● Alta"}
                </button>
              ))}
            </div>

            <label className="t-label">
              Cliente <span className="t-label-opt">opcional · vincula a un hilo de seguimientos</span>
            </label>
            <select
              className="t-input"
              value={fClientThreadId}
              onChange={(e) => setFClientThreadId(e.target.value)}
            >
              <option value="">— Sin cliente (tarea personal) —</option>
              {threads.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.contact_name || th.contact_email} · {th.subject}
                </option>
              ))}
            </select>

            {fError && (
              <div style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 9,
                color: "#b91c1c",
                fontSize: 12.5,
                lineHeight: 1.45,
              }}>
                ⚠ {fError}
              </div>
            )}

            <div className="t-modal-actions">
              <button className="t-btn-primary" onClick={saveTask} disabled={fSaving || !fTitle.trim()}>
                {fSaving ? "Guardando…" : editing ? "💾 Guardar cambios" : "+ Crear tarea"}
              </button>
              <button className="t-btn-ghost" onClick={() => setModalOpen(false)} disabled={fSaving}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .t-btn-primary {
          background: linear-gradient(135deg, #0071e3, #1d4ed8);
          color: #fff; border: none; padding: 10px 18px;
          border-radius: 10px; font-weight: 700; font-size: 13.5px;
          cursor: pointer; font-family: inherit;
          box-shadow: 0 2px 8px rgba(0,113,227,0.25);
          transition: all 0.15s;
        }
        .t-btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
        .t-btn-primary:disabled { opacity: 0.55; cursor: wait; }

        .t-btn-ghost {
          background: transparent; color: var(--text-dim);
          border: 1px solid var(--border); padding: 10px 16px;
          border-radius: 10px; font-weight: 600; font-size: 13.5px;
          cursor: pointer; font-family: inherit;
        }

        .t-filter-bar {
          display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;
        }

        .t-list {
          display: flex; flex-direction: column; gap: 8px;
          max-width: 920px;
        }

        .t-empty {
          background: #fff; border: 1px dashed var(--border);
          border-radius: 14px; padding: 60px 20px; text-align: center;
          max-width: 920px;
        }

        .t-modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 20px;
        }
        .t-modal {
          background: #fff; border-radius: 14px; padding: 24px;
          max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .t-modal-head {
          display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;
        }
        .t-modal-head h3 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
        .t-modal-close {
          background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--text-faint);
        }
        .t-modal-actions {
          display: flex; gap: 8px; margin-top: 20px;
        }
        .t-modal-actions .t-btn-primary { flex: 1; }

        .t-label {
          display: block; font-size: 11.5px; font-weight: 700;
          color: var(--text-dim); text-transform: uppercase;
          letter-spacing: 0.06em; margin-bottom: 6px; margin-top: 12px;
        }
        .t-label:first-of-type { margin-top: 0; }
        .t-label-opt {
          font-weight: 400; text-transform: none; letter-spacing: 0;
          color: var(--text-faint); margin-left: 6px;
        }
        .t-input {
          width: 100%; padding: 9px 12px;
          background: #fff; border: 1.5px solid var(--border);
          border-radius: 9px; font-size: 13.5px; color: var(--text);
          outline: none; font-family: inherit;
          box-sizing: border-box; margin-bottom: 4px;
          transition: border-color 0.15s;
        }
        .t-input:focus { border-color: var(--accent); }

        .t-pri-chip {
          padding: 7px 14px; border: 1.5px solid var(--border);
          border-radius: 9px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; font-family: inherit;
          background: #fff; color: var(--text-dim);
          transition: all 0.15s;
        }
        .t-pri-low.active { background: #f1f5f9; color: #475569; border-color: #94a3b8; }
        .t-pri-medium.active { background: rgba(245,158,11,0.12); color: #b45309; border-color: #f59e0b; }
        .t-pri-high.active { background: rgba(239,68,68,0.12); color: #b91c1c; border-color: #ef4444; }
      `}</style>
    </div>
  );
}

function FilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "7px 13px",
        background: active ? color : "#fff",
        color: active ? "#fff" : "var(--text)",
        border: `1.5px solid ${active ? color : "var(--border)"}`,
        borderRadius: 99,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.15s",
      }}
    >
      {label}
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 18, height: 18, padding: "0 6px",
        background: active ? "rgba(255,255,255,0.25)" : "var(--bg-elev-2)",
        color: active ? "#fff" : "var(--text-dim)",
        fontSize: 10.5, fontWeight: 700,
        borderRadius: 99,
      }}>{count}</span>
    </button>
  );
}

function TaskRow({ task, onToggle, onEdit, onDelete }: { task: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const isDone = task.status === "done";
  const isOverdue = task.due_at && !isDone && new Date(task.due_at).getTime() < Date.now();
  const isToday = task.due_at && !isDone && (() => {
    const d = new Date(task.due_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  })();

  const priorityColor =
    task.priority === "high" ? "#ef4444" :
    task.priority === "medium" ? "#f59e0b" : "#94a3b8";

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${isDone ? "#22c55e" : isOverdue ? "#ef4444" : isToday ? "#f59e0b" : priorityColor}`,
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        opacity: isDone ? 0.6 : 1,
        transition: "all 0.15s",
      }}
    >
      {/* Checkbox circular */}
      <button
        onClick={onToggle}
        title={isDone ? "Marcar como pendiente" : "Marcar como completada"}
        style={{
          width: 22, height: 22, flexShrink: 0,
          borderRadius: 99,
          border: `2px solid ${isDone ? "#22c55e" : "#cbd5e1"}`,
          background: isDone ? "#22c55e" : "transparent",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 12, fontWeight: 700,
          marginTop: 2,
          transition: "all 0.15s",
        }}
      >
        {isDone ? "✓" : ""}
      </button>

      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={onEdit}>
        <div style={{
          fontSize: 14, fontWeight: 600,
          color: isDone ? "var(--text-faint)" : "var(--text)",
          textDecoration: isDone ? "line-through" : "none",
          letterSpacing: "-0.01em",
          lineHeight: 1.35,
        }}>
          {task.title}
        </div>

        {task.description && (
          <div style={{
            fontSize: 12.5, color: "var(--text-dim)", marginTop: 4,
            lineHeight: 1.45,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
            textDecoration: isDone ? "line-through" : "none",
          }}>
            {task.description}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap", alignItems: "center" }}>
          {task.due_at && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 99,
              background: isOverdue ? "rgba(239,68,68,0.12)" : isToday ? "rgba(245,158,11,0.12)" : "rgba(0,113,227,0.08)",
              color: isOverdue ? "#dc2626" : isToday ? "#b45309" : "#0071e3",
              fontSize: 11, fontWeight: 700,
            }}>
              {isOverdue ? "⚠" : isToday ? "📅" : "📆"} {fmtDue(task.due_at)}
            </span>
          )}

          {task.client_name && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 99,
              background: "rgba(139,92,246,0.1)",
              color: "#7c3aed",
              fontSize: 11, fontWeight: 700,
            }}>
              👤 {task.client_name}
            </span>
          )}

          {task.priority !== "medium" && !isDone && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 99,
              background: task.priority === "high" ? "rgba(239,68,68,0.1)" : "var(--bg-elev-2)",
              color: task.priority === "high" ? "#b91c1c" : "var(--text-dim)",
              fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
            }}>
              {task.priority === "high" ? "● ALTA" : "○ BAJA"}
            </span>
          )}

          {task.reminder_sent_at && !isDone && (
            <span style={{
              fontSize: 10.5, color: "var(--text-faint)", fontWeight: 600,
            }}>
              ✉ Recordatorio enviado
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        title="Eliminar tarea"
        style={{
          background: "transparent", border: "none",
          color: "var(--text-faint)", cursor: "pointer",
          fontSize: 16, padding: "4px 6px",
          opacity: 0.5,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = "var(--text-faint)"; }}
      >
        ×
      </button>
    </div>
  );
}

function fmtDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const sameTomorrow = d.toDateString() === tomorrow.toDateString();

  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");

  if (sameDay) return `Hoy ${hh}:${mm}`;
  if (sameTomorrow) return `Mañana ${hh}:${mm}`;
  const diff = d.getTime() - now.getTime();
  if (diff < 0 && diff > -24 * 60 * 60 * 1000) return `Ayer ${hh}:${mm}`;
  return d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
