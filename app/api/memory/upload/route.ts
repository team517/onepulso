import { NextRequest, NextResponse } from "next/server";
import { saveMemory } from "@/lib/memory";
import { extractFile } from "@/lib/file-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const category = (formData.get("category") as string) ?? "file";

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;
  const extracted = await extractFile(filename, buffer);

  const title = filename.replace(/\.[^.]+$/, "");
  const content = `**Origen**: archivo \`${filename}\` (${extracted.format})${
    extracted.truncated ? " — truncado a 50 KB" : ""
  }\n\n${extracted.text}`;

  const entry = await saveMemory({ title, category, content });
  return NextResponse.json({ entry });
}
