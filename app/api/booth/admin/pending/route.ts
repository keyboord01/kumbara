/** Presenter-only: deposits awaiting a (simulated) bank transfer. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { listPendingDeposits } from "@/lib/demo-bank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ pending: await listPendingDeposits(10) }, { headers: { "cache-control": "no-store" } });
}
