/**
 * Reclaim the sponsor's reserves. Every bridge account locks reserves on the
 * sponsor until its pre-authorized cleanup (or abort) merges it back; a
 * deposit cancelled while the abort could not be submitted, a cleanup that
 * failed after the forward, a failed withdrawal, all leave a bridge alive.
 * The sweep walks finished records, checks the bridge still exists, submits
 * the envelope that merges it, and remembers the hash. A bridge that holds
 * USDC (an amount mismatch) cannot be merged and is left for the runbook.
 */
import "server-only";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { discoverAnchor } from "./anchor.server";
import { networkPassphrase, serverEnv } from "./env.server";
import { landingDeps, rpcServer } from "./landing.server";
import { submitPreauthorized } from "./landing/landing";
import { readTokenBalance } from "./vault";
import type { DepositRecord } from "./deposit.server";
import type { WithdrawalRecord } from "./withdraw.server";
import { depositStore, withdrawalStore } from "./store.server";

export interface SweepItem {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  bridge: string;
  action: "merged" | "skipped";
  note?: string;
  hash?: string;
}

export interface SweepResult {
  examined: number;
  merged: number;
  skipped: number;
  items: SweepItem[];
}

const PER_STATUS = 200;
const MAX_SUBMITS = 12;
/** A deposit that has waited this long for lira, or for the anchor, belongs to a visitor who left; its untouched bridge can go back. */
const STALE_MS = 6 * 60 * 60 * 1000;

/** The bridge as it is on chain: its last used sequence, or null when it was merged already. */
async function bridgeSequence(publicKey: string): Promise<bigint | null> {
  try {
    const account = await rpcServer().getAccount(publicKey);
    return BigInt(account.sequenceNumber());
  } catch {
    return null;
  }
}

function envelopeSequence(envelopeXdr: string): bigint {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase());
  const inner = "innerTransaction" in tx ? tx.innerTransaction : tx;
  return BigInt(inner.sequence);
}

/** Which envelope merges this record's bridge back, if any. */
function envelopeFor(kind: "deposit" | "withdrawal", record: DepositRecord | WithdrawalRecord): { xdr: string; field: "cleanupTxHash" | "abortTxHash" } | null {
  if (!record.landing) return null;
  if (record.cleanupTxHash || ("abortTxHash" in record && record.abortTxHash)) return null;
  if (kind === "deposit") {
    const d = record as DepositRecord;
    // Forwarded (or the user's USDC otherwise left the bridge): the cleanup drops the trustline and merges.
    if (d.forwardTxHash) return { xdr: d.landing!.cleanupTxXdr, field: "cleanupTxHash" };
    // Never forwarded (cancelled, or failed before any lira): the abort does the same at the forward's sequence.
    if (d.landing!.abortTxXdr) return { xdr: d.landing!.abortTxXdr, field: "abortTxHash" };
    return null;
  }
  const w = record as WithdrawalRecord;
  if (w.paymentTxHash) return { xdr: w.landing!.cleanupTxXdr, field: "cleanupTxHash" };
  return null;
}

