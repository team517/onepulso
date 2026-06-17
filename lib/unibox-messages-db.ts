/**
 * ALMACÉN DE MENSAJES DE UNIBOX EN FILAS (no en un bloque JSON gigante).
 *
 * PROBLEMA QUE RESUELVE: antes todos los mensajes de una unibox se guardaban
 * en UNA sola fila JSONB (`uniboxes/{id}/messages`). Leer la bandeja cargaba
 * y parseaba varios MB; guardar un mensaje reescribía el bloque entero. Eso
 * hacía la plataforma lenta y la colgaba (RAM + dead-tuples + CPU).
 *
 * AHORA: cada mensaje es una fila en `unibox_messages`, indexada por
 * (unibox_id, fecha). Listar la bandeja es una query paginada que NO trae los
 * cuerpos. Guardar/actualizar un mensaje toca SOLO su fila.
 *
 * SEGURIDAD: la migración desde el bloque viejo es idempotente y NO borra el
 * bloque (queda como copia de seguridad). Si la tabla aún no tiene datos de
 * una unibox, se importan del bloque la primera vez que se accede.
 */
import { withClient } from "./db";
import { readJson } from "./storage";
import type { UniboxMessage } from "./unibox-store";
import { isBounceOrFailure } from "./unibox-store";

export type UniboxMessageRow = UniboxMessage & { accountId?: string; is_sent?: boolean };

let _tableReady = false;

/** Crea la tabla + índices (idempotente). */
export async function ensureMessagesTable(): Promise<void> {
  if (_tableReady) return;
  await withClient(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS unibox_messages (
        unibox_id     TEXT NOT NULL,
        account_id    TEXT NOT NULL,
        uid           BIGINT NOT NULL,
        message_id    TEXT NOT NULL DEFAULT '',
        in_reply_to   TEXT,
        refs          JSONB NOT NULL DEFAULT '[]',
        from_raw      TEXT NOT NULL DEFAULT '',
        from_name     TEXT NOT NULL DEFAULT '',
        from_address  TEXT NOT NULL DEFAULT '',
        to_raw        TEXT NOT NULL DEFAULT '',
        to_address    TEXT NOT NULL DEFAULT '',
        subject       TEXT NOT NULL DEFAULT '',
        msg_date      TIMESTAMPTZ,
        preview       TEXT NOT NULL DEFAULT '',
        body_text     TEXT NOT NULL DEFAULT '',
        body_html     TEXT NOT NULL DEFAULT '',
        unread        BOOLEAN NOT NULL DEFAULT false,
        is_warmup     BOOLEAN NOT NULL DEFAULT false,
        is_sent       BOOLEAN NOT NULL DEFAULT false,
        folder_id     TEXT,
        attachments   JSONB NOT NULL DEFAULT '[]',
        PRIMARY KEY (unibox_id, account_id, uid)
      );
      CREATE INDEX IF NOT EXISTS unibox_messages_date_idx
        ON unibox_messages (unibox_id, msg_date DESC);
      CREATE INDEX IF NOT EXISTS unibox_messages_acc_date_idx
        ON unibox_messages (unibox_id, account_id, msg_date DESC);
    `);
    // Autovacuum agresivo: muchas filas pequeñas con UPDATEs frecuentes.
    await c.query(`
      ALTER TABLE unibox_messages SET (
        autovacuum_vacuum_scale_factor = 0.05,
        autovacuum_vacuum_threshold = 200
      )
    `).catch(() => {});
  });
  _tableReady = true;
}

const _migrated = new Set<string>();
const _migrating = new Map<string, Promise<void>>();

/** Importa los mensajes del bloque viejo a la tabla, UNA vez por unibox.
 *  No borra el bloque. Idempotente y con coalescing: si varias llamadas
 *  concurrentes (p.ej. 6 cuentas sincronizando a la vez) la invocan, solo
 *  se ejecuta una migración real; las demás esperan a esa. */
export async function ensureMigrated(uniboxId: string): Promise<void> {
  if (_migrated.has(uniboxId)) return;
  const inflight = _migrating.get(uniboxId);
  if (inflight) return inflight;

  const run = (async () => {
    await ensureMessagesTable();
    const already = await withClient((c) =>
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM unibox_messages WHERE unibox_id = $1`, [uniboxId])
    );
    if (Number(already.rows[0]?.n || 0) > 0) {
      _migrated.add(uniboxId);
      return;
    }
    // Tabla vacía para esta unibox → importar del bloque (si existe).
    const blob = await readJson<Record<string, UniboxMessage[]>>(`uniboxes/${uniboxId}/messages`);
    if (blob && typeof blob === "object") {
      for (const accId of Object.keys(blob)) {
        const msgs = blob[accId] || [];
        // Saltar bounces al importar (no deben estar en la bandeja).
        const clean = msgs.filter((m) => !isBounceOrFailure(m));
        if (clean.length) await upsertMessages(uniboxId, accId, clean);
      }
      console.log(`[unibox-messages-db] migrada unibox ${uniboxId} desde bloque a tabla`);
    }
    _migrated.add(uniboxId);
  })();

  _migrating.set(uniboxId, run);
  try {
    await run;
  } finally {
    _migrating.delete(uniboxId);
  }
}

