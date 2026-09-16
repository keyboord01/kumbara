/**
 * Counter events for booth mode and /api/metrics: project id, timestamp,
 * network, booth ref and the on-chain identifiers needed to link the
 * evidence. Nothing else is recorded. Stored in SQLite (lib/db/store.ts).
 */
import "server-only";
import { countEvents, depositStore, insertEvent, listEvents, sourceOfRef, withdrawalStore, type EventSource } from "./db/store";
import { networkPassphrase, serverEnv } from "./env.server";
import { readVaultTotals } from "./vault";

export type MetricEvent =
  | { type: "account_created"; ts: number; network: string; projectId: string; ref: string | null; contractId: string | null; hash: string; tapToConfirmMs?: number | null }
  | { type: "relayed_tx"; ts: number; network: string; projectId: string; ref: string | null; hash: string; contract: string | null }
  | { type: "deposit_completed"; ts: number; network: string; projectId: string; ref: string | null; contractId: string; depositId: string; anchorTx: string | null; forwardTx: string | null; vaultTx: string; usdc: string }
  | { type: "withdrawal_completed"; ts: number; network: string; projectId: string; ref: string | null; contractId: string; withdrawalId: string; vaultTx: string | null; paymentTx: string | null; usdc: string; try: string | null }
  /** USDC that was already in the kumbara (sent to its address, or left by an interrupted deposit) put in the vault; feed only, never a funnel stage. */
  | { type: "vault_deposit"; ts: number; network: string; projectId: string; ref: string | null; contractId: string; vaultTx: string; usdc: string };

export async function recordEvent(event: MetricEvent): Promise<void> {
  try {
    await insertEvent(event);
  } catch (err) {
    console.warn("[metrics] could not record event:", err instanceof Error ? err.message : err);
  }
}

export async function readEvents(filter: { type?: MetricEvent["type"]; since?: number } = {}): Promise<MetricEvent[]> {
  return (await listEvents(filter)) as unknown as MetricEvent[];
}

export async function countMetricEvents(filter: { type?: MetricEvent["type"]; since?: number; ref?: string } = {}): Promise<number> {
  return countEvents(filter);
}

export interface MetricsFilter {
  ref: string | null;
  since: number;
  /** Which sources to count; `user` only by default (seed and e2e are excluded unless asked for). */
  sources: EventSource[];
}

/** `?include=e2e,seed` or `?include=all` on top of the real visitors. */
export function sourcesFromInclude(include: string | null): EventSource[] {
  const wanted = new Set<EventSource>(["user"]);
  for (const part of (include ?? "").split(",").map((s) => s.trim().toLowerCase())) {
    if (part === "all") {
      wanted.add("seed");
      wanted.add("e2e");
    } else if (part === "seed" || part === "e2e") {
      wanted.add(part);
    }
  }
  return [...wanted];
}

interface DepositRow {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  ref?: string | null;
  amountTry?: string;
  receivedTry?: string;
  paidUsdc?: string;
  anchorTxHash?: string;
  forwardTxHash?: string;
  vaultTxHash?: string;
  history?: Array<{ status: string; at: string }>;
}

interface WithdrawalRow {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  ref?: string | null;
  amountUsdc: string;
  amountTry?: string;
  payoutId?: string;
  vaultTxHash?: string;
  transferTxHash?: string;
  paymentTxHash?: string;
  history?: Array<{ status: string; at: string }>;
}

/** Minimum sample before a median or p90 is shown; below it the page says "not enough data". */
export const MIN_TIMING_SAMPLES = 5;

export interface TimingSummary {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
}

function summarize(values: number[]): TimingSummary {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (clean.length < MIN_TIMING_SAMPLES) return { n: clean.length, medianMs: null, p90Ms: null };
  const at = (q: number) => clean[Math.min(clean.length - 1, Math.floor(q * (clean.length - 1)))] ?? null;
  return { n: clean.length, medianMs: at(0.5), p90Ms: at(0.9) };
}

