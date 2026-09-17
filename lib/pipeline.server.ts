/**
 * The pipeline driver. A deposit or withdrawal only moves when something calls
 * its poll route, which used to be the user's open page. At the booth the
 * visitor closes the tab after the IBAN step, so the presenter console (every
 * 5 s while open) and a GitHub Actions cron (every 5 min, the backstop) call
 * `tickPipeline`, which advances every pending record through every step the
 * server can take on its own:
 *
 *   deposits     awaiting_transfer → transfer_received → onramp_pending
 *                → onramp_paid (forward) → forwarded (cleanup) → in_wallet
 *   withdrawals  created (reverse bridge) · usdc_sent (payment) → paid
 *                → completed (anchor payout)
 *
 * `in_wallet` and `awaiting_usdc` need the user's passkey and are left alone.
 * Every step goes through the same `advanceDeposit` / `advanceWithdrawal` as
 * a poll, so the per-record leases, attempt counters and sponsor checks apply
 * unchanged; a record whose last step just failed is left alone for a few
 * seconds so a tick every 5 s does not burn its attempts faster than a poll
 * would. Idempotent: a tick that finds nothing to do changes nothing.
 */
import "server-only";
import { autoPlayBank } from "./autobank.server";
import { advanceDeposit, type DepositRecord, type DepositStatus } from "./deposit.server";
import { advanceWithdrawal, type WithdrawalRecord, type WithdrawalStatus } from "./withdraw.server";
import { depositStore, withLease, withdrawalStore } from "./store.server";

export const DEPOSIT_DRIVEABLE: DepositStatus[] = ["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded"];
export const WITHDRAWAL_DRIVEABLE: WithdrawalStatus[] = ["created", "usdc_sent", "paid"];

/** After a failed step, leave the record alone for this long (the user's own poll retries every 3 s; the driver need not pile on). */
const RETRY_BACKOFF_MS = 10_000;
/** Records per status per tick; the next tick picks up the rest. */
const PER_STATUS = 25;
/** Steps one record may take in one tick (a deposit that just got paid can go forward → cleanup → in_wallet in one tick). */
const MAX_STEPS_PER_RECORD = 6;
/** A deposit must be this old before the driver plays its bank transfer: the visitor sees the IBAN screen first, and the record is settled. */
/** After the anchor refused an automatic play, leave that record alone for this long. */
/** Anchors without the sandbox hook are not asked again for a while. */


export interface TickItem {
  id: string;
  from: string;
  to: string;
  steps: number;
  note?: string;
}

export interface TickResult {
  at: string;
  budgetMs: number;
  elapsedMs: number;
  /** Set when another tick held the global lease; nothing was touched. */
  skipped?: "tick_in_progress";
  deposits: TickItem[];
  withdrawals: TickItem[];
}

function recentlyFailed(record: { lastError?: { at: string } | undefined }): boolean {
  return Boolean(record.lastError && Date.now() - Date.parse(record.lastError.at) < RETRY_BACKOFF_MS);
}

async function drive<T extends { id: string; status: string; lastError?: { at: string } | undefined }>(
  record: T,
  driveable: readonly string[],
  advance: (id: string) => Promise<T>,
  deadline: number,
): Promise<TickItem> {
  const item: TickItem = { id: record.id, from: record.status, to: record.status, steps: 0 };
  if (recentlyFailed(record)) {
    item.note = "backoff";
    return item;
  }
  let current = record;
  while (item.steps < MAX_STEPS_PER_RECORD && Date.now() < deadline && driveable.includes(current.status)) {
    const before = current.status;
    const next = await advance(current.id);
    item.steps += 1;
    item.to = next.status;
    if (next.status === before) {
      // Waiting on the anchor, a step that failed transiently, or a poll holding the lease: nothing more to do this tick.
      if (next.lastError && (!current.lastError || next.lastError.at !== current.lastError.at)) item.note = "step_failed";
      break;
    }
    current = next;
  }
  return item;
}

async function collect<T extends { id: string; status: string }>(statuses: readonly string[], list: (status: string, limit: number) => Promise<T[]>): Promise<T[]> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const status of statuses) {
    for (const record of await list(status, PER_STATUS)) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      out.push(record);
    }
  }
  return out;
}

/** One driver pass over every pending record, bounded by `budgetMs`; concurrent ticks are serialised by a global lease. */
export async function tickPipeline(budgetMs = 40_000): Promise<TickResult> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  return withLease(
    "pipeline:tick",
    budgetMs + 10_000,
    async () => {
      const deadline = started + budgetMs;
      const result: TickResult = { at, budgetMs, elapsedMs: 0, deposits: [], withdrawals: [] };
      const deposits = await collect<DepositRecord>(DEPOSIT_DRIVEABLE, (status, limit) => depositStore.listByStatus<DepositRecord>(status, limit));
      for (const record of deposits) {
        if (Date.now() >= deadline) break;
        const autoNote = await autoPlayBank(record);
        const item = await drive(record, DEPOSIT_DRIVEABLE, advanceDeposit, deadline);
        if (autoNote) item.note = item.note ? `${autoNote}; ${item.note}` : autoNote;
        result.deposits.push(item);
      }
      const withdrawals = await collect<WithdrawalRecord>(WITHDRAWAL_DRIVEABLE, (status, limit) => withdrawalStore.listByStatus<WithdrawalRecord>(status, limit));
      for (const record of withdrawals) {
        if (Date.now() >= deadline) break;
        result.withdrawals.push(await drive(record, WITHDRAWAL_DRIVEABLE, advanceWithdrawal, deadline));
      }
      result.elapsedMs = Date.now() - started;
      return result;
    },
    async () => ({ at, budgetMs, elapsedMs: Date.now() - started, skipped: "tick_in_progress" as const, deposits: [], withdrawals: [] }),
  );
}
