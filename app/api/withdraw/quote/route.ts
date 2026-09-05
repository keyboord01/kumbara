/** Indicative sell quote for the withdraw form. */
import { NextResponse } from "next/server";
import { quoteWithdrawal } from "@/lib/withdraw.server";
import { withdrawErrorResponse } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    const quote = await quoteWithdrawal(url.searchParams.get("contractId") ?? "", url.searchParams.get("amountUsdc") ?? "");
    return NextResponse.json(quote, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}
