/** Presenter-only: the configured anchors (from their stellar.toml) and which one new deposits and withdrawals use. */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin.server";
import { activeAnchorHomeDomain, configuredAnchors, discoverAnchor, setActiveAnchor } from "@/lib/anchor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function describe(homeDomain: string) {
  try {
    const a = await discoverAnchor(homeDomain);
    return {
      homeDomain,
      ok: true,
      orgName: a.orgName,
      fiatCode: a.fiatCode,
      asset: a.usdc,
      endpoints: { auth: a.endpoints.WEB_AUTH_ENDPOINT ?? null, transfer: a.endpoints.TRANSFER_SERVER ?? null, quotes: a.endpoints.ANCHOR_QUOTE_SERVER ?? null, kyc: a.endpoints.KYC_SERVER ?? null },
      sep6: a.sep6,
      limits: a.limits,
      treasury: a.treasury,
    };
  } catch (err) {
    return { homeDomain, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const [active, anchors] = await Promise.all([activeAnchorHomeDomain(), Promise.all(configuredAnchors().map(describe))]);
  return NextResponse.json({ active, anchors }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  let body: { homeDomain?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (!body.homeDomain) return NextResponse.json({ error: { code: "invalid_request", message: "homeDomain is required" } }, { status: 400 });
  try {
    const active = await setActiveAnchor(body.homeDomain);
    return NextResponse.json({ active }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: { code: "not_configured", message: err instanceof Error ? err.message : String(err) } }, { status: 422 });
  }
}
