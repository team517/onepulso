import { NextRequest, NextResponse } from "next/server";
import { parse as csvParse } from "csv-parse/sync";
import crypto from "crypto";
import { getUnibox, listAccounts, saveAccounts, UniboxAccount } from "@/lib/unibox-store";
import { requireAdmin } from "@/lib/unibox-auth";

function pick(row: any, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return String(row[k]).trim();
    }
  }
  return "";
}
function parseBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "si" || s === "sí";
}
function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/)[0] || "";
  const counts: Record<string, number> = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };
  let best = ",", max = 0;
  for (const [d, c] of Object.entries(counts)) if (c > max) { max = c; best = d; }
  return best;
}

function buildAccountFromRow(r: any, uniboxId: string): Omit<UniboxAccount, "id" | "unibox_id"> | null {
  const email = pick(r, "Email", "email", "EMAIL", "user");
  if (!email) return null;
  const imap_pass = pick(r, "IMAP Password", "imap_password", "imap_pass", "password", "Password");
  const imap_host = pick(r, "IMAP Host", "imap_host", "imap", "imap_server");
  const smtp_host = pick(r, "SMTP Host", "smtp_host", "smtp", "smtp_server");
  if (!imap_pass || !imap_host || !smtp_host) return null;
  return {
    email,
    first_name: pick(r, "First Name", "first_name", "FirstName"),
    last_name: pick(r, "Last Name", "last_name", "LastName"),
    imap_user: pick(r, "IMAP Username", "imap_username", "imap_user") || email,
    imap_pass,
    imap_host,
    imap_port: parseInt(pick(r, "IMAP Port", "imap_port")) || 993,
    smtp_user: pick(r, "SMTP Username", "smtp_username", "smtp_user") || email,
    smtp_pass: pick(r, "SMTP Password", "smtp_password", "smtp_pass") || imap_pass,
    smtp_host,
    smtp_port: parseInt(pick(r, "SMTP Port", "smtp_port")) || 587,
    daily_limit: parseInt(pick(r, "Daily Limit", "daily_limit")) || null,
    warmup_enabled: parseBool(pick(r, "Warmup Enabled", "warmup_enabled")),
    warmup_limit: parseInt(pick(r, "Warmup Limit", "warmup_limit")) || null,
    warmup_increment: parseInt(pick(r, "Warmup Increment", "warmup_increment")) || null,
  };
}

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const u = await getUnibox(id);
  if (!u) return NextResponse.json({ error: "Unibox no encontrada" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se subió archivo" }, { status: 400 });

  let content = Buffer.from(await file.arrayBuffer()).toString("utf8");
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const delimiter = detectDelimiter(content);

  let records: any[] = [];
  try {
    records = csvParse(content, {
      columns: true, skip_empty_lines: true, trim: true,
      relax_column_count: true, relax_quotes: true, bom: true,
      delimiter,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "CSV inválido: " + e.message }, { status: 400 });
  }

  const accounts = await listAccounts(id);
  let added = 0, skippedDup = 0, skippedErr = 0;
  const errors: string[] = [];
  const newIds: string[] = [];

  records.forEach((r, idx) => {
    const hasAny = Object.values(r).some((v: any) => v && String(v).trim() !== "");
    if (!hasAny) return;
    const acc = buildAccountFromRow(r, id);
    if (!acc) {
      skippedErr++;
      errors.push(`Fila ${idx + 2}: faltan campos requeridos`);
      return;
    }
    if (accounts.find((a) => a.email === acc.email)) {
      skippedDup++;
      errors.push(`Fila ${idx + 2} [${acc.email}]: ya existe`);
      return;
    }
    const accId = crypto.randomBytes(8).toString("hex");
    accounts.push({ ...acc, id: accId, unibox_id: id });
    newIds.push(accId);
    added++;
  });

  await saveAccounts(id, accounts);

  return NextResponse.json({
    added,
    skipped_dup: skippedDup,
    skipped_err: skippedErr,
    rows_in_csv: records.length,
    delimiter,
    headers: records[0] ? Object.keys(records[0]) : [],
    errors: errors.slice(0, 30),
    new_ids: newIds,
    total: accounts.length,
  });
}
