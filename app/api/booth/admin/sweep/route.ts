/** Presenter-only: merge back the bridge accounts of finished records so their reserves return to the sponsor. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { recordCounts, sweepBridges } from "@/lib/sweep.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const result = await sweepBridges();
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "sweep_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}

/** Counts per status, no side effects. */
export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json(await recordCounts(), { headers: { "cache-control": "no-store" } });
}
