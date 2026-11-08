/** Presenter-only: the test-funds pool's balance, its grants per day and the latest grants and refusals. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { poolStatus } from "@/lib/testfunds.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await poolStatus(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
