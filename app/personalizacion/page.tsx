"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Mapping = {
  first_name?: string;
  company_name?: string;
  industry?: string;
  city?: string;
  description?: string;
  email?: string;
};

const STANDARD_FIELDS: Array<{ key: keyof Mapping; label: string; hints: string[] }> = [
  { key: "first_name", label: "Nombre", hints: ["first_name", "firstname", "nombre"] },
  { key: "company_name", label: "Empresa", hints: ["company_name", "companyname", "empresa", "company"] },
  { key: "industry", label: "Sector / Industria", hints: ["industry", "sector", "industria"] },
  { key: "city", label: "Ciudad", hints: ["city", "ciudad", "location"] },
  { key: "description", label: "Descripción empresa", hints: ["description", "company_short_description", "short_description", "descripcion", "summary", "about"] },
  { key: "email", label: "Email", hints: ["email", "correo", "e-mail"] },
];

const DEFAULT_PROMPT = `Escribe un cold email B2B en español dirigido a {firstName} de {companyName}, una empresa de {industry} en {city}.

Sobre la empresa: {description}

REGLAS:
- 4-5 frases máximo. Tono directo, sin clichés ni saludos cursi.
- Conecta con algo específico de {companyName} o el sector {industry}.
- Propuesta de valor concreta para empresas como {companyName}.
- CTA final: pedir 15 minutos de call esta semana.
- Firma: "Un saludo, Xavi"

OUTPUT: solo el cuerpo del email, en HTML simple (<p>...</p>).`;

