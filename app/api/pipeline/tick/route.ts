/**
 * The pipeline driver: advances every pending deposit and withdrawal through
 * the steps the server can take without the user's page (see lib/pipeline.server.ts).
 * Presenter token only. Called every 5 s by /booth/admin while it is open and
 * every 5 minutes by the GitHub Actions backstop. Idempotent.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { tickPipeline } from "@/lib/pipeline.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function tick(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const result = await tickPipeline(40_000);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "tick_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return tick(request);
}

export async function GET(request: Request): Promise<Response> {
  return tick(request);
}
