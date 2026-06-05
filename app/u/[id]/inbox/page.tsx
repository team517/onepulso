"use client";
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

type Msg = any;
type Account = any;

export default function ClientInboxPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [me, setMe] = useState<any>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [lastSyncTs, setLastSyncTs] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [warmupCount, setWarmupCount] = useState(0);
  // Por defecto warmup OCULTO. La preferencia se persiste en localStorage por
  // unibox, así que si el usuario decide mostrarlos, se queda mostrando entre
  // recargas; si los oculta, se queda ocultando.
  const [showWarmup, setShowWarmupState] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  function setShowWarmup(v: boolean) {
    setShowWarmupState(v);
    try { localStorage.setItem(`unibox_show_warmup_${id}`, v ? "1" : "0"); } catch {}
  }
  useEffect(() => {
    try {
      const v = localStorage.getItem(`unibox_show_warmup_${id}`);
      if (v === "1") setShowWarmupState(true);
    } catch {}
  }, [id]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  // Carpetas custom del usuario (creadas en runtime)
  const [folders, setFolders] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#6366f1");
  const [savingFolder, setSavingFolder] = useState(false);
  // Filtro: una de las "carpetas de sistema" o una custom (folder_id)
  // Filtro de bandeja: "all" muestra todo, "sent" sólo los que enviaste,
  // "received" sólo los recibidos (los entrantes del prospect).
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | "sent" | "received" | folderId
  const [selectedMsg, setSelectedMsg] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<any>({});
  const [syncing, setSyncing] = useState(false);

  // Init
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/unibox-client/me");
      const d = await r.json();
      if (!d.authenticated || d.uniboxId !== id) {
        router.push(`/u/${id}/login`);
        return;
      }
      setMe(d);
      await Promise.all([loadAccounts(), loadMessages(), loadReminders()]);
    })();
  }, [id]);

  async function loadAccounts() {
    try {
      const r = await fetch(`/api/uniboxes/${id}/accounts`);
      if (r.ok) {
        const data = await r.json();
        // PROTECCIÓN: si la API devuelve [] cuando ya tenemos cuentas cargadas,
        // NO sobreescribimos. Probable error transitorio (sesión renovándose,
        // race entre peticiones, etc.) que antes vaciaba la lista en pantalla.
        if (Array.isArray(data)) {
          setAccounts((prev) => {
            if (data.length === 0 && prev.length > 0) {
              console.warn("[unibox] loadAccounts devolvio [] pero teniamos", prev.length, "→ ignorando para no perder estado");
              return prev;
            }
            return data;
          });
        }
      } else if (r.status === 401) {
        console.warn("[unibox] 401 al cargar cuentas — sesión inválida, redirigiendo a login");
        router.push(`/u/${id}/login`);
      } else {
        console.error("[unibox] error cargando cuentas:", r.status);
        // NO limpiar accounts en caso de error transitorio.
      }
    } catch (e) {
      console.error("[unibox] loadAccounts fetch error:", e);
      // NO limpiar accounts en caso de error de red.
    }
  }

  async function loadReminders() {
    try {
      const r = await fetch(`/api/uniboxes/${id}/reminders`);
      if (r.ok) {
        const d = await r.json();
        setReminders(d.reminders || []);
      }
    } catch {}
  }

  /** Re-aplica la detección actual de warmup a toda la caché. Útil cuando
   *  los mensajes se guardaron con un algoritmo anterior y aparecen como
   *  no-warmup pese a tener subjects con patrones de warmup obvios. */
  async function reclassifyNow(silent = false) {
    setReclassifying(true);
    try {
      const r = await fetch(`/api/uniboxes/${id}/reclassify`, { method: "POST" });
      if (r.ok && !silent) {
        const d = await r.json();
        const purgedNote = d.purged ? ` · ${d.purged} test/bounce purgados` : "";
        alert(`Re-clasificación: ${d.warmup} warmup de ${d.total} totales${purgedNote}. Bandeja limpia ✓`);
      }
      await loadMessages();
    } finally {
      setReclassifying(false);
    }
  }

  // PERFORMANCE: quitamos el auto-reclassify diario al cargar — la
  // reclassificación ya se ejecuta en syncUnibox() tras cada sync IMAP,
  // así que llamarla otra vez en cada primer load del día era trabajo
  // duplicado que ralentizaba la apertura del unibox.

  async function loadMessages() {
    const p = new URLSearchParams();
    if (selectedAccount) p.set("account", selectedAccount);
    if (showWarmup) p.set("show_warmup", "1");
    // all=1 → traer TODOS los mensajes (no cortar a 500 como antes).
    p.set("all", "1");
    const r = await fetch(`/api/uniboxes/${id}/messages?${p}`);
    if (r.ok) {
      const d = await r.json();
      setMessages(d.messages || []);
      setWarmupCount(d.warmupCount || 0);
    }
  }

  useEffect(() => { if (me) loadMessages(); }, [selectedAccount, showWarmup]);

  async function loadFolders() {
    try {
      const r = await fetch(`/api/uniboxes/${id}/folders`);
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setFolders(data);
      }
    } catch {}
  }
  useEffect(() => { if (me) loadFolders(); }, [me, id]);

  function openFolderModal() {
    setNewFolderName("");
    setNewFolderColor("#6366f1");
    setFolderModalOpen(true);
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setSavingFolder(true);
    try {
      const r = await fetch(`/api/uniboxes/${id}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newFolderColor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "no se pudo crear");
      // Añadir la carpeta nueva al state y seleccionarla para que el
      // usuario vea claramente que apareció.
      setFolders((prev) => [...prev, d]);
      setFolderFilter(d.id);
      setFolderModalOpen(false);
      // Refresh background (por si otra pestaña creó otras también)
      loadFolders().catch(() => {});
    } catch (e: any) {
      alert("Error al crear carpeta: " + (e?.message || e));
    } finally {
      setSavingFolder(false);
    }
  }

  async function removeFolder(folderId: string) {
    if (!confirm("¿Eliminar carpeta? Los mensajes que tenía vuelven a la bandeja general.")) return;
    try {
      const r = await fetch(`/api/uniboxes/${id}/folders/${folderId}`, { method: "DELETE" });
      if (r.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        if (folderFilter === folderId) setFolderFilter("all");
        await loadMessages();
      }
    } catch {}
  }

  async function moveToFolder(accountId: string, uid: number, folderId: string | null) {
    // Update optimista — actualiza el listado Y el mensaje seleccionado
    setMessages((prev) => prev.map((m: any) =>
      m.accountId === accountId && m.uid === uid ? { ...m, folder_id: folderId } : m
    ));
    setSelectedMsg((prev: any) =>
      prev && prev.accountId === accountId && prev.uid === uid
        ? { ...prev, folder_id: folderId }
        : prev
    );
    // Si estamos viendo "Todos" y movemos a una carpeta, el msg desaparece
    // del listado (gracias a carpetas exclusivas). Si estábamos viendo la
    // carpeta destino, el msg aparece. Auto-saltamos a la carpeta destino
    // si no estamos viendo "Todos" (UX: confirmación visual de dónde fue).
    if (folderId && folderFilter !== "all" && folderFilter !== folderId) {
      // Si estaba en otra carpeta o en Recibidos/Enviados, mantenerlo
      // visible saltando a la carpeta destino.
      setFolderFilter(folderId);
    }
    try {
      const r = await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}/folder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      if (!r.ok) {
        // Rollback si falla el servidor
        await loadMessages();
      }
    } catch {
      await loadMessages();
    }
  }

  // PERFORMANCE: refresh del cache cada 20s en lugar de 10s. El sync IMAP
  // se dispara a los 20s también, así que coordinamos. Antes el cache se
  // recargaba a los 10s + sync a los 20s = 6 fetches/min innecesarios.
  // Después de cada sync exitoso, loadMessages() ya se llama directamente
  // así que el refresh extra solo cubre casos edge.
  useEffect(() => {
    if (!me) return;
    const tick = () => { if (!document.hidden) loadMessages(); };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [me, selectedAccount, showWarmup]);

  // Sync IMAP cada 20s cuando la pestaña está activa (antes 60s).
  // Esto es seguro porque el sync ahora es INCREMENTAL: cada cuenta
  // sólo trae UIDs > last_uid_seen, así que un sync vacío cuesta
  // <100ms por cuenta. 40 cuentas en paralelo = ~3-5s totales.
  // Equivalente a lo que hace Instantly (poll constante + IMAP IDLE).
  useEffect(() => {
    if (!me || accounts.length === 0) return;
    const doSync = async () => {
      if (document.hidden) return;
      if (syncingRef.current) return; // anti-overlap
      syncingRef.current = true;
      setIsSyncing(true);
      try {
        await fetch(`/api/uniboxes/${id}/sync-all`, { method: "POST" });
        await loadMessages();
        setLastSyncTs(Date.now());
      } catch {}
      finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    };

    // AUTO-RESCATE en primera carga: si las cuentas no tienen last_sync
    // reciente (>3 min), forzamos un sync completo silencioso. Esto
    // garantiza que aunque el scheduler de backend haya estado caído,
    // al abrir el unibox automáticamente recuperamos lo perdido.
    const autoRescue = async () => {
      const stale = accounts.some((a: any) => {
        if (!a.last_sync) return true;
        const ageMs = Date.now() - new Date(a.last_sync).getTime();
        return ageMs > 3 * 60_000; // >3 min sin sync
      });
      if (!stale) return;
      if (syncingRef.current) return;
      console.log("[unibox] auto-rescate: alguna cuenta lleva >3 min sin sync → force-resync");
      syncingRef.current = true;
      setIsSyncing(true);
      try {
        await fetch(`/api/uniboxes/${id}/force-resync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await loadMessages();
        setLastSyncTs(Date.now());
      } catch {}
      finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    };

    // KEEPALIVE del scheduler backend: pingeamos /api/cron/tick cada 60s
    // para asegurar que el background scheduler (que puede dormirse en
    // Railway) siga vivo. Idempotente — sólo arranca el scheduler si
    // está caído, no duplica.
    const keepalive = () => {
      fetch(`/api/cron/tick`, { method: "GET" }).catch(() => {});
    };
    keepalive();
    const keepaliveInterval = setInterval(keepalive, 60_000);

    // 1. Auto-rescate inmediato (si hace falta) — primera carga
    autoRescue();
    // 2. Sync incremental a los 2s y luego cada 20s
    const initial = setTimeout(doSync, 2000);
    const interval = setInterval(doSync, 20_000);
    // Cuando la pestaña vuelve a primer plano tras estar oculta, sync inmediato
    // + chequeo de auto-rescate (si estuvo cerrada mucho rato)
    const onVisible = () => {
      if (!document.hidden) {
        autoRescue().then(() => doSync());
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      clearInterval(keepaliveInterval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, accounts.length, id]);

  async function openMessage(accountId: string, uid: number) {
    const r = await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}`);
    if (r.ok) {
      const m = await r.json();
      setSelectedMsg({ ...m, accountId });
      // Disparar busqueda profunda de conversacion con el contacto.
      // Esto pulla del IMAP (INBOX + Sent) los ultimos 90 dias con esa
      // persona, ideal para ver el hilo completo aunque el local no lo tenga.
      const contact = normalizeContactAddr(m, accountId);
      if (contact) loadConversationForContact(contact, accountId);
    }
  }

  function normalizeContactAddr(m: any, accountId: string): string | null {
    const myEmails = new Set(accounts.map((a) => (a.email || "").toLowerCase()));
    const fromAddr = (m.fromAddress || "").toLowerCase();
    const toAddrFirst = (m.toAddress || "").toLowerCase();
    if (fromAddr && !myEmails.has(fromAddr)) return fromAddr;
    if (toAddrFirst && !myEmails.has(toAddrFirst)) return toAddrFirst;
    return null;
  }

  // Para no re-tirar del IMAP cada vez que abrimos el mismo contacto
  const fetchedContactsRef = useRef<Set<string>>(new Set());
  async function loadConversationForContact(contact: string, accountId: string) {
    const key = `${accountId}|${contact}`;
    if (fetchedContactsRef.current.has(key)) return;
    fetchedContactsRef.current.add(key);
    try {
      const r = await fetch(`/api/uniboxes/${id}/conversation?contact=${encodeURIComponent(contact)}&accountId=${encodeURIComponent(accountId)}`);
      if (r.ok) {
        const d = await r.json();
        if (d.imported > 0) {
          // recargar la lista de mensajes para que aparezca el histórico nuevo
          loadMessages();
        }
      }
    } catch (e) {
      console.warn("[unibox] loadConversationForContact failed", e);
    }
  }

  /** Borra un mensaje individual de la cache. No toca IMAP remoto. */
  async function deleteMessage(accountId: string, uid: number, confirmFirst = true) {
    if (confirmFirst && !confirm("¿Eliminar este mensaje de la bandeja?\n\nSólo se borra de la plataforma. Si vuelve a sincronizarse desde IMAP, reaparecerá.")) return;
    const r = await fetch(`/api/uniboxes/${id}/messages/${accountId}/${uid}`, { method: "DELETE" });
    if (r.ok) {
      // Actualizar local sin esperar al fetch
      setMessages((prev) => prev.filter((m) => !(m.accountId === accountId && m.uid === uid)));
      if (selectedMsg && selectedMsg.accountId === accountId && selectedMsg.uid === uid) {
        setSelectedMsg(null);
      }
    } else {
      const d = await r.json().catch(() => ({}));
      alert("Error al eliminar: " + (d.error || "desconocido"));
    }
  }

  async function logout() {
    await fetch("/api/unibox-client/logout", { method: "POST" });
    router.push(`/u/${id}/login`);
  }

  async function syncAll() {
    if (accounts.length === 0) return;
    setSyncing(true);
    const ids = accounts.map(a => a.id).join(",");
    const es = new EventSource(`/api/uniboxes/${id}/sync-stream?ids=${ids}`);
    es.addEventListener("done", async () => {
      es.close();
      setSyncing(false);
      await loadMessages();
      setLastSyncTs(Date.now());
    });
    es.onerror = () => { es.close(); setSyncing(false); };
  }

  // Formato amigable del timestamp última sync
  function fmtLastSync(): string {
    if (!lastSyncTs) return "esperando primera sync…";
    const sec = Math.floor((Date.now() - lastSyncTs) / 1000);
    if (sec < 5) return "ahora mismo";
    if (sec < 60) return `hace ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.floor(min / 60)}h`;
  }
  // Forzar re-render del timestamp cada 10s
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((v) => v + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  async function clearAllMessages() {
    if (!confirm("¿Eliminar TODOS los mensajes de la bandeja?\n\nLas cuentas IMAP permanecen conectadas. Si quieres recuperar los mensajes válidos, pulsa luego 'Sincronizar todo'.")) return;
    try {
      const r = await fetch(`/api/uniboxes/${id}/messages?mode=all`, { method: "DELETE" }).then((r) => r.json());
      if (r.ok) {
        await loadMessages();
      } else {
        alert("Error: " + (r.error || "desconocido"));
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  function replyTo(m: any) {
    const replyAddr = m.fromAddress || m.from || "";
    const subj = /^re:/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
    const dateStr = new Date(m.date).toLocaleString("es");
    const quoted = `<br><br><div style="border-left:3px solid #ccc;padding-left:10px;color:#666;margin-top:14px">
      <div style="font-size:12px;color:#888">El ${dateStr}, ${m.from || ""} escribió:</div>
      <br>${m.html || (m.text || "").replace(/\n/g, "<br>")}
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: replyAddr,
      subject: subj,
      body: quoted,
      inReplyTo: m.messageId,
      references: (m.references || []).join(" "),
    });
    setComposeOpen(true);
  }

  function newCompose() {
    setComposeData({
      accountId: accounts[0]?.id || "",
      to: "", subject: "", body: "",
    });
    setComposeOpen(true);
  }

  function forwardMsg(m: any) {
    const subj = /^fwd?:/i.test(m.subject || "") ? m.subject : `Fwd: ${m.subject || ""}`;
    const dateStr = new Date(m.date).toLocaleString("es");
    const fwdBlock = `<br><br><div style="border-top:1px solid #ddd;padding-top:14px;margin-top:14px;color:#475569">
      <div style="font-size:12px"><strong>---------- Mensaje reenviado ----------</strong></div>
      <div style="font-size:12px"><strong>De:</strong> ${escapeHtml(m.from || "")}</div>
      <div style="font-size:12px"><strong>Fecha:</strong> ${dateStr}</div>
      <div style="font-size:12px"><strong>Asunto:</strong> ${escapeHtml(m.subject || "")}</div>
      <div style="font-size:12px"><strong>Para:</strong> ${escapeHtml(m.to || "")}</div>
      <br>${m.html || (m.text || "").replace(/\n/g, "<br>")}
    </div>`;
    setComposeData({
      accountId: m.accountId,
      to: "",
      subject: subj,
      body: fwdBlock,
      // No incluimos inReplyTo / references — es un mensaje NUEVO (no reply)
    });
    setComposeOpen(true);
  }

  if (!me) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Cargando…</div>;

  // PERFORMANCE: memoizamos todo lo que se recalcula con cada render.
  // Antes en 5000 msgs cada cambio de search/folder = 4 .filter() sobre
  // 5000 items + 2 contadores. Con useMemo solo se recalcula si cambian
  // las deps reales.

  // Helper: ¿el mensaje fue ENVIADO por nosotros? UID < 0 (sent folder) o
  // remitente coincide con una cuenta nuestra.
  const myEmailsSet = useMemo(
    () => new Set(accounts.map((a: any) => (a.email || "").toLowerCase())),
    [accounts]
  );
  const isOutboundMsg = useCallback((m: any) => {
    if (typeof m.uid === "number" && m.uid < 0) return true;
    const fromAddr = (m.fromAddress || m.from || "").toLowerCase();
    if (fromAddr && myEmailsSet.has(fromAddr)) return true;
    const match = (m.from || "").match(/<([^>]+)>/);
    if (match && myEmailsSet.has(match[1].toLowerCase())) return true;
    return false;
  }, [myEmailsSet]);

  // Pre-calcular outbound/inbound UNA sola vez para todos los mensajes.
  // CARPETAS EXCLUSIVAS: si un mensaje tiene folder_id (movido a carpeta
  // custom), NO aparece en "Todos" / "Recibidos" / "Enviados". Solo
  // aparece en la carpeta donde fue movido. Comportamiento estilo
  // carpeta (no etiqueta) — como pidió el usuario.
  const { sentMessages, receivedMessages, unfiledMessages } = useMemo(() => {
    const sent: any[] = [];
    const recv: any[] = [];
    const unfiled: any[] = [];
    for (const m of messages) {
      // Mensajes movidos a carpeta custom NO entran en las bandejas globales
      if ((m as any).folder_id) continue;
      unfiled.push(m);
      if (isOutboundMsg(m)) sent.push(m); else recv.push(m);
    }
    return { sentMessages: sent, receivedMessages: recv, unfiledMessages: unfiled };
  }, [messages, isOutboundMsg]);

  const baseList = useMemo(() => {
    if (folderFilter === "sent") return sentMessages;
    if (folderFilter === "received") return receivedMessages;
    if (folderFilter === "all") return unfiledMessages;
    return messages.filter((m: any) => m.folder_id === folderFilter);
  }, [folderFilter, messages, sentMessages, receivedMessages, unfiledMessages]);

  const filteredAll = useMemo(() => {
    if (!search) return baseList;
    const q = search.toLowerCase();
    return baseList.filter((m: any) =>
      (m.from || "").toLowerCase().includes(q) ||
      (m.to || "").toLowerCase().includes(q) ||
      (m.subject || "").toLowerCase().includes(q) ||
      (m.preview || "").toLowerCase().includes(q)
    );
  }, [baseList, search]);

  // PERFORMANCE: virtualización ligera. Solo renderizamos N items.
  // El usuario casi nunca baja de 300 (scroll). Si lo hace, sube el cap.
  const [visibleCap, setVisibleCap] = useState(300);
  useEffect(() => { setVisibleCap(300); }, [folderFilter, selectedAccount, search]); // reset al cambiar filtro
  const filtered = useMemo(
    () => filteredAll.slice(0, visibleCap),
    [filteredAll, visibleCap]
  );
  const hasMoreToShow = filteredAll.length > visibleCap;

  const sentCount = sentMessages.length;
  const receivedCount = receivedMessages.length;

  // PERFORMANCE: account lookup O(1) — antes accounts.find() en cada
  // mensaje renderizado = O(N×M). Con 1500 msgs × 40 cuentas = 60k ops.
  const accountsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  // PERFORMANCE: índice de reminders por (accountId+recipient) para no
  // hacer reminders.find() en cada mensaje outbound.
  const remindersIndex = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of reminders) {
      if (r.status !== "pending") continue;
      const key = `${r.account_id}|${(r.recipient || "").toLowerCase()}`;
      map.set(key, r);
    }
    return map;
  }, [reminders]);

  // Build thread for selected msg — matching ROBUSTO con múltiples capas.
  // Subject normalizado: quita "Re:", "Fwd:", "RV:", "FW:" y los acoplados
  // ([EXT], [SPAM], etc.) y trim+lower.
  const normSubj = (s: string) => (s || "")
    .replace(/^\s*(re|fwd|rv|fw)\s*:\s*/gi, "")
    .replace(/^\s*\[[^\]]+\]\s*/g, "") // quitar [EXT] etc
    .replace(/^\s*(re|fwd|rv|fw)\s*:\s*/gi, "") // re-strip Re: si quedaba
    .trim()
    .toLowerCase();
  // Message-IDs: quita <...> y normaliza
  const normMid = (s: string) => (s || "").trim().replace(/^<+|>+$/g, "").toLowerCase();
  // Address: trim + lower del email puro (quita el "Nombre <email>")
  const normAddr = (s: string) => {
    if (!s) return "";
    const m = s.match(/<([^>]+)>/);
    return (m ? m[1] : s).toLowerCase().trim();
  };

  const thread = selectedMsg
    ? (() => {
        const selMid = normMid(selectedMsg.messageId);
        const selInReply = normMid(selectedMsg.inReplyTo);
        const selRefs = (selectedMsg.references || []).map(normMid);
        const selSubj = normSubj(selectedMsg.subject);
        const selFromAddr = normAddr(selectedMsg.fromAddress || selectedMsg.from);
        const selToAddr = normAddr(selectedMsg.toAddress || selectedMsg.to);
        // El "contacto externo" es el que NO es una de mis cuentas — es la
        // otra parte de la conversación. Si selectedMsg es entrante (inbound),
        // el contacto es el fromAddr. Si es enviado por mi (outbound), el
        // contacto es el toAddr.
        const myEmails = new Set(accounts.map((a) => (a.email || "").toLowerCase()));
        const selFromMine = myEmails.has(selFromAddr);
        const contactAddr = selFromMine ? selToAddr : selFromAddr;

        return messages.filter((x) => {
          if (x.accountId === selectedMsg.accountId && x.uid === selectedMsg.uid) return false;

          // CAPA 1: Match estricto por Message-ID / In-Reply-To / References
          const xInReply = normMid(x.inReplyTo);
          const xRefs = (x.references || []).map(normMid);
          const xMid = normMid(x.messageId);
          if (selMid && (xInReply === selMid || xRefs.includes(selMid))) return true;
          if (xMid && (selInReply === xMid || selRefs.includes(xMid))) return true;
          if (xRefs.length > 0 && selRefs.length > 0) {
            for (const r of xRefs) if (r && selRefs.includes(r)) return true;
          }

          // CAPA 2: Mismo subject normalizado (cubre clientes que rompen Message-ID)
          const xSubj = normSubj(x.subject);
          if (selSubj && xSubj === selSubj) return true;

          // CAPA 3: Conversación con el MISMO contacto.
          // Cualquier mensaje donde el contacto sea remitente o destinatario.
          if (contactAddr) {
            const xFrom = normAddr(x.fromAddress || x.from);
            const xTo = normAddr(x.toAddress || x.to);
            if (xFrom === contactAddr || xTo === contactAddr) {
              // Limitar a misma cuenta o cross-account si comparte subject parcial
              // → ya cubierto arriba. Aquí incluimos TODOS los mensajes con
              // ese contacto, sea sent o received.
              if (x.accountId === selectedMsg.accountId) return true;
              // Si es otra cuenta, sólo si subject coincide razonablemente
              if (selSubj && xSubj && (xSubj.includes(selSubj) || selSubj.includes(xSubj))) return true;
            }
          }
          return false;
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      })()
    : [];

  return (
    <div style={appStyle} className="unibox-app">
      <aside style={sidebarStyle} className={`unibox-sidebar ${selectedMsg ? "is-hidden-mobile" : ""}`}>
        <div style={brandRow}>
          <div style={logoMark}>✉</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{me.title}</div>
            <div style={{ fontSize: 11, color: "#8b94a7" }}>{me.clientEmail}</div>
          </div>
        </div>

        <button style={composeBtn} onClick={newCompose}>+ Redactar</button>

        {/* Filtros tipo carpeta: Todos / Recibidos / Enviados */}
        <div style={sectionTitle}>CARPETAS</div>
        <div style={folderListStyle}>
          <FolderPill
            label="Todos"
            icon="📥"
            count={unfiledMessages.length}
            active={folderFilter === "all"}
            onClick={() => setFolderFilter("all")}
          />
          <FolderPill
            label="Recibidos"
            icon="📨"
            count={receivedCount}
            active={folderFilter === "received"}
            onClick={() => setFolderFilter("received")}
          />
          <FolderPill
            label="Enviados"
            icon="📤"
            count={sentCount}
            active={folderFilter === "sent"}
            onClick={() => setFolderFilter("sent")}
            accent="brand"
          />
          {/* Carpetas custom del usuario */}
          {folders.map((f) => {
            const count = messages.filter((m: any) => m.folder_id === f.id).length;
            return (
              <div key={f.id} style={{ position: "relative" }}>
                <FolderPill
                  label={f.name}
                  icon="📁"
                  count={count}
                  active={folderFilter === f.id}
                  onClick={() => setFolderFilter(f.id)}
                  customColor={f.color}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFolder(f.id); }}
                  style={{
                    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: 0, color: "#94a3b8",
                    cursor: "pointer", fontSize: 12, padding: 4, lineHeight: 1,
                    opacity: 0.7,
                  }}
                  title="Eliminar carpeta"
                >✕</button>
              </div>
            );
          })}
          {/* Botón añadir carpeta */}
          <button
            onClick={openFolderModal}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", marginTop: 2,
              background: "transparent", border: "1px dashed #cbd5e1",
              borderRadius: 8, color: "#64748b",
              fontSize: 12.5, fontWeight: 500,
              cursor: "pointer", textAlign: "left",
            }}
            title="Crear una carpeta para organizar mensajes"
          >
            <span style={{ fontSize: 14 }}>＋</span> Nueva carpeta
          </button>
        </div>

        <div style={sectionTitle}>BANDEJAS</div>
        <div style={accountList}>
          <div
            style={{ ...accountItem, ...(selectedAccount === null ? activeAccount : {}) }}
            onClick={() => setSelectedAccount(null)}
          >
            <div style={dotStyle}></div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={accountEmail}>Todas las cuentas</div>
              <div style={accountHost}>{accounts.length} buzones</div>
            </div>
          </div>
          {accounts.map(a => (
            <div key={a.id}
              style={{ ...accountItem, ...(selectedAccount === a.id ? activeAccount : {}) }}
              onClick={() => setSelectedAccount(a.id)}
            >
              <div style={{ ...dotStyle, background: a.last_error ? "#ef4444" : "#10b981" }} title={a.last_error || "OK"}></div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={accountEmail}>{a.email}</div>
                <div style={accountHost}>{[a.first_name, a.last_name].filter(Boolean).join(" ") || a.imap_host}</div>
              </div>
            </div>
          ))}
        </div>

        <button style={ghostBtn} onClick={syncAll} disabled={syncing}>
          {syncing ? "Sincronizando…" : "↻ Sincronizar todo"}
        </button>
        <div style={{
          fontSize: 10.5, color: "#94a3b8",
          textAlign: "center", padding: "2px 4px",
          letterSpacing: "0.02em",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          {isSyncing && (
            <span style={{
              display: "inline-block", width: 7, height: 7, borderRadius: "50%",
              background: "#10b981", animation: "pulse 1.2s ease-in-out infinite",
            }} />
          )}
          {isSyncing ? (
            <span style={{ color: "#10b981", fontWeight: 600 }}>Sincronizando…</span>
          ) : (
            <>Última sync: <strong style={{ color: lastSyncTs ? "#10b981" : "#94a3b8" }}>{fmtLastSync()}</strong></>
          )}
        </div>
        <button
          style={{ ...ghostBtn, fontSize: 11.5, color: "#f59e0b", borderColor: "rgba(245,158,11,0.3)" }}
          onClick={async () => {
            if (!confirm("Esto trae los últimos 1500 mensajes por cuenta desde IMAP (puede tardar 1-2 min). ¿Continuar?")) return;
            setIsSyncing(true);
            try {
              const r = await fetch(`/api/uniboxes/${id}/force-resync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
              const data = await r.json().catch(() => ({}));
              await loadMessages();
              setLastSyncTs(Date.now());
              alert(`Resync completo: ${data?.totalInbox || 0} INBOX + ${data?.totalSent || 0} Sent recuperados en ${data?.accounts || 0} cuentas.${data?.errors ? ` ${data.errors} errores.` : ""}`);
            } catch (e: any) {
              alert("Error en force-resync: " + (e?.message || e));
            } finally {
              setIsSyncing(false);
            }
          }}
          title="Trae los últimos 1500 mensajes de IMAP forzando bypass del estado incremental — usar si crees que faltan mensajes"
        >
          🔧 Forzar resync completo
        </button>
        <button style={ghostBtn} onClick={() => setSignatureModalOpen(true)} title="Gestionar firmas de cada cuenta">
          ✍ Firmas
        </button>
        <button style={{ ...ghostBtn, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} onClick={logout}>
          Cerrar sesión
        </button>
      </aside>

      <section style={listPaneStyle} className={`unibox-list ${selectedMsg ? "is-hidden-mobile" : ""}`}>
        <div style={toolbarStyle}>
          <input
            type="text"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchStyle}
          />
          <button
            onClick={syncAll}
            disabled={syncing || accounts.length === 0}
            title="Sincronizar AHORA todas las cuentas (busca mensajes nuevos en IMAP)"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 13px",
              background: syncing ? "#cbd5e1" : "linear-gradient(135deg, #0071e3, #1d4ed8)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: syncing ? "wait" : "pointer",
              fontFamily: "inherit",
              boxShadow: syncing ? "none" : "0 2px 6px rgba(0,113,227,0.3)",
              transition: "all 0.15s",
            }}
          >
            <span style={{
              display: "inline-block",
              animation: syncing ? "spin 1s linear infinite" : "none",
              fontSize: 14,
            }}>↻</span>
            <span>{syncing ? "Sincronizando…" : "Refrescar"}</span>
          </button>
          {warmupCount > 0 && (
            <button
              onClick={() => setShowWarmup(!showWarmup)}
              title={showWarmup
                ? "Quitar los mensajes de warmup de la bandeja"
                : "Volver a mostrar los mensajes de warmup"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px",
                background: showWarmup ? "#fff" : "rgba(0,113,227,0.08)",
                border: showWarmup
                  ? "1px solid rgba(15,23,42,0.12)"
                  : "1px solid rgba(0,113,227,0.25)",
                borderRadius: 999,
                color: showWarmup ? "#475569" : "#0071e3",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {showWarmup ? "🧹" : "🛡"}
              <span>{showWarmup ? `Ocultar warmup (${warmupCount})` : `Mostrar warmup (${warmupCount})`}</span>
            </button>
          )}
          <button
            onClick={() => reclassifyNow(false)}
            disabled={reclassifying}
            title="Re-aplica la detección de warmup a todos los mensajes ya descargados (útil si aparecen colados)"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid rgba(15,23,42,0.12)",
              borderRadius: 999,
              color: "#475569",
              fontSize: 12,
              fontWeight: 500,
              cursor: reclassifying ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: reclassifying ? 0.6 : 1,
            }}
          >
            <span style={{ animation: reclassifying ? "spin 1s linear infinite" : "none", display: "inline-block" }}>🔍</span>
            {reclassifying ? "Re-detectando…" : "Re-detectar warmup"}
          </button>
          {messages.length > 0 && (
            <button
              style={{ ...linkBtn, color: "#dc2626", marginLeft: "auto" }}
              onClick={clearAllMessages}
              title="Borrar todos los mensajes de la bandeja"
            >
              🗑 Eliminar mensajes
            </button>
          )}
        </div>
        <div style={messagesList}>
          {filtered.length === 0 ? (
            <div style={emptyStyle}>No hay mensajes en la bandeja.</div>
          ) : filtered.map(m => {
            const isSelected = selectedMsg && selectedMsg.uid === m.uid && selectedMsg.accountId === m.accountId;
            const acc = accountsById.get(m.accountId);
            const isOutbound = isOutboundMsg(m);
            const pendingReminder = isOutbound && m.toAddress
              ? remindersIndex.get(`${m.accountId}|${String(m.toAddress).toLowerCase()}`)
              : null;
            return (
              <div
                key={`${m.accountId}-${m.uid}`}
                style={{
                  ...messageItem,
                  ...(isSelected ? activeMessage : {}),
                  ...(m.unread ? unreadMessage : {}),
                  position: "relative",
                  ...(pendingReminder ? {
                    background: "linear-gradient(90deg, rgba(245,158,11,0.07), rgba(255,255,255,0))",
                    borderLeft: "3px solid #f59e0b",
                  } : {}),
                }}
                onClick={() => openMessage(m.accountId, m.uid)}
                className="unibox-msg-row"
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: m.unread ? 700 : 500, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {acc && <span style={accTag}>{acc.email.split("@")[0]}</span>}
                    {isOutbound && (
                      <span style={{
                        display: "inline-block",
                        background: "rgba(0,113,227,0.1)",
                        color: "#0071e3",
                        padding: "1px 5px",
                        borderRadius: 4,
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        marginRight: 5,
                        verticalAlign: 1,
                      }}>ENVIADO</span>
                    )}
                    {isOutbound
                      ? `Para: ${(m.to || "").replace(/<[^>]+>/, "").trim() || m.toAddress || ""}`
                      : (m.fromName || m.from)}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{fmtDate(m.date)}</div>
                </div>
                <div style={{ fontSize: 13, color: m.unread ? "#0f172a" : "#475569", fontWeight: m.unread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.subject || "(sin asunto)"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.preview}
                </div>
                {pendingReminder && (
                  <div style={{
                    marginTop: 6,
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: "rgba(245,158,11,0.15)",
                    color: "#b45309",
                    padding: "2px 8px",
                    borderRadius: 99,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                  }}>
                    ⏰ Reminder {(() => {
                      const ms = new Date(pendingReminder.scheduled_at).getTime() - Date.now();
                      if (ms < 0) return "en cualquier momento";
                      const hours = Math.round(ms / 3600000);
                      if (hours < 24) return `en ${hours}h`;
                      const days = Math.round(hours / 24);
                      return `en ${days}d`;
                    })()}
                  </div>
                )}
                {/* Botón papelera, visible al pasar el ratón */}
                <button
                  className="unibox-msg-del"
                  onClick={(e) => { e.stopPropagation(); deleteMessage(m.accountId, m.uid); }}
                  title="Eliminar este mensaje"
                  style={{
                    position: "absolute",
                    right: 10, top: 10,
                    background: "rgba(255,255,255,0.95)",
                    border: "1px solid rgba(15,23,42,0.12)",
                    borderRadius: 8,
                    width: 26, height: 26,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 13,
                    opacity: 0,
                    transition: "opacity 0.15s",
                    color: "#dc2626",
                  }}
                >🗑</button>
              </div>
            );
          })}
          {hasMoreToShow && (
            <button
              onClick={() => setVisibleCap((c) => c + 500)}
              style={{
                margin: "12px auto",
                padding: "10px 20px",
                background: "rgba(99,102,241,0.06)",
                border: "1px solid rgba(99,102,241,0.2)",
                borderRadius: 10,
                color: "#6366f1",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "block",
              }}
            >
              Mostrar 500 más ({filteredAll.length - visibleCap} ocultos)
            </button>
          )}
        </div>
      </section>

      <section style={viewPaneStyle} className={`unibox-view ${!selectedMsg ? "is-hidden-mobile" : ""}`}>
        {!selectedMsg ? (
          <div style={placeholderStyle}>
            <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>✉</div>
            <div>Selecciona un mensaje para verlo</div>
          </div>
        ) : (
          <div style={{ padding: "28px 36px", overflowY: "auto", height: "100%" }} className="unibox-view-inner">
            {/* Botón volver (solo móvil) */}
            <button
              onClick={() => setSelectedMsg(null)}
              className="unibox-back-mobile"
              aria-label="Volver a la bandeja"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Volver</span>
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em", flex: 1, minWidth: 200 }}>
                {selectedMsg.subject || "(sin asunto)"}
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={replyBtnStyle} onClick={() => replyTo(selectedMsg)}>↩ Responder</button>
                <button
                  onClick={() => forwardMsg(selectedMsg)}
                  title="Reenviar este mensaje a otra dirección"
                  style={{
                    background: "#fff",
                    border: "1px solid rgba(99,102,241,0.3)",
                    borderRadius: 10,
                    padding: "8px 12px",
                    color: "#6366f1",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                >↪ Reenviar</button>
                {/* Selector de carpeta — sólo aparece si hay carpetas creadas */}
                {folders.length > 0 && (
                  <select
                    value={(selectedMsg as any).folder_id || ""}
                    onChange={(e) => {
                      const fid = e.target.value || null;
                      moveToFolder(selectedMsg.accountId, selectedMsg.uid, fid);
                    }}
                    title="Mover este mensaje a una carpeta"
                    style={{
                      background: "#fff",
                      border: "1px solid rgba(99,102,241,0.3)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      color: "#6366f1",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: "inherit",
                    }}
                  >
                    <option value="">📁 Sin carpeta</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>📁 {f.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => deleteMessage(selectedMsg.accountId, selectedMsg.uid)}
                  title="Eliminar este mensaje de la bandeja"
                  style={{
                    background: "#fff",
                    border: "1px solid rgba(220,38,38,0.25)",
                    borderRadius: 10,
                    padding: "8px 12px",
                    color: "#dc2626",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                >🗑 Eliminar</button>
              </div>
            </div>
            <div style={{ paddingBottom: 18, borderBottom: "1px solid #e2e8f0", marginBottom: 18, fontSize: 13, color: "#64748b" }}>
              <div><b style={{ color: "#0f172a" }}>De:</b> {selectedMsg.from}</div>
              <div><b style={{ color: "#0f172a" }}>Para:</b> {selectedMsg.to}</div>
              <div><b style={{ color: "#0f172a" }}>Fecha:</b> {new Date(selectedMsg.date).toLocaleString("es")}</div>
            </div>
            <div
              style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937" }}
              dangerouslySetInnerHTML={{
                __html: selectedMsg.html
                  ? selectedMsg.html.replace(/<script[\s\S]*?<\/script>/gi, "")
                  : escapeHtml(selectedMsg.text || "").replace(/\n/g, "<br>")
              }}
            />
            {selectedMsg.attachments && selectedMsg.attachments.length > 0 && (
              <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid #e2e8f0", display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selectedMsg.attachments.map((a: any, i: number) => (
                  <div key={i} style={attachChip}>📎 {a.filename || "adjunto"} <span style={{ color: "#94a3b8" }}>({Math.round((a.size || 0) / 1024)} KB)</span></div>
                ))}
              </div>
            )}
            {thread.length > 0 ? (
              <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 14, flexWrap: "wrap", gap: 8,
                }}>
                  <div style={{
                    fontSize: 12, color: "#0071e3", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                    💬 Conversación completa con este contacto · {thread.length + 1} mensajes
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                    Orden cronológico ↓
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {thread.map(t => {
                    const isMine = accounts.some((a) => (a.email || "").toLowerCase() === ((t.fromAddress || "").toLowerCase()));
                    return (
                      <ThreadCard
                        key={`${t.accountId}-${t.uid}`}
                        msg={t}
                        isMine={isMine}
                        onLoadFull={() => openMessage(t.accountId, t.uid)}
                        onDelete={() => deleteMessage(t.accountId, t.uid)}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{
                marginTop: 28, paddingTop: 18, borderTop: "1px solid #e2e8f0",
                fontSize: 12.5, color: "var(--text-faint)", textAlign: "center",
                padding: "14px 12px",
                background: "var(--surface-2)",
                borderRadius: 10,
              }}>
                💬 Este es el primer mensaje del hilo (no encontramos correos anteriores con este contacto).
              </div>
            )}
          </div>
        )}
      </section>

      {composeOpen && (
        <ComposeModal
          uniboxId={id}
          accounts={accounts}
          initial={composeData}
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            loadMessages();
            loadReminders();
            // Segundo refresh tras 5s: a veces el Sent folder de Gmail tarda
            // unos segundos en indexar el mensaje. Doble loadMessages garantiza
            // que el mensaje recién enviado aparezca en "Enviados".
            setTimeout(() => loadMessages(), 5000);
            setLastSyncTs(Date.now());
          }}
        />
      )}
      {signatureModalOpen && (
        <SignatureModal
          uniboxId={id}
          accounts={accounts}
          onClose={() => setSignatureModalOpen(false)}
          onSaved={(updated) => {
            // Si el modal nos pasa la cuenta actualizada (o un bulk),
            // actualizamos el state local AL INSTANTE sin esperar fetch.
            if (updated?.__bulk && Array.isArray(updated.accounts)) {
              setAccounts((prev) => prev.map((a) => {
                const u = updated.accounts.find((x: any) => x.id === a.id);
                return u ? { ...a, ...u } : a;
              }));
            } else if (updated?.id) {
              setAccounts((prev) => prev.map((a) => a.id === updated.id ? { ...a, ...updated } : a));
            } else {
              // Fallback: re-fetch normal
              loadAccounts();
            }
          }}
        />
      )}

      {/* Modal: crear nueva carpeta */}
      {folderModalOpen && (
        <div
          onClick={() => !savingFolder && setFolderModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
            backdropFilter: "blur(4px)", zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 14, width: "100%", maxWidth: 420,
              boxShadow: "0 20px 50px rgba(15,23,42,0.25)", overflow: "hidden",
            }}
          >
            <div style={{
              padding: "18px 22px", borderBottom: "1px solid #e2e8f0",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>📁 Nueva carpeta</div>
              <button
                onClick={() => !savingFolder && setFolderModalOpen(false)}
                style={{ background: "none", border: 0, cursor: "pointer", fontSize: 18, color: "#64748b" }}
              >✕</button>
            </div>
            <div style={{ padding: "20px 22px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
                Nombre
              </label>
              <input
                type="text"
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim() && !savingFolder) createFolder();
                  if (e.key === "Escape" && !savingFolder) setFolderModalOpen(false);
                }}
                placeholder="Ej. Importantes, Leads calientes, Reuniones…"
                style={{
                  width: "100%", padding: "10px 12px", border: "1px solid #cbd5e1",
                  borderRadius: 9, fontSize: 14, outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", margin: "16px 0 8px" }}>
                Color
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  "#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#84cc16",
                  "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899",
                  "#a855f7", "#64748b",
                ].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewFolderColor(c)}
                    style={{
                      width: 28, height: 28, borderRadius: 7,
                      background: c, cursor: "pointer",
                      border: newFolderColor === c ? "3px solid #0f172a" : "2px solid transparent",
                      transition: "border 0.12s",
                      padding: 0,
                    }}
                    aria-label={c}
                  />
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 22, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setFolderModalOpen(false)}
                  disabled={savingFolder}
                  style={{
                    padding: "9px 16px", background: "#f1f5f9", border: "1px solid #e2e8f0",
                    borderRadius: 9, color: "#475569", fontWeight: 600, fontSize: 13,
                    cursor: savingFolder ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >Cancelar</button>
                <button
                  onClick={createFolder}
                  disabled={!newFolderName.trim() || savingFolder}
                  style={{
                    padding: "9px 18px",
                    background: newFolderName.trim() && !savingFolder
                      ? "linear-gradient(135deg, #f9a603, #d15cfe)"
                      : "#cbd5e1",
                    border: 0, borderRadius: 9, color: "#fff", fontWeight: 700,
                    fontSize: 13, cursor: (!newFolderName.trim() || savingFolder) ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >{savingFolder ? "Creando…" : "Crear carpeta"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -------------- compose modal --------------
function ComposeModal({ uniboxId, accounts, initial, onClose, onSent }: any) {
  const [accountId, setAccountId] = useState(initial.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initial.subject || "");
  const [body, setBody] = useState(initial.body || "");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  // Reminder programable
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDelay, setReminderDelay] = useState(72); // 3 días por defecto
  const [reminderBody, setReminderBody] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = body || "";
  }, []);

  function exec(cmd: string) {
    document.execCommand(cmd, false);
  }

  function insertLink() {
    const url = prompt("URL:", "https://");
    if (!url) return;
    document.execCommand("createLink", false, url);
  }

  async function send() {
    if (!to.trim()) return alert("Falta destinatario");
    setSending(true);
    const fd = new FormData();
    fd.append("accountId", accountId);
    fd.append("to", to);
    fd.append("cc", cc);
    fd.append("bcc", bcc);
    fd.append("subject", subject);
    fd.append("body", editorRef.current?.innerHTML || "");
    if (initial.inReplyTo) fd.append("inReplyTo", initial.inReplyTo);
    if (initial.references) fd.append("references", initial.references);
    for (const f of files) fd.append("attachments", f);
    try {
      const r = await fetch(`/api/uniboxes/${uniboxId}/send`, { method: "POST", body: fd });
      let d: any = null;
      try { d = await r.json(); } catch {}
      if (!r.ok) {
        const errMsg = d?.error || `HTTP ${r.status}`;
        const hint = d?.smtp_host ? ` (SMTP ${d.smtp_host}:${d.smtp_port})` : "";
        throw new Error(errMsg + hint);
      }

      // Si el usuario activó el reminder, lo programamos POST-send.
      if (reminderEnabled && d.messageId && to.trim()) {
        try {
          await fetch(`/api/uniboxes/${uniboxId}/reminders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_id: accountId,
              recipient: to.split(",")[0].trim(),
              original_subject: subject,
              original_message_id: d.messageId,
              original_references: initial.references
                ? String(initial.references).split(/\s+/).filter(Boolean)
                : [],
              reminder_body: reminderBody,
              delay_hours: reminderDelay,
            }),
          });
        } catch (e) {
          console.warn("[unibox] No se pudo programar reminder:", e);
        }
      }
      onSent();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modalCardLarge} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontWeight: 600 }}>{initial.inReplyTo ? "Responder" : "Nuevo mensaje"}</div>
          <button onClick={onClose} style={{ background: "none", border: 0, fontSize: 18, cursor: "pointer", color: "#64748b" }}>✕</button>
        </div>
        <div style={{ padding: "16px 20px", maxHeight: "70vh", overflowY: "auto" }}>
          <label style={composeLabel}>De</label>
          <select style={composeInput} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>

          <label style={composeLabel}>Para</label>
          <RecipientInput
            value={to}
            onChange={setTo}
            placeholder="destinatario@empresa.com (puedes añadir varios separados por coma o Enter)"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={composeLabel}>CC</label>
              <RecipientInput value={cc} onChange={setCc} placeholder="opcional" />
            </div>
            <div>
              <label style={composeLabel}>CCO</label>
              <RecipientInput value={bcc} onChange={setBcc} placeholder="opcional" />
            </div>
          </div>

          <label style={composeLabel}>Asunto</label>
          <input style={composeInput} value={subject} onChange={(e) => setSubject(e.target.value)} />

          <label style={composeLabel}>Mensaje</label>
          <div style={editorToolbar}>
            <button type="button" onClick={() => exec("bold")} style={toolBtn}><b>B</b></button>
            <button type="button" onClick={() => exec("italic")} style={toolBtn}><i>I</i></button>
            <button type="button" onClick={() => exec("underline")} style={toolBtn}><u>U</u></button>
            <button type="button" onClick={insertLink} style={toolBtn}>🔗 Enlace</button>
            <button type="button" onClick={() => fileRef.current?.click()} style={toolBtn}>📎 Adjuntar</button>
            <input type="file" ref={fileRef} multiple hidden onChange={(e) => {
              if (e.target.files) setFiles([...files, ...Array.from(e.target.files)]);
              e.target.value = "";
            }} />
          </div>
          <div
            ref={editorRef}
            contentEditable
            style={editorStyle}
          />
          {files.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {files.map((f, i) => (
                <span key={i} style={attachChip}>
                  📎 {f.name}{" "}
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    style={{ background: "none", border: 0, color: "#64748b", cursor: "pointer" }}>✕</button>
                </span>
              ))}
            </div>
          )}

          {/* REMINDER: bloque amarillo, solo aparece en respuestas */}
          {initial.inReplyTo && (
            <div style={{
              marginTop: 14,
              padding: "12px 14px",
              background: reminderEnabled
                ? "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(249,166,3,0.08))"
                : "var(--surface-2)",
              border: `1px solid ${reminderEnabled ? "rgba(245,158,11,0.4)" : "var(--border)"}`,
              borderRadius: 10,
              transition: "all 0.15s",
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => setReminderEnabled(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#f9a603" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#b45309", display: "flex", alignItems: "center", gap: 6 }}>
                    ⏰ Reminder automático
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
                    Si no responde, te envío un follow-up automático tras el plazo elegido.
                    Se cancela solo si responde antes.
                  </div>
                </div>
              </label>

              {reminderEnabled && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed rgba(245,158,11,0.3)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600 }}>Enviar en:</span>
                    {[
                      { h: 24, label: "1 día" },
                      { h: 72, label: "3 días" },
                      { h: 168, label: "1 semana" },
                      { h: 336, label: "2 semanas" },
                    ].map((opt) => (
                      <button
                        key={opt.h}
                        onClick={() => setReminderDelay(opt.h)}
                        style={{
                          padding: "5px 11px",
                          borderRadius: 99,
                          border: `1px solid ${reminderDelay === opt.h ? "#f59e0b" : "var(--border)"}`,
                          background: reminderDelay === opt.h ? "#f59e0b" : "#fff",
                          color: reminderDelay === opt.h ? "#fff" : "var(--t2)",
                          fontSize: 11.5, fontWeight: 600,
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-dim)", marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Mensaje del reminder (opcional)
                  </label>
                  <textarea
                    value={reminderBody}
                    onChange={(e) => setReminderBody(e.target.value)}
                    placeholder="Si lo dejas vacío, mando: 'Hola, quería retomar el hilo por si se te pasó. ¿Cómo lo ves?'"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 13,
                      fontFamily: "inherit",
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>Cancelar</button>
          <button onClick={send} disabled={sending} style={primaryBtn}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------- helpers --------------
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es", { month: "short", day: "numeric" });
}
function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

// -------------- styles --------------
const appStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "260px 380px 1fr",
  height: "100vh", overflow: "hidden",
  background: "#fff",
  fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
};
const sidebarStyle: React.CSSProperties = {
  background: "#f8fafc", borderRight: "1px solid #e2e8f0",
  display: "flex", flexDirection: "column", padding: "18px 14px", gap: 14,
  height: "100%", minHeight: 0, overflow: "hidden",
};
const brandRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "0 4px" };
const logoMark: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #818cf8)",
  display: "grid", placeItems: "center",
  color: "white", fontWeight: 700, fontSize: 18,
};
const composeBtn: React.CSSProperties = {
  background: "linear-gradient(180deg, #818cf8, #6366f1)",
  color: "#fff", border: "none", padding: "10px 14px", borderRadius: 9,
  fontSize: 13.5, fontWeight: 600, cursor: "pointer",
  boxShadow: "0 4px 12px rgba(99,102,241,0.35)",
};
const ghostBtn: React.CSSProperties = {
  background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0",
  padding: "9px 14px", borderRadius: 9, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const primaryBtn: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 11, color: "#8b94a7", letterSpacing: "0.08em", padding: "8px 6px 4px", fontWeight: 600,
};
// CARPETAS: no crece — solo el alto necesario para sus 3 items
const folderListStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
  flexShrink: 0,
  // Si el usuario crea muchas carpetas, se vuelve scrollable en vez
  // de empujar BANDEJAS fuera de la pantalla.
  maxHeight: "40vh",
  overflowY: "auto",
};
// BANDEJAS: crece y scrollea — toma el espacio sobrante
const accountList: React.CSSProperties = { flex: 1, minHeight: 80, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 };
const accountItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "9px 10px", borderRadius: 8, cursor: "pointer",
};
const activeAccount: React.CSSProperties = { background: "rgba(99,102,241,0.1)" };
const dotStyle: React.CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "#10b981", flexShrink: 0 };
const accountEmail: React.CSSProperties = { fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const accountHost: React.CSSProperties = { fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const listPaneStyle: React.CSSProperties = {
  background: "#fff", borderRight: "1px solid #e2e8f0",
  display: "flex", flexDirection: "column", overflow: "hidden",
  minHeight: 0, // ← crítico para que flex children con overflow funcionen
  height: "100%",
};
const toolbarStyle: React.CSSProperties = { padding: "14px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8 };
const searchStyle: React.CSSProperties = {
  width: "100%", background: "#f1f5f9", border: "1px solid transparent",
  padding: "9px 12px", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "inherit",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: 0, color: "#6366f1", fontSize: 11, cursor: "pointer",
  textAlign: "left", padding: 0, fontFamily: "inherit", fontWeight: 600,
};
const messagesList: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
  minHeight: 0, // ← imprescindible para que el scroll funcione dentro del flex parent
  WebkitOverflowScrolling: "touch", // iOS smooth scroll
};
const messageItem: React.CSSProperties = {
  padding: "13px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
  display: "flex", flexDirection: "column", gap: 3,
};
const activeMessage: React.CSSProperties = { background: "rgba(99,102,241,0.08)" };
const unreadMessage: React.CSSProperties = {};
const accTag: React.CSSProperties = {
  display: "inline-block", fontSize: 10, background: "#f1f5f9",
  color: "#64748b", padding: "1px 6px", borderRadius: 4, marginRight: 6,
};

const viewPaneStyle: React.CSSProperties = { background: "#fafbfc", overflow: "hidden" };
const placeholderStyle: React.CSSProperties = {
  height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  color: "#94a3b8",
};
const replyBtnStyle: React.CSSProperties = {
  background: "#0071e3", color: "#fff", border: "none",
  padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  cursor: "pointer", flexShrink: 0,
};
const attachChip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#f1f5f9", padding: "4px 10px", borderRadius: 6, fontSize: 12,
};
const threadItem: React.CSSProperties = {
  padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 8, marginBottom: 6, cursor: "pointer",
};
const emptyStyle: React.CSSProperties = {
  padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13,
};

const modalBg: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
  display: "grid", placeItems: "center", zIndex: 1000,
};
const modalCardLarge: React.CSSProperties = {
  background: "#fff", borderRadius: 14, width: "90%", maxWidth: 720,
  maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
};
const composeLabel: React.CSSProperties = {
  display: "block", fontSize: 10.5, color: "#64748b",
  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
  marginTop: 12, marginBottom: 5,
};
const composeInput: React.CSSProperties = {
  width: "100%", padding: "8px 11px", border: "1px solid #e2e8f0",
  borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};
const editorToolbar: React.CSSProperties = {
  display: "flex", gap: 4, padding: 8,
  background: "#f8fafc", border: "1px solid #e2e8f0", borderBottom: "none",
  borderRadius: "8px 8px 0 0",
};
const toolBtn: React.CSSProperties = {
  background: "transparent", border: 0, color: "#64748b",
  padding: "5px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
};
const editorStyle: React.CSSProperties = {
  minHeight: 200, maxHeight: 320, overflowY: "auto",
  background: "#fff", border: "1px solid #e2e8f0", borderTop: "none",
  borderRadius: "0 0 8px 8px",
  padding: "12px 14px", fontSize: 14, lineHeight: 1.55, outline: "none",
};

/**
 * Tarjeta de mensaje dentro del hilo. Carga el cuerpo HTML al expandir.
 */
function FolderPill({
  label, icon, count, active, onClick, accent, customColor,
}: {
  label: string;
  icon: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent?: "brand";
  customColor?: string;
}) {
  const isBrand = accent === "brand";
  // Si tiene customColor (carpeta del usuario), prevalece sobre el accent.
  const cc = customColor || null;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 9,
        cursor: "pointer",
        marginBottom: 3,
        transition: "all 0.15s",
        background: active
          ? (cc ? `${cc}15`
              : isBrand ? "linear-gradient(135deg, rgba(249,166,3,0.12), rgba(209,92,254,0.10))"
                       : "rgba(99,102,241,0.08)")
          : "transparent",
        border: active
          ? `1px solid ${cc ? cc + "55" : isBrand ? "rgba(209,92,254,0.35)" : "rgba(99,102,241,0.25)"}`
          : "1px solid transparent",
        paddingRight: cc ? 32 : 12, // espacio para botón ✕
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "rgba(15,23,42,0.04)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <span style={{
        flex: 1,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? (isBrand ? "#9a3fc7" : "#0f172a") : "#475569",
      }}>{label}</span>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "1px 8px",
        borderRadius: 99,
        background: active
          ? (isBrand ? "rgba(209,92,254,0.18)" : "rgba(99,102,241,0.18)")
          : "rgba(100,116,139,0.12)",
        color: active ? (isBrand ? "#9a3fc7" : "#6366f1") : "#64748b",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontVariantNumeric: "tabular-nums",
      }}>{count.toLocaleString("es")}</span>
    </div>
  );
}

