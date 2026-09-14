/**
 * Passkey → kumbara registry. GET ?credential=<id> answers with the kumbara a
 * credential id belongs to (the relay wrote primary passkeys at deployment;
 * backup passkeys are written by the browser after enrolment and marked
 * unverified). POST registers a backup passkey. Keys are sha256 of the
 * credential id; no personal data is stored or returned.
 */
import { NextResponse } from "next/server";
import { credentialSaltHex, isContractId } from "@/lib/registry.server";
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
  const row = await registerCredential(saltHex, contractId, "backup", false);
  return NextResponse.json({ contractId: row.contractId, kind: row.kind, verified: row.verified }, { status: 201, headers: NO_STORE });
}
