/**
 * Contexto de TENANT (multi-cliente) por request.
 *
 * Cada CLIENTE que inicia sesión tiene sus propios Seguimientos, su propio
 * correo conectado y su propia Personalización, TOTALMENTE aislados del dueño
 * (owner) y de los demás clientes.
 *
 * Mecanismo: AsyncLocalStorage guarda el clientId durante toda la ejecución de
 * un request (sobrevive a los await sin condiciones de carrera entre requests
 * concurrentes). `tenantKey()` namespacea las claves de storage:
 *   - OWNER (clientId null)  → clave global tal cual ("email-threads")
 *     → los datos que YA tienes se quedan intactos, sin migración.
 *   - CLIENTE (clientId "x") → "clients/x/email-threads"
 *
 * El scheduler (que corre fuera de un request) usa runWithTenant() explícito
 * para procesar cada tenant por separado.
 */
import { AsyncLocalStorage } from "async_hooks";

type TenantCtx = { clientId: string | null };

const als = new AsyncLocalStorage<TenantCtx>();

/** Ejecuta `fn` con el tenant fijado. clientId null = owner (claves globales). */
export function runWithTenant<T>(clientId: string | null, fn: () => T): T {
  return als.run({ clientId: clientId || null }, fn);
}

/** clientId del tenant actual, o null si es el owner / sin contexto. */
export function currentClientId(): string | null {
  return als.getStore()?.clientId ?? null;
}

/**
 * Namespacea una clave de storage por tenant.
 * Owner → clave global; cliente → prefijo clients/<id>/.
 */
export function tenantKey(base: string): string {
  const id = currentClientId();
  return id ? `clients/${id}/${base}` : base;
}

/** true si la clave (posiblemente namespaceada) corresponde a `base` (global o de cliente). */
export function keyMatchesBase(key: string, base: string): boolean {
  return key === base || key.endsWith(`/${base}`);
}
