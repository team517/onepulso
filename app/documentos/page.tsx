"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Doc = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  folder?: string;
  tags?: string[];
  client_name?: string;
  notes?: string;
  uploaded_at: string;
};

export default function DocumentosPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | "all" | "_root">("all");
  const [search, setSearch] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ name: string; status: "uploading" | "ok" | "err"; error?: string }[]>([]);
  const [dropping, setDropping] = useState(false);

  // Upload modal
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadClient, setUploadClient] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const j = await fetch("/api/documents").then((r) => r.json());
      setDocs(j.documents || []);
      setFolders(j.folders || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createNewFolder() {
    const name = prompt("Nombre de la nueva carpeta:");
    if (!name?.trim()) return;
    const r = await fetch("/api/documents/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).then((r) => r.json());
    if (r.error) {
      alert("⚠️ " + r.error);
      return;
    }
    setFolders(r.folders || []);
    setActiveFolder(name.trim()); // entrar directamente
  }

  async function renameCurrentFolder() {
    if (activeFolder === "all" || activeFolder === "_root") return;
    const newName = prompt(`Renombrar carpeta "${activeFolder}":`, activeFolder);
    if (!newName?.trim() || newName.trim() === activeFolder) return;
    const r = await fetch("/api/documents/folders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old: activeFolder, new: newName.trim() }),
    }).then((r) => r.json());
    if (r.error) {
      alert("⚠️ " + r.error);
      return;
    }
    setActiveFolder(newName.trim());
    await load();
  }

  async function deleteCurrentFolder() {
    if (activeFolder === "all" || activeFolder === "_root") return;
    const inside = docs.filter((d) => d.folder === activeFolder).length;
    if (inside > 0) {
      const choice = confirm(
        `La carpeta "${activeFolder}" tiene ${inside} documento(s).\n\n` +
        `[Aceptar] = Mover documentos a "Sin carpeta" y borrar carpeta\n` +
        `[Cancelar] = Cancelar`
      );
      if (!choice) return;
      const r = await fetch(`/api/documents/folders?name=${encodeURIComponent(activeFolder)}&force=1`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (r.error) { alert("⚠️ " + r.error); return; }
    } else {
      if (!confirm(`¿Eliminar la carpeta vacía "${activeFolder}"?`)) return;
      const r = await fetch(`/api/documents/folders?name=${encodeURIComponent(activeFolder)}`, {
        method: "DELETE",
      }).then((r) => r.json());
      if (r.error) { alert("⚠️ " + r.error); return; }
    }
    setActiveFolder("all");
    await load();
  }

  async function doUpload(files: File[], folder: string, clientName: string, notes: string) {
    for (const f of files) {
      setUploadProgress((prev) => [...prev, { name: f.name, status: "uploading" }]);
      try {
        const ab = await f.arrayBuffer();
        const headers: Record<string, string> = {
          "x-filename": encodeURIComponent(f.name),
          "Content-Type": f.type || "application/octet-stream",
        };
        if (folder) headers["x-folder"] = encodeURIComponent(folder);
        if (clientName) headers["x-client-name"] = encodeURIComponent(clientName);
        if (notes) headers["x-notes"] = encodeURIComponent(notes);

        const r = await fetch("/api/documents", { method: "POST", headers, body: ab });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        setUploadProgress((prev) =>
          prev.map((p) => (p.name === f.name ? { ...p, status: "ok" } : p))
        );
      } catch (e: any) {
        setUploadProgress((prev) =>
          prev.map((p) => (p.name === f.name ? { ...p, status: "err", error: e.message } : p))
        );
      }
    }
    await load();
    setTimeout(() => setUploadProgress([]), 4000);
  }

  function openUploadModal(filesPre?: File[]) {
    setUploadFiles(filesPre || []);
    setUploadFolder(activeFolder === "all" || activeFolder === "_root" ? "" : activeFolder);
    setUploadClient("");
    setUploadNotes("");
    setUploadOpen(true);
  }

  async function submitUpload() {
    if (uploadFiles.length === 0) return;
    setUploadOpen(false);
    await doUpload(uploadFiles, uploadFolder.trim(), uploadClient.trim(), uploadNotes.trim());
    setUploadFiles([]);
  }

  function onPickFiles(files: FileList | null) {
    if (!files) return;
    openUploadModal(Array.from(files));
  }

  async function removeDoc(d: Doc) {
    if (!confirm(`¿Eliminar "${d.filename}"?\n\nEsto borra el archivo permanentemente.`)) return;
    await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
    load();
  }

  async function renameDoc(d: Doc) {
    const newName = prompt("Nuevo nombre:", d.filename);
    if (!newName || newName.trim() === d.filename) return;
    await fetch(`/api/documents/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: newName.trim() }),
    });
    load();
  }

  async function moveDoc(d: Doc) {
    const newFolder = prompt(`Mover "${d.filename}" a carpeta:\n(deja vacío para raíz)`, d.folder || "");
    if (newFolder === null) return;
    await fetch(`/api/documents/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: newFolder.trim() || undefined }),
    });
    load();
  }

  const filtered = useMemo(() => {
    let list = docs.slice();
    if (activeFolder === "_root") list = list.filter((d) => !d.folder);
    else if (activeFolder !== "all") list = list.filter((d) => d.folder === activeFolder);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.filename.toLowerCase().includes(q) ||
          d.folder?.toLowerCase().includes(q) ||
          d.client_name?.toLowerCase().includes(q) ||
          d.notes?.toLowerCase().includes(q) ||
          d.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
    return list;
  }, [docs, activeFolder, search]);

  const totalSize = useMemo(() => docs.reduce((acc, d) => acc + d.size, 0), [docs]);

  return (
    <div
      className="dash-shell"
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDropping(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length > 0) onPickFiles(e.dataTransfer.files);
      }}
    >
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 36px", overflow: "auto", position: "relative" }}>
        {/* Drop overlay */}
        {dropping && (
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(0,113,227,0.1)",
            border: "3px dashed var(--accent)",
            zIndex: 999,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{ background: "#fff", padding: "20px 32px", borderRadius: 14, fontSize: 16, fontWeight: 700, color: "var(--accent)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
              📤 Suelta para subir
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              📂 Documentos
            </h1>
            <p style={{ color: "var(--text-dim)", marginTop: 4, fontSize: 13.5 }}>
              {docs.length} archivo{docs.length !== 1 ? "s" : ""} · {fmtSize(totalSize)} · Almacenados de forma segura
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createNewFolder} style={btnGhost}>
              + Nueva carpeta
            </button>
            <button onClick={() => openUploadModal()} style={btnPrimary}>
              + Subir documento
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {/* Progress bar de uploads en curso */}
        {uploadProgress.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxWidth: 720 }}>
            {uploadProgress.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 12.5, padding: "8px 12px", borderRadius: 8,
                  background:
                    p.status === "ok" ? "rgba(16,185,129,0.1)" :
                    p.status === "err" ? "rgba(239,68,68,0.1)" :
                    "rgba(245,158,11,0.1)",
                  color:
                    p.status === "ok" ? "#047857" :
                    p.status === "err" ? "#b91c1c" :
                    "#b45309",
                  fontWeight: 600,
                  border: "1px solid",
                  borderColor:
                    p.status === "ok" ? "rgba(16,185,129,0.3)" :
                    p.status === "err" ? "rgba(239,68,68,0.3)" :
                    "rgba(245,158,11,0.3)",
                }}
              >
                <span>{p.status === "ok" ? "✓" : p.status === "err" ? "✗" : "⏳"}</span>
                <span style={{ flex: 1 }}>{p.name}</span>
                {p.error && <span style={{ fontWeight: 400 }}>{p.error}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔎 Buscar archivos, carpetas, clientes, notas…"
            style={{
              flex: 1, minWidth: 200, maxWidth: 400,
              padding: "9px 14px",
              border: "1px solid var(--border)",
              borderRadius: 10, fontSize: 13.5, outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Layout: sidebar carpetas + grid archivos */}
        <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18, alignItems: "start" }}>
          {/* Folders sidebar */}
          <aside style={{ ...panel, position: "sticky", top: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Carpetas
            </div>
            <button
              onClick={createNewFolder}
              style={{
                width: "100%",
                background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: 10,
                boxShadow: "0 2px 6px rgba(0,113,227,0.25)",
              }}
            >
              + Nueva carpeta
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <FolderBtn label={`📁 Todas`} count={docs.length} active={activeFolder === "all"} onClick={() => setActiveFolder("all")} />
              <FolderBtn label={`📄 Sin carpeta`} count={docs.filter((d) => !d.folder).length} active={activeFolder === "_root"} onClick={() => setActiveFolder("_root")} />
              {folders.map((f) => (
                <FolderBtn
                  key={f}
                  label={`📁 ${f}`}
                  count={docs.filter((d) => d.folder === f).length}
                  active={activeFolder === f}
                  onClick={() => setActiveFolder(f)}
                />
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
              Click <strong>+</strong> arriba para crear una carpeta. Al subir archivos, eliges en cuál van.
            </div>

            {/* Acciones de la carpeta activa (si es una carpeta concreta) */}
            {activeFolder !== "all" && activeFolder !== "_root" && (
              <div style={{
                marginTop: 14, paddingTop: 14,
                borderTop: "1px solid var(--border)",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Carpeta: {activeFolder}
                </div>
                <button onClick={renameCurrentFolder} style={folderActionBtn}>✏️ Renombrar</button>
                <button onClick={deleteCurrentFolder} style={{ ...folderActionBtn, color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }}>🗑 Eliminar</button>
              </div>
            )}
          </aside>

          {/* Files grid */}
          <main style={panel}>
            {loading ? (
              <div className="loading-pulse"><span/><span/><span/></div>
            ) : filtered.length === 0 ? (
              <div style={emptyStyle}>
                <div style={{ fontSize: 38, marginBottom: 8 }}>📄</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                  {docs.length === 0 ? "Sin documentos todavía" : "Sin resultados"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14 }}>
                  {docs.length === 0 ? "Sube tu primer archivo arrastrándolo aquí o con el botón." : "Cambia el filtro o la búsqueda."}
                </div>
                {docs.length === 0 && (
                  <button onClick={() => openUploadModal()} style={btnPrimary}>+ Subir documento</button>
                )}
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}>
                {filtered.map((d) => (
                  <DocCard key={d.id} doc={d} onRename={() => renameDoc(d)} onMove={() => moveDoc(d)} onDelete={() => removeDoc(d)} />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div onClick={() => setUploadOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>📤 Subir documentos</h3>
              <button onClick={() => setUploadOpen(false)} style={modalCloseBtn}>×</button>
            </div>

            {uploadFiles.length === 0 ? (
              <label style={dropZone}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Click o arrastra archivos aquí</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Máximo 25 MB por archivo</div>
                <input type="file" multiple hidden onChange={(e) => {
                  if (e.target.files) setUploadFiles(Array.from(e.target.files));
                  e.target.value = "";
                }} />
              </label>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {uploadFiles.length} archivo{uploadFiles.length !== 1 ? "s" : ""} seleccionado{uploadFiles.length !== 1 ? "s" : ""}
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {uploadFiles.map((f, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      fontSize: 12.5, padding: "6px 10px",
                      background: "var(--bg-elev-2)", borderRadius: 7,
                    }}>
                      <span>{iconFor(f.type, f.name)}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                      <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{fmtSize(f.size)}</span>
                      <button
                        onClick={() => setUploadFiles((prev) => prev.filter((_, j) => j !== i))}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 14 }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label style={labelStyle}>
              Carpeta <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— opcional</span>
            </label>
            <input
              type="text"
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              list="folder-suggestions"
              placeholder="Ej: Facturas, Contratos, Clientes/Acme"
              style={inputStyle}
            />
            <datalist id="folder-suggestions">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>

            <label style={labelStyle}>
              Cliente <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— opcional</span>
            </label>
            <input
              type="text"
              value={uploadClient}
              onChange={(e) => setUploadClient(e.target.value)}
              placeholder="Ej: Acme S.L."
              style={inputStyle}
            />

            <label style={labelStyle}>
              Notas <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— opcional</span>
            </label>
            <textarea
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              placeholder="Ej: Factura del Q1 firmada, contrato con anexo C…"
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={submitUpload}
                disabled={uploadFiles.length === 0}
                style={{
                  ...btnPrimary, flex: 1,
                  opacity: uploadFiles.length === 0 ? 0.5 : 1,
                  cursor: uploadFiles.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                Subir {uploadFiles.length > 0 ? `(${uploadFiles.length})` : ""}
              </button>
              <button onClick={() => setUploadOpen(false)} style={btnGhost}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderBtn({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px",
        background: active ? "rgba(0,113,227,0.08)" : "transparent",
        color: active ? "var(--accent)" : "var(--text)",
        border: "1px solid",
        borderColor: active ? "rgba(0,113,227,0.25)" : "transparent",
        borderRadius: 8,
        fontSize: 13, fontWeight: active ? 700 : 500,
        cursor: "pointer", fontFamily: "inherit",
        textAlign: "left",
        transition: "all 0.12s",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 700,
        background: active ? "var(--accent)" : "var(--bg-elev-3)",
        color: active ? "#fff" : "var(--text-dim)",
        padding: "1px 7px", borderRadius: 99,
        minWidth: 16, textAlign: "center",
      }}>{count}</span>
    </button>
  );
}

function DocCard({ doc, onRename, onMove, onDelete }: { doc: Doc; onRename: () => void; onMove: () => void; onDelete: () => void }) {
  const icon = iconFor(doc.mime, doc.filename);
  const isImage = doc.mime.startsWith("image/");
  return (
    <div style={{
      background: "#fff", border: "1px solid var(--border)",
      borderRadius: 11, padding: 12,
      transition: "all 0.15s",
      position: "relative",
    }}>
      <a
        href={`/api/documents/${doc.id}`}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {isImage ? (
          <div style={{ width: "100%", aspectRatio: "1.4 / 1", borderRadius: 7, overflow: "hidden", marginBottom: 8, background: "var(--bg-elev-2)" }}>
            <img
              src={`/api/documents/${doc.id}`}
              alt={doc.filename}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : (
          <div style={{ fontSize: 36, textAlign: "center", marginBottom: 6, lineHeight: 1 }}>{icon}</div>
        )}
        <div style={{
          fontSize: 12.5, fontWeight: 600,
          overflow: "hidden", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
          minHeight: 32, lineHeight: 1.3, marginBottom: 4,
        }}>
          {doc.filename}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", display: "flex", justifyContent: "space-between", gap: 4 }}>
          <span>{fmtSize(doc.size)}</span>
          <span>{fmtRelative(doc.uploaded_at)}</span>
        </div>
        {(doc.folder || doc.client_name) && (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {doc.folder && (
              <span style={{ fontSize: 10, padding: "1px 6px", background: "rgba(99,102,241,0.1)", color: "#4f46e5", borderRadius: 99, fontWeight: 700 }}>
                📁 {doc.folder}
              </span>
            )}
            {doc.client_name && (
              <span style={{ fontSize: 10, padding: "1px 6px", background: "rgba(139,92,246,0.1)", color: "#7c3aed", borderRadius: 99, fontWeight: 700 }}>
                👤 {doc.client_name}
              </span>
            )}
          </div>
        )}
      </a>
      <div style={{ marginTop: 8, display: "flex", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <a
          href={`/api/documents/${doc.id}?download=1`}
          download={doc.filename}
          title="Descargar"
          style={{ ...iconBtn, textDecoration: "none", textAlign: "center" }}
        >⬇</a>
        <button onClick={onRename} title="Renombrar" style={iconBtn}>✏️</button>
        <button onClick={onMove} title="Mover de carpeta" style={iconBtn}>📁</button>
        <button onClick={onDelete} title="Eliminar" style={{ ...iconBtn, color: "#dc2626" }}>🗑</button>
      </div>
    </div>
  );
}

function iconFor(mime: string, name: string): string {
  if (mime.includes("pdf") || /\.pdf$/i.test(name)) return "📕";
  if (mime.includes("spreadsheet") || mime.includes("excel") || /\.(xlsx?|csv|tsv)$/i.test(name)) return "📗";
  if (mime.includes("word") || /\.docx?$/i.test(name)) return "📘";
  if (mime.includes("presentation") || /\.pptx?$/i.test(name)) return "📙";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return "🎬";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(name)) return "🎵";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "🗜";
  if (mime.startsWith("text/") || /\.(txt|md|log)$/i.test(name)) return "📄";
  return "📄";
}

function fmtSize(b: number): string {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
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

const panel: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)",
  borderRadius: 12, padding: 14,
  boxShadow: "0 1px 3px rgba(15,23,42,0.03)",
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px",
  background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 14px",
  background: "transparent", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const emptyStyle: React.CSSProperties = {
  padding: "60px 20px", textAlign: "center",
  color: "var(--text-faint)",
};
const iconBtn: React.CSSProperties = {
  flex: 1,
  padding: "6px 4px",
  background: "transparent", border: "1px solid var(--border)",
  borderRadius: 7, fontSize: 13, cursor: "pointer",
  fontFamily: "inherit", color: "var(--text-dim)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const folderActionBtn: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)",
  borderRadius: 7, padding: "6px 10px",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit", color: "var(--text-dim)",
  textAlign: "left",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 24,
  width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(15,23,42,0.3)",
};
const modalCloseBtn: React.CSSProperties = {
  background: "transparent", border: "none", fontSize: 22,
  cursor: "pointer", color: "var(--text-faint)",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700,
  color: "var(--text-dim)", textTransform: "uppercase",
  letterSpacing: "0.06em", marginTop: 12, marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px",
  background: "#fff", border: "1.5px solid var(--border)",
  borderRadius: 9, fontSize: 13.5, color: "var(--text)",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const dropZone: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: "30px 20px", borderRadius: 11,
  border: "2px dashed var(--border)",
  background: "var(--bg-elev-2)", cursor: "pointer",
  marginBottom: 8, color: "var(--text-dim)",
};
