/**
 * Web scraper ligero: descarga una URL y extrae el contenido relevante
 * (texto plano, sin scripts/styles/nav/etc.). Devuelve también título,
 * descripción, og tags, h1-h3, y links externos detectados.
 *
 * Pensado para alimentar a la IA cuando el usuario pega una URL en
 * Campañas y quiere usar la info de esa web (qué hacen, propuesta de
 * valor, etc.) para personalizar copy.
 */

export type ScrapedSite = {
  url: string;
  final_url: string;
  status: number;
  title?: string;
  description?: string;
  og?: { title?: string; description?: string; image?: string; site_name?: string; type?: string };
  headings: { h1: string[]; h2: string[]; h3: string[] };
  /** texto plano principal (max ~12000 chars) */
  text: string;
  /** links únicos a otras páginas del mismo dominio (max 25) */
  internal_links: string[];
  /** emails/telefonos detectados (max 5 c/u) */
  emails: string[];
  phones: string[];
  /** redes sociales detectadas */
  socials: { twitter?: string; linkedin?: string; instagram?: string; facebook?: string; youtube?: string; tiktok?: string };
  fetched_at: string;
  error?: string;
};

const USER_AGENT = "Mozilla/5.0 (compatible; onepulso-bot/1.0; +https://onepulso.online)";
const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 12000;

export async function fetchSite(url: string): Promise<ScrapedSite> {
  const normalized = normalizeUrl(url);
  const result: ScrapedSite = {
    url: normalized,
    final_url: normalized,
    status: 0,
    headings: { h1: [], h2: [], h3: [] },
    text: "",
    internal_links: [],
    emails: [],
    phones: [],
    socials: {},
    fetched_at: new Date().toISOString(),
  };

  let html = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(normalized, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    result.status = res.status;
    result.final_url = res.url || normalized;

    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    // Limitar tamaño leído
    const reader = (res.body as any)?.getReader?.();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        total += value.byteLength;
        if (total > MAX_HTML_BYTES) break;
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } else {
      html = await res.text();
    }
  } catch (e: any) {
    result.error = e?.name === "AbortError" ? `timeout ${FETCH_TIMEOUT_MS}ms` : (e?.message || String(e));
    return result;
  }

  // ---- Parse ----
  result.title = extractTag(html, "title");
  result.description = extractMeta(html, "description");

  result.og = {
    title: extractMetaProp(html, "og:title"),
    description: extractMetaProp(html, "og:description"),
    image: extractMetaProp(html, "og:image"),
    site_name: extractMetaProp(html, "og:site_name"),
    type: extractMetaProp(html, "og:type"),
  };

  result.headings = {
    h1: extractTags(html, "h1").slice(0, 10),
    h2: extractTags(html, "h2").slice(0, 20),
    h3: extractTags(html, "h3").slice(0, 30),
  };

  result.text = extractMainText(html).slice(0, 12000);

  result.internal_links = extractInternalLinks(html, result.final_url).slice(0, 25);

  result.emails = uniq(extractEmails(html)).slice(0, 5);
  result.phones = uniq(extractPhones(html)).slice(0, 5);

  result.socials = extractSocials(html);

  return result;
}

/** Versión enriquecida: descarga la home + intenta /about, /servicios, /products si existen. */
export async function fetchSiteEnriched(url: string): Promise<ScrapedSite> {
  const main = await fetchSite(url);
  if (main.error) return main;

  // Buscar paths interesantes en internal_links
  const candidates = ["about", "about-us", "nosotros", "quienes-somos", "que-hacemos", "services", "servicios", "products", "productos", "solutions", "soluciones"];
  const found = main.internal_links.filter((l) => candidates.some((c) => l.toLowerCase().includes(`/${c}`)));
  const extra = found.slice(0, 3);

  if (extra.length === 0) return main;

  let extraText = "\n\n---\nINFO ADICIONAL DE SUBPÁGINAS:\n";
  for (const link of extra) {
    try {
      const sub = await fetchSite(link);
      if (sub.error || !sub.text) continue;
      const tag = link.split("/").pop() || link;
      extraText += `\n[${tag}]\n${sub.text.slice(0, 2500)}\n`;
    } catch {}
  }
  if (extraText.length > 50) {
    main.text = (main.text + extraText).slice(0, 18000);
  }
  return main;
}

