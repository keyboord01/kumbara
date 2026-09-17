import "server-only";
import { PlayBankError, playBank, type BankPlayed } from "./demo-bank";
import { autoConfirmLimit } from "./autoconfirm.server";
import type { DepositRecord } from "./deposit.server";

/**
 * Playing the sandbox bank for small deposits, so a visitor at the booth is not
 * left staring at "waiting for your transfer" until somebody presses something.
 * Called from two places: the driver's tick, and the visitor's own poll of their
 * deposit, which is what makes it feel immediate when no console is open.
 */
/** Long enough that the visitor sees the IBAN screen first, short enough that the wait never feels stuck. */
const AUTO_BANK_MIN_AGE_MS = 2_000;
const AUTO_BANK_BACKOFF_MS = 30_000;
const NO_HOOK_MEMORY_MS = 5 * 60_000;
/** Per-record and per-anchor memory, per instance; losing it on a cold start only costs one extra attempt. */
const autoBankBackoff = new Map<string, number>();
const noHookUntil = new Map<string, number>();

/** Plays the bank when the deposit is small enough, or returns null when it is not ours to play. */
export async function autoPlayBank(record: DepositRecord & { bankPlayed?: BankPlayed }): Promise<string | null> {
  if (record.status !== "awaiting_transfer" || record.bankPlayed || !record.sep6) return null;
  const limit = await autoConfirmLimit();
  if (limit.try <= 0) return null;
  const amount = Number(record.amountTry);
  if (!Number.isFinite(amount) || amount > limit.try) return null;
  const now = Date.now();
  if (now - Date.parse(record.createdAt) < AUTO_BANK_MIN_AGE_MS) return null;
  if (record.transferDeadline && now > Date.parse(record.transferDeadline)) return null;
  if ((autoBankBackoff.get(record.id) ?? 0) > now) return null;
  const host = record.sep6.transferServer;
  if ((noHookUntil.get(host) ?? 0) > now) return null;
  try {
    await playBank({ depositId: record.id, by: "auto" });
    return "auto_bank:played";
  } catch (err) {
    if (err instanceof PlayBankError) {
      if (err.code === "no_sandbox_hook") noHookUntil.set(host, now + NO_HOOK_MEMORY_MS);
      else if (err.code !== "already_paid") autoBankBackoff.set(record.id, now + AUTO_BANK_BACKOFF_MS);
      return `auto_bank:${err.code}`;
    }
    autoBankBackoff.set(record.id, now + AUTO_BANK_BACKOFF_MS);
    return `auto_bank:${err instanceof Error ? err.message.slice(0, 80) : String(err)}`;
  }
}
