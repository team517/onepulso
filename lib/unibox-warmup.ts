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
// Blacklist: marca + cualquier sufijo alfanumérico (TCX2024, TCXMICRO,
// TCX2024A, B2B1, AWS3, etc.). Estas son referencias a productos / marcas
// legítimas, no códigos warmup aleatorios.
const BRAND_BLACKLIST = /^(TCX|H3|3M|EY|4D|3D|2K|AWS|GCP|API|EC2|S3|AI|ML|SA|CRM|ERP|UX|UI|SEO|SEM|B2B|B2C|D2C|SAAS|PAAS|IAAS|VAT|IRPF|IVA|IBAN|SWIFT|CIF|NIF|DNI|VIP|CEO|CTO|CFO|COO|CMO|RRHH|HR|IT|PM|QA|UAT|SLA|KPI|ROI|MVP|GDPR|RGPD|MICRO|MACRO|PRO|PREMIUM|STANDARD|LIGHT|BASIC|PLUS|ULTRA|ALPHA|BETA|GAMMA|DELTA|OMEGA)[A-Z0-9]{0,12}$/;

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

// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE IDIOMA — para filtrar mensajes que NO son español/catalán.
//
// Regla del cliente: en todos los uniboxes EXCEPTO tcx, solo deben aparecer
// mensajes en español o catalán. Los que llegan en inglés (warmup, spam de
// herramientas de outreach, etc.) se marcan como warmup y se ocultan.
// En tcx (negocio internacional) se permite cualquier idioma.
// ─────────────────────────────────────────────────────────────────────────────

// Detección por BUCKETS de idioma — criterio idéntico al Unibox de referencia.
// Se MUESTRAN: español/catalán, francés e italiano (mercados del cliente) y los
// mensajes ambiguos. Se OCULTAN solo: inglés puro (warmup / spam de outreach) y
// otros idiomas de ruido (alemán, portugués, polaco, ruso).
//
// Clave: francés e italiano se detectan ANTES que el inglés, de modo que un
// auto-reply bilingüe FR+EN o IT+EN (muy común: "Je suis absent… / I am away…")
// se MUESTRA en lugar de ocultarse por la parte inglesa.

