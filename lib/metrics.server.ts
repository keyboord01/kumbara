/**
 * Minimal event log for the booth counter and /api/metrics: project id,
 * timestamp, network, booth ref, and the on-chain identifiers needed to link
 * the evidence. Nothing else is recorded. Gate 4 swaps the file backend for
 * a durable store; the interface stays.
 */
import "server-only";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type MetricEvent =
  | { type: "account_created"; ts: number; network: string; projectId: string; ref: string | null; contractId: string | null; hash: string }
  | { type: "relayed_tx"; ts: number; network: string; projectId: string; ref: string | null; hash: string; contract: string | null };

const FILE = path.join(process.cwd(), ".data", "events.ndjson");

export async function recordEvent(event: MetricEvent): Promise<void> {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await appendFile(FILE, `${JSON.stringify(event)}\n`);
  } catch (err) {
    console.warn("[metrics] could not record event:", err instanceof Error ? err.message : err);
  }
}

export async function readEvents(): Promise<MetricEvent[]> {
  try {
    const text = await readFile(FILE, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MetricEvent);
  } catch {
    return [];
  }
}