function spanMs(history: Array<{ status: string; at: string }> | undefined, from: string, to: string): number | null {
  const start = history?.find((h) => h.status === from)?.at;
  const end = history?.find((h) => h.status === to)?.at;
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? ms : null;
}

const cents = (amount: string | undefined): bigint => {
  if (!amount) return 0n;
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2));
};
const fromCents = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;

/** Bucket width that keeps a window under ~200 bars: 15 min up to 2 days, then 1 h, 6 h, 1 day. */
function bucketMinutes(spanMinutes: number): number {
  for (const width of [15, 60, 360, 1440]) if (spanMinutes / width <= 200) return width;
  return 1440;
}

/** Pipeline stages in order; a record "reached" a stage if its history or current status is at or past it. */
const DEPOSIT_STAGES = ["awaiting_transfer", "transfer_received", "onramp_paid", "in_wallet", "in_vault"] as const;
const DEPOSIT_STAGE_INDEX: Record<string, number> = { awaiting_transfer: 0, transfer_received: 1, onramp_pending: 1, onramp_paid: 2, forwarded: 2, in_wallet: 3, in_vault: 4 };
const WITHDRAW_STAGES = ["created", "awaiting_usdc", "usdc_sent", "paid", "completed"] as const;
const WITHDRAW_STAGE_INDEX: Record<string, number> = { created: 0, awaiting_usdc: 1, usdc_sent: 2, paid: 3, completed: 4 };

export interface FunnelStage {
  stage: string;
  /** Records that reached at least this stage. */
  count: number;
  /** Records that reached this stage and never the next one (last stage: 0). */
  dropOff: number;
  /** Share of the previous stage lost before this one, as a percentage (first stage: null). */
  dropPct: number | null;
}

function funnel<T extends { status: string; history?: Array<{ status: string }> | undefined }>(records: T[], stages: readonly string[], index: Record<string, number>): { stages: FunnelStage[]; exits: Record<string, number> } {
  const reached = new Array<number>(stages.length).fill(0);
  const exits: Record<string, number> = {};
  for (const r of records) {
    let furthest = -1;
    for (const s of [...(r.history ?? []).map((h) => h.status), r.status]) {
      const i = index[s];
      if (i !== undefined && i > furthest) furthest = i;
    }
    for (let i = 0; i <= furthest; i += 1) reached[i] = (reached[i] ?? 0) + 1;
    if (!(r.status in index)) exits[r.status] = (exits[r.status] ?? 0) + 1;
  }
  return {
    stages: stages.map((stage, i) => ({
      stage,
      count: reached[i] ?? 0,
      dropOff: i < stages.length - 1 ? (reached[i] ?? 0) - (reached[i + 1] ?? 0) : 0,
      dropPct: i === 0 ? null : (reached[i - 1] ?? 0) > 0 ? Math.round((1 - (reached[i] ?? 0) / (reached[i - 1] ?? 1)) * 1000) / 10 : null,
    })),
    exits,
  };
}

