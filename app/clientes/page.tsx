"use client";
import { useState, useEffect } from "react";
import DashboardNav from "../components/DashboardNav";

type Cfg = {
  client_id: string; client_name: string; recipient_email: string;
  email_subject: string; email_body_html: string; pdf_intro: string;
  enabled: boolean; interval_hours: number; campaign_ids?: string[]; context_unibox_id?: string; last_sent_at?: string | null;
};
type Row = { client_id: string; client_name: string; email?: string; config: Cfg };

export default function ClientesPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyResult, setKeyResult] = useState<any>(null);

  const [clients, setClients] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Cfg>>>({});
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [testEmails, setTestEmails] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Record<string, any[]>>({});
  const [campaignsByClient, setCampaignsByClient] = useState<Record<string, Array<{ id: string; name: string; status?: string }>>>({});
  const [loadingCamps, setLoadingCamps] = useState("");
  const [logoInfo, setLogoInfo] = useState<{ has_logo: boolean } | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [smtp, setSmtp] = useState<any>(null);          // estado GET
  const [smtpForm, setSmtpForm] = useState<any>({ host: "", port: 587, user: "", pass: "", from_email: "", from_name: "" });
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    if (!connected) return;
    fetch("/api/clients/logo").then((r) => r.json()).then(setLogoInfo).catch(() => {});
    fetch("/api/clients/smtp").then((r) => r.json()).then((s) => {
      setSmtp(s);
      setSmtpForm((f: any) => ({ ...f, host: s.host || "", port: s.port || 587, user: s.user || "", from_email: s.from_email || "", from_name: s.from_name || "", pass: "" }));
    }).catch(() => {});
  }, [connected]);

  async function saveSmtp() {
    setSmtpBusy(true); setSmtpMsg(null);
    try {
      const r = await fetch("/api/clients/smtp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smtpForm),
      }).then((r) => r.json());
      if (r.ok) {
        setSmtpMsg({ ok: true, text: "✓ Conectado y verificado. Los informes se enviarán por esta cuenta." });
        setSmtp({ ...smtp, connected: true, host: smtpForm.host, user: smtpForm.user, from_email: r.from_email });
        setSmtpForm((f: any) => ({ ...f, pass: "" }));
      } else {
        const isGmail = /gmail\.com/i.test(smtpForm.host || "");
        const looksAuth = /invalid|accepted|authentication|535|credential|login|password/i.test(r.error || "");
        const gmailTip = isGmail && looksAuth ? " → En Gmail debes usar una Contraseña de aplicación (no la normal): myaccount.google.com/apppasswords." : "";
        setSmtpMsg({ ok: false, text: "⚠ " + (r.error || "No se pudo conectar. Revisa host, puerto, usuario y contraseña.") + gmailTip });
      }
    } catch (e: any) { setSmtpMsg({ ok: false, text: "⚠ " + e.message }); }
    setSmtpBusy(false);
  }

  async function uploadLogo(file: File) {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const buf = await file.arrayBuffer();
      const r = await fetch("/api/clients/logo", { method: "POST", headers: { "x-mime": file.type || "image/png" }, body: buf }).then((r) => r.json());
      if (r.ok) { setLogoInfo({ has_logo: true }); flash("✓ Logo subido — saldrá en los informes"); }
      else flash("⚠ " + (r.error || "No se pudo subir el logo"));
    } catch (e: any) { flash("⚠ " + e.message); }
    setUploadingLogo(false);
  }

  // Al abrir el modal de un cliente, cargar sus campañas (para elegir cuáles incluir).
  useEffect(() => {
    if (!openId || campaignsByClient[openId]) return;
    setLoadingCamps(openId);
    fetch(`/api/clients/${openId}/campaigns`).then((r) => r.json())
      .then((d) => setCampaignsByClient((m) => ({ ...m, [openId!]: d.campaigns || [] })))
      .catch(() => {})
      .finally(() => setLoadingCamps(""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function toggleCampaign(row: Row, campId: string) {
    const all = (campaignsByClient[row.client_id] || []).map((c) => c.id);
    const c = cur(row);
    const set = new Set(c.campaign_ids && c.campaign_ids.length ? c.campaign_ids : all);
    if (set.has(campId)) set.delete(campId); else set.add(campId);
    const arr = [...set];
    const isAll = all.length > 0 && arr.length === all.length;
    edit(row.client_id, { campaign_ids: isAll ? [] : arr });
  }

  async function loadStatus() {
    try {
      const r = await fetch("/api/clients/settings").then((r) => r.json());
      setConnected(!!r.connected);
      if (r.connected) loadClients();
    } catch { setConnected(false); }
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSavingKey(true); setKeyResult(null);
    try {
      const r = await fetch("/api/clients/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      }).then((r) => r.json());
      setKeyResult(r);
      if (r.ok) { setConnected(true); setApiKey(""); loadClients(); }
    } catch (e: any) { setKeyResult({ ok: false, error: e.message }); }
    setSavingKey(false);
  }

  async function loadClients() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/clients/list").then((r) => r.json());
      if (r.error) setError(r.error);
      setClients(r.clients || []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  function cur(row: Row): Cfg { return { ...row.config, ...(edits[row.client_id] || {}) } as Cfg; }
  function edit(id: string, patch: Partial<Cfg>) { setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } })); }

  async function saveConfig(row: Row) {
    setBusy("save-" + row.client_id);
    try {
      const c = cur(row);
      const r = await fetch(`/api/clients/${row.client_id}/config`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...c, client_name: row.client_name }),
      }).then((r) => r.json());
      if (r.ok) {
        setClients((cl) => cl.map((x) => x.client_id === row.client_id ? { ...x, config: r.config } : x));
        setEdits((e) => { const n = { ...e }; delete n[row.client_id]; return n; });
        flash("✓ Guardado");
      }
    } catch (e: any) { flash("⚠ " + e.message); }
    setBusy("");
  }

  async function sendNow(row: Row) {
    const c = cur(row);
    if (!c.recipient_email) { alert("Pon el email de destino primero."); return; }
    if (!confirm(`Enviar el informe de "${row.client_name}" a ${c.recipient_email} ahora?`)) return;
    setBusy("send-" + row.client_id);
    try {
      await saveConfig(row); // guardar cambios antes de enviar
      const r = await fetch(`/api/clients/${row.client_id}/send`, { method: "POST" }).then((r) => r.json());
      if (r.ok) flash(`✓ Informe enviado a ${r.to}`);
      else flash("⚠ " + (r.error || "Error enviando"));
      loadClients();
      loadLog(row.client_id);
    } catch (e: any) { flash("⚠ " + e.message); loadLog(row.client_id); }
    setBusy("");
  }

  async function sendTest(row: Row) {
    const email = (testEmails[row.client_id] || "").trim();
    if (!email) { alert("Escribe tu email para la prueba."); return; }
    setBusy("test-" + row.client_id);
    try {
      await saveConfig(row); // usar los últimos textos/intro en la prueba
      const r = await fetch(`/api/clients/${row.client_id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_email: email }),
      }).then((r) => r.json());
      if (r.ok) flash(`✓ Prueba enviada a ${r.to} — mira cómo queda`);
      else flash("⚠ " + (r.error || "Error en la prueba"));
      loadLog(row.client_id);
    } catch (e: any) { flash("⚠ " + e.message); loadLog(row.client_id); }
    setBusy("");
  }

  async function loadLog(clientId: string) {
    try {
      const r = await fetch(`/api/clients/${clientId}/log`).then((r) => r.json());
      setLogs((prev) => ({ ...prev, [clientId]: Array.isArray(r.log) ? r.log : [] }));
    } catch { /* ignora */ }
  }
  useEffect(() => { if (openId) loadLog(openId); }, [openId]);

  function flash(m: string) { setFeedback(m); setTimeout(() => setFeedback(""), 5000); }

  return (
    <div className="dash-shell">
      <DashboardNav />
      <div className="dash-content">
        <div className="dash-page-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
            <span style={{ color: "var(--t4)" }}>OnePulso</span>
            <span style={{ color: "var(--t5)" }}>›</span>
            <span style={{ color: "var(--t1)", fontWeight: 600 }}>Clientes · Informes</span>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: "0 auto", padding: "8px 0 60px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Informes de clientes (Smartlead)</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginBottom: 20 }}>
            Conecta Smartlead, elige el destinatario de cada cliente y activa el informe PDF automático cada 48h.
          </p>

          {feedback && (
            <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, fontSize: 13, color: "#047857", fontWeight: 600 }}>{feedback}</div>
          )}

          {/* Conectar API */}
          {connected === false && (
            <div style={card}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>🔌 Conectar la API de Smartlead</div>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>
                En Smartlead → <b>Settings → API Key</b>. Se guarda de forma segura y sirve para leer tus clientes y sus analíticas.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Pega tu Smartlead API key" style={{ ...inp, flex: 1, minWidth: 260 }} type="password" />
                <button onClick={saveKey} disabled={savingKey || !apiKey.trim()} style={btnPrimary}>{savingKey ? "Conectando…" : "Conectar"}</button>
              </div>
              {keyResult && !keyResult.ok && <div style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 8 }}>⚠ {keyResult.error || "No se pudo conectar"}</div>}
            </div>
          )}

          {connected && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 12.5, color: "#047857", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981" }} /> Smartlead conectado
                </span>
                <button onClick={loadClients} style={btnGhost}>↻ Refrescar</button>
                <label style={{ ...btnGhost, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                  {uploadingLogo ? "Subiendo…" : logoInfo?.has_logo ? "🖼 Cambiar logo" : "🖼 Subir logo"}
                  <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
                </label>
                <button onClick={() => { setConnected(false); }} style={{ ...btnGhost, color: "#b91c1c" }}>Cambiar API key</button>
              </div>

              {/* Cuenta de envío (SMTP) para los informes */}
              <div style={{ marginBottom: 16, border: "1px solid var(--border, #e2e8f0)", borderRadius: 12, overflow: "hidden" }}>
                <button onClick={() => setSmtpOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: "var(--bg-elev-2, #f7f8fb)", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: smtp?.connected ? "#10b981" : "#cbd5e1", flexShrink: 0 }} />
                  <span style={{ fontWeight: 700 }}>Cuenta de envío (SMTP)</span>
                  <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{smtp?.connected ? `· conectada (${smtp.from_email || smtp.user})` : "· sin conectar — los informes no se enviarán"}</span>
                  <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>{smtpOpen ? "▲" : "▼"}</span>
                </button>
                {smtpOpen && (
                  <div style={{ padding: 14, display: "grid", gap: 10, background: "var(--bg-elev, #fff)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Introduce los datos SMTP del correo desde el que quieres enviar los informes, o pulsa un proveedor para autorrellenarlos:</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" onClick={() => setSmtpForm((f: any) => ({ ...f, host: "smtp.gmail.com", port: 465 }))} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>📧 Gmail</button>
                      <button type="button" onClick={() => setSmtpForm((f: any) => ({ ...f, host: "smtp.ionos.es", port: 587 }))} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>IONOS</button>
                      <button type="button" onClick={() => setSmtpForm((f: any) => ({ ...f, host: "smtp-mail.outlook.com", port: 587 }))} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>Outlook</button>
                    </div>
                    {/gmail\.com/i.test(smtpForm.host) && (
                      <div style={{ fontSize: 12, padding: "10px 12px", background: "rgba(234,67,53,0.06)", border: "1px solid rgba(234,67,53,0.22)", borderRadius: 8, color: "#a4231a", lineHeight: 1.5 }}>
                        <b>Para Gmail necesitas una «Contraseña de aplicación»</b>, no tu contraseña normal.<br />
                        1) Activa la <b>Verificación en 2 pasos</b> en tu cuenta Google. 2) Crea la contraseña en <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: "#6e59f2", fontWeight: 600 }}>myaccount.google.com/apppasswords</a>. 3) Pega aquí esos <b>16 caracteres</b> (con o sin espacios). En <b>Usuario</b> pon tu dirección completa <code>@gmail.com</code>.
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                      <div><label style={lbl}>Servidor SMTP (host)</label><input value={smtpForm.host} onChange={(e) => setSmtpForm((f: any) => ({ ...f, host: e.target.value }))} placeholder="smtp.ionos.es" style={inp} /></div>
                      <div><label style={lbl}>Puerto</label><input value={smtpForm.port} onChange={(e) => setSmtpForm((f: any) => ({ ...f, port: Number(e.target.value) || 587 }))} placeholder="587" style={inp} /></div>
                    </div>
                    <div><label style={lbl}>Usuario</label><input value={smtpForm.user} onChange={(e) => setSmtpForm((f: any) => ({ ...f, user: e.target.value }))} placeholder="informes@tudominio.com" style={inp} /></div>
                    <div><label style={lbl}>Contraseña {smtp?.has_pass ? "(deja vacío para no cambiarla)" : ""}</label><input type="password" value={smtpForm.pass} onChange={(e) => setSmtpForm((f: any) => ({ ...f, pass: e.target.value }))} placeholder="••••••••" style={inp} autoComplete="new-password" /></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div><label style={lbl}>Email remitente (opcional)</label><input value={smtpForm.from_email} onChange={(e) => setSmtpForm((f: any) => ({ ...f, from_email: e.target.value }))} placeholder="= usuario" style={inp} /></div>
                      <div><label style={lbl}>Nombre remitente (opcional)</label><input value={smtpForm.from_name} onChange={(e) => setSmtpForm((f: any) => ({ ...f, from_name: e.target.value }))} placeholder="OnePulso Informes" style={inp} /></div>
                    </div>
                    {smtpMsg && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 8, background: smtpMsg.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)", color: smtpMsg.ok ? "#047857" : "#b91c1c", border: `1px solid ${smtpMsg.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}` }}>{smtpMsg.text}</div>}
                    <div><button onClick={saveSmtp} disabled={smtpBusy} style={btnPrimary}>{smtpBusy ? "Probando conexión…" : "Probar y guardar"}</button></div>
                  </div>
                )}
              </div>

              {error && <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, fontSize: 13, color: "#b91c1c" }}>⚠ {error}</div>}
              {loading && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Cargando clientes…</div>}
              {!loading && clients.length === 0 && !error && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>No hay clientes en tu cuenta de Smartlead (o no es cuenta de agencia).</div>}

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {clients.map((row) => {
                  const c = cur(row);
                  return (
                    <div key={row.client_id} style={{ ...card, cursor: "pointer", transition: "border-color .15s" }} onClick={() => setOpenId(row.client_id)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{row.client_name?.[0]?.toUpperCase() || "C"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{row.client_name}</div>
                          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                            {c.recipient_email ? `→ ${c.recipient_email}` : "sin email de destino"}
                            {c.last_sent_at ? ` · último: ${new Date(c.last_sent_at).toLocaleDateString("es")}` : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: c.enabled ? "rgba(16,185,129,0.15)" : "var(--bg-elev-2)", color: c.enabled ? "#047857" : "var(--text-dim)" }}>
                          {c.enabled ? "AUTO 48h ✓" : "manual"}
                        </span>
                        <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Configurar ›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL centrado de configuración del cliente */}
      {openId && (() => {
        const row = clients.find((r) => r.client_id === openId);
        if (!row) return null;
        const c = cur(row);
        return (
          <div style={modalBackdrop} onClick={() => setOpenId(null)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#a855f7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>{row.client_name?.[0]?.toUpperCase() || "C"}</div>
                  <div style={{ fontWeight: 800, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.client_name}</div>
                </div>
                <button onClick={() => setOpenId(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-dim)", lineHeight: 1 }}>✕</button>
              </div>

              <div style={modalBody}>
                <div>
                  <label style={lbl}>Email de destino (a quién se envía el informe)</label>
                  <input value={c.recipient_email} onChange={(e) => edit(row.client_id, { recipient_email: e.target.value })} placeholder="cliente@empresa.com" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Asunto del email</label>
                  <input value={c.email_subject} onChange={(e) => edit(row.client_id, { email_subject: e.target.value })} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Mensaje del email (lo que le escribes al cliente)</label>
                  <textarea value={c.email_body_html} onChange={(e) => edit(row.client_id, { email_body_html: e.target.value })} rows={4} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </div>
                <div>
                  <label style={lbl}>Texto de intro del PDF (personaliza el informe)</label>
                  <textarea value={c.pdf_intro} onChange={(e) => edit(row.client_id, { pdf_intro: e.target.value })} rows={2} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </div>

                {/* Selección de campañas del cliente */}
                {(() => {
                  const camps = campaignsByClient[row.client_id] || [];
                  const allIn = !c.campaign_ids || c.campaign_ids.length === 0;
                  const sel = new Set(allIn ? camps.map((x) => x.id) : c.campaign_ids);
                  return (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <label style={{ ...lbl, marginBottom: 0 }}>Campañas incluidas {camps.length ? `(${sel.size}/${camps.length})` : ""}</label>
                        {camps.length > 0 && (
                          <button type="button" onClick={() => edit(row.client_id, { campaign_ids: [] })} style={{ background: "none", border: "none", color: "#7c3aed", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                            Todas
                          </button>
                        )}
                      </div>
                      {loadingCamps === row.client_id ? (
                        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Cargando campañas…</div>
                      ) : camps.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Este cliente no tiene campañas (o aún cargando). Se incluirán todas.</div>
                      ) : (
                        <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6, display: "grid", gap: 2 }}>
                          {camps.map((camp) => (
                            <label key={camp.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "4px 6px", borderRadius: 6, cursor: "pointer" }}>
                              <input type="checkbox" checked={sel.has(camp.id)} onChange={() => toggleCampaign(row, camp.id)} />
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.name}</span>
                              {camp.status && <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{camp.status}</span>}
                            </label>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 4 }}>Las métricas del informe suman solo las campañas marcadas. "Todas" = todas las del cliente.</div>
                    </div>
                  );
                })()}

                {/* Contexto de la IA: respuestas reales desde Smartlead */}
                <div style={{ fontSize: 10.5, color: "var(--text-dim)", background: "var(--bg-subtle, #f8fafc)", border: "1px solid var(--border, #e6e9ef)", borderRadius: 8, padding: "8px 10px" }}>
                  🤖 La IA toma contexto de las <b>respuestas reales de los leads en Smartlead</b> (de las campañas seleccionadas) para enriquecer el análisis, siempre en tono positivo. No necesitas configurar nada.
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => edit(row.client_id, { enabled: e.target.checked })} />
                  <span>Enviar informe <b>automáticamente cada {c.interval_hours || 48}h</b></span>
                </label>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => saveConfig(row)} disabled={busy === "save-" + row.client_id} style={btnPrimary}>{busy === "save-" + row.client_id ? "Guardando…" : "Guardar"}</button>
                  <a href={`/api/clients/${row.client_id}/pdf`} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>👁 Ver PDF</a>
                  <a href={`/api/clients/${row.client_id}/pdf?download=1`} style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>⬇ Descargar PDF</a>
                </div>

                {/* Probar envío a TU email */}
                <div style={{ padding: 12, background: "rgba(124,58,237,0.06)", border: "1px dashed rgba(124,58,237,0.35)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#6d28d9", marginBottom: 6 }}>🧪 Probar envío (a TU email, no al cliente)</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={testEmails[row.client_id] || ""} onChange={(e) => setTestEmails((t) => ({ ...t, [row.client_id]: e.target.value }))} placeholder="tu@email.com" style={{ ...inp, flex: 1, minWidth: 180 }} />
                    <button onClick={() => sendTest(row)} disabled={busy === "test-" + row.client_id} style={{ ...btnPrimary, background: "#7c3aed" }}>{busy === "test-" + row.client_id ? "Enviando…" : "Enviar prueba"}</button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>Te llega a ti para ver cómo queda. Al cliente NO le llega.</div>
                </div>

                {/* Enviar REAL */}
                <button onClick={() => sendNow(row)} disabled={busy === "send-" + row.client_id} style={{ ...btnPrimary, background: "linear-gradient(135deg,#f9a603,#d15cfe)", width: "100%" }}>{busy === "send-" + row.client_id ? "Enviando…" : "📤 Enviar informe REAL al cliente ahora"}</button>

                {/* Historial de envíos */}
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ ...lbl, marginBottom: 0 }}>Historial de envíos</label>
                    <button onClick={() => loadLog(row.client_id)} style={{ ...btnGhost, padding: "3px 10px", fontSize: 11 }}>↻ Actualizar</button>
                  </div>
                  {(() => {
                    const list = logs[row.client_id];
                    if (!list) return <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Cargando…</div>;
                    if (!list.length) return <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Aún no se ha enviado ningún informe.</div>;
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                        {list.map((e: any) => (
                          <div key={e.reportId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--border, #e6e9ef)", borderRadius: 8, background: "var(--bg, #fff)" }}>
                            <span title={e.ok ? "Enviado" : "Falló"} style={{ fontSize: 13 }}>{e.ok ? "✅" : "❌"}</span>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {new Date(e.at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                {e.test ? " · prueba" : ""} · {e.to}
                              </div>
                              {!e.ok && e.error && <div style={{ fontSize: 11, color: "#dc2626", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.error}</div>}
                            </div>
                            <a href={e.link} target="_blank" rel="noreferrer" style={{ ...btnGhost, padding: "4px 10px", fontSize: 11, textDecoration: "none", flexShrink: 0 }}>📄 PDF</a>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const card: React.CSSProperties = { background: "var(--bg-elev, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 12, padding: 16 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid var(--border, #d9dee6)", borderRadius: 8, fontSize: 13.5, background: "var(--bg, #fff)", color: "var(--text, #0f172a)", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--text-dim, #64748b)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.02em" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", background: "var(--accent, #6366f1)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" };
const btnGhost: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-elev-2, #eef1f5)", color: "var(--text, #0f172a)", border: "1px solid var(--border, #d9dee6)", borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };
const modalBackdrop: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000 };
const modalCard: React.CSSProperties = { width: "100%", maxWidth: 560, maxHeight: "88vh", display: "flex", flexDirection: "column", background: "var(--bg-elev, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 16, boxShadow: "0 20px 60px rgba(15,23,42,0.35)", overflow: "hidden" };
const modalHeader: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border, #e2e8f0)", flexShrink: 0 };
const modalBody: React.CSSProperties = { padding: "16px 18px", overflowY: "auto", display: "grid", gap: 12 };
