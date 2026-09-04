/**
 * TR Mock Anchor Partner API client (server-side only: it carries the
 * X-API-Key). Endpoint shapes follow https://tr-mock-anchor.fly.dev/openapi.json;
 * the asset issuer and SEP endpoints are read from the anchor's stellar.toml.
 */
import { anchorEnv } from "./env";
import { sleep } from "./log";

export class AnchorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AnchorError";
  }
}

export interface AnchorHealth {
  ok: boolean;
  stellar_mode: string;
  network_passphrase: string;
  horizon_url: string;
  asset: { code: string; issuer: string };
  treasury: { address: string; usdc_balance: string; low_balance: boolean };
  rates: { pair: string; mid_rate: string; buy_rate: string; sell_rate: string; spread_bps: number; source: string };
}

export interface Customer {
  id: string;
  external_id: string | null;
  first_name: string;
  last_name: string;
  iban: string | null;
  kyc_status: "approved" | "pending" | "rejected";
  deposit_reference: string;
  balances: { TRY: string; USDC: string };
}

export interface DepositInstructions {
  customer_id: string;
  method: string;
  rails: string[];
  currency: string;
  bank_name: string;
  account_holder: string;
  iban: string;
  iban_formatted: string;
  reference: string;
  instructions: { en: string; tr: string };
  sandbox_hint?: string;
}

export interface BankTransfer {
  id: string;
  customer_id: string | null;
  reference: string | null;
  amount_try: string;
  status: "matched" | "unmatched";
}

export interface Quote {
  id: string;
  side: "buy" | "sell";
  pair: string;
  rate: string;
  mid_rate: string;
  spread_bps: number;
  rate_source: string;
  source_currency: string;
  source_amount: string;
  destination_currency: string;
  destination_amount: string;
  expires_at: string;
  consumed_by: string | null;
}

export interface Onramp {
  id: string;
  customer_id: string;
  quote_id: string | null;
  amount_try: string;
  amount_usdc: string;
  rate: string;
  destination_address: string;
  memo: string | null;
  status: "pending" | "completed" | "failed";
  pending_reason: string | null;
  settlement: "payment" | "claimable_balance" | null;
  stellar_tx_hash: string | null;
  claimable_balance_id: string | null;
  failure_reason: string | null;
  completed_at: string | null;
}

export interface Offramp {
  id: string;
  customer_id: string;
  status: "awaiting_deposit" | "completed" | "cancelled";
  amount_usdc: string | null;
  deposit: {
    address: string;
    memo_type: string;
    memo: string;
    asset_code?: string;
    asset_issuer?: string;
    muxed_address?: string;
  };
  [key: string]: unknown;
}

export interface AnchorEvent {
  id: string;
  type: string;
  created_at: string;
  data: unknown;
}

export interface StellarTomlInfo {
  raw: string;
  usdc: { code: string; issuer: string };
  endpoints: Record<string, string>;
  networkPassphrase: string;
}

/** Public, no API key: the anchor's SEP-1 stellar.toml, parsed. */
export async function fetchStellarToml(baseUrl: string): Promise<StellarTomlInfo> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/.well-known/stellar.toml`);
  if (!res.ok) throw new Error(`stellar.toml fetch failed: ${res.status}`);
  const raw = await res.text();
  const endpoints: Record<string, string> = {};
  for (const key of ["WEB_AUTH_ENDPOINT", "TRANSFER_SERVER", "KYC_SERVER", "ANCHOR_QUOTE_SERVER", "SIGNING_KEY"]) {
    const m = raw.match(new RegExp(`^${key}="([^"]+)"`, "m"));
    if (m?.[1]) endpoints[key] = m[1];
  }
  const networkPassphrase = raw.match(/^NETWORK_PASSPHRASE="([^"]+)"/m)?.[1] ?? "";
  const blocks = raw.split("[[CURRENCIES]]").slice(1);
  const usdcBlock = blocks.find((b) => /^code="USDC"/m.test(b));
  const issuer = usdcBlock?.match(/^issuer="([^"]+)"/m)?.[1];
  if (!issuer) throw new Error("stellar.toml has no USDC currency block");
  return { raw, usdc: { code: "USDC", issuer }, endpoints, networkPassphrase };
}

