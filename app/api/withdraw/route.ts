/** Withdrawals: create (POST) and list/resume (GET ?contractId=). */
import { NextResponse } from "next/server";
import { boothRef } from "@/lib/cookies.server";
import { AnchorHttpError } from "@/lib/anchor.server";
import { FINAL_WITHDRAWAL_STATUSES, WITHDRAW_MIN_USDC, WithdrawError, createWithdrawal, listWithdrawals } from "@/lib/withdraw.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function withdrawErrorResponse(err: unknown): Response {
  if (err instanceof WithdrawError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  if (err instanceof AnchorHttpError) return NextResponse.json({ error: { code: err.code, message: err.message, source: "anchor" } }, { status: err.status >= 500 ? 502 : err.status });
  const message = err instanceof Error ? err.message : String(err);
  const status = /SPONSOR_SECRET|environment variable/.test(message) ? 503 : 500;
  return NextResponse.json({ error: { code: "internal", message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: { contractId?: string; amountUsdc?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  try {
    const record = await createWithdrawal({ contractId: String(body.contractId ?? ""), amountUsdc: String(body.amountUsdc ?? ""), ref: boothRef(request) });
    return NextResponse.json(record, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}

export async function GET(request: Request): Promise<Response> {
  const contractId = new URL(request.url).searchParams.get("contractId") ?? "";
  if (!/^C[A-Z2-7]{55}$/.test(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId required" } }, { status: 400 });
  try {
    const all = await listWithdrawals(contractId);
    const active = all.find((w) => !FINAL_WITHDRAWAL_STATUSES.includes(w.status)) ?? null;
    return NextResponse.json({ active, recent: all.slice(0, 5), limits: { minUsdc: WITHDRAW_MIN_USDC } }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}
