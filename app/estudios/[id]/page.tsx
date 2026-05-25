"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

/* ───── Tipos (mirror de lib/estudios.ts) ───── */

type ElementBase = { id: string; x: number; y: number; z: number };
type NoteEl = ElementBase & { type: "note"; width: number; height: number; text: string; color: string };
type TextEl = ElementBase & { type: "text"; text: string; fontSize: number; color: string };
type ImageEl = ElementBase & { type: "image"; width: number; height: number; src_key: string };
type ShapeKind = "rect" | "circle" | "diamond" | "triangle";
type ShapeEl = ElementBase & { type: "shape"; shape: ShapeKind; width: number; height: number; fill: string; stroke: string };
type Side = "top" | "right" | "bottom" | "left";
type ArrowEl = ElementBase & {
  type: "arrow";
  endX: number; endY: number;
  stroke: string;
  fromId?: string; toId?: string;
  fromSide?: Side; toSide?: Side;
};
type Element = NoteEl | TextEl | ImageEl | ShapeEl | ArrowEl;

type Estudio = {
  id: string;
  title: string;
  elements: Element[];
  viewport: { x: number; y: number; zoom: number };
  created_at: string;
  updated_at: string;
};

/* ───── Constantes ───── */

const NOTE_COLORS = ["#fef3c7", "#fce7f3", "#dbeafe", "#dcfce7", "#fed7aa", "#e9d5ff", "#fff"];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

function uid() {
  return Math.random().toString(36).slice(2, 12);
}

/* ───── Componente principal ───── */

