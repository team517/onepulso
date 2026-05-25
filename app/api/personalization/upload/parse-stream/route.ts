import { NextRequest } from "next/server";
import { parseCSVStreamed } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/personalization/upload/parse-stream?file_id=X&filename=Y
 * SSE: parsea el CSV emitiendo eventos `progress` cada 100 filas y al final
 * un evento `done` con la metadata completa (columns + row_count + preview).
 *
 * Eventos:
 *  - event: progress  → { loaded: N, total_estimate: N }
 *  - event: done      → { file_id, filename, columns, row_count, preview }
 *  - event: error     → { message }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const file_id = url.searchParams.get("file_id");
  const filename = url.searchParams.get("filename") || "(sin nombre)";
  if (!file_id) return new Response("file_id requerido", { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      try {
        send("start", { file_id, filename });
        const meta = await parseCSVStreamed(file_id, filename, async ({ loaded, totalEstimate, emails, rowsWithEmail, atSymbols, parseMode, errors }) => {
          send("progress", {
            loaded,
            total_estimate: totalEstimate,
            emails,
            rows_with_email: rowsWithEmail,
            at_symbols: atSymbols,
            parse_mode: parseMode,
            parse_errors: errors,
          });
        }, 100);
        // DEBUG: exponer también las stats brutas del archivo en el server
        // para validación cruzada con el cliente (detectar truncacion).
        const { readBlob } = await import("@/lib/storage");
        const blob = await readBlob(`csv/${file_id}`).catch(() => null);
        const debug = blob ? {
          blob_bytes: blob.data.length,
          blob_mime: blob.mime,
        } : null;

        send("done", {
          file_id: meta.file_id,
          filename: meta.filename,
          columns: meta.columns,
          row_count: meta.row_count,
          email_count: meta.email_count,
          rows_with_email: meta.rows_with_email,
          at_symbols: meta.at_symbols,
          email_columns: meta.email_columns,
          emails_by_column: meta.emails_by_column,
          parse_mode: meta.parse_mode,
          debug,
          preview: meta.preview,
        });
      } catch (e: any) {
        send("error", { message: e?.message || String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
