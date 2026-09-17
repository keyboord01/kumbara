/**
 * Deposit pipeline (ONRAMP_MODE=landing), advanced one step per poll so it
 * runs inside ordinary request handlers:
 *
 *   awaiting_transfer  → SEP-6 transaction open; the anchor waits for the lira
 *   transfer_received  → the anchor saw the transfer and is paying the bridge
 *   onramp_pending     → still paying (anchor-side statuses in flight)
 *   onramp_paid        → paid the exact quoted amount; pre-authorized forward
 *                        (USDC → smart account) via relay
 *   forwarded          → pre-authorized cleanup (merge bridge into sponsor)
 *   in_wallet          → the browser deposits into the vault with the passkey
 *   in_vault           → done
 *
 * The anchor conversation (SEP-10, SEP-12, SEP-38, SEP-6) happens inside the
 * bridge account's pre-lock hook, so the quote and the pre-authorized forward
 * always agree. Every step is idempotent against the stored record and
 * serialized per deposit id. Transient failures (anchor or relay unreachable,
 * sponsor under-funded) keep the status and are retried by the next poll; a
 * paid amount that differs from the quote is a hard failure with the funds
 * left in the ownerless bridge account. Each transition is appended to
 * `history` for the public timing metrics.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { SANDBOX_TEST_IBAN, discoverAnchor, type AnchorDiscovery } from "./anchor.server";
import { SepError, fiatAsset, sep10Authenticate, sep12AnswerForTransaction, sep12Register, sep38Quote, sep6Deposit, sep6DepositExchange, sep6Transaction, stellarAsset, type Sep6DepositResponse } from "./sep.server";
import { serverEnv } from "./env.server";
import { assertSponsorReady, landingDeps } from "./landing.server";
import { LandingError, createLandingAccount, submitPreauthorized, type LandingPlan } from "./landing/landing";
import { recordEvent } from "./metrics.server";
import { depositStore, newId, withLease, type StoredRecord } from "./store.server";

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
  /** The bridge account: it is the anchor's SEP-12 customer. */
  customerId: string;
  /** Which anchor this deposit runs on. Records without it predate the SEP-6 path and can no longer progress. */
  anchor?: { homeDomain: string; fiatCode: string };
  /** SEP-6 state: the anchor's transaction id and the bridge account's SEP-10 token, a bearer for that throwaway account only. */
  sep6?: { id: string; transferServer: string; token: string; tokenExpiresAt: number; quoteId: string; moreInfoUrl?: string; lastStatus?: string };
  amountTry: string;
  receivedTry?: string;
  indicative: { quoteId: string; usdcOut: string; rate: string; spreadBps: number; expiresAt: string };
  firmQuote?: { quoteId: string; usdcOut: string; rate: string; expiresAt: string };
  instructions: { bankName: string; iban: string; ibanFormatted: string; accountHolder: string; reference: string; rails: string[]; bankNumber?: string };
  landing?: LandingPlan;
  anchorTxHash?: string;
  paidUsdc?: string;
  forwardTxHash?: string;
  forwardVia?: string;
  cleanupTxHash?: string;
  cleanupVia?: string;
  cleanupError?: string;
  /** Deposit cancelled before any lira moved: the abort envelope merged the bridge back. */
  abortTxHash?: string;
  vaultTxHash?: string;
  vaultDepositUsdc?: string;
  attempts?: Partial<Record<DepositStatus, number>>;
  lastError?: { at: string; message: string; code?: string };
  error?: { code: string; message: string };
  /** Set when the user abandoned a deposit the anchor still owes; a presenter can resume it. */
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

/**
 * Per-deposit limits in the anchor's fiat: published by the anchor when it
 * states them, else derived from its SEP-6 asset limits at its own price
 * (see discovery). The asset limits are checked again against the firm quote
 * at request time, and the anchor's own answer is final either way.
 */
export function depositLimits(anchor: AnchorDiscovery): { minFiat: number | null; maxFiat: number | null; minAsset: number | null; maxAsset: number | null; fiatCode: string | null } {
  return { minFiat: anchor.limits.fiat?.min ?? null, maxFiat: anchor.limits.fiat?.max ?? null, minAsset: anchor.limits.deposit.min, maxAsset: anchor.limits.deposit.max, fiatCode: anchor.fiatCode };
}

