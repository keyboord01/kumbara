/**
 * Withdrawal pipeline (OFFRAMP_MODE=landing), advanced one step per poll:
 *
 *   created        → anchor off-ramp exists (treasury + memo id); the next poll
 *                    builds the reverse landing account (pre-authorized payment
 *                    to the treasury with the memo, plus cleanup)
 *   awaiting_usdc  → the browser withdraws from the vault and pays the landing
 *                    account (two passkey approvals) and reports the hashes
 *   usdc_sent      → landing balance verified; pre-authorized payment relayed
 *   paid           → waiting for the anchor to match the memo and pay out TRY
 *   completed      → payout done, cleanup relayed, counter event recorded
 *   failed
 *
 * The spending limit applies to the browser's transfer to the landing
 * account; the vault withdrawal itself moves nothing out of the kumbara.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { AnchorHttpError, anchorCall, discoverAnchor } from "./anchor.server";
import { ensureCustomer } from "./deposit.server";
import { networkPassphrase, serverEnv } from "./env.server";
import { assertSponsorReady, landingDeps } from "./landing.server";
import { LandingError, createLandingAccount, submitPreauthorized, type LandingPlan } from "./landing/landing";
import { recordEvent } from "./metrics.server";
import { newId, withLock, withdrawalStore, type StoredRecord } from "./store.server";
import { readTokenBalance, readVaultPosition } from "./vault";

/** The anchor's documented minimum when an amount is given. */
export const WITHDRAW_MIN_USDC = 1;
const MAX_STEP_ATTEMPTS = 6;
const MAX_WAIT_POLLS = 60;

export type WithdrawalStatus = "created" | "awaiting_usdc" | "usdc_sent" | "paid" | "completed" | "failed";
export const FINAL_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ["completed", "failed"];

export interface WithdrawalRecord extends StoredRecord {
  status: WithdrawalStatus;
  network: string;
  ref: string | null;
  customerId: string;
  amountUsdc: string;
  quote: { tryOut: string; rate: string; spreadBps: number };
  offrampId: string;
  treasury: string;
  memoId: string;
  payoutIban: string | null;
  landing?: LandingPlan;
  vaultTxHash?: string;
  transferTxHash?: string;
  paymentTxHash?: string;
  paymentVia?: string;
  cleanupTxHash?: string;
  cleanupVia?: string;
  cleanupError?: string;
  receivedUsdc?: string;
  amountTry?: string;
  payoutId?: string;
  waitPolls?: number;
  attempts?: Partial<Record<WithdrawalStatus, number>>;
  lastError?: { at: string; message: string };
  error?: { code: string; message: string };
}

interface AnchorQuote {
  id: string;
  rate: string;
  spread_bps: number;
  destination_amount: string;
}
interface AnchorOfframp {
  id: string;
  status: "awaiting_deposit" | "completed" | "cancelled";
  expected_usdc: string | null;
  received_usdc: string | null;
  amount_try: string | null;
  rate: string;
  deposit: { address: string; memo_type: string; memo: string };
  payout_iban: string | null;
  payout_id: string | null;
  failure_reason?: string | null;
}

export class WithdrawError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WithdrawError";
  }
}

const toStroops = (amount: string): bigint => {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
};
const fromStroops = (stroops: bigint): string => `${stroops / 10_000_000n}.${(stroops % 10_000_000n).toString().padStart(7, "0")}`;

function isContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}

export async function quoteWithdrawal(contractId: string, amountUsdc: string): Promise<{ tryOut: string; rate: string; spreadBps: number }> {
  if (!isContractId(contractId)) throw new WithdrawError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,7})?$/.test(amountUsdc) || Number(amountUsdc) < WITHDRAW_MIN_USDC) {
    throw new WithdrawError(422, "amount_too_small", `amount must be at least ${WITHDRAW_MIN_USDC} USDC`);
  }
  const customerId = await ensureCustomer(contractId);
  const quote = await anchorCall<AnchorQuote>("POST", "/v1/quotes", { customer_id: customerId, side: "sell", amount: fromStroops(toStroops(amountUsdc)), amount_currency: "USDC" });
  return { tryOut: quote.destination_amount, rate: quote.rate, spreadBps: quote.spread_bps };
}