export async function sweepBridges(): Promise<SweepResult> {
  const result: SweepResult = { examined: 0, merged: 0, skipped: 0, items: [] };
  const candidates: Array<{ kind: "deposit" | "withdrawal"; record: DepositRecord | WithdrawalRecord }> = [];
  for (const status of ["cancelled", "failed", "in_wallet", "in_vault"]) {
    for (const record of await depositStore.listByStatus<DepositRecord>(status, PER_STATUS)) candidates.push({ kind: "deposit", record });
  }
  // Still "waiting" after hours: nobody is coming back for these, and the forward was never submitted, so the abort is valid.
  for (const status of ["awaiting_transfer", "transfer_received", "onramp_pending"]) {
    for (const record of await depositStore.listByStatus<DepositRecord>(status, PER_STATUS)) {
      if (Date.now() - Date.parse(record.updatedAt) > STALE_MS && !record.forwardTxHash) candidates.push({ kind: "deposit", record });
    }
  }
  for (const status of ["failed", "completed"]) {
    for (const record of await withdrawalStore.listByStatus<WithdrawalRecord>(status, PER_STATUS)) candidates.push({ kind: "withdrawal", record });
  }
  let submits = 0;
  for (const { kind, record } of candidates) {
    const envelope = envelopeFor(kind, record);
    if (!envelope) continue;
    result.examined += 1;
    const bridge = record.landing!.publicKey;
    const item: SweepItem = { id: record.id, kind, status: record.status, bridge, action: "skipped" };
    const onChain = await bridgeSequence(bridge);
    if (onChain === null) {
      // Already merged (the hash was lost, or it went through out of band): note it so the next sweep skips the lookup.
      item.note = "bridge already gone";
      const store = kind === "deposit" ? depositStore : withdrawalStore;
      const known = (record as { cleanupTxHash?: string; abortTxHash?: string })[envelope.field];
      await store.save({ ...record, [envelope.field]: known ?? "merged-out-of-band" });
      result.skipped += 1;
      result.items.push(item);
      continue;
    }
    // A pre-authorized envelope that is applied but fails at the operation level still consumes its sequence number,
    // and with it every other envelope at that number. So nothing is submitted unless it is certain to apply: the
    // sequence must be the next one, and the trustline can only be dropped when the bridge holds no USDC.
    if (envelopeSequence(envelope.xdr) !== onChain + 1n) {
      item.note = `sequence moved on: envelope ${envelopeSequence(envelope.xdr)} vs next ${onChain + 1n}; left alone`;
      result.skipped += 1;
      result.items.push(item);
      continue;
    }
    try {
      const anchor = await discoverAnchor((record as { anchor?: { homeDomain: string } }).anchor?.homeDomain);
      const usdc = await readTokenBalance(serverEnv.stellarRpcUrl(), networkPassphrase(), anchor.usdc.contractId, bridge);
      if (usdc > 0n) {
        item.note = `bridge still holds ${(Number(usdc) / 1e7).toFixed(7)} ${anchor.usdc.code}; left for the runbook`;
        result.skipped += 1;
        result.items.push(item);
        continue;
      }
    } catch (err) {
      item.note = `balance check failed: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`;
      result.skipped += 1;
      result.items.push(item);
      continue;
    }
    if (submits >= MAX_SUBMITS) {
      item.note = "left for the next sweep";
      result.skipped += 1;
      result.items.push(item);
      continue;
    }
    submits += 1;
    try {
      const sent = await submitPreauthorized(landingDeps(), envelope.xdr);
      item.action = "merged";
      item.hash = sent.hash;
      const store = kind === "deposit" ? depositStore : withdrawalStore;
      const next: Record<string, unknown> = { ...record, [envelope.field]: sent.hash };
      if ("cleanupError" in next) delete next.cleanupError;
      if (kind === "deposit" && envelope.field === "abortTxHash" && !["cancelled", "failed"].includes(record.status)) {
        // The bridge is gone, so the anchor can no longer pay it: the record is closed as cancelled, with a note.
        next.status = "cancelled";
        next.abandonedAt = new Date().toISOString();
        next.abandonedFrom = record.status;
        next.history = [...((record as DepositRecord).history ?? []), { status: "cancelled", at: new Date().toISOString() }];
        item.note = `stale ${record.status}: bridge merged back, record cancelled`;
      }
      await store.save(next as unknown as typeof record);
      result.merged += 1;
    } catch (err) {
      item.note = err instanceof Error ? err.message.slice(0, 160) : String(err);
      result.skipped += 1;
    }
    result.items.push(item);
  }
  return result;
}

/** How many records sit in each status, for the console (a growing "locked reserves" number usually means stale waiting deposits). */
export async function recordCounts(): Promise<{ deposits: Record<string, number>; withdrawals: Record<string, number> }> {
  const deposits: Record<string, number> = {};
  const withdrawals: Record<string, number> = {};
  for (const status of ["awaiting_transfer", "transfer_received", "onramp_pending", "onramp_paid", "forwarded", "in_wallet", "in_vault", "failed", "cancelled", "abandoned"]) deposits[status] = await depositStore.count(status);
  for (const status of ["created", "awaiting_usdc", "usdc_sent", "paid", "completed", "failed"]) withdrawals[status] = await withdrawalStore.count(status);
  return { deposits, withdrawals };
}
