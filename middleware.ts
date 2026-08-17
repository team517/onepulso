import { NextRequest, NextResponse } from "next/server";

const SESSION_TOKEN = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

// Superficie que un CLIENTE (multi-tenant) puede tocar. Todo lo demás es solo
// del owner. La verificación REAL de la firma de la cookie de cliente la hace
// cada endpoint (withRequestTenant); aquí solo hacemos gating grueso por
// presencia de cookie para no romper el bundle edge con crypto de Node.
function isClientSurface(pathname: string): boolean {
  return (
    pathname === "/seguimientos" ||
    pathname.startsWith("/seguimientos/") ||
    pathname === "/personalizacion" ||
    pathname.startsWith("/personalizacion/") ||
    pathname.startsWith("/api/email/") ||
    pathname.startsWith("/api/personalization/") ||
    pathname.startsWith("/api/client-portal/") ||
    pathname === "/api/whoami"
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas - no requieren auth
  if (
    pathname === "/landing" ||
    pathname.startsWith("/landing/") ||
    pathname.startsWith("/login") ||
    pathname === "/portal" ||
    pathname.startsWith("/portal/") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/client-portal/") ||
    pathname.startsWith("/api/stripe/webhook") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Portales de cliente unibox: /u/* y /c/* + sus APIs — usan otro cookie.
  if (pathname.startsWith("/u/") || pathname.startsWith("/c/") || pathname.startsWith("/api/unibox-client/")) {
    return NextResponse.next();
  }

  // /api/uniboxes/* compartido: cada endpoint hace su propio check.
  if (pathname.startsWith("/api/uniboxes/")) {
    return NextResponse.next();
  }

  // Portal de onboarding: /o/[slug] + sus APIs — cookie por-slug.
  if (pathname.startsWith("/o/") || pathname.startsWith("/api/onboarding-client/")) {
    return NextResponse.next();
  }

  // Descarga PÚBLICA del informe PDF por enlace.
  if (/^\/api\/clients\/[^/]+\/report-file\//.test(pathname)) {
    return NextResponse.next();
  }

  const ownerAuthed = req.cookies.get("onepulso_session")?.value === SESSION_TOKEN;
  if (ownerAuthed) {
    return NextResponse.next(); // el owner ve todo
  }

  // ¿Sesión de CLIENTE presente? (verificación de firma en el endpoint)
  const hasClientCookie = !!req.cookies.get("client_session")?.value;
  if (hasClientCookie) {
    if (isClientSurface(pathname)) {
      return NextResponse.next();
    }
    // Cliente intentando entrar a algo que no es su superficie.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/seguimientos", req.url));
  }

  // Anónimo.
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/landing", req.url));
  }
  // Las dos secciones de cliente → login de cliente; el resto → login de owner.
  if (isClientSurface(pathname) && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/portal", req.url));
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
