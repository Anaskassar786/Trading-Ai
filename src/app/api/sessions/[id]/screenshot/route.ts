// GET /api/sessions/[id]/screenshot — returns the uploaded screenshot as an image.
import "server-only";
import { NextResponse } from "next/server";
import { getSession, readUpload } from "@/lib/db";
import { parseSession } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = getSession(params.id);
  if (!s) return new Response("not found", { status: 404 });
  const { snapshot } = parseSession(s);
  if (!snapshot.screenshot) return new Response("no screenshot", { status: 404 });
  const buf = readUpload(snapshot.screenshot.filename);
  if (!buf) return new Response("file missing", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": snapshot.screenshot.mimeType,
      "Cache-Control": "private, max-age=0",
    },
  });
}