function ThreadCard({
  msg, isMine, onLoadFull, onDelete,
}: {
  msg: any;
  isMine: boolean;
  onLoadFull: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<{ html?: string; text?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const params = useParams<{ id: string }>();
  const uniboxId = (params?.id || "") as string;

  async function load() {
    if (body || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/uniboxes/${uniboxId}/messages/${msg.accountId}/${msg.uid}`);
      if (r.ok) {
        const d = await r.json();
        setBody({ html: d.html, text: d.text });
      }
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    setOpen((v) => !v);
    if (!open) load();
  }

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${isMine ? "rgba(0,113,227,0.18)" : "rgba(15,23,42,0.08)"}`,
      borderLeft: `3px solid ${isMine ? "#0071e3" : "#cbd5e1"}`,
      borderRadius: 10,
      overflow: "hidden",
      transition: "box-shadow 0.15s",
    }}>
      <div
        onClick={toggle}
        style={{
          padding: "10px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: open ? "rgba(0,113,227,0.03)" : "transparent",
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: isMine ? "linear-gradient(135deg, #0071e3, #3b82f6)" : "#e2e8f0",
          color: isMine ? "#fff" : "#475569",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700,
          flexShrink: 0,
        }}>
          {isMine ? "Tú" : ((msg.fromName || msg.from || "?").charAt(0).toUpperCase())}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isMine && (
                <span style={{
                  background: "rgba(0,113,227,0.1)", color: "#0071e3",
                  padding: "1px 6px", borderRadius: 999, fontSize: 10,
                  fontWeight: 700, marginRight: 6,
                }}>ENVIADO</span>
              )}
              {msg.fromName || msg.from}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>
              {new Date(msg.date).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
          {!open && (
            <div style={{ fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {msg.preview}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Eliminar este mensaje"
            style={{
              background: "transparent", border: "none",
              color: "#dc2626", cursor: "pointer", fontSize: 14,
              padding: 4, opacity: 0.7,
            }}
          >🗑</button>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{open ? "▴" : "▾"}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: "14px 18px 18px", borderTop: "1px solid #f1f5f9" }}>
          {loading ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>Cargando mensaje…</div>
          ) : body ? (
            <div
              style={{ fontSize: 13.5, lineHeight: 1.6, color: "#1f2937" }}
              dangerouslySetInnerHTML={{
                __html: body.html
                  ? body.html.replace(/<script[\s\S]*?<\/script>/gi, "")
                  : (body.text || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c)).replace(/\n/g, "<br>"),
              }}
            />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>No se pudo cargar el cuerpo. <button onClick={onLoadFull} style={{ background: "transparent", border: "none", color: "#0071e3", cursor: "pointer", textDecoration: "underline" }}>Abrir mensaje</button></div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────── Multi-recipient input (chips) ─────────── */
function RecipientInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  // Convertir la cadena value a array de emails (limpio)
  const emails = (value || "")
    .split(/[,;]\s*|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  function commit(parts: string[]) {
    // Filtrar duplicados manteniendo orden
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const p of parts) {
      const k = p.toLowerCase();
      if (!seen.has(k)) { seen.add(k); unique.push(p); }
    }
    onChange(unique.join(", "));
  }

  function addFromDraft(includeTrailing = false) {
    const d = draft.trim();
    if (!d) return;
    // Si el draft termina con espacio/coma o forzamos, añade
    const newParts = d.split(/[,;]\s*|\s+/).map((s) => s.trim()).filter(Boolean);
    if (newParts.length === 0) return;
    commit([...emails, ...newParts]);
    setDraft("");
  }

  function removeAt(idx: number) {
    const next = emails.filter((_, i) => i !== idx);
    commit(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      addFromDraft(true);
    } else if (e.key === "Backspace" && !draft && emails.length > 0) {
      // Si la caja está vacía y pulsan backspace, quitar último chip
      e.preventDefault();
      removeAt(emails.length - 1);
    } else if (e.key === " " && draft.includes("@")) {
      // Espacio cuando ya hay un @ → añadir
      e.preventDefault();
      addFromDraft(true);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (/[,;\n\s]/.test(text)) {
      e.preventDefault();
      const parts = text.split(/[,;\n\s]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) commit([...emails, ...parts]);
      setDraft("");
    }
  }

  return (
    <div
      onClick={(e) => {
        // Click en el contenedor → focus al input interno
        const input = (e.currentTarget.querySelector("input.recipient-draft") as HTMLInputElement);
        input?.focus();
      }}
      style={{
        ...composeInput,
        height: "auto",
        minHeight: 40,
        padding: "6px 8px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 5,
        cursor: "text",
      }}
    >
      {emails.map((em, i) => {
        const isValid = /^[^\s,;<>"'()\[\]{}]+@[^\s,;<>"'()\[\]{}]+\.[^\s,;<>"'()\[\]{}]+$/.test(em);
        return (
          <span
            key={`${em}-${i}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 5px 3px 10px",
              background: isValid ? "rgba(99,102,241,0.1)" : "rgba(239,68,68,0.08)",
              color: isValid ? "#0f172a" : "#dc2626",
              border: `1px solid ${isValid ? "rgba(99,102,241,0.25)" : "rgba(239,68,68,0.25)"}`,
              borderRadius: 99,
              fontSize: 12.5,
              fontWeight: 500,
              maxWidth: "100%",
            }}
            title={isValid ? em : `${em} — formato no válido`}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{em}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeAt(i); }}
              aria-label="Quitar destinatario"
              style={{
                background: "transparent", border: "none",
                color: "inherit", cursor: "pointer",
                fontSize: 13, lineHeight: 1,
                padding: "1px 4px", opacity: 0.7,
                borderRadius: 99,
              }}
            >×</button>
          </span>
        );
      })}
      <input
        className="recipient-draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => addFromDraft(true)}
        placeholder={emails.length === 0 ? placeholder : ""}
        style={{
          flex: 1,
          minWidth: 140,
          border: "none",
          outline: "none",
          background: "transparent",
          padding: "5px 4px",
          fontSize: 13.5,
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

/* ─────────── Modal de Firmas ─────────── */
function SignatureModal({ uniboxId, accounts, onClose, onSaved }: { uniboxId: string; accounts: any[]; onClose: () => void; onSaved: (updated?: any) => void }) {
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || "");
  const [signature, setSignature] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [mode, setMode] = useState<"upload" | "edit">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  // Ref para evitar re-leer del server cuando solo cambia accounts (otro re-fetch).
  // SOLO recargamos signature local si el accountId cambia.
  const lastAccountIdRef = useRef<string>("");

  // Cargar la firma cuando cambia LA CUENTA SELECCIONADA — NO cuando cambia
  // el array accounts (eso provocaba reset del draft + del flag "Guardado").
  useEffect(() => {
    if (accountId === lastAccountIdRef.current) return; // misma cuenta → no re-leer
    lastAccountIdRef.current = accountId;
    const acc = accounts.find((a) => a.id === accountId);
    setSignature(acc?.signature_html || "");
    setFileName("");
    setMode(acc?.signature_html ? "edit" : "upload");
    setSavedFlag(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function handleFile(file: File) {
    if (!file) return;
    if (file.size > 200 * 1024) {
      alert("El archivo es demasiado grande (máx 200 KB).");
      return;
    }
    const text = await file.text();
    // Limpiar: quitar <script>, <html>, <head>, <body> wrappers para que la
    // firma quede solo con el contenido visual interno.
    let cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<\/?head[^>]*>/gi, "")
      .replace(/<title[\s\S]*?<\/title>/gi, "")
      .replace(/<\/?body[^>]*>/gi, "")
      .replace(/<meta[^>]*>/gi, "")
      .trim();
    setSignature(cleaned);
    setFileName(file.name);
    setMode("edit");
  }

  async function save() {
    if (!accountId) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/uniboxes/${uniboxId}/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_html: signature }),
      });
      const data = await r.json().catch(() => null);
      if (r.ok) {
        setSavedFlag(true);
        // Pasamos la cuenta actualizada al padre para que actualice su state
        // directamente sin esperar a un refetch (que podría sobreescribir
        // con datos viejos por race condition).
        onSaved(data?.account);
        setTimeout(() => setSavedFlag(false), 2800);
      } else {
        alert("Error al guardar: " + (data?.error || `HTTP ${r.status}`));
      }
    } catch (e: any) {
      alert("Error de red al guardar: " + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  }

  async function applyToAll() {
    if (!confirm(`Esto aplicará la firma actual a TODAS las ${accounts.length} cuentas. ¿Seguir?`)) return;
    setSaving(true);
    try {
      const updatedAccounts: any[] = [];
      for (const a of accounts) {
        const r = await fetch(`/api/uniboxes/${uniboxId}/accounts/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature_html: signature }),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.account) updatedAccounts.push(d.account);
      }
      // Notificar al padre con un objeto especial para que refresque todas
      onSaved({ __bulk: true, accounts: updatedAccounts });
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 3500);
    } finally {
      setSaving(false);
    }
  }

  const selectedAcc = accounts.find((a) => a.id === accountId);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, padding: 0,
        maxWidth: 640, width: "100%",
        maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(15,23,42,0.3)",
      }}>
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid #e2e8f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>✍ Firmas por cuenta</h2>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Se añade automáticamente al enviar desde la cuenta elegida.</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer" }}>×</button>
        </div>

        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            Cuenta
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={{
              width: "100%", padding: "10px 12px",
              border: "1px solid rgba(15,23,42,0.12)",
              borderRadius: 10, fontSize: 14, fontFamily: "inherit",
              marginBottom: 16,
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}{a.signature_html ? "  ✓" : ""}
              </option>
            ))}
          </select>

          {/* Tabs Upload / Edit */}
          <div style={{
            display: "flex", gap: 4,
            background: "#f1f5f9", padding: 4, borderRadius: 10,
            marginBottom: 14,
          }}>
            <button
              onClick={() => setMode("upload")}
              style={{
                flex: 1, padding: "7px 12px",
                background: mode === "upload" ? "#fff" : "transparent",
                border: "none", borderRadius: 7,
                fontSize: 12.5, fontWeight: 600,
                color: mode === "upload" ? "#0071e3" : "#64748b",
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: mode === "upload" ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
              }}
            >📤 Subir archivo HTML</button>
            <button
              onClick={() => setMode("edit")}
              style={{
                flex: 1, padding: "7px 12px",
                background: mode === "edit" ? "#fff" : "transparent",
                border: "none", borderRadius: 7,
                fontSize: 12.5, fontWeight: 600,
                color: mode === "edit" ? "#0071e3" : "#64748b",
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: mode === "edit" ? "0 1px 2px rgba(15,23,42,0.06)" : "none",
              }}
            >✏ Editar HTML</button>
          </div>

          {mode === "upload" ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#0071e3" : "rgba(15,23,42,0.18)"}`,
                background: dragOver ? "rgba(0,113,227,0.04)" : "#fafbfc",
                borderRadius: 14,
                padding: "30px 20px",
                textAlign: "center",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                {fileName ? `✓ ${fileName}` : "Click o arrastra un archivo .html"}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Sube tu firma como HTML — se quita &lt;html&gt;/&lt;head&gt; y se queda solo lo visual.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          ) : (
            <>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Firma HTML (soporta &lt;br&gt;, &lt;strong&gt;, &lt;a&gt;, &lt;img&gt;, &lt;table&gt;, etc.)
              </label>
              <textarea
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={`<p>Un saludo,<br><strong>${selectedAcc?.first_name || "Tu nombre"}</strong><br>${selectedAcc?.email || "tu@empresa.com"}</p>`}
                rows={10}
                style={{
                  width: "100%", padding: "10px 12px",
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 10, fontSize: 13,
                  fontFamily: "ui-monospace, Menlo, monospace",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </>
          )}

          {signature && (
            <>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 18, marginBottom: 6 }}>
                Vista previa (como se verá en el email)
              </label>
              <div
                style={{
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 12,
                  padding: 18,
                  background: "#fff",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "#0f172a",
                  fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
                  boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.02), 0 1px 3px rgba(15,23,42,0.04)",
                }}
              >
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 14, fontStyle: "italic" }}>
                  ...el contenido de tu mensaje terminaría aquí.
                </div>
                <div dangerouslySetInnerHTML={{ __html: signature.replace(/<script[\s\S]*?<\/script>/gi, "") }} />
              </div>
            </>
          )}

          <div style={{
            marginTop: 16, padding: "10px 14px",
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.2)",
            borderRadius: 10,
            fontSize: 12, color: "#475569", lineHeight: 1.5,
          }}>
            💡 Cada cuenta puede tener su propia firma. La firma se añade automáticamente al final de cada email que envíes desde esa cuenta — tanto en respuestas como en mensajes nuevos.
          </div>
        </div>

        <div style={{
          padding: "14px 22px", borderTop: "1px solid #e2e8f0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, flexWrap: "wrap",
        }}>
          <button
            onClick={applyToAll}
            disabled={saving || !signature}
            style={{
              background: "#fff",
              border: "1px solid rgba(99,102,241,0.4)",
              borderRadius: 10,
              padding: "9px 14px",
              fontSize: 12.5, fontWeight: 600,
              color: "#6366f1",
              cursor: saving ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: !signature ? 0.5 : 1,
            }}
            title="Copia esta firma a TODAS las cuentas de la unibox"
          >
            📋 Aplicar a todas las cuentas
          </button>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {savedFlag && <span style={{ color: "#16a34a", fontSize: 13, fontWeight: 600 }}>✓ Guardado</span>}
            <button
              onClick={onClose}
              style={{
                background: "#fff", border: "1px solid rgba(15,23,42,0.12)",
                borderRadius: 10, padding: "9px 16px",
                fontSize: 13, fontWeight: 500,
                color: "#0f172a", cursor: "pointer", fontFamily: "inherit",
              }}
            >Cerrar</button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: "linear-gradient(135deg, #0071e3, #3b82f6)",
                border: "none", borderRadius: 10,
                padding: "10px 18px",
                fontSize: 13, fontWeight: 600,
                color: "#fff", cursor: saving ? "wait" : "pointer",
                fontFamily: "inherit",
                boxShadow: "0 2px 8px rgba(0,113,227,0.3)",
              }}
            >
              {saving ? "Guardando…" : "Guardar firma"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
