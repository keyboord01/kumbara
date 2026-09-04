/**
 * Sembol Cloud relay client.
 *
 * Speaks the same wire protocol as smart-account-kit's RelayerClient
 * (POST { func, auth } or { xdr }) but authenticates with the Kumbara project
 * key. Until Sembol Cloud is deployed, SEMBOL_CLOUD_URL may point directly at
 * an OpenZeppelin Relayer Channels endpoint (".../api/v1/plugins/channels/call"),
 * in which case the body is wrapped in { params } as that API expects.
 *
 * If the relay is unreachable or rejects the request, the error is surfaced
 * as-is. There is deliberately no fallback to RPC submission: the user never
 * holds XLM.
 */
import type { SmartAccountKit, RelayerResponse } from "smart-account-kit";
import type { Transaction } from "@stellar/stellar-sdk";
import { sembolEnv } from "./env";

export interface RelayOptions {
  url: string;
  projectId: string;
  projectKey: string;
  timeoutMs?: number;
}

export class SembolCloudClient {
  private readonly url: string;
  private readonly projectId: string;
  private readonly projectKey: string;
  private readonly timeoutMs: number;
  private readonly channelsMode: boolean;

  constructor(options: RelayOptions) {
    this.url = options.url.replace(/\/+$/, "");
    this.projectId = options.projectId;
    this.projectKey = options.projectKey;
    this.timeoutMs = options.timeoutMs ?? 240_000;
    // OpenZeppelin Relayer Channels (hosted at channels.openzeppelin.com/<network>,
    // or a self-hosted relayer's /api/v1/plugins/channels/call) wants { params }.
    let host = "";
    try {
      host = new URL(this.url).hostname;
    } catch {
      host = "";
    }
    this.channelsMode = host === "channels.openzeppelin.com" || /\/plugins\/channels\/call$/.test(this.url);
  }

  get isConfigured(): boolean {
    return Boolean(this.url && this.projectKey);
  }

  /** Where the client is pointed, for logs. Never includes the key. */
  describe(): string {
    return `${this.url} (project=${this.projectId}, mode=${this.channelsMode ? "openzeppelin-channels" : "sembol-cloud"})`;
  }

  send(func: string, auth: string[]): Promise<RelayerResponse> {
    return this.submit({ func, auth });
  }

  sendXdr(transaction: Transaction | string): Promise<RelayerResponse> {
    const xdr = typeof transaction === "string" ? transaction : transaction.toXDR();
    return this.submit({ xdr });
  }

  private async submit(payload: Record<string, unknown>): Promise<RelayerResponse> {
    const body = this.channelsMode ? { params: payload } : payload;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.channelsMode && !/\/plugins\/channels\/call$/.test(this.url) ? `${this.url}/` : this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.projectKey}`,
          "x-project-id": this.projectId,
          "x-client-name": "kumbara-spikes",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      const data = (json?.data && typeof json.data === "object" ? json.data : json) as Record<string, unknown> | null;
      const hash = typeof data?.hash === "string" ? data.hash : undefined;
      const success = json?.success === true || (res.ok && json?.success !== false && Boolean(hash));
      if (success && hash) {
        const out: RelayerResponse = { success: true, hash };
        if (typeof data?.transactionId === "string") out.transactionId = data.transactionId;
        if (typeof data?.status === "string") out.status = data.status;
        return out;
      }
      const rawError = json?.error;
      const errorObj = rawError && typeof rawError === "object" ? (rawError as Record<string, unknown>) : null;
      const message =
        (typeof json?.message === "string" && json.message) ||
        (errorObj && typeof errorObj.message === "string" && errorObj.message) ||
        (typeof rawError === "string" && rawError) ||
        `relay request failed with HTTP ${res.status}`;
      const code =
        (errorObj && typeof errorObj.code === "string" && errorObj.code) ||
        (typeof json?.code === "string" && json.code) ||
        (res.status === 401 || res.status === 403 ? "UNAUTHORIZED" : undefined);
      const result: RelayerResponse = { success: false, error: message, details: json ?? text };
      if (code) result.errorCode = code;
      return result;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return {
        success: false,
        error: isAbort ? "relay request timed out" : `relay unreachable: ${err instanceof Error ? err.message : String(err)}`,
        errorCode: isAbort ? "TIMEOUT" : "RELAY_UNREACHABLE",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function relayFromEnv(overrides: Partial<RelayOptions> = {}): SembolCloudClient {
  const env = sembolEnv();
  return new SembolCloudClient({ url: env.url, projectId: env.projectId, projectKey: env.projectKey, ...overrides });
}

/** Replace the kit's built-in RelayerClient with the Sembol Cloud client. */
export function attachRelay(kit: SmartAccountKit, client: SembolCloudClient): void {
  Object.defineProperty(kit, "relayer", { value: client, writable: true, configurable: true, enumerable: true });
}
