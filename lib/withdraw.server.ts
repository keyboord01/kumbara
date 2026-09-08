/**
 * Withdrawal pipeline (OFFRAMP_MODE=landing), advanced one step per poll:
 *
 *   created        → indicative SEP-38 price shown; the next poll builds the
 *                    reverse bridge account, which authenticates (SEP-10),
 *                    registers (SEP-12), takes a firm quote (SEP-38) and opens
 *                    the SEP-6 withdraw-exchange before it is locked, so its
 *                    pre-authorized payment carries the anchor's account and memo
 *   awaiting_usdc  → the browser withdraws from the vault and pays the bridge
 *                    account (two passkey approvals) and reports the hashes
 *   usdc_sent      → bridge balance verified; pre-authorized payment relayed
 *   paid           → waiting for the anchor to match the memo and pay out TRY
 *   completed      → payout done, cleanup relayed, counter event recorded
 *   failed
 *
 * The spending limit applies to the browser's transfer to the bridge
 * account; the vault withdrawal itself moves nothing out of the kumbara.
 */
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { SANDBOX_TEST_IBAN, discoverAnchor, type AnchorDiscovery } from "./anchor.server";
import { SepError, fiatAsset, sep10Authenticate, sep12Register, sep38Price, sep38Quote, sep6Transaction, sep6WithdrawExchange, stellarAsset } from "./sep.server";
import { networkPassphrase, serverEnv } from "./env.server";
import { assertSponsorReady, landingDeps } from "./landing.server";
import { LandingError, createLandingAccount, submitPreauthorized, type LandingPlan } from "./landing/landing";
import { recordEvent } from "./metrics.server";
import { newId, withLease, withdrawalStore, type StoredRecord } from "./store.server";
import { readTokenBalance, readVaultPosition } from "./vault";

const MAX_STEP_ATTEMPTS = 6;
const MAX_WAIT_POLLS = 60;

export type WithdrawalStatus = "created" | "awaiting_usdc" | "usdc_sent" | "paid" | "completed" | "failed";
export const FINAL_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ["completed", "failed"];

export interface WithdrawalRecord extends StoredRecord {
  status: WithdrawalStatus;
  network: string;
  ref: string | null;
  /** The reverse bridge account once it exists (it is the anchor's SEP-12 customer); "sep6-pending" before that. */
  customerId: string;
  /** Which anchor this withdrawal runs on. Records without it predate the SEP-6 path and can no longer progress. */
  anchor?: { homeDomain: string; fiatCode: string };
  /** SEP-6 state: the anchor's transaction id and the bridge account's SEP-10 token. */
  sep6?: { id: string; token: string; tokenExpiresAt: number; quoteId: string; lastStatus?: string };
  amountUsdc: string;
  /** Lira out and the rate in lira per USDC (SEP-38 states the sell price in USDC per lira; it is inverted here). */
  quote: { tryOut: string; rate: string; spreadBps: number };
  /** The anchor's receiving account and memo, known after the SEP-6 request (bridge step). */
  treasury?: string;
  memoId?: string;
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
  /** Every status transition with its time, for the public timing metrics. */
  history?: Array<{ status: WithdrawalStatus; at: string }>;
}

/** Append a history entry when the status changed. */
function withHistory(previous: WithdrawalRecord, next: WithdrawalRecord): WithdrawalRecord {
  if (next.status === previous.status) return next;
  return { ...next, history: [...(previous.history ?? []), { status: next.status, at: new Date().toISOString() }] };
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

/** SEP-38 states a sell price in units of the sold asset per unit bought (USDC per lira); the app shows lira per USDC. */
function tryPerUsdc(tryAmount: string, usdcAmount: string): string {
  const usdc = Number(usdcAmount);
  return usdc > 0 ? (Number(tryAmount) / usdc).toFixed(6) : "0";
}

/** The anchor's published minimum for a withdrawal, in the asset (SEP-6 /info, raised by its status page when it states one). */
export function withdrawMinimum(anchor: AnchorDiscovery): number {
  return anchor.limits.withdraw.min ?? 0;
}

function sepToWithdrawError(err: unknown): never {
  if (err instanceof SepError) {
    if (err.transient) throw new WithdrawError(503, "anchor_unreachable", err.message);
    if (err.sep === "sep10") throw new WithdrawError(502, "anchor_auth_failed", err.message);
    if (/amount|too_small|too_large|minimum|maximum/i.test(err.message)) throw new WithdrawError(422, "amount_out_of_range", err.message);
    throw new WithdrawError(502, "anchor_rejected", err.message);
  }
  if (err instanceof LandingError && err.code === "sponsor_underfunded") throw new WithdrawError(503, "sponsor_underfunded", err.message);
  if (err instanceof LandingError) throw new WithdrawError(503, "bridge_failed", err.message);
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT|HTTP 50[234]/i.test(err.message)) throw new WithdrawError(503, "bridge_failed", err.message);
  throw err;
}

