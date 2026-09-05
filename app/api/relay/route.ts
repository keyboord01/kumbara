/**
 * Thin server-side forwarder to Sembol Cloud.
 *
 * The browser (smart-account-kit's RelayerClient) posts { func, auth } or
 * { xdr } here; this route attaches the project key and forwards to
 * SEMBOL_CLOUD_URL (lib/relay.server.ts). The key never reaches the browser
 * and the browser never talks to the relay directly. Same-origin only. No RPC
 * fallback: if the relay is down, the caller gets a loud error.
 */
import { NextResponse } from "next/server";
import { Address, StrKey, hash, xdr } from "@stellar/stellar-sdk";
import { networkPassphrase, serverEnv } from "@/lib/env.server";
import { recordEvent } from "@/lib/metrics.server";
import { relayForward } from "@/lib/relay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200_000;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser or same-origin fetch without Origin
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Contract address a createContractV2 host function will deploy to. */
function deployedContractId(funcXdr: string): string | null {
  try {
    const func = xdr.HostFunction.fromXDR(funcXdr, "base64");
    if (func.switch().name !== "hostFunctionTypeCreateContractV2") return null;
    const preimage = func.createContractV2().contractIdPreimage();
    if (preimage.switch().name !== "contractIdPreimageFromAddress") return null;
    const hashPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({ networkId: hash(Buffer.from(networkPassphrase())), contractIdPreimage: preimage }),
    );
    return StrKey.encodeContract(hash(hashPreimage.toXDR()));
  } catch {
    return null;
  }
}

function invokedContract(funcXdr: string): string | null {
  try {
    const func = xdr.HostFunction.fromXDR(funcXdr, "base64");
    if (func.switch().name !== "hostFunctionTypeInvokeContract") return null;
    return Address.fromScAddress(func.invokeContract().contractAddress()).toString();
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)).slice(0, 64) : null;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return NextResponse.json({ success: false, error: "cross-origin relay calls are not allowed" }, { status: 403 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "payload too large" }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON" }, { status: 400 });
  }
  const hasFuncAuth = typeof body.func === "string" && Array.isArray(body.auth);
  const hasXdr = typeof body.xdr === "string";
  if (!hasFuncAuth && !hasXdr) {
    return NextResponse.json({ success: false, error: "expected { func, auth } or { xdr }" }, { status: 400 });
  }
  const payload: Record<string, unknown> = hasFuncAuth ? { func: body.func, auth: body.auth } : { xdr: body.xdr };

  let projectId: string;
  let upstream: { status: number; json: Record<string, unknown> | null; text: string };
  try {
    projectId = serverEnv.sembolProjectId();
    upstream = await relayForward(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notConfigured = /environment variable/.test(message);
    return NextResponse.json(
      { success: false, error: notConfigured ? message : `relay unreachable: ${message}`, errorCode: notConfigured ? "RELAY_NOT_CONFIGURED" : "RELAY_UNREACHABLE" },
      { status: notConfigured ? 503 : 502 },
    );
  }

  const { json, text, status } = upstream;
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : json;
  const txHash = typeof data?.hash === "string" ? data.hash : null;
  if (json?.success === true && txHash && hasFuncAuth) {
    const func = body.func as string;
    const ref = readCookie(request, "kumbara_ref");
    const contractId = deployedContractId(func);
    const network = serverEnv.stellarNetwork();
    await recordEvent(
      contractId
        ? { type: "account_created", ts: Date.now(), network, projectId, ref, contractId, hash: txHash }
        : { type: "relayed_tx", ts: Date.now(), network, projectId, ref, hash: txHash, contract: invokedContract(func) },
    );
  }
  return new NextResponse(json ? JSON.stringify(json) : JSON.stringify({ success: false, error: text.slice(0, 300) }), {
    status: status >= 200 && status < 300 ? 200 : status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
