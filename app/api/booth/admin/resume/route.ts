/** Presenter-only: put an abandoned on-ramp deposit back into the pipeline (once the anchor can pay). */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { DepositError, resumeDeposit } from "@/lib/deposit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { depositId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const record = await resumeDeposit(String(body.depositId ?? ""));
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof DepositError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
