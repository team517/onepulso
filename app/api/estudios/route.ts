import { NextRequest, NextResponse } from "next/server";
import { listEstudios, createEstudio } from "@/lib/estudios";

export async function GET() {
  const estudios = await listEstudios();
  return NextResponse.json({ estudios });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const estudio = await createEstudio({ title: body.title });
  return NextResponse.json({ estudio });
}
