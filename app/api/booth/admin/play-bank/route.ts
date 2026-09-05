/** Presenter-only: play the bank for the newest pending deposit (same as pnpm demo:deposit). */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { PlayBankError, playBank } from "@/lib/demo-bank";
import { serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { depositId?: string; amountTry?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const input: Parameters<typeof playBank>[0] = { anchorBaseUrl: serverEnv.anchorBaseUrl(), anchorApiKey: serverEnv.anchorApiKey() };
    if (body.depositId) input.depositId = body.depositId;
    if (body.amountTry) input.amountTry = body.amountTry;
    const result = await playBank(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof PlayBankError) {
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.code === "no_pending_deposit" || err.code === "not_found" ? 404 : 502 });
    }
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
