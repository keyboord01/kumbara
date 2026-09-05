/**
 * Presenter-only: seed a demo account for the jury's withdraw demo. The
 * presenter's browser has just created the account with its own passkey;
 * this creates a deposit of SEED_DEPOSIT_TRY for it and plays the bank
 * immediately. The browser then runs the usual pipeline and the vault
 * autopilot, so the USDC ends up in the vault under the presenter's passkey.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { PlayBankError, playBank } from "@/lib/demo-bank";
import { createDeposit, DepositError } from "@/lib/deposit.server";
import { serverEnv } from "@/lib/env.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { contractId?: string; amountTry?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const amountTry = body.amountTry ?? process.env.SEED_DEPOSIT_TRY?.trim() ?? "250";
  try {
    const deposit = await createDeposit({ contractId: String(body.contractId ?? ""), amountTry, ref: "seed" });
    const bank = await playBank({ anchorBaseUrl: serverEnv.anchorBaseUrl(), anchorApiKey: serverEnv.anchorApiKey(), depositId: deposit.id });
    return NextResponse.json({ deposit, bank }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof DepositError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    if (err instanceof PlayBankError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: 502 });
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500 });
  }
}
