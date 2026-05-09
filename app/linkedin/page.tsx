"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DashboardNav from "../components/DashboardNav";

type LinkedInStatus = {
  connected: boolean;
  name?: string;
  email?: string;
  picture?: string;
  user_urn?: string;
  expires_at?: string;
};

type Post = {
  id: string;
  text: string;
  image_path?: string;
  visibility: "PUBLIC" | "CONNECTIONS";
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  scheduled_at?: string;
  published_at?: string;
  error?: string;
  linkedin_post_urn?: string;
  created_at: string;
};

type Skill = { name: string; description: string };

export default function LinkedInPage() {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list" | "skills">("calendar");
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [installingSkill, setInstallingSkill] = useState(false);
  const [skillFeedback, setSkillFeedback] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [planRunning, setPlanRunning] = useState(false);
  const [planForm, setPlanForm] = useState({
    daysOfWeek: [2, 3, 4] as number[], // Mar Mié Jue (ISO)
    hour: 10,
    minute: 0,
    briefs: "",
    generate_images: false,
  });
  const [planResult, setPlanResult] = useState<string | null>(null);
  // Editor state
  const [editText, setEditText] = useState("");
  const [editScheduledAt, setEditScheduledAt] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editRemoveImage, setEditRemoveImage] = useState(false);
  const [editImagePrompt, setEditImagePrompt] = useState("");
  const [editGeneratingImg, setEditGeneratingImg] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);
  // Credentials
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsStatus, setCredsStatus] = useState<Record<string, { configured: boolean; masked: string }>>({});
  const [credsForm, setCredsForm] = useState<Record<string, string>>({});
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsFeedback, setCredsFeedback] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refresh();
    // ping scheduler tick on load to make sure it's running
    fetch("/api/linkedin/scheduler/tick").catch(() => {});
    const url = new URL(window.location.href);
    if (url.searchParams.get("connected") === "1") {
      setFeedback("✓ Cuenta de LinkedIn conectada.");
      window.history.replaceState({}, "", url.pathname);
      setTimeout(() => setFeedback(null), 5000);
    }
    const err = url.searchParams.get("error");
    if (err) {
      setFeedback("⚠️ " + decodeURIComponent(err));
      window.history.replaceState({}, "", url.pathname);
    }
    // poll posts every 30s to refresh statuses (scheduled -> published)
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);

  async function openCreds() {
    const r = await fetch("/api/credentials").then((r) => r.json());
    setCredsStatus(r);
    setCredsForm({});
    setCredsOpen(true);
    setCredsFeedback(null);
  }
  async function saveCreds() {
    setCredsSaving(true);
    try {
      // Solo enviar las que ha tocado
      const r = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credsForm),
      });
      const d = await r.json();
      if (d.ok) {
        setCredsFeedback("✓ Guardado.");
        const fresh = await fetch("/api/credentials").then((r) => r.json());
        setCredsStatus(fresh);
        setCredsForm({});
      } else {
        setCredsFeedback("⚠️ " + (d.error ?? "error"));
      }
    } catch (e: any) {
      setCredsFeedback("⚠️ " + e.message);
    } finally {
      setCredsSaving(false);
      setTimeout(() => setCredsFeedback(null), 6000);
    }
  }

  async function refresh() {
    const [s, p, sk] = await Promise.all([
      fetch("/api/linkedin/status").then((r) => r.json()),
      fetch("/api/linkedin/posts").then((r) => r.json()),
      fetch("/api/skills?scope=linkedin").then((r) => r.json()),
    ]);
    setStatus(s);
    setPosts(p.posts ?? []);
    setSkills(sk.skills ?? []);
  }

  async function installSkillLI() {
    if (!skillInput.trim() || installingSkill) return;
    setInstallingSkill(true);
    setSkillFeedback("Descargando…");
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: skillInput.trim(), scope: "linkedin" }),
      });
      const data = await res.json();
      if (data.installed?.length) {
        setSkillFeedback(`✓ Descargada: ${data.installed.map((s: any) => s.name).join(", ")}`);
        setSkillInput("");
      } else if (data.error) {
        setSkillFeedback("⚠️ " + data.error.slice(0, 200));
      } else {
        setSkillFeedback("Sin skill detectada.");
      }
    } finally {
      setInstallingSkill(false);
      refresh();
      setTimeout(() => setSkillFeedback(null), 8000);
    }
  }

  async function removeSkillFromLI(name: string) {
    if (!confirm(`Quitar "${name}" del módulo de LinkedIn? (no borra el archivo, solo la asociación)`)) return;
    await fetch("/api/skills", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scope: "linkedin" }),
    });
    refresh();
  }

  async function runMonthPlan() {
    setPlanRunning(true);
    setPlanResult(null);
    try {
      const r = await fetch("/api/linkedin/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: calMonth.getFullYear(),
          month: calMonth.getMonth() + 1,
          daysOfWeek: planForm.daysOfWeek,
          hour: planForm.hour,
          minute: planForm.minute,
          briefs: planForm.briefs,
          generate_images: planForm.generate_images,
        }),
      });
      const data = await r.json();
      if (data.error) {
        setPlanResult(`⚠️ ${data.error.slice(0, 300)}`);
      } else {
        const msg = `✓ ${data.posts_created} posts creados${
          planForm.generate_images
            ? ` · imágenes OK ${data.images_ok}, fallos ${data.images_failed}`
            : ""
        }`;
        setPlanResult(msg);
        refresh();
      }
    } catch (e: any) {
      setPlanResult("⚠️ " + e.message);
    } finally {
      setPlanRunning(false);
    }
  }

  function toggleDay(d: number) {
    setPlanForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d)
        ? f.daysOfWeek.filter((x) => x !== d)
        : [...f.daysOfWeek, d].sort(),
    }));
  }

  async function generateImage(useFromPost: boolean) {
    if (generatingImage) return;
    if (!useFromPost && !imagePrompt.trim()) return;
    if (useFromPost && !text.trim()) {
      setFeedback("⚠️ El texto del post está vacío. Escribe o genera el post primero.");
      return;
    }
    setGeneratingImage(true);
    try {
      const body: any = useFromPost
        ? { post_text: text, extra: imagePrompt }
        : { prompt: imagePrompt };
      const r = await fetch("/api/linkedin/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) {
        setFeedback("⚠️ " + data.error.slice(0, 240));
      } else if (data.image_base64) {
        const blob = await (await fetch(`data:${data.mime ?? "image/png"};base64,${data.image_base64}`)).blob();
        const file = new File([blob], data.image_filename || `ai-${Date.now()}.png`, { type: data.mime ?? "image/png" });
        setImageFile(file);
        // Usar URL persistente del servidor si está disponible (sobrevive a recargas).
        // Fallback a blob URL temporal si no.
        if (data.image_url) {
          setImagePreviewUrl(data.image_url);
        } else {
          setImagePreviewUrl(URL.createObjectURL(blob));
        }
        setFeedback(
          data.derived_from_post_text
            ? "✓ Imagen generada del texto del post."
            : "✓ Imagen generada y adjuntada."
        );
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setGeneratingImage(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  async function generateText() {
    if (!prompt.trim() || drafting) return;
    setDrafting(true);
    try {
      const r = await fetch("/api/linkedin/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, has_image: !!imageFile }),
      });
      const d = await r.json();
      if (d.text) setText(d.text);
      if (d.error) setFeedback("⚠️ " + d.error);
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setDrafting(false);
    }
  }

  async function savePost(publishNow: boolean) {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("text", text);
      fd.append("visibility", "PUBLIC");
      if (scheduledAt && !publishNow) fd.append("scheduled_at", new Date(scheduledAt).toISOString());
      if (imageFile) fd.append("image", imageFile);

      const r = await fetch("/api/linkedin/posts", { method: "POST", body: fd });
      const d = await r.json();
      if (d.error) {
        setFeedback("⚠️ " + d.error);
        return;
      }
      const post: Post = d.post;

      if (publishNow) {
        const pr = await fetch("/api/linkedin/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: post.id }),
        });
        const pd = await pr.json();
        if (pd.error) {
          setFeedback("⚠️ Publicación falló: " + pd.error.slice(0, 200));
        } else {
          setFeedback("✓ Publicado.");
        }
      } else {
        setFeedback(post.scheduled_at ? "✓ Programado." : "✓ Guardado como borrador.");
      }
      setText("");
      setPrompt("");
      setScheduledAt("");
      setImageFile(null);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  async function publishExisting(id: string) {
    setSaving(true);
    try {
      const pr = await fetch("/api/linkedin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const pd = await pr.json();
      if (pd.error) setFeedback("⚠️ " + pd.error.slice(0, 200));
      else setFeedback("✓ Publicado.");
    } finally {
      setSaving(false);
      refresh();
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function deletePost(id: string) {
    if (!confirm("¿Borrar este post?")) return;
    await fetch(`/api/linkedin/posts/${id}`, { method: "DELETE" });
    refresh();
  }

  async function disconnect() {
    if (!confirm("¿Desconectar tu cuenta de LinkedIn de la plataforma?")) return;
    await fetch("/api/linkedin/status", { method: "DELETE" });
    refresh();
  }

  function fmtWhen(p: Post): string {
    if (p.status === "published" && p.published_at)
      return "publicado " + new Date(p.published_at).toLocaleString();
    if (p.scheduled_at) return "programado " + new Date(p.scheduled_at).toLocaleString();
    return "borrador";
  }

  // ---------- Calendario ----------

  function dayKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function buildMonthGrid(monthStart: Date): Date[] {
    const grid: Date[] = [];
    // Empezar en lunes de la primera semana
    const first = new Date(monthStart);
    const dow = (first.getDay() + 6) % 7; // 0=Mon, 6=Sun
    first.setDate(first.getDate() - dow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      grid.push(d);
    }
    return grid;
  }

  const postsByDay = (() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const when = p.scheduled_at ?? p.published_at;
      if (!when) continue;
      const k = dayKey(new Date(when));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  })();

  function changeMonth(delta: number) {
    setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1));
  }

  function clickDay(d: Date) {
    // Pre-rellena el composer con esa fecha a las 10:00 local
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0, 0);
    const offset = target.getTimezoneOffset() * 60000;
    const localISO = new Date(target.getTime() - offset).toISOString().slice(0, 16);
    setScheduledAt(localISO);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clickPostChip(p: Post, e: React.MouseEvent) {
    e.stopPropagation();
    openEditor(p);
  }

  function openEditor(p: Post) {
    setOpenPost(p);
    setEditText(p.text);
    if (p.scheduled_at) {
      // ISO -> local datetime-local format
      const d = new Date(p.scheduled_at);
      const offset = d.getTimezoneOffset() * 60000;
      setEditScheduledAt(new Date(d.getTime() - offset).toISOString().slice(0, 16));
    } else {
      setEditScheduledAt("");
    }
    setEditImageFile(null);
    setEditRemoveImage(false);
    setEditImagePrompt("");
    setEditImagePreview(p.image_path ? `/api/linkedin/posts/${p.id}/image?ts=${Date.now()}` : null);
    if (editFileRef.current) editFileRef.current.value = "";
  }

  function closeEditor() {
    setOpenPost(null);
    setEditText("");
    setEditImageFile(null);
    setEditImagePreview(null);
    setEditRemoveImage(false);
    setEditImagePrompt("");
  }

  async function saveEditor() {
    if (!openPost) return;
    setEditSaving(true);
    try {
      const fd = new FormData();
      fd.append("text", editText);
      if (editScheduledAt) {
        fd.append("scheduled_at", new Date(editScheduledAt).toISOString());
      } else {
        fd.append("scheduled_at", "");
      }
      if (editRemoveImage) fd.append("remove_image", "1");
      if (editImageFile) fd.append("image", editImageFile);
      const r = await fetch(`/api/linkedin/posts/${openPost.id}`, { method: "PATCH", body: fd });
      const d = await r.json();
      if (d.error) {
        setFeedback("⚠️ " + d.error);
      } else {
        setFeedback("✓ Post actualizado.");
        closeEditor();
        refresh();
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setEditSaving(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function generateImageInEditor(useFromPost: boolean) {
    if (editGeneratingImg) return;
    if (!useFromPost && !editImagePrompt.trim()) return;
    if (useFromPost && !editText.trim()) {
      setFeedback("⚠️ El texto del post está vacío.");
      return;
    }
    setEditGeneratingImg(true);
    try {
      const body: any = useFromPost
        ? { post_text: editText, extra: editImagePrompt }
        : { prompt: editImagePrompt };
      const r = await fetch("/api/linkedin/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.error) {
        setFeedback("⚠️ " + d.error.slice(0, 240));
        return;
      }
      const blob = await (await fetch(`data:${d.mime ?? "image/png"};base64,${d.image_base64}`)).blob();
      const file = new File([blob], `ai-${Date.now()}.png`, { type: d.mime ?? "image/png" });
      setEditImageFile(file);
      setEditImagePreview(URL.createObjectURL(blob));
      setEditRemoveImage(false);
      if (d.derived_from_post_text) {
        setFeedback(`✓ Imagen generada del texto del post.`);
      } else {
        setFeedback("✓ Imagen generada.");
      }
    } catch (e: any) {
      setFeedback("⚠️ " + e.message);
    } finally {
      setEditGeneratingImg(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  async function reschedule(id: string, isoDate: string) {
    await fetch(`/api/linkedin/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_at: isoDate, status: "scheduled" }),
    });
    refresh();
  }

  const monthLabel = calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = dayKey(new Date());
  const monthStartKey = dayKey(calMonth);

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content li-app">
      <header className="li-header">
        <div>
          <div className="dash-page-title">LinkedIn</div>
          {status?.connected && <div className="dash-page-subtitle">{status.name}</div>}
        </div>
        <div className="li-status">
          <button
            className="btn-ghost"
            onClick={openCreds}
            title="Configurar API keys (OpenAI, Anthropic, Instantly, LinkedIn)"
          >
            ⚙️ API keys
          </button>
          {status?.connected ? (
            <>
              {status.picture && <img src={status.picture} alt="" className="li-avatar" />}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{status.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{status.email}</div>
              </div>
              <button className="btn-ghost" onClick={disconnect}>Desconectar</button>
            </>
          ) : (
            <a className="btn-primary" href="/api/linkedin/auth">
              Conectar LinkedIn
            </a>
          )}
        </div>
      </header>

      {feedback && <div className="li-banner">{feedback}</div>}

      <div className="li-main">
        <section className="li-composer" ref={composerRef}>
          <h2 className="li-h2">Crear post</h2>

          <div className="li-row">
            <label className="li-label">Brief / prompt para la IA</label>
            <textarea
              className="li-textarea"
              rows={3}
              placeholder="Ej: post sobre cómo el outbound bien hecho cierra más que el inbound — tono provocador, cierre con pregunta"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button className="btn-ghost" onClick={generateText} disabled={!prompt.trim() || drafting}>
              {drafting ? "Generando…" : "✨ Generar con IA"}
            </button>
          </div>

          <div className="li-row">
            <label className="li-label">Texto del post</label>
            <textarea
              className="li-textarea"
              rows={10}
              placeholder="Escribe o genera con IA arriba…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              {text.length} caracteres (LinkedIn permite hasta 3000)
            </div>
          </div>

          <div className="li-row">
            <label className="li-label">Imagen (opcional)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setImageFile(f);
                  setImagePreviewUrl(f ? URL.createObjectURL(f) : null);
                }}
                style={{ flex: 1, fontSize: 12 }}
              />
              {imageFile && (
                <button
                  className="btn-ghost-sm"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreviewUrl(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  title="Quitar imagen"
                >
                  Quitar
                </button>
              )}
            </div>
            {imagePreviewUrl && (
              <ImagePreview url={imagePreviewUrl} />
            )}

            <div style={{ marginTop: 10 }}>
              <button
                className="btn-primary"
                onClick={() => generateImage(true)}
                disabled={generatingImage || !text.trim()}
                style={{ width: "100%", marginBottom: 8 }}
              >
                {generatingImage ? "Generando…" : "✨ Generar imagen del post"}
              </button>
              <input
                className="li-input"
                style={{ width: "100%", marginBottom: 6 }}
                placeholder="(opcional) guía adicional: estilo, color, mood…"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
              />
              <button
                className="btn-ghost-sm"
                onClick={() => generateImage(false)}
                disabled={generatingImage || !imagePrompt.trim()}
              >
                Usar solo lo de arriba como prompt manual
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
              Claude lee el post → construye image prompt cinematográfico → DALL-E 3 lo dibuja.<br />
              Coste ~$0.04/imagen. Requiere OPENAI_API_KEY.
            </div>
          </div>

          <div className="li-row li-row-inline">
            <div style={{ flex: 1 }}>
              <label className="li-label">Programar (opcional)</label>
              <input
                type="datetime-local"
                className="li-input"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="li-actions">
              <button
                className="btn-ghost"
                onClick={() => savePost(false)}
                disabled={!text.trim() || saving}
              >
                {scheduledAt ? "Programar" : "Guardar borrador"}
              </button>
              <button
                className="btn-primary"
                onClick={() => savePost(true)}
                disabled={!text.trim() || saving || !status?.connected}
              >
                {saving ? "Publicando…" : "Publicar ahora"}
              </button>
            </div>
          </div>
          {!status?.connected && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
              Para publicar, conecta tu cuenta de LinkedIn arriba.
            </div>
          )}
        </section>

        <aside className="li-side">
          <div className="li-tabs">
            <button
              className={`li-tab ${view === "calendar" ? "active" : ""}`}
              onClick={() => setView("calendar")}
            >
              📅 Calendario
            </button>
            <button
              className={`li-tab ${view === "list" ? "active" : ""}`}
              onClick={() => setView("list")}
            >
              📋 Lista ({posts.length})
            </button>
            <button
              className={`li-tab ${view === "skills" ? "active" : ""}`}
              onClick={() => setView("skills")}
            >
              ⚙️ Skills
            </button>
          </div>

          {view === "calendar" && (
            <section className="li-card li-cal-card">
              <div className="li-cal-header">
                <button className="li-cal-nav" onClick={() => changeMonth(-1)}>‹</button>
                <div className="li-cal-month">{monthLabel}</div>
                <button className="li-cal-nav" onClick={() => changeMonth(1)}>›</button>
                <button
                  className="btn-primary"
                  style={{ marginLeft: "auto", fontSize: 12.5 }}
                  onClick={() => setPlanOpen(true)}
                >
                  ✨ Planificar mes con IA
                </button>
              </div>
              <div className="li-cal-weekdays">
                {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map((d) => (
                  <div key={d} className="li-cal-wk">{d}</div>
                ))}
              </div>
              <div className="li-cal-grid">
                {buildMonthGrid(calMonth).map((d, i) => {
                  const k = dayKey(d);
                  const dayPosts = postsByDay.get(k) ?? [];
                  const isOtherMonth = d.getMonth() !== calMonth.getMonth();
                  const isToday = k === today;
                  return (
                    <div
                      key={i}
                      className={`li-cal-day ${isOtherMonth ? "li-cal-day--other" : ""} ${isToday ? "li-cal-day--today" : ""}`}
                      onClick={() => clickDay(d)}
                      title="Click para programar un post este día"
                    >
                      <div className="li-cal-day-num">{d.getDate()}</div>
                      <div className="li-cal-day-posts">
                        {dayPosts.map((p) => (
                          <div
                            key={p.id}
                            className={`li-cal-chip li-cal-chip-${p.status}`}
                            onClick={(e) => clickPostChip(p, e)}
                            title={p.text.slice(0, 80)}
                          >
                            <span className="li-cal-chip-time">
                              {p.scheduled_at
                                ? new Date(p.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : ""}
                            </span>
                            <span className="li-cal-chip-text">{p.text.slice(0, 28)}{p.text.length > 28 ? "…" : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="li-cal-legend">
                <span><span className="li-dot li-dot-scheduled" /> programado</span>
                <span><span className="li-dot li-dot-published" /> publicado</span>
                <span><span className="li-dot li-dot-failed" /> falló</span>
                <span><span className="li-dot li-dot-draft" /> borrador</span>
              </div>
            </section>
          )}

          {view === "list" && (
            <section className="li-card">
              <h2 className="li-h2">Posts ({posts.length})</h2>
              <div className="li-posts">
                {posts.length === 0 ? (
                  <div className="list-empty">Sin posts todavía.</div>
                ) : (
                  posts.map((p) => (
                    <div key={p.id} className={`li-post li-post-${p.status}`}>
                      <div className="li-post-head">
                        <span className={`li-badge li-badge-${p.status}`}>{p.status}</span>
                        <span className="li-post-when">{fmtWhen(p)}</span>
                      </div>
                      <div className="li-post-text">{p.text.slice(0, 220)}{p.text.length > 220 ? "…" : ""}</div>
                      {p.image_path && <div className="li-post-img">📎 imagen adjunta</div>}
                      {p.error && <div className="li-post-err">{p.error.slice(0, 200)}</div>}
                      <div className="li-post-actions">
                        {(p.status === "draft" || p.status === "scheduled" || p.status === "failed") && (
                          <button className="btn-ghost-sm" onClick={() => publishExisting(p.id)} disabled={saving}>
                            Publicar ahora
                          </button>
                        )}
                        <button className="btn-ghost-sm" onClick={() => openEditor(p)}>Editar</button>
                        <button className="btn-ghost-sm" onClick={() => deletePost(p.id)}>Borrar</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {view === "skills" && (
            <section className="li-card">
              <h2 className="li-h2">Skills de LinkedIn</h2>
              <div className="memory-add">
                <input
                  placeholder="Pega link o owner/repo@skill"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") installSkillLI(); }}
                />
                <button
                  className="btn-primary"
                  onClick={installSkillLI}
                  disabled={installingSkill || !skillInput.trim()}
                >
                  {installingSkill ? "Descargando…" : "Descargar skill"}
                </button>
                {skillFeedback && (
                  <div style={{
                    fontSize: 12,
                    color: skillFeedback.startsWith("✓") ? "#22c55e" : "var(--text-dim)",
                    padding: "6px 0",
                  }}>{skillFeedback}</div>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "0 0 12px", lineHeight: 1.5 }}>
                Estas skills se usan SOLO en LinkedIn (independientes de campañas).<br />
                Sugerencia: <code>coreyhaines31/marketingskills@linkedin-content</code>
              </div>
              <div className="li-skills">
                {skills.length === 0 ? (
                  <div className="list-empty">Aún no hay skills en este módulo. Descarga la primera arriba.</div>
                ) : (
                  skills.map((s) => (
                    <div key={s.name} className="li-skill" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="li-skill-name">{s.name}</div>
                        <div className="li-skill-desc">{s.description}</div>
                      </div>
                      <button
                        className="btn-ghost-sm"
                        onClick={() => removeSkillFromLI(s.name)}
                        title="Quitar del módulo de LinkedIn"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </aside>
      </div>

      {credsOpen && (
        <div className="modal-backdrop" onClick={() => !credsSaving && setCredsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">API keys</div>
                <div className="modal-sub">Las claves se guardan en <code>data/credentials.json</code> y sustituyen al .env.local sin reiniciar.</div>
              </div>
              {!credsSaving && <button className="modal-close" onClick={() => setCredsOpen(false)}>×</button>}
            </div>
            <div className="modal-body">
              {[
                { key: "OPENAI_API_KEY", label: "OpenAI (DALL-E imágenes)", placeholder: "sk-proj-..." },
                { key: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)", placeholder: "sk-ant-api03-..." },
                { key: "INSTANTLY_API_KEY", label: "Instantly", placeholder: "base64 token" },
                { key: "LINKEDIN_CLIENT_ID", label: "LinkedIn Client ID", placeholder: "" },
                { key: "LINKEDIN_CLIENT_SECRET", label: "LinkedIn Client Secret", placeholder: "" },
              ].map(({ key, label, placeholder }) => {
                const cur = credsStatus[key];
                return (
                  <div key={key} className="li-row">
                    <label className="li-label">
                      {label}
                      {cur?.configured && (
                        <span style={{ color: "#22c55e", marginLeft: 8, fontWeight: 600 }}>✓ configurada</span>
                      )}
                    </label>
                    <input
                      className="li-input"
                      type="password"
                      placeholder={cur?.configured ? cur.masked : placeholder}
                      value={credsForm[key] ?? ""}
                      onChange={(e) => setCredsForm((f) => ({ ...f, [key]: e.target.value }))}
                    />
                    {cur?.configured && !credsForm[key] && (
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        Vacío = mantener actual. Escribe para reemplazar.
                      </div>
                    )}
                  </div>
                );
              })}

              {credsFeedback && (
                <div
                  style={{
                    fontSize: 13,
                    padding: 10,
                    borderRadius: 8,
                    background: credsFeedback.startsWith("✓") ? "#0d2818" : "#2c1010",
                    color: credsFeedback.startsWith("✓") ? "#6ee7b7" : "#f87171",
                  }}
                >
                  {credsFeedback}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  className="btn-primary"
                  onClick={saveCreds}
                  disabled={credsSaving || Object.values(credsForm).every((v) => !v?.trim())}
                >
                  {credsSaving ? "Guardando…" : "Guardar"}
                </button>
                <button className="btn-ghost" onClick={() => setCredsOpen(false)} disabled={credsSaving}>
                  Cerrar
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12 }}>
                Las claves nunca salen de tu máquina. Para OpenAI: créala en <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>platform.openai.com</a> con $5+ de saldo.
              </div>
            </div>
          </div>
        </div>
      )}

      {planOpen && (
        <div className="modal-backdrop" onClick={() => !planRunning && setPlanOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Planificar mes con IA</div>
                <div className="modal-sub">{monthLabel}</div>
              </div>
              {!planRunning && (
                <button className="modal-close" onClick={() => setPlanOpen(false)}>×</button>
              )}
            </div>
            <div className="modal-body">
              <div className="li-row">
                <label className="li-label">Días de la semana</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { iso: 1, lbl: "Lun" },
                    { iso: 2, lbl: "Mar" },
                    { iso: 3, lbl: "Mié" },
                    { iso: 4, lbl: "Jue" },
                    { iso: 5, lbl: "Vie" },
                    { iso: 6, lbl: "Sáb" },
                    { iso: 7, lbl: "Dom" },
                  ].map((d) => {
                    const active = planForm.daysOfWeek.includes(d.iso);
                    return (
                      <button
                        key={d.iso}
                        onClick={() => toggleDay(d.iso)}
                        className="btn-ghost-sm"
                        style={{
                          background: active ? "var(--accent)" : "transparent",
                          color: active ? "white" : "var(--text-dim)",
                          borderColor: active ? "var(--accent)" : "var(--border)",
                          padding: "6px 12px",
                        }}
                      >
                        {d.lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="li-row li-row-inline">
                <div style={{ flex: 1 }}>
                  <label className="li-label">Hora de publicación</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="li-input"
                      style={{ width: 80 }}
                      type="number"
                      min={0}
                      max={23}
                      value={planForm.hour}
                      onChange={(e) => setPlanForm((f) => ({ ...f, hour: Number(e.target.value) }))}
                    />
                    <span style={{ alignSelf: "center" }}>:</span>
                    <input
                      className="li-input"
                      style={{ width: 80 }}
                      type="number"
                      min={0}
                      max={59}
                      value={planForm.minute}
                      onChange={(e) => setPlanForm((f) => ({ ...f, minute: Number(e.target.value) }))}
                    />
                  </div>
                </div>
              </div>

              <div className="li-row">
                <label className="li-label">Briefs / temas (opcional)</label>
                <textarea
                  className="li-textarea"
                  rows={4}
                  placeholder="Ej: 1 post sobre por qué falla el outbound. 1 sobre cómo elegir un nicho. 1 sobre métricas que importan en lead gen. (Si lo dejas vacío, la IA decide la mezcla.)"
                  value={planForm.briefs}
                  onChange={(e) => setPlanForm((f) => ({ ...f, briefs: e.target.value }))}
                />
              </div>

              <div className="li-row">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={planForm.generate_images}
                    onChange={(e) => setPlanForm((f) => ({ ...f, generate_images: e.target.checked }))}
                  />
                  <span>Generar también una imagen IA para cada post (DALL-E)</span>
                </label>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 24 }}>
                  Coste extra ~$0.04/imagen. Requiere OPENAI_API_KEY.
                </div>
              </div>

              {planResult && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 10,
                    fontSize: 13,
                    borderRadius: 8,
                    background: planResult.startsWith("✓") ? "#0d2818" : "#2c1010",
                    color: planResult.startsWith("✓") ? "#6ee7b7" : "#f87171",
                  }}
                >
                  {planResult}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  className="btn-primary"
                  disabled={planRunning || planForm.daysOfWeek.length === 0}
                  onClick={runMonthPlan}
                >
                  {planRunning
                    ? planForm.generate_images
                      ? "Generando posts e imágenes (puede tardar 2-4 min)…"
                      : "Generando plan…"
                    : "Generar plan y crear posts"}
                </button>
                {!planRunning && (
                  <button className="btn-ghost" onClick={() => setPlanOpen(false)}>
                    Cerrar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {openPost && (
        <div className="modal-backdrop" onClick={() => !editSaving && closeEditor()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Editar post</div>
                <div className="modal-sub">
                  <span className={`li-badge li-badge-${openPost.status}`}>{openPost.status}</span>
                  {" · "}{fmtWhen(openPost)}
                </div>
              </div>
              {!editSaving && <button className="modal-close" onClick={closeEditor}>×</button>}
            </div>
            <div className="modal-body">
              {/* Texto */}
              <div className="li-row">
                <label className="li-label">Texto del post</label>
                <textarea
                  className="li-textarea"
                  rows={10}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {editText.length} / 3000 caracteres
                </div>
              </div>

              {/* Programación */}
              <div className="li-row">
                <label className="li-label">Fecha y hora programada</label>
                <input
                  type="datetime-local"
                  className="li-input"
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  Vacío = mover a borrador (no se publica solo)
                </div>
              </div>

              {/* Imagen */}
              <div className="li-row">
                <label className="li-label">Imagen</label>
                {editImagePreview && !editRemoveImage && (
                  <div style={{ position: "relative", marginBottom: 8 }}>
                    <ImagePreview url={editImagePreview} />
                    <button
                      className="btn-ghost-sm"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setEditImagePreview(null);
                        setEditImageFile(null);
                        setEditRemoveImage(true);
                        if (editFileRef.current) editFileRef.current.value = "";
                      }}
                    >
                      Quitar imagen
                    </button>
                  </div>
                )}
                {(!editImagePreview || editRemoveImage) && (
                  <>
                    <input
                      ref={editFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        if (f) {
                          setEditImageFile(f);
                          setEditImagePreview(URL.createObjectURL(f));
                          setEditRemoveImage(false);
                        }
                      }}
                    />
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="btn-primary"
                        onClick={() => generateImageInEditor(true)}
                        disabled={editGeneratingImg || !editText.trim()}
                        style={{ width: "100%", marginBottom: 8 }}
                      >
                        {editGeneratingImg ? "Generando…" : "✨ Generar imagen del post"}
                      </button>
                      <input
                        className="li-input"
                        style={{ width: "100%", marginBottom: 6 }}
                        placeholder="(opcional) guía adicional: estilo, color, mood…"
                        value={editImagePrompt}
                        onChange={(e) => setEditImagePrompt(e.target.value)}
                      />
                      <button
                        className="btn-ghost-sm"
                        onClick={() => generateImageInEditor(false)}
                        disabled={editGeneratingImg || !editImagePrompt.trim()}
                      >
                        Usar solo lo de arriba como prompt manual
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                      Claude lee el post → genera image prompt cinematográfico → DALL-E 3 lo dibuja.<br />
                      Coste ~$0.04/imagen. Requiere OPENAI_API_KEY.
                    </div>
                  </>
                )}
              </div>

              {openPost.error && (
                <div style={{ marginTop: 8, color: "var(--error)", fontSize: 12, padding: 8, background: "#2c1010", borderRadius: 8 }}>
                  Último error: {openPost.error.slice(0, 240)}
                </div>
              )}
              {openPost.linkedin_post_urn && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)" }}>
                  URN: {openPost.linkedin_post_urn}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={saveEditor}
                  disabled={editSaving || !editText.trim()}
                >
                  {editSaving ? "Guardando…" : "Guardar cambios"}
                </button>
                {(openPost.status === "draft" || openPost.status === "scheduled" || openPost.status === "failed") && (
                  <button
                    className="btn-ghost"
                    onClick={async () => {
                      await saveEditor();
                      await publishExisting(openPost.id);
                      closeEditor();
                    }}
                    disabled={editSaving}
                  >
                    Guardar y publicar ahora
                  </button>
                )}
                <button
                  className="btn-ghost"
                  style={{ marginLeft: "auto", color: "var(--error)" }}
                  onClick={async () => {
                    if (!confirm("¿Borrar este post?")) return;
                    await deletePost(openPost.id);
                    closeEditor();
                  }}
                  disabled={editSaving}
                >
                  Borrar post
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/* ─── Componente de preview de imagen con fallback ──────────────────────── */
function ImagePreview({ url }: { url: string }) {
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  if (error) {
    return (
      <div style={{
        marginTop: 8,
        padding: "20px 16px",
        background: "var(--bg-elev-2)",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        textAlign: "center",
        fontSize: 12.5,
        color: "var(--text-dim)",
      }}>
        ⚠️ La imagen no se pudo cargar.
        <button
          onClick={() => { setError(false); setRetryKey(k => k + 1); }}
          style={{
            display: "inline-block",
            marginLeft: 8,
            padding: "4px 10px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <img
      key={retryKey}
      src={url}
      alt="preview"
      onError={() => setError(true)}
      style={{
        marginTop: 8,
        maxWidth: "100%",
        maxHeight: 200,
        borderRadius: 8,
        border: "1px solid var(--border)",
        objectFit: "contain",
        background: "var(--bg-elev-2)",
        display: "block",
      }}
    />
  );
}
