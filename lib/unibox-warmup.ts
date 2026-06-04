/**
 * Detección de mensajes warmup / tracking-injected (Mailwarm, Lemwarm,
 * Smartlead, Instantly...).
 *
 * REGLAS GENERALES:
 * - Ningún check individual basta. Hay que combinar 2+ señales.
 * - Reglas positivas (no es warmup): respuestas reales con saludo +
 *   contenido coherente, mensajes cortos con "Re:" + body humano.
 * - Las firmas explícitas (lemwarm, mailwarm…) sí valen por sí solas.
 *
 * Ejemplos clásicos de warmup:
 *   "Oliver, let's chat! | 7Y8KN0M CHBV6J7"
 *   "average donation amounts | ought-care-sing CHBV6J7"
 *   bodies con "<p>ought-care-sing CHBV6J7</p>"
 */
export function isWarmupMessage(input: {
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
}): boolean {
  const s = (input.subject || "").trim();
  const bodyText = ((input.text || "") + " " + (input.html || "").replace(/<[^>]+>/g, " ")).slice(0, 10000);

  // ───── SEÑALES POSITIVAS (NO es warmup) ─────
  // Si el body tiene un saludo humano + contenido razonable, NUNCA es warmup.
  // Esto evita falsos positivos en respuestas reales con subjects raros.
  const greetingRe = /\b(hola|hi|hello|hey|buenos\s+d[ií]as|buenas\s+(tardes|noches)|gracias|thanks|thank\s+you|saludos|estimad[oa]s?|querido\/a|good\s+(morning|afternoon|evening))\b/i;
  const hasGreeting = greetingRe.test(bodyText.slice(0, 500));
  // Si tiene saludo + el body tiene al menos 30 palabras coherentes (no es
  // sólo "hi" + códigos), saltamos las heurísticas de subject.
  const wordCount = bodyText.split(/\s+/).filter((w) => /[a-zA-ZÀ-ſ]{2,}/.test(w)).length;
  if (hasGreeting && wordCount > 20) {
    // Aún puede ser warmup si el body tiene LA firma del servicio.
    if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|mailreach|folderly|warmup\s+by\s+)\b/i.test(bodyText)) {
      return true;
    }
    return false;
  }

  // ───── SEÑALES DE WARMUP ─────

  // Detector de "code token": alfanumérico mixto 5-16 chars (letras + números).
  const isCodeToken = (t: string): boolean => {
    if (!t || t.length < 5 || t.length > 16) return false;
    if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;
    // Excluir versiones tipo "v1.2.3" o "iOS17"
    if (/^v\d/i.test(t) && t.length <= 6) return false;
    // Excluir nombres de empresas comunes con números
    if (/^(tcx|h3|3m|ey|4d|3d|2k|aws|gcp|api)\d*$/i.test(t)) return false;
    return true;
  };

  // 1) Subject con separador " | " o " - " + tail con code-token claro.
  //    Esto sigue siendo un patrón muy específico de warmup (ej: "subject | RGY7HJK")
  const tailMatch = s.match(/\s[|\-–—]\s+([^|]+?)\s*$/);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    const tailTokens = tail.split(/[\s_]+/).filter(Boolean);
    const tailCodeCount = tailTokens.filter(isCodeToken).length;
    // Antes: 1 token bastaba. Ahora: 2+ tokens code para ser conclusivo,
    // o que el tail entero también aparezca como tokens en el body (señal
    // de tracking).
    if (tailCodeCount >= 2) return true;
    if (tailCodeCount === 1 && /\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(tail)) return true;
  }

  // 2) Hyphenated wordlist MUY LARGA (4+ palabras) — Lemwarm clásico
  //    "ought-care-sing-flow" etc. 3 palabras ahora no basta (era demasiado
  //    laxo: "lead-generation-tool" pasaba).
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){3,}\b/.test(s)) return true;

  // 3) 3+ alphanumeric code tokens en subject (antes 2)
  const subjectCodes = (s.match(/\b[A-Za-z0-9]{5,16}\b/g) || []).filter(isCodeToken);
  if (subjectCodes.length >= 3) return true;

  // 4) Hyphenated wordlist 3+ palabras EN BODY + 2+ código tokens en body
  //    (warmups suelen tener AMBAS señales)
  if (/\b[a-z]{3,}(?:-[a-z]{3,}){2,}\b/.test(bodyText)) {
    const bodyCodes = (bodyText.match(/\b[A-Za-z0-9]{5,16}\b/g) || []).filter(isCodeToken);
    if (bodyCodes.length >= 2) return true;
  }

  // 5) <p>code-list</p> al final del body (lemwarm classic footer)
  const html = input.html || "";
  if (/<p[^>]*>\s*[a-z]+(?:-[a-z]+){2,}\s+[A-Za-z0-9]{5,}\s*<\/p>/i.test(html)) return true;
  if (/<p[^>]*>\s*[A-Za-z0-9]{5,16}(?:\s+[A-Za-z0-9]{5,16}){2,3}\s*<\/p>/.test(html)) return true;

  // 6) Firma explícita de servicio warmup en el body (sin cambios — son
  //    inequívocas)
  if (/\b(lemwarm|mailwarm|warmup\s*inbox|warmupinbox|mailreach|folderly|warmup\s+by\s+)\b/i.test(bodyText)) return true;

  return false;
}
