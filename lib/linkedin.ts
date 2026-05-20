import { envVar } from "./env";
import { readJson, writeJson, deleteJson, readBlob, writeBlob } from "./storage";

const AUTH_KEY = "linkedin-auth";
const POSTS_KEY = "linkedin-posts";
const IMAGES_PREFIX = "linkedin-images/";

export type LinkedInAuth = {
  access_token: string;
  expires_at: string;
  scope: string;
  user_urn: string;
  name?: string;
  email?: string;
  picture?: string;
};

export type ScheduledPost = {
  id: string;
  text: string;
  image_path?: string; // ahora es la KEY del blob (ej. "linkedin-images/abc.png")
  visibility: "PUBLIC" | "CONNECTIONS";
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  scheduled_at?: string;
  published_at?: string;
  linkedin_post_urn?: string;
  error?: string;
  /** Timestamp del último intento de publicación. Sirve para el cooldown y la verificación-tras-error. */
  last_attempt_at?: string;
  /** Cuántos intentos automáticos ha hecho el scheduler. Si llega a 1 y falla, no se reintenta. */
  auto_attempts?: number;
  created_at: string;
  updated_at: string;
};

export function authUrl(state: string): string {
  const clientId = envVar("LINKEDIN_CLIENT_ID");
  const redirect = envVar("LINKEDIN_REDIRECT_URI");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state,
    scope: "openid profile email w_member_social",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeCodeForToken(code: string): Promise<LinkedInAuth> {
  const clientId = envVar("LINKEDIN_CLIENT_ID");
  const clientSecret = envVar("LINKEDIN_CLIENT_SECRET");
  const redirect = envVar("LINKEDIN_REDIRECT_URI");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(data)}`);

  const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok) throw new Error(`LinkedIn userinfo failed: ${JSON.stringify(profile)}`);

  const auth: LinkedInAuth = {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    scope: data.scope ?? "",
    user_urn: `urn:li:person:${profile.sub}`,
    name: profile.name,
    email: profile.email,
    picture: profile.picture,
  };
  await writeJson(AUTH_KEY, auth);
  return auth;
}

export async function getAuth(): Promise<LinkedInAuth | null> {
  const auth = await readJson<LinkedInAuth>(AUTH_KEY);
  if (!auth) return null;
  if (new Date(auth.expires_at).getTime() <= Date.now()) return null;
  return auth;
}

export async function clearAuth() {
  await deleteJson(AUTH_KEY);
}

// ----------- Posts CRUD -----------

async function readPosts(): Promise<ScheduledPost[]> {
  return (await readJson<ScheduledPost[]>(POSTS_KEY)) ?? [];
}

async function writePosts(posts: ScheduledPost[]) {
  await writeJson(POSTS_KEY, posts);
}

export async function listPosts(): Promise<ScheduledPost[]> {
  const all = await readPosts();
  return all.sort((a, b) => {
    const aTime = a.scheduled_at ?? a.published_at ?? a.created_at;
    const bTime = b.scheduled_at ?? b.published_at ?? b.created_at;
    return aTime.localeCompare(bTime);
  });
}

export async function getPost(id: string): Promise<ScheduledPost | null> {
  const all = await readPosts();
  return all.find((p) => p.id === id) ?? null;
}

export async function createPost(input: Partial<ScheduledPost> & { text: string }): Promise<ScheduledPost> {
  const all = await readPosts();
  const now = new Date().toISOString();
  const post: ScheduledPost = {
    id: crypto.randomUUID(),
    text: input.text,
    image_path: input.image_path,
    visibility: input.visibility ?? "PUBLIC",
    status: input.scheduled_at ? "scheduled" : "draft",
    scheduled_at: input.scheduled_at,
    created_at: now,
    updated_at: now,
  };
  all.push(post);
  await writePosts(all);
  return post;
}

export async function updatePost(id: string, patch: Partial<ScheduledPost>): Promise<ScheduledPost | null> {
  const all = await readPosts();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updated_at: new Date().toISOString() };
  await writePosts(all);
  return all[idx];
}

export async function deletePost(id: string) {
  const all = await readPosts();
  const filtered = all.filter((p) => p.id !== id);
  await writePosts(filtered);
}

// ----------- Imágenes -----------

/** Guarda una imagen y devuelve la KEY (no path). Persiste en Postgres BLOB store. */
export async function uploadImage(buffer: Buffer): Promise<string> {
  const id = crypto.randomUUID();
  const key = `${IMAGES_PREFIX}${id}.png`;
  await writeBlob(key, buffer, "image/png");
  return key;
}

/** Lee una imagen desde la KEY guardada */
export async function readImage(key: string): Promise<{ data: Buffer; mime: string } | null> {
  return await readBlob(key);
}

// ----------- LinkedIn publishing -----------

async function registerLinkedInImage(auth: LinkedInAuth): Promise<{ uploadUrl: string; asset: string }> {
  const r = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: auth.user_urn,
        serviceRelationships: [
          { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
        ],
      },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`registerUpload failed: ${JSON.stringify(data)}`);
  const uploadUrl =
    data.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      .uploadUrl;
  const asset = data.value.asset as string;
  return { uploadUrl, asset };
}

async function uploadImageToLinkedIn(
  uploadUrl: string,
  buffer: Buffer,
  auth: LinkedInAuth
): Promise<void> {
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.access_token}` },
    body: new Uint8Array(buffer),
  });
  if (!r.ok && r.status !== 201) {
    const t = await r.text().catch(() => "");
    throw new Error(`upload to media URL failed: ${r.status} ${t}`);
  }
}

