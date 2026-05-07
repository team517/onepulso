import { promises as fs } from "fs";
import path from "path";
import { envVar } from "./env";

const AUTH_FILE = path.join(process.cwd(), "data", "linkedin-auth.json");
const POSTS_FILE = path.join(process.cwd(), "data", "linkedin-posts.json");
const IMAGES_DIR = path.join(process.cwd(), "data", "linkedin-images");

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
  image_path?: string; // local path, optional
  visibility: "PUBLIC" | "CONNECTIONS";
  status: "draft" | "scheduled" | "publishing" | "published" | "failed";
  scheduled_at?: string; // ISO datetime
  published_at?: string;
  linkedin_post_urn?: string;
  error?: string;
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

  // Get profile via userinfo
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
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), "utf-8");
  return auth;
}

export async function getAuth(): Promise<LinkedInAuth | null> {
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf-8");
    const auth: LinkedInAuth = JSON.parse(raw);
    if (new Date(auth.expires_at).getTime() <= Date.now()) return null;
    return auth;
  } catch {
    return null;
  }
}

export async function clearAuth() {
  await fs.unlink(AUTH_FILE).catch(() => {});
}

// ----------- Posts CRUD -----------

async function readPosts(): Promise<ScheduledPost[]> {
  try {
    return JSON.parse(await fs.readFile(POSTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function writePosts(posts: ScheduledPost[]) {
  await fs.mkdir(path.dirname(POSTS_FILE), { recursive: true });
  await fs.writeFile(POSTS_FILE, JSON.stringify(posts, null, 2), "utf-8");
}

export async function listPosts(): Promise<ScheduledPost[]> {
  const all = await readPosts();
  return all.sort((a, b) => {
    const aTime = a.scheduled_at ?? a.published_at ?? a.created_at;
    const bTime = b.scheduled_at ?? b.published_at ?? b.created_at;
    return aTime.localeCompare(bTime);
  });
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

// ----------- LinkedIn publishing -----------

export async function uploadImage(buffer: Buffer): Promise<string> {
  // Save locally and return path
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const fp = path.join(IMAGES_DIR, `${id}.png`);
  await fs.writeFile(fp, buffer);
  return fp;
}

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

export async function publishPost(post: ScheduledPost): Promise<{ urn: string }> {
  const auth = await getAuth();
  if (!auth) throw new Error("LinkedIn no autenticado. Conecta tu cuenta primero.");

  let mediaAsset: string | undefined;
  if (post.image_path) {
    const buf = await fs.readFile(post.image_path);
    const reg = await registerLinkedInImage(auth);
    await uploadImageToLinkedIn(reg.uploadUrl, buf, auth);
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