function rowToMessage(r: any): UniboxMessageRow {
  return {
    uid: Number(r.uid),
    messageId: r.message_id || "",
    inReplyTo: r.in_reply_to || undefined,
    references: Array.isArray(r.refs) ? r.refs : [],
    from: r.from_raw || "",
    fromName: r.from_name || "",
    fromAddress: r.from_address || "",
    to: r.to_raw || "",
    toAddress: r.to_address || "",
    subject: r.subject || "",
    date: r.msg_date ? new Date(r.msg_date).toISOString() : "",
    preview: r.preview || "",
    text: r.body_text || "",
    html: r.body_html || "",
    unread: !!r.unread,
    is_warmup: !!r.is_warmup,
    attachments: Array.isArray(r.attachments) ? r.attachments : [],
    folder_id: r.folder_id ?? null,
    accountId: r.account_id,
    is_sent: !!r.is_sent,
  };
}

/** Inserta/actualiza un lote de mensajes de UNA cuenta. ON CONFLICT preserva
 *  el cuerpo ya hidratado y la carpeta a la que el usuario movió el mensaje. */
export async function upsertMessages(uniboxId: string, accountId: string, msgs: UniboxMessageRow[]): Promise<void> {
  if (!msgs.length) return;
  await ensureMessagesTable();
  await withClient(async (c) => {
    // Insert por lotes en una sola sentencia (parámetros agrupados).
    const CHUNK = 200;
    for (let i = 0; i < msgs.length; i += CHUNK) {
      const slice = msgs.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: any[] = [];
      let p = 0;
      for (const m of slice) {
        const isSent = (m as any).is_sent === true || (typeof m.uid === "number" && m.uid < 0);
        values.push(
          `($${++p},$${++p},$${++p},$${++p},$${++p},$${++p}::jsonb,$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p},$${++p}::jsonb)`
        );
        params.push(
          uniboxId,
          accountId,
          m.uid,
          m.messageId || "",
          m.inReplyTo || null,
          JSON.stringify(m.references || []),
          m.from || "",
          m.fromName || "",
          m.fromAddress || "",
          m.to || "",
          m.toAddress || "",
          m.subject || "",
          m.date ? new Date(m.date).toISOString() : null,
          m.preview || "",
          m.text || "",
          m.html || "",
          !!m.unread,
          !!m.is_warmup,
          isSent,
          m.folder_id ?? null,
          JSON.stringify(m.attachments || [])
        );
      }
      await c.query(
        `INSERT INTO unibox_messages
          (unibox_id, account_id, uid, message_id, in_reply_to, refs, from_raw, from_name,
           from_address, to_raw, to_address, subject, msg_date, preview, body_text, body_html,
           unread, is_warmup, is_sent, folder_id, attachments)
         VALUES ${values.join(",")}
         ON CONFLICT (unibox_id, account_id, uid) DO UPDATE SET
           message_id   = EXCLUDED.message_id,
           in_reply_to  = EXCLUDED.in_reply_to,
           refs         = EXCLUDED.refs,
           from_raw     = EXCLUDED.from_raw,
           from_name    = EXCLUDED.from_name,
           from_address = EXCLUDED.from_address,
           to_raw       = EXCLUDED.to_raw,
           to_address   = EXCLUDED.to_address,
           subject      = EXCLUDED.subject,
           msg_date     = EXCLUDED.msg_date,
           preview      = EXCLUDED.preview,
           -- preservar cuerpo ya hidratado si el nuevo viene vacío (fast-mode)
           body_text    = CASE WHEN EXCLUDED.body_text <> '' THEN EXCLUDED.body_text ELSE unibox_messages.body_text END,
           body_html    = CASE WHEN EXCLUDED.body_html <> '' THEN EXCLUDED.body_html ELSE unibox_messages.body_html END,
           unread       = EXCLUDED.unread,
           is_warmup    = EXCLUDED.is_warmup,
           is_sent      = EXCLUDED.is_sent,
           -- preservar la carpeta a la que el usuario movió el mensaje
           folder_id    = COALESCE(unibox_messages.folder_id, EXCLUDED.folder_id),
           attachments  = CASE WHEN jsonb_array_length(EXCLUDED.attachments) > 0 THEN EXCLUDED.attachments ELSE unibox_messages.attachments END`,
        params
      );
    }
  });
}

