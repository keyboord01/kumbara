/** Poll a deposit: advances the pipeline by one step and returns the record. */
import { NextResponse } from "next/server";
import { autoPlayBank } from "@/lib/autobank.server";
import { advanceDeposit, loadDeposit } from "@/lib/deposit.server";
import { depositErrorResponse } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    // Small deposits are confirmed without anyone pressing anything, and the visitor's own poll is what
    // triggers it: waiting for the driver's tick (or the five-minute backstop) made this leg feel dead.
    await autoPlayBank(await loadDeposit(id)).catch(() => undefined);
    const record = await advanceDeposit(id);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return depositErrorResponse(err);
  }
}
