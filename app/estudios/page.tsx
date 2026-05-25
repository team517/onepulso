"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardNav from "../components/DashboardNav";

type EstudioRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  element_count: number;
};

const BG = "linear-gradient(145deg, #e8f0fe 0%, #f0f4f8 50%, #e2eaf8 100%)";

export default function EstudiosPage() {
  const [list, setList] = useState<EstudioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    const r = await fetch("/api/estudios");
    if (r.ok) {
      const d = await r.json();
      setList(d.estudios || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createNew() {
    setCreating(true);
    const title = prompt("Título del estudio:", "Nuevo estudio");
    if (!title) { setCreating(false); return; }
    try {
      const r = await fetch("/api/estudios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const d = await r.json();
      if (d.estudio?.id) {
        window.location.href = `/estudios/${d.estudio.id}`;
      }
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string, title: string) {
    if (!confirm(`¿Eliminar "${title}"? Esto borra el estudio entero, no se puede deshacer.`)) return;
    await fetch(`/api/estudios/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: BG, fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif" }}>
      <DashboardNav />
      <main style={{ flex: 1, padding: "32px 40px", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em", color: "#0f172a" }}>
              Estudios
            </h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14.5 }}>
              Pizarras infinitas. Crea esquemas, pega imágenes, conecta ideas.
            </p>
          </div>
          <button onClick={createNew} disabled={creating} style={{
            padding: "10px 18px",
            background: "linear-gradient(135deg, #f9a603 0%, #f59e3a 30%, #d15cfe 100%)",
            border: "none",
            borderRadius: 10,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: creating ? "wait" : "pointer",
            letterSpacing: "-0.01em",
            boxShadow: "0 4px 14px rgba(209,92,254,0.25), 0 1px 0 rgba(0,0,0,0.08) inset",
            fontFamily: "inherit",
          }}>
            + Nuevo estudio
          </button>
        </div>

        {loading ? (
          <div style={{ color: "#64748b" }}>Cargando…</div>
        ) : list.length === 0 ? (
          <div style={{
            background: "#fff",
            border: "1px solid rgba(15,23,42,0.08)",
            borderRadius: 16,
            padding: "48px 24px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>◬</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#0f172a" }}>Aún no tienes estudios</h2>
            <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: 14 }}>
              Crea el primero — una pizarra infinita donde puedes pegar imágenes,
              añadir notas y conectar ideas.
            </p>
            <button onClick={createNew} disabled={creating} style={{
              padding: "10px 18px",
              background: "#0071e3", border: "none", borderRadius: 10,
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: creating ? "wait" : "pointer",
              boxShadow: "0 2px 6px rgba(0,113,227,0.25)",
              fontFamily: "inherit",
            }}>+ Crear primer estudio</button>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}>
            {list.map((e) => (
              <div key={e.id} style={{
                background: "#fff",
                border: "1px solid rgba(15,23,42,0.08)",
                borderRadius: 14,
                padding: 18,
                position: "relative",
                transition: "all 0.15s",
                boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
              }}>
                <Link href={`/estudios/${e.id}`} style={{
                  display: "block",
                  textDecoration: "none",
                  color: "inherit",
                }}>
                  <div style={{
                    background: "linear-gradient(135deg, rgba(0,113,227,0.06), rgba(99,102,241,0.04))",
                    border: "1px dashed rgba(0,113,227,0.2)",
                    borderRadius: 10,
                    height: 110,
                    marginBottom: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 36, color: "rgba(0,113,227,0.5)",
                  }}>◬</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", marginBottom: 4, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#64748b" }}>
                    {e.element_count} elemento{e.element_count === 1 ? "" : "s"} · actualizado {new Date(e.updated_at).toLocaleDateString("es")}
                  </div>
                </Link>
                <button
                  onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); remove(e.id, e.title); }}
                  title="Eliminar estudio"
                  style={{
                    position: "absolute", top: 10, right: 10,
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(220,38,38,0.2)",
                    color: "#dc2626",
                    width: 26, height: 26,
                    borderRadius: 8,
                    cursor: "pointer", fontSize: 13,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >🗑</button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
