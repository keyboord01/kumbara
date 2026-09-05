/**
 * Counter events for booth mode and /api/metrics: project id, timestamp,
 * network, booth ref and the on-chain identifiers needed to link the
 * evidence. Nothing else is recorded. Stored in SQLite (lib/db/store.ts).
 */
import "server-only";
import { countEvents, insertEvent, listEvents } from "./db/store";

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
