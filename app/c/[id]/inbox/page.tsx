"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Inbox CLIENTE — versión limpia y robusta.
 * Funcionalidad: ver cuentas, mensajes, responder, reenviar, eliminar.
 * Reutiliza los mismos endpoints que /u/[id]/inbox.
 */
export default function ClienteInboxPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [me, setMe] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // filter puede ser "all" | "received" | "sent" | folderId
  // Por defecto "received" para ver las respuestas de prospects, no los enviados.
  const [filter, setFilter] = useState<string>("received");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<any>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  // Carpetas custom
  const [folders, setFolders] = useState<any[]>([]);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  // Firma
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [showWarmup, setShowWarmup] = useState(false);
  const [warmupCount, setWarmupCount] = useState(0);
  const [totalAvailable, setTotalAvailable] = useState(0);
  // Modal de progreso de sincronización en vivo
  const [syncProgressOpen, setSyncProgressOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    total: number;
    done: number;
    ok: number;
    fail: number;
    items: Array<{ email: string; phase: string; message: string }>;
    finished?: boolean;
    elapsedMs?: number;
  } | null>(null);

  // 1) Auth check
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/unibox-client/me", { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        if (!d?.authenticated || d?.uniboxId !== id) {
          router.replace(`/c/${id}/login`);
          return;
        }
        setMe(d);
      } catch {
        if (!cancelled) router.replace(`/c/${id}/login`);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, router]);

  // 2) Cargar cuentas + mensajes + carpetas cuando hay sesión
  useEffect(() => {
    if (!me) return;
    fetch(`/api/uniboxes/${id}/accounts`).then(r => r.ok ? r.json() : []).then((d) => {
      if (Array.isArray(d)) {
        setAccounts(d);
        // AUTO-VERIFY SILENCIOSO: si hay cuentas sin last_sync (nunca
        // verificadas), las verificamos en background sin modal.
        // Se ejecuta 1 vez al entrar al inbox.
        const needsVerify = d.some((a: any) => !a.last_sync && !a.last_error);
        if (needsVerify) {
          autoVerifySilent();
        }
      }
    }).catch(() => {});
    loadFolders();
    loadMessages();
  }, [me, id]);

  // Auto-verify silencioso (sin modal). Marca cuentas como conectadas en
  // background al entrar al inbox por primera vez.
  async function autoVerifySilent() {
    try {
      const evt = new EventSource(`/api/uniboxes/${id}/verify-all`);
      await new Promise<void>((resolve) => {
        evt.addEventListener("done", () => { evt.close(); resolve(); });
        evt.onerror = () => { evt.close(); resolve(); };
      });
      const accR = await fetch(`/api/uniboxes/${id}/accounts`);
      if (accR.ok) {
        const accD = await accR.json();
        if (Array.isArray(accD) && accD.length > 0) setAccounts(accD);
      }
    } catch {}
  }

  // 3) Refresh cuando cambia cuenta o toggle de warmup
  useEffect(() => { if (me) loadMessages(); }, [selectedAccountId, showWarmup]);

  // 4) Auto-refresh cada 60s REAL — busca nuevos mensajes en IMAP de
  // todas las cuentas. Visible (indicador en sidebar), anti-overlap.
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const autoRefreshingRef = useRef(false);
  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      if (document.hidden) return;
      // Anti-overlap: si el tick anterior aún corre, saltamos
      if (autoRefreshingRef.current) {
        console.log("[auto-refresh] tick anterior aún corre — saltando");
        return;
      }
      autoRefreshingRef.current = true;
      setAutoRefreshing(true);
      const t0 = Date.now();
      try {
        const r = await fetch(`/api/uniboxes/${id}/sync-all`, { method: "POST" });
        const data = await r.json().catch(() => ({}));
        // Refrescamos cuentas para actualizar dots verdes
        const accR = await fetch(`/api/uniboxes/${id}/accounts`);
        if (accR.ok) {
          const accD = await accR.json();
          if (Array.isArray(accD) && accD.length > 0) setAccounts(accD);
        }
        const msgsBefore = messages.length;
        await loadMessages();
        const elapsedMs = Date.now() - t0;
        const newCount = data?.new || 0;
        console.log(`[auto-refresh] OK en ${elapsedMs}ms · ${newCount} mensajes nuevos · ${data?.ok || 0}/${data?.ok + data?.fail || 0} cuentas`);
        setLastSync(Date.now());
      } catch (e: any) {
        console.warn("[auto-refresh] error:", e?.message);
      }
      autoRefreshingRef.current = false;
      setAutoRefreshing(false);
    };
    // Primera vez a los 5s, luego cada 60s exactos
    const initial = setTimeout(tick, 5000);
    const interval = setInterval(tick, 60_000);
    // Re-sync al volver a la pestaña tras estar oculta
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, id]);

  async function loadFolders() {
    try {
      const r = await fetch(`/api/uniboxes/${id}/folders`);
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d)) setFolders(d);
      }
    } catch {}
  }

  async function loadMessages() {
    try {
      const p = new URLSearchParams();
      if (selectedAccountId) p.set("account", selectedAccountId);
      if (showWarmup) p.set("show_warmup", "1");
      p.set("all", "1");
      const r = await fetch(`/api/uniboxes/${id}/messages?${p}`);
      if (r.ok) {
        const d = await r.json();
        setMessages(d.messages || []);
        setWarmupCount(d.warmupCount || 0);
        setTotalAvailable(d.total || (d.messages?.length || 0));
        // Hidratar cuerpos de los recibidos recientes sin body (fast-mode)
        // → mejora previews y la clasificación de interés sin abrir uno a uno.
        hydrateRecentBodies(d.messages || []);
      }
    } catch {}
  }

  // HIDRATACIÓN en background: descarga el cuerpo de los N mensajes
  // RECIBIDOS más recientes que aún no lo tienen (has_body=false).
  // El endpoint de detalle lo baja de IMAP y lo cachea, así que esto
  // solo cuesta una vez por mensaje. Concurrencia 3 para no saturar.
  const hydratedRef = useRef<Set<string>>(new Set());
  async function hydrateRecentBodies(list: any[]) {
    const myEmailsLocal = new Set(accounts.map((a: any) => (a.email || "").toLowerCase()));
    const isOut = (m: any) => {
      if (typeof m.uid === "number" && m.uid < 0) return true;
      const fa = (m.fromAddress || m.from || "").toLowerCase();
      if (fa && myEmailsLocal.has(fa)) return true;
      return false;
    };
    const candidates = list
      .filter((m: any) => m.has_body === false && !isOut(m) && !m.is_warmup)
      .filter((m: any) => !hydratedRef.current.has(`${m.accountId}-${m.uid}`))
      .slice(0, 20); // solo los 20 más recientes por pasada
    if (candidates.length === 0) return;

    const CONCURRENCY = 3;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (m: any) => {
        const key = `${m.accountId}-${m.uid}`;
        hydratedRef.current.add(key);
        try {
          const r = await fetch(`/api/uniboxes/${id}/messages/${m.accountId}/${m.uid}`);
          if (r.ok) {
            const full = await r.json();
            if (full?.preview && full.preview !== m.preview) {
              setMessages(prev => prev.map((msg: any) =>
                msg.accountId === m.accountId && msg.uid === m.uid
                  ? { ...msg, preview: full.preview, has_body: true }
                  : msg
              ));
            }
          }
        } catch {}
      }));
    }
  }

  // REFRESH: solo busca nuevos mensajes en los IMAP de todas las cuentas.
  // No abre modal, solo muestra spinner en el botón. Mucho más rápido
  // porque las cuentas ya están conectadas/verificadas.
  async function syncAll() {
    setLoading(true);
    try {
      // sync-all (no streaming) — solo trae nuevos mensajes vía sync incremental.
      await fetch(`/api/uniboxes/${id}/sync-all`, { method: "POST" });
      // Refrescar lista de mensajes y cuentas
      const accR = await fetch(`/api/uniboxes/${id}/accounts`);
      if (accR.ok) {
        const accD = await accR.json();
        if (Array.isArray(accD) && accD.length > 0) setAccounts(accD);
      }
      await loadMessages();
      setLastSync(Date.now());
    } catch (e) {
      console.error("[unibox] refresh error:", e);
    }
    setLoading(false);
  }

  async function moveToFolder(accountId: string, uid: number, folderId: string | null) {
    setMessages(prev => prev.map(m =>
      (m.accountId === accountId && m.uid === uid) ? { ...m, folder_id: folderId } : m
    ));
    if (selectedMsg && selectedMsg.accountId === accountId && selectedMsg.uid === uid) {
      setSelectedMsg((p: any) => p ? { ...p, folder_id: folderId } : p);
    }
    try {
      await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
    } catch {}
  }

  async function logout() {
    await fetch("/api/unibox-client/logout", { method: "POST" }).catch(() => {});
    router.replace(`/c/${id}/login`);
  }

  async function deleteMessage(accountId: string, uid: number) {
    if (!confirm("¿Eliminar este mensaje de la bandeja?")) return;
    setMessages(prev => prev.filter(m => !(m.accountId === accountId && m.uid === uid)));
    if (selectedMsg && selectedMsg.uid === uid && selectedMsg.accountId === accountId) {
      setSelectedMsg(null);
    }
    try {
      await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}`, { method: "DELETE" });
    } catch {}
  }

  function replyTo(m: any) {
    const subj = /^re:\s*/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
    const fromAddr = (m.fromAddress || (m.from || "").match(/<([^>]+)>/)?.[1] || m.from || "").trim();
    const quote = `<br><br><div style="border-left:3px solid #cbd5e1;padding-left:10px;color:#475569;font-size:13px">
      <div><strong>${escapeHtml(m.from || "")}</strong> · ${escapeHtml(new Date(m.date).toLocaleString("es"))}</div>
      <div style="margin-top:6px">${escapeHtml(m.preview || "")}</div>
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: fromAddr,
      subject: subj,
      body: quote,
      inReplyTo: m.messageId,
      references: (m.references || []).join(" "),
    });
    setComposeOpen(true);
  }

  function forwardMsg(m: any) {
    const subj = /^fwd?:\s*/i.test(m.subject || "") ? m.subject : `Fwd: ${m.subject || ""}`;
    const fwdBlock = `<br><br><div style="border-top:1px solid #ddd;padding-top:10px;color:#475569;font-size:13px">
      <div><strong>---------- Mensaje reenviado ----------</strong></div>
      <div><strong>De:</strong> ${escapeHtml(m.from || "")}</div>
      <div><strong>Fecha:</strong> ${escapeHtml(new Date(m.date).toLocaleString("es"))}</div>
      <div><strong>Asunto:</strong> ${escapeHtml(m.subject || "")}</div>
      <div style="margin-top:10px">${escapeHtml(m.preview || "")}</div>
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: "",
      subject: subj,
      body: fwdBlock,
    });
    setComposeOpen(true);
  }

  function newCompose() {
    setComposeData({
      accountId: accounts[0]?.id || "",
      to: "",
      subject: "",
      body: "",
    });
    setComposeOpen(true);
  }

  const myEmails = useMemo(
    () => new Set(accounts.map(a => (a.email || "").toLowerCase())),
    [accounts]
  );

  // Estado de cada cuenta — MISMA lógica que admin:
  // - last_error → red
  // - last_sync existe (sin importar cuándo) → green
  // - sin sync nunca → yellow
  function accountStatus(a: any): "ok" | "warn" | "error" {
    if (a.last_error) return "error";
    if (a.last_sync) return "ok";
    return "warn";
  }
  const accountsConnected = useMemo(
    () => accounts.filter(a => accountStatus(a) === "ok").length,
    [accounts]
  );
  // IDs de cuentas que no están en verde (para reintentar solo esas)
  const accountsNotOk = useMemo(
    () => accounts.filter(a => accountStatus(a) !== "ok"),
    [accounts]
  );

  // VERIFY RÁPIDO: solo conecta IMAP+SMTP, sin descargar mensajes.
  // 1-3s por cuenta. Para 40 cuentas: ~5-10s total con concurrencia 30.
  async function verifyAllAccounts() {
    setLoading(true);
    setSyncProgressOpen(true);
    setSyncProgress({ total: accounts.length, done: 0, ok: 0, fail: 0, items: [] });
    try {
      const evt = new EventSource(`/api/uniboxes/${id}/verify-all`);
      await new Promise<void>((resolve) => {
        evt.addEventListener("start", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress({ total: d.total || 0, done: 0, ok: 0, fail: 0, items: [] });
          } catch {}
        });
        evt.addEventListener("progress", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress((prev) => {
              if (!prev) return prev;
              const items = [...prev.items];
              const last = items[items.length - 1];
              if (last && last.email === d.email) {
                items[items.length - 1] = { email: d.email, phase: d.phase, message: d.message };
              } else {
                items.push({ email: d.email, phase: d.phase, message: d.message });
              }
              return {
                ...prev,
                done: d.phase !== "connecting" ? prev.done + 1 : prev.done,
                ok: d.phase === "ok" ? prev.ok + 1 : prev.ok,
                fail: d.phase === "error" ? prev.fail + 1 : prev.fail,
                items,
              };
            });
          } catch {}
        });
        evt.addEventListener("done", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress((prev) => prev ? { ...prev, finished: true, elapsedMs: d.elapsed_ms } : prev);
          } catch {}
          evt.close();
          resolve();
        });
        evt.onerror = () => { evt.close(); resolve(); };
      });
      // Recargar cuentas para actualizar puntos verdes
      const accR = await fetch(`/api/uniboxes/${id}/accounts`);
      if (accR.ok) {
        const accD = await accR.json();
        if (Array.isArray(accD) && accD.length > 0) setAccounts(accD);
      }
    } catch (e) {
      console.error("[unibox] verify error:", e);
    }
    setLoading(false);
  }

  async function reconnectFailedAccounts() {
    if (accountsNotOk.length === 0) return;
    if (!confirm(`Reintentar conexión IMAP+SMTP de ${accountsNotOk.length} cuenta(s) que no están en verde?`)) return;
    setLoading(true);
    setSyncProgressOpen(true);
    setSyncProgress({ total: accountsNotOk.length, done: 0, ok: 0, fail: 0, items: [] });
    try {
      const ids = accountsNotOk.map(a => a.id).join(",");
      const evt = new EventSource(`/api/uniboxes/${id}/sync-stream?ids=${encodeURIComponent(ids)}`);
      await new Promise<void>((resolve) => {
        evt.addEventListener("start", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress({ total: d.total || 0, done: 0, ok: 0, fail: 0, items: [] });
          } catch {}
        });
        evt.addEventListener("progress", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress((prev) => {
              if (!prev) return prev;
              const items = [...prev.items];
              const last = items[items.length - 1];
              if (last && last.email === d.email) {
                items[items.length - 1] = { email: d.email, phase: d.phase, message: d.message };
              } else {
                items.push({ email: d.email, phase: d.phase, message: d.message });
              }
              return {
                ...prev,
                done: d.phase !== "connecting" ? prev.done + 1 : prev.done,
                ok: d.phase === "ok" ? prev.ok + 1 : prev.ok,
                fail: d.phase === "error" ? prev.fail + 1 : prev.fail,
                items,
              };
            });
          } catch {}
        });
        evt.addEventListener("done", (e: any) => {
          try {
            const d = JSON.parse(e.data);
            setSyncProgress((prev) => prev ? { ...prev, finished: true, elapsedMs: d.elapsed_ms } : prev);
          } catch {}
          evt.close();
          resolve();
        });
        evt.onerror = () => {
          evt.close();
          resolve();
        };
      });
      const accR = await fetch(`/api/uniboxes/${id}/accounts`);
      if (accR.ok) {
        const accD = await accR.json();
        if (Array.isArray(accD) && accD.length > 0) setAccounts(accD);
      }
      await loadMessages();
      setLastSync(Date.now());
    } catch (e) {
      console.error("[unibox] reconnect error:", e);
    }
    setLoading(false);
  }
  const isOutbound = (m: any) => {
    if (typeof m.uid === "number" && m.uid < 0) return true;
    const fa = (m.fromAddress || m.from || "").toLowerCase();
    if (fa && myEmails.has(fa)) return true;
    const match = (m.from || "").match(/<([^>]+)>/);
    if (match && myEmails.has(match[1].toLowerCase())) return true;
    return false;
  };

  // DEDUP: si tienes cuenta A y B, y A mandó email a B, ambas cuentas
  // tienen el mismo mensaje (uno en Sent, otro en INBOX). Deduplicamos
  // por messageId quedándonos con el primero.
  const dedupedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const m of messages) {
      const key = m.messageId || `${m.accountId}-${m.uid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }, [messages]);

  // CLASIFICACIÓN cacheada por mensaje (solo inbound) — se computa una
  // vez por cambio de lista, no en cada render de cada item.
  const classificationMap = useMemo(() => {
    const map = new Map<string, "interested" | "question" | "not_interested" | null>();
    for (const m of dedupedMessages) {
      if (isOutbound(m)) continue; // solo se clasifican respuestas recibidas
      map.set(`${m.accountId}-${m.uid}`, classifyInterest(m));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupedMessages, accounts]);

  const getClassification = (m: any) => classificationMap.get(`${m.accountId}-${m.uid}`) ?? null;

  const filtered = useMemo(() => {
    let list = dedupedMessages;
    // Filtros: "all" = mensajes sin carpeta custom
    //          "received"/"sent" = recibidos/enviados sin carpeta
    //          "interested"/"question"/"not_interested" = recibidos clasificados
    //          [folderId] = mensajes con ese folder_id
    if (filter === "all") {
      list = list.filter(m => !m.folder_id);
    } else if (filter === "received") {
      list = list.filter(m => !m.folder_id && !isOutbound(m));
    } else if (filter === "sent") {
      list = list.filter(m => !m.folder_id && isOutbound(m));
    } else if (filter === "interested" || filter === "question" || filter === "not_interested") {
      list = list.filter(m => !m.folder_id && getClassification(m) === filter);
    } else {
      // Carpeta custom
      list = list.filter(m => m.folder_id === filter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        (m.from || "").toLowerCase().includes(q) ||
        (m.to || "").toLowerCase().includes(q) ||
        (m.subject || "").toLowerCase().includes(q) ||
        (m.preview || "").toLowerCase().includes(q)
      );
    }
    // Cap a 2000 visibles para no saturar el DOM. Si el usuario tiene más,
    // que use el buscador. Antes era 300 — demasiado restrictivo.
    return list.slice(0, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupedMessages, filter, search, accounts, classificationMap]);

  // Contadores para sidebar
  const counts = useMemo(() => {
    const noFolder = dedupedMessages.filter(m => !m.folder_id);
    let interested = 0, question = 0, notInterested = 0;
    for (const m of noFolder) {
      const c = getClassification(m);
      if (c === "interested") interested++;
      else if (c === "question") question++;
      else if (c === "not_interested") notInterested++;
    }
    return {
      all: noFolder.length,
      received: noFolder.filter(m => !isOutbound(m)).length,
      sent: noFolder.filter(isOutbound).length,
      interested,
      question,
      notInterested,
      byFolder: folders.reduce((acc: any, f: any) => {
        acc[f.id] = dedupedMessages.filter(m => m.folder_id === f.id).length;
        return acc;
      }, {} as Record<string, number>),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupedMessages, folders, accounts, classificationMap]);

  if (authChecking) {
    return (
      <div style={loadingScreen}>
        <div style={spinner} />
        <div style={{ marginTop: 14, color: "#64748b", fontSize: 14 }}>Cargando…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div style={appShell}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.4); } }`}</style>
      <aside style={sidebar}>
        <div style={brandRow}>
          <div style={logoBox}>✉</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{me.title || "Unibox"}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{me.clientEmail}</div>
          </div>
        </div>

        <button style={composeBtn} onClick={newCompose}>+ Redactar</button>

        <div style={sectionTitle}>FILTROS</div>
        <button
          style={{ ...folderBtn, ...(filter === "all" ? folderActive : {}) }}
          onClick={() => setFilter("all")}
        >📥 Todos · {counts.all}</button>
        <button
          style={{ ...folderBtn, ...(filter === "received" ? folderActive : {}) }}
          onClick={() => setFilter("received")}
        >📨 Recibidos · {counts.received}</button>
        <button
          style={{ ...folderBtn, ...(filter === "sent" ? folderActive : {}) }}
          onClick={() => setFilter("sent")}
        >📤 Enviados · {counts.sent}</button>

        <div style={sectionTitle}>CLASIFICACIÓN</div>
        <button
          style={{
            ...folderBtn,
            ...(filter === "interested" ? { background: "rgba(16,185,129,0.12)", color: "#047857", fontWeight: 700 } : {}),
          }}
          onClick={() => setFilter("interested")}
          title="Respuestas que muestran interés (quieren info, reunión, presupuesto)"
        >🟢 Interesados · {counts.interested}</button>
        <button
          style={{
            ...folderBtn,
            ...(filter === "question" ? { background: "rgba(59,130,246,0.12)", color: "#1d4ed8", fontWeight: 700 } : {}),
          }}
          onClick={() => setFilter("question")}
          title="Respuestas con preguntas o dudas"
        >🔵 Preguntas · {counts.question}</button>
        <button
          style={{
            ...folderBtn,
            ...(filter === "not_interested" ? { background: "rgba(239,68,68,0.12)", color: "#b91c1c", fontWeight: 700 } : {}),
          }}
          onClick={() => setFilter("not_interested")}
          title="Respuestas que rechazan o piden baja"
        >🔴 No interesados · {counts.notInterested}</button>

        <div style={sectionTitle}>CARPETAS</div>
        {folders.map((f) => (
          <div key={f.id} style={{ position: "relative" }}>
            <button
              style={{ ...folderBtn, ...(filter === f.id ? folderActive : {}), paddingRight: 28 }}
              onClick={() => setFilter(f.id)}
            >📁 {f.name} · {counts.byFolder[f.id] || 0}</button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(`¿Eliminar carpeta "${f.name}"? Los mensajes vuelven a Todos.`)) return;
                await fetch(`/api/uniboxes/${id}/folders/${f.id}`, { method: "DELETE" });
                if (filter === f.id) setFilter("all");
                await loadFolders();
                await loadMessages();
              }}
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "transparent", border: 0, cursor: "pointer",
                color: "#94a3b8", fontSize: 11, padding: 4,
              }}
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => setFolderModalOpen(true)}
          style={{
            ...folderBtn,
            border: "1px dashed #cbd5e1",
            color: "#64748b",
            marginTop: 4,
          }}
        >＋ Nueva carpeta</button>

        <div style={sectionTitle}>
          BANDEJAS · <span style={{ color: "#10b981" }}>{accountsConnected}</span>/{accounts.length}
        </div>
        {accountsNotOk.length > 0 && (
          <button
            onClick={reconnectFailedAccounts}
            disabled={loading}
            style={{
              ...ghostBtn,
              color: "#f59e0b",
              borderColor: "rgba(245,158,11,0.4)",
              background: "rgba(245,158,11,0.05)",
              fontSize: 12, fontWeight: 700,
              marginBottom: 4,
            }}
            title={`Reintentar conexión IMAP+SMTP de las ${accountsNotOk.length} cuentas que no están conectadas`}
          >
            🔌 Reconectar {accountsNotOk.length} cuenta(s)
          </button>
        )}
        <div style={accountList}>
          <button
            style={{ ...accountBtn, ...(selectedAccountId === null ? accountActive : {}) }}
            onClick={() => setSelectedAccountId(null)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: accountsConnected === accounts.length && accounts.length > 0 ? "#10b981" : "#f59e0b",
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontWeight: 600 }}>Todas las cuentas</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{accounts.length} buzones</div>
              </div>
            </div>
          </button>
          {accounts.map((a) => {
            const status = accountStatus(a);
            const dotColor = status === "ok" ? "#10b981" : status === "warn" ? "#f59e0b" : "#ef4444";
            return (
              <button
                key={a.id}
                style={{ ...accountBtn, ...(selectedAccountId === a.id ? accountActive : {}) }}
                onClick={() => setSelectedAccountId(a.id)}
                title={a.last_error ? `Error: ${a.last_error}` : (a.last_sync ? `Última sync: ${new Date(a.last_sync).toLocaleString("es")}` : "Sin sync aún")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: dotColor, flexShrink: 0,
                    boxShadow: status === "ok" ? "0 0 6px rgba(16,185,129,0.5)" : "none",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{[a.first_name, a.last_name].filter(Boolean).join(" ") || a.imap_host}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          style={{ ...ghostBtn, color: "#10b981", borderColor: "rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.05)" }}
          onClick={verifyAllAccounts}
          disabled={loading}
          title="Verificación rápida (~5s): solo conecta IMAP+SMTP y marca cuentas como conectadas, sin descargar mensajes"
        >
          {loading ? "Verificando…" : "⚡ Verificar cuentas (rápido)"}
        </button>
        <button
          style={{ ...ghostBtn, fontWeight: 700 }}
          onClick={syncAll}
          disabled={loading}
          title="Busca nuevos mensajes en todos los IMAPs. No reconecta cuentas."
        >
          {loading ? "Cargando…" : "↻ Refresh"}
        </button>
        <div style={{
          fontSize: 10.5,
          color: autoRefreshing ? "#10b981" : "#94a3b8",
          textAlign: "center",
          fontWeight: autoRefreshing ? 700 : 400,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          {autoRefreshing ? (
            <>
              <span style={{
                display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                background: "#10b981", animation: "pulse 1s ease-in-out infinite",
              }} />
              Buscando nuevos…
            </>
          ) : (
            lastSync ? `Última: ${fmtTimeSince(lastSync)}` : "Auto-refresh cada 60s"
          )}
        </div>
        <button
          style={{ ...ghostBtn, color: "#f59e0b", borderColor: "rgba(245,158,11,0.35)", fontSize: 11.5 }}
          onClick={async () => {
            if (!confirm("Esto descarga los últimos 1500 mensajes de IMAP por cuenta (puede tardar 1-3 min). ¿Continuar?")) return;
            setLoading(true);
            try {
              const r = await fetch(`/api/uniboxes/${id}/force-resync`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
              });
              const d = await r.json().catch(() => ({}));
              await loadMessages();
              setLastSync(Date.now());
              alert(
                `Resync completo:\n` +
                `${d?.totalInbox || 0} mensajes INBOX\n` +
                `${d?.totalSent || 0} mensajes Sent\n` +
                `${d?.accounts || 0} cuentas procesadas` +
                (d?.errors ? `\n${d.errors} errores` : "")
              );
            } catch (e: any) {
              alert("Error en force-resync: " + (e?.message || e));
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          title="Descarga TODOS los mensajes del IMAP ignorando el cache (usar si crees que faltan mensajes)"
        >
          🔧 Forzar resync completo
        </button>
        <button
          style={{ ...ghostBtn, fontSize: 11.5 }}
          onClick={() => setShowWarmup(v => !v)}
          title={`${warmupCount} mensajes están marcados como warmup`}
        >
          {showWarmup ? "🔥 Ocultar warmup" : `🔥 Mostrar warmup${warmupCount ? ` (${warmupCount})` : ""}`}
        </button>
        <button style={ghostBtn} onClick={() => setSignatureModalOpen(true)}>
          ✍ Firmas
        </button>
        <button style={{ ...ghostBtn, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <section style={listPane}>
        <div style={toolbar}>
          <input
            type="text"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
          />
        </div>
        <div style={messagesList}>
          {filtered.length === 0 ? (
            <div style={emptyState}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <div>No hay mensajes</div>
              {warmupCount > 0 && !showWarmup && (
                <div style={{ marginTop: 16, padding: 12, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 12.5, color: "#92400e", maxWidth: 280, textAlign: "left" }}>
                  ⚠️ <strong>{warmupCount} mensaje(s)</strong> están filtrados como warmup.
                  <button
                    onClick={() => setShowWarmup(true)}
                    style={{
                      display: "block", marginTop: 8, padding: "6px 12px",
                      background: "#f59e0b", color: "#fff", border: 0, borderRadius: 6,
                      fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >Mostrar mensajes warmup</button>
                </div>
              )}
              <button onClick={syncAll} style={{ ...ghostBtn, marginTop: 14, display: "inline-block", width: "auto", padding: "8px 16px" }} disabled={loading}>
                {loading ? "Sincronizando…" : "↻ Sincronizar ahora"}
              </button>
            </div>
          ) : (
            filtered.map((m) => {
              const isSelected = selectedMsg && selectedMsg.uid === m.uid && selectedMsg.accountId === m.accountId;
              const outbound = isOutbound(m);
              const cls = outbound ? null : getClassification(m);
              const clsMeta = cls ? INTEREST_META[cls] : null;
              return (
                <div
                  key={`${m.accountId}-${m.uid}`}
                  onClick={() => setSelectedMsg(m)}
                  style={{
                    ...msgItem,
                    ...(isSelected ? msgItemActive : {}),
                    // Borde de color a la izquierda según clasificación
                    ...(clsMeta ? { borderLeft: `3px solid ${clsMeta.border.replace("0.35", "0.9")}` } : {}),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220, display: "flex", alignItems: "center", gap: 6 }}>
                      {outbound ? `→ ${m.to || ""}` : (m.fromName || m.from || "")}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, marginLeft: 8 }}>
                      {fmtDate(m.date)}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#334155", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.subject || "(sin asunto)"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                    {clsMeta && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 10, fontWeight: 700,
                        color: clsMeta.color,
                        background: clsMeta.bg,
                        border: `1px solid ${clsMeta.border}`,
                        borderRadius: 99,
                        padding: "1px 8px",
                        letterSpacing: "0.01em",
                      }}>{clsMeta.label}</span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(m.preview || "").substring(0, 120)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section style={detailPane}>
        {!selectedMsg ? (
          <div style={emptyDetail}>
            <div style={{ fontSize: 56, opacity: 0.3, marginBottom: 14 }}>✉</div>
            <div style={{ fontSize: 15, color: "#94a3b8" }}>Selecciona un mensaje</div>
          </div>
        ) : (
          <MessageDetail
            m={selectedMsg}
            uniboxId={id}
            folders={folders}
            classification={isOutbound(selectedMsg) ? null : getClassification(selectedMsg)}
            onReply={() => replyTo(selectedMsg)}
            onForward={() => forwardMsg(selectedMsg)}
            onDelete={() => deleteMessage(selectedMsg.accountId, selectedMsg.uid)}
            onMoveFolder={(fid: string | null) => moveToFolder(selectedMsg.accountId, selectedMsg.uid, fid)}
            onBodyLoaded={(accountId: string, uid: number, patch: any) => {
              // Actualizar el mensaje en la lista con el preview real →
              // el classificationMap se recalcula y el badge aparece solo.
              setMessages(prev => prev.map((msg: any) =>
                msg.accountId === accountId && msg.uid === uid ? { ...msg, ...patch } : msg
              ));
            }}
          />
        )}
      </section>

      {composeOpen && (
        <ComposeModal
          uniboxId={id}
          accounts={accounts}
          initial={composeData}
          onClose={() => setComposeOpen(false)}
          onSent={(sent: any) => {
            setComposeOpen(false);
            // OPTIMISTIC UPDATE: añade el mensaje recién enviado a la lista
            // local INMEDIATAMENTE. Aparece en Enviados sin esperar al
            // sync IMAP. Cuando el sync traiga la versión "real", el dedup
            // por messageId la sustituye sin duplicar.
            if (sent && sent.accountId) {
              const acc = accounts.find(a => a.id === sent.accountId);
              const plainBody = (sent.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              const fakeUid = -Date.now(); // UID negativo = convención de Sent en el cache
              const optimisticMsg: any = {
                uid: fakeUid,
                accountId: sent.accountId,
                messageId: sent.messageId || `<optimistic-${fakeUid}@local>`,
                from: acc?.email || "",
                fromName: [acc?.first_name, acc?.last_name].filter(Boolean).join(" ") || acc?.email || "",
                fromAddress: acc?.email || "",
                to: sent.to,
                toAddress: (sent.to || "").split(",")[0].trim(),
                subject: sent.subject || "(sin asunto)",
                date: new Date().toISOString(),
                preview: plainBody.slice(0, 180),
                unread: false,
                is_warmup: false,
                folder_id: null,
                has_attachments: false,
                is_sent: true,
                inReplyTo: sent.inReplyTo,
                references: sent.references ? sent.references.split(/\s+/).filter(Boolean) : [],
              };
              setMessages(prev => [optimisticMsg, ...prev]);
              // Cambiar al filtro Enviados para que el usuario lo vea
              setFilter("sent");
            }
            // Y refrescamos en background por si hay sync paralelo
            setTimeout(() => loadMessages(), 3000);
          }}
        />
      )}

      {folderModalOpen && (
        <NewFolderModal
          uniboxId={id}
          onClose={() => setFolderModalOpen(false)}
          onCreated={(newFolder: any) => {
            setFolders(prev => [...prev, newFolder]);
            setFilter(newFolder.id);
            setFolderModalOpen(false);
          }}
        />
      )}

      {signatureModalOpen && (
        <SignatureModal
          uniboxId={id}
          accounts={accounts}
          onClose={() => setSignatureModalOpen(false)}
          onSaved={(updated: any[]) => {
            if (Array.isArray(updated)) {
              setAccounts(prev => prev.map(a => {
                const u = updated.find((x: any) => x.id === a.id);
                return u ? { ...a, signature_html: u.signature_html } : a;
              }));
            }
          }}
        />
      )}

      {syncProgressOpen && syncProgress && (
        <SyncProgressModal
          progress={syncProgress}
          onClose={() => setSyncProgressOpen(false)}
        />
      )}
    </div>
  );
}

function MessageDetail({ m, uniboxId, folders, classification, onReply, onForward, onDelete, onMoveFolder, onBodyLoaded }: any) {
  const [full, setFull] = useState<any>(null);

  useEffect(() => {
    setFull(null);
    fetch(`/api/uniboxes/${uniboxId}/messages/${m.accountId}/${m.uid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setFull(d);
        // Propagar el preview real al parent — mejora la clasificación
        // de interés al instante (fast-mode trae solo subject hasta abrir).
        if (d && d.preview && d.preview !== m.preview && onBodyLoaded) {
          onBodyLoaded(m.accountId, m.uid, { preview: d.preview, text: d.text, html: d.html });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.accountId, m.uid, uniboxId]);

  return (
    <div style={detailContent}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a", flex: 1, minWidth: 200, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {m.subject || "(sin asunto)"}
          {classification && INTEREST_META[classification] && (
            <span style={{
              fontSize: 11.5, fontWeight: 700,
              color: INTEREST_META[classification].color,
              background: INTEREST_META[classification].bg,
              border: `1px solid ${INTEREST_META[classification].border}`,
              borderRadius: 99,
              padding: "3px 12px",
              whiteSpace: "nowrap",
            }}>
              {INTEREST_META[classification].icon} {INTEREST_META[classification].label}
            </span>
          )}
        </h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={onReply} style={actionBtn}>↩ Responder</button>
          <button onClick={onForward} style={actionBtnSecondary}>↪ Reenviar</button>
          {folders && folders.length > 0 && (
            <select
              value={m.folder_id || ""}
              onChange={(e) => onMoveFolder(e.target.value || null)}
              style={{
                ...actionBtnSecondary, padding: "7px 8px",
                fontSize: 12, cursor: "pointer",
              }}
              title="Mover a carpeta"
            >
              <option value="">📁 Sin carpeta</option>
              {folders.map((f: any) => (
                <option key={f.id} value={f.id}>📁 {f.name}</option>
              ))}
            </select>
          )}
          <button onClick={onDelete} style={{ ...actionBtnSecondary, color: "#dc2626", borderColor: "rgba(220,38,38,0.25)" }}>🗑</button>
        </div>
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
        <div><strong>De:</strong> {m.from || m.fromAddress}</div>
        {m.to && <div style={{ marginTop: 3 }}><strong>Para:</strong> {m.to}</div>}
        <div style={{ marginTop: 3, color: "#64748b" }}>{new Date(m.date).toLocaleString("es")}</div>
      </div>

      {!full ? (
        <div style={{ color: "#94a3b8", padding: 20, textAlign: "center" }}>Cargando contenido…</div>
      ) : full.html ? (
        <div dangerouslySetInnerHTML={{ __html: full.html }} style={{ lineHeight: 1.55, fontSize: 14, color: "#0f172a" }} />
      ) : (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, color: "#0f172a", lineHeight: 1.55, margin: 0 }}>
          {full.text || m.preview || "(sin contenido)"}
        </pre>
      )}
    </div>
  );
}

