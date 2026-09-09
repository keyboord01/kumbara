/**
 * "Play the bank": tell the sandbox anchor that the TRY transfer for a pending
 * deposit arrived. The TR Mock Anchor exposes this next to its SEP-6
 * transactions (`POST {TRANSFER_SERVER}/tx/{id}/simulate-bank-transfer`, no
 * authentication, the amount in the body), exactly as the organizer's
 * reference wallet and explorer do it. Shared by `pnpm demo:deposit` and the
 * presenter-only /booth/admin button so both do exactly the same thing. A
 * production anchor has no such hook: the real bank transfer plays this part.
 */
import { depositStore } from "./db/store";

export interface PendingDeposit {
  id: string;
  contractId: string;
  amountTry: string;
  createdAt: string;
  reference: string;
}

interface DepositRow {
  id: string;
  contractId: string;
  status: string;
  amountTry: string;
  createdAt: string;
  updatedAt: string;
  instructions: { reference: string };
  anchor?: { homeDomain: string };
  sep6?: { id: string; transferServer: string };
}

export async function listPendingDeposits(limit = 10): Promise<PendingDeposit[]> {
  const rows = await depositStore.listByStatus<DepositRow>("awaiting_transfer", limit);
  return rows.map((d) => ({ id: d.id, contractId: d.contractId, amountTry: d.amountTry, createdAt: d.createdAt, reference: d.instructions.reference }));
}

export interface PlayBankInput {
  /** A specific deposit; default: the newest one awaiting a transfer. */
  depositId?: string;
  /** Override the simulated amount (TRY); default: the deposit's own amount. */
  amountTry?: string;
}

export interface PlayBankResult {
  depositId: string;
  reference: string;
  amountTry: string;
  transferId: string;
  transferStatus: string;
}

export class PlayBankError extends Error {
  constructor(
    readonly code: "no_pending_deposit" | "not_found" | "anchor_rejected" | "no_sandbox_hook" | "not_sep6" | "already_paid",
    message: string,
  ) {
    super(message);
    this.name = "PlayBankError";
  }
}

export async function playBank(input: PlayBankInput = {}): Promise<PlayBankResult> {
  const target = input.depositId
    ? await depositStore.get<DepositRow>(input.depositId)
    : (await depositStore.listByStatus<DepositRow>("awaiting_transfer", 1))[0] ?? null;
  if (!target) {
    throw new PlayBankError(input.depositId ? "not_found" : "no_pending_deposit", input.depositId ? `deposit ${input.depositId} not found` : "no deposit is awaiting a transfer");
  }
  if (!target.sep6) throw new PlayBankError("not_sep6", `deposit ${target.id} predates the SEP-6 path and has no anchor transaction to fund`);
  if (target.status !== "awaiting_transfer") throw new PlayBankError("already_paid", `deposit ${target.id} is ${target.status}: the bank already played for reference ${target.instructions.reference}`);
  const amount = Number(input.amountTry ?? target.amountTry).toFixed(2);
  const res = await fetch(`${target.sep6.transferServer}/tx/${encodeURIComponent(target.sep6.id)}/simulate-bank-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { transaction?: { status?: string }; error?: string | { message?: string } };
  if (res.status === 404 || res.status === 405) throw new PlayBankError("no_sandbox_hook", `${new URL(target.sep6.transferServer).host} has no sandbox bank-transfer hook; the lira has to arrive for real`);
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : (body.error?.message ?? `anchor HTTP ${res.status}`);
    // The anchor's own "already received its bank transfer": the record simply has not been polled since.
    if (/already/i.test(message)) throw new PlayBankError("already_paid", `deposit ${target.id}: ${message}`);
    throw new PlayBankError("anchor_rejected", message);
  }
  return { depositId: target.id, reference: target.instructions.reference, amountTry: amount, transferId: target.sep6.id, transferStatus: body.transaction?.status ?? "pending_anchor" };
}
