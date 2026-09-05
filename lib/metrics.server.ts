/**
 * Counter events for booth mode and /api/metrics: project id, timestamp,
 * network, booth ref and the on-chain identifiers needed to link the
 * evidence. Nothing else is recorded. Stored in SQLite (lib/db/store.ts).
 */
import "server-only";
import { countEvents, depositStore, insertEvent, listEvents, withdrawalStore } from "./db/store";
import { serverEnv } from "./env.server";

export type MetricEvent =
  | { type: "account_created"; ts: number; network: string; projectId: string; ref: string | null; contractId: string | null; hash: string }
  | { type: "relayed_tx"; ts: number; network: string; projectId: string; ref: string | null; hash: string; contract: string | null }
  | { type: "deposit_completed"; ts: number; network: string; projectId: string; ref: string | null; contractId: string; depositId: string; anchorTx: string | null; forwardTx: string | null; vaultTx: string; usdc: string }
  | { type: "withdrawal_completed"; ts: number; network: string; projectId: string; ref: string | null; contractId: string; withdrawalId: string; vaultTx: string | null; paymentTx: string | null; usdc: string; try: string | null };

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
}

interface DepositRow {
  id: string;
  contractId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  ref?: string | null;
  paidUsdc?: string;
  anchorTxHash?: string;
  forwardTxHash?: string;
  vaultTxHash?: string;
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
}

/** The public traction snapshot. Accounts count only confirmed deployments. */
export async function metricsSnapshot(filter: MetricsFilter) {
  const accountsAll = (await listEvents({ type: "account_created" }, 5000)) as unknown as Extract<MetricEvent, { type: "account_created" }>[];
  const inWindow = accountsAll.filter((e) => e.ts >= filter.since * 1000 && (!filter.ref || e.ref === filter.ref));
  const byRef: Record<string, number> = {};
  for (const e of accountsAll) {
    if (e.ts < filter.since * 1000) continue;
    const key = e.ref ?? "(none)";
    byRef[key] = (byRef[key] ?? 0) + 1;
  }
  const deposits = (await depositStore.list<DepositRow>(undefined, 5000)).filter((d) => Date.parse(d.createdAt) >= filter.since * 1000 && (!filter.ref || d.ref === filter.ref));
  const withdrawals = (await withdrawalStore.list<WithdrawalRow>(undefined, 5000)).filter((w) => Date.parse(w.createdAt) >= filter.since * 1000 && (!filter.ref || w.ref === filter.ref));
  const network = serverEnv.stellarNetwork();
  const explorer = `https://stellar.expert/explorer/${network === "testnet" ? "testnet" : "public"}/tx/`;
  const link = (hash: string | null | undefined) => (hash ? `${explorer}${hash}` : null);
  return {
    network,
    projectId: serverEnv.sembolProjectId(),
    generatedAt: new Date().toISOString(),
    since: filter.since,
    filter: { ref: filter.ref, since: filter.since },
    accounts: {
      total: accountsAll.length,
      sinceStart: inWindow.length,
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
