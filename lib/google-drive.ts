/**
 * Integración con Google Drive vía REST API directa (sin dep pesada de googleapis).
 *
 * Flow:
 *   1. /api/drive/auth → redirige a Google consent
 *   2. Google → /api/drive/callback?code=... → intercambiamos por tokens
 *   3. Guardamos refresh_token + access_token (con expiry) en Postgres
 *   4. driveFetch() lee tokens, refresca si hace falta, llama a la API
 */
import { readJson, writeJson } from "./storage";
import { envVar } from "./env";

const KEY_TOKENS = "google-drive-tokens";
const KEY_CONFIG = "google-drive-config";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",         // lectura + escritura
  "https://www.googleapis.com/auth/drive.metadata", // metadata de archivos
].join(" ");

export type GoogleTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope?: string;
  token_type?: string;
  user_email?: string;
};

export type WatchedFolder = {
  id: string;
  name: string;
  path: string; // ruta legible "Trabajo / Clientes / Acme"
  added_at: string;
};

export type DriveConfig = {
  watched_folders: WatchedFolder[];
};

function getClientId(): string {
  return envVar("GOOGLE_DRIVE_CLIENT_ID") || envVar("GOOGLE_CLIENT_ID") || "";
}
function getClientSecret(): string {
  return envVar("GOOGLE_DRIVE_CLIENT_SECRET") || envVar("GOOGLE_CLIENT_SECRET") || "";
}
function getRedirectUri(): string {
  const base = envVar("APP_BASE_URL") || envVar("NEXT_PUBLIC_APP_URL") || "https://onepulso.up.railway.app";
  return `${base.replace(/\/$/, "")}/api/drive/callback`;
}

export function isDriveConfigured(): boolean {
  return !!(getClientId() && getClientSecret());
}

export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",   // necesario para que devuelva refresh_token
    prompt: "consent",         // forzar la pantalla de consent para asegurar refresh_token
    include_granted_scopes: "true",
    ...(state ? { state } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Intercambia el code por tokens y los guarda. */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OAuth exchange failed: ${res.status} ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.refresh_token) {
    throw new Error(
      "Google no devolvió refresh_token. Revoca el acceso en https://myaccount.google.com/permissions y vuelve a autorizar."
    );
  }
  // Conseguir el email del usuario para mostrarlo
  let userEmail: string | undefined;
  try {
    const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then((r) => r.json());
    userEmail = profile?.email;
  } catch {}

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    scope: data.scope,
    token_type: data.token_type,
    user_email: userEmail,
  };
  await writeJson(KEY_TOKENS, tokens);
  // Inicializar config vacío si no existe
  const existing = await readJson<DriveConfig>(KEY_CONFIG);
  if (!existing) await writeJson(KEY_CONFIG, { watched_folders: [] });
  return tokens;
}

export async function getTokens(): Promise<GoogleTokens | null> {
  return await readJson<GoogleTokens>(KEY_TOKENS);
}

export async function clearTokens(): Promise<void> {
  await writeJson(KEY_TOKENS, null as any);
}

/** Obtiene un access_token válido, refrescándolo si está caducado. */
async function getValidAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) throw new Error("Google Drive no conectado. Conéctalo en /drive.");
  if (Date.now() < tokens.expires_at) return tokens.access_token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Refresh token falló: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const updated: GoogleTokens = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  await writeJson(KEY_TOKENS, updated);
  return updated.access_token;
}

/** Wrapper para llamar a la API de Drive */
async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const url = path.startsWith("http") ? path : `https://www.googleapis.com/drive/v3${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

// ─── API helpers ────────────────────────────────────────────────────

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  webViewLink?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
};

export async function listFolders(opts: { q?: string; parentId?: string; pageSize?: number } = {}): Promise<DriveFile[]> {
  const qParts = ["mimeType = 'application/vnd.google-apps.folder'", "trashed = false"];
  if (opts.q) qParts.push(`name contains '${opts.q.replace(/'/g, "\\'")}'`);
  if (opts.parentId) qParts.push(`'${opts.parentId}' in parents`);
  const params = new URLSearchParams({
    q: qParts.join(" and "),
    fields: "files(id,name,mimeType,iconLink,parents,modifiedTime)",
    orderBy: "name",
    pageSize: String(opts.pageSize ?? 50),
    spaces: "drive",
  });
  const r = await driveFetch(`/files?${params.toString()}`);
  if (!r.ok) throw new Error(`listFolders ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.files ?? [];
}

export async function listFiles(folderId: string, opts: { pageSize?: number } = {}): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,iconLink,webViewLink,size,modifiedTime,parents)",
    orderBy: "modifiedTime desc",
    pageSize: String(opts.pageSize ?? 100),
    spaces: "drive",
  });
  const r = await driveFetch(`/files?${params.toString()}`);
  if (!r.ok) throw new Error(`listFiles ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.files ?? [];
}

export async function getFolderPath(folderId: string): Promise<string> {
  // Construye "Mi unidad / Sub / Sub" recorriendo parents
  const segments: string[] = [];
  let currentId: string | undefined = folderId;
  let safety = 10;
  while (currentId && safety-- > 0) {
    const r = await driveFetch(`/files/${currentId}?fields=id,name,parents`);
    if (!r.ok) break;
    const data = await r.json();
    segments.unshift(data.name);
    currentId = data.parents?.[0];
  }
  return segments.join(" / ");
}

export async function createFolder(name: string, parentId?: string): Promise<DriveFile> {
  const body: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];
  const r = await driveFetch(`/files?fields=id,name,mimeType,parents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`createFolder ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Sube un archivo (Buffer) a una carpeta. Usa multipart upload. */
export async function uploadFile(
  filename: string,
  buffer: Buffer,
  mimeType: string,
  parentId: string
): Promise<DriveFile> {
  const boundary = "onepulso-drive-" + Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({ name: filename, parents: [parentId] });
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(head, "utf-8"),
    buffer,
    Buffer.from(tail, "utf-8"),
  ]);
  const r = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents,size`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error(`uploadFile ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Mueve un archivo de una carpeta a otra. */
export async function moveFile(fileId: string, fromParentId: string, toParentId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    addParents: toParentId,
    removeParents: fromParentId,
    fields: "id,name,parents",
  });
  const r = await driveFetch(`/files/${fileId}?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(`moveFile ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const r = await driveFetch(`/files/${fileId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteFile ${r.status}: ${await r.text()}`);
}

// ─── Config: watched folders ──────────────────────────────────────────

export async function getConfig(): Promise<DriveConfig> {
  return (await readJson<DriveConfig>(KEY_CONFIG)) ?? { watched_folders: [] };
}

export async function saveConfig(cfg: DriveConfig): Promise<void> {
  await writeJson(KEY_CONFIG, cfg);
}

export async function addWatchedFolder(folder: { id: string; name: string; path: string }): Promise<DriveConfig> {
  const cfg = await getConfig();
  if (cfg.watched_folders.find((f) => f.id === folder.id)) return cfg;
  cfg.watched_folders.push({
    id: folder.id,
    name: folder.name,
    path: folder.path,
    added_at: new Date().toISOString(),
  });
  await saveConfig(cfg);
  return cfg;
}

export async function removeWatchedFolder(folderId: string): Promise<DriveConfig> {
  const cfg = await getConfig();
  cfg.watched_folders = cfg.watched_folders.filter((f) => f.id !== folderId);
  await saveConfig(cfg);
  return cfg;
}

export function isFolderWatched(cfg: DriveConfig, folderId: string): boolean {
  return cfg.watched_folders.some((f) => f.id === folderId);
}
