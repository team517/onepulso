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

// Palabras MUY frecuentes y exclusivas de cada grupo (stopwords).
const ES_CA_WORDS = [
  // Español
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "que",
  "en", "con", "por", "para", "como", "más", "pero", "muy", "ya", "este", "esta",
  "esto", "ese", "esa", "su", "sus", "le", "les", "nos", "me", "te", "se", "lo",
  "hola", "gracias", "saludos", "buenos", "días", "tardes", "noches", "cordial",
  "estamos", "estoy", "está", "están", "tengo", "tiene", "tienen", "somos",
  "hacer", "puede", "podría", "quería", "interesa", "interesados", "información",
  "empresa", "correo", "reunión", "precio", "presupuesto", "adjunto", "atentamente",
  "no", "sí", "también", "porque", "cuando", "donde", "quién", "cuál", "vuestra",
  // Catalán
  "els", "les", "amb", "per", "què", "està", "estan", "tinc", "té", "tenen",
  "som", "fer", "pot", "podria", "volia", "interessa", "informació", "empresa",
  "correu", "reunió", "preu", "pressupost", "adjunt", "atentament", "gràcies",
  "salutacions", "bon", "dia", "tarda", "vespre", "cordialment", "nosaltres",
  "vostra", "aquest", "aquesta", "molt", "però", "també", "perquè", "quan", "on",
];

const EN_WORDS = [
  "the", "and", "you", "your", "for", "with", "this", "that", "are", "our",
  "we", "i", "is", "to", "of", "in", "on", "be", "have", "has", "would", "could",
  "hello", "hi", "hey", "thanks", "thank", "regards", "best", "cheers", "dear",
  "interested", "information", "company", "meeting", "price", "quote", "please",
  "let", "know", "looking", "forward", "reach", "out", "team", "hope", "doing",
  "wanted", "reaching", "quick", "question", "schedule", "call", "available",
];

/**
 * Devuelve true si el texto parece NO estar en español ni catalán
 * (probablemente inglés u otro idioma). Heurística por stopwords:
 * compara cuántas palabras típicas ES/CA vs EN aparecen.
 *
 * Conservador: si hay duda (pocas palabras, o señales mixtas), devuelve
 * false (= NO filtrar), para no esconder mensajes legítimos por error.
 */
export function isNonIberianMessage(input: { subject?: string; text?: string; html?: string }): boolean {
  // Combinar subject + algo de texto si está disponible.
  let txt = `${input.subject || ""} ${input.text || ""}`;
  if (!txt.trim() && input.html) {
    txt = input.html.replace(/<[^>]+>/g, " ");
  }
  txt = txt.toLowerCase().replace(/[^\p{L}\s]/gu, " ");
  const words = txt.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 3) return false; // muy poco texto → no arriesgar

  // Caracteres exclusivos del español/catalán → señal fuerte de iberian.
  if (/[ñçàèòïü·]/i.test(input.subject || "") || /[ñçàèòïü·]/i.test(input.text || "")) {
    return false;
  }

  const wordSet = new Set(words);
  let esCa = 0, en = 0;
  for (const w of ES_CA_WORDS) if (wordSet.has(w)) esCa++;
  for (const w of EN_WORDS) if (wordSet.has(w)) en++;

  // Si hay señal clara de español/catalán → NO filtrar.
  if (esCa >= 2) return false;
  // Si hay clara señal inglesa Y nada de ES/CA → es inglés → filtrar.
  if (en >= 2 && esCa === 0) return true;
  // Caso "Re:"/asuntos muy cortos en inglés con 1 palabra inglesa fuerte
  if (en >= 3) return true;
  // Duda → no filtrar (conservador)
  return false;
}
