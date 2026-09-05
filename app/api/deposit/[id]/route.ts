/** Poll a deposit: advances the pipeline by one step and returns the record. */
import { NextResponse } from "next/server";
import { advanceDeposit } from "@/lib/deposit.server";
import { depositErrorResponse } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const record = await advanceDeposit(id);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return depositErrorResponse(err);
  }
}
