/** The user gives up on a deposit (cancel before lira moved, abandon a treasury-low on-ramp). */
import { NextResponse } from "next/server";
import { cancelDeposit } from "@/lib/deposit.server";
import { depositErrorResponse } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  try {
    const record = await cancelDeposit(id);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return depositErrorResponse(err);
  }
}