export async function createWithdrawal(input: { contractId: string; amountUsdc: string; ref?: string | null }): Promise<WithdrawalRecord> {
  if (!isContractId(input.contractId)) throw new WithdrawError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,7})?$/.test(input.amountUsdc)) throw new WithdrawError(400, "invalid_amount", "amountUsdc must be a decimal with up to 7 digits");
  const amountStroops = toStroops(input.amountUsdc);
  const amount = fromStroops(amountStroops);
  if (Number(amount) < WITHDRAW_MIN_USDC) throw new WithdrawError(422, "amount_too_small", `amount must be at least ${WITHDRAW_MIN_USDC} USDC`);
  const position = await readVaultPosition(serverEnv.stellarRpcUrl(), networkPassphrase(), serverEnv.defindexVaultId(), input.contractId);
  if (position.usdc < amountStroops) {
    throw new WithdrawError(422, "insufficient_vault_balance", `the kumbara holds ${fromStroops(position.usdc)} USDC in the vault`);
  }
  const customerId = await ensureCustomer(input.contractId);
  const [quote, offramp] = await Promise.all([
    anchorCall<AnchorQuote>("POST", "/v1/quotes", { customer_id: customerId, side: "sell", amount, amount_currency: "USDC" }),
    anchorCall<AnchorOfframp>("POST", "/v1/offramps", { customer_id: customerId, amount_usdc: amount, auto_payout: true }),
  ]);
  const now = new Date().toISOString();
  const record: WithdrawalRecord = {
    id: newId("wdr"),
    contractId: input.contractId,
    customerId,
    network: serverEnv.stellarNetwork(),
    ref: input.ref ?? null,
    status: "created",
    amountUsdc: amount,
    quote: { tryOut: quote.destination_amount, rate: offramp.rate ?? quote.rate, spreadBps: quote.spread_bps },
    offrampId: offramp.id,
    treasury: offramp.deposit.address,
    memoId: offramp.deposit.memo,
    payoutIban: offramp.payout_iban,
    createdAt: now,
    updatedAt: now,
  };
  await withdrawalStore.save(record);
  return record;
}

export async function listWithdrawals(contractId: string): Promise<WithdrawalRecord[]> {
  return withdrawalStore.list<WithdrawalRecord>(contractId);
}

