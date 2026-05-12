/**
 * Next.js instrumentation hook — corre UNA VEZ al arrancar el servidor.
 *
 * Aquí arrancamos los schedulers de background:
 *  - email-scheduler: cada 30s envía follow-ups vencidos + sincroniza inbox
 *  - linkedin-scheduler: cada 30s publica posts programados
 *
 * Esto garantiza que en producción (Railway) los envíos automáticos funcionan
 * incluso si nadie abre la plataforma. El proceso Node está siempre activo
 * mientras el servicio esté corriendo.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { startEmailScheduler } = await import("./lib/email-scheduler");
    startEmailScheduler();
    console.log("[instrumentation] email-scheduler started on boot");
  } catch (e: any) {
    console.error("[instrumentation] failed to start email-scheduler:", e.message);
  }

  try {
    const { startScheduler } = await import("./lib/scheduler");
    if (typeof startScheduler === "function") {
      startScheduler();
      console.log("[instrumentation] linkedin-scheduler started on boot");
    }
  } catch (e: any) {
    console.warn("[instrumentation] linkedin-scheduler skipped:", e?.message);
  }
}
