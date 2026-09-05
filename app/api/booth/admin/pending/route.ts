/** Presenter-only: deposits awaiting a (simulated) bank transfer. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { listPendingDeposits } from "@/lib/demo-bank";
import { listStuckDeposits } from "@/lib/deposit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const [pending, stuck] = await Promise.all([listPendingDeposits(10), listStuckDeposits(10)]);
  return NextResponse.json(
    {
      pending,
      stuck: stuck.map((d) => ({
        id: d.id,
        status: d.status,
        contractId: d.contractId,
        amountTry: d.receivedTry ?? d.amountTry,
        usdc: d.firmQuote?.usdcOut ?? null,
        paidUsdc: d.paidUsdc ?? null,
        onrampId: d.onrampId ?? null,
        updatedAt: d.updatedAt,
        abandonedAt: d.abandonedAt ?? null,
        errorCode: d.error?.code ?? null,
        landing: d.status === "failed" && d.landing ? d.landing.publicKey : null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
