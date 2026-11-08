/** Presenter-only: client errors grouped by kind, errors per day, and the latest feedback (lib/monitor.server.ts). */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { monitorSnapshot } from "@/lib/monitor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await monitorSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