/** Indicative SEP-38 price for the amount (no authentication, no firm quote yet). */
export async function quoteWithdrawal(contractId: string, amountUsdc: string, known?: AnchorDiscovery): Promise<{ tryOut: string; rate: string; spreadBps: number }> {
  if (!isContractId(contractId)) throw new WithdrawError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,7})?$/.test(amountUsdc)) throw new WithdrawError(400, "invalid_amount", "amountUsdc must be a decimal with up to 7 digits");
  const anchor = known ?? (await discoverAnchor());
  const min = withdrawMinimum(anchor);
  if (Number(amountUsdc) < min) throw new WithdrawError(422, "amount_too_small", `amount must be at least ${min} ${anchor.usdc.code}`);
  if (!anchor.fiatCode || !anchor.sep6?.withdraw?.enabled) throw new WithdrawError(503, "anchor_no_sep6", `${anchor.homeDomain} offers no SEP-6 withdrawal for ${anchor.usdc.code}`);
  const funding = anchor.sep6.withdraw.fundingMethods[0] ?? "bank_account";
  const method = anchor.sep38?.buyDeliveryMethods.includes(funding) ? funding : (anchor.sep38?.buyDeliveryMethods[0] ?? funding);
  try {
    const price = await sep38Price(anchor, { sellAsset: stellarAsset(anchor.usdc.code, anchor.usdc.issuer), buyAsset: fiatAsset(anchor.fiatCode), sellAmount: fromStroops(toStroops(amountUsdc)), deliveryMethod: method, side: "sell" });
    return { tryOut: price.buyAmount, rate: tryPerUsdc(price.buyAmount, price.sellAmount), spreadBps: Math.round((anchor.sep6.withdraw.feePercent ?? 0) * 100) };
  } catch (err) {
    sepToWithdrawError(err);
  }
}

export async function createWithdrawal(input: { contractId: string; amountUsdc: string; ref?: string | null }): Promise<WithdrawalRecord> {
  if (!isContractId(input.contractId)) throw new WithdrawError(400, "invalid_contract", "contractId must be a C… address");
  if (!/^\d+(\.\d{1,7})?$/.test(input.amountUsdc)) throw new WithdrawError(400, "invalid_amount", "amountUsdc must be a decimal with up to 7 digits");
  const amountStroops = toStroops(input.amountUsdc);
  const amount = fromStroops(amountStroops);
  const anchor = await discoverAnchor();
  const min = withdrawMinimum(anchor);
  if (Number(amount) < min) throw new WithdrawError(422, "amount_too_small", `amount must be at least ${min} ${anchor.usdc.code}`);
  if (anchor.limits.withdraw.max !== null && Number(amount) > anchor.limits.withdraw.max) throw new WithdrawError(422, "amount_out_of_range", `amount above the anchor's maximum (${anchor.limits.withdraw.max} ${anchor.usdc.code})`);
  const position = await readVaultPosition(serverEnv.stellarRpcUrl(), networkPassphrase(), serverEnv.defindexVaultId(), input.contractId);
  if (position.usdc < amountStroops) {
    throw new WithdrawError(422, "insufficient_vault_balance", `the kumbara holds ${fromStroops(position.usdc)} USDC in the vault`);
  }
  const indicative = await quoteWithdrawal(input.contractId, amount, anchor);
  const now = new Date().toISOString();
  const record: WithdrawalRecord = {
    id: newId("wdr"),
    contractId: input.contractId,
    customerId: "sep6-pending",
    anchor: { homeDomain: anchor.homeDomain, fiatCode: anchor.fiatCode ?? "TRY" },
    network: serverEnv.stellarNetwork(),
    ref: input.ref ?? null,
    status: "created",
    amountUsdc: amount,
    quote: indicative,
    payoutIban: SANDBOX_TEST_IBAN,
    createdAt: now,
    updatedAt: now,
    history: [{ status: "created", at: now }],
  };
  await withdrawalStore.save(record);
  return record;
}

export async function listWithdrawals(contractId: string): Promise<WithdrawalRecord[]> {
  return withdrawalStore.list<WithdrawalRecord>(contractId);
}

function isTransient(err: unknown): boolean {
  if (err instanceof SepError) return err.transient;
  if (err instanceof LandingError) return err.code === "sponsor_underfunded" || err.code === "submit_failed";
  if (err instanceof Error && /fetch failed|unreachable|timed out|ECONN|ETIMEDOUT/i.test(err.message)) return true;
  return false;
}

const STEP_LEASE_MS = 110_000;
/** The browser's reports wait this long for a poll to release the record instead of being dropped. */
const REPORT_LEASE_WAIT_MS = 20_000;

