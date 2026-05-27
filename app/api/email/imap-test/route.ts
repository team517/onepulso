import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/email/imap-test
 *   - Lista TODAS las carpetas IMAP con sus flags/specialUse
 *   - Detecta cuál es "Sent" según nuestra heurística
 *   - Hace un APPEND de prueba a esa carpeta para confirmar que funciona
 *   - Devuelve JSON detallado
 *
 * Querystring:
 *   ?nowrite=1   no hace append de prueba (solo lista)
 *   ?folder=...  fuerza la carpeta para el append
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const noWrite = url.searchParams.get("nowrite") === "1";
  const forceFolder = url.searchParams.get("folder");

  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const result: any = {
    started_at: new Date().toISOString(),
    imap: {
      host: cfg.imap_host,
      port: cfg.imap_port,
      secure: cfg.imap_secure,
      user: cfg.imap_user,
    },
  };

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });

  try {
    await client.connect();
    result.connected = true;

    // Listar todas las carpetas con todos sus atributos
    const list = (await client.list()) as any[];
    result.folders = list.map((m: any) => ({
      path: m.path,
      name: m.name,
      delimiter: m.delimiter,
      specialUse: m.specialUse || null,
      flags: m.flags || [],
      subscribed: m.subscribed,
    }));

    const isGmail = list.some((m: any) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));
    result.is_gmail = isGmail;

    // Detectar Sent folder con la misma lógica que appendToImapSent
    let detectedSent: string | null = null;
    let detectionMethod = "";
    for (const m of list) {
      if (m.specialUse === "\\Sent") { detectedSent = m.path; detectionMethod = "specialUse=\\Sent"; break; }
    }
    if (!detectedSent) {
      for (const m of list) {
        const flags: string[] = m.flags ?? [];
        if (flags.includes("\\Sent")) { detectedSent = m.path; detectionMethod = "flag=\\Sent"; break; }
      }
    }
    if (!detectedSent) {
      for (const m of list) {
        if (/\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoy[ée]s)\b/i.test(m.path)) {
          detectedSent = m.path; detectionMethod = "path-regex"; break;
        }
      }
    }
    if (!detectedSent && isGmail) {
      detectedSent = "[Gmail]/Sent Mail"; detectionMethod = "gmail-fallback";
    }
    result.detected_sent = detectedSent;
    result.detection_method = detectionMethod;

    // Probar append real
    const target = forceFolder || detectedSent;
    if (!noWrite && target) {
      const now = new Date().toISOString();
      const testMime = [
        `From: ${cfg.display_name ? `"${cfg.display_name}" <${cfg.email}>` : cfg.email}`,
        `To: ${cfg.email}`,
        `Subject: [onepulso IMAP test] ${now}`,
        `Message-ID: <imap-test-${Date.now()}@onepulso.local>`,
        `Date: ${new Date().toUTCString()}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `Este es un test de IMAP APPEND a la carpeta "Sent". Si lo ves en tu Gmail Enviados, IMAP append funciona.`,
        ``,
      ].join("\r\n");

      const t0 = Date.now();
      try {
        const appendResult: any = await client.append(target, testMime, ["\\Seen"]);
        result.append_test = {
          ok: true,
          ms: Date.now() - t0,
          target,
          response: appendResult,
        };
      } catch (e: any) {
        result.append_test = {
          ok: false,
          ms: Date.now() - t0,
          target,
          error: e.message,
          code: e.code || null,
          response_text: e.responseText || null,
        };
      }
    } else if (noWrite) {
      result.append_test = { skipped: true, reason: "nowrite=1" };
    } else {
      result.append_test = { skipped: true, reason: "no se detectó carpeta Sent" };
    }

    await client.logout();
  } catch (e: any) {
    result.connected = false;
    result.error = e.message;
    result.code = e.code || null;
  }

  // Diagnóstico
  if (!result.connected) {
    result.diagnosis = `🚨 No se puede conectar a IMAP: ${result.error}`;
  } else if (!result.detected_sent) {
    result.diagnosis = `⚠️ No se detectó ninguna carpeta Sent. Mira el array 'folders' y dime cuál es la tuya — la añadiré al detector.`;
  } else if (result.append_test?.ok) {
    result.diagnosis = `✅ APPEND funciona en "${result.detected_sent}". Ve a tu Gmail Enviados → debería aparecer "[onepulso IMAP test]". Si lo ves, el problema con los follow-ups está en otro sitio.`;
  } else if (result.append_test?.ok === false) {
    result.diagnosis = `❌ APPEND falla en "${result.detected_sent}": ${result.append_test.error}. Probables causas: (1) la app password no tiene permisos de escritura, (2) Gmail rechaza el MIME por From mismatch, (3) la carpeta no acepta append.`;
  }

  result.finished_at = new Date().toISOString();
  return NextResponse.json(result);
}