export default function EstudioCanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;

  const [estudio, setEstudio] = useState<Estudio | null>(null);
  const [loading, setLoading] = useState(true);
  const [elements, setElements] = useState<Element[]>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const [title, setTitle] = useState("");

  // Drag state
  const dragRef = useRef<{ id: string; startMouseX: number; startMouseY: number; startElX: number; startElY: number } | null>(null);
  const panRef = useRef<{ startMouseX: number; startMouseY: number; startViewX: number; startViewY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Estado de creación de conexión: cuando el usuario arrastra desde un handle
  const [connecting, setConnecting] = useState<{
    fromId: string;
    fromSide: Side;
    fromPoint: { x: number; y: number };
    mousePoint: { x: number; y: number }; // world coords
    hoverElId?: string;
    hoverSide?: Side;
  } | null>(null);

  // Hover sobre elementos para mostrar handles
  const [hoverElId, setHoverElId] = useState<string | null>(null);

  // Shape picker que aparece al soltar una conexión en zona vacía
  const [shapePicker, setShapePicker] = useState<{
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
    fromId: string;
    fromSide: Side;
  } | null>(null);

  /* ───── Load ───── */
  useEffect(() => {
    if (!id) return;
    (async () => {
      const r = await fetch(`/api/estudios/${id}`);
      if (!r.ok) { router.push("/estudios"); return; }
      const d = await r.json();
      setEstudio(d.estudio);
      setElements(d.estudio.elements || []);
      setViewport(d.estudio.viewport || { x: 0, y: 0, zoom: 1 });
      setTitle(d.estudio.title || "");
      setLoading(false);
    })();
  }, [id, router]);

  /* ───── Autosave debounced ───── */
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const persist = useCallback(async (patch: Partial<Estudio>) => {
    setSaveStatus("saving");
    try {
      await fetch(`/api/estudios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("dirty");
    }
  }, [id]);

  const scheduleSave = useCallback((patch: Partial<Estudio>) => {
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(patch), 800);
  }, [persist]);

  // Persist elements on change
  useEffect(() => {
    if (loading) return;
    scheduleSave({ elements });
  }, [elements, loading, scheduleSave]);

  // Persist viewport on change (less aggressive)
  const viewportSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (loading) return;
    if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
    viewportSaveTimerRef.current = setTimeout(() => persist({ viewport }), 1500);
  }, [viewport, loading, persist]);

  /* ───── Coord transform helpers ───── */
  function screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - viewport.x) / viewport.zoom,
      y: (sy - viewport.y) / viewport.zoom,
    };
  }

  /* ───── Add elements ───── */
  function addNote(x?: number, y?: number) {
    const cx = canvasRef.current?.clientWidth ?? 800;
    const cy = canvasRef.current?.clientHeight ?? 600;
    const center = screenToWorld(x ?? cx / 2, y ?? cy / 2);
    const newEl: NoteEl = {
      id: uid(), type: "note",
      x: center.x - 90, y: center.y - 60,
      z: nextZ(),
      width: 180, height: 120,
      text: "",
      color: NOTE_COLORS[Math.floor(Math.random() * (NOTE_COLORS.length - 1))],
    };
    setElements((arr) => [...arr, newEl]);
    setSelectedId(newEl.id);
    setEditingId(newEl.id);
  }

  function addText() {
    const cx = canvasRef.current?.clientWidth ?? 800;
    const cy = canvasRef.current?.clientHeight ?? 600;
    const c = screenToWorld(cx / 2, cy / 2);
    const newEl: TextEl = {
      id: uid(), type: "text",
      x: c.x, y: c.y,
      z: nextZ(),
      text: "Texto",
      fontSize: 20,
      color: "#0f172a",
    };
    setElements((arr) => [...arr, newEl]);
    setSelectedId(newEl.id);
    setEditingId(newEl.id);
  }

  function addShape(shape: ShapeKind) {
    const cx = canvasRef.current?.clientWidth ?? 800;
    const cy = canvasRef.current?.clientHeight ?? 600;
    const c = screenToWorld(cx / 2, cy / 2);
    const newEl: ShapeEl = {
      id: uid(), type: "shape", shape,
      x: c.x - 80, y: c.y - 60,
      z: nextZ(),
      width: 160, height: 120,
      fill: "rgba(0,113,227,0.08)",
      stroke: "#0071e3",
    };
    setElements((arr) => [...arr, newEl]);
    setSelectedId(newEl.id);
  }

  function nextZ() {
    return elements.length > 0 ? Math.max(...elements.map((e) => e.z || 0)) + 1 : 1;
  }

  /** Crea un elemento del tipo elegido en el shape picker y dibuja la flecha
   *  desde el elemento origen al nuevo. Cierra el picker. */
  function createFromPicker(kind: "note" | "text" | "rect" | "circle" | "diamond" | "triangle") {
    if (!shapePicker) return;
    const { worldX, worldY, fromId, fromSide } = shapePicker;
    let newEl: Element;
    if (kind === "note") {
      const w = 180, h = 120;
      newEl = {
        id: uid(), type: "note",
        x: worldX, y: worldY - h / 2,
        z: nextZ(),
        width: w, height: h,
        text: "",
        color: NOTE_COLORS[Math.floor(Math.random() * (NOTE_COLORS.length - 1))],
      };
    } else if (kind === "text") {
      newEl = {
        id: uid(), type: "text",
        x: worldX, y: worldY,
        z: nextZ(),
        text: "Texto",
        fontSize: 20,
        color: "#0f172a",
      };
    } else {
      const w = 160, h = 120;
      newEl = {
        id: uid(), type: "shape", shape: kind as ShapeKind,
        x: worldX, y: worldY - h / 2,
        z: nextZ(),
        width: w, height: h,
        fill: "rgba(0,113,227,0.08)",
        stroke: "#0071e3",
      };
    }
    // Calcular el side opuesto al fromSide para que la flecha llegue al lado
    // más natural del elemento nuevo (top↔bottom, left↔right).
    const oppositeSide: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    const toSide = oppositeSide[fromSide];
    // Ajustar la posición del nuevo elemento para que su lado de entrada
    // quede ALINEADO con la salida del origen — la flecha sale recta.
    const fromEl = elements.find((e) => e.id === fromId);
    if (fromEl && (newEl.type === "note" || newEl.type === "shape")) {
      const fromPt = anchorPoint(fromEl, fromSide);
      // El bbox del nuevo elemento debe quedar tal que anchorPoint(new, toSide)
      // esté a una distancia mínima del fromPt, ofset proporcional.
      const w = (newEl as any).width as number;
      const h = (newEl as any).height as number;
      const margin = 80;
      if (toSide === "left")   { newEl.x = fromPt.x + margin;        newEl.y = fromPt.y - h / 2; }
      if (toSide === "right")  { newEl.x = fromPt.x - margin - w;    newEl.y = fromPt.y - h / 2; }
      if (toSide === "top")    { newEl.x = fromPt.x - w / 2;          newEl.y = fromPt.y + margin; }
      if (toSide === "bottom") { newEl.x = fromPt.x - w / 2;          newEl.y = fromPt.y - margin - h; }
    }
    const arrow: ArrowEl = {
      id: uid(), type: "arrow",
      x: 0, y: 0, endX: 0, endY: 0, // resueltos dinámicamente
      z: nextZ(),
      stroke: "#0f172a",
      fromId, fromSide,
      toId: newEl.id, toSide,
    };
    setElements((arr) => [...arr, newEl, arrow]);
    setSelectedId(newEl.id);
    if (kind === "note" || kind === "text") setEditingId(newEl.id);
    setShapePicker(null);
  }

  /** Calcula la BBox de un elemento en coords de mundo (x, y, w, h). */
  function bbox(el: Element): { x: number; y: number; w: number; h: number } {
    if (el.type === "note" || el.type === "image" || el.type === "shape") {
      return { x: el.x, y: el.y, w: el.width, h: el.height };
    }
    if (el.type === "text") {
      // Aproximación; el texto no tiene width definido — usamos longitud * fontSize.
      const w = Math.max(100, (el.text || "Texto").length * el.fontSize * 0.6);
      return { x: el.x, y: el.y, w, h: el.fontSize * 1.5 };
    }
    return { x: el.x, y: el.y, w: 1, h: 1 };
  }

  /** Punto de anclaje en un lado del bbox (centro de ese lado). */
  function anchorPoint(el: Element, side: Side): { x: number; y: number } {
    const b = bbox(el);
    switch (side) {
      case "top":    return { x: b.x + b.w / 2, y: b.y };
      case "right":  return { x: b.x + b.w,     y: b.y + b.h / 2 };
      case "bottom": return { x: b.x + b.w / 2, y: b.y + b.h };
      case "left":   return { x: b.x,           y: b.y + b.h / 2 };
    }
  }

  /** Dado un punto de mundo y un elemento, devuelve el side más cercano (top/right/bottom/left). */
  function nearestSide(el: Element, p: { x: number; y: number }): Side {
    const b = bbox(el);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "bottom" : "top";
  }

  /** Resuelve los puntos final del arrow al renderizar:
   *  - Si tiene fromId, usa anchorPoint(elementoFrom, fromSide)
   *  - Si tiene toId, usa anchorPoint(elementoTo, toSide)
   *  - Si no, usa (x,y) y (endX,endY) directos.
   */
  function resolveArrow(a: ArrowEl): { from: { x: number; y: number }; to: { x: number; y: number } } {
    let from = { x: a.x, y: a.y };
    let to = { x: a.endX, y: a.endY };
    if (a.fromId) {
      const ref = elements.find((e) => e.id === a.fromId);
      if (ref) from = anchorPoint(ref, a.fromSide || "right");
    }
    if (a.toId) {
      const ref = elements.find((e) => e.id === a.toId);
      if (ref) to = anchorPoint(ref, a.toSide || "left");
    }
    return { from, to };
  }

  /** Empieza arrastrar desde un handle de conexión. */
  function startConnect(e: React.MouseEvent, el: Element, side: Side) {
    e.stopPropagation();
    const pt = anchorPoint(el, side);
    setConnecting({
      fromId: el.id,
      fromSide: side,
      fromPoint: pt,
      mousePoint: pt,
    });
  }

  /** Mientras conecto, actualizo el punto del ratón en coords de mundo. */
  useEffect(() => {
    if (!connecting) return;
    function onMove(e: MouseEvent) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = { x: (sx - viewport.x) / viewport.zoom, y: (sy - viewport.y) / viewport.zoom };

      // Detectar si pasa por encima de algún elemento (excepto el origen)
      let hoverElId: string | undefined;
      let hoverSide: Side | undefined;
      for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el.id === connecting!.fromId) continue;
        if (el.type === "arrow") continue;
        const b = bbox(el);
        if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) {
          hoverElId = el.id;
          hoverSide = nearestSide(el, world);
          break;
        }
      }
      setConnecting((c) => c ? { ...c, mousePoint: world, hoverElId, hoverSide } : null);
    }
    function onUp(ev: MouseEvent) {
      setConnecting((c) => {
        if (!c) return null;
        // Si soltó SOBRE un elemento → crear flecha conectada de A a B.
        if (c.hoverElId && c.hoverSide) {
          const newArrow: ArrowEl = {
            id: uid(), type: "arrow",
            x: c.fromPoint.x, y: c.fromPoint.y,
            endX: c.mousePoint.x, endY: c.mousePoint.y,
            z: nextZ(),
            stroke: "#0f172a",
            fromId: c.fromId, fromSide: c.fromSide,
            toId: c.hoverElId, toSide: c.hoverSide,
          };
          setElements((arr) => [...arr, newArrow]);
        } else {
          // Soltó en VACÍO → abrir shape picker en esa posición. El usuario
          // elige qué crear y la flecha se traza al nuevo elemento.
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            setShapePicker({
              screenX: ev.clientX - rect.left,
              screenY: ev.clientY - rect.top,
              worldX: c.mousePoint.x,
              worldY: c.mousePoint.y,
              fromId: c.fromId,
              fromSide: c.fromSide,
            });
          }
        }
        return null;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connecting, viewport, elements]);

  async function uploadImageFile(file: File, dropX?: number, dropY?: number) {
    if (!file.type.startsWith("image/")) return;
    const ab = await file.arrayBuffer();
    const r = await fetch(`/api/estudios/${id}/upload-image`, {
      method: "POST",
      headers: { "x-mime": file.type, "Content-Type": "application/octet-stream" },
      body: ab,
    });
    const d = await r.json();
    if (!d.src_key) return;

    // Cargar para conocer dimensiones reales
    const img = new Image();
    img.onload = () => {
      const maxW = 400;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxW) { h = (h * maxW) / w; w = maxW; }
      const cx = canvasRef.current?.clientWidth ?? 800;
      const cy = canvasRef.current?.clientHeight ?? 600;
      const c = screenToWorld(dropX ?? cx / 2, dropY ?? cy / 2);
      const newEl: ImageEl = {
        id: uid(), type: "image",
        x: c.x - w / 2, y: c.y - h / 2,
        z: nextZ(),
        width: w, height: h,
        src_key: d.src_key,
      };
      setElements((arr) => [...arr, newEl]);
    };
    img.src = `/api/estudios/image/${d.src_key}`;
  }

  /* ───── Paste image desde portapapeles ───── */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (editingId) return; // si está editando texto, dejar paste normal
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            uploadImageFile(file);
            return;
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, viewport]);

  /* ───── Drop file ───── */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadImageFile(file, e.clientX, e.clientY);
  }

  /* ───── Pan ───── */
  function onCanvasMouseDown(e: React.MouseEvent) {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).dataset.canvasBg !== "1") {
      return;
    }
    setSelectedId(null);
    setEditingId(null);
    panRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startViewX: viewport.x,
      startViewY: viewport.y,
    };
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (panRef.current) {
        const dx = e.clientX - panRef.current.startMouseX;
        const dy = e.clientY - panRef.current.startMouseY;
        setViewport((v) => ({ ...v, x: panRef.current!.startViewX + dx, y: panRef.current!.startViewY + dy }));
        return;
      }
      if (dragRef.current) {
        const dx = (e.clientX - dragRef.current.startMouseX) / viewport.zoom;
        const dy = (e.clientY - dragRef.current.startMouseY) / viewport.zoom;
        const did = dragRef.current.id;
        setElements((arr) => arr.map((el) => el.id === did ? { ...el, x: dragRef.current!.startElX + dx, y: dragRef.current!.startElY + dy } : el));
      }
    }
    function onUp() {
      panRef.current = null;
      dragRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [viewport.zoom]);

  /* ───── Zoom (wheel) ───── */
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));
    // Zoom alrededor del cursor
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = (mx - viewport.x) / viewport.zoom;
    const worldY = (my - viewport.y) / viewport.zoom;
    setViewport({
      zoom: newZoom,
      x: mx - worldX * newZoom,
      y: my - worldY * newZoom,
    });
  }

  /* ───── Selección + Delete ───── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editingId) return;
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.contentEditable === "true") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        setElements((arr) => arr.filter((el) => el.id !== selectedId));
        setSelectedId(null);
      }
      if (e.key === "Escape") {
        setShapePicker(null);
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, selectedId]);

  /* ───── Drag de elementos ───── */
  function startDragElement(e: React.MouseEvent, el: Element) {
    e.stopPropagation();
    setSelectedId(el.id);
    dragRef.current = {
      id: el.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startElX: el.x,
      startElY: el.y,
    };
  }

  /* ───── Patch element ───── */
  function patchElement(elId: string, patch: Partial<Element>) {
    setElements((arr) => arr.map((el) => el.id === elId ? ({ ...el, ...patch } as Element) : el));
  }

  /* ───── Rename estudio ───── */
  async function saveTitle() {
    if (title.trim() && title !== estudio?.title) {
      await persist({ title: title.trim() });
      setEstudio((e) => e ? { ...e, title: title.trim() } : e);
    }
  }

  /* ───── Render ───── */
  if (loading || !estudio) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#64748b" }}>
        Cargando estudio…
      </div>
    );
  }

  const selected = elements.find((el) => el.id === selectedId);

  return (
    <div style={{
      position: "fixed", inset: 0,
      fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
      background: "#f8fafc",
      overflow: "hidden",
    }}>
      {/* Topbar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: 52,
        background: "rgba(255,255,255,0.95)",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", padding: "0 16px",
        zIndex: 10,
      }}>
        <Link href="/estudios" style={{ color: "#0071e3", fontSize: 13.5, textDecoration: "none", marginRight: 16, fontWeight: 500 }}>← Estudios</Link>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          style={{
            background: "transparent",
            border: "1px solid transparent",
            fontSize: 15, fontWeight: 600,
            color: "#0f172a", letterSpacing: "-0.01em",
            padding: "5px 8px",
            borderRadius: 6,
            outline: "none",
            fontFamily: "inherit",
            minWidth: 200,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,113,227,0.3)"; e.currentTarget.style.background = "#fff"; }}
          onBlurCapture={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
        />
        <div style={{ flex: 1 }} />
        <div style={{
          fontSize: 11.5, color: saveStatus === "saved" ? "#16a34a" : saveStatus === "saving" ? "#0071e3" : "#d97706",
          padding: "4px 10px", borderRadius: 99,
          background: saveStatus === "saved" ? "rgba(34,197,94,0.08)" : saveStatus === "saving" ? "rgba(0,113,227,0.08)" : "rgba(245,158,11,0.08)",
          fontWeight: 600,
        }}>
          {saveStatus === "saved" ? "✓ Guardado" : saveStatus === "saving" ? "⟳ Guardando…" : "● Cambios sin guardar"}
        </div>
      </div>

      {/* Toolbar lateral — diseño refinado tipo Miro */}
      <div style={{
        position: "absolute", top: 80, left: 16,
        background: "rgba(255,255,255,0.96)",
        border: "1px solid rgba(15,23,42,0.06)",
        borderRadius: 14,
        padding: 6,
        display: "flex", flexDirection: "column", gap: 2,
        boxShadow: "0 8px 24px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.04)",
        backdropFilter: "blur(12px)",
        zIndex: 9,
      }}>
        <ToolBtn iconSvg={<IconNote />} label="Nota adhesiva" onClick={() => addNote()} />
        <ToolBtn iconSvg={<IconText />} label="Texto" onClick={addText} />
        <ToolBtn iconSvg={<IconRect />} label="Rectángulo" onClick={() => addShape("rect")} />
        <ToolBtn iconSvg={<IconCircle />} label="Círculo" onClick={() => addShape("circle")} />
        <ToolBtn iconSvg={<IconDiamond />} label="Rombo" onClick={() => addShape("diamond")} />
        <ToolBtn iconSvg={<IconTriangle />} label="Triángulo" onClick={() => addShape("triangle")} />
        <ToolBtn iconSvg={<IconImage />} label="Imagen" onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => { if (input.files?.[0]) uploadImageFile(input.files[0]); };
          input.click();
        }} />
        <div style={{ height: 1, background: "rgba(15,23,42,0.08)", margin: "4px 6px" }} />
        <ToolBtn iconSvg={<IconMinus />} label="Reducir zoom" onClick={() => setViewport((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom * 0.9) }))} />
        <ToolBtn iconSvg={<IconPlus />} label="Aumentar zoom" onClick={() => setViewport((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.1) }))} />
        <ToolBtn iconSvg={<IconReset />} label="Centrar" onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })} />
      </div>

      {/* Inspector / acciones sobre elemento seleccionado */}
      {selected && (
        <div style={{
          position: "absolute", top: 76, right: 16,
          background: "#fff",
          border: "1px solid rgba(15,23,42,0.08)",
          borderRadius: 12,
          padding: 14,
          width: 220,
          boxShadow: "0 4px 16px rgba(15,23,42,0.06)",
          zIndex: 9,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
            {selected.type === "note" ? "Nota" :
              selected.type === "text" ? "Texto" :
              selected.type === "image" ? "Imagen" :
              selected.type === "shape" ? "Forma" : "Elemento"}
          </div>

          {selected.type === "note" && (
            <>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Color</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {NOTE_COLORS.map((c) => (
                  <button key={c} onClick={() => patchElement(selected.id, { color: c } as any)}
                    style={{ width: 24, height: 24, borderRadius: 6, background: c, border: (selected as NoteEl).color === c ? "2px solid #0071e3" : "1px solid rgba(15,23,42,0.12)", cursor: "pointer" }} />
                ))}
              </div>
            </>
          )}
          {selected.type === "text" && (
            <>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Tamaño</div>
              <input type="range" min={12} max={64} value={(selected as TextEl).fontSize}
                onChange={(e) => patchElement(selected.id, { fontSize: Number(e.target.value) } as any)}
                style={{ width: "100%", marginBottom: 10 }} />
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Color</div>
              <input type="color" value={(selected as TextEl).color}
                onChange={(e) => patchElement(selected.id, { color: e.target.value } as any)}
                style={{ width: "100%", height: 32, marginBottom: 10, border: "1px solid rgba(15,23,42,0.12)", borderRadius: 6, cursor: "pointer" }} />
            </>
          )}

          <button
            onClick={() => { setElements((arr) => arr.filter((el) => el.id !== selected.id)); setSelectedId(null); }}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(220,38,38,0.25)",
              borderRadius: 8,
              color: "#dc2626", fontSize: 12.5, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>🗑 Eliminar (Del)</button>
        </div>
      )}

      {/* Shape picker: aparece tras soltar una conexión en zona vacía */}
      {shapePicker && (
        <>
          {/* Overlay para cerrar al hacer click fuera */}
          <div
            onClick={() => setShapePicker(null)}
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
          />
          <div
            style={{
              position: "absolute",
              left: shapePicker.screenX,
              top: shapePicker.screenY + 52, // offset por la topbar
              transform: "translate(-50%, 12px)",
              background: "#fff",
              border: "1px solid rgba(15,23,42,0.08)",
              borderRadius: 14,
              padding: 14,
              boxShadow: "0 16px 40px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.06)",
              zIndex: 60,
              width: 240,
            }}
          >
            <div style={{
              fontSize: 11, fontWeight: 700,
              color: "#64748b", letterSpacing: "0.06em",
              textTransform: "uppercase", marginBottom: 10,
            }}>
              Crear y conectar
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              <PickerBtn label="Texto"      onClick={() => createFromPicker("text")}><IconText /></PickerBtn>
              <PickerBtn label="Nota"       onClick={() => createFromPicker("note")}><IconNote /></PickerBtn>
              <PickerBtn label="Rectángulo" onClick={() => createFromPicker("rect")}><IconRect /></PickerBtn>
              <PickerBtn label="Círculo"    onClick={() => createFromPicker("circle")}><IconCircle /></PickerBtn>
              <PickerBtn label="Rombo"      onClick={() => createFromPicker("diamond")}><IconDiamond /></PickerBtn>
              <PickerBtn label="Triángulo"  onClick={() => createFromPicker("triangle")}><IconTriangle /></PickerBtn>
            </div>
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: "1px solid rgba(15,23,42,0.06)",
              fontSize: 11, color: "#94a3b8", textAlign: "center",
            }}>
              Esc o click fuera para cancelar
            </div>
          </div>
        </>
      )}

      {/* Mini ayuda flotante */}
      <div style={{
        position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
        background: "rgba(15,23,42,0.85)", color: "#fff",
        padding: "6px 14px", borderRadius: 99,
        fontSize: 11, fontWeight: 500,
        zIndex: 9, letterSpacing: "0.02em",
        backdropFilter: "blur(8px)",
      }}>
        Arrastra fondo: pan · Rueda: zoom · Doble click nota: editar · Ctrl+V: pegar imagen · Del: borrar
      </div>

      {/* Zoom indicator */}
      <div style={{
        position: "absolute", bottom: 12, right: 12,
        background: "rgba(255,255,255,0.95)",
        border: "1px solid rgba(15,23,42,0.08)",
        padding: "6px 12px", borderRadius: 99,
        fontSize: 11.5, fontWeight: 600, color: "#475569",
        zIndex: 9,
      }}>
        {Math.round(viewport.zoom * 100)}%
      </div>

      {/* CANVAS */}
      <div
        ref={canvasRef}
        data-canvas-bg="1"
        onMouseDown={onCanvasMouseDown}
        onWheel={onWheel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{
          position: "absolute",
          top: 52, left: 0, right: 0, bottom: 0,
          overflow: "hidden",
          cursor: panRef.current ? "grabbing" : "grab",
          // Patrón de puntos de fondo (se transforma con el viewport)
          backgroundColor: "#f8fafc",
          backgroundImage: "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
          backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
      >
        {/* Capa de elementos transformada */}
        <div
          data-canvas-bg="1"
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "0 0",
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            pointerEvents: "none",
          }}
        >
          {/* SVG de flechas (siempre debajo, pero por encima del fondo) */}
          <svg
            style={{
              position: "absolute",
              left: -50000, top: -50000,
              width: 100000, height: 100000,
              overflow: "visible",
              pointerEvents: "none",
            }}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="#0f172a" />
              </marker>
              <marker id="arrowhead-blue" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="#0071e3" />
              </marker>
            </defs>
            {elements.filter((e) => e.type === "arrow").map((a) => {
              const arr = a as ArrowEl;
              const { from, to } = resolveArrow(arr);
              const isSelected = selectedId === arr.id;
              const sx = from.x + 50000, sy = from.y + 50000;
              const ex = to.x + 50000, ey = to.y + 50000;
              return (
                <g key={arr.id} style={{ pointerEvents: "auto", cursor: "pointer" }}
                   onMouseDown={(e) => { e.stopPropagation(); setSelectedId(arr.id); }}>
                  <line
                    x1={sx} y1={sy} x2={ex} y2={ey}
                    stroke={isSelected ? "#0071e3" : arr.stroke}
                    strokeWidth={isSelected ? 3 : 2}
                    markerEnd={`url(#${isSelected ? "arrowhead-blue" : "arrowhead"})`}
                  />
                  {/* Línea invisible más gruesa para facilitar el click */}
                  <line x1={sx} y1={sy} x2={ex} y2={ey}
                    stroke="transparent" strokeWidth={14} />
                </g>
              );
            })}
            {/* Flecha temporal mientras se está conectando */}
            {connecting && (
              <line
                x1={connecting.fromPoint.x + 50000}
                y1={connecting.fromPoint.y + 50000}
                x2={connecting.mousePoint.x + 50000}
                y2={connecting.mousePoint.y + 50000}
                stroke="#0071e3"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                markerEnd="url(#arrowhead-blue)"
              />
            )}
          </svg>

          {/* Elementos */}
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {elements
              .filter((e) => e.type !== "arrow")
              .slice()
              .sort((a, b) => (a.z || 0) - (b.z || 0))
              .map((el) => (
                <div
                  key={el.id}
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "auto" }}
                  onMouseEnter={() => setHoverElId(el.id)}
                  onMouseLeave={() => setHoverElId((cur) => (cur === el.id ? null : cur))}
                >
                  <RenderElement
                    el={el}
                    selected={selectedId === el.id}
                    editing={editingId === el.id}
                    zoom={viewport.zoom}
                    onMouseDown={(e) => startDragElement(e, el)}
                    onDoubleClick={() => { if (el.type === "note" || el.type === "text") setEditingId(el.id); }}
                    onTextChange={(text) => patchElement(el.id, { text } as any)}
                    onTextBlur={() => setEditingId(null)}
                    onResize={(w, h) => patchElement(el.id, { width: w, height: h } as any)}
                  />
                  {/* Connection handles — visibles si está seleccionado o con hover */}
                  {(selectedId === el.id || hoverElId === el.id) && (el.type === "note" || el.type === "shape" || el.type === "image" || el.type === "text") && (
                    <ConnectionHandles
                      el={el}
                      bbox={bbox(el)}
                      zoom={viewport.zoom}
                      isHoverTarget={connecting?.hoverElId === el.id}
                      activeSide={connecting?.hoverElId === el.id ? connecting.hoverSide : undefined}
                      onStart={(side, e) => startConnect(e, el, side)}
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───── Subcomponentes ───── */

function PickerBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        height: 44,
        background: "#fff",
        border: "1px solid rgba(15,23,42,0.1)",
        borderRadius: 9,
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#475569",
        transition: "all 0.12s",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0,113,227,0.08)";
        e.currentTarget.style.borderColor = "#0071e3";
        e.currentTarget.style.color = "#0071e3";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.borderColor = "rgba(15,23,42,0.1)";
        e.currentTarget.style.color = "#475569";
      }}
    >
      {children}
    </button>
  );
}

