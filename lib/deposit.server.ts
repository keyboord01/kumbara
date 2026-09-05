/**
 * Deposit pipeline (ONRAMP_MODE=landing), advanced one step per poll so it
 * runs inside ordinary request handlers:
 *
 *   awaiting_transfer  → the customer's TRY balance rises by the deposit
 *   transfer_received  → firm quote → landing account → anchor on-ramp
 *   onramp_pending     → anchor paid the landing account (amount == quote)
 *   onramp_paid        → pre-authorized forward (USDC → smart account) via relay
 *   forwarded          → pre-authorized cleanup (merge landing into sponsor)
 *   in_wallet          → the browser deposits into the vault with the passkey
 *   in_vault           → done
 *
 * Every step is idempotent against the stored record and serialized per
 * deposit id. Transient failures (anchor or relay unreachable, sponsor
 * under-funded, an expired quote) keep the status and are retried by the
 * next poll; a paid amount that differs from the quote is a hard failure
 * with the funds left in the ownerless landing account. Each transition is
 * appended to `history` for the public timing metrics.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { AnchorHttpError, SANDBOX_TEST_IBAN, anchorCall, discoverAnchor } from "./anchor.server";
import { serverEnv } from "./env.server";
import { assertSponsorReady, landingDeps } from "./landing.server";
import { LandingError, createLandingAccount, submitPreauthorized, type LandingPlan } from "./landing/landing";
import { recordEvent } from "./metrics.server";
import { depositStore, getCustomerId, newId, setCustomerId, withLease, type StoredRecord } from "./store.server";

/** The anchor's documented per-order limits (50.00 – 250,000.00 TRY). */
export const DEPOSIT_MIN_TRY = 50;
export const DEPOSIT_MAX_TRY = 250_000;
const MAX_STEP_ATTEMPTS = 6;

/** Minutes before the Deposit screen offers "keep waiting / cancel" for a transfer that has not arrived. */
export function transferTimeoutMinutes(): number {
  const raw = Number(process.env.DEPOSIT_TRANSFER_TIMEOUT_MIN?.trim() ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/** A pipeline step failure with a stable code; `transient` ones are retried by the next poll. */
export class StepError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly transient = false,
  ) {
    super(message);
    this.name = "StepError";
  }
}

export type DepositStatus = "awaiting_transfer" | "transfer_received" | "onramp_pending" | "onramp_paid" | "forwarded" | "in_wallet" | "in_vault" | "failed" | "cancelled" | "abandoned";
/** Statuses the Deposit screen treats as finished (a new deposit can start). */
export const FINAL_STATUSES: DepositStatus[] = ["in_vault", "failed", "cancelled", "abandoned"];

export interface DepositRecord extends StoredRecord {
  status: DepositStatus;
  network: string;
  /** Booth ref the kumbara was opened with, for the counter. */
  ref: string | null;
  customerId: string;
  amountTry: string;
  baselineTry: string;
  receivedTry?: string;
  indicative: { quoteId: string; usdcOut: string; rate: string; spreadBps: number; expiresAt: string };
  firmQuote?: { quoteId: string; usdcOut: string; rate: string; expiresAt: string };
  instructions: { bankName: string; iban: string; ibanFormatted: string; accountHolder: string; reference: string; rails: string[] };
  landing?: LandingPlan;
  onrampId?: string;
  anchorTxHash?: string;
  paidUsdc?: string;
  forwardTxHash?: string;
  forwardVia?: string;
  cleanupTxHash?: string;
  cleanupVia?: string;
  cleanupError?: string;
  vaultTxHash?: string;
  vaultDepositUsdc?: string;
  attempts?: Partial<Record<DepositStatus, number>>;
  lastError?: { at: string; message: string; code?: string };
  error?: { code: string; message: string };
  /** Set when the user abandoned a deposit the anchor still owes (treasury low); a presenter can resume it. */
  abandonedAt?: string;
  abandonedFrom?: DepositStatus;
  /** When the Deposit screen starts offering "keep waiting / cancel" for a missing transfer. */
  transferDeadline?: string;
  /** Every status transition with its time, for the public timing metrics. */
  history?: Array<{ status: DepositStatus; at: string }>;
}