// ────────────────────────────────────────────────────────────────────────
//  Parsers
// ────────────────────────────────────────────────────────────────────────

function normalizeUrl(u: string): string {
  let s = u.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const url = new URL(s);
    return url.toString();
  } catch {
    return s;
  }
}

function extractTag(html: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? cleanText(m[1]) : undefined;
}

function extractTags(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const t = cleanText(m[1]);
    if (t && t.length < 300) out.push(t);
  }
  return out;
}

function extractMeta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return cleanText(m[1]);
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? cleanText(m2[1]) : undefined;
}

function extractMetaProp(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return cleanText(m[1]);
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? cleanText(m2[1]) : undefined;
}

/** Texto principal — limpia script/style/nav/footer y reduce a líneas */
function extractMainText(html: string): string {
  let s = html;
  // Eliminar bloques irrelevantes
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  s = s.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
  s = s.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");
  s = s.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ");
  s = s.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");
  s = s.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
  s = s.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Convertir saltos de bloque a \n
  s = s.replace(/<\/(p|div|li|section|article|h[1-6]|tr|br)>/gi, "\n");
  // Quitar todas las tags
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\n[ \t]+/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function extractInternalLinks(html: string, base: string): string[] {
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
  const out = new Set<string>();
  let baseUrl: URL;
  try { baseUrl = new URL(base); } catch { return []; }
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname !== baseUrl.hostname) continue;
      u.hash = "";
      out.add(u.toString());
    } catch {}
  }
  return Array.from(out);
}

function extractEmails(html: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const m = html.match(re) || [];
  return m.filter((e) => !/example\.|test\.|domain\.|@2x|sentry/i.test(e));
}

function extractPhones(html: string): string[] {
  const re = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}/g;
  const m = html.match(re) || [];
  return m.filter((p) => p.replace(/\D/g, "").length >= 9 && p.replace(/\D/g, "").length <= 15);
}

function extractSocials(html: string): ScrapedSite["socials"] {
  const find = (re: RegExp): string | undefined => {
    const m = html.match(re);
    return m ? m[0] : undefined;
  };
  return {
    twitter: find(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]{1,30}\b/),
    linkedin: find(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_-]+\b/),
    instagram: find(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.-]+\b/),
    facebook: find(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9_.-]+\b/),
    youtube: find(/https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|@|channel\/)[A-Za-z0-9_-]+\b/),
    tiktok: find(/https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.-]+\b/),
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanText(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

/** Formato compacto para pasar a la IA. */
export function scrapedToContext(s: ScrapedSite): string {
  if (s.error) return `[ERROR scrapeando ${s.url}: ${s.error}]`;
  const parts: string[] = [];
  parts.push(`URL: ${s.final_url}`);
  if (s.title) parts.push(`TÍTULO: ${s.title}`);
  const desc = s.description || s.og?.description;
  if (desc) parts.push(`DESCRIPCIÓN: ${desc}`);
  if (s.og?.site_name) parts.push(`SITE NAME: ${s.og.site_name}`);
  if (s.headings.h1.length) parts.push(`H1: ${s.headings.h1.join(" | ")}`);
  if (s.headings.h2.length) parts.push(`H2: ${s.headings.h2.slice(0, 10).join(" | ")}`);
  if (s.headings.h3.length) parts.push(`H3: ${s.headings.h3.slice(0, 12).join(" | ")}`);
  if (s.emails.length) parts.push(`EMAILS: ${s.emails.join(", ")}`);
  if (s.phones.length) parts.push(`TELÉFONOS: ${s.phones.join(", ")}`);
  const socials = Object.entries(s.socials).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`);
  if (socials.length) parts.push(`SOCIALES: ${socials.join(", ")}`);
  if (s.text) parts.push(`\nCONTENIDO:\n${s.text}`);
  return parts.join("\n");
}
