/**
 * Thin server-side forwarder to Sembol Cloud.
 *
 * The browser (smart-account-kit's RelayerClient) posts { func, auth } or
 * { xdr } here; this route attaches the project key and forwards to
 * SEMBOL_CLOUD_URL. The key never reaches the browser and the browser never
 * talks to the relay directly. Same-origin only. No RPC fallback: if the
 * relay is down, the caller gets a loud error.
 */
import { NextResponse } from "next/server";
import { Address, StrKey, hash, xdr } from "@stellar/stellar-sdk";
import { networkPassphrase, serverEnv } from "@/lib/env.server";
import { recordEvent } from "@/lib/metrics.server";

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

function channelsMode(url: string): boolean {
  try {
    return new URL(url).hostname === "channels.openzeppelin.com" || /\/plugins\/channels\/call$/.test(url);
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
  const payload = hasFuncAuth ? { func: body.func, auth: body.auth } : { xdr: body.xdr };

  let url: string;
  let key: string;
  let projectId: string;
  try {
    url = serverEnv.sembolCloudUrl();
    key = serverEnv.sembolProjectKey();
    projectId = serverEnv.sembolProjectId();
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "relay not configured" }, { status: 503 });
  }
  const channels = channelsMode(url);
  const target = channels && !/\/plugins\/channels\/call$/.test(url) ? `${url}/` : url;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "x-project-id": projectId,
        "x-client-name": "kumbara",
      },
      body: JSON.stringify(channels ? { params: payload } : payload),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `relay unreachable: ${err instanceof Error ? err.message : String(err)}`, errorCode: "RELAY_UNREACHABLE" },
      { status: 502 },
    );
  }
  const text = await upstream.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : json;
  const txHash = typeof data?.hash === "string" ? data.hash : null;
  if (json?.success === true && txHash && hasFuncAuth) {
    const func = body.func as string;
    const ref = readCookie(request, "kumbara_ref");
    const contractId = deployedContractId(func);
    const event = contractId
      ? ({ type: "account_created", ts: Date.now(), network: serverEnv.stellarNetwork(), projectId, ref, contractId, hash: txHash } as const)
      : ({ type: "relayed_tx", ts: Date.now(), network: serverEnv.stellarNetwork(), projectId, ref, hash: txHash, contract: invokedContract(func) } as const);
    await recordEvent(event);
  }
  return new NextResponse(json ? JSON.stringify(json) : JSON.stringify({ success: false, error: text.slice(0, 300) }), {
    status: upstream.ok ? 200 : upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
