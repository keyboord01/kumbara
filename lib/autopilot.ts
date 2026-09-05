"use client";

/**
 * Arrival autopilot: put USDC that reached the smart account into the vault.
 * One passkey approval, one relay call. Shared by the Deposit screen and the
 * presenter's seed action.
 */
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { buildContractCallTransaction } from "@sembol/passkey-react";
import type { SmartAccountKit } from "smart-account-kit";

export function usdcToStroops(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.replace(",", ".").split(".");
  return BigInt(whole || "0") * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
}

/**
 * `invest: true` sends the deposit straight through the vault's invest path
 * into its strategy allocations (the vault handles the strategy calls in the
 * same transaction); `false` leaves it idle in the vault.
 */
export async function buildVaultDeposit(kit: SmartAccountKit, vaultId: string, address: string, amountUsdc: string, invest = true) {
  const amount = nativeToScVal(usdcToStroops(amountUsdc), { type: "i128" });
  return buildContractCallTransaction(kit, {
    contractId: vaultId,
    method: "deposit",
    args: [xdr.ScVal.scvVec([amount]), xdr.ScVal.scvVec([amount]), Address.fromString(address).toScVal(), xdr.ScVal.scvBool(invest)],
  });
}
