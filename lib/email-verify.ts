/**
 * VERIFICADOR DE EMAILS — estilo MillionVerifier, nativo en la plataforma.
 *
 * Pasos (los mismos que un servicio profesional):
 *   1. Sintaxis (formato RFC básico).
 *   2. Dominio + MX (DNS): el dominio debe existir y tener servidor de correo.
 *   3. Sondeo SMTP (RCPT TO, sin ENVIAR nada): preguntamos al servidor del
 *      dominio si el buzón existe (250 = existe, 550 = no existe).
 *   4. Detección de catch-all (servidor que acepta TODO → "arriesgado"),
 *      dominios desechables y buzones de rol (info@, admin@…).
 *   5. Duplicados (se hace a nivel de lote, en verifyBatch).
 *
 * NOTA REAL: el paso 3 necesita el puerto 25 de SALIDA. Algunos hostings lo
 * bloquean (Railway lo bloquea en planes bajos; en Pro/Enterprise no). Si no
 * podemos conectar, el email NO se marca inválido: se marca "unknown" (no
 * comprobable) para no tirar buenos por error. Así el verificador funciona en
 * cualquier plan, usando el sondeo SMTP cuando está disponible.
 */
import { promises as dns } from "dns";
import net from "net";

export type VerifyStatus = "valid" | "invalid" | "risky" | "unknown" | "duplicate";

export type VerifyResult = {
  email: string;
  status: VerifyStatus;
  reason: string;
  syntax_ok: boolean;
  has_mx: boolean;
  disposable: boolean;
  role: boolean;
  catch_all: boolean;
  smtp_checked: boolean; // si pudimos hablar con el servidor (puerto 25 disponible)
};

// Formato: suficientemente estricto sin rechazar direcciones legítimas raras.
const EMAIL_RE = /^[^\s@"'(),:;<>[\]\\]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

// Buzones "de rol" (no son personas concretas) → arriesgados para outreach.
const ROLE_LOCALPARTS = new Set([
  "info", "admin", "administrator", "support", "soporte", "sales", "ventas",
  "contact", "contacto", "hello", "hola", "help", "ayuda", "noreply", "no-reply",
  "donotreply", "postmaster", "webmaster", "abuse", "billing", "facturacion",
  "marketing", "office", "team", "equipo", "hr", "rrhh", "jobs", "career",
  "careers", "press", "media", "newsletter", "notifications", "notification",
]);

// Dominios desechables / temporales más comunes (lista compacta y ampliable).
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com", "getnada.com",
  "trashmail.com", "sharklasers.com", "maildrop.cc", "dispostable.com", "fakeinbox.com",
  "mailnesia.com", "mohmal.com", "emailondeck.com", "tmpmail.net", "spam4.me",
  "mintemail.com", "discard.email", "tempr.email", "moakt.com", "luxusmail.org",
]);

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function domainOf(email: string): string {
  const i = email.lastIndexOf("@");
  return i === -1 ? "" : email.slice(i + 1);
}

export function localPartOf(email: string): string {
  const i = email.lastIndexOf("@");
  return i === -1 ? email : email.slice(0, i);
}