export class Anchor {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config = anchorEnv()) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) headers["X-API-Key"] = this.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new AnchorError(res.status, err?.code ?? "http_error", err?.message ?? text.slice(0, 300), err?.details);
    }
    return json as T;
  }

  health(): Promise<AnchorHealth> {
    return this.call<AnchorHealth>("GET", "/health", undefined, false);
  }

  stellarToml(): Promise<StellarTomlInfo> {
    return fetchStellarToml(this.baseUrl);
  }

  createCustomer(input: { first_name: string; last_name: string; iban?: string; external_id?: string; email?: string }): Promise<Customer> {
    return this.call<Customer>("POST", "/v1/customers", input);
  }

  getCustomer(id: string): Promise<Customer> {
    return this.call<Customer>("GET", `/v1/customers/${id}`);
  }

  depositInstructions(customerId: string): Promise<DepositInstructions> {
    return this.call<DepositInstructions>("GET", `/v1/customers/${customerId}/deposit-instructions`);
  }

  /** Sandbox only: play the bank and report an incoming TRY transfer. */
  sandboxBankTransfer(input: { reference: string; amount_try: string; sender_name?: string }): Promise<BankTransfer> {
    return this.call<BankTransfer>("POST", "/v1/sandbox/bank-transfers", input);
  }

  quote(input: { customer_id?: string; side: "buy" | "sell"; amount: string; amount_currency: "TRY" | "USDC" }): Promise<Quote> {
    return this.call<Quote>("POST", "/v1/quotes", input);
  }

  createOnramp(input: { customer_id: string; destination_address: string; quote_id?: string; amount_try?: string; memo?: string }): Promise<Onramp> {
    return this.call<Onramp>("POST", "/v1/onramps", input);
  }

  getOnramp(id: string): Promise<Onramp> {
    return this.call<Onramp>("GET", `/v1/onramps/${id}`);
  }

  async pollOnramp(id: string, timeoutMs = 90_000): Promise<Onramp> {
    const started = Date.now();
    let last = await this.getOnramp(id);
    while (last.status === "pending" && Date.now() - started < timeoutMs) {
      await sleep(2000);
      last = await this.getOnramp(id);
    }
    return last;
  }

  createOfframp(input: { customer_id: string; amount_usdc?: string; auto_payout?: boolean; payout_iban?: string }): Promise<Offramp> {
    return this.call<Offramp>("POST", "/v1/offramps", input);
  }

  getOfframp(id: string): Promise<Offramp> {
    return this.call<Offramp>("GET", `/v1/offramps/${id}`);
  }

  async pollOfframp(id: string, timeoutMs = 90_000): Promise<Offramp> {
    const started = Date.now();
    let last = await this.getOfframp(id);
    while (last.status === "awaiting_deposit" && Date.now() - started < timeoutMs) {
      await sleep(3000);
      last = await this.getOfframp(id);
    }
    return last;
  }

  cancelOfframp(id: string): Promise<Offramp> {
    return this.call<Offramp>("POST", `/v1/offramps/${id}/cancel`);
  }

  events(params: { after?: string; type?: string; limit?: number } = {}): Promise<{ data: AnchorEvent[]; next_after?: string }> {
    const q = new URLSearchParams();
    if (params.after) q.set("after", params.after);
    if (params.type) q.set("type", params.type);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.call("GET", `/v1/events${qs ? `?${qs}` : ""}`);
  }

  unmatchedDeposits(): Promise<unknown> {
    return this.call("GET", "/v1/sandbox/unmatched-deposits");
  }

  customerLedger(customerId: string): Promise<unknown> {
    return this.call("GET", `/v1/customers/${customerId}/ledger`);
  }
}