// Palabras distintivas de español/catalán (evita 2-letras que también existen en
// inglés como "me", "son", "no", "a", "i").
const LANG_ES_CA = /\b(el|la|los|las|un[oa]?s?|del|al|que|qué|por|para|con|como|pero|porque|cuando|cuándo|donde|dónde|gracias|hola|saludos|buenos|buenas|cordial(?:es|mente)?|atentamente|estimad[oa]s?|señor(?:a|es)?|empresa|reunión|información|interesa|interesad[oa]s?|necesito|necesitamos|necesita|quiero|queremos|quería|querría|puede[ns]?|podemos|podríamos?|tengo|tenemos|tiene[ns]?|somos|estamos|está[ns]?|esto|esta|este|estos|estas|eso|esa|nuestr[oa]s?|vuestr[oa]s?|usted(?:es)?|también|según|sólo|solo|muy|más|sin|sobre|desde|hasta|mientras|aunque|entonces|vale|claro|perfecto|genial|encantad[oa]|quedamos|llamada|correo|adjunto|propuesta|presupuesto|consulta|pregunta|duda|cita|amb|per|què|gràcies|salutacions|atentament|nosaltres|aquest[a]?|aquests|aquestes|també|molt|més|sense|fins|vostè|voldria|d'acord|tinc|tenim|podem|bon\s?dia)\b/gi;
// Inglés — palabras muy comunes; casi todo email inglés acierta varias.
const LANG_EN = /\b(the|and|you|your|yours|for|with|this|that|these|those|have|has|had|are|was|were|will|would|could|should|been|being|is|of|to|in|on|at|as|be|by|or|if|from|but|not|can|just|get|got|know|let|let's|see|time|week|day|here|there|our|we|us|i'm|i'll|we're|we'll|don't|doesn't|thanks|thank|regards|best|hi|hello|hey|dear|please|company|meeting|information|interested|need|want|team|cheers|sincerely|looking|forward|kind|sounds|great|schedule|call|available|reach|reaching|out)\b/gi;
// Francés — respuestas reales de leads FR se MUESTRAN.
const LANG_FR = /\b(merci|bonjour|cordialement|salutations|madame|monsieur|votre|notre|nous|vous|êtes|suis|absent[e]?|bureau|jusqu'au|jusqu|veuillez|prie|s'il\s?vous\s?plaît|disponible|répondre|réponse|entreprise|réunion|rendez-vous|actuellement|serai|retour|contacter|contactez|message|société|joindre|dès|meilleures)\b/gi;
// Italiano — respuestas reales de leads IT se MUESTRAN.
const LANG_IT = /\b(grazie|salve|buongiorno|cordiali|saluti|distinti|sono|assente|ufficio|fino|contattare|contatti|prego|gentile|egregio|signor[ae]?|vostr[oa]|nostr[oa]|siamo|essere|disponibile|rispondere|risposta|azienda|riunione|messaggio|ritorno|tornerò|cortesia|attualmente|potete|grazie\s?mille)\b/gi;
// Idiomas de ruido (alemán / portugués / polaco / ruso) — se OCULTAN.
const LANG_OTHER = /\b(danke|sehr|freundlichen|grüße|guten|ich|und|mit|obrigad[oa]|olá|você|atenciosamente|dziękuję|pozdrawiam|spasibo|zdravstvuyte)\b/gi;

export function detectLanguageBucket(text: string): "es" | "en" | "fr" | "it" | "other" | "unknown" {
  const t = (text || "").toLowerCase();
  const es = (t.match(LANG_ES_CA) || []).length;
  const en = (t.match(LANG_EN) || []).length;
  const fr = (t.match(LANG_FR) || []).length;
  const it = (t.match(LANG_IT) || []).length;
  const other = (t.match(LANG_OTHER) || []).length;
  // Caracteres exclusivos de español/catalán son señal ES fuerte (el inglés no tiene).
  const esChars = /[ñ¿¡]|·l|ç/.test(t) ? 1 : 0;
  const esScore = es + esChars * 2;

  // Español/catalán gana en cuanto hay señal ES real no batida por otro idioma.
  if (esScore > 0 && esScore >= en && esScore >= fr && esScore >= it) return "es";
  // Francés / italiano (mercados del cliente) — mostrar cuando dominan claramente.
  if (fr >= 2 && fr >= it && fr >= en) return "fr";
  if (it >= 2 && it >= fr && it >= en) return "it";
  // Solo ocultar con señal foránea CLARA (≥2 marcadores y sin señal ES), para que
  // una palabra inglesa suelta en un correo español nunca lo oculte.
  if (esScore === 0 && en >= 2) return "en";
  if (esScore === 0 && other >= 2) return "other";
  if (esScore > 0) return "es";
  return "unknown"; // ambiguo / poco texto → no ocultar
}

/**
 * Devuelve true si el mensaje debe OCULTARSE por idioma (inglés puro de warmup u
 * otro idioma de ruido). Español/catalán, francés, italiano y ambiguos → false.
 *
 * Criterio idéntico al Unibox de referencia: mismos mensajes entran igual.
 */
export function isNonIberianMessage(input: { subject?: string; text?: string; html?: string }): boolean {
  // Combinar subject + algo de texto si está disponible.
  let body = input.text || "";
  if (!body.trim() && input.html) {
    body = input.html.replace(/<[^>]+>/g, " ");
  }
  const combined = `${input.subject || ""} ${body}`;
  // Muy poco texto → no arriesgar (igual que "unknown").
  const wordCount = (combined.match(/[\p{L}]{2,}/gu) || []).length;
  if (wordCount < 3) return false;

  const bucket = detectLanguageBucket(`${input.subject || ""} ${body.slice(0, 800)}`);
  return bucket === "en" || bucket === "other";
}
