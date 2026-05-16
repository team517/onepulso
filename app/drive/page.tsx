"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardNav from "../components/DashboardNav";

type Folder = { id: string; name: string; parents?: string[] };
type WatchedFolder = { id: string; name: string; path: string; added_at: string };
type DriveFile = {
  id: string; name: string; mimeType: string;
  iconLink?: string; webViewLink?: string; size?: string; modifiedTime?: string;
};

export default function DrivePage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderQuery, setFolderQuery] = useState("");
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [selectedWatched, setSelectedWatched] = useState<string | null>(null);
  const [filesInFolder, setFilesInFolder] = useState<DriveFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploadDrop, setUploadDrop] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; status: "uploading" | "ok" | "err"; error?: string }[]>([]);

  async function loadStatus() {
    setLoading(true);
    try {
      const j = await fetch("/api/drive/status").then((r) => r.json());
      setStatus(j);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // Si volvemos de OAuth, mostrar mensaje
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) {
      window.history.replaceState({}, "", "/drive");
    }
    if (params.get("error")) {
      alert("Error en conexión con Google: " + params.get("error"));
      window.history.replaceState({}, "", "/drive");
    }
  }, []);

  async function searchFolders(q: string) {
    setFoldersLoading(true);
    setFolderQuery(q);
    try {
      const url = q.trim() ? `/api/drive/folders?q=${encodeURIComponent(q)}` : "/api/drive/folders";
      const r = await fetch(url).then((r) => r.json());
      setFolders(r.folders || []);
    } catch {
      setFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }

  async function openFolderPicker() {
    setPickerOpen(true);
    searchFolders("");
  }

  async function toggleWatched(folder: Folder) {
    const isWatched = status?.watched_folders?.some((w: WatchedFolder) => w.id === folder.id);
    if (isWatched) {
      await fetch(`/api/drive/watched?id=${folder.id}`, { method: "DELETE" });
    } else {
      await fetch("/api/drive/watched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, name: folder.name }),
      });
    }
    await loadStatus();
  }

  async function loadFilesIn(folderId: string) {
    setSelectedWatched(folderId);
    setFilesLoading(true);
    setFilesInFolder([]);
    try {
      const r = await fetch(`/api/drive/files?folder_id=${folderId}`).then((r) => r.json());
      setFilesInFolder(r.files || []);
    } catch {
      setFilesInFolder([]);
    } finally {
      setFilesLoading(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || !selectedWatched) return;
    for (const file of Array.from(files)) {
      const trackId = file.name + Date.now();
      setUploadProgress((prev) => [...prev, { name: file.name, status: "uploading" }]);
      try {
        const ab = await file.arrayBuffer();
        const r = await fetch("/api/drive/upload", {
          method: "POST",
          headers: {
            "x-filename": encodeURIComponent(file.name),
            "x-folder-id": selectedWatched,
            "Content-Type": file.type || "application/octet-stream",
          },
          body: ab,
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        setUploadProgress((prev) =>
          prev.map((p) => (p.name === file.name ? { ...p, status: "ok" } : p))
        );
      } catch (e: any) {
        setUploadProgress((prev) =>
          prev.map((p) => (p.name === file.name ? { ...p, status: "err", error: e.message } : p))
        );
      }
    }
    // Recargar lista
    if (selectedWatched) loadFilesIn(selectedWatched);
    // Limpiar progreso después de 4s
    setTimeout(() => setUploadProgress([]), 4000);
  }

  const watchedSet = useMemo(() => new Set(status?.watched_folders?.map((w: WatchedFolder) => w.id) ?? []), [status]);

  // ─── Renders ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="dash-shell">
        <DashboardNav />
        <div className="dash-content" style={{ padding: 40 }}>
          <div className="loading-pulse"><span/><span/><span/></div>
        </div>
      </div>
    );
  }

  if (!status?.configured) {
    return (
      <div className="dash-shell">
        <DashboardNav />
        <div className="dash-content" style={{ padding: "32px 40px" }}>
          <h1 style={pageTitle}>📁 Drive</h1>
          <div style={warnCard}>
            <strong>⚠️ Configuración necesaria</strong>
            <p style={{ margin: "8px 0", fontSize: 13.5 }}>
              Para conectar Google Drive necesito que añadas dos variables de entorno en Railway:
            </p>
            <ul style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7 }}>
              <li><code style={code}>GOOGLE_DRIVE_CLIENT_ID</code></li>
              <li><code style={code}>GOOGLE_DRIVE_CLIENT_SECRET</code></li>
            </ul>
            <p style={{ margin: "12px 0 6px", fontSize: 13.5, fontWeight: 600 }}>Cómo obtenerlas:</p>
            <ol style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7 }}>
              <li>Ve a <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>console.cloud.google.com</a></li>
              <li>Crea un proyecto (o usa uno existente)</li>
              <li><strong>APIs y servicios</strong> → <strong>Biblioteca</strong> → busca <strong>"Google Drive API"</strong> → Habilitar</li>
              <li><strong>APIs y servicios</strong> → <strong>Credenciales</strong> → <strong>+ Crear credenciales</strong> → <strong>ID de cliente OAuth</strong></li>
              <li>Tipo: <strong>Aplicación web</strong></li>
              <li>URIs de redireccionamiento autorizados: <code style={code}>https://onepulso.up.railway.app/api/drive/callback</code></li>
              <li>Copia el <strong>Client ID</strong> y <strong>Client Secret</strong></li>
              <li>En Railway → Variables → añade <code style={code}>GOOGLE_DRIVE_CLIENT_ID</code> y <code style={code}>GOOGLE_DRIVE_CLIENT_SECRET</code></li>
              <li>(opcional) <code style={code}>APP_BASE_URL=https://onepulso.up.railway.app</code></li>
            </ol>
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-faint)" }}>
              Cuando hayas hecho esto, refresca esta página y aparecerá un botón "Conectar Google Drive".
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="dash-shell">
        <DashboardNav />
        <div className="dash-content" style={{ padding: "32px 40px" }}>
          <h1 style={pageTitle}>📁 Drive</h1>
          <div style={connectCard}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📂</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 19 }}>Conecta tu Google Drive</h2>
            <p style={{ color: "var(--text-dim)", fontSize: 14, maxWidth: 460, margin: "0 auto 18px" }}>
              Una vez conectado, elige las carpetas con las que quieres trabajar. La IA solo organizará archivos dentro de esas carpetas.
            </p>
            <a href="/api/drive/auth" style={btnPrimary}>
              🔗 Conectar Google Drive
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Conectado
  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content" style={{ padding: "28px 36px", overflow: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={pageTitle}>📁 Drive</h1>
            <p style={{ color: "var(--text-dim)", fontSize: 13.5, margin: "4px 0 0" }}>
              Conectado como <strong>{status.user_email}</strong> · La IA solo verá las carpetas que selecciones
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={openFolderPicker} style={btnPrimary}>+ Seleccionar carpetas</button>
            <button
              onClick={async () => {
                if (!confirm("¿Desconectar Google Drive?\n\nDeberás autorizar otra vez la próxima.")) return;
                await fetch("/api/drive/status", { method: "DELETE" });
                loadStatus();
              }}
              style={btnGhost}
            >Desconectar</button>
          </div>
        </div>

        {/* Layout: watched folders sidebar + files preview */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18, alignItems: "start" }}>
          {/* Watched folders */}
          <aside style={panelStyle}>
            <h3 style={panelTitle}>Carpetas seleccionadas <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>· {status.watched_folders?.length || 0}</span></h3>
            {(!status.watched_folders || status.watched_folders.length === 0) ? (
              <div style={emptyStyle}>
                <div style={{ marginBottom: 8 }}>📂</div>
                <div style={{ fontSize: 13, marginBottom: 12 }}>
                  Aún no has seleccionado carpetas. La IA no tocará nada de tu Drive hasta que añadas alguna.
                </div>
                <button onClick={openFolderPicker} style={{ ...btnPrimary, fontSize: 12 }}>+ Elegir carpetas</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {status.watched_folders.map((w: WatchedFolder) => (
                  <button
                    key={w.id}
                    onClick={() => loadFilesIn(w.id)}
                    style={{
                      ...folderItem,
                      background: selectedWatched === w.id ? "rgba(0,113,227,0.08)" : "#fff",
                      borderColor: selectedWatched === w.id ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 16 }}>📁</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{w.name}</span>
                    </div>
                    {w.path && w.path !== w.name && (
                      <div style={{ fontSize: 10.5, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {w.path}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* Files preview */}
          <main style={panelStyle}>
            {!selectedWatched ? (
              <div style={emptyStyle}>
                <div style={{ fontSize: 38, marginBottom: 8 }}>👈</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Selecciona una carpeta</div>
                <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
                  Elige una carpeta de la izquierda para ver y subir archivos.
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    Archivos {filesInFolder.length > 0 && <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>· {filesInFolder.length}</span>}
                  </h3>
                  <label
                    style={{ ...btnPrimary, fontSize: 12.5, padding: "8px 14px", cursor: "pointer" }}
                  >
                    + Subir archivos
                    <input
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                </div>

                {/* Upload progress chips */}
                {uploadProgress.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                    {uploadProgress.map((p) => (
                      <div
                        key={p.name}
                        style={{
                          fontSize: 12, padding: "6px 10px", borderRadius: 7,
                          background:
                            p.status === "ok" ? "rgba(16,185,129,0.1)" :
                            p.status === "err" ? "rgba(239,68,68,0.1)" :
                            "rgba(245,158,11,0.1)",
                          color:
                            p.status === "ok" ? "#047857" :
                            p.status === "err" ? "#b91c1c" :
                            "#b45309",
                          fontWeight: 600,
                        }}
                      >
                        {p.status === "ok" ? "✓" : p.status === "err" ? "⚠" : "⏳"} {p.name}
                        {p.status === "err" && p.error && <span style={{ marginLeft: 8, fontWeight: 400 }}>· {p.error}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Drag zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setUploadDrop(true); }}
                  onDragLeave={() => setUploadDrop(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setUploadDrop(false);
                    uploadFiles(e.dataTransfer.files);
                  }}
                  style={{
                    border: `2px dashed ${uploadDrop ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 11,
                    padding: 14,
                    marginBottom: 14,
                    textAlign: "center",
                    color: uploadDrop ? "var(--accent)" : "var(--text-faint)",
                    fontSize: 12.5,
                    background: uploadDrop ? "rgba(0,113,227,0.04)" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  {uploadDrop ? "Suelta para subir aquí" : "Arrastra archivos aquí o usa el botón Subir"}
                </div>

                {filesLoading ? (
                  <div className="loading-pulse"><span/><span/><span/></div>
                ) : filesInFolder.length === 0 ? (
                  <div style={emptyStyle}>
                    <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Carpeta vacía.</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {filesInFolder.map((f) => (
                      <a
                        key={f.id}
                        href={f.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        style={fileCard}
                      >
                        <div style={{ fontSize: 26, marginBottom: 6 }}>{iconFor(f.mimeType, f.name)}</div>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: "var(--text)",
                          overflow: "hidden", textOverflow: "ellipsis",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
                          marginBottom: 4, minHeight: 30,
                        }}>{f.name}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                          {f.size && fmtSize(f.size)}{f.size && f.modifiedTime && " · "}{f.modifiedTime && fmtRelative(f.modifiedTime)}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Picker Modal */}
      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Selecciona carpetas</h3>
              <button onClick={() => setPickerOpen(false)} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)" }}>×</button>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
              La IA <strong>solo verá las que marques</strong>. Click en una carpeta para añadirla / quitarla.
            </p>
            <input
              type="text"
              value={folderQuery}
              onChange={(e) => searchFolders(e.target.value)}
              placeholder="🔎 Busca por nombre de carpeta…"
              style={inputStyle}
              autoFocus
            />
            <div style={{ maxHeight: "50vh", overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {foldersLoading ? (
                <div style={{ padding: 20, textAlign: "center" }}><div className="loading-pulse"><span/><span/><span/></div></div>
              ) : folders.length === 0 ? (
                <div style={emptyStyle}>Sin resultados. Prueba otro nombre.</div>
              ) : (
                folders.map((f) => {
                  const isW = watchedSet.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleWatched(f)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px",
                        background: isW ? "rgba(16,185,129,0.08)" : "#fff",
                        border: `1px solid ${isW ? "rgba(16,185,129,0.4)" : "var(--border)"}`,
                        borderRadius: 9, cursor: "pointer", textAlign: "left",
                        fontFamily: "inherit",
                      }}
                    >
                      <span style={{ fontSize: 18 }}>📁</span>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{f.name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
                        background: isW ? "rgba(16,185,129,0.18)" : "var(--bg-elev-2)",
                        color: isW ? "#047857" : "var(--text-dim)",
                      }}>
                        {isW ? "✓ Añadida" : "+ Añadir"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setPickerOpen(false)} style={btnPrimary}>Hecho</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function iconFor(mime: string, name: string): string {
  if (mime.includes("folder")) return "📁";
  if (mime.includes("pdf") || name.toLowerCase().endsWith(".pdf")) return "📕";
  if (mime.includes("spreadsheet") || mime.includes("excel") || /\.xlsx?$/i.test(name)) return "📗";
  if (mime.includes("document") || mime.includes("word") || /\.docx?$/i.test(name)) return "📘";
  if (mime.includes("presentation") || /\.pptx?$/i.test(name)) return "📙";
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg)$/i.test(name)) return "🖼";
  if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/i.test(name)) return "🎬";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg)$/i.test(name)) return "🎵";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "🗜";
  return "📄";
}

function fmtSize(b: string | number): string {
  const bytes = typeof b === "string" ? parseInt(b, 10) : b;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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

// ─── Styles ─────────────────────────────────────────────

const pageTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0,
};
const panelStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)", borderRadius: 14,
  padding: 16, boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
};
const panelTitle: React.CSSProperties = {
  margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: "var(--text)",
};
const emptyStyle: React.CSSProperties = {
  padding: "30px 16px", textAlign: "center",
  color: "var(--text-faint)", fontSize: 13,
};
const folderItem: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)",
  borderRadius: 9, padding: "9px 11px",
  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
  transition: "all 0.15s",
};
const fileCard: React.CSSProperties = {
  background: "var(--bg-elev-2)", border: "1px solid var(--border)",
  borderRadius: 10, padding: 12, textAlign: "center",
  textDecoration: "none", color: "inherit",
  transition: "all 0.15s", display: "block",
};
const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "9px 16px",
  background: "linear-gradient(135deg, #0071e3, #1d4ed8)",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit", textDecoration: "none",
};
const btnGhost: React.CSSProperties = {
  padding: "9px 16px",
  background: "transparent", color: "var(--text-dim)",
  border: "1px solid var(--border)", borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  fontFamily: "inherit",
};
const warnCard: React.CSSProperties = {
  background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)",
  borderRadius: 12, padding: 20, marginTop: 16, fontSize: 13.5,
};
const connectCard: React.CSSProperties = {
  background: "#fff", border: "1px solid var(--border)",
  borderRadius: 14, padding: 40, textAlign: "center", marginTop: 16,
  boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
};
const code: React.CSSProperties = {
  background: "var(--bg-elev-2)", padding: "2px 6px",
  borderRadius: 5, fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 12,
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 20, backdropFilter: "blur(4px)",
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 22,
  width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(15,23,42,0.3)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px",
  background: "#fff", border: "1.5px solid var(--border)",
  borderRadius: 9, fontSize: 13.5, color: "var(--text)",
  outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