export async function createDeposit(input: { contractId: string; amountTry: string; ref?: string | null }): Promise<DepositRecord> {
  if (!isContractId(input.contractId)) throw new DepositError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,2})?$/.test(input.amountTry)) throw new DepositError(400, "invalid_amount", "amountTry must be a decimal with up to 2 digits");
  const amount = fromCents(toCents(input.amountTry));
  const value = Number(amount);
  if (!(value > 0)) throw new DepositError(422, "amount_out_of_range", "amount must be positive");
  const anchor = await discoverAnchor();
  const limits = depositLimits(anchor);
  const fiat = limits.fiatCode ?? "";
  if (limits.minFiat !== null && value < limits.minFiat) throw new DepositError(422, "amount_out_of_range", `amount below the anchor's minimum (${limits.minFiat} ${fiat})`);
  if (limits.maxFiat !== null && value > limits.maxFiat) throw new DepositError(422, "amount_out_of_range", `amount above the anchor's maximum (${limits.maxFiat} ${fiat})`);
  return createSep6Deposit(input, amount, anchor);
}

function formatIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** The SEP-6 `instructions` object, whatever the anchor calls its fields, into the shape the Deposit screen renders. */
function mapSep6Instructions(dep: Sep6DepositResponse, anchor: AnchorDiscovery): DepositRecord["instructions"] {
  const find = (test: (key: string) => boolean): string | undefined => Object.entries(dep.instructions).find(([k]) => test(k))?.[1]?.value;
  const iban = find((k) => /iban|account_number/i.test(k)) ?? "";
  const bankName = find((k) => /bank_name/i.test(k)) ?? anchor.orgName ?? anchor.homeDomain;
  const accountHolder = find((k) => /holder|beneficiary|recipient/i.test(k)) ?? anchor.orgName ?? anchor.homeDomain;
  const reference = find((k) => /memo|reference/i.test(k)) ?? dep.id;
  const bankNumber = find((k) => /bank_number|routing|swift|bic/i.test(k));
  const out: DepositRecord["instructions"] = { bankName, iban, ibanFormatted: formatIban(iban), accountHolder, reference, rails: anchor.sep6?.deposit?.fundingMethods ?? [] };
  if (bankNumber) out.bankNumber = bankNumber;
  return out;
}