/**
 * Tras un fallo de publicación, comprueba en LinkedIn si el post se llegó a
 * crear realmente. Útil cuando la API devuelve un error de red DESPUÉS de
 * haber aceptado el post (caso muy común con timeouts). Sin esto, el post
 * acaba "failed" en nuestra BD pero "publicado" en LinkedIn → al reintentar
 * sale duplicado.
 *
 * Devuelve el URN si encuentra el post; null si no.
 */
export async function verifyPublishOnError(post: ScheduledPost, attemptStart: number): Promise<string | null> {
  try {
    const auth = await getAuth();
    if (!auth) return null;
    // Buscar últimos posts del autor (los más recientes primero)
    const url = `https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${encodeURIComponent(auth.user_urn)})&count=10&sortBy=LAST_MODIFIED`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${auth.access_token}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    if (!r.ok) return null;
    const data: any = await r.json().catch(() => ({}));
    const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];
    // Buscar uno cuyo texto coincida y se haya creado en los últimos 5 min
    const textSnippet = (post.text || "").trim().slice(0, 80);
    if (!textSnippet) return null;
    const cutoff = attemptStart - 5 * 60_000; // hasta 5 min antes del intento (margen)
    for (const el of elements) {
      const created = Number(el?.created?.time || el?.lastModified?.time || 0);
      if (created < cutoff) continue;
      const elText: string =
        el?.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text ?? "";
      if (elText.trim().slice(0, 80) === textSnippet) {
        const urn = el?.id || el?.urn || null;
        if (urn) return urn;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function publishPost(post: ScheduledPost): Promise<{ urn: string }> {
  const auth = await getAuth();
  if (!auth) throw new Error("LinkedIn no autenticado. Conecta tu cuenta primero.");

  let mediaAsset: string | undefined;
  if (post.image_path) {
    const blob = await readBlob(post.image_path);
    if (!blob) throw new Error("Imagen del post no encontrada");
    const reg = await registerLinkedInImage(auth);
    await uploadImageToLinkedIn(reg.uploadUrl, blob.data, auth);
    mediaAsset = reg.asset;
  }

  const body: any = {
    author: auth.user_urn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: post.text },
        shareMediaCategory: mediaAsset ? "IMAGE" : "NONE",
        ...(mediaAsset
          ? {
              media: [
                {
                  status: "READY",
                  description: { text: "" },
                  media: mediaAsset,
                  title: { text: "" },
                },
              ],
            }
          : {}),
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": post.visibility ?? "PUBLIC" },
  };

  const r = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.access_token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Publish failed (${r.status}): ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { urn: (data as any).id ?? "unknown" };
}