async function loadWithdrawal(id: string): Promise<WithdrawalRecord> {
  const record = await withdrawalStore.get<WithdrawalRecord>(id);
  if (!record) throw new WithdrawError(404, "not_found", "withdrawal not found");
  return record;
}

/** One step per poll under a database lease; resumable from stored state on any instance. */
export async function advanceWithdrawal(id: string): Promise<WithdrawalRecord> {
  return withLease(`withdrawal:${id}`, STEP_LEASE_MS, async () => {
    const record = await loadWithdrawal(id);
    if (FINAL_WITHDRAWAL_STATUSES.includes(record.status) || record.status === "awaiting_usdc") return record;
    try {
      const next = withHistory(record, await step(record));
      if (next !== record) await withdrawalStore.save(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = { ...(record.attempts ?? {}), [record.status]: (record.attempts?.[record.status] ?? 0) + 1 };
      let failed: WithdrawalRecord = { ...record, attempts, lastError: { at: new Date().toISOString(), message } };
      if (!isTransient(err) || attempts[record.status]! >= MAX_STEP_ATTEMPTS) {
        failed = withHistory(record, { ...failed, status: "failed", error: { code: err instanceof SepError ? `${err.sep}_${err.code}` : err instanceof LandingError ? err.code : "step_failed", message } });
      }
      await withdrawalStore.save(failed);
      return failed;
    }
  }, () => loadWithdrawal(id));
}

async function step(record: WithdrawalRecord): Promise<WithdrawalRecord> {
  switch (record.status) {
    case "created": {
      if (!record.anchor) throw new SepError("sep6", 0, "anchor_path_gone", "this withdrawal was opened on the anchor's former Partner API, which no longer exists; start a new withdrawal");
      await assertSponsorReady();
      return buildSep6ReverseBridge(record);
    }
    case "usdc_sent": {
      if (!record.landing) throw new Error("landing plan missing");
      const anchor = await discoverAnchor(record.anchor?.homeDomain);
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
    case "paid":
      return pollSep6Withdrawal(record);
    default:
      return record;
  }
}

/**
 * SEP-6 reverse bridge: created, authenticated (SEP-10) and registered
 * (SEP-12) before the lock; a firm SEP-38 quote sells the exact USDC for
 * fiat, and SEP-6 withdraw-exchange names the anchor's account and memo the
 * pre-authorized payment is built for.
 */
async function buildSep6ReverseBridge(record: WithdrawalRecord): Promise<WithdrawalRecord> {
  const anchor = await discoverAnchor(record.anchor?.homeDomain);
  if (!anchor.fiatCode || !anchor.sep6?.withdraw?.enabled || !anchor.sep6.withdrawExchange) throw new SepError("sep6", 0, "no_withdraw_exchange", `${anchor.homeDomain} offers no SEP-6 withdraw-exchange for ${anchor.usdc.code}`);
  const method = anchor.sep6.withdraw.fundingMethods[0] ?? "bank_account";
  const quoteMethod = anchor.sep38?.buyDeliveryMethods.includes(method) ? method : (anchor.sep38?.buyDeliveryMethods[0] ?? method);
  const fiat = fiatAsset(anchor.fiatCode);
  const dest = record.payoutIban ?? SANDBOX_TEST_IBAN;
  let captured: { token: string; tokenExpiresAt: number; quoteId: string; tryOut: string; price: string; id: string; accountId: string; memo: string } | null = null;
  const plan = await createLandingAccount(landingDeps(), {
    usdc: new Asset(anchor.usdc.code, anchor.usdc.issuer),
    usdcContract: anchor.usdc.contractId,
    beforeLock: async (bridge) => {
      const auth = await sep10Authenticate(anchor, bridge.publicKey, bridge.sign);
      await sep12Register(anchor, auth.token, { first_name: "Kumbara", last_name: record.contractId.slice(-6), bank_account_number: dest });
      const quote = await sep38Quote(anchor, auth.token, { sellAsset: stellarAsset(anchor.usdc.code, anchor.usdc.issuer), buyAsset: fiat, sellAmount: record.amountUsdc, deliveryMethod: quoteMethod, side: "sell" });
      const wd = await sep6WithdrawExchange(anchor, auth.token, { sourceAssetCode: anchor.usdc.code, destinationAsset: fiat, amount: record.amountUsdc, quoteId: quote.id, account: bridge.publicKey, type: method, dest });
      if (wd.memoType !== "id" || !/^\d+$/.test(wd.memo)) throw new SepError("sep6", 0, "unsupported_memo", `the anchor asks for a ${wd.memoType} memo; the pre-authorized payment carries an id memo`);
      captured = { token: auth.token, tokenExpiresAt: auth.expiresAt, quoteId: quote.id, tryOut: quote.buyAmount, price: tryPerUsdc(quote.buyAmount, quote.sellAmount), id: wd.id, accountId: wd.accountId, memo: wd.memo };
      return { type: "offramp", treasury: wd.accountId, memoId: wd.memo, amountStroops: toStroops(record.amountUsdc) };
    },
  });
  const got = captured as { token: string; tokenExpiresAt: number; quoteId: string; tryOut: string; price: string; id: string; accountId: string; memo: string } | null;
  if (!got) throw new Error("the anchor conversation left no withdrawal");
  return {
    ...record,
    customerId: plan.publicKey,
    sep6: { id: got.id, token: got.token, tokenExpiresAt: got.tokenExpiresAt, quoteId: got.quoteId },
    treasury: got.accountId,
    memoId: got.memo,
    quote: { tryOut: got.tryOut, rate: got.price, spreadBps: record.quote.spreadBps },
    landing: plan,
    status: "awaiting_usdc",
  };
}

const SEP6_WITHDRAW_FAILURES = new Set(["error", "expired", "refunded", "no_market", "too_small", "too_large"]);

/** After the pre-authorized payment: wait for the anchor to match the memo and pay out. */
async function pollSep6Withdrawal(record: WithdrawalRecord): Promise<WithdrawalRecord> {
  if (!record.sep6 || !record.anchor) throw new Error("sep6 state missing");
  if (Date.now() / 1000 > record.sep6.tokenExpiresAt) return { ...record, status: "failed", error: { code: "anchor_auth_expired", message: "the bridge account's SEP-10 token expired before the anchor settled" } };
  const anchor = await discoverAnchor(record.anchor.homeDomain);
  const tx = await sep6Transaction(anchor, record.sep6.token, record.sep6.id);
  const seen: WithdrawalRecord = tx.status === record.sep6.lastStatus ? record : { ...record, sep6: { ...record.sep6, lastStatus: tx.status } };
  if (SEP6_WITHDRAW_FAILURES.has(tx.status)) return { ...seen, status: "failed", error: { code: `sep6_${tx.status}`, message: tx.message ?? `the anchor reported ${tx.status}` } };
  if (tx.status !== "completed") {
    const waitPolls = (record.waitPolls ?? 0) + 1;
    if (waitPolls > MAX_WAIT_POLLS * 2) return { ...seen, waitPolls, status: "failed", error: { code: "anchor_not_matched", message: `the anchor did not complete SEP-6 transaction ${record.sep6.id} (last status ${tx.status})` } };
    return { ...seen, waitPolls };
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
  const done: WithdrawalRecord = { ...seen, status: "completed" };
  if (tx.amountIn) done.receivedUsdc = tx.amountIn;
  if (tx.amountOut) done.amountTry = tx.amountOut;
  if (tx.externalTransactionId) done.payoutId = tx.externalTransactionId;
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
    try: tx.amountOut ?? null,
  });
  return done;
}

/** The browser reports its two passkey-signed transactions. */
export async function recordUsdcSent(id: string, input: { vaultTx: string; transferTx: string }): Promise<WithdrawalRecord> {
  for (const [name, value] of Object.entries(input)) {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new WithdrawError(400, "invalid_hash", `${name} must be a 64-hex transaction hash`);
  }
  return withLease(`withdrawal:${id}`, 30_000, async () => {
    const record = await loadWithdrawal(id);
    if (record.status !== "awaiting_usdc") return record;
    const next = withHistory(record, { ...record, vaultTxHash: input.vaultTx, transferTxHash: input.transferTx, status: "usdc_sent" });
    await withdrawalStore.save(next);
    return next;
  }, () => loadWithdrawal(id), REPORT_LEASE_WAIT_MS);
}

/**
 * The browser reports the vault withdrawal the moment it confirms, before the
 * transfer. A resumed session (phone locked, tab closed) then skips the vault
 * step instead of burning shares twice. Status is unchanged.
 */
export async function recordVaultTx(id: string, vaultTx: string): Promise<WithdrawalRecord> {
  if (!/^[0-9a-f]{64}$/.test(vaultTx)) throw new WithdrawError(400, "invalid_hash", "vaultTx must be a 64-hex transaction hash");
  return withLease(`withdrawal:${id}`, 30_000, async () => {
    const record = await loadWithdrawal(id);
    if (record.vaultTxHash) return record;
    if (record.status !== "created" && record.status !== "awaiting_usdc") throw new WithdrawError(409, "not_awaiting_usdc", `withdrawal is ${record.status}`);
    const next: WithdrawalRecord = { ...record, vaultTxHash: vaultTx };
    await withdrawalStore.save(next);
    return next;
  }, () => loadWithdrawal(id), REPORT_LEASE_WAIT_MS);
}
