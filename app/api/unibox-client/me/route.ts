import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("unibox_session")?.value;

    if (!sessionToken) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Validar el token (en producción, verificar contra la BD)
    // Por ahora, asumimos que si existe el token, está autenticado
    const [uniboxId, email] = sessionToken.split("|");

    if (!uniboxId || !email) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      uniboxId,
      email,
      title: `Bandeja de ${email}`,
    });
  } catch (err: any) {
    console.error("[unibox-client/me] Error:", err.message);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

