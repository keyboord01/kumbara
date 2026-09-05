/** The browser reports the vault withdrawal and the transfer to the landing account. */
import { NextResponse } from "next/server";
import { recordUsdcSent } from "@/lib/withdraw.server";
import { withdrawErrorResponse } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let body: { vaultTx?: string; transferTx?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  try {
    const record = await recordUsdcSent(id, { vaultTx: String(body.vaultTx ?? ""), transferTx: String(body.transferTx ?? "") });
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return withdrawErrorResponse(err);
  }
}
