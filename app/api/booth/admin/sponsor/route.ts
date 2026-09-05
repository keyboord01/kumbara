/** Presenter-only: the sponsor account's balance against its thresholds. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { sponsorStatus } from "@/lib/landing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const status = await sponsorStatus(5_000);
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "sponsor_unavailable", message: err instanceof Error ? err.message : String(err) } }, { status: 503 });
  }
}
