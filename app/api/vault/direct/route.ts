/**
 * The browser reports a passkey-signed vault deposit of USDC that was already
 * in the kumbara: sent straight to its contract address from a wallet or
 * another kumbara, or left there by an interrupted deposit. Feed only: no
 * deposit record, no pipeline; the transaction hash is the proof.
 */
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { recordEvent } from "@/lib/metrics.server";
import { isContractId } from "@/lib/registry.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)).slice(0, 64) : null;
}

export async function POST(request: Request): Promise<Response> {
  let body: { contractId?: string; hash?: string; usdc?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  const contractId = String(body.contractId ?? "");
  const hash = String(body.hash ?? "").toLowerCase();
  const usdc = String(body.usdc ?? "");
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400 });
  if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: { code: "invalid_hash", message: "hash must be a 64-hex transaction hash" } }, { status: 400 });
  if (!/^\d{1,12}(\.\d{1,7})?$/.test(usdc) || Number(usdc) <= 0) return NextResponse.json({ error: { code: "invalid_amount", message: "usdc must be a positive decimal with up to 7 places" } }, { status: 400 });
  await recordEvent({
    type: "vault_deposit",
    ts: Date.now(),
    network: serverEnv.stellarNetwork(),
    projectId: serverEnv.sembolProjectId(),
    ref: readCookie(request, "kumbara_ref"),
    contractId,
    vaultTx: hash,
    usdc,
  });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