export default function PersonalizacionPage() {
  const [file, setFile] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [mapping, setMapping] = useState<Mapping>({});
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [provider, setProvider] = useState<"claude" | "deepseek">("claude");
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  function insertPlaceholder(token: string) {
    const ta = promptRef.current;
    if (!ta) {
      setPrompt(prompt + ` {${token}}`);
      return;
    }
    const start = ta.selectionStart ?? prompt.length;
    const end = ta.selectionEnd ?? prompt.length;
    const insert = `{${token}}`;
    const next = prompt.slice(0, start) + insert + prompt.slice(end);
    setPrompt(next);
    // Mover cursor justo después del placeholder
    setTimeout(() => {
      ta.focus();
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  // Run
  const [rangeMode, setRangeMode] = useState<"all" | "first_n" | "custom">("all");
  const [firstN, setFirstN] = useState("10");
  const [customStart, setCustomStart] = useState("1");
  const [customEnd, setCustomEnd] = useState("10");
  const [runJob, setRunJob] = useState<any>(null);
  const [running, setRunning] = useState(false);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Saved prompts
  const [savedPrompts, setSavedPrompts] = useState<any[]>([]);
  const [promptsLibOpen, setPromptsLibOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savePromptName, setSavePromptName] = useState("");
  const [savePromptDesc, setSavePromptDesc] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Saved campaigns (CSV + mapping + prompt como conjunto)
  const [savedCampaigns, setSavedCampaigns] = useState<any[]>([]);
  const [campaignsLibOpen, setCampaignsLibOpen] = useState(false);
  const [saveCampaignOpen, setSaveCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignDesc, setCampaignDesc] = useState("");
  const [savingCampaign, setSavingCampaign] = useState(false);

  async function loadSavedCampaigns() {
    try {
      const r = await fetch("/api/personalization/campaigns").then((r) => r.json());
      setSavedCampaigns(r.campaigns || []);
    } catch {}
  }
  useEffect(() => { loadSavedCampaigns(); }, []);

  async function saveCurrentCampaign() {
    if (!campaignName.trim() || !file) return;
    setSavingCampaign(true);
    try {
      const r = await fetch("/api/personalization/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          description: campaignDesc.trim() || undefined,
          file_id: file.file_id,
          filename: file.filename,
          total_rows: file.row_count,
          columns: file.columns,
          mapping,
          prompt,
          provider,
        }),
      }).then((r) => r.json());
      if (r.error) {
        alert("⚠️ " + r.error);
        return;
      }
      setCampaignName("");
      setCampaignDesc("");
      setSaveCampaignOpen(false);
      await loadSavedCampaigns();
    } finally {
      setSavingCampaign(false);
    }
  }

  async function loadCampaignFromLibrary(c: any) {
    // Verificar antes que el CSV blob exista
    const check = await fetch(`/api/personalization/campaigns/${c.id}`).then((r) => r.json());
    if (!check.file_available) {
      alert(`El archivo de "${c.name}" ya no está disponible. Es posible que lo borraran del almacenamiento. Tendrás que volver a subir el CSV.`);
      return;
    }
    setFile({
      file_id: c.file_id,
      filename: c.filename,
      row_count: c.total_rows,
      columns: c.columns,
      preview: [],
    });
    setMapping(c.mapping || {});
    setPrompt(c.prompt || "");
    setProvider(c.provider || "claude");
    setPreviewResult(null);
    setRunJob(null);
    setCampaignsLibOpen(false);
    // Marcar como usada
    fetch(`/api/personalization/campaigns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_used" }),
    }).catch(() => {});
    loadSavedCampaigns();
  }

  async function deleteCampaignFromLibrary(id: string, name: string) {
    if (!confirm(`¿Eliminar la campaña "${name}"?\n\n(El CSV original sigue en tu almacenamiento por si lo usaste en otras campañas. La descarga de resultados anteriores no se ve afectada.)`)) return;
    await fetch(`/api/personalization/campaigns/${id}`, { method: "DELETE" });
    loadSavedCampaigns();
  }

  async function loadSavedPrompts() {
    try {
      const r = await fetch("/api/personalization/prompts").then((r) => r.json());
      setSavedPrompts(r.prompts || []);
    } catch {}
  }
  useEffect(() => { loadSavedPrompts(); }, []);

  async function saveCurrentPrompt() {
    if (!savePromptName.trim() || !prompt.trim()) return;
    setSavingPrompt(true);
    try {
      const r = await fetch("/api/personalization/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savePromptName.trim(),
          content: prompt,
          description: savePromptDesc.trim() || undefined,
          provider,
        }),
      }).then((r) => r.json());
      if (r.error) {
        alert("⚠️ " + r.error);
        return;
      }
      setSavePromptName("");
      setSavePromptDesc("");
      setSaveModalOpen(false);
      await loadSavedPrompts();
    } finally {
      setSavingPrompt(false);
    }
  }

  async function loadPromptFromLibrary(p: any) {
    setPrompt(p.content);
    if (p.provider) setProvider(p.provider);
    setPromptsLibOpen(false);
    // Marcar como usado en background
    fetch(`/api/personalization/prompts/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_used" }),
    }).catch(() => {});
    loadSavedPrompts();
  }

  async function deletePromptFromLibrary(id: string, name: string) {
    if (!confirm(`¿Eliminar el prompt "${name}"?`)) return;
    await fetch(`/api/personalization/prompts/${id}`, { method: "DELETE" });
    loadSavedPrompts();
  }

  async function loadHistory() {
    try {
      const r = await fetch("/api/personalization/jobs").then((r) => r.json());
      setHistory(r.jobs || []);
    } catch {}
  }
  useEffect(() => { loadHistory(); }, []);
  // Recargar el history cada vez que termine un job
  useEffect(() => {
    if (runJob?.status === "done") loadHistory();
  }, [runJob?.status]);

  async function deleteHistoryItem(id: string) {
    if (!confirm("¿Eliminar este job del historial? (no afecta a tu CSV original)")) return;
    await fetch(`/api/personalization/jobs/${id}`, { method: "DELETE" });
    loadHistory();
  }

  async function loadSettings() {
    try {
      const s = await fetch("/api/personalization/settings").then((r) => r.json());
      setSettings(s);
    } catch {}
  }
  useEffect(() => { loadSettings(); }, []);

  async function onPickFile(f: File | undefined | null) {
    if (!f) return;
    if (!/\.(csv|tsv)$/i.test(f.name)) {
      alert("Sube un CSV o TSV");
      return;
    }
    setUploading(true);
    try {
      const ab = await f.arrayBuffer();
      const r = await fetch("/api/personalization/upload", {
        method: "POST",
        headers: {
          "x-filename": encodeURIComponent(f.name),
          "Content-Type": f.type || "text/csv",
        },
        body: ab,
      });
      const j = await r.json();
      if (!r.ok) {
        alert("Error: " + (j.error || `HTTP ${r.status}`));
        return;
      }
      setFile(j);
      // Auto-mapeo: buscar columnas que coincidan con los hints
      const auto: Mapping = {};
      for (const field of STANDARD_FIELDS) {
        const col = j.columns.find((c: string) =>
          field.hints.some((h) => c.toLowerCase().replace(/[\s_-]/g, "") === h.replace(/[\s_-]/g, ""))
        );
        if (col) auto[field.key] = col;
      }
      // Fallback: buscar coincidencias parciales
      for (const field of STANDARD_FIELDS) {
        if (auto[field.key]) continue;
        const col = j.columns.find((c: string) =>
          field.hints.some((h) => c.toLowerCase().includes(h.toLowerCase()))
        );
        if (col) auto[field.key] = col;
      }
      setMapping(auto);
      setPreviewResult(null);
      setRunJob(null);
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function doPreview() {
    if (!file) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await fetch("/api/personalization/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: file.file_id,
          mapping,
          prompt,
          provider,
          row_index: previewIdx,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) {
        setPreviewError(j.error || `Error ${r.status}`);
        setPreviewResult(null);
      } else {
        setPreviewResult(j);
      }
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function getSelectedRows(): number[] {
    if (!file) return [];
    const total = file.row_count;
    if (rangeMode === "all") return Array.from({ length: total }, (_, i) => i);
    if (rangeMode === "first_n") {
      const n = Math.min(parseInt(firstN, 10) || 0, total);
      return Array.from({ length: n }, (_, i) => i);
    }
    if (rangeMode === "custom") {
      const s = Math.max(1, parseInt(customStart, 10) || 1);
      const e = Math.min(total, parseInt(customEnd, 10) || total);
      const out: number[] = [];
      for (let i = s - 1; i < e; i++) out.push(i);
      return out;
    }
    return [];
  }

  async function doRun() {
    if (!file) return;
    const rows = getSelectedRows();
    if (rows.length === 0) { alert("Selecciona al menos 1 fila"); return; }
    if (rows.length > 500) {
      if (!confirm(`Vas a personalizar ${rows.length} mensajes. Puede tardar varios minutos y consumir tokens del LLM. ¿Continuar?`)) return;
    }
    setRunning(true);
    setRunJob({ status: "starting", progress: { done: 0, ok: 0, failed: 0 }, selected_rows: rows });
    try {
      const r = await fetch("/api/personalization/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: file.file_id,
          filename: file.filename,
          mapping,
          prompt,
          provider,
          rows,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert("Error: " + (j.error || `HTTP ${r.status}`));
        setRunJob(null);
        setRunning(false);
        return;
      }
      // El job arranca en background. Hacemos polling cada 2s hasta que termine.
      const jobId = j.job.id;
      setRunJob(j.job);
      const poll = setInterval(async () => {
        try {
          const updated = await fetch(`/api/personalization/jobs/${jobId}`).then((r) => r.json());
          if (updated.job) {
            setRunJob(updated.job);
            if (updated.job.status === "done" || updated.job.status === "error") {
              clearInterval(poll);
              setRunning(false);
              loadHistory();
            }
          }
        } catch {}
      }, 2000);
    } catch (e: any) {
      alert("Error: " + e.message);
      setRunning(false);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const payload: any = {
        default_provider: settings.default_provider || "claude",
      };
      if (deepseekKey.trim()) payload.deepseek_api_key = deepseekKey.trim();
      await fetch("/api/personalization/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDeepseekKey("");
      await loadSettings();
    } finally {
      setSavingSettings(false);
    }
  }

  async function doTest(p: "claude" | "deepseek") {
    setTestResult({ loading: true, provider: p });
    try {
      const r = await fetch("/api/personalization/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p }),
      }).then((r) => r.json());
      setTestResult({ ...r, provider: p });
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message, provider: p });
    }
  }

  const canRun = file && mapping.first_name && prompt.trim().length > 10;

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 32px", overflow: "auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              ✦ Personalización de mensajes
            </h1>
            <p style={{ color: "var(--text-dim)", marginTop: 4, fontSize: 13.5, maxWidth: 600 }}>
              Sube un CSV de leads, mapea columnas, escribe un prompt y genera un mensaje único para cada uno con IA. Preview antes de procesar todo.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { loadSavedCampaigns(); setCampaignsLibOpen(true); }} style={btnGhost}>
              📋 Mis campañas {savedCampaigns.length > 0 && <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 99, padding: "0 6px", fontSize: 10, fontWeight: 700, marginLeft: 4 }}>{savedCampaigns.length}</span>}
            </button>
            <button onClick={() => { loadSettings(); setSettingsOpen(true); }} style={btnGhost}>⚙️ Ajustes IA</button>
          </div>
        </header>

        {/* STEP 1: Upload */}
        <Step n={1} label="Sube tu CSV" done={!!file}>
          {!file ? (
            <div>
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onPickFile(e.dataTransfer.files?.[0]); }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: 30, borderRadius: 11,
                  border: "2px dashed var(--border)",
                  background: "var(--bg-elev-2)", cursor: "pointer",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  {uploading ? "Subiendo…" : "Click o arrastra un CSV"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  Hasta 20 MB · Cualquier formato (separador comma, semicolon, tab)
                </div>
                <input ref={fileRef} type="file" accept=".csv,.tsv" hidden onChange={(e) => onPickFile(e.target.files?.[0])} />
              </label>
            </div>
          ) : (
            <div style={{
              padding: "12px 14px",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.35)",
              borderRadius: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "#047857" }}>✓ CSV cargado: {file.filename}</div>
                  <div style={{ fontSize: 13, color: "#047857", marginTop: 3, fontWeight: 600 }}>
                    📊 <strong>{file.row_count.toLocaleString()} leads</strong> cargados completos · <strong>{file.columns.length}</strong> columnas detectadas
                  </div>
                </div>
                <button onClick={() => { setFile(null); setMapping({}); setPreviewResult(null); setRunJob(null); }} style={btnGhostSm}>Cambiar</button>
              </div>
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-dim)", fontWeight: 600 }}>
                  Ver columnas detectadas ({file.columns.length})
                </summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {file.columns.map((c: string) => (
                    <code key={c} style={{ ...codeInline, background: "#fff", border: "1px solid var(--border)" }}>{c}</code>
                  ))}
                </div>
              </details>
            </div>
          )}
        </Step>

        {/* STEP 2: Mapeo columnas */}
        {file && (
          <Step n={2} label="Asigna las columnas" done={!!mapping.first_name}>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
              Indica qué columna del CSV corresponde a cada campo. Mínimo necesitas <strong>Nombre</strong>. El resto son opcionales pero recomendados.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {STANDARD_FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={lbl}>{f.label} {f.key === "first_name" && <span style={{ color: "#dc2626" }}>*</span>}</label>
                  <select
                    value={mapping[f.key] || ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}
                    style={inp}
                  >
                    <option value="">— (sin asignar) —</option>
                    {file.columns.map((c: string) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Step>
        )}

        {/* STEP 3: Prompt */}
        {file && mapping.first_name && (
          <Step n={3} label="Escribe el prompt de personalización">
            {/* Toolbar de prompts guardados */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setPromptsLibOpen(true)}
                style={{ ...btnGhostSm, display: "inline-flex", alignItems: "center", gap: 5 }}
                title="Carga un prompt guardado anteriormente"
              >
                📚 Mis prompts {savedPrompts.length > 0 && <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 99, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{savedPrompts.length}</span>}
              </button>
              <button
                onClick={() => { setSavePromptName(""); setSavePromptDesc(""); setSaveModalOpen(true); }}
                disabled={!prompt.trim()}
                style={{ ...btnGhostSm, display: "inline-flex", alignItems: "center", gap: 5, opacity: !prompt.trim() ? 0.5 : 1 }}
                title="Guarda el prompt actual para reutilizarlo"
              >
                💾 Guardar este prompt
              </button>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
              Click en un campo para insertarlo en el prompt en la posición del cursor:
            </div>

            {/* Barra de placeholders mapeados */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {STANDARD_FIELDS.filter((f) => mapping[f.key]).map((f) => {
                const token =
                  f.key === "first_name" ? "firstName" :
                  f.key === "company_name" ? "companyName" :
                  f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => insertPlaceholder(token)}
                    title={`Inserta {${token}} → valor de columna "${mapping[f.key]}"`}
                    style={tokenBtnPrimary}
                  >
                    + {`{${token}}`}
                    <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 4 }}>{mapping[f.key]}</span>
                  </button>
                );
              })}
            </div>

            {/* Toggle de "otras columnas" para insertar las que no son standard */}
            {file.columns.filter((c: string) => !Object.values(mapping).includes(c)).length > 0 && (
              <details style={{ marginBottom: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-dim)", fontWeight: 600 }}>
                  ▸ Otras columnas del CSV ({file.columns.filter((c: string) => !Object.values(mapping).includes(c)).length})
                </summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                  {file.columns.filter((c: string) => !Object.values(mapping).includes(c)).map((c: string) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => insertPlaceholder(c)}
                      style={tokenBtnSecondary}
                    >+ {`{${c}}`}</button>
                  ))}
                </div>
              </details>
            )}

            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              style={{ ...inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.55, resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <span style={{ fontWeight: 700, color: "var(--text-dim)" }}>Modelo:</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value as any)} style={{ ...inp, width: "auto", padding: "5px 9px" }}>
                  <option value="claude">Claude (Anthropic)</option>
                  <option value="deepseek">DeepSeek (más barato)</option>
                </select>
              </label>
              {provider === "deepseek" && !settings?.deepseek_api_key_present && (
                <span style={{ fontSize: 11.5, color: "#b45309" }}>
                  ⚠️ Falta API Key de DeepSeek — <button onClick={() => setSettingsOpen(true)} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", fontSize: 11.5, padding: 0 }}>configurar</button>
                </span>
              )}
              {provider === "deepseek" && settings?.deepseek_api_key_present && (
                <span style={{ fontSize: 11.5, color: "#047857" }}>✓ DeepSeek conectado</span>
              )}
            </div>
          </Step>
        )}

        {/* STEP 4: Preview */}
        {file && mapping.first_name && (
          <Step n={4} label="Preview con 1 lead">
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 700, color: "var(--text-dim)" }}>Fila:</span>
                <input
                  type="number"
                  min={1}
                  max={file.row_count}
                  value={previewIdx + 1}
                  onChange={(e) => setPreviewIdx(Math.max(0, Math.min(file.row_count - 1, parseInt(e.target.value, 10) - 1 || 0)))}
                  style={{ ...inp, width: 90 }}
                />
                <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>de {file.row_count.toLocaleString()}</span>
              </label>
              <button onClick={doPreview} disabled={previewLoading} style={{ ...btnPrimary, opacity: previewLoading ? 0.5 : 1 }}>
                {previewLoading ? "Generando…" : "👁 Generar preview"}
              </button>
            </div>

            {previewError && (
              <div style={{ padding: "10px 12px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, fontSize: 12.5, color: "#b91c1c" }}>
                ⚠ {previewError}
              </div>
            )}

            {previewResult && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Datos del lead</div>
                  <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                    {Object.entries(previewResult.lead).slice(0, 10).map(([k, v]: any) => (
                      <div key={k} style={{ display: "flex", gap: 8 }}>
                        <strong style={{ color: "var(--text-dim)", minWidth: 100 }}>{k}:</strong>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{String(v).slice(0, 80)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ background: "#fff", border: "1px solid var(--accent)", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Mensaje generado</div>
                  <div
                    style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}
                    dangerouslySetInnerHTML={{ __html: previewResult.message }}
                  />
                </div>
              </div>
            )}
          </Step>
        )}

        {/* STEP 5: Run */}
        {file && mapping.first_name && (
          <Step n={5} label="Ejecutar y descargar">
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
              ¿Cuántas filas quieres personalizar?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              <RadioRow label={`Todas (${file.row_count.toLocaleString()} filas)`} checked={rangeMode === "all"} onClick={() => setRangeMode("all")} />
              <RadioRow label={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Primeras
                  <input type="number" value={firstN} min={1} max={file.row_count} onChange={(e) => setFirstN(e.target.value)} style={{ ...inp, width: 80 }} onClick={(e) => e.stopPropagation()} onFocus={() => setRangeMode("first_n")} />
                  filas
                </span>
              } checked={rangeMode === "first_n"} onClick={() => setRangeMode("first_n")} />
              <RadioRow label={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Rango desde la
                  <input type="number" value={customStart} min={1} max={file.row_count} onChange={(e) => setCustomStart(e.target.value)} style={{ ...inp, width: 70 }} onClick={(e) => e.stopPropagation()} onFocus={() => setRangeMode("custom")} />
                  hasta la
                  <input type="number" value={customEnd} min={1} max={file.row_count} onChange={(e) => setCustomEnd(e.target.value)} style={{ ...inp, width: 70 }} onClick={(e) => e.stopPropagation()} onFocus={() => setRangeMode("custom")} />
                </span>
              } checked={rangeMode === "custom"} onClick={() => setRangeMode("custom")} />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={doRun}
                disabled={!canRun || running}
                style={{
                  ...btnPrimary, fontSize: 14, padding: "11px 22px",
                  opacity: !canRun || running ? 0.55 : 1,
                  cursor: !canRun || running ? "not-allowed" : "pointer",
                }}
              >
                {running ? "Procesando…" : `🚀 Personalizar ${getSelectedRows().length} mensajes`}
              </button>
              <button
                onClick={() => { setCampaignName(""); setCampaignDesc(""); setSaveCampaignOpen(true); }}
                disabled={!canRun}
                style={{
                  ...btnGhost, fontSize: 13.5, padding: "11px 18px",
                  opacity: !canRun ? 0.5 : 1,
                  cursor: !canRun ? "not-allowed" : "pointer",
                }}
                title="Guarda esta configuración (CSV + mapping + prompt + modelo) para volver a usarla más tarde"
              >
                💾 Guardar campaña
              </button>
            </div>

            {runJob && (
              <div style={{
                marginTop: 16,
                background: runJob.status === "done" ? "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.12))" : "var(--bg-elev-2)",
                border: `1px solid ${runJob.status === "done" ? "rgba(16,185,129,0.35)" : "var(--border)"}`,
                borderRadius: 12, padding: 16,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: runJob.status === "done" ? "#047857" : "var(--text)" }}>
                      {runJob.status === "done" ? "✓ Completado" :
                       runJob.status === "running" ? "⏳ En curso" :
                       runJob.status === "error" ? "✗ Error" : "Iniciando…"}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 3 }}>
                      {runJob.progress?.done ?? 0} / {runJob.selected_rows?.length ?? runJob.total ?? 0} procesados ·
                      <span style={{ color: "#047857", fontWeight: 600 }}> ✓ {runJob.progress?.ok ?? 0}</span> ·
                      <span style={{ color: "#b91c1c", fontWeight: 600 }}> ✗ {runJob.progress?.failed ?? 0}</span>
                    </div>
                  </div>
                  {runJob.status === "done" && runJob.id && (
                    <a
                      href={`/api/personalization/jobs/${runJob.id}/csv`}
                      download
                      style={{
                        ...btnPrimary,
                        textDecoration: "none",
                        fontSize: 14,
                        padding: "11px 20px",
                        background: "linear-gradient(135deg, #10b981, #047857)",
                        boxShadow: "0 2px 8px rgba(16,185,129,0.35)",
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      ⬇ Descargar CSV
                    </a>
                  )}
                </div>

                {/* Barra de progreso */}
                {runJob.status === "running" && (
                  <div style={{ height: 6, background: "var(--bg-elev-3)", borderRadius: 99, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, ((runJob.progress?.done ?? 0) / Math.max(1, runJob.selected_rows?.length ?? 1)) * 100)}%`,
                      background: "linear-gradient(90deg, #0071e3, #06b6d4)",
                      transition: "width 0.3s",
                    }} />
                  </div>
                )}

                {runJob.error && (
                  <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>{runJob.error}</div>
                )}
                {runJob.results && runJob.results.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text-dim)" }}>
                      Ver primeros mensajes generados ({runJob.results.length})
                    </summary>
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                      {runJob.results.slice(0, 10).map((r: any) => (
                        <div key={r.row_index} style={{ padding: 8, background: "#fff", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12 }}>
                          <div style={{ color: "var(--text-faint)", fontSize: 10.5, marginBottom: 3 }}>
                            Fila {r.row_index + 1} {r.lead_email && `· ${r.lead_email}`}
                          </div>
                          {r.error ? (
                            <span style={{ color: "#b91c1c" }}>⚠ {r.error}</span>
                          ) : (
                            <div dangerouslySetInnerHTML={{ __html: r.message.slice(0, 250) + (r.message.length > 250 ? "…" : "") }} />
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Historial de jobs anteriores */}
            {history.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <button
                  onClick={() => setHistoryOpen(!historyOpen)}
                  style={{
                    background: "transparent", border: "none",
                    fontSize: 13, fontWeight: 700,
                    color: "var(--text-dim)", cursor: "pointer",
                    padding: 0, display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  {historyOpen ? "▾" : "▸"} Historial de trabajos ({history.length})
                </button>
                {historyOpen && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {history.map((j) => (
                      <div key={j.id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px",
                        background: "#fff", border: "1px solid var(--border)",
                        borderRadius: 9,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.filename}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              padding: "1px 6px", borderRadius: 99,
                              background:
                                j.status === "done" ? "rgba(16,185,129,0.15)" :
                                j.status === "running" ? "rgba(0,113,227,0.15)" :
                                j.status === "error" ? "rgba(239,68,68,0.15)" :
                                "var(--bg-elev-2)",
                              color:
                                j.status === "done" ? "#047857" :
                                j.status === "running" ? "#0071e3" :
                                j.status === "error" ? "#b91c1c" :
                                "var(--text-dim)",
                            }}>{j.status}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              padding: "1px 6px", borderRadius: 99,
                              background: j.provider === "deepseek" ? "rgba(245,158,11,0.12)" : "rgba(139,92,246,0.12)",
                              color: j.provider === "deepseek" ? "#b45309" : "#7c3aed",
                            }}>{j.provider}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
                            {j.selected_count} mensajes · {j.progress?.ok ?? 0} OK · {j.progress?.failed ?? 0} fallaron · {fmtRelative(j.created_at)}
                          </div>
                        </div>
                        {j.status === "done" && (
                          <a
                            href={`/api/personalization/jobs/${j.id}/csv`}
                            download
                            style={{
                              ...btnPrimary, fontSize: 11.5, padding: "6px 12px",
                              textDecoration: "none",
                            }}
                          >⬇ CSV</a>
                        )}
                        <button onClick={() => deleteHistoryItem(j.id)} title="Eliminar del historial" style={{
                          background: "transparent", border: "1px solid var(--border)",
                          borderRadius: 7, padding: "4px 8px",
                          fontSize: 12, cursor: "pointer", color: "var(--text-faint)",
                        }}>🗑</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Step>
        )}
      </div>

      {/* Modal: Guardar campaña */}
      {saveCampaignOpen && (
        <div onClick={() => !savingCampaign && setSaveCampaignOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalBox, maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💾 Guardar campaña</h3>
              <button onClick={() => setSaveCampaignOpen(false)} disabled={savingCampaign} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "0 0 14px", lineHeight: 1.55 }}>
              Guarda esta configuración completa: <strong>CSV ({file?.row_count} leads), mapping de columnas, prompt y modelo</strong>. Podrás volver a ella con un click sin tener que repetir nada.
            </p>
            <label style={lbl}>Nombre *</label>
            <input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder='Ej: "Cold CTOs SaaS Q3 2026"'
              style={inp}
              autoFocus
            />
            <label style={lbl}>Descripción <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— opcional</span></label>
            <textarea
              value={campaignDesc}
              onChange={(e) => setCampaignDesc(e.target.value)}
              rows={2}
              placeholder="A quién va dirigida, contexto, lo que necesites recordar…"
              style={{ ...inp, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ marginTop: 12, padding: 10, background: "var(--bg-elev-2)", borderRadius: 8, fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
              <strong>Incluye:</strong>
              <br/>📊 {file?.filename} · {file?.row_count.toLocaleString()} leads
              <br/>🔗 {Object.values(mapping).filter(Boolean).length} columnas mapeadas
              <br/>💬 Prompt {prompt.length} caracteres
              <br/>🤖 Modelo: {provider === "claude" ? "Claude" : "DeepSeek"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={saveCurrentCampaign} disabled={!campaignName.trim() || savingCampaign} style={{ ...btnPrimary, flex: 1, opacity: !campaignName.trim() || savingCampaign ? 0.5 : 1 }}>
                {savingCampaign ? "Guardando…" : "💾 Guardar"}
              </button>
              <button onClick={() => setSaveCampaignOpen(false)} disabled={savingCampaign} style={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Biblioteca de campañas */}
      {campaignsLibOpen && (
        <div onClick={() => setCampaignsLibOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalBox, maxWidth: 680 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📋 Mis campañas guardadas</h3>
              <button onClick={() => setCampaignsLibOpen(false)} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>
            {savedCampaigns.length === 0 ? (
              <div style={{ padding: "30px 16px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
                Aún no tienes campañas guardadas.<br/>
                Configura una en el flujo de arriba y pulsa <strong>💾 Guardar campaña</strong> al llegar al paso 5 para reutilizarla después.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "65vh", overflowY: "auto" }}>
                {savedCampaigns.map((c) => (
                  <div key={c.id} style={{
                    background: "#fff",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => loadCampaignFromLibrary(c)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{c.name}</span>
                        <span style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 99, fontWeight: 700,
                          background: c.provider === "deepseek" ? "rgba(245,158,11,0.12)" : "rgba(139,92,246,0.12)",
                          color: c.provider === "deepseek" ? "#b45309" : "#7c3aed",
                        }}>{c.provider}</span>
                        {(c.uses ?? 0) > 0 && (
                          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>· usado {c.uses}×</span>
                        )}
                      </div>
                      {c.description && (
                        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{c.description}</div>
                      )}
                      <div style={{ display: "flex", gap: 10, fontSize: 11.5, color: "var(--text-faint)", flexWrap: "wrap" }}>
                        <span>📊 <strong style={{ color: "var(--text-dim)" }}>{c.total_rows?.toLocaleString?.() ?? c.total_rows}</strong> leads</span>
                        <span>🔗 {Object.values(c.mapping || {}).filter(Boolean).length} cols mapeadas</span>
                        <span>💬 {c.prompt?.length ?? 0} chars</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4 }}>
                        {c.filename}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button
                        onClick={() => loadCampaignFromLibrary(c)}
                        style={{ ...btnPrimary, fontSize: 11, padding: "5px 10px" }}
                      >Abrir</button>
                      <button
                        onClick={() => deleteCampaignFromLibrary(c.id, c.name)}
                        style={{ ...btnGhostSm, fontSize: 11, padding: "4px 9px", color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }}
                      >🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Guardar prompt actual */}
      {saveModalOpen && (
        <div onClick={() => !savingPrompt && setSaveModalOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalBox, maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💾 Guardar prompt</h3>
              <button onClick={() => setSaveModalOpen(false)} disabled={savingPrompt} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>
            <label style={lbl}>Nombre *</label>
            <input
              value={savePromptName}
              onChange={(e) => setSavePromptName(e.target.value)}
              placeholder='Ej: "Cold email SaaS B2B CTOs España"'
              style={inp}
              autoFocus
            />
            <label style={lbl}>Descripción <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— opcional</span></label>
            <textarea
              value={savePromptDesc}
              onChange={(e) => setSavePromptDesc(e.target.value)}
              rows={2}
              placeholder="Para qué tipo de prospects, qué tono, etc."
              style={{ ...inp, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ marginTop: 12, padding: 10, background: "var(--bg-elev-2)", borderRadius: 8, fontSize: 11.5, color: "var(--text-dim)", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace" }}>
              {prompt.slice(0, 600)}{prompt.length > 600 && "…"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={saveCurrentPrompt} disabled={!savePromptName.trim() || savingPrompt} style={{ ...btnPrimary, flex: 1, opacity: !savePromptName.trim() || savingPrompt ? 0.5 : 1 }}>
                {savingPrompt ? "Guardando…" : "💾 Guardar"}
              </button>
              <button onClick={() => setSaveModalOpen(false)} disabled={savingPrompt} style={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Biblioteca de prompts */}
      {promptsLibOpen && (
        <div onClick={() => setPromptsLibOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalBox, maxWidth: 620 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📚 Mis prompts guardados</h3>
              <button onClick={() => setPromptsLibOpen(false)} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>
            {savedPrompts.length === 0 ? (
              <div style={{ padding: "30px 16px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
                Aún no tienes prompts guardados.<br/>
                Edita uno arriba y pulsa <strong>💾 Guardar este prompt</strong> para reutilizarlo después.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "60vh", overflowY: "auto" }}>
                {savedPrompts.map((p) => (
                  <div key={p.id} style={{
                    background: "#fff",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => loadPromptFromLibrary(p)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{p.name}</span>
                        {p.provider && (
                          <span style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 99, fontWeight: 700,
                            background: p.provider === "deepseek" ? "rgba(245,158,11,0.12)" : "rgba(139,92,246,0.12)",
                            color: p.provider === "deepseek" ? "#b45309" : "#7c3aed",
                          }}>{p.provider}</span>
                        )}
                        {(p.uses ?? 0) > 0 && (
                          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>· usado {p.uses}×</span>
                        )}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>{p.description}</div>
                      )}
                      <div style={{
                        fontSize: 11,
                        color: "var(--text-faint)",
                        fontFamily: "ui-monospace, Menlo, monospace",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical" as any,
                        background: "var(--bg-elev-2)",
                        padding: "5px 8px",
                        borderRadius: 6,
                      }}>
                        {p.content.slice(0, 200)}{p.content.length > 200 && "…"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button
                        onClick={() => loadPromptFromLibrary(p)}
                        style={{ ...btnPrimary, fontSize: 11, padding: "5px 10px" }}
                      >Usar</button>
                      <button
                        onClick={() => deletePromptFromLibrary(p.id, p.name)}
                        style={{ ...btnGhostSm, fontSize: 11, padding: "4px 9px", color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }}
                      >🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && settings && (
        <div onClick={() => setSettingsOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>⚙️ Ajustes de IA</h3>
              <button onClick={() => setSettingsOpen(false)} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>

            <label style={lbl}>Proveedor por defecto</label>
            <select
              value={settings.default_provider}
              onChange={(e) => setSettings({ ...settings, default_provider: e.target.value })}
              style={inp}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="deepseek">DeepSeek</option>
            </select>

            <div style={{ marginTop: 18, padding: 12, background: "var(--bg-elev-2)", borderRadius: 9 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>🟠 DeepSeek</div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.55 }}>
                Alternativa más barata (~10× menos coste que Claude). Crea una API key en <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>platform.deepseek.com</a> → API Keys.
              </div>
              <label style={lbl}>API Key</label>
              <input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder={settings.deepseek_api_key_present ? settings.deepseek_api_key_masked || "(actual configurada)" : "sk-..."}
                style={{ ...inp, fontFamily: "ui-monospace, Menlo, monospace" }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button onClick={saveSettings} disabled={savingSettings} style={{ ...btnPrimary, fontSize: 12 }}>
                  {savingSettings ? "Guardando…" : "💾 Guardar"}
                </button>
                <button onClick={() => doTest("deepseek")} disabled={!settings.deepseek_api_key_present} style={{ ...btnGhostSm, fontSize: 12, opacity: !settings.deepseek_api_key_present ? 0.5 : 1 }}>
                  🧪 Probar
                </button>
                <button onClick={() => doTest("claude")} style={{ ...btnGhostSm, fontSize: 12 }}>
                  🧪 Probar Claude
                </button>
              </div>
              {testResult && (
                <div style={{ marginTop: 10, padding: "7px 10px", background: testResult.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: testResult.ok ? "#047857" : "#b91c1c", borderRadius: 7, fontSize: 11.5 }}>
                  {testResult.loading ? "⏳ Probando…" :
                   testResult.ok ? `✓ ${testResult.provider} OK: "${testResult.sample}"` :
                   `✗ ${testResult.provider}: ${testResult.error}`}
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-faint)" }}>
              Las API keys se guardan cifradas en tu Postgres. No se exponen al navegador.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d}d`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function Step({ n, label, children, done }: any) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: done ? "#22c55e" : "var(--accent)",
          color: "#fff", display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 13,
        }}>{done ? "✓" : n}</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{label}</h2>
      </div>
      <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid var(--border)", borderRadius: 11, boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
        {children}
      </div>
    </div>
  );
}

function RadioRow({ label, checked, onClick }: { label: any; checked: boolean; onClick: () => void }) {
  return (
    <label
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px",
        background: checked ? "rgba(0,113,227,0.06)" : "var(--bg-elev-2)",
        border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 9, cursor: "pointer",
        fontSize: 13.5,
      }}
    >
      <input type="radio" checked={checked} onChange={() => {}} />
      {label}
    </label>
  );
}

// Styles
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px",
  background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
  color: "#fff", border: "none", borderRadius: 9,
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", boxShadow: "0 2px 6px rgba(0,113,227,0.25)",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 16px",
  background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 9,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const btnGhostSm: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 8,
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700,
  color: "var(--text-dim)", textTransform: "uppercase",
  letterSpacing: "0.06em", marginBottom: 5, marginTop: 8,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px",
  border: "1.5px solid var(--border)", borderRadius: 9,
  fontSize: 13, color: "var(--text)",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  background: "#fff",
};
const codeInline: React.CSSProperties = {
  background: "var(--bg-elev-2)", padding: "1px 5px",
  borderRadius: 4, fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 11.5,
};
const tokenBtnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center",
  padding: "5px 11px",
  background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
  color: "#fff", border: "none",
  borderRadius: 99,
  fontSize: 11.5, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
  boxShadow: "0 1px 3px rgba(0,113,227,0.25)",
  transition: "transform 0.1s",
};
const tokenBtnSecondary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center",
  padding: "4px 9px",
  background: "var(--bg-elev-2)",
  color: "var(--text-dim)",
  border: "1px solid var(--border)",
  borderRadius: 99,
  fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
  fontFamily: "ui-monospace, Menlo, monospace",
} as React.CSSProperties;
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 24,
  maxWidth: 480, width: "100%", maxHeight: "90vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(15,23,42,0.3)",
};
