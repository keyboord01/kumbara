/**
 * Anchor discovery, server-side. The USDC issuer and the SEP endpoints come
 * from the anchor's stellar.toml; nothing is hardcoded.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { networkPassphrase, serverEnv } from "./env.server";

export interface AnchorDiscovery {
  usdc: { code: string; issuer: string; contractId: string };
  endpoints: Record<string, string>;
  networkPassphrase: string;
  treasury: string | null;
  /** The anchor's USDC treasury balance at discovery time (it pays on-ramps from it). */
  treasuryUsdc: string | null;
  fetchedAt: number;
}

/** Discovery is fetched with the framework data cache (10 min), never held in process memory. */
export async function discoverAnchor(): Promise<AnchorDiscovery> {
  const base = serverEnv.anchorBaseUrl();
  const res = await fetch(`${base}/.well-known/stellar.toml`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`anchor stellar.toml unavailable (${res.status})`);
  const raw = await res.text();
  const endpoints: Record<string, string> = {};
  for (const key of ["WEB_AUTH_ENDPOINT", "TRANSFER_SERVER", "KYC_SERVER", "ANCHOR_QUOTE_SERVER", "SIGNING_KEY"]) {
    const m = raw.match(new RegExp(`^${key}="([^"]+)"`, "m"));
    if (m?.[1]) endpoints[key] = m[1];
  }
  const passphrase = raw.match(/^NETWORK_PASSPHRASE="([^"]+)"/m)?.[1] ?? "";
  if (passphrase !== networkPassphrase()) {
    throw new Error(`anchor is on "${passphrase}" but STELLAR_NETWORK expects "${networkPassphrase()}"`);
  }
  const block = raw.split("[[CURRENCIES]]").slice(1).find((b) => /^code="USDC"/m.test(b));
  const issuer = block?.match(/^issuer="([^"]+)"/m)?.[1];
  if (!issuer) throw new Error("anchor stellar.toml has no USDC currency");
  let treasury: string | null = null;
  let treasuryUsdc: string | null = null;
  try {
    const health = (await (await fetch(`${base}/health`, { next: { revalidate: 60 } })).json()) as { treasury?: { address?: string; usdc_balance?: string } };
    treasury = health.treasury?.address ?? null;
    treasuryUsdc = health.treasury?.usdc_balance ?? null;
  } catch {
    treasury = null;
  }
  return {
    usdc: { code: "USDC", issuer, contractId: new Asset("USDC", issuer).contractId(passphrase) },
    endpoints,
    networkPassphrase: passphrase,
    treasury,
    treasuryUsdc,
    fetchedAt: Date.now(),
  };
}

/** Partner API call with the server-held key. */
export async function anchorCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${serverEnv.anchorBaseUrl()}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "X-API-Key": serverEnv.anchorApiKey(),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new AnchorHttpError(res.status, err?.code ?? "http_error", err?.message ?? text.slice(0, 200));
  }
  return json as T;
}

/**
 * The sandbox's documented test IBAN. The anchor pays simulated TRY payouts to
 * the customer's IBAN; Kumbara collects no bank details itself, so every
 * sandbox customer is created with this value. A production anchor collects
 * the real IBAN in its own KYC flow.
 */
export const SANDBOX_TEST_IBAN = "TR330006100519786457841326";

export class AnchorHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AnchorHttpError";
  }
}
