/**
 * Detección de mensajes warmup — versión SIMPLE.
 *
 * Solo hay un criterio: si el subject contiene un token que mezcla
 * letras Y números (5+ caracteres), es warmup.
 *
 * Ejemplos reales de warmup que se filtran:
 *   "I was hoping we could talk. | EQYYWCM CHBV6J7"
 *   "New HR Policy | 9XAT619 CHBV6J7"
 *   "Need your help | whalebusinessraw CHBV6J7"
 *
 * El resto de heurísticas (saludos, hyphenated wordlists, firmas de
 * lemwarm/mailwarm en body, etc.) NO se usan — son demasiado agresivas
 * y bloqueaban respuestas legítimas de prospects.
 */

// Tokens cortos que NO son código aleatorio aunque mezclen letras y números:
// nombres de marca, abreviaturas técnicas, versiones, etc.
const BRAND_TOKEN_BLACKLIST = /^(tcx|h3|3m|ey|4d|3d|2k|aws|gcp|api|v\d+|p\d+|h\d+|q\d+|wp|ec2|s3|ai|ml|sa|crm|erp|ux|ui|seo|sem|b2b|b2c|d2c|saas|paas|iaas)\d*$/i;

function isMixedAlphaNumeric(t: string): boolean {
  if (!t || t.length < 5 || t.length > 16) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (!/[0-9]/.test(t)) return false;
  if (BRAND_TOKEN_BLACKLIST.test(t)) return false;
  // Excluir años ("2024", "2025") aunque vengan precedidos de letras tipo "TCX2024"
  // → ya cubierto por blacklist arriba.
  // Excluir fechas en formato compacto tipo "20250612"
  if (/^\d{8}$/.test(t)) return false;
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

  // Buscamos cualquier token en el subject que mezcle letras y números
  // y no esté en la blacklist de marcas. Esto cubre los códigos clásicos
  // de warmup: CHBV6J7, 9XAT619, EQYYWCM, etc.
  const tokens = s.match(/\b[A-Za-z0-9]{5,16}\b/g) || [];
  for (const t of tokens) {
    if (isMixedAlphaNumeric(t)) return true;
  }
  return false;
}