/** SEP errors at request time become API errors the Deposit screen can classify. */
function sepToDepositError(err: unknown): never {
  console.warn(`[kumbara] deposit request failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  if (err instanceof SepError) {
    if (err.transient) throw new DepositError(503, "anchor_unreachable", err.message);
    if (err.sep === "sep10") throw new DepositError(502, "anchor_auth_failed", err.message);
    if (/amount|too_small|too_large|minimum|maximum|min_amount|max_amount/i.test(err.message)) throw new DepositError(422, "amount_out_of_range", err.message);
    throw new DepositError(502, "anchor_rejected", err.message);
  }
  if (err instanceof LandingError && err.code === "sponsor_underfunded") throw new DepositError(503, "sponsor_underfunded", err.message);
  // The bridge is built in the request path now; a Horizon or relay hiccup while building it is retryable, not a server fault.
  if (err instanceof LandingError) throw new DepositError(503, "bridge_failed", err.message);
  if (err instanceof DepositError) throw err;
  // Everything else in the request path is a call to Horizon, the relay or the anchor; whatever it threw, the user can retry.
  throw new DepositError(503, "bridge_failed", err instanceof Error ? err.message : String(err));
}

/** The customer as the anchor sees it: a name derived from the kumbara and the sandbox IBAN (Kumbara collects no bank details). */
function kycBase(contractId: string): Record<string, string> {
  return { first_name: "Kumbara", last_name: contractId.slice(-6), bank_account_number: SANDBOX_TEST_IBAN };
}

/**
 * SEP-6 deposit: the bridge account is created first, authenticates with SEP-10
 * while it still holds its key, registers with SEP-12, takes a firm SEP-38
 * quote for the exact fiat amount and opens the SEP-6 deposit-exchange with
 * that quote, all before the lock. The forward is pre-authorized for the
 * quoted USDC and an abort envelope returns the reserves if no lira ever comes.
 */
async function createSep6Deposit(input: { contractId: string; amountTry: string; ref?: string | null }, amount: string, anchor: AnchorDiscovery): Promise<DepositRecord> {
  await assertSponsorReady().catch(sepToDepositError);
  if (!anchor.sep6?.deposit?.enabled) throw new DepositError(503, "anchor_no_sep6", `${anchor.homeDomain} offers no SEP-6 deposit for ${anchor.usdc.code}`);
  if (!anchor.fiatCode) throw new DepositError(503, "anchor_no_fiat", `${anchor.homeDomain} names no fiat asset in its stellar.toml or SEP-38 info`);
  const fundingMethod = anchor.sep6.deposit.fundingMethods[0] ?? "bank_account";
  // A firm quote names a SEP-38 delivery method; the SEP-6 `type` is the anchor's funding method. They coincide on the TR Mock Anchor and differ on testanchor.
  const quoteMethod = anchor.sep38?.sellDeliveryMethods.includes(fundingMethod) ? fundingMethod : (anchor.sep38?.sellDeliveryMethods[0] ?? fundingMethod);
  const withExchange = anchor.sep6.depositExchange && Boolean(anchor.endpoints.ANCHOR_QUOTE_SERVER);
  const fiat = fiatAsset(anchor.fiatCode);
  const assetLimits = anchor.limits.deposit;
  const checkAssetLimits = (usdcOut: string): void => {
    const out = Number(usdcOut);
    if (assetLimits.min !== null && out < assetLimits.min) throw new SepError("sep6", 422, "too_small", `amount below the anchor's minimum (${assetLimits.min} ${anchor.usdc.code}; this deposit buys ${usdcOut})`);
    if (assetLimits.max !== null && out > assetLimits.max) throw new SepError("sep6", 422, "too_large", `amount above the anchor's maximum (${assetLimits.max} ${anchor.usdc.code}; this deposit buys ${usdcOut})`);
  };
  // Anchors that state their KYC fields per transaction (testanchor) attach the bank instructions only once those are in,
  // and only if the answer lands before their own check runs, about two seconds after the request; a later answer parks the
  // transaction in pending_customer_info_update for good. So it is sent here, inside the hook, before the lock takes its seconds.
  const answerTransactionKyc = async (token: string, dep: Sep6DepositResponse): Promise<void> => {
    if (Object.keys(dep.instructions).length > 0 || serverEnv.stellarNetwork() !== "testnet") return;
    const sent = await sep12AnswerForTransaction(anchor, token, dep.id, kycBase(input.contractId)).catch((err: unknown) => {
      console.warn(`[kumbara] sep12 answer for ${dep.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      return [] as string[];
    });
    console.info(`[kumbara] sep12 answered for ${dep.id}: ${sent.length ? sent.join(",") : "nothing sent"}`);
  };
  let captured: { token: string; tokenExpiresAt: number; quoteId: string; usdcOut: string; price: string; expiresAt: string; dep: Sep6DepositResponse } | null = null;
  let plan: LandingPlan;
  try {
    plan = await createLandingAccount(landingDeps(), {
      usdc: new Asset(anchor.usdc.code, anchor.usdc.issuer),
      usdcContract: anchor.usdc.contractId,
      abortable: true,
      beforeLock: async (bridge) => {
        const auth = await sep10Authenticate(anchor, bridge.publicKey, bridge.sign);
        // Only the base fields here. Anchors that ask for more do so per transaction (testanchor), and answering
        // before the request exists parks that transaction; the per-transaction answer below covers it.
        await sep12Register(anchor, auth.token, kycBase(input.contractId));
        if (withExchange) {
          const quote = await sep38Quote(anchor, auth.token, { sellAsset: fiat, buyAsset: stellarAsset(anchor.usdc.code, anchor.usdc.issuer), sellAmount: amount, deliveryMethod: quoteMethod, side: "buy" });
          checkAssetLimits(quote.buyAmount);
          const dep = await sep6DepositExchange(anchor, auth.token, { sourceAsset: fiat, destinationAssetCode: anchor.usdc.code, amount, quoteId: quote.id, account: bridge.publicKey, type: fundingMethod });
          await answerTransactionKyc(auth.token, dep);
          captured = { token: auth.token, tokenExpiresAt: auth.expiresAt, quoteId: quote.id, usdcOut: quote.buyAmount, price: quote.price, expiresAt: quote.expiresAt, dep };
          return { type: "onramp", destinationContract: input.contractId, amountStroops: toStroops(quote.buyAmount) };
        }
        // No exchange endpoint: a plain SEP-6 deposit, amount in the asset, one to one with the fiat entered.
        checkAssetLimits(amount);
        const dep = await sep6Deposit(anchor, auth.token, { assetCode: anchor.usdc.code, amount, account: bridge.publicKey, type: fundingMethod });
        await answerTransactionKyc(auth.token, dep);
        captured = { token: auth.token, tokenExpiresAt: auth.expiresAt, quoteId: "", usdcOut: amount, price: "1", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), dep };
        return { type: "onramp", destinationContract: input.contractId, amountStroops: toStroops(amount) };
      },
    });
  } catch (err) {
    sepToDepositError(err);
  }
  const got = captured as { token: string; tokenExpiresAt: number; quoteId: string; usdcOut: string; price: string; expiresAt: string; dep: Sep6DepositResponse } | null;
  if (!got) throw new DepositError(500, "internal", "the anchor conversation left no quote");
  if (Object.keys(got.dep.instructions).length === 0) {
    // The instructions arrive on the transaction a few seconds after the per-transaction KYC answer. Bounded: the pipeline keeps polling and fills them in later otherwise.
    for (let i = 0; i < 6 && Object.keys(got.dep.instructions).length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, i === 0 ? 600 : 1200));
      const tx = await sep6Transaction(anchor, got.token, got.dep.id).catch(() => null);
      if (tx?.instructions && Object.keys(tx.instructions).length > 0) got.dep.instructions = tx.instructions;
    }
  }
  const spreadBps = Math.round((anchor.sep6.deposit.feePercent ?? 0) * 100);
  const now = new Date().toISOString();
  const sep6: NonNullable<DepositRecord["sep6"]> = { id: got.dep.id, transferServer: anchor.endpoints.TRANSFER_SERVER ?? "", token: got.token, tokenExpiresAt: got.tokenExpiresAt, quoteId: got.quoteId, lastStatus: "pending_user_transfer_start" };
  if (got.dep.moreInfoUrl) sep6.moreInfoUrl = got.dep.moreInfoUrl;
  const record: DepositRecord = {
    id: newId("dep"),
    contractId: input.contractId,
    customerId: plan.publicKey,
    anchor: { homeDomain: anchor.homeDomain, fiatCode: anchor.fiatCode },
    sep6,
    network: serverEnv.stellarNetwork(),
    ref: input.ref ?? null,
    status: "awaiting_transfer",
    amountTry: amount,
    indicative: { quoteId: got.quoteId, usdcOut: got.usdcOut, rate: got.price, spreadBps, expiresAt: got.expiresAt },
    firmQuote: { quoteId: got.quoteId, usdcOut: got.usdcOut, rate: got.price, expiresAt: got.expiresAt },
    instructions: mapSep6Instructions(got.dep, anchor),
    landing: plan,
    createdAt: now,
    updatedAt: now,
    transferDeadline: new Date(Date.now() + transferTimeoutMinutes() * 60_000).toISOString(),
    history: [{ status: "awaiting_transfer", at: now }],
  };
  await depositStore.save(record);
  return record;
}

/** SEP-6 statuses that mean the lira arrived and the anchor is working. Info-update statuses are still "before the transfer". */
const SEP6_IN_FLIGHT = new Set(["pending_anchor", "pending_external", "pending_stellar", "pending_user_transfer_complete"]);
const SEP6_BEFORE_TRANSFER = new Set(["pending_user_transfer_start", "incomplete", "pending_customer_info_update", "pending_transaction_info_update", "pending_user"]);
const SEP6_FINAL_FAILURES = new Set(["error", "expired", "refunded", "no_market", "too_small", "too_large"]);

/** One poll of the anchor's SEP-6 transaction for a waiting deposit. */
async function pollSep6Deposit(record: DepositRecord): Promise<DepositRecord> {
  if (!record.sep6 || !record.landing || !record.anchor) throw new Error("sep6 state missing");
  if (Date.now() / 1000 > record.sep6.tokenExpiresAt) throw new StepError("anchor_auth_expired", "the bridge account's SEP-10 token expired before the anchor settled; the key is gone, so this deposit cannot be polled any more");
  const anchor = await discoverAnchor(record.anchor.homeDomain);
  const tx = await sep6Transaction(anchor, record.sep6.token, record.sep6.id);
  const seen: DepositRecord = tx.status === record.sep6.lastStatus ? record : { ...record, sep6: { ...record.sep6, lastStatus: tx.status } };
  if (SEP6_BEFORE_TRANSFER.has(tx.status)) {
    if (tx.instructions && Object.keys(tx.instructions).length > 0 && !record.instructions.iban) return { ...seen, instructions: mapSep6Instructions({ id: record.sep6.id, instructions: tx.instructions, raw: tx.raw }, anchor) };
    if (tx.status === "pending_customer_info_update" && serverEnv.stellarNetwork() === "testnet" && (record.attempts?.awaiting_transfer ?? 0) < 3) {
      // A sandbox anchor asking for more KYC on this transaction: answer from the fixture, once per poll, a few times at most.
      const sent = await sep12AnswerForTransaction(anchor, record.sep6.token, record.sep6.id, kycBase(record.contractId)).catch(() => []);
      if (sent.length > 0) return { ...seen, attempts: { ...(record.attempts ?? {}), awaiting_transfer: (record.attempts?.awaiting_transfer ?? 0) + 1 } };
    }
    return seen;
  }
  if (tx.status === "pending_trust") {
    return { ...seen, status: "failed", error: { code: "pending_trust", message: `the anchor is waiting for a ${anchor.usdc.code} trustline on ${record.landing.publicKey}, which has existed since the account was created; the anchor's trustline check is wrong` } };
  }
  if (SEP6_FINAL_FAILURES.has(tx.status)) {
    return { ...seen, status: "failed", error: { code: `sep6_${tx.status}`, message: tx.message ?? `the anchor reported ${tx.status}` } };
  }
  if (tx.status === "completed") {
    const paid = tx.amountOut ?? "0";
    const next: DepositRecord = { ...seen, paidUsdc: paid, receivedTry: tx.amountIn ?? seen.receivedTry ?? seen.amountTry };
    if (tx.stellarTransactionId) next.anchorTxHash = tx.stellarTransactionId;
    if (toStroops(paid) !== BigInt(record.landing.amountStroops)) {
      return { ...next, status: "failed", error: { code: "amount_mismatch", message: `anchor paid ${paid} ${anchor.usdc.code} but the pre-authorized forward is for ${record.firmQuote?.usdcOut}; funds are parked in landing account ${record.landing.publicKey}` } };
    }
    return { ...next, status: "onramp_paid" };
  }
  if (SEP6_IN_FLIGHT.has(tx.status)) {
    if (record.status === "awaiting_transfer") return { ...seen, receivedTry: tx.amountIn ?? seen.amountTry, status: "transfer_received" };
    if (record.status === "transfer_received") return { ...seen, status: "onramp_pending" };
    return seen;
  }
  return seen;
}

export async function getDeposit(id: string): Promise<DepositRecord | null> {
  return depositStore.get<DepositRecord>(id);
}

export async function listDeposits(contractId: string): Promise<DepositRecord[]> {
  return depositStore.list<DepositRecord>(contractId);
}

function isTransient(err: unknown): boolean {
  if (err instanceof StepError) return err.transient;
  if (err instanceof SepError) return err.transient;
  if (err instanceof LandingError) return err.code === "sponsor_underfunded" || err.code === "submit_failed";
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

function errorCode(err: unknown): string {
  if (err instanceof SepError) return `${err.sep}_${err.code}`;
  if (err instanceof StepError || err instanceof LandingError) return err.code;
  return "step_failed";
}

/** Lease TTL for one pipeline step; a crashed invocation frees the record after this. */
const STEP_LEASE_MS = 110_000;
/** The browser's reports wait this long for a poll to release the record instead of being dropped. */
const REPORT_LEASE_WAIT_MS = 20_000;
/** An action that still finds the lease held after waiting says so instead of pretending nothing happened. */
async function leaseHeld(id: string): Promise<never> {
  throw new DepositError(409, "lease_held", `another step is running on deposit ${id} right now; try again in a few seconds`);
}

export async function loadDeposit(id: string): Promise<DepositRecord> {
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
    case "awaiting_transfer":
    case "transfer_received":
    case "onramp_pending": {
      if (!record.sep6) throw new StepError("anchor_path_gone", "this deposit was opened on the anchor's former Partner API, which no longer exists; start a new deposit");
      return pollSep6Deposit(record);
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
 * it is simply cancelled and the bridge is merged back. Once the anchor is
 * working on the transfer, the record is kept whole (transaction id, landing
 * plan) as `abandoned`: the anchor will still pay the bridge account when it
 * can, and a presenter can resume the record from the console. Funds that
 * are already moving (paid, forwarded, in the wallet) cannot be abandoned.
 */
export async function cancelDeposit(id: string): Promise<DepositRecord> {
  return withLease(`deposit:${id}`, 30_000, async () => {
    const record = await loadDeposit(id);
    if (FINAL_STATUSES.includes(record.status)) return record;
    if (record.status === "awaiting_transfer" || record.status === "transfer_received") {
      const cancelled: DepositRecord = { ...record, status: "cancelled", abandonedAt: new Date().toISOString(), abandonedFrom: record.status };
      if (record.status === "awaiting_transfer" && record.landing?.abortTxXdr) {
        // No lira moved: merge the bridge back so the sponsor's reserves return. Best effort; the next attempt can retry from the console.
        try {
          const abort = await submitPreauthorized(landingDeps(), record.landing.abortTxXdr);
          cancelled.abortTxHash = abort.hash;
        } catch (err) {
          cancelled.cleanupError = err instanceof Error ? err.message : String(err);
        }
      }
      return depositStore.save(withHistory(record, cancelled));
    }
    if (record.status === "onramp_pending") {
      return depositStore.save(withHistory(record, { ...record, status: "abandoned", abandonedAt: new Date().toISOString(), abandonedFrom: record.status }));
    }
    throw new DepositError(409, "cannot_cancel", `a deposit that is ${record.status} cannot be abandoned; let it finish`);
  }, () => leaseHeld(id), REPORT_LEASE_WAIT_MS);
}

/**
 * Presenter action: put a deposit back into the pipeline. An abandoned
 * transaction goes back to waiting for the anchor. An amount-mismatch failure
 * goes back to `onramp_paid`, so the next poll submits the pre-authorized
 * forward again: it succeeds once the bridge account holds at least the
 * expected amount (the anchor, or the presenter on the sandbox, topped it up;
 * see the runbook).
 */
export async function resumeDeposit(id: string): Promise<DepositRecord> {
  return withLease(`deposit:${id}`, 30_000, async () => {
    const record = await loadDeposit(id);
    if (record.status === "abandoned" && record.sep6 && record.landing) {
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
    throw new DepositError(409, "cannot_resume", `deposit is ${record.status}; only abandoned transactions and amount-mismatch failures can be resumed`);
  }, () => leaseHeld(id), REPORT_LEASE_WAIT_MS);
}

/** Deposits that need a presenter: waiting on the anchor for more than two minutes, abandoned, or parked by an amount mismatch. */
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
  }, () => loadDeposit(id), REPORT_LEASE_WAIT_MS);
}
