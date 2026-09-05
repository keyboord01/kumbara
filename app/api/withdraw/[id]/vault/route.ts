/**
 * The browser reports the passkey-signed vault withdrawal as soon as it is
 * confirmed, before the transfer to the landing account. A reload (phone
 * locked, tab closed) then resumes at the transfer step instead of withdrawing
 * from the vault a second time.
 */
import { NextResponse } from "next/server";
import { recordVaultTx } from "@/lib/withdraw.server";
import { withdrawErrorResponse } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let body: { vaultTx?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  try {
    const record = await recordVaultTx(id, String(body.vaultTx ?? ""));
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}
