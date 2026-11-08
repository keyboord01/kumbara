/** A one-time challenge for a passkey proof of ownership (lib/passkey-proof.server.ts). POST { contractId }. */
import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/passkey-proof.server";
import { isContractId } from "@/lib/registry.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  let body: { contractId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const contractId = String(body.contractId ?? "").trim();
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400 });
  return NextResponse.json({ challenge: await issueChallenge(contractId) }, { headers: { "cache-control": "no-store" } });
}
