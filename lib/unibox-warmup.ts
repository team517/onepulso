/**
 * Detección de mensajes warmup — UNA SOLA regla muy específica.
 *
 * Si el subject contiene un token JUNTO en MAYÚSCULAS (letras + números
 * mezclados, o 6+ letras mayúsculas sin minúsculas), es warmup.
 *
 * Ejemplos reales que se filtran:
 *   "I was hoping we could talk. | EQYYWCM CHBV6J7"
 *   "New HR Policy | 9XAT619 CHBV6J7"
 *   "Need your help | R7BF4C4 CHBV6J7"
 *
 * NO se filtran subjects con:
 *   - Tokens minúsculas o capitalizados (Pablo123, MartaLopez)
 *   - Marcas conocidas (TCX, SaaS, B2B, etc.)
 *   - Años solos (2024, 2025)
 *   - Acrónimos cortos (CRM, ERP, etc.)
 */

// Blacklist de tokens que parecen código pero son marcas / acrónimos.
const BRAND_BLACKLIST = /^(TCX|H3|3M|EY|4D|3D|2K|AWS|GCP|API|EC2|S3|AI|ML|SA|CRM|ERP|UX|UI|SEO|SEM|B2B|B2C|D2C|SAAS|PAAS|IAAS|VAT|IRPF|IVA|IBAN|SWIFT|CIF|NIF|DNI|VIP|CEO|CTO|CFO|COO|CMO|RRHH|HR|IT|PM|QA|UAT|SLA|KPI|ROI|MVP|GDPR|RGPD)\d*$/;

function isUppercaseCode(t: string): boolean {
  if (!t || t.length < 5 || t.length > 16) return false;
  // No debe tener minúsculas — sólo MAYÚSCULAS y dígitos.
  if (/[a-z]/.test(t)) return false;
  // CRÍTICO: tiene que mezclar mayúsculas Y dígitos en el mismo token.
  // Esto evita marcar palabras normales en mayúsculas tipo "MICRO",
  // "URGENTE", "REUNION", "PRECIO" como código aleatorio.
  if (!/[A-Z]/.test(t)) return false;
  if (!/[0-9]/.test(t)) return false;
  // Excluir años aislados (1900-2099) sin contexto
  if (/^(19|20)\d{2}$/.test(t)) return false;
  // Excluir fechas compactas
  if (/^\d{8}$/.test(t)) return false;
  // Excluir marcas conocidas con sufijo numérico (TCX2024, B2B1, etc.)
  if (BRAND_BLACKLIST.test(t)) return false;
  return true;
}

export function isWarmupMessage(input: {
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
}): boolean {
  const s = (input.subject || "").trim();
  if (!s) return false;

  // Buscar tokens de 5-16 chars en mayúsculas+dígitos en el subject.
  const tokens = s.match(/\b[A-Z0-9]{5,16}\b/g) || [];
  for (const t of tokens) {
    if (isUppercaseCode(t)) return true;
  }
  return false;
}