/** The public traction snapshot. Accounts count only confirmed deployments. */
export async function metricsSnapshot(filter: MetricsFilter) {
  const included = new Set<EventSource>(filter.sources);
  const accountsAll = (await listEvents({ type: "account_created", sources: filter.sources }, 5000)) as unknown as Extract<MetricEvent, { type: "account_created" }>[];
  const inWindow = accountsAll.filter((e) => e.ts >= filter.since * 1000 && (!filter.ref || e.ref === filter.ref));
  const byRef: Record<string, number> = {};
  let viaInvites = 0;
  for (const e of accountsAll) {
    if (e.ts < filter.since * 1000) continue;
    const key = e.ref ?? "(none)";
    byRef[key] = (byRef[key] ?? 0) + 1;
    if (/^(e2e-)?inv-/.test(key)) viaInvites += 1;
  }
  const deposits = (await depositStore.list<DepositRow>(undefined, 5000)).filter((d) => included.has(sourceOfRef(d.ref)) && Date.parse(d.createdAt) >= filter.since * 1000 && (!filter.ref || d.ref === filter.ref));
  const withdrawals = (await withdrawalStore.list<WithdrawalRow>(undefined, 5000)).filter((w) => included.has(sourceOfRef(w.ref)) && Date.parse(w.createdAt) >= filter.since * 1000 && (!filter.ref || w.ref === filter.ref));
  const network = serverEnv.stellarNetwork();
  const explorer = `https://stellar.expert/explorer/${network === "testnet" ? "testnet" : "public"}/tx/`;
  const link = (hash: string | null | undefined) => (hash ? `${explorer}${hash}` : null);

  // All-time counts for the "since event start" toggle, independent of the window.
  const depositsAllTime = (await depositStore.list<DepositRow>(undefined, 5000)).filter((d) => included.has(sourceOfRef(d.ref)) && (!filter.ref || d.ref === filter.ref));
  const withdrawalsAllTime = (await withdrawalStore.list<WithdrawalRow>(undefined, 5000)).filter((w) => included.has(sourceOfRef(w.ref)) && (!filter.ref || w.ref === filter.ref));
  const accountsAllTime = accountsAll.filter((e) => !filter.ref || e.ref === filter.ref);
  const totals = (deps: DepositRow[], wds: WithdrawalRow[], accounts: number) => {
    const completedDeposits = deps.filter((d) => d.vaultTxHash);
    const completedWithdrawals = wds.filter((w) => w.status === "completed");
    return {
      accounts,
      depositsCompleted: completedDeposits.length,
      withdrawalsCompleted: completedWithdrawals.length,
      tryIn: fromCents(completedDeposits.reduce((sum, d) => sum + cents(d.receivedTry ?? d.amountTry), 0n)),
      tryOut: fromCents(completedWithdrawals.reduce((sum, w) => sum + cents(w.amountTry), 0n)),
    };
  };

  // Live vault total from the contract (idle + invested), never from the database.
  let usdcInVault: string | null = null;
  const vaultId = serverEnv.defindexVaultId();
  try {
    const vault = await readVaultTotals(serverEnv.stellarRpcUrl(), networkPassphrase(), vaultId);
    usdcInVault = `${vault.totalAssets / 10_000_000n}.${(vault.totalAssets % 10_000_000n).toString().padStart(7, "0")}`;
  } catch {
    usdcInVault = null;
  }

  // Activity feed: the last 20 events of the three kinds in the window.
  const feedEvents = (await listEvents({ since: filter.since * 1000, sources: filter.sources }, 400)) as unknown as MetricEvent[];
  const feed = feedEvents
    .filter((e): e is Exclude<MetricEvent, { type: "relayed_tx" }> => e.type !== "relayed_tx" && (!filter.ref || e.ref === filter.ref))
    .slice(0, 20)
    .map((e) => {
      if (e.type === "account_created") return { type: e.type, ts: e.ts, contractId: e.contractId, usdc: null, try: null, hash: e.hash, link: link(e.hash) };
      if (e.type === "deposit_completed") return { type: e.type, ts: e.ts, contractId: e.contractId, usdc: e.usdc, try: null, hash: e.vaultTx, link: link(e.vaultTx) };
      // A direct vault deposit reads as a deposit in the feed (the stats page labels feed rows by type).
      if (e.type === "vault_deposit") return { type: "deposit_completed" as const, ts: e.ts, contractId: e.contractId, usdc: e.usdc, try: null, hash: e.vaultTx, link: link(e.vaultTx) };
      return { type: e.type, ts: e.ts, contractId: e.contractId, usdc: e.usdc, try: e.try, hash: e.paymentTx ?? e.vaultTx, link: link(e.paymentTx ?? e.vaultTx) };
    });

  // Onboarding curve: accounts per bucket over the window.
  const now = Date.now();
  // The curve never starts before the first account: a window in the future (the event has
  // not begun) or far in the past (?since=1 for "all time") snaps to the first event.
  const sinceMs = filter.since * 1000;
  const earliest = Math.min(now, ...accountsAllTime.map((e) => e.ts));
  const windowStart = filter.since > 0 && sinceMs <= now ? Math.max(sinceMs, earliest) : earliest;
  const width = bucketMinutes(Math.max(15, (now - windowStart) / 60_000)) * 60_000;
  const firstBucket = Math.floor(windowStart / width) * width;
  const series: Array<{ start: number; accounts: number }> = [];
  for (let start = firstBucket; start <= now; start += width) series.push({ start, accounts: 0 });
  for (const e of inWindow) {
    const idx = Math.floor((e.ts - firstBucket) / width);
    const bucket = series[idx];
    if (bucket) bucket.accounts += 1;
  }

  // Timings from stored timestamps; medians only with enough samples.
  const timings = {
    tapToReady: summarize(inWindow.map((e) => e.tapToConfirmMs ?? NaN)),
    deposit: summarize(deposits.map((d) => spanMs(d.history, "transfer_received", "in_vault") ?? NaN)),
    withdraw: summarize(withdrawals.map((w) => spanMs(w.history, "created", "completed") ?? NaN)),
    minSamples: MIN_TIMING_SAMPLES,
  };

  return {
    network,
    projectId: serverEnv.sembolProjectId(),
    generatedAt: new Date().toISOString(),
    since: filter.since,
    filter: { ref: filter.ref, since: filter.since, sources: filter.sources },
    headline: { ...totals(deposits, withdrawals, inWindow.length), usdcInVault, vaultId, strategyId: process.env.DEFINDEX_STRATEGY_ID?.trim() || null },
    allTime: totals(depositsAllTime, withdrawalsAllTime, accountsAllTime.length),
    feed,
    buckets: { minutes: width / 60_000, from: firstBucket, to: now, series },
    timings,
    funnel: {
      accounts: inWindow.length,
      deposits: funnel(deposits, DEPOSIT_STAGES, DEPOSIT_STAGE_INDEX),
      withdrawals: funnel(withdrawals, WITHDRAW_STAGES, WITHDRAW_STAGE_INDEX),
    },
    accounts: {
      total: accountsAll.length,
      sinceStart: inWindow.length,
      viaInvites,
      byRef,
      items: inWindow.slice(0, 100).map((e) => ({ contractId: e.contractId, ref: e.ref, ts: e.ts, deployTx: e.hash, link: link(e.hash) })),
    },
    deposits: {
      started: deposits.length,
      completed: deposits.filter((d) => d.anchorTxHash).length,
      inVault: deposits.filter((d) => d.vaultTxHash).length,
      items: deposits.slice(0, 100).map((d) => ({
        depositId: d.id,
        contractId: d.contractId,
        ref: d.ref ?? null,
        status: d.status,
        usdc: d.paidUsdc ?? null,
        ts: Date.parse(d.createdAt),
        anchorTx: d.anchorTxHash ?? null,
        forwardTx: d.forwardTxHash ?? null,
        vaultTx: d.vaultTxHash ?? null,
        links: { anchor: link(d.anchorTxHash), forward: link(d.forwardTxHash), vault: link(d.vaultTxHash) },
      })),
    },
    withdrawals: {
      started: withdrawals.length,
      completed: withdrawals.filter((w) => w.status === "completed").length,
      items: withdrawals.slice(0, 100).map((w) => ({
        withdrawalId: w.id,
        contractId: w.contractId,
        ref: w.ref ?? null,
        status: w.status,
        usdc: w.amountUsdc,
        try: w.amountTry ?? null,
        payoutId: w.payoutId ?? null,
        ts: Date.parse(w.createdAt),
        vaultTx: w.vaultTxHash ?? null,
        transferTx: w.transferTxHash ?? null,
        paymentTx: w.paymentTxHash ?? null,
        links: { vault: link(w.vaultTxHash), transfer: link(w.transferTxHash), payment: link(w.paymentTxHash) },
      })),
    },
  };
}
