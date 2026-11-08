/**
 * Self-serve test money (testnet only, lib/testfunds.server.ts). GET ?contractId= tells the Savings screen what this
 * kumbara may still claim; POST { contractId } sends one capped grant from the pool, or refuses with the limit that
 * applied and, where it lifts, when.
 */
import { NextResponse } from "next/server";
import { boothRef } from "@/lib/cookies.server";
import { isContractId } from "@/lib/registry.server";
import { TestFundsError, allowanceFor, grantTestFunds } from "@/lib/testfunds.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const contractId = new URL(request.url).searchParams.get("contractId") ?? "";
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(await allowanceFor(contractId), { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: { contractId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const grant = await grantTestFunds(request, String(body.contractId ?? "").trim(), boothRef(request));
    return NextResponse.json(grant, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof TestFundsError) return NextResponse.json({ error: { code: err.code, message: err.message, retryAt: err.retryAt } }, { status: err.status, headers: NO_STORE });
    return NextResponse.json({ error: { code: "internal", message: err instanceof Error ? err.message : String(err) } }, { status: 500, headers: NO_STORE });
  }
}
