/**
 * Passkey → kumbara registry. GET ?credential=<id> answers with the kumbara a
 * credential id belongs to (the relay wrote primary passkeys at deployment;
 * backup passkeys are reported by the browser after enrolment). POST
 * registers a backup passkey only once the chain shows it as a signer of that
 * kumbara (SECURITY.md, KB-02). Keys are sha256 of the credential id; no
 * personal data is stored or returned.
 */
import { NextResponse } from "next/server";
import { credentialIsSigner } from "@/lib/chain-checks.server";
import { credentialBytes, credentialSaltHex, isContractId } from "@/lib/registry.server";
import { lookupCredential, registerCredential } from "@/lib/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const credential = new URL(request.url).searchParams.get("credential") ?? "";
  const saltHex = credentialSaltHex(credential);
  if (!saltHex) return NextResponse.json({ error: { code: "invalid_credential", message: "credential must be a WebAuthn credential id (base64url or hex)" } }, { status: 400, headers: NO_STORE });
  const row = await lookupCredential(saltHex);
  if (!row) return NextResponse.json({ error: { code: "not_found", message: "no kumbara is registered for this passkey" } }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ contractId: row.contractId, kind: row.kind, verified: row.verified }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let body: { credentialId?: string; contractId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const saltHex = credentialSaltHex(String(body.credentialId ?? ""));
  const contractId = String(body.contractId ?? "").trim();
  if (!saltHex) return NextResponse.json({ error: { code: "invalid_credential", message: "credentialId must be a WebAuthn credential id" } }, { status: 400, headers: NO_STORE });
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400, headers: NO_STORE });
  // Only backup passkeys arrive here; the primary one is registered by the relay from the deployment, verified.
  // The enrolment transaction has just confirmed, but the RPC node can trail it by a ledger or two.
  const bytes = credentialBytes(String(body.credentialId ?? ""))!;
  let isSigner = false;
  for (let attempt = 0; attempt < 3 && !isSigner; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000));
    isSigner = await credentialIsSigner(contractId, bytes).catch(() => false);
  }
  if (!isSigner) return NextResponse.json({ error: { code: "not_a_signer", message: "this passkey is not a signer of that kumbara on chain" } }, { status: 403, headers: NO_STORE });
  const row = await registerCredential(saltHex, contractId, "backup", true);
  if (row.contractId !== contractId) return NextResponse.json({ error: { code: "already_registered", message: "this passkey already opens another kumbara" } }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ contractId: row.contractId, kind: row.kind, verified: row.verified }, { status: 201, headers: NO_STORE });
}
