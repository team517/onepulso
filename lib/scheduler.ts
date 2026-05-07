import { listPosts, publishPost, updatePost } from "./linkedin";

declare global {
  // eslint-disable-next-line no-var
  var __linkedinScheduler: NodeJS.Timeout | undefined;
}

const TICK_MS = 30_000; // 30s

export function startScheduler() {
  if (globalThis.__linkedinScheduler) return;
  console.log("[linkedin-scheduler] starting (30s tick)");
  globalThis.__linkedinScheduler = setInterval(tick, TICK_MS);
  // Tick once immediately
  tick().catch((e) => console.error("[linkedin-scheduler] initial tick error", e));
}

export async function tick(): Promise<{ checked: number; published: number; failed: number }> {
  const posts = await listPosts();
  const now = Date.now();
  let published = 0;
  let failed = 0;
  let checked = 0;
  for (const p of posts) {
    if (p.status !== "scheduled") continue;
    if (!p.scheduled_at) continue;
    if (new Date(p.scheduled_at).getTime() > now) continue;
    checked++;
    await updatePost(p.id, { status: "publishing" });
    try {
      const { urn } = await publishPost(p);
      await updatePost(p.id, {
        status: "published",
        published_at: new Date().toISOString(),
        linkedin_post_urn: urn,
        error: undefined,
      });
      published++;
      console.log(`[linkedin-scheduler] published ${p.id}`);
    } catch (e: any) {
      await updatePost(p.id, { status: "failed", error: e.message });
      failed++;
      console.error(`[linkedin-scheduler] failed ${p.id}: ${e.message}`);
    }
  }
  return { checked, published, failed };
}
