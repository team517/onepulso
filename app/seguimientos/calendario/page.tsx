"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardNav from "../../components/DashboardNav";

type Event = {
  id: string;
  thread_id: string;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled" | "pending_approval";
  origin: "manual" | "ai_auto" | "ai_assisted";
  subject: string;
  contact_email: string;
  contact_name: string;
  contact_context: string;
  auto_pilot: boolean;
  body_html: string;
  sent_at?: string;
  cancelled_reason?: string;
  cancelled_at?: string;
  error?: string;
};

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default function CalendarPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [savingContext, setSavingContext] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const j = await fetch("/api/email/followups/calendar").then(r => r.json());
      setEvents(j.events ?? []);
    } finally { setLoading(false); }
  }

  // Group events by YYYY-MM-DD
  const byDay = useMemo(() => {
    const m: Record<string, Event[]> = {};
    for (const e of events) {
      const d = new Date(e.scheduled_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      (m[key] = m[key] ?? []).push(e);
    }
    return m;
  }, [events]);

  // Build month grid
  const days = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    // Lunes = 0; ajusta para semana ES
    let firstWeekday = first.getDay() - 1;
    if (firstWeekday < 0) firstWeekday = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const grid: { date: Date; inMonth: boolean }[] = [];
    // padding al inicio (días del mes anterior)
    for (let i = firstWeekday; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      grid.push({ date: d, inMonth: false });
    }
    // días del mes
    for (let i = 1; i <= daysInMonth; i++) {
      grid.push({ date: new Date(year, month, i), inMonth: true });
    }
    // padding al final hasta múltiplo de 7
    while (grid.length % 7 !== 0) {
      const last = grid[grid.length - 1].date;
      const next = new Date(last);
      next.setDate(last.getDate() + 1);
      grid.push({ date: next, inMonth: false });
    }
    return grid;
  }, [cursor]);

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function isToday(d: Date) {
    const t = new Date();
    return t.toDateString() === d.toDateString();
  }

  function prev() { setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1)); }
  function next() { setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1)); }
  function today() {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDay(d);
  }

  // Eventos del día seleccionado
  const dayEvents = selectedDay ? (byDay[dateKey(selectedDay)] ?? []) : [];

  // Próximos eventos (lista lateral)
  const upcoming = useMemo(() =>
    events.filter(e => e.status === "scheduled" && new Date(e.scheduled_at) >= new Date())
      .slice(0, 8),
    [events]
  );

  async function saveContext() {
    if (!selectedEvent) return;
    setSavingContext(true);
    try {
      await fetch(`/api/email/threads/${selectedEvent.thread_id}/autopilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_name: selectedEvent.contact_name,
          contact_context: selectedEvent.contact_context,
        }),
      });
      await load();
    } finally {
      setSavingContext(false);
    }
  }

  async function toggleAutopilot() {
    if (!selectedEvent) return;
    const enabled = !selectedEvent.auto_pilot;
    await fetch(`/api/email/threads/${selectedEvent.thread_id}/autopilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setSelectedEvent({ ...selectedEvent, auto_pilot: enabled });
    await load();
  }

  return (
    <div className="dash-shell">
      <DashboardNav />

      <div className="dash-content">
        {/* Header */}
        <div className="dash-page-header">
          <div>
            <div className="dash-page-title">Calendario de seguimientos</div>
            <div className="dash-page-subtitle">
              {events.filter(e => e.status === "scheduled").length} programados ·{" "}
              {events.filter(e => e.auto_pilot && e.status === "scheduled").length} en autopilot
            </div>
          </div>
          <div className="dash-page-actions">
            <Link href="/seguimientos" style={btnSecondary}>← Volver a Seguimientos</Link>
            <button onClick={load} style={btnSecondary}>↻ Recargar</button>
          </div>
        </div>

        <div style={{
          flex: 1, overflow: "hidden",
          display: "grid", gridTemplateColumns: "1fr 320px",
          gap: 0,
        }}>
          {/* Calendar */}
          <div style={{ overflow: "auto", padding: "20px 24px" }}>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={prev} style={navBtn}>‹</button>
                <button onClick={today} style={{ ...btnSecondary, padding: "7px 14px", fontSize: 12.5 }}>Hoy</button>
                <button onClick={next} style={navBtn}>›</button>
                <h2 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 22, fontWeight: 700,
                  letterSpacing: "-0.02em", color: "var(--text)",
                  marginLeft: 8,
                }}>
                  {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                </h2>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--text-faint)" }}>
                <Legend color="#0071e3" label="Programado" />
                <Legend color="#10b981" label="Enviado" />
                <Legend color="#f59e0b" label="Auto" />
              </div>
            </div>

            {/* Weekdays */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4, marginBottom: 6,
            }}>
              {WEEKDAYS.map(d => (
                <div key={d} style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: "var(--text-faint)",
                  textAlign: "center", padding: "6px 0",
                }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
            }}>
              {days.map(({ date, inMonth }, i) => {
                const k = dateKey(date);
                const evs = byDay[k] ?? [];
                const isSel = selectedDay && selectedDay.toDateString() === date.toDateString();
                const todayStyle = isToday(date);

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(date)}
                    style={{
                      minHeight: 96,
                      background: inMonth ? "#ffffff" : "var(--bg-elev-2)",
                      border: "1px solid",
                      borderColor: isSel ? "var(--accent)" : todayStyle ? "rgba(0,113,227,0.4)" : "var(--border)",
                      borderRadius: 10,
                      padding: 7,
                      cursor: "pointer",
                      opacity: inMonth ? 1 : 0.55,
                      transition: "all 0.15s",
                      boxShadow: isSel ? "0 0 0 2px rgba(0,113,227,0.18)" : "none",
                      position: "relative",
                    }}
                  >
                    <div style={{
                      fontSize: 12, fontWeight: todayStyle ? 700 : 500,
                      color: todayStyle ? "var(--accent)" : "var(--text)",
                      marginBottom: 4,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                      <span>{date.getDate()}</span>
                      {evs.length > 0 && (
                        <span style={{
                          fontSize: 9.5, fontWeight: 700,
                          padding: "1px 6px", borderRadius: 99,
                          background: "rgba(0,113,227,0.12)",
                          color: "var(--accent)",
                        }}>{evs.length}</span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {evs.slice(0, 3).map(e => {
                        const s = statusInfo(e);
                        const isCancelled = e.status === "cancelled";
                        return (
                          <div
                            key={e.id}
                            onClick={ev => { ev.stopPropagation(); setSelectedEvent(e); }}
                            style={{
                              fontSize: 10.5, fontWeight: 600,
                              padding: "3px 7px", borderRadius: 6,
                              background: s.bg,
                              color: s.fg,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              cursor: "pointer",
                              opacity: isCancelled ? 0.65 : 1,
                              textDecoration: isCancelled ? "line-through" : "none",
                            }}
                            title={`${e.contact_name} · ${new Date(e.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · ${s.label}${e.cancelled_reason === "prospect_replied" ? " (respondió)" : ""}`}
                          >
                            {s.icon} {new Date(e.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {e.contact_name}
                          </div>
                        );
                      })}
                      {evs.length > 3 && (
                        <div style={{ fontSize: 10, color: "var(--text-faint)", padding: "0 7px" }}>
                          +{evs.length - 3} más
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel */}
          <div style={{
            background: "#ffffff",
            borderLeft: "1px solid var(--border)",
            overflow: "auto",
            padding: "20px 18px",
          }}>
            {!selectedDay ? (
              <>
                <h3 style={panelTitle}>Próximos seguimientos</h3>
                {loading ? (
                  <div className="loading-pulse"><span/><span/><span/></div>
                ) : upcoming.length === 0 ? (
                  <div style={emptyMsg}>No hay seguimientos programados</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {upcoming.map(e => (
                      <EventRow key={e.id} event={e} onClick={() => setSelectedEvent(e)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <h3 style={panelTitle}>
                    {selectedDay.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
                  </h3>
                  <button onClick={() => setSelectedDay(null)} style={{ background: "transparent", border: "none", fontSize: 18, color: "var(--text-faint)", cursor: "pointer" }}>×</button>
                </div>
                {dayEvents.length === 0 ? (
                  <div style={emptyMsg}>Sin seguimientos este día</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {dayEvents.map(e => (
                      <EventRow key={e.id} event={e} onClick={() => setSelectedEvent(e)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal evento */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          savingContext={savingContext}
          onChange={ev => setSelectedEvent(ev)}
          onSaveContext={saveContext}
          onToggleAutopilot={toggleAutopilot}
          onClose={() => setSelectedEvent(null)}
          onReload={load}
        />
      )}
    </div>
  );
}

function EditableBody({
  event,
  onReload,
  onClose,
}: {
  event: Event;
  onReload: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(event.body_html || "");
  const [busy, setBusy] = useState(false);

  const isPending = event.status === "pending_approval";
  const isScheduled = event.status === "scheduled";
  const isFailed = event.status === "failed";
  const editable = isPending || isScheduled || isFailed;

  async function approve(sendNow: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/email/followups/${event.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_html: body,
          send_now: sendNow,
          ...(sendNow ? {} : { scheduled_at: event.scheduled_at }),
        }),
      });
      onReload();
      onClose();
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("¿Descartar este borrador?")) return;
    await fetch(`/api/email/followups/${event.id}/approve`, { method: "DELETE" });
    onReload();
    onClose();
  }

  async function saveEdit() {
    setBusy(true);
    try {
      // Guardar sin enviar: status sigue siendo el mismo, solo actualizamos body
      await fetch(`/api/email/followups/${event.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_html: body,
          send_now: false,
          scheduled_at: event.scheduled_at,
        }),
      });
      setEditing(false);
      onReload();
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ ...labelStyle, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{isPending ? "✨ Borrador del autopilot" : isScheduled ? "📧 Email programado" : isFailed ? "⚠ Falló — listo para reintentar" : "Preview"}</span>
        {editable && !editing && (
          <button onClick={() => setEditing(true)} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-dim)", padding: "3px 9px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            ✏️ Editar
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
          style={{
            width: "100%", padding: "11px 13px",
            background: "#fff", border: "1.5px solid var(--accent)",
            borderRadius: 10, fontSize: 13, lineHeight: 1.6,
            color: "var(--text)", outline: "none",
            fontFamily: "inherit", resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      ) : (
        <div
          style={{
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.65,
            color: "var(--text)",
            maxHeight: 240,
            overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: body }}
        />
      )}

      {editable && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {editing ? (
            <>
              <button onClick={saveEdit} disabled={busy} style={{
                padding: "9px 14px", background: "var(--accent)", color: "#fff",
                border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit",
              }}>
                {busy ? "Guardando…" : "💾 Guardar cambios"}
              </button>
              <button onClick={() => { setEditing(false); setBody(event.body_html); }} style={{
                padding: "9px 14px", background: "transparent", color: "var(--text-dim)",
                border: "1px solid var(--border)", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}>
                Cancelar edición
              </button>
            </>
          ) : (
            <>
              <button onClick={() => approve(true)} disabled={busy} style={{
                padding: "9px 14px",
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                color: "#fff", border: "none", borderRadius: 9,
                fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit",
              }}>
                {busy ? "Enviando..." : "🚀 Enviar AHORA"}
              </button>
              {isPending && (
                <button onClick={() => approve(false)} disabled={busy} style={{
                  padding: "9px 14px", background: "var(--accent)", color: "#fff",
                  border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                  ⏰ Aprobar (saldrá {new Date(event.scheduled_at).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})
                </button>
              )}
              <button onClick={cancel} style={{
                padding: "9px 14px", background: "transparent", color: "var(--error)",
                border: "1px solid rgba(239,68,68,0.25)", borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}>
                Descartar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
      {label}
    </span>
  );
}

/** Estilo unificado por estado de follow-up */
function statusInfo(event: Event): { label: string; bg: string; fg: string; border: string; icon: string } {
  switch (event.status) {
    case "sent":
      return { label: "ENVIADO", bg: "rgba(16,185,129,0.12)", fg: "#059669", border: "#10b981", icon: "✓" };
    case "scheduled":
      return event.auto_pilot
        ? { label: "AUTO", bg: "rgba(245,158,11,0.12)", fg: "#b45309", border: "#f59e0b", icon: "🤖" }
        : { label: "PROGRAMADO", bg: "rgba(0,113,227,0.10)", fg: "#0071e3", border: "#0071e3", icon: "📅" };
    case "pending_approval":
      return { label: "ESPERA APROBACIÓN", bg: "rgba(99,102,241,0.12)", fg: "#4f46e5", border: "#6366f1", icon: "⏸" };
    case "sending":
      return { label: "ENVIANDO", bg: "rgba(0,113,227,0.10)", fg: "#0071e3", border: "#0071e3", icon: "📤" };
    case "failed":
      return { label: "FALLÓ", bg: "rgba(239,68,68,0.10)", fg: "#dc2626", border: "#ef4444", icon: "⚠" };
    case "cancelled":
      const reason = event.cancelled_reason;
      if (reason === "prospect_replied") {
        return { label: "RESPONDIÓ", bg: "rgba(34,197,94,0.12)", fg: "#15803d", border: "#22c55e", icon: "💬" };
      }
      return { label: "CANCELADO", bg: "rgba(100,116,139,0.10)", fg: "#475569", border: "#94a3b8", icon: "✕" };
    default:
      return { label: event.status, bg: "var(--bg-elev-3)", fg: "var(--text-dim)", border: "var(--border)", icon: "·" };
  }
}

function EventRow({ event, onClick }: { event: Event; onClick: () => void }) {
  const time = new Date(event.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const date = new Date(event.scheduled_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  const s = statusInfo(event);
  const isCancelled = event.status === "cancelled";

  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${s.border}`,
        borderRadius: 10,
        padding: "10px 12px",
        cursor: "pointer",
        transition: "all 0.15s",
        opacity: isCancelled ? 0.6 : 1,
      }}
    >
      <div style={{
        fontSize: 13.5, fontWeight: 700, color: "var(--text)",
        letterSpacing: "-0.01em",
        textDecoration: isCancelled ? "line-through" : "none",
      }}>
        {event.contact_name}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {event.subject}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
          {date} · {time}
        </span>
        <span style={{
          fontSize: 9.5, fontWeight: 700,
          padding: "1px 7px", borderRadius: 99,
          background: s.bg, color: s.fg,
          letterSpacing: "0.04em",
        }}>{s.icon} {s.label}</span>
        {event.auto_pilot && event.status !== "scheduled" && (
          <span style={{
            fontSize: 9.5, fontWeight: 700,
            padding: "1px 7px", borderRadius: 99,
            background: "rgba(245,158,11,0.12)", color: "#b45309",
          }}>🤖 AUTO</span>
        )}
      </div>
    </div>
  );
}

function EventModal({
  event, savingContext, onChange, onSaveContext, onToggleAutopilot, onClose, onReload,
}: {
  event: Event;
  savingContext: boolean;
  onChange: (e: Event) => void;
  onSaveContext: () => void;
  onToggleAutopilot: () => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [sendingNow, setSendingNow] = useState(false);

  async function sendNow() {
    const isRetry = event.status === "failed";
    const msg = isRetry
      ? `¿Reintentar el envío a ${event.contact_name}?\n\nÚltimo error: ${event.error ?? "(sin detalle)"}\n\nSe enviará por SMTP con la cuenta conectada.`
      : `¿Enviar AHORA el email a ${event.contact_name}?\n\nSe enviará inmediatamente, antes de la fecha programada (${new Date(event.scheduled_at).toLocaleString("es-ES")}).`;
    if (!confirm(msg)) return;
    setSendingNow(true);
    try {
      const r = await fetch(`/api/email/followups/${event.id}/send-now`, { method: "POST" });
      const j = await r.json();
      if (j.error) {
        alert("⚠️ " + j.error);
      } else {
        alert(`✓ Enviado a ${j.sent_to}`);
        onReload();
        onClose();
      }
    } finally {
      setSendingNow(false);
    }
  }
  const date = new Date(event.scheduled_at).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = new Date(event.scheduled_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  return (
    <div onClick={onClose} style={modalBackdrop}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalBox, width: "92%", maxWidth: 580, maxHeight: "92vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
              {event.contact_name}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>
              {event.contact_email}
            </div>
            <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 5, fontWeight: 600 }}>
              📅 {date} · {time}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "var(--text-faint)", cursor: "pointer" }}>×</button>
        </div>

        {/* Subject */}
        <div style={{
          background: "var(--bg-elev-2)",
          borderRadius: 10, padding: "10px 13px",
          marginBottom: 14, fontSize: 13,
        }}>
          <span style={{ color: "var(--text-faint)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 8 }}>
            Asunto
          </span>
          {event.subject}
        </div>

        {/* Status badges */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {(() => {
            const s = statusInfo(event);
            return (
              <span style={{
                padding: "3px 10px", borderRadius: 999,
                fontSize: 11, fontWeight: 700,
                background: s.bg, color: s.fg,
              }}>{s.icon} {s.label}</span>
            );
          })()}
          <Pill color={event.auto_pilot ? "amber" : "grey"} text={event.auto_pilot ? "🤖 Autopilot ON" : "Autopilot OFF"} />
          <Pill color="purple" text={`origen: ${event.origin}`} />
        </div>

        {/* Motivo de cancelación */}
        {event.status === "cancelled" && (
          <div style={{
            background: event.cancelled_reason === "prospect_replied"
              ? "rgba(34,197,94,0.08)"
              : "rgba(100,116,139,0.08)",
            border: "1px solid",
            borderColor: event.cancelled_reason === "prospect_replied"
              ? "rgba(34,197,94,0.3)"
              : "rgba(100,116,139,0.25)",
            borderRadius: 10,
            padding: "10px 13px",
            marginBottom: 14,
            fontSize: 12.5,
            color: event.cancelled_reason === "prospect_replied" ? "#15803d" : "var(--text-dim)",
            lineHeight: 1.5,
          }}>
            {event.cancelled_reason === "prospect_replied" ? (
              <><strong>💬 El prospect respondió.</strong> Este follow-up se canceló automáticamente porque la conversación está activa otra vez.</>
            ) : (
              <><strong>✕ Cancelado.</strong> {event.cancelled_at ? `Cancelado el ${new Date(event.cancelled_at).toLocaleString("es-ES")}` : "Sin motivo registrado"}.</>
            )}
          </div>
        )}

        {/* Error si falló */}
        {event.status === "failed" && event.error && (
          <div style={{
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10,
            padding: "10px 13px",
            marginBottom: 14,
            fontSize: 12.5,
            color: "#dc2626",
            lineHeight: 1.5,
          }}>
            <strong>⚠ Fallo al enviar:</strong> {event.error}
          </div>
        )}

        {/* Editable: Contact name */}
        <label style={labelStyle}>Nombre del contacto</label>
        <input
          value={event.contact_name}
          onChange={e => onChange({ ...event, contact_name: e.target.value })}
          style={inputStyle}
          placeholder="Ahmed Smith"
        />

        {/* Editable: Context */}
        <label style={{ ...labelStyle, marginTop: 14 }}>
          ✨ Contexto del contacto <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— el autopilot lo usará al redactar</span>
        </label>
        <textarea
          value={event.contact_context}
          onChange={e => onChange({ ...event, contact_context: e.target.value })}
          rows={6}
          placeholder={`Ej:
- CTO de empresa SaaS de 30 personas
- Estamos hablando del trial gratis del módulo IA
- Le interesó la integración con HubSpot
- Tono: técnico, valora datos concretos
- Objeción anterior: precio comparado con Lemlist`}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.55, fontSize: 13 }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={onSaveContext} disabled={savingContext} style={{ ...btnPrimary, flex: 1, minWidth: 140 }}>
            {savingContext ? "Guardando..." : "💾 Guardar contexto"}
          </button>
          <button onClick={onToggleAutopilot} style={{ ...btnSecondary, flex: 1, minWidth: 140 }}>
            {event.auto_pilot ? "🛑 Desactivar autopilot" : "🤖 Activar autopilot"}
          </button>
        </div>

        {/* SEND NOW — si está scheduled */}
        {event.status === "scheduled" && (
          <button
            onClick={sendNow}
            disabled={sendingNow}
            style={{
              marginTop: 10, width: "100%",
              padding: "11px 16px",
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              color: "#fff", border: "none", borderRadius: 11,
              fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 4px 14px rgba(245,158,11,0.35)",
              fontFamily: "inherit",
              opacity: sendingNow ? 0.6 : 1,
            }}
          >
            {sendingNow ? "Enviando..." : "🚀 Enviar AHORA (antes de la fecha)"}
          </button>
        )}

        {/* RETRY — si está failed */}
        {event.status === "failed" && (
          <button
            onClick={sendNow}
            disabled={sendingNow}
            style={{
              marginTop: 10, width: "100%",
              padding: "11px 16px",
              background: "linear-gradient(135deg, #ef4444, #dc2626)",
              color: "#fff", border: "none", borderRadius: 11,
              fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 4px 14px rgba(239,68,68,0.35)",
              fontFamily: "inherit",
              opacity: sendingNow ? 0.6 : 1,
            }}
          >
            {sendingNow ? "Reintentando..." : "🔄 Reintentar envío ahora"}
          </button>
        )}

        {/* Body — editable si pending_approval o scheduled, preview si sent */}
        {event.body_html && (
          <EditableBody event={event} onReload={onReload} onClose={onClose} />
        )}

        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <Link
            href={`/seguimientos?thread=${event.thread_id}`}
            style={{ ...btnSecondary, flex: 1, textAlign: "center", textDecoration: "none" }}
          >
            Abrir hilo completo →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Pill({ color, text }: { color: "blue" | "green" | "amber" | "purple" | "grey"; text: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    blue:   { bg: "rgba(0,113,227,0.1)",  fg: "#0071e3" },
    green:  { bg: "rgba(16,185,129,0.1)", fg: "#059669" },
    amber:  { bg: "rgba(245,158,11,0.1)", fg: "#b45309" },
    purple: { bg: "rgba(139,92,246,0.1)", fg: "#7c3aed" },
    grey:   { bg: "rgba(100,116,139,0.1)", fg: "#475569" },
  };
  const c = map[color];
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 700,
      background: c.bg, color: c.fg,
    }}>{text}</span>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 13px", background: "var(--bg-elev-2)",
  border: "1.5px solid var(--border)", borderRadius: 10,
  fontSize: 13.5, color: "var(--text)", outline: "none", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 16px", background: "var(--accent)", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600,
  cursor: "pointer", boxShadow: "0 2px 8px rgba(0,113,227,0.25)", fontFamily: "inherit",
};
const btnSecondary: React.CSSProperties = {
  padding: "10px 14px", background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10, fontSize: 13,
  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  display: "inline-block", textDecoration: "none",
};
const navBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 9,
  border: "1px solid var(--border)", background: "#fff",
  color: "var(--text-dim)", fontSize: 18, cursor: "pointer",
};
const panelTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)", fontSize: 14.5, fontWeight: 700,
  letterSpacing: "-0.02em", color: "var(--text)", marginBottom: 10,
};
const emptyMsg: React.CSSProperties = {
  textAlign: "center", color: "var(--text-faint)", fontSize: 12.5,
  padding: "20px 0",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "grid", placeItems: "center", zIndex: 100, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 18, padding: 26,
  boxShadow: "0 24px 60px rgba(15,23,42,0.25)",
};
