import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 800; // VACUUM FULL de tabla con bloat puede tardar

/**
 * GET /api/admin/db-maintenance
 * Diagnóstico: tamaño de tablas, top filas más grandes, tamaño del WAL.
 *
 * POST /api/admin/db-maintenance?action=vacuum
 *   VACUUM FULL de kv_store y blob_store → recupera espacio de dead tuples.
 *
 * POST /api/admin/db-maintenance?action=purge-big
 *   Borra blobs basura conocidos: email-threads/archive, personalization-job/*
 *   antiguos, y trunca kv_store de claves enormes que no se necesitan.
 */
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const data = await withClient(async (c) => {
      // Tamaño total de la base de datos
      const dbSize = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size, pg_database_size(current_database()) AS bytes`);
      // Tamaño de cada tabla (incluye índices + toast + dead tuples)
      const tables = await c.query(`
        SELECT relname AS tabla,
               pg_size_pretty(pg_total_relation_size(relid)) AS tamano,
               pg_total_relation_size(relid) AS bytes,
               n_live_tup AS filas_vivas,
               n_dead_tup AS filas_muertas
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 20
      `);
      // Top 20 claves más grandes en kv_store
      const bigKeys = await c.query(`
        SELECT key, pg_size_pretty(octet_length(value::text)::bigint) AS tamano,
               octet_length(value::text) AS bytes
        FROM kv_store
        ORDER BY octet_length(value::text) DESC
        LIMIT 20
      `).catch(() => ({ rows: [] }));
      // Tamaño del WAL
      const wal = await c.query(`
        SELECT pg_size_pretty(SUM(size)) AS wal_size, COUNT(*) AS wal_files
        FROM pg_ls_waldir()
      `).catch(() => ({ rows: [{ wal_size: "?", wal_files: "?" }] }));
      // Blobs binarios
      const blobs = await c.query(`
        SELECT key, pg_size_pretty(octet_length(data)::bigint) AS tamano, octet_length(data) AS bytes
        FROM blob_store ORDER BY octet_length(data) DESC LIMIT 20
      `).catch(() => ({ rows: [] }));
      return {
        db_size: dbSize.rows[0],
        tables: tables.rows,
        top_kv_keys: bigKeys.rows,
        top_blobs: blobs.rows,
        wal: wal.rows[0],
      };
    });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const action = new URL(req.url).searchParams.get("action") || "";

  try {
    if (action === "vacuum") {
      // VACUUM FULL recupera el espacio de dead tuples (reescribe tabla compacta).
      const result = await withClient(async (c) => {
        // Sin timeout para el VACUUM (puede tardar con 174GB de bloat).
        await c.query(`SET statement_timeout = 0`);
        const before = await c.query(`SELECT pg_database_size(current_database()) AS bytes`);
        await c.query(`VACUUM FULL kv_store`);
        await c.query(`VACUUM FULL blob_store`);
        const after = await c.query(`SELECT pg_database_size(current_database()) AS bytes`);
        return {
          before_gb: (Number(before.rows[0].bytes) / 1024 / 1024 / 1024).toFixed(1),
          after_gb: (Number(after.rows[0].bytes) / 1024 / 1024 / 1024).toFixed(1),
          freed_gb: ((Number(before.rows[0].bytes) - Number(after.rows[0].bytes)) / 1024 / 1024 / 1024).toFixed(1),
        };
      });
      return NextResponse.json({ ok: true, action: "vacuum", ...result });
    }

    if (action === "purge-big") {
      // Borra claves basura conocidas que inflan el disco.
      const result = await withClient(async (c) => {
        const deleted: Record<string, number> = {};
        // 1. Archivo de threads (no se usa para el unibox)
        const r1 = await c.query(`DELETE FROM kv_store WHERE key = 'email-threads/archive'`);
        deleted["email-threads/archive"] = r1.rowCount || 0;
        // 2. Jobs de personalización grandes (resultados ya descargables como CSV)
        const r3 = await c.query(`DELETE FROM kv_store WHERE key LIKE 'personalization-job/%' AND octet_length(value::text) > 3000000`);
        deleted["personalization-jobs grandes (kv)"] = r3.rowCount || 0;
        // 3. CSVs de resultados de personalización en blob_store (ya generados, ocupan ~500MB)
        const r4 = await c.query(`DELETE FROM blob_store WHERE key LIKE 'personalization-result/%'`);
        deleted["personalization-result CSVs (blob)"] = r4.rowCount || 0;
        // 4. CSVs crudos subidos ya procesados (blob_store)
        const r5 = await c.query(`DELETE FROM blob_store WHERE key LIKE 'csv/%' AND octet_length(data) > 10000000`);
        deleted["csv crudos grandes (blob)"] = r5.rowCount || 0;
        return deleted;
      });
      return NextResponse.json({ ok: true, action: "purge-big", deleted: result });
    }

    return NextResponse.json({ error: "Acción no reconocida. Usa ?action=vacuum o ?action=purge-big" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
