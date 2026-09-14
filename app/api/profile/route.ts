/**
 * A kumbara's name and savings goal. GET ?contractId= is public (a nickname
 * and a number, no personal data). PUT needs the passkey credential id the
 * registry maps to that contract: the credential id is random, never shown
 * anywhere and only the wallet holder's browser has it, so it stands in for
 * a signature without asking for another passkey prompt.
 */
import { NextResponse } from "next/server";
import { credentialSaltHex, isContractId } from "@/lib/registry.server";
import { getProfile, lookupCredential, setProfile } from "@/lib/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const NO_STORE = { "cache-control": "no-store" };
export const NAME_MAX = 24;
export const GOAL_MAX_USDC = 1_000_000;

export async function GET(request: Request): Promise<Response> {
  const contractId = new URL(request.url).searchParams.get("contractId") ?? "";
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400, headers: NO_STORE });
  const profile = await getProfile(contractId);
  return NextResponse.json({ profile }, { headers: NO_STORE });
}

export async function PUT(request: Request): Promise<Response> {
  let body: { contractId?: string; credentialId?: string; name?: string; goalUsdc?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const contractId = String(body.contractId ?? "").trim();
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400, headers: NO_STORE });
  const saltHex = credentialSaltHex(String(body.credentialId ?? ""));
  if (!saltHex) return NextResponse.json({ error: { code: "invalid_credential", message: "credentialId must be a WebAuthn credential id" } }, { status: 400, headers: NO_STORE });
  const registered = await lookupCredential(saltHex);
  if (!registered || registered.contractId !== contractId) {
    return NextResponse.json({ error: { code: "not_owner", message: "this passkey is not registered for that kumbara" } }, { status: 403, headers: NO_STORE });
  }
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!name) return NextResponse.json({ error: { code: "invalid_name", message: `name must be 1–${NAME_MAX} characters` } }, { status: 400, headers: NO_STORE });
  let goalUsdc: string | null = null;
  if (body.goalUsdc !== null && body.goalUsdc !== undefined && String(body.goalUsdc).trim() !== "") {
    const raw = String(body.goalUsdc).replace(",", ".").trim();
    const value = Number(raw);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(value > 0) || value > GOAL_MAX_USDC) return NextResponse.json({ error: { code: "invalid_goal", message: `goalUsdc must be a positive amount up to ${GOAL_MAX_USDC} with at most 2 decimals` } }, { status: 400, headers: NO_STORE });
    goalUsdc = value.toFixed(2);
  }
  const profile = await setProfile(contractId, name, goalUsdc);
  return NextResponse.json({ profile }, { headers: NO_STORE });
}
