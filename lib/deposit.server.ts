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
 * under-funded) keep the status and are retried by the next poll; a paid
 * amount that differs from the quote is a hard failure with the funds left
 * in the ownerless landing account.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { AnchorHttpError, SANDBOX_TEST_IBAN, anchorCall, discoverAnchor } from "./anchor.server";
import { serverEnv } from "./env.server";
import { assertSponsorReady, landingDeps } from "./landing.server";
import { LandingError, createLandingAccount, submitPreauthorized, type LandingPlan } from "./landing/landing";
import { recordEvent } from "./metrics.server";
import { depositStore, getCustomerId, newId, setCustomerId, withLock, type StoredRecord } from "./store.server";

/** The anchor's documented per-order limits (50.00 – 250,000.00 TRY). */
export const DEPOSIT_MIN_TRY = 50;
export const DEPOSIT_MAX_TRY = 250_000;
const MAX_STEP_ATTEMPTS = 6;

export type DepositStatus = "awaiting_transfer" | "transfer_received" | "onramp_pending" | "onramp_paid" | "forwarded" | "in_wallet" | "in_vault" | "failed";
export const FINAL_STATUSES: DepositStatus[] = ["in_vault", "failed"];

export interface DepositRecord extends StoredRecord {
  status: DepositStatus;
  network: string;
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
  lastError?: { at: string; message: string };
  error?: { code: string; message: string };
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

export async function createDeposit(input: { contractId: string; amountTry: string }): Promise<DepositRecord> {
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
  if (err instanceof LandingError) return err.code === "sponsor_underfunded" || err.code === "submit_failed";
  if (err instanceof AnchorHttpError) return err.status >= 500 || err.status === 429;
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

/** Advance the deposit by one step if the world has moved on. Serialized per id. */
export async function advanceDeposit(id: string): Promise<DepositRecord> {
  return withLock(`deposit:${id}`, async () => {
    const record = await depositStore.get<DepositRecord>(id);
    if (!record) throw new DepositError(404, "not_found", "deposit not found");
    if (FINAL_STATUSES.includes(record.status) || record.status === "in_wallet") return record;
    try {
      const next = await step(record);
      if (next !== record) await depositStore.save(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = { ...(record.attempts ?? {}), [record.status]: (record.attempts?.[record.status] ?? 0) + 1 };
      const failed: DepositRecord = { ...record, attempts, lastError: { at: new Date().toISOString(), message } };
      if (!isTransient(err) || attempts[record.status]! >= MAX_STEP_ATTEMPTS) {
        failed.status = "failed";
        failed.error = { code: err instanceof LandingError ? err.code : err instanceof AnchorHttpError ? err.code : "step_failed", message };
      }
      await depositStore.save(failed);
      return failed;
    }
  });
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
      const quote = await anchorCall<AnchorQuote>("POST", "/v1/quotes", { customer_id: record.customerId, side: "buy", amount: amountTry, amount_currency: "TRY" });
      const amountStroops = toStroops(quote.destination_amount);
      const plan = await createLandingAccount(landingDeps(), {
        usdc: new Asset(anchor.usdc.code, anchor.usdc.issuer),
        usdcContract: anchor.usdc.contractId,
        kind: { type: "onramp", destinationContract: record.contractId, amountStroops },
      });
      if (Date.now() > Date.parse(quote.expires_at)) throw new Error("quote expired while the landing account was being prepared");
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

export async function recordVaultDeposit(id: string, input: { hash: string; amountUsdc: string; ref?: string | null }): Promise<DepositRecord> {
  if (!/^[0-9a-f]{64}$/.test(input.hash)) throw new DepositError(400, "invalid_hash", "hash must be a 64-hex transaction hash");
  return withLock(`deposit:${id}`, async () => {
    const record = await depositStore.get<DepositRecord>(id);
    if (!record) throw new DepositError(404, "not_found", "deposit not found");
    if (record.status === "in_vault") return record;
    if (record.status !== "in_wallet") throw new DepositError(409, "not_in_wallet", `deposit is ${record.status}`);
    const next: DepositRecord = { ...record, vaultTxHash: input.hash, vaultDepositUsdc: input.amountUsdc, status: "in_vault" };
    await depositStore.save(next);
    await recordEvent({
      type: "deposit_completed",
      ts: Date.now(),
      network: serverEnv.stellarNetwork(),
      projectId: serverEnv.sembolProjectId(),
      ref: input.ref ?? null,
      contractId: record.contractId,
      depositId: record.id,
      anchorTx: record.anchorTxHash ?? null,
      forwardTx: record.forwardTxHash ?? null,
      vaultTx: input.hash,
      usdc: input.amountUsdc,
    });
    return next;
  });
}
