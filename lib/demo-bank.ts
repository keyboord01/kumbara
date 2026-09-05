/**
 * "Play the bank": tell the sandbox anchor that the TRY transfer for a pending
 * deposit arrived. Shared by `pnpm demo:deposit` and the presenter-only
 * /booth/admin button so both do exactly the same thing.
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
}

export async function listPendingDeposits(limit = 10): Promise<PendingDeposit[]> {
  const rows = await depositStore.listByStatus<DepositRow>("awaiting_transfer", limit);
  return rows.map((d) => ({ id: d.id, contractId: d.contractId, amountTry: d.amountTry, createdAt: d.createdAt, reference: d.instructions.reference }));
}

export interface PlayBankInput {
  anchorBaseUrl: string;
  anchorApiKey: string;
  depositId?: string;
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
    readonly code: "no_pending_deposit" | "not_found" | "anchor_rejected",
    message: string,
  ) {
    super(message);
    this.name = "PlayBankError";
  }
}

export async function playBank(input: PlayBankInput): Promise<PlayBankResult> {
  const target = input.depositId
    ? await depositStore.get<DepositRow>(input.depositId)
    : (await depositStore.listByStatus<DepositRow>("awaiting_transfer", 1))[0] ?? null;
  if (!target) {
    throw new PlayBankError(input.depositId ? "not_found" : "no_pending_deposit", input.depositId ? `deposit ${input.depositId} not found` : "no deposit is awaiting a transfer");
  }
  const amount = Number(input.amountTry ?? target.amountTry).toFixed(2);
  const res = await fetch(`${input.anchorBaseUrl.replace(/\/+$/, "")}/v1/sandbox/bank-transfers`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-Key": input.anchorApiKey },
    body: JSON.stringify({ reference: target.instructions.reference, amount_try: amount, sender_name: "Kumbara demo" }),
  });
  const body = (await res.json()) as { id?: string; status?: string; error?: { message?: string } };
  if (!res.ok || !body.id) throw new PlayBankError("anchor_rejected", body.error?.message ?? `anchor HTTP ${res.status}`);
  return { depositId: target.id, reference: target.instructions.reference, amountTry: amount, transferId: body.id, transferStatus: body.status ?? "unknown" };
}
