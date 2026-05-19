import { listPosts, publishPost, updatePost, getPost } from "./linkedin";

declare global {
  // eslint-disable-next-line no-var
  var __linkedinScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __linkedinSchedulerRunning: boolean | undefined;
}

const TICK_MS = 30_000; // 30s

export function startScheduler() {
  if (globalThis.__linkedinScheduler) return;
  console.log("[linkedin-scheduler] starting (30s tick, anti-reentrant)");

  const safeTick = async () => {
    if (globalThis.__linkedinSchedulerRunning) {
      console.log("[linkedin-scheduler] tick anterior aún corre — saltando");
      return;
    }
    globalThis.__linkedinSchedulerRunning = true;
    try {
      await tick();
    } catch (e: any) {
      console.error("[linkedin-scheduler] tick error:", e?.message || e);
    } finally {
      globalThis.__linkedinSchedulerRunning = false;
    }
  };

  globalThis.__linkedinScheduler = setInterval(safeTick, TICK_MS);
  safeTick();
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

    // ATOMIC CLAIM: re-leer el post AHORA mismo y comprobar que sigue siendo "scheduled".
    // Si otra ejecución (otro tick que se cruzó, llamada manual, etc.) ya lo marcó como
    // "publishing" o "published", saltamos para evitar duplicados.
    const fresh = await getPost(p.id);
    if (!fresh || fresh.status !== "scheduled") {
      console.log(`[linkedin-scheduler] skip ${p.id}: status ya es ${fresh?.status}`);
      continue;
    }
    // Marcar como publishing INMEDIATAMENTE (antes de cualquier await pesado)
    await updatePost(p.id, { status: "publishing" });
    try {
      const { urn } = await publishPost(fresh);
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
