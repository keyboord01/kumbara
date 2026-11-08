/** The browser reports a failure screen it showed, or an uncaught error (lib/monitor.server.ts). Anonymised, rate-limited. */
import { NextResponse } from "next/server";
import { recordClientError } from "@/lib/monitor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  let body: Parameters<typeof recordClientError>[1] = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  const stored = await recordClientError(request, body).catch(() => false);
  return NextResponse.json({ ok: stored }, { status: stored ? 202 : 429, headers: { "cache-control": "no-store" } });
}
