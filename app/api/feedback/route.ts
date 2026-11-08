/** One-tap problem reports from the footer or a failure screen (lib/monitor.server.ts). Anonymised, rate-limited. */
import { NextResponse } from "next/server";
import { recordFeedback } from "@/lib/monitor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  let body: Parameters<typeof recordFeedback>[1] = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  const stored = await recordFeedback(request, body).catch(() => false);
  if (!stored) return NextResponse.json({ error: { code: "rate_limited", message: "too many reports from this connection; try again later" } }, { status: 429 });
  return NextResponse.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
}
