"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Doc = { id: string; name: string; chars: number };
type Agent = {
  id: string; name: string; role: string; emoji?: string; provider: "claude" | "deepseek";
  instructions: string; memory: string; docs: Doc[]; connections: string[];
  resources?: string[]; x?: number; y?: number;
};
type Preset = { role: string; emoji: string; instructions: string };
type ResDef = { key: string; label: string; emoji: string };
type Client = { client_id: string; client_name: string };
type Msg = { from: string; to: string; text: string };

const empty = (): Partial<Agent> => ({ name: "", role: "", emoji: "🤖", provider: "claude", instructions: "", memory: "", docs: [], connections: [] });

export default function EquipoIAPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [roles, setRoles] = useState<Preset[]>([]);
  const [resourceDefs, setResourceDefs] = useState<ResDef[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const posRef = useRef(positions);
  useEffect(() => { posRef.current = positions; }, [positions]);

  // Editor
  const [editing, setEditing] = useState<Partial<Agent> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Consola
  const [leadId, setLeadId] = useState("");
  const [clientId, setClientId] = useState("");
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const [answer, setAnswer] = useState("");

  const [feedback, setFeedback] = useState("");
  const flash = (m: string) => { setFeedback(m); setTimeout(() => setFeedback(""), 4000); };

  async function load() {
    setLoading(true);
    try {
      const d = await fetch("/api/ai-team/agents").then((r) => r.json());
      setAgents(d.agents || []); setRoles(d.roles || []); setResourceDefs(d.resources || []);
      if (!leadId && d.agents?.[0]) setLeadId(d.agents[0].id);
    } catch {}
    fetch("/api/clients/list").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : (d.clients || []))).catch(() => {});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const nameById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);

  async function saveAgent() {
    if (!editing?.name || !editing?.role) { alert("Pon nombre y rol."); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/ai-team/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) }).then((r) => r.json());
      if (r.ok) { flash("✓ Agente guardado"); setEditing(r.agent); await load(); }
      else flash("⚠ " + (r.error || "Error"));
    } catch (e: any) { flash("⚠ " + e.message); }
    setSaving(false);
  }
  async function delAgent(id: string) {
    if (!confirm("¿Eliminar este agente?")) return;
    await fetch(`/api/ai-team/agents?id=${id}`, { method: "DELETE" });
    setEditing(null); load();
  }
  async function uploadDoc(file: File) {
    if (!editing?.id) { alert("Guarda el agente antes de subir documentos."); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("agentId", editing.id); fd.append("file", file);
      const r = await fetch("/api/ai-team/doc", { method: "POST", body: fd }).then((r) => r.json());
      if (r.ok) { setEditing((e) => ({ ...e!, docs: [...(e!.docs || []), r.doc] })); flash("✓ Documento añadido a la memoria"); }
      else flash("⚠ " + (r.error || "Error"));
    } catch (e: any) { flash("⚠ " + e.message); }
    setUploading(false);
  }
  async function delDoc(docId: string) {
    if (!editing?.id) return;
    await fetch(`/api/ai-team/doc?agentId=${editing.id}&docId=${docId}`, { method: "DELETE" });
    setEditing((e) => ({ ...e!, docs: (e!.docs || []).filter((d) => d.id !== docId) }));
  }
  function applyPreset(role: string) {
    const p = roles.find((x) => x.role === role);
    setEditing((e) => ({ ...e!, role, emoji: p?.emoji || e?.emoji, instructions: e?.instructions?.trim() ? e!.instructions : (p?.instructions || "") }));
  }
  function toggleConn(id: string) {
    setEditing((e) => {
      const set = new Set(e!.connections || []);
      set.has(id) ? set.delete(id) : set.add(id);
      return { ...e!, connections: [...set] };
    });
  }
  function toggleRes(key: string) {
    setEditing((e) => {
      const set = new Set(e!.resources || []);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...e!, resources: [...set] };
    });
  }

  async function runChat() {
    if (!leadId || !message.trim()) return;
    setRunning(true); setTranscript([]); setAnswer("");
    try {
      const r = await fetch("/api/ai-team/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: leadId, message, clientId: clientId || undefined }) }).then((r) => r.json());
      if (r.error) { flash("⚠ " + r.error); }
      else { setTranscript(r.transcript || []); setAnswer(r.answer || ""); setMessage(""); }
    } catch (e: any) { flash("⚠ " + e.message); }
    setRunning(false);
  }

  const W = 900, NODE_W = 150, NODE_H = 62;

  // Auto-posiciones por niveles (fallback si un agente no tiene posición guardada).
  const autoPositions = useMemo(() => {
    const VGAP = 110, pos: Record<string, { x: number; y: number }> = {};
    if (!agents.length) return pos;
    const indeg: Record<string, number> = {};
    agents.forEach((a) => { indeg[a.id] = 0; });
    agents.forEach((a) => a.connections.forEach((c) => { if (indeg[c] != null) indeg[c]++; }));
    const level: Record<string, number> = {};
    const roots = agents.filter((a) => indeg[a.id] === 0).map((a) => a.id);
    const queue = [...(roots.length ? roots : [agents[0].id])];
    queue.forEach((id) => (level[id] = 0));
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const id = queue.shift()!; const a = nameById[id]; if (!a) continue;
      for (const c of a.connections) if (level[c] == null || level[c] < level[id] + 1) { level[c] = level[id] + 1; queue.push(c); }
    }
    agents.forEach((a) => { if (level[a.id] == null) level[a.id] = 0; });
    const byLevel: Record<number, string[]> = {};
    agents.forEach((a) => { (byLevel[level[a.id]] ||= []).push(a.id); });
    const maxLevel = Math.max(0, ...Object.keys(byLevel).map(Number));
    for (let L = 0; L <= maxLevel; L++) (byLevel[L] || []).forEach((id, i, row) => { pos[id] = { x: ((i + 1) / (row.length + 1)) * W, y: 60 + L * VGAP }; });
    return pos;
  }, [agents, nameById]);

  // Combina posiciones guardadas (x/y del agente) con las automáticas.
  useEffect(() => {
    setPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const a of agents) {
        if (typeof a.x === "number" && typeof a.y === "number") next[a.id] = { x: a.x, y: a.y };
        else next[a.id] = prev[a.id] || autoPositions[a.id] || { x: W / 2, y: 60 };
      }
      return next;
    });
  }, [agents, autoPositions]);

  // Arrastre de nodos (persiste x/y al soltar). Click sin mover = editar.
  function svgPoint(e: MouseEvent) {
    const svg = svgRef.current; if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const l = pt.matrixTransform(ctm.inverse()); return { x: l.x, y: l.y };
  }
  useEffect(() => {
    function move(e: MouseEvent) {
      const d = dragRef.current; if (!d) return;
      const p = svgPoint(e); if (!p) return;
      d.moved = true;
      const x = Math.max(NODE_W / 2, Math.min(W - NODE_W / 2, p.x)), y = Math.max(NODE_H / 2, p.y);
      setPositions((prev) => ({ ...prev, [d.id]: { x, y } }));
    }
    function up() {
      const d = dragRef.current; dragRef.current = null; if (!d) return;
      const a = agents.find((x) => x.id === d.id); if (!a) return;
      if (d.moved) {
        const p = posRef.current[d.id];
        if (p) fetch("/api/ai-team/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, x: Math.round(p.x), y: Math.round(p.y) }) }).catch(() => {});
      } else setEditing(a);
    }
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [agents]);

  // Nodos de sección (recursos usados) + su altura.
  const usedResources = useMemo(() => resourceDefs.filter((r) => agents.some((a) => (a.resources || []).includes(r.key))), [resourceDefs, agents]);
  const maxAgentY = Math.max(60, ...Object.values(positions).map((p) => p.y));
  const resY = maxAgentY + 120;
  const svgH = (usedResources.length ? resY : maxAgentY) + 60;
  const resPos = (i: number, n: number) => ({ x: ((i + 1) / (n + 1)) * W, y: resY });

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content">
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 4px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>🧠 Equipo IA</h1>
              <p style={{ color: "var(--text-dim)", fontSize: 13, margin: "4px 0 0" }}>Crea agentes con rol y memoria, conéctalos entre ellos y ponles a trabajar en equipo — con los datos reales de tus clientes.</p>
            </div>
            <button onClick={() => setEditing(empty())} style={btnPrimary}>+ Nuevo agente</button>
          </div>
          {feedback && <div style={{ margin: "8px 0", padding: "8px 14px", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 8, fontSize: 13 }}>{feedback}</div>}

          {loading ? <div style={{ color: "var(--text-dim)", padding: 20 }}>Cargando…</div> : (
            <>
              {/* Esquema visual */}
              <div style={card}>
                <div style={sectionTitle}>Esquema del equipo</div>
                {agents.length === 0 ? (
                  <div style={{ color: "var(--text-dim)", fontSize: 13, padding: "10px 0" }}>Aún no hay agentes. Crea el primero (p.ej. un CEO) y luego añade especialistas y conéctalos.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <svg ref={svgRef} viewBox={`0 0 ${W} ${svgH}`} style={{ width: "100%", minWidth: 520, height: "auto", userSelect: "none" }}>
                      <defs>
                        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                          <path d="M 0 0 L 10 5 L 0 10 z" fill="#a5b4fc" />
                        </marker>
                      </defs>
                      {/* Aristas agente → agente */}
                      {agents.flatMap((a) => (a.connections || []).map((c) => {
                        const p = positions[a.id], q = positions[c]; if (!p || !q) return null;
                        return <line key={a.id + c} x1={p.x} y1={p.y + NODE_H / 2} x2={q.x} y2={q.y - NODE_H / 2} stroke="#c7d2fe" strokeWidth={2} markerEnd="url(#arrow)" />;
                      }))}
                      {/* Aristas agente → sección (recursos) */}
                      {usedResources.flatMap((r, i) => agents.filter((a) => (a.resources || []).includes(r.key)).map((a) => {
                        const p = positions[a.id]; if (!p) return null; const rp = resPos(i, usedResources.length);
                        return <line key={r.key + a.id} x1={p.x} y1={p.y + NODE_H / 2} x2={rp.x} y2={rp.y - 22} stroke="#7fd8c4" strokeWidth={2} strokeDasharray="5 4" />;
                      }))}
                      {/* Nodos de sección */}
                      {usedResources.map((r, i) => { const rp = resPos(i, usedResources.length); return (
                        <g key={r.key}>
                          <rect x={rp.x - 90} y={rp.y - 22} width={180} height={44} rx={10} fill="#ecfdf7" stroke="#12b886" strokeWidth={1.4} strokeDasharray="5 4" />
                          <text x={rp.x} y={rp.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0f766e">{r.emoji} {r.label}</text>
                        </g>
                      ); })}
                      {/* Nodos de agente (arrastrables) */}
                      {agents.map((a) => { const p = positions[a.id]; if (!p) return null; return (
                        <g key={a.id} style={{ cursor: "grab" }} onMouseDown={(e) => { e.preventDefault(); dragRef.current = { id: a.id, moved: false }; }}>
                          <rect x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={12} fill="#ffffff" stroke="#6e59f2" strokeWidth={1.5} />
                          <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize={16}>{a.emoji || "🤖"} <tspan fontSize={12} fontWeight={700} fill="#1e1e26">{a.name}</tspan></text>
                          <text x={p.x} y={p.y + 13} textAnchor="middle" fontSize={10} fill="#8b8f9e">{a.role}</text>
                        </g>
                      ); })}
                    </svg>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>Flechas moradas = a quién consulta cada agente · líneas verdes = secciones de la plataforma que gestiona. <b>Arrastra</b> los agentes para colocarlos (p.ej. el CEO arriba). Clic en un agente para editarlo.</div>
              </div>

              {/* Consola */}
              <div style={{ ...card, marginTop: 14 }}>
                <div style={sectionTitle}>Consola del equipo</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  <select value={leadId} onChange={(e) => setLeadId(e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }}>
                    <option value="">— Elige el agente líder —</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name} · {a.role}</option>)}
                  </select>
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ ...inp, flex: 1, minWidth: 180 }}>
                    <option value="">— Sin cliente (opcional) —</option>
                    {clients.map((c) => <option key={c.client_id} value={c.client_id}>Cliente: {c.client_name}</option>)}
                  </select>
                </div>
                {(transcript.length > 0 || running) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, maxHeight: 360, overflowY: "auto", padding: 4 }}>
                    {transcript.map((m, i) => {
                      const mine = m.from === "Tú";
                      const toUser = m.to === "Tú";
                      return (
                        <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%", background: mine ? "#6e59f2" : toUser ? "#eef2ff" : "var(--bg-elev-2,#f4f6fa)", color: mine ? "#fff" : "#1e1e26", border: mine ? "none" : "1px solid var(--border,#e6e9ef)", borderRadius: 12, padding: "8px 12px" }}>
                          {!mine && <div style={{ fontSize: 10.5, fontWeight: 700, color: toUser ? "#6e59f2" : "#8b8f9e", marginBottom: 2 }}>{m.from} {toUser ? "→ ti" : `→ ${m.to}`}</div>}
                          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{m.text}</div>
                        </div>
                      );
                    })}
                    {running && <div style={{ color: "var(--text-dim)", fontSize: 12 }}>El equipo está trabajando…</div>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !running && runChat()} placeholder="Pide algo al equipo (p.ej. 'analiza a este cliente y propón mejoras')" style={{ ...inp, flex: 1 }} />
                  <button onClick={runChat} disabled={running || !leadId} style={btnPrimary}>{running ? "…" : "Enviar"}</button>
                </div>
              </div>

              {/* Lista de agentes */}
              <div style={{ ...card, marginTop: 14 }}>
                <div style={sectionTitle}>Agentes ({agents.length})</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
                  {agents.map((a) => (
                    <div key={a.id} onClick={() => setEditing(a)} style={{ ...card, cursor: "pointer", padding: 12 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{a.emoji} {a.name}</div>
                      <div style={{ fontSize: 12, color: "#6e59f2", fontWeight: 600 }}>{a.role}</div>
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{a.provider} · {a.docs?.length || 0} docs · conecta con {a.connections?.length || 0}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Editor de agente */}
      {editing && (
        <div style={modalBackdrop} onClick={() => setEditing(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{editing.id ? "Editar agente" : "Nuevo agente"}</div>
              <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-dim)" }}>✕</button>
            </div>
            <div style={modalBody}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8 }}>
                <div><label style={lbl}>Emoji</label><input value={editing.emoji || ""} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} style={inp} /></div>
                <div><label style={lbl}>Nombre</label><input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="p.ej. Marta" style={inp} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={lbl}>Rol</label>
                  <input list="roles" value={editing.role || ""} onChange={(e) => applyPreset(e.target.value)} placeholder="CEO, Campaign Manager…" style={inp} />
                  <datalist id="roles">{roles.map((r) => <option key={r.role} value={r.role} />)}</datalist>
                </div>
                <div>
                  <label style={lbl}>Modelo IA</label>
                  <select value={editing.provider || "claude"} onChange={(e) => setEditing({ ...editing, provider: e.target.value as any })} style={inp}>
                    <option value="claude">Claude (Anthropic)</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </div>
              </div>
              <div><label style={lbl}>Instrucciones (cómo debe comportarse / su formación)</label>
                <textarea value={editing.instructions || ""} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} rows={5} placeholder="Describe su rol, tono, cómo decide, qué prioriza…" style={{ ...inp, resize: "vertical" }} /></div>
              <div><label style={lbl}>Memoria / notas (siempre presente en su contexto)</label>
                <textarea value={editing.memory || ""} onChange={(e) => setEditing({ ...editing, memory: e.target.value })} rows={3} placeholder="Datos fijos que debe recordar (procesos, tono de la marca, reglas…)" style={{ ...inp, resize: "vertical" }} /></div>

              {/* Documentos */}
              <div>
                <label style={lbl}>Documentos de memoria (PDF o texto)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(editing.docs || []).map((d) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, border: "1px solid var(--border,#e6e9ef)", borderRadius: 8, padding: "6px 10px" }}>
                      <span>📄 {d.name}</span>
                      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{(d.chars / 1000).toFixed(1)}k car.</span>
                      <button onClick={() => delDoc(d.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#dc2626", cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
                  <label style={{ ...btnGhost, cursor: editing.id ? "pointer" : "not-allowed", opacity: editing.id ? 1 : 0.5, alignSelf: "flex-start" }}>
                    {uploading ? "Subiendo…" : "＋ Subir documento"}
                    <input type="file" accept=".pdf,.txt,.md,.csv" disabled={!editing.id || uploading} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])} />
                  </label>
                  {!editing.id && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Guarda el agente antes de subir documentos.</div>}
                </div>
              </div>

              {/* Conexiones */}
              <div>
                <label style={lbl}>Puede consultar a</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {agents.filter((a) => a.id !== editing.id).map((a) => {
                    const on = (editing.connections || []).includes(a.id);
                    return <button key={a.id} onClick={() => toggleConn(a.id)} style={{ ...chip, background: on ? "#6e59f2" : "var(--bg-elev-2,#f4f6fa)", color: on ? "#fff" : "var(--text,#1e1e26)", borderColor: on ? "#6e59f2" : "var(--border,#e6e9ef)" }}>{a.emoji} {a.name}</button>;
                  })}
                  {agents.filter((a) => a.id !== editing.id).length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Crea más agentes para conectarlos.</div>}
                </div>
              </div>

              {/* Secciones de la plataforma */}
              <div>
                <label style={lbl}>Conectar con secciones de la plataforma</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {resourceDefs.map((r) => {
                    const on = (editing.resources || []).includes(r.key);
                    return <button key={r.key} onClick={() => toggleRes(r.key)} style={{ ...chip, background: on ? "#12b886" : "var(--bg-elev-2,#f4f6fa)", color: on ? "#fff" : "var(--text,#1e1e26)", borderColor: on ? "#12b886" : "var(--border,#e6e9ef)" }}>{r.emoji} {r.label}</button>;
                  })}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>P.ej. conecta al <b>Campaign Manager</b> con "Clientes (Smartlead) + informes" y "Campañas activas": recibirá esos datos reales y controlará los informes. Aparecerá enlazado en el esquema.</div>
              </div>
            </div>
            <div style={modalFooter}>
              {editing.id && <button onClick={() => delAgent(editing.id!)} style={{ ...btnGhost, color: "#b91c1c" }}>Eliminar</button>}
              <button onClick={saveAgent} disabled={saving} style={{ ...btnPrimary, marginLeft: "auto" }}>{saving ? "Guardando…" : "Guardar agente"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: "var(--bg-elev, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 14, padding: 16 };
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-dim,#64748b)", marginBottom: 10 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid var(--border, #d9dee6)", borderRadius: 8, fontSize: 13.5, background: "var(--bg, #fff)", color: "var(--text, #0f172a)", boxSizing: "border-box", fontFamily: "inherit" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-dim, #64748b)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.02em" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", background: "#6e59f2", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-elev-2, #eef1f5)", color: "var(--text, #0f172a)", border: "1px solid var(--border, #d9dee6)", borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 };
const chip: React.CSSProperties = { padding: "5px 12px", borderRadius: 999, border: "1px solid", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 };
const modalCard: React.CSSProperties = { width: "100%", maxWidth: 580, maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--bg-elev, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 16, boxShadow: "0 20px 60px rgba(15,23,42,0.35)", overflow: "hidden" };
const modalHeader: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border, #e2e8f0)", flexShrink: 0 };
const modalBody: React.CSSProperties = { padding: "16px 18px", overflowY: "auto", display: "grid", gap: 12, flex: 1, minHeight: 0 };
const modalFooter: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "12px 18px", borderTop: "1px solid var(--border, #e2e8f0)", flexShrink: 0 };