function ComposeModal({ uniboxId, accounts, initial, onClose, onSent }: any) {
  const [accountId, setAccountId] = useState(initial.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(initial.to || "");
  const [subject, setSubject] = useState(initial.subject || "");
  // body se lee del editor cuando se pulsa Enviar, no en cada keystroke.
  // Esto evita el bug de escribir al revés (cursor jump al final).
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Adjuntos seleccionados — máximo 25MB total (límite estándar SMTP)
  const [attachments, setAttachments] = useState<File[]>([]);
  const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
  const totalSize = attachments.reduce((s, f) => s + f.size, 0);

  function addAttachments(files: FileList | File[]) {
    const next = [...attachments];
    for (const f of Array.from(files)) {
      next.push(f);
    }
    const newTotal = next.reduce((s, f) => s + f.size, 0);
    if (newTotal > MAX_TOTAL_SIZE) {
      setError(`Tamaño total supera 25MB (${(newTotal / 1024 / 1024).toFixed(1)}MB). Quita algún archivo.`);
      return;
    }
    setError("");
    setAttachments(next);
  }
  function removeAttachment(idx: number) {
    setAttachments(attachments.filter((_, i) => i !== idx));
  }
  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // Marker HTML para separar el cuerpo de la firma. Permite cambiar la
  // firma al cambiar de cuenta sin perder lo que escribió el usuario.
  const SIG_MARKER_START = '<!-- onepulso-sig-start -->';
  const SIG_MARKER_END = '<!-- onepulso-sig-end -->';

  function buildSignatureBlock(sigHtml: string): string {
    if (!sigHtml || !sigHtml.trim()) return "";
    return `<br><br>${SIG_MARKER_START}<div data-onepulso-signature="1">${sigHtml}</div>${SIG_MARKER_END}`;
  }

  function getCurrentAccountSignature(): string {
    const acc = accounts.find((a: any) => a.id === accountId);
    return acc?.signature_html || "";
  }

  // Inicializa el editor con el body inicial + firma al montar.
  useEffect(() => {
    if (editorRef.current) {
      const sig = getCurrentAccountSignature();
      const sigBlock = buildSignatureBlock(sig);
      const bodyHtml = (initial.body || "") + sigBlock;
      editorRef.current.innerHTML = bodyHtml;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambiar de cuenta, sustituir SOLO la parte de firma (mantener body).
  useEffect(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML || "";
    // Quitar firma anterior si existe (entre los markers)
    let withoutSig = html;
    const startIdx = html.indexOf(SIG_MARKER_START);
    const endIdx = html.indexOf(SIG_MARKER_END);
    if (startIdx >= 0 && endIdx > startIdx) {
      withoutSig = html.slice(0, startIdx) + html.slice(endIdx + SIG_MARKER_END.length);
      // Limpiar los <br><br> que añadimos antes del marker
      withoutSig = withoutSig.replace(/(<br>\s*){2,}$/i, "");
    }
    const newSig = buildSignatureBlock(getCurrentAccountSignature());
    editorRef.current.innerHTML = withoutSig + newSig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function send() {
    if (!to.trim()) { setError("Falta destinatario"); return; }
    setSending(true);
    setError("");
    try {
      const body = editorRef.current?.innerHTML || "";
      const fd = new FormData();
      fd.append("accountId", accountId);
      fd.append("to", to);
      fd.append("subject", subject);
      fd.append("body", body);
      if (initial.inReplyTo) fd.append("inReplyTo", initial.inReplyTo);
      if (initial.references) fd.append("references", initial.references);
      // Adjuntos — clave 'attachments' (multiple). El endpoint /send
      // hace form.getAll("attachments") y los procesa con nodemailer.
      for (const f of attachments) {
        fd.append("attachments", f);
      }
      const r = await fetch(`/api/uniboxes/${uniboxId}/send`, { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Error enviando");
      // Pasamos al parent los datos del envío para que pueda añadir el
      // mensaje optimista a la lista (aparece en Enviados al instante,
      // sin esperar al sync IMAP del Sent folder).
      onSent({
        accountId, to, subject, body,
        messageId: d.messageId,
        inReplyTo: initial.inReplyTo,
        references: initial.references,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{initial.inReplyTo ? "Responder" : "Nuevo mensaje"}</div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          <label style={composeLabel}>De</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={composeInput}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <label style={composeLabel}>Para</label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="destinatario@empresa.com"
            style={composeInput}
          />

          <label style={composeLabel}>Asunto</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Asunto del email"
            style={composeInput}
          />

          <label style={composeLabel}>Mensaje</label>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            style={{ ...composeInput, minHeight: 200, padding: 12, outline: "none" }}
          />

          {/* Zona de adjuntos */}
          {attachments.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <label style={composeLabel}>
                📎 Adjuntos ({attachments.length}) · {fmtSize(totalSize)} / 25 MB
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {attachments.map((f, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{getFileIcon(f.name)}</span>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtSize(f.size)}</div>
                    </div>
                    <button
                      onClick={() => removeAttachment(idx)}
                      style={{
                        background: "transparent", border: 0, cursor: "pointer",
                        color: "#ef4444", fontSize: 14, padding: 4,
                      }}
                      title="Quitar adjunto"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div style={errorBox}>{error}</div>}
        </div>
        <div style={modalFooter}>
          {/* Input file oculto + botón visible que lo dispara */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addAttachments(e.target.files);
              e.target.value = ""; // permitir re-seleccionar el mismo archivo
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ ...cancelBtn, color: "#0071e3", borderColor: "rgba(0,113,227,0.3)" }}
            disabled={sending}
            title="Adjuntar archivos (máx 25MB total)"
          >
            📎 Adjuntar
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={cancelBtn} disabled={sending}>Cancelar</button>
          <button onClick={send} disabled={sending} style={sendBtn}>
            {sending ? "Enviando…" : (attachments.length > 0 ? `Enviar con ${attachments.length} adjunto(s)` : "Enviar")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal nueva carpeta ─────────────────────────────────────────────
function NewFolderModal({ uniboxId, onClose, onCreated }: any) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/uniboxes/${uniboxId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, color }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear");
      onCreated(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📁 Nueva carpeta</div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <label style={composeLabel}>Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Importantes, Leads calientes…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
              if (e.key === "Escape") onClose();
            }}
            style={composeInput}
          />
          <label style={composeLabel}>Color</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["#6366f1","#3b82f6","#10b981","#84cc16","#eab308","#f59e0b","#ef4444","#ec4899","#a855f7","#64748b"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: c, cursor: "pointer", padding: 0,
                  border: color === c ? "3px solid #0f172a" : "2px solid transparent",
                }}
                aria-label={c}
              />
            ))}
          </div>
          {error && <div style={errorBox}>{error}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={cancelBtn}>Cancelar</button>
          <button onClick={create} disabled={!name.trim() || saving} style={sendBtn}>
            {saving ? "Creando…" : "Crear carpeta"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de firmas HTML por cuenta + bulk ──────────────────────────
function SignatureModal({ uniboxId, accounts, onClose, onSaved }: any) {
  const [bulkHtml, setBulkHtml] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function toggleAll() {
    if (selected.size === accounts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(accounts.map((a: any) => a.id)));
    }
  }

  async function saveBulk() {
    if (!bulkHtml.trim() || selected.size === 0) return;
    setSaving(true);
    setDone(false);
    try {
      // PARALELO: las 21 cuentas se actualizan a la vez en vez de
      // una detrás de otra. 21x más rápido.
      const accIds = Array.from(selected);
      const results = await Promise.all(
        accIds.map((accId) =>
          fetch(`/api/uniboxes/${uniboxId}/accounts/${accId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signature_html: bulkHtml }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.account || null)
            .catch(() => null)
        )
      );
      const updated = results.filter(Boolean);
      onSaved(updated);
      setDone(true);
      setTimeout(() => setDone(false), 3500);
    } catch {}
    setSaving(false);
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={{ ...modalCard, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>✍ Firmas HTML</div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>
            Pega tu firma HTML y aplícala a las cuentas que quieras. Se añadirá automáticamente al final de cada email enviado.
          </p>

          <label style={composeLabel}>Código HTML de la firma</label>
          <textarea
            value={bulkHtml}
            onChange={(e) => setBulkHtml(e.target.value)}
            placeholder={`<div style="color:#475569;font-family:Arial,sans-serif;font-size:13px">
  <strong>Tu Nombre</strong><br>
  Cargo · Empresa<br>
  <a href="https://tuweb.com">tuweb.com</a>
</div>`}
            rows={8}
            style={{ ...composeInput, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12.5, resize: "vertical" }}
          />

          {bulkHtml.trim() && (
            <>
              <label style={composeLabel}>Vista previa</label>
              <div
                style={{
                  border: "1px solid #cbd5e1", borderRadius: 8,
                  padding: 14, background: "#fff", maxHeight: 200, overflow: "auto",
                }}
                dangerouslySetInnerHTML={{ __html: bulkHtml }}
              />
            </>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, marginBottom: 8 }}>
            <label style={{ ...composeLabel, marginTop: 0 }}>Aplicar a estas cuentas</label>
            <button
              type="button"
              onClick={toggleAll}
              style={{ ...ghostBtn, fontSize: 11.5, padding: "5px 10px" }}
            >
              {selected.size === accounts.length ? "Deseleccionar todas" : "Seleccionar todas"}
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            {accounts.map((a: any) => (
              <label
                key={a.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer", fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(a.id);
                    else next.delete(a.id);
                    setSelected(next);
                  }}
                  style={{ cursor: "pointer" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{a.email}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {a.signature_html ? "✓ firma configurada" : "sin firma"}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div style={modalFooter}>
          {done && (
            <span style={{
              flex: 1,
              color: "#10b981", fontWeight: 700, fontSize: 13.5,
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 12px",
              background: "rgba(16,185,129,0.1)",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 16 }}>✅</span> Firmas guardadas en {selected.size} cuenta(s)
            </span>
          )}
          <button onClick={onClose} style={cancelBtn}>Cerrar</button>
          <button
            onClick={saveBulk}
            disabled={!bulkHtml.trim() || selected.size === 0 || saving}
            style={sendBtn}
          >
            {saving ? `Guardando…` : done ? `✓ Aplicado` : `Aplicar a ${selected.size} cuenta(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal con progreso de sync en vivo ──────────────────────────────
function SyncProgressModal({ progress, onClose }: any) {
  const { total, ok, fail, items, finished, elapsedMs } = progress;
  const pct = total > 0 ? Math.round((ok + fail) / total * 100) : 0;
  const itemsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al final cuando llegan items nuevos
  useEffect(() => {
    if (itemsRef.current) {
      itemsRef.current.scrollTop = itemsRef.current.scrollHeight;
    }
  }, [items.length]);

  return (
    <div style={modalBg} onClick={finished ? onClose : undefined}>
      <div style={{ ...modalCard, maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {finished ? "✅ Sincronización completada" : "↻ Sincronizando cuentas…"}
          </div>
          {finished && <button onClick={onClose} style={closeBtn}>✕</button>}
        </div>
        <div style={{ padding: "18px 22px 12px" }}>
          {/* Barra de progreso */}
          <div style={{
            background: "#f1f5f9", borderRadius: 99, height: 10,
            overflow: "hidden", marginBottom: 10,
          }}>
            <div style={{
              width: `${pct}%`,
              height: "100%",
              background: finished
                ? (fail === 0 ? "#10b981" : "linear-gradient(90deg, #10b981, #f59e0b)")
                : "linear-gradient(90deg, #0071e3, #6366f1)",
              transition: "width 0.3s ease-out",
            }} />
          </div>
          {/* Stats */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#64748b", marginBottom: 14 }}>
            <span><strong style={{ color: "#10b981" }}>✓ {ok}</strong> OK</span>
            {fail > 0 && <span><strong style={{ color: "#ef4444" }}>✗ {fail}</strong> errores</span>}
            <span>{ok + fail} / {total} ({pct}%)</span>
            {finished && elapsedMs && <span>{(elapsedMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>

        {/* Lista de cuentas con su estado */}
        <div ref={itemsRef} style={{
          maxHeight: 380, overflowY: "auto",
          padding: "0 22px 12px",
        }}>
          {items.map((it: any, idx: number) => (
            <div
              key={idx}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", marginBottom: 6,
                background: it.phase === "ok" ? "rgba(16,185,129,0.06)" :
                  it.phase === "error" ? "rgba(239,68,68,0.06)" :
                    "rgba(99,102,241,0.06)",
                border: it.phase === "ok" ? "1px solid rgba(16,185,129,0.18)" :
                  it.phase === "error" ? "1px solid rgba(239,68,68,0.2)" :
                    "1px solid rgba(99,102,241,0.18)",
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {it.phase === "ok" ? "✅" :
                  it.phase === "error" ? "❌" :
                    <span style={{
                      display: "inline-block", width: 12, height: 12,
                      border: "2px solid rgba(99,102,241,0.25)",
                      borderTopColor: "#6366f1", borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                    }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.email}
                </div>
                <div style={{ color: "#64748b", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.phase === "connecting" && `🔌 IMAP+SMTP conectando a ${it.message.match(/(\S+)\.\.\./)?.[1] || "servidor"}…`}
                  {it.phase === "ok" && it.message}
                  {it.phase === "error" && it.message}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={modalFooter}>
          {finished ? (
            <button onClick={onClose} style={sendBtn}>Cerrar y ver mensajes</button>
          ) : (
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Procesando en lotes de 10 cuentas en paralelo…
            </span>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function fmtTimeSince(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 10) return "ahora";
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASIFICADOR DE INTERÉS — como Instantly. Analiza subject + preview del
// mensaje RECIBIDO y lo clasifica en:
//   "interested"     → 🟢 verde  (quiere más info / reunión / le encaja)
//   "question"       → 🔵 azul   (hace preguntas, pide detalles)
//   "not_interested" → 🔴 rojo   (rechaza, dar de baja, ya tiene proveedor)
//   null             → sin clasificar (neutro)
// Orden de evaluación: not_interested gana (señal más fuerte), luego
// interested, luego question.
// ─────────────────────────────────────────────────────────────────────────────
const NOT_INTERESTED_PATTERNS = [
  // Español
  "no estamos interesados", "no estoy interesado", "no estoy interesada",
  "no me interesa", "no nos interesa", "no interesa", "no es de interés",
  "no gracias", "no, gracias", "dar de baja", "darme de baja", "darnos de baja",
  "bórrame", "borrame", "borradme", "elimíname", "eliminame", "quitame", "quítame",
  "no utilice mi correo", "no usen mi correo", "deje de enviarme", "dejen de enviarme",
  "deja de enviarme", "no envíe más", "no envie mas", "no me envíes", "no me envies",
  "ya tenemos proveedor", "ya trabajamos con", "ya disponemos de", "ya contamos con",
  "no necesitamos", "no lo necesitamos", "no es para nosotros", "no encaja",
  "no es el momento", "no por ahora", "quizás más adelante", "quizas mas adelante",
  // Inglés
  "not interested", "no interest", "we're not interested", "we are not interested",
  "unsubscribe", "remove me", "take me off", "stop emailing", "stop contacting",
  "do not contact", "don't contact", "not a fit", "not a good fit", "no thanks",
  "we already have", "already working with", "not at this time", "not right now",
  // Otros idiomas comunes en campañas EU
  "pas intéressé", "pas interesse", "kein interesse", "non siamo interessati",
  "não estamos interessados", "nao estamos interessados", "niet geïnteresseerd",
];

const INTERESTED_PATTERNS = [
  // Español
  "me interesa", "nos interesa", "sí me interesa", "si me interesa",
  "estoy interesado", "estoy interesada", "estamos interesados", "interesado en",
  "suena bien", "suena interesante", "me parece interesante", "nos parece interesante",
  "más información", "mas informacion", "más info", "mas info", "amplía", "amplia información",
  "envíame", "enviame", "envíanos", "envianos", "mándame", "mandame", "mándanos", "mandanos",
  "agendar", "agendemos", "agenda una", "coordinar una", "concertar una",
  "reunión", "reunion", "una llamada", "llámame", "llamame", "llamarme", "llamadme",
  "hablemos", "podemos hablar", "podríamos hablar", "podriamos hablar",
  "presupuesto", "cotización", "cotizacion", "tarifas", "propuesta",
  "me encaja", "nos encaja", "encajaría", "encajaria", "adelante",
  "quiero saber más", "quiero saber mas", "cuéntame más", "cuentame mas",
  // Inglés
  "interested in", "i'm interested", "i am interested", "we're interested",
  "we are interested", "sounds good", "sounds interesting", "sounds great",
  "more information", "more info", "send me", "send us", "send over",
  "schedule a call", "book a call", "book a meeting", "set up a call",
  "let's talk", "lets talk", "let's chat", "happy to chat", "open to",
  "calendly", "quote", "pricing", "proposal", "demo", "tell me more",
];

const QUESTION_PATTERNS = [
  "cuánto cuesta", "cuanto cuesta", "qué precio", "que precio", "cuál es el precio",
  "cómo funciona", "como funciona", "qué incluye", "que incluye", "qué ofrecen",
  "podría explicar", "podrías explicar", "puede explicar", "me puede", "me podría",
  "tengo una duda", "tengo una pregunta", "una consulta",
  "how much", "what's the price", "what is the price", "how does it work",
  "what do you offer", "could you explain", "can you explain", "i have a question",
  "what's included", "what is included", "do you have", "tienen", "disponen de",
];

function classifyInterest(m: any): "interested" | "question" | "not_interested" | null {
  const text = `${m.subject || ""} ${m.preview || ""}`.toLowerCase();
  if (!text.trim()) return null;
  for (const p of NOT_INTERESTED_PATTERNS) {
    if (text.includes(p)) return "not_interested";
  }
  for (const p of INTERESTED_PATTERNS) {
    if (text.includes(p)) return "interested";
  }
  for (const p of QUESTION_PATTERNS) {
    if (text.includes(p)) return "question";
  }
  // Pregunta genérica: el preview contiene "?" (y no es solo el subject Re:...?)
  if ((m.preview || "").includes("?")) return "question";
  return null;
}

const INTEREST_META: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  interested: { label: "Interesado", color: "#047857", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.35)", icon: "🟢" },
  question: { label: "Pregunta", color: "#1d4ed8", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.35)", icon: "🔵" },
  not_interested: { label: "No interesado", color: "#b91c1c", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.35)", icon: "🔴" },
};

function getFileIcon(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "🖼️";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx"].includes(ext)) return "📘";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📗";
  if (["ppt", "pptx"].includes(ext)) return "📙";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return "🎵";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "🎬";
  if (["txt", "md"].includes(ext)) return "📄";
  if (["js", "ts", "tsx", "jsx", "py", "html", "css", "json"].includes(ext)) return "💻";
  return "📎";
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function fmtDate(d: string): string {
  if (!d) return "";
  const date = new Date(d);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("es", { day: "2-digit", month: "short" });
}

const appShell: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "240px 360px 1fr", height: "100vh",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  background: "#fff", color: "#0f172a",
};
const sidebar: React.CSSProperties = {
  background: "#f8fafc", borderRight: "1px solid #e2e8f0",
  padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10, overflow: "hidden",
};
const brandRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "0 4px 8px",
  borderBottom: "1px solid #e2e8f0", marginBottom: 4,
};
const logoBox: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "linear-gradient(145deg, #6366f1, #818cf8)",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 17, color: "#fff",
};
const composeBtn: React.CSSProperties = {
  padding: "10px 12px", background: "#0071e3", color: "#fff",
  border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: "pointer",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: "#94a3b8",
  letterSpacing: "0.05em", textTransform: "uppercase", padding: "12px 6px 4px",
};
const folderBtn: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", background: "transparent", border: 0,
  borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#334155", fontFamily: "inherit",
};
const folderActive: React.CSSProperties = {
  background: "rgba(99,102,241,0.1)", color: "#4f46e5", fontWeight: 700,
};
const accountList: React.CSSProperties = {
  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2,
};
const accountBtn: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left", background: "transparent", border: 0,
  borderRadius: 8, cursor: "pointer", fontFamily: "inherit", color: "#334155",
};
const accountActive: React.CSSProperties = {
  background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)",
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 12px", background: "#fff", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 12.5, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const listPane: React.CSSProperties = {
  borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden",
};
const toolbar: React.CSSProperties = { padding: "12px 14px", borderBottom: "1px solid #e2e8f0" };
const searchInput: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8,
  fontSize: 13.5, outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const messagesList: React.CSSProperties = {
  flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
};
const msgItem: React.CSSProperties = {
  padding: "12px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
};
const msgItemActive: React.CSSProperties = { background: "rgba(99,102,241,0.08)" };
const emptyState: React.CSSProperties = {
  padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13.5,
};
const detailPane: React.CSSProperties = { overflow: "auto", background: "#fff" };
const emptyDetail: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", textAlign: "center",
};
const detailContent: React.CSSProperties = { padding: "28px 32px", maxWidth: 900 };
const actionBtn: React.CSSProperties = {
  padding: "7px 14px", background: "#0071e3", color: "#fff", border: 0,
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const actionBtnSecondary: React.CSSProperties = {
  padding: "7px 14px", background: "#fff", border: "1px solid #cbd5e1", color: "#475569",
  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const loadingScreen: React.CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", background: "#fafbfc",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
};
const spinner: React.CSSProperties = {
  width: 28, height: 28, border: "3px solid #e2e8f0",
  borderTopColor: "#0071e3", borderRadius: "50%",
  animation: "spin 0.7s linear infinite",
};
const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalCard: React.CSSProperties = {
  background: "#fff", borderRadius: 14, width: "100%", maxWidth: 600,
  margin: 20, overflow: "hidden", boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
};
const modalHeader: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 20px", borderBottom: "1px solid #e2e8f0",
};
const closeBtn: React.CSSProperties = {
  background: 0, border: 0, fontSize: 18, cursor: "pointer", color: "#64748b",
};
const modalFooter: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px",
  borderTop: "1px solid #e2e8f0", background: "#f8fafc",
};
const cancelBtn: React.CSSProperties = {
  padding: "8px 16px", background: "#fff", border: "1px solid #cbd5e1",
  borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "#475569",
};
const sendBtn: React.CSSProperties = {
  padding: "8px 20px", background: "#0071e3", color: "#fff", border: 0,
  borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const composeLabel: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#64748b",
  letterSpacing: "0.04em", textTransform: "uppercase", marginTop: 14, marginBottom: 5,
};
const composeInput: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 13.5, outline: "none", fontFamily: "inherit",
  boxSizing: "border-box", background: "#fff",
};
const errorBox: React.CSSProperties = {
  marginTop: 14, padding: "10px 14px", background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8,
  color: "#dc2626", fontSize: 13,
};
