import { listPosts, publishPost, updatePost, getPost, verifyPublishOnError } from "./linkedin";

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
    // Si ya tuvo un intento automático previo, NO reintentar: el usuario lo
    // hará manual desde la UI. Esta es la regla pedida: "que se suba solo una vez".
    if ((p.auto_attempts ?? 0) >= 1) continue;
    checked++;

    // ATOMIC CLAIM: re-leer el post AHORA mismo y comprobar que sigue siendo "scheduled"
    // Y que no ha hecho ya un intento automático. Si otra ejecución se cruzó, saltamos.
    const fresh = await getPost(p.id);
    if (!fresh || fresh.status !== "scheduled") {
      console.log(`[linkedin-scheduler] skip ${p.id}: status ya es ${fresh?.status}`);
      continue;
    }
    if ((fresh.auto_attempts ?? 0) >= 1) {
      console.log(`[linkedin-scheduler] skip ${p.id}: ya tuvo intento automatico previo`);
      continue;
    }
    // Marcar como publishing + incrementar contador de intentos AHORA (atómico)
    const attemptStart = Date.now();
    await updatePost(p.id, {
      status: "publishing",
      last_attempt_at: new Date(attemptStart).toISOString(),
      auto_attempts: (fresh.auto_attempts ?? 0) + 1,
    });
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
      // CHEQUEO ANTI-DUPLICADO: verificar si el post se llegó a publicar
      // realmente (error de red TRAS aceptación de LinkedIn). Si lo encuentra
      // → lo marcamos publicado (no fallido) para no inducir reintentos.
      const verifiedUrn = await verifyPublishOnError(fresh, attemptStart);
      if (verifiedUrn) {
        await updatePost(p.id, {
          status: "published",
          published_at: new Date(attemptStart).toISOString(),
          linkedin_post_urn: verifiedUrn,
          error: undefined,
        });
        published++;
        console.log(`[linkedin-scheduler] ${p.id} publicó pese al error de red — recuperado urn=${verifiedUrn}`);
      } else {
        await updatePost(p.id, { status: "failed", error: e.message });
        failed++;
        console.error(`[linkedin-scheduler] failed ${p.id}: ${e.message} (no se reintenta, retry manual)`);
      }
    }
  }
  return { checked, published, failed };
}
