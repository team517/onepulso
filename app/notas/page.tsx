"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Note = {
  id: string;
  title?: string;
  content: string;
  pinned?: boolean;
  color?: "yellow" | "blue" | "green" | "pink" | "purple" | "gray";
  tags?: string[];
  created_at: string;
  updated_at: string;
};

const COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  yellow: { bg: "#fef9c3", border: "#fde047", accent: "#a16207" },
  blue:   { bg: "#dbeafe", border: "#93c5fd", accent: "#1e40af" },
  green:  { bg: "#dcfce7", border: "#86efac", accent: "#15803d" },
  pink:   { bg: "#fce7f3", border: "#f9a8d4", accent: "#9d174d" },
  purple: { bg: "#ede9fe", border: "#c4b5fd", accent: "#6d28d9" },
  gray:   { bg: "#f1f5f9", border: "#cbd5e1", accent: "#475569" },
};

export default function NotasPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [colorFilter, setColorFilter] = useState<string | null>(null);

  // Quick add
  const [quickContent, setQuickContent] = useState("");
  const [quickColor, setQuickColor] = useState<Note["color"]>("yellow");
  const [adding, setAdding] = useState(false);

  // Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  async function load() {
    setLoading(true);
    try {
      const j = await fetch("/api/notes").then((r) => r.json());
      setNotes(j.notes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addNote() {
    if (!quickContent.trim() || adding) return;
    setAdding(true);
    try {
      // Auto-extraer título (primera línea) si tiene varias líneas
      const lines = quickContent.split("\n").map((l) => l.trim()).filter(Boolean);
      let title: string | undefined;
      let content = quickContent.trim();
      if (lines.length > 1 && lines[0].length < 80) {
        title = lines[0];
        content = lines.slice(1).join("\n").trim();
      }
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, color: quickColor }),
      });
      setQuickContent("");
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function togglePin(n: Note) {
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !n.pinned }),
    });
    load();
  }

  async function changeColor(n: Note, color: Note["color"]) {
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    load();
  }

  async function removeNote(n: Note) {
    if (!confirm("¿Eliminar esta nota?")) return;
    await fetch(`/api/notes/${n.id}`, { method: "DELETE" });
    load();
  }

  function startEdit(n: Note) {
    setEditingId(n.id);
    setEditTitle(n.title || "");
    setEditContent(n.content);
  }

  async function saveEdit(id: string) {
    await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editTitle.trim() || undefined,
        content: editContent,
      }),
    });
    setEditingId(null);
    load();
  }

  const filtered = useMemo(() => {
    let list = notes.slice();
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(
        (n) =>
          n.title?.toLowerCase().includes(q) ||
          n.content?.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (colorFilter) {
      list = list.filter((n) => n.color === colorFilter);
    }
    list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return list;
  }, [notes, filter, colorFilter]);

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 32px", overflow: "auto" }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            📝 Notas
          </h1>
          <p style={{ color: "var(--text-dim)", marginTop: 6, fontSize: 13.5, maxWidth: 540 }}>
            Apunta cosas que has hecho, ideas, recordatorios. Aparecen como post-its de colores.
          </p>
        </header>

        {/* Quick add */}
        <div style={{
          background: COLORS[quickColor || "yellow"].bg,
          border: `1.5px solid ${COLORS[quickColor || "yellow"].border}`,
          borderRadius: 14,
          padding: 16,
          marginBottom: 22,
          maxWidth: 920,
          boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
        }}>
          <textarea
            value={quickContent}
            onChange={(e) => setQuickContent(e.target.value)}
            placeholder="Escribe una nota… (Ctrl+Enter para guardar)"
            rows={3}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                addNote();
              }
            }}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              outline: "none",
              resize: "vertical",
              fontSize: 14,
              fontFamily: "inherit",
              lineHeight: 1.55,
              color: "#1e293b",
              padding: 0,
              minHeight: 60,
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(["yellow", "blue", "green", "pink", "purple", "gray"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setQuickColor(c)}
                  title={c}
                  style={{
                    width: 22, height: 22,
                    borderRadius: "50%",
                    background: COLORS[c].bg,
                    border: `2px solid ${quickColor === c ? COLORS[c].accent : "transparent"}`,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                />
              ))}
            </div>
            <button
              onClick={addNote}
              disabled={!quickContent.trim() || adding}
              style={{
                padding: "8px 18px",
                background: COLORS[quickColor || "yellow"].accent,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: !quickContent.trim() || adding ? 0.4 : 1,
              }}
            >
              {adding ? "Guardando…" : "+ Añadir nota"}
            </button>
          </div>
        </div>

        {/* Filters */}
        {notes.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="🔎 Buscar en notas…"
              style={{
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: 9,
                fontSize: 13,
                outline: "none",
                width: 240,
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setColorFilter(null)}
                style={{
                  ...filterChipStyle,
                  background: colorFilter === null ? "var(--accent)" : "#fff",
                  color: colorFilter === null ? "#fff" : "var(--text-dim)",
                  borderColor: colorFilter === null ? "var(--accent)" : "var(--border)",
                }}
              >Todas · {notes.length}</button>
              {(["yellow", "blue", "green", "pink", "purple", "gray"] as const).map((c) => {
                const count = notes.filter((n) => n.color === c).length;
                if (count === 0) return null;
                return (
                  <button
                    key={c}
                    onClick={() => setColorFilter(colorFilter === c ? null : c)}
                    title={c}
                    style={{
                      width: 28, height: 28,
                      borderRadius: 8,
                      background: COLORS[c].bg,
                      border: `2px solid ${colorFilter === c ? COLORS[c].accent : "transparent"}`,
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      color: COLORS[c].accent,
                    }}
                  >{count}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="loading-pulse"><span/><span/><span/></div>
        ) : filtered.length === 0 ? (
          <div style={{
            padding: "60px 20px",
            textAlign: "center",
            color: "var(--text-dim)",
            background: "#fff",
            borderRadius: 14,
            border: "1px dashed var(--border)",
            maxWidth: 920,
          }}>
            <div style={{ fontSize: 38, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
              {notes.length === 0 ? "No tienes notas todavía" : "Sin resultados"}
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {notes.length === 0 ? "Escribe arriba tu primera." : "Cambia el filtro o la búsqueda."}
            </div>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
            maxWidth: 1200,
          }}>
            {filtered.map((n) => {
              const c = COLORS[n.color || "yellow"];
              const isEditing = editingId === n.id;
              return (
                <div
                  key={n.id}
                  style={{
                    background: c.bg,
                    border: `1.5px solid ${c.border}`,
                    borderRadius: 12,
                    padding: 14,
                    transition: "all 0.15s",
                    transform: n.pinned ? "rotate(-0.5deg)" : "none",
                    boxShadow: n.pinned
                      ? `0 6px 16px ${c.accent}25, 0 2px 4px rgba(15,23,42,0.06)`
                      : "0 1px 4px rgba(15,23,42,0.05)",
                    position: "relative",
                    minHeight: 100,
                  }}
                >
                  {/* Header con pin + acciones */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, gap: 6 }}>
                    {isEditing ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Título (opcional)"
                        style={{
                          flex: 1,
                          fontSize: 14, fontWeight: 700,
                          background: "rgba(255,255,255,0.5)",
                          border: `1px solid ${c.border}`,
                          borderRadius: 6,
                          padding: "4px 8px",
                          color: c.accent,
                          outline: "none",
                          fontFamily: "inherit",
                        }}
                      />
                    ) : (
                      n.title ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: c.accent, lineHeight: 1.3, flex: 1 }}>
                          {n.title}
                        </div>
                      ) : <div style={{ flex: 1 }} />
                    )}
                    <button
                      onClick={() => togglePin(n)}
                      title={n.pinned ? "Desfijar" : "Fijar arriba"}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                        color: n.pinned ? c.accent : c.border,
                        opacity: n.pinned ? 1 : 0.5,
                        padding: 0,
                        transition: "all 0.15s",
                      }}
                    >📌</button>
                  </div>

                  {/* Content */}
                  {isEditing ? (
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={6}
                      style={{
                        width: "100%",
                        background: "rgba(255,255,255,0.5)",
                        border: `1px solid ${c.border}`,
                        borderRadius: 6,
                        padding: "6px 8px",
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        color: "#1e293b",
                        outline: "none",
                        resize: "vertical",
                        fontFamily: "inherit",
                        boxSizing: "border-box",
                      }}
                      autoFocus
                    />
                  ) : (
                    <div
                      onClick={() => startEdit(n)}
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        color: "#1e293b",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        cursor: "text",
                        minHeight: 24,
                      }}
                    >
                      {n.content}
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{
                    marginTop: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    {isEditing ? (
                      <>
                        <div style={{ display: "flex", gap: 4 }}>
                          {(["yellow", "blue", "green", "pink", "purple", "gray"] as const).map((col) => (
                            <button
                              key={col}
                              onClick={() => changeColor(n, col)}
                              title={col}
                              style={{
                                width: 18, height: 18,
                                borderRadius: "50%",
                                background: COLORS[col].bg,
                                border: `2px solid ${n.color === col ? COLORS[col].accent : "transparent"}`,
                                cursor: "pointer",
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => saveEdit(n.id)}
                            style={{
                              padding: "4px 10px",
                              background: c.accent,
                              color: "#fff",
                              border: "none",
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 700,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >Guardar</button>
                          <button
                            onClick={() => setEditingId(null)}
                            style={{
                              padding: "4px 10px",
                              background: "transparent",
                              color: c.accent,
                              border: `1px solid ${c.border}`,
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >Cancelar</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 10.5, color: c.accent, opacity: 0.7, fontWeight: 600 }}>
                          {fmtRelative(n.updated_at)}
                        </span>
                        <button
                          onClick={() => removeNote(n)}
                          title="Eliminar"
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 13,
                            color: c.accent,
                            opacity: 0.4,
                            padding: 0,
                            transition: "opacity 0.15s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
                        >🗑</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const filterChipStyle: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid var(--border)",
  borderRadius: 99,
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.15s",
};

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
