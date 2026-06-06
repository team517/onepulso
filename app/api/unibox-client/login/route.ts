import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    // Validación simple (en producción, verificar contra la BD)
    // Por ahora, aceptamos cualquier email/password
    const uniboxId = "default-unibox";
    const sessionToken = `${uniboxId}|${email}`;

    const cookieStore = await cookies();
    cookieStore.set("unibox_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 días
    });

    return NextResponse.json({
      success: true,
      uniboxId,
      email,
    });
  } catch (err: any) {
    console.error("[unibox-client/login] Error:", err.message);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

