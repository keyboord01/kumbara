/**
 * The user gives up on a deposit (cancel before lira moved, abandon a treasury-low on-ramp). Deposit ids are listed
 * for any public kumbara address, so the caller must sign a challenge with the kumbara's passkey or be the presenter (KB-03, KB-06).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { cancelDeposit, loadDeposit } from "@/lib/deposit.server";
import { provesOwnership } from "@/lib/ownership.server";
import type { PasskeyProof } from "@/lib/passkey-proof.server";
import { depositErrorResponse } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let body: { proof?: Partial<PasskeyProof> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const existing = await loadDeposit(id);
    const isPresenter = request.headers.has("authorization") && requireAdmin(request) === null;
    if (!isPresenter && !(await provesOwnership(request, existing.contractId, body.proof))) {
      return NextResponse.json({ error: { code: "not_owner", message: "only the kumbara's own passkey can cancel this deposit" } }, { status: 403 });
    }
    const record = await cancelDeposit(id);
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return depositErrorResponse(err);
  }
}