function ToolBtn({ iconSvg, label, onClick }: { iconSvg: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        width: 40, height: 40,
        background: "transparent",
        border: "none",
        borderRadius: 10,
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#475569",
        transition: "all 0.14s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,113,227,0.08)"; e.currentTarget.style.color = "#0071e3"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#475569"; }}
    >
      {iconSvg}
    </button>
  );
}

/* ───── SVG Icons ───── */
const iconStyle: React.CSSProperties = { display: "block" };
function IconNote() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2z"/><path d="M16 21v-5h5"/></svg>; }
function IconText() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>; }
function IconRect() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>; }
function IconCircle() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={iconStyle}><circle cx="12" cy="12" r="8"/></svg>; }
function IconDiamond() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" style={iconStyle}><path d="M12 3 L21 12 L12 21 L3 12 Z"/></svg>; }
function IconTriangle() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" style={iconStyle}><path d="M12 4 L21 20 L3 20 Z"/></svg>; }
function IconImage() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 18 6-6 4 4 4-4 4 4"/></svg>; }
function IconMinus() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={iconStyle}><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconPlus() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={iconStyle}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconReset() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="8"/></svg>; }

function RenderElement({
  el, selected, editing, zoom, onMouseDown, onDoubleClick, onTextChange, onTextBlur,
}: {
  el: Element;
  selected: boolean;
  editing: boolean;
  zoom: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onTextChange: (text: string) => void;
  onTextBlur: () => void;
  onResize: (w: number, h: number) => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: el.x, top: el.y,
    cursor: "move",
    userSelect: editing ? "text" : "none",
    boxSizing: "border-box",
  };
  const selectedOutline: React.CSSProperties = selected ? {
    outline: `${2 / zoom}px solid #0071e3`,
    outlineOffset: `${2 / zoom}px`,
  } : {};

  if (el.type === "note") {
    return (
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        style={{
          ...baseStyle, ...selectedOutline,
          width: el.width, height: el.height,
          background: el.color,
          borderRadius: 6,
          boxShadow: "0 6px 18px rgba(15,23,42,0.12)",
          padding: 10,
          overflow: "hidden",
        }}
      >
        {editing ? (
          <textarea
            autoFocus
            value={el.text}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={onTextBlur}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "100%", height: "100%",
              border: "none", outline: "none",
              background: "transparent",
              resize: "none",
              fontSize: 14, lineHeight: 1.4,
              color: "#0f172a",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.4, color: "#0f172a", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {el.text || <span style={{ color: "rgba(15,23,42,0.3)", fontStyle: "italic" }}>Doble click para editar</span>}
          </div>
        )}
      </div>
    );
  }
  if (el.type === "text") {
    return (
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        style={{
          ...baseStyle, ...selectedOutline,
          padding: "4px 8px",
        }}
      >
        {editing ? (
          <input
            autoFocus
            value={el.text}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={onTextBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{
              border: "1px dashed #0071e3", outline: "none",
              background: "rgba(255,255,255,0.7)",
              fontSize: el.fontSize, color: el.color,
              fontFamily: "inherit",
              padding: 0,
              minWidth: 100,
            }}
          />
        ) : (
          <div style={{ fontSize: el.fontSize, color: el.color, whiteSpace: "pre-wrap", fontWeight: 500 }}>
            {el.text || "Texto"}
          </div>
        )}
      </div>
    );
  }
  if (el.type === "shape") {
    if (el.shape === "rect" || el.shape === "circle") {
      return (
        <div
          onMouseDown={onMouseDown}
          style={{
            ...baseStyle, ...selectedOutline,
            width: el.width, height: el.height,
            background: el.fill,
            border: `2px solid ${el.stroke}`,
            borderRadius: el.shape === "circle" ? "50%" : 8,
          }}
        />
      );
    }
    // Diamond / triangle: SVG para no perder el border
    const w = el.width, h = el.height;
    const points = el.shape === "diamond"
      ? `${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`
      : `${w / 2},2 ${w - 2},${h - 2} 2,${h - 2}`;
    return (
      <div onMouseDown={onMouseDown} style={{ ...baseStyle, ...selectedOutline, width: w, height: h }}>
        <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
          <polygon points={points} fill={el.fill} stroke={el.stroke} strokeWidth={2} strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (el.type === "image") {
    return (
      <img
        onMouseDown={onMouseDown}
        src={`/api/estudios/image/${el.src_key}`}
        alt=""
        draggable={false}
        style={{
          ...baseStyle, ...selectedOutline,
          width: el.width, height: el.height,
          borderRadius: 6,
          boxShadow: "0 4px 12px rgba(15,23,42,0.1)",
          objectFit: "cover",
        }}
      />
    );
  }
  return null;
}

/**
 * 4 dots en los lados de un elemento para iniciar una conexión.
 * Cuando el elemento es target de un connecting drag, el handle del lado
 * más cercano se resalta para indicar dónde se va a anclar.
 */
function ConnectionHandles({
  el, bbox, zoom, isHoverTarget, activeSide, onStart,
}: {
  el: Element;
  bbox: { x: number; y: number; w: number; h: number };
  zoom: number;
  isHoverTarget: boolean;
  activeSide?: "top" | "right" | "bottom" | "left";
  onStart: (side: "top" | "right" | "bottom" | "left", e: React.MouseEvent) => void;
}) {
  const { x, y, w, h } = bbox;
  const size = 12 / zoom;
  const half = size / 2;
  const sides: Array<{ side: "top" | "right" | "bottom" | "left"; cx: number; cy: number }> = [
    { side: "top",    cx: x + w / 2, cy: y },
    { side: "right",  cx: x + w,     cy: y + h / 2 },
    { side: "bottom", cx: x + w / 2, cy: y + h },
    { side: "left",   cx: x,         cy: y + h / 2 },
  ];
  return (
    <>
      {sides.map(({ side, cx, cy }) => {
        const isActive = activeSide === side && isHoverTarget;
        return (
          <div
            key={side}
            onMouseDown={(e) => onStart(side, e)}
            title={`Conectar (${side})`}
            style={{
              position: "absolute",
              left: cx - half, top: cy - half,
              width: size, height: size,
              borderRadius: "50%",
              background: isActive ? "#0071e3" : "#fff",
              border: `${2 / zoom}px solid #0071e3`,
              cursor: "crosshair",
              boxShadow: isActive
                ? `0 0 0 ${4 / zoom}px rgba(0,113,227,0.25)`
                : `0 1px 3px rgba(15,23,42,0.15)`,
              zIndex: 100,
              transition: "background 0.1s, box-shadow 0.1s",
            }}
          />
        );
      })}
    </>
  );
}
