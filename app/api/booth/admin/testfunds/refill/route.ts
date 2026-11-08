/** Presenter-only: the pool's one-step refill (Friendbot XLM when low, then XLM → USDC on the testnet DEX). */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { refillPool } from "@/lib/testfunds.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { xlm?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    return NextResponse.json(await refillPool(Number(body.xlm ?? 1_000)), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "refill_failed", message: err instanceof Error ? err.message : String(err) } }, { status: 502 });
  }
}