/** Append a history entry when the status changed. */
function withHistory(previous: DepositRecord, next: DepositRecord): DepositRecord {
  if (next.status === previous.status) return next;
  return { ...next, history: [...(previous.history ?? []), { status: next.status, at: new Date().toISOString() }] };
}

interface AnchorCustomer {
  id: string;
  external_id: string | null;
  deposit_reference: string;
  balances: { TRY: string; USDC: string };
}
interface AnchorQuote {
  id: string;
  rate: string;
  spread_bps: number;
  source_amount: string;
  destination_amount: string;
  expires_at: string;
}
interface AnchorInstructions {
  bank_name: string;
  iban: string;
  iban_formatted: string;
  account_holder: string;
  reference: string;
  rails: string[];
}
interface AnchorOnramp {
  id: string;
  status: "pending" | "completed" | "failed";
  amount_usdc: string;
  stellar_tx_hash: string | null;
  failure_reason: string | null;
  pending_reason: string | null;
}

export class DepositError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DepositError";
  }
}

const toCents = (amount: string): bigint => {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
};
const fromCents = (cents: bigint): string => `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
const toStroops = (amount: string): bigint => {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
};

function isContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}

/** One anchor customer per kumbara, keyed by the contract id. */
export async function ensureCustomer(contractId: string): Promise<string> {
  const known = await getCustomerId(contractId);
  if (known) return known;
  try {
    const customer = await anchorCall<AnchorCustomer>("POST", "/v1/customers", {
      first_name: "Kumbara",
      last_name: contractId.slice(-6),
      external_id: contractId,
      iban: SANDBOX_TEST_IBAN,
    });
    await setCustomerId(contractId, customer.id);
    return customer.id;
  } catch (err) {
    if (!(err instanceof AnchorHttpError) || err.code !== "duplicate_external_id") throw err;
    for (let offset = 0; offset < 4000; offset += 200) {
      const page = await anchorCall<{ data: AnchorCustomer[] }>("GET", `/v1/customers?limit=200&offset=${offset}`);
      const hit = page.data.find((c) => c.external_id === contractId);
      if (hit) {
        await setCustomerId(contractId, hit.id);
        return hit.id;
      }
      if (page.data.length < 200) break;
    }
    throw err;
  }
}

export async function createDeposit(input: { contractId: string; amountTry: string; ref?: string | null }): Promise<DepositRecord> {
  if (!isContractId(input.contractId)) throw new DepositError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,2})?$/.test(input.amountTry)) throw new DepositError(400, "invalid_amount", "amountTry must be a decimal with up to 2 digits");
  const amount = fromCents(toCents(input.amountTry));
  const value = Number(amount);
  if (value < DEPOSIT_MIN_TRY || value > DEPOSIT_MAX_TRY) {
    throw new DepositError(422, "amount_out_of_range", `amount must be between ${DEPOSIT_MIN_TRY} and ${DEPOSIT_MAX_TRY} TRY`);
  }
  const customerId = await ensureCustomer(input.contractId);
  const [customer, quote, instructions] = await Promise.all([
    anchorCall<AnchorCustomer>("GET", `/v1/customers/${customerId}`),
    anchorCall<AnchorQuote>("POST", "/v1/quotes", { customer_id: customerId, side: "buy", amount, amount_currency: "TRY" }),
    anchorCall<AnchorInstructions>("GET", `/v1/customers/${customerId}/deposit-instructions`),
  ]);
  const now = new Date().toISOString();
  const record: DepositRecord = {
    id: newId("dep"),
    contractId: input.contractId,
    customerId,
    network: serverEnv.stellarNetwork(),
    ref: input.ref ?? null,
    status: "awaiting_transfer",
    amountTry: amount,
    baselineTry: customer.balances.TRY,
    indicative: { quoteId: quote.id, usdcOut: quote.destination_amount, rate: quote.rate, spreadBps: quote.spread_bps, expiresAt: quote.expires_at },
    instructions: {
      bankName: instructions.bank_name,
      iban: instructions.iban,
      ibanFormatted: instructions.iban_formatted,
      accountHolder: instructions.account_holder,
      reference: instructions.reference,
      rails: instructions.rails,
    },
    createdAt: now,
    updatedAt: now,
    transferDeadline: new Date(Date.now() + transferTimeoutMinutes() * 60_000).toISOString(),
    history: [{ status: "awaiting_transfer", at: now }],
  };
  await depositStore.save(record);
  return record;
}

export async function getDeposit(id: string): Promise<DepositRecord | null> {
  return depositStore.get<DepositRecord>(id);
}

export async function listDeposits(contractId: string): Promise<DepositRecord[]> {
  return depositStore.list<DepositRecord>(contractId);
}

function isTransient(err: unknown): boolean {
  if (err instanceof StepError) return err.transient;
  if (err instanceof LandingError) return err.code === "sponsor_underfunded" || err.code === "submit_failed";
  if (err instanceof AnchorHttpError) return err.status >= 500 || err.status === 429;
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

function errorCode(err: unknown): string {
  if (err instanceof StepError || err instanceof LandingError || err instanceof AnchorHttpError) return err.code;
  return "step_failed";
}

/** Lease TTL for one pipeline step; a crashed invocation frees the record after this. */
const STEP_LEASE_MS = 110_000;

async function loadDeposit(id: string): Promise<DepositRecord> {
  const record = await depositStore.get<DepositRecord>(id);
  if (!record) throw new DepositError(404, "not_found", "deposit not found");
  return record;
}

/**
 * Advance the deposit by one step if the world has moved on. Serialized per
 * id with a database lease, so any invocation on any instance can resume
 * from the stored state; a concurrent poll simply reads the current record.
 */
export async function advanceDeposit(id: string): Promise<DepositRecord> {
  return withLease(`deposit:${id}`, STEP_LEASE_MS, async () => {
    const record = await loadDeposit(id);
    if (FINAL_STATUSES.includes(record.status) || record.status === "in_wallet") return record;
    try {
      const next = withHistory(record, await step(record));
      if (next !== record) await depositStore.save(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = { ...(record.attempts ?? {}), [record.status]: (record.attempts?.[record.status] ?? 0) + 1 };
      const code = errorCode(err);
      let failed: DepositRecord = { ...record, attempts, lastError: { at: new Date().toISOString(), message, code } };
      if (!isTransient(err) || attempts[record.status]! >= MAX_STEP_ATTEMPTS) {
        failed = withHistory(record, { ...failed, status: "failed", error: { code, message } });
      }
      await depositStore.save(failed);
      return failed;
    }
  }, () => loadDeposit(id));
}

async function step(record: DepositRecord): Promise<DepositRecord> {
  switch (record.status) {
    case "awaiting_transfer": {
      const customer = await anchorCall<AnchorCustomer>("GET", `/v1/customers/${record.customerId}`);
      const delta = toCents(customer.balances.TRY) - toCents(record.baselineTry);
      if (delta < BigInt(DEPOSIT_MIN_TRY) * 100n) return record;
      const received = delta > BigInt(DEPOSIT_MAX_TRY) * 100n ? fromCents(BigInt(DEPOSIT_MAX_TRY) * 100n) : fromCents(delta);
      return { ...record, receivedTry: received, status: "transfer_received" };
    }
    case "transfer_received": {
      await assertSponsorReady();
      const anchor = await discoverAnchor();
      const amountTry = record.receivedTry ?? record.amountTry;
      const quoteBody = { customer_id: record.customerId, side: "buy", amount: amountTry, amount_currency: "TRY" };
      let quote = await anchorCall<AnchorQuote>("POST", "/v1/quotes", quoteBody);
      const amountStroops = toStroops(quote.destination_amount);
      const plan = await createLandingAccount(landingDeps(), {
        usdc: new Asset(anchor.usdc.code, anchor.usdc.issuer),
        usdcContract: anchor.usdc.contractId,
        kind: { type: "onramp", destinationContract: record.contractId, amountStroops },
      });
      if (Date.now() > Date.parse(quote.expires_at) - 5_000) {
        // The 120 s quote ran out while the landing account was being built. The
        // forward is pre-authorized for this exact amount, so a fresh quote only
        // works if the rate did not move; otherwise the next poll starts over
        // (the stranded landing account's reserve is the sponsor's, never the user's).
        const fresh = await anchorCall<AnchorQuote>("POST", "/v1/quotes", quoteBody);
        if (toStroops(fresh.destination_amount) !== amountStroops) {
          throw new StepError("quote_expired", `quote expired while the landing account was being prepared and the rate moved (${quote.destination_amount} → ${fresh.destination_amount} USDC); fetching a new quote`, true);
        }
        quote = fresh;
      }
      const onramp = await anchorCall<AnchorOnramp>("POST", "/v1/onramps", { customer_id: record.customerId, quote_id: quote.id, destination_address: plan.publicKey });
      return {
        ...record,
        firmQuote: { quoteId: quote.id, usdcOut: quote.destination_amount, rate: quote.rate, expiresAt: quote.expires_at },
        landing: plan,
        onrampId: onramp.id,
        status: "onramp_pending",
      };
    }
    case "onramp_pending": {
      if (!record.onrampId || !record.landing) throw new Error("onramp state missing");
      const onramp = await anchorCall<AnchorOnramp>("GET", `/v1/onramps/${record.onrampId}`);
      if (onramp.status === "pending") return record;
      if (onramp.status === "failed") {
        return { ...record, status: "failed", error: { code: "onramp_failed", message: onramp.failure_reason ?? "anchor on-ramp failed (TRY refunded)" } };
      }
      if (toStroops(onramp.amount_usdc) !== BigInt(record.landing.amountStroops)) {
        return {
          ...record,
          anchorTxHash: onramp.stellar_tx_hash ?? undefined,
          paidUsdc: onramp.amount_usdc,
          status: "failed",
          error: { code: "amount_mismatch", message: `anchor paid ${onramp.amount_usdc} USDC but the pre-authorized forward is for ${record.firmQuote?.usdcOut}; funds are parked in landing account ${record.landing.publicKey}` },
        } as DepositRecord;
      }
      return { ...record, anchorTxHash: onramp.stellar_tx_hash ?? undefined, paidUsdc: onramp.amount_usdc, status: "onramp_paid" } as DepositRecord;
    }
    case "onramp_paid": {
      if (!record.landing) throw new Error("landing plan missing");
      const forward = await submitPreauthorized(landingDeps(), record.landing.forwardTxXdr);
      return { ...record, forwardTxHash: forward.hash, forwardVia: forward.via, status: "forwarded" };
    }
    case "forwarded": {
      if (!record.landing) throw new Error("landing plan missing");
      try {
        const cleanup = await submitPreauthorized(landingDeps(), record.landing.cleanupTxXdr);
        return { ...record, cleanupTxHash: cleanup.hash, cleanupVia: cleanup.via, status: "in_wallet" };
      } catch (err) {
        // The user's USDC is already in the kumbara; the reserve merge can be retried out of band.
        return { ...record, cleanupError: err instanceof Error ? err.message : String(err), status: "in_wallet" };
      }
    }
    default:
      return record;
  }
}

/**
 * Give up on a deposit so the user can start another. Before any lira moved
 * it is simply cancelled. Once the anchor holds an on-ramp that is waiting on
 * its treasury, the record is kept whole (on-ramp id, landing plan) as
 * `abandoned`: the anchor will still pay the landing account when it can, and
 * a presenter can resume the record from the console. Funds that are already
 * moving (paid, forwarded, in the wallet) cannot be abandoned.
 */
export async function cancelDeposit(id: string): Promise<DepositRecord> {
  return withLease(`deposit:${id}`, 30_000, async () => {
    const record = await loadDeposit(id);
    if (FINAL_STATUSES.includes(record.status)) return record;
    if (record.status === "awaiting_transfer" || record.status === "transfer_received") {
      return depositStore.save(withHistory(record, { ...record, status: "cancelled", abandonedAt: new Date().toISOString(), abandonedFrom: record.status }));
    }
    if (record.status === "onramp_pending") {
      return depositStore.save(withHistory(record, { ...record, status: "abandoned", abandonedAt: new Date().toISOString(), abandonedFrom: record.status }));
    }
    throw new DepositError(409, "cannot_cancel", `a deposit that is ${record.status} cannot be abandoned; let it finish`);
  }, () => loadDeposit(id));
}

/**
 * Presenter action: put a deposit back into the pipeline. An abandoned on-ramp
 * goes back to waiting for the anchor. An amount-mismatch failure goes back to
 * `onramp_paid`, so the next poll submits the pre-authorized forward again:
 * it succeeds once the bridge account holds at least the expected amount (the
 * anchor, or the presenter on the sandbox, topped it up; see the runbook).
 */
export async function resumeDeposit(id: string): Promise<DepositRecord> {
  return withLease(`deposit:${id}`, 30_000, async () => {
    const record = await loadDeposit(id);
    if (record.status === "abandoned" && record.onrampId && record.landing) {
      const resumed: DepositRecord = withHistory(record, { ...record, status: "onramp_pending", attempts: {} });
      delete resumed.abandonedAt;
      delete resumed.abandonedFrom;
      return depositStore.save(resumed);
    }
    if (record.status === "failed" && record.error?.code === "amount_mismatch" && record.landing) {
      const resumed: DepositRecord = withHistory(record, { ...record, status: "onramp_paid", attempts: {} });
      delete resumed.error;
      return depositStore.save(resumed);
    }
    throw new DepositError(409, "cannot_resume", `deposit is ${record.status}; only abandoned on-ramps and amount-mismatch failures can be resumed`);
  }, () => loadDeposit(id));
}

/** Deposits that need a presenter: waiting on the anchor's treasury for more than two minutes, abandoned, or parked by an amount mismatch. */
export async function listStuckDeposits(limit = 10): Promise<DepositRecord[]> {
  const [pending, abandoned, failed] = await Promise.all([
    depositStore.listByStatus<DepositRecord>("onramp_pending", limit),
    depositStore.listByStatus<DepositRecord>("abandoned", limit),
    depositStore.listByStatus<DepositRecord>("failed", 50),
  ]);
  const old = Date.now() - 2 * 60_000;
  return [...pending.filter((d) => Date.parse(d.updatedAt) < old), ...abandoned, ...failed.filter((d) => d.error?.code === "amount_mismatch").slice(0, limit)];
}

export async function recordVaultDeposit(id: string, input: { hash: string; amountUsdc: string; ref?: string | null }): Promise<DepositRecord> {
  if (!/^[0-9a-f]{64}$/.test(input.hash)) throw new DepositError(400, "invalid_hash", "hash must be a 64-hex transaction hash");
  return withLease(`deposit:${id}`, 30_000, async () => {
    const record = await loadDeposit(id);
    if (record.status === "in_vault") return record;
    if (record.status !== "in_wallet") throw new DepositError(409, "not_in_wallet", `deposit is ${record.status}`);
    const next = withHistory(record, { ...record, vaultTxHash: input.hash, vaultDepositUsdc: input.amountUsdc, status: "in_vault" });
    await depositStore.save(next);
    await recordEvent({
      type: "deposit_completed",
      ts: Date.now(),
      network: serverEnv.stellarNetwork(),
      projectId: serverEnv.sembolProjectId(),
      ref: input.ref ?? record.ref ?? null,
      contractId: record.contractId,
      depositId: record.id,
      anchorTx: record.anchorTxHash ?? null,
      forwardTx: record.forwardTxHash ?? null,
      vaultTx: input.hash,
      usdc: input.amountUsdc,
    });
    return next;
  }, () => loadDeposit(id));
}
