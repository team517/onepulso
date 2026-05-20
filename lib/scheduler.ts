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

/**
 * BURST PROTECTION: como máximo se publica este número de posts por tick.
 * Si hay 10 vencidos a la vez (p.ej. plan mensual mal generado o backlog tras
 * downtime), se reparten 1 cada 30s. Evita el patrón "se sube random todo el
 * rato" que reporta el usuario.
 */
const MAX_PUBLISH_PER_TICK = 1;

export async function tick(): Promise<{ checked: number; published: number; failed: number }> {
  const posts = await listPosts();
  const now = Date.now();
  // Ordenar candidatos vencidos por scheduled_at ascendente para publicar el
  // más antiguo primero. Sólo procesamos los `scheduled` con scheduled_at <= now
  // y sin intento automático previo.
  const due = posts
    .filter((p) =>
      p.status === "scheduled" &&
      !!p.scheduled_at &&
      new Date(p.scheduled_at).getTime() <= now &&
      (p.auto_attempts ?? 0) === 0
    )
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  let published = 0;
  let failed = 0;
  let checked = 0;
  if (due.length > MAX_PUBLISH_PER_TICK) {
    console.log(`[linkedin-scheduler] ${due.length} posts vencidos; publicando ${MAX_PUBLISH_PER_TICK} ahora, el resto en próximos ticks`);
  }
  for (const p of due.slice(0, MAX_PUBLISH_PER_TICK)) {
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
