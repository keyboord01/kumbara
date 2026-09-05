/** USD/TRY from Reflector (mainnet FX oracle), cached one minute. */
import { NextResponse } from "next/server";
import { usdTryRate } from "@/lib/reflector.server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(): Promise<Response> {
  try {
    const rate = await usdTryRate();
    return NextResponse.json(rate, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "no rate" }, { status: 503 });
  }
}
