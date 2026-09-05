/**
 * Public traction evidence: accounts that completed onboarding (deploy
 * confirmed on-chain), deposits, vault deposits and withdrawals, each with
 * transaction hashes. Filter with ?ref=booth-1 and ?since=<unix seconds>
 * (default BOOTH_START_TS). Cached 30 s.
 */
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { metricsSnapshot } from "@/lib/metrics.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const refParam = url.searchParams.get("ref")?.trim().slice(0, 64) ?? "";
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam && /^\d{1,12}$/.test(sinceParam) ? Number(sinceParam) : serverEnv.boothStartTs();
  // Cached at the edge for 30 s (s-maxage); no process memory involved.
  const headers = { "cache-control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60", "access-control-allow-origin": "*" };
  try {
    const body = await metricsSnapshot({ ref: refParam || null, since });
    return NextResponse.json(body, { headers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "metrics unavailable" }, { status: 503 });
  }
}
