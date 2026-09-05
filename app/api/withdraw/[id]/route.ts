/** Poll a withdrawal: advances the pipeline by one step and returns the record. */
import { NextResponse } from "next/server";
import { advanceWithdrawal } from "@/lib/withdraw.server";
import { withdrawErrorResponse } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const record = await advanceWithdrawal(id);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}