export function isValidSyntax(email: string): boolean {
  if (!email || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

export function isRoleAccount(email: string): boolean {
  return ROLE_LOCALPARTS.has(localPartOf(email));
}

export function isDisposable(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(domainOf(email));
}

// Cache de MX por dominio (evita repetir DNS para el mismo dominio en un lote).
const _mxCache = new Map<string, { hosts: string[]; ts: number }>();
const MX_TTL = 10 * 60_000;

async function getMxHosts(domain: string): Promise<string[]> {
  const cached = _mxCache.get(domain);
  if (cached && Date.now() - cached.ts < MX_TTL) return cached.hosts;
  let hosts: string[] = [];
  try {
    const mx = await dns.resolveMx(domain);
    hosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter(Boolean);
  } catch {
    hosts = [];
  }
  // Fallback RFC: si no hay MX pero sí registro A, el dominio puede recibir correo.
  if (hosts.length === 0) {
    try {
      const a = await dns.resolve4(domain);
      if (a.length > 0) hosts = [domain];
    } catch {}
  }
  _mxCache.set(domain, { hosts, ts: Date.now() });
  return hosts;
}

// Si el puerto 25 está bloqueado en este host, lo detectamos una vez y dejamos
// de intentar sondeos SMTP (todos quedan "unknown") — así no esperamos timeouts.
let _smtpBlocked: boolean | null = null;

type SmtpAnswer = { ok: boolean; accepted?: boolean; code?: number; blocked?: boolean };

/**
 * Sondea un servidor MX por SMTP para una dirección concreta, SIN enviar correo.
 * Devuelve si el buzón es aceptado (250) o rechazado (550), o si no se pudo.
 */
function smtpProbe(
  mxHost: string,
  email: string,
  fromAddr: string,
  timeoutMs = 8000
): Promise<SmtpAnswer> {
  return new Promise((resolve) => {
    let stage = 0; // 0 greeting, 1 EHLO, 2 MAIL FROM, 3 RCPT TO
    let done = false;
    const socket = net.createConnection({ host: mxHost, port: 25 });
    socket.setTimeout(timeoutMs);

    const finish = (ans: SmtpAnswer) => {
      if (done) return;
      done = true;
      try { socket.write("QUIT\r\n"); } catch {}
      try { socket.destroy(); } catch {}
      resolve(ans);
    };

    socket.on("connect", () => { /* esperamos el saludo del servidor */ });
    socket.on("timeout", () => finish({ ok: false }));
    socket.on("error", (err: any) => {
      // ECONNREFUSED / EACCES / ETIMEDOUT / ENETUNREACH típicos de puerto 25 bloqueado.
      const code = err?.code || "";
      const blocked = ["EACCES", "ENETUNREACH", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH"].includes(code);
      finish({ ok: false, blocked });
    });

    socket.on("data", (buf) => {
      const line = buf.toString();
      const code = parseInt(line.slice(0, 3), 10);
      if (stage === 0) {
        if (code !== 220) return finish({ ok: false });
        socket.write(`EHLO verifier.local\r\n`);
        stage = 1;
      } else if (stage === 1) {
        socket.write(`MAIL FROM:<${fromAddr}>\r\n`);
        stage = 2;
      } else if (stage === 2) {
        if (code !== 250) return finish({ ok: false });
        socket.write(`RCPT TO:<${email}>\r\n`);
        stage = 3;
      } else if (stage === 3) {
        if (code === 250 || code === 251) return finish({ ok: true, accepted: true, code });
        if (code === 550 || code === 551 || code === 553 || code === 554 || code === 501) {
          return finish({ ok: true, accepted: false, code });
        }
        // 450/451/452 = greylisting/temporal → no concluyente
        return finish({ ok: false, code });
      }
    });
  });
}

/** Verifica UN email (sin dedup; eso se hace en verifyBatch). */
export async function verifyEmail(email: string, opts: { fromAddr?: string; smtp?: boolean } = {}): Promise<VerifyResult> {
  const e = normalizeEmail(email);
  const base: VerifyResult = {
    email: e, status: "unknown", reason: "", syntax_ok: false, has_mx: false,
    disposable: false, role: false, catch_all: false, smtp_checked: false,
  };

  // 1. Sintaxis
  if (!isValidSyntax(e)) return { ...base, status: "invalid", reason: "formato inválido" };
  base.syntax_ok = true;

  // Desechable / rol (no invalida por sí solo, pero marca riesgo)
  base.disposable = isDisposable(e);
  base.role = isRoleAccount(e);
  if (base.disposable) return { ...base, status: "invalid", reason: "dominio desechable" };

  // 2. MX / DNS
  const domain = domainOf(e);
  const mxHosts = await getMxHosts(domain);
  if (mxHosts.length === 0) {
    return { ...base, status: "invalid", reason: "el dominio no puede recibir correo (sin MX/DNS)" };
  }
  base.has_mx = true;

  // 3. Sondeo SMTP (si está habilitado y el puerto 25 no está bloqueado)
  const wantSmtp = opts.smtp !== false;
  if (wantSmtp && _smtpBlocked !== true) {
    const fromAddr = opts.fromAddr || "verify@onepulso.online";
    const mx = mxHosts[0];
    const ans = await smtpProbe(mx, e, fromAddr);
    if (ans.blocked) {
      _smtpBlocked = true; // el host bloquea el puerto 25 → no insistir
    } else if (ans.ok) {
      base.smtp_checked = true;
      if (ans.accepted === false) {
        return { ...base, status: "invalid", reason: `el servidor rechaza el buzón (${ans.code})` };
      }
      // Aceptado → comprobar catch-all: ¿acepta también una dirección que NO existe?
      const randomLocal = `no-existe-${Math.abs(hashStr(e)).toString(36)}@${domain}`;
      const caAns = await smtpProbe(mx, randomLocal, fromAddr);
      if (caAns.ok && caAns.accepted === true) {
        base.catch_all = true;
        return { ...base, status: "risky", reason: "catch-all (el servidor acepta todo)" };
      }
      // Aceptado y NO catch-all → buzón real
      const reason = base.role ? "válido (buzón de rol)" : "válido (buzón existe)";
      return { ...base, status: base.role ? "risky" : "valid", reason };
    }
  }

  // Sin sondeo SMTP concluyente → válido a nivel de dominio, pero no de buzón.
  if (base.role) return { ...base, status: "risky", reason: "buzón de rol (dominio OK, buzón no comprobado)" };
  return { ...base, status: "unknown", reason: "dominio OK; buzón no comprobable (SMTP no disponible)" };
}

// Hash determinista (sin Math.random) para generar la dirección catch-all.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export type BatchSummary = {
  total: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
  duplicates: number;
  smtp_available: boolean; // si el puerto 25 funcionó al menos una vez
};

/**
 * Verifica un LOTE: deduplica, verifica con concurrencia limitada y agrupa por
 * dominio (reaprovecha MX). Devuelve resultados + resumen.
 */
export async function verifyBatch(
  emails: string[],
  opts: { fromAddr?: string; smtp?: boolean; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ results: VerifyResult[]; summary: BatchSummary }> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 20));
  const seen = new Set<string>();
  const unique: string[] = [];
  const results: VerifyResult[] = [];
  let duplicates = 0;

  for (const raw of emails) {
    const e = normalizeEmail(raw);
    if (!e) continue;
    if (seen.has(e)) {
      duplicates++;
      results.push({
        email: e, status: "duplicate", reason: "duplicado", syntax_ok: isValidSyntax(e),
        has_mx: false, disposable: false, role: false, catch_all: false, smtp_checked: false,
      });
      continue;
    }
    seen.add(e);
    unique.push(e);
  }

  let done = 0;
  let i = 0;
  let smtpAvailable = false;
  async function worker() {
    while (i < unique.length) {
      const idx = i++;
      const r = await verifyEmail(unique[idx], { fromAddr: opts.fromAddr, smtp: opts.smtp });
      if (r.smtp_checked) smtpAvailable = true;
      results.push(r);
      done++;
      opts.onProgress?.(done, unique.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const summary: BatchSummary = {
    total: emails.length,
    valid: results.filter((r) => r.status === "valid").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    risky: results.filter((r) => r.status === "risky").length,
    unknown: results.filter((r) => r.status === "unknown").length,
    duplicates,
    smtp_available: smtpAvailable,
  };
  return { results, summary };
}