function isTransient(err: unknown): boolean {
  if (err instanceof LandingError) return err.code === "sponsor_underfunded" || err.code === "submit_failed";
  if (err instanceof AnchorHttpError) return err.status >= 500 || err.status === 429;
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

export async function advanceWithdrawal(id: string): Promise<WithdrawalRecord> {
  return withLock(`withdrawal:${id}`, async () => {
    const record = await withdrawalStore.get<WithdrawalRecord>(id);
    if (!record) throw new WithdrawError(404, "not_found", "withdrawal not found");
    if (FINAL_WITHDRAWAL_STATUSES.includes(record.status) || record.status === "awaiting_usdc") return record;
    try {
      const next = await step(record);
      if (next !== record) await withdrawalStore.save(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = { ...(record.attempts ?? {}), [record.status]: (record.attempts?.[record.status] ?? 0) + 1 };
      const failed: WithdrawalRecord = { ...record, attempts, lastError: { at: new Date().toISOString(), message } };
      if (!isTransient(err) || attempts[record.status]! >= MAX_STEP_ATTEMPTS) {
        failed.status = "failed";
        failed.error = { code: err instanceof LandingError ? err.code : err instanceof AnchorHttpError ? err.code : "step_failed", message };
      }
      await withdrawalStore.save(failed);
      return failed;
    }
  });
}

async function step(record: WithdrawalRecord): Promise<WithdrawalRecord> {
  switch (record.status) {
    case "created": {
      await assertSponsorReady();
      const anchor = await discoverAnchor();
      const plan = await createLandingAccount(landingDeps(), {
        usdc: new Asset(anchor.usdc.code, anchor.usdc.issuer),
        usdcContract: anchor.usdc.contractId,
        kind: { type: "offramp", treasury: record.treasury, memoId: record.memoId, amountStroops: toStroops(record.amountUsdc) },
      });
      return { ...record, landing: plan, status: "awaiting_usdc" };
    }
    case "usdc_sent": {
      if (!record.landing) throw new Error("landing plan missing");
      const anchor = await discoverAnchor();
      const balance = await readTokenBalance(serverEnv.stellarRpcUrl(), networkPassphrase(), anchor.usdc.contractId, record.landing.publicKey);
      if (balance < toStroops(record.amountUsdc)) {
        const waitPolls = (record.waitPolls ?? 0) + 1;
        if (waitPolls > MAX_WAIT_POLLS) {
          return { ...record, waitPolls, status: "failed", error: { code: "usdc_not_received", message: `landing account ${record.landing.publicKey} never received ${record.amountUsdc} USDC` } };
        }
        return { ...record, waitPolls, lastError: { at: new Date().toISOString(), message: `waiting for ${record.amountUsdc} USDC on the landing account (has ${fromStroops(balance)})` } };
      }
      const payment = await submitPreauthorized(landingDeps(), record.landing.forwardTxXdr);
      return { ...record, paymentTxHash: payment.hash, paymentVia: payment.via, status: "paid" };
    }
    case "paid": {
      const offramp = await anchorCall<AnchorOfframp>("GET", `/v1/offramps/${record.offrampId}`);
      if (offramp.status === "awaiting_deposit") {
        const waitPolls = (record.waitPolls ?? 0) + 1;
        if (waitPolls > MAX_WAIT_POLLS * 2) {
          return { ...record, waitPolls, status: "failed", error: { code: "anchor_not_matched", message: "the anchor did not match the payment; check /v1/sandbox/unmatched-deposits" } };
        }
        return { ...record, waitPolls };
      }
      if (offramp.status === "cancelled") {
        return { ...record, status: "failed", error: { code: "offramp_cancelled", message: offramp.failure_reason ?? "the anchor cancelled the off-ramp" } };
      }
      let cleanup: { hash: string; via: string } | null = null;
      let cleanupError: string | undefined;
      if (record.landing) {
        try {
          cleanup = await submitPreauthorized(landingDeps(), record.landing.cleanupTxXdr);
        } catch (err) {
          cleanupError = err instanceof Error ? err.message : String(err);
        }
      }
      const done: WithdrawalRecord = {
        ...record,
        receivedUsdc: offramp.received_usdc ?? undefined,
        amountTry: offramp.amount_try ?? undefined,
        payoutId: offramp.payout_id ?? undefined,
        status: "completed",
      } as WithdrawalRecord;
      if (cleanup) {
        done.cleanupTxHash = cleanup.hash;
        done.cleanupVia = cleanup.via;
      }
      if (cleanupError) done.cleanupError = cleanupError;
      await recordEvent({
        type: "withdrawal_completed",
        ts: Date.now(),
        network: serverEnv.stellarNetwork(),
        projectId: serverEnv.sembolProjectId(),
        ref: record.ref,
        contractId: record.contractId,
        withdrawalId: record.id,
        vaultTx: record.vaultTxHash ?? null,
        paymentTx: record.paymentTxHash ?? null,
        usdc: record.amountUsdc,
        try: offramp.amount_try,
      });
      return done;
    }
    default:
      return record;
  }
}

/** The browser reports its two passkey-signed transactions. */
export async function recordUsdcSent(id: string, input: { vaultTx: string; transferTx: string }): Promise<WithdrawalRecord> {
  for (const [name, value] of Object.entries(input)) {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new WithdrawError(400, "invalid_hash", `${name} must be a 64-hex transaction hash`);
  }
  return withLock(`withdrawal:${id}`, async () => {
    const record = await withdrawalStore.get<WithdrawalRecord>(id);
    if (!record) throw new WithdrawError(404, "not_found", "withdrawal not found");
    if (record.status !== "awaiting_usdc") return record;
    const next: WithdrawalRecord = { ...record, vaultTxHash: input.vaultTx, transferTxHash: input.transferTx, status: "usdc_sent" };
    await withdrawalStore.save(next);
    return next;
  });
}