/** Lista paginada para la bandeja. NO trae cuerpos (text/html). */
export async function listMessagesPage(opts: {
  uniboxId: string;
  accountId?: string | null;
  showWarmup?: boolean;
  folderId?: string | null; // si se pasa, filtra por esa carpeta exacta
  limit?: number;
  offset?: number;
}): Promise<{ messages: any[]; total: number; warmupCount: number }> {
  const { uniboxId } = opts;
  await ensureMigrated(uniboxId);
  const limit = Math.min(opts.limit ?? 2000, 2000);
  const offset = opts.offset ?? 0;

  return withClient(async (c) => {
    const where: string[] = [`unibox_id = $1`];
    const params: any[] = [uniboxId];
    if (opts.accountId) {
      params.push(opts.accountId);
      where.push(`account_id = $${params.length}`);
    }
    if (!opts.showWarmup) where.push(`is_warmup = false`);
    const whereSql = where.join(" AND ");

    // warmupCount: total de warmup en la unibox (con filtro de cuenta).
    const warmWhere: string[] = [`unibox_id = $1`, `is_warmup = true`];
    const warmParams: any[] = [uniboxId];
    if (opts.accountId) {
      warmParams.push(opts.accountId);
      warmWhere.push(`account_id = $${warmParams.length}`);
    }

    const [rows, totalRes, warmRes] = await Promise.all([
      c.query(
        `SELECT account_id, uid, message_id, from_raw, from_name, from_address, to_raw, to_address,
                subject, msg_date, preview, unread, is_warmup, is_sent, folder_id,
                jsonb_array_length(attachments) AS att_count,
                (body_text <> '' OR body_html <> '') AS has_body
         FROM unibox_messages
         WHERE ${whereSql}
         ORDER BY msg_date DESC NULLS LAST
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM unibox_messages WHERE ${whereSql}`, params),
      c.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM unibox_messages WHERE ${warmWhere.join(" AND ")}`, warmParams),
    ]);

    const messages = rows.rows.map((r: any) => ({
      uid: Number(r.uid),
      accountId: r.account_id,
      messageId: r.message_id || "",
      from: r.from_raw || "",
      fromName: r.from_name || "",
      fromAddress: r.from_address || "",
      to: r.to_raw || "",
      toAddress: r.to_address || "",
      subject: r.subject || "",
      date: r.msg_date ? new Date(r.msg_date).toISOString() : "",
      preview: r.preview || "",
      unread: !!r.unread,
      is_warmup: !!r.is_warmup,
      is_sent: !!r.is_sent,
      folder_id: r.folder_id ?? null,
      has_attachments: Number(r.att_count || 0) > 0,
      has_body: !!r.has_body,
    }));

    return {
      messages,
      total: Number(totalRes.rows[0]?.n || 0),
      warmupCount: Number(warmRes.rows[0]?.n || 0),
    };
  });
}

/** Devuelve UN mensaje completo (con cuerpo). */
export async function getMessageRow(uniboxId: string, accountId: string, uid: number): Promise<UniboxMessageRow | null> {
  await ensureMigrated(uniboxId);
  const r = await withClient((c) =>
    c.query(`SELECT * FROM unibox_messages WHERE unibox_id = $1 AND account_id = $2 AND uid = $3`, [uniboxId, accountId, uid])
  );
  if (!r.rows[0]) return null;
  return rowToMessage(r.rows[0]);
}

/** Actualiza el cuerpo + adjuntos + preview (tras hidratar desde IMAP). */
export async function setMessageBody(
  uniboxId: string,
  accountId: string,
  uid: number,
  fields: { text?: string; html?: string; preview?: string; attachments?: any[]; is_warmup?: boolean }
): Promise<void> {
  await ensureMessagesTable();
  await withClient((c) =>
    c.query(
      `UPDATE unibox_messages SET
         body_text = COALESCE($4, body_text),
         body_html = COALESCE($5, body_html),
         preview = COALESCE($6, preview),
         attachments = COALESCE($7::jsonb, attachments),
         is_warmup = COALESCE($8, is_warmup)
       WHERE unibox_id = $1 AND account_id = $2 AND uid = $3`,
      [
        uniboxId, accountId, uid,
        fields.text ?? null,
        fields.html ?? null,
        fields.preview ?? null,
        fields.attachments ? JSON.stringify(fields.attachments) : null,
        typeof fields.is_warmup === "boolean" ? fields.is_warmup : null,
      ]
    )
  );
}

/** Mueve un mensaje a una carpeta (o lo saca, folderId = null). */
export async function setMessageFolder(uniboxId: string, accountId: string, uid: number, folderId: string | null): Promise<void> {
  await ensureMessagesTable();
  await withClient((c) =>
    c.query(`UPDATE unibox_messages SET folder_id = $4 WHERE unibox_id = $1 AND account_id = $2 AND uid = $3`,
      [uniboxId, accountId, uid, folderId])
  );
}

/** Borra todos los mensajes de una carpeta que se elimina (los saca de ella). */
export async function clearFolderAssignments(uniboxId: string, folderId: string): Promise<void> {
  await ensureMessagesTable();
  await withClient((c) =>
    c.query(`UPDATE unibox_messages SET folder_id = NULL WHERE unibox_id = $1 AND folder_id = $2`, [uniboxId, folderId])
  );
}

/** Borra TODOS los mensajes de una unibox. */
export async function deleteAllMessages(uniboxId: string): Promise<{ accounts: number; deleted: number }> {
  await ensureMessagesTable();
  return withClient(async (c) => {
    const before = await c.query<{ accounts: string; total: string }>(
      `SELECT COUNT(DISTINCT account_id)::text AS accounts, COUNT(*)::text AS total FROM unibox_messages WHERE unibox_id = $1`,
      [uniboxId]
    );
    await c.query(`DELETE FROM unibox_messages WHERE unibox_id = $1`, [uniboxId]);
    return { accounts: Number(before.rows[0]?.accounts || 0), deleted: Number(before.rows[0]?.total || 0) };
  });
}

/** Borra los mensajes de UNA cuenta (al desconectar/eliminar la cuenta). */
export async function deleteAccountMessages(uniboxId: string, accountId: string): Promise<void> {
  await ensureMessagesTable();
  await withClient((c) => c.query(`DELETE FROM unibox_messages WHERE unibox_id = $1 AND account_id = $2`, [uniboxId, accountId]));
}

/** Borra mensajes concretos por uid (lista). */
export async function deleteMessageByUid(uniboxId: string, accountId: string, uid: number): Promise<boolean> {
  await ensureMessagesTable();
  const r = await withClient((c) =>
    c.query(`DELETE FROM unibox_messages WHERE unibox_id = $1 AND account_id = $2 AND uid = $3`, [uniboxId, accountId, uid])
  );
  return (r.rowCount || 0) > 0;
}

/** Mapa completo {accountId: msgs[]} — compatibilidad con código antiguo.
 *  Úsalo SOLO en rutas no críticas (reclasificar, herramientas). */
export async function loadMessagesMapDb(uniboxId: string): Promise<Record<string, UniboxMessageRow[]>> {
  await ensureMigrated(uniboxId);
  const r = await withClient((c) =>
    c.query(`SELECT * FROM unibox_messages WHERE unibox_id = $1 ORDER BY msg_date DESC NULLS LAST`, [uniboxId])
  );
  const map: Record<string, UniboxMessageRow[]> = {};
  for (const row of r.rows) {
    const m = rowToMessage(row);
    const acc = (row as any).account_id;
    (map[acc] ||= []).push(m);
  }
  return map;
}

/** Reemplaza TODO el contenido de una unibox por el mapa dado (transacción).
 *  Compatibilidad con código antiguo que hacía load→mutar→save del mapa. */
export async function replaceMessagesMapDb(uniboxId: string, map: Record<string, UniboxMessageRow[]>): Promise<void> {
  await ensureMessagesTable();
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`DELETE FROM unibox_messages WHERE unibox_id = $1`, [uniboxId]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  });
  for (const accId of Object.keys(map)) {
    await upsertMessages(uniboxId, accId, map[accId] || []);
  }
}
