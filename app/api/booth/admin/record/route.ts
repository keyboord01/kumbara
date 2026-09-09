/** Presenter-only: read a deposit or withdrawal as stored, without advancing it (the poll routes step; this one only looks). */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import type { DepositRecord } from "@/lib/deposit.server";
import { depositStore, withdrawalStore } from "@/lib/store.server";
import type { WithdrawalRecord } from "@/lib/withdraw.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const depositId = url.searchParams.get("deposit");
  const withdrawalId = url.searchParams.get("withdrawal");
  const record: DepositRecord | WithdrawalRecord | null = depositId ? await depositStore.get<DepositRecord>(depositId) : withdrawalId ? await withdrawalStore.get<WithdrawalRecord>(withdrawalId) : null;
  if (!record) return NextResponse.json({ error: { code: "not_found", message: "no such record" } }, { status: 404 });
  // The bridge account's SEP-10 bearer stays server-side.
  const sep6 = record.sep6 ? { ...record.sep6, token: undefined } : undefined;
  return NextResponse.json({ ...record, sep6 }, { headers: { "cache-control": "no-store" } });
}
