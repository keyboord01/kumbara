/**
 * Server-side relay client. Holds the project key; forwards { func, auth } or
 * { xdr } to Sembol Cloud (or, until it exists, an OpenZeppelin Channels
 * service, which wants the body wrapped in { params }). No RPC fallback.
 */
import "server-only";
import { serverEnv } from "./env.server";

export interface RelayResult {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

function channelsMode(url: string): boolean {
  try {
    return new URL(url).hostname === "channels.openzeppelin.com" || /\/plugins\/channels\/call$/.test(url);
  } catch {
    return false;
  }
}

export async function relayForward(payload: Record<string, unknown>): Promise<RelayResult> {
  const url = serverEnv.sembolCloudUrl();
  const channels = channelsMode(url);
  const target = channels && !/\/plugins\/channels\/call$/.test(url) ? `${url}/` : url;
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${serverEnv.sembolProjectKey()}`,
      "x-project-id": serverEnv.sembolProjectId(),
      "x-client-name": "kumbara",
    },
    body: JSON.stringify(channels ? { params: payload } : payload),
    signal: AbortSignal.timeout(240_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

export interface NormalizedRelayResponse {
  success: boolean;
  hash?: string;
  error?: string;
  errorCode?: string;
}

export function normalizeRelay(result: RelayResult): NormalizedRelayResponse {
  const { json, status, text } = result;
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : json;
  const hash = typeof data?.hash === "string" ? data.hash : undefined;
  if (json?.success === true && hash) return { success: true, hash };
  const err = json?.error;
  const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const message =
    (typeof json?.message === "string" && json.message) || (errObj && typeof errObj.message === "string" && errObj.message) || (typeof err === "string" && err) || `relay HTTP ${status}: ${text.slice(0, 200)}`;
  const code = (errObj && typeof errObj.code === "string" && errObj.code) || (typeof (data as Record<string, unknown> | null)?.code === "string" && String((data as Record<string, unknown>).code)) || undefined;
  const out: NormalizedRelayResponse = { success: false, error: message };
  if (code) out.errorCode = code;
  return out;
}

/** RelaySubmitter for the landing module. */
export const serverRelay = {
  async sendXdr(envelopeXdr: string): Promise<NormalizedRelayResponse> {
    try {
      return normalizeRelay(await relayForward({ xdr: envelopeXdr }));
    } catch (err) {
      return { success: false, error: `relay unreachable: ${err instanceof Error ? err.message : String(err)}`, errorCode: "RELAY_UNREACHABLE" };
    }
  },
};
