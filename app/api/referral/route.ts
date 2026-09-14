/** A kumbara's invite link and how many kumbaras were opened through it. Public; the code is derived, the count is a query. */
import { NextResponse } from "next/server";
import { inviteCode, inviteCount } from "@/lib/referral.server";
import { isContractId } from "@/lib/registry.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const contractId = url.searchParams.get("contractId") ?? "";
  if (!isContractId(contractId)) return NextResponse.json({ error: { code: "invalid_contract", message: "contractId must be a C… address" } }, { status: 400, headers: { "cache-control": "no-store" } });
  const code = inviteCode(contractId);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "") || url.origin;
  const count = await inviteCount(contractId);
  return NextResponse.json({ code, link: `${site}/?ref=${code}`, count }, { headers: { "cache-control": "no-store" } });
}
