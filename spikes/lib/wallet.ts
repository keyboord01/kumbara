/**
 * Smart-account operations used by the spikes: arbitrary contract calls
 * authorized by the passkey, USDC transfers (including muxed destinations),
 * and the token-scoped spending-limit rule install that mirrors
 * @sembol/passkey-react's useSpendingPolicy.
 */
import { Address, Operation, contract, rpc as StellarRpc, xdr } from "@stellar/stellar-sdk";
import {
  createCallContractContext,
  createSpendingLimitParams,
  getCredentialIdFromSigner,
  type ContextRule,
  type ContractSigner,
  type SmartAccountKit,
  type TransactionSuccess,
} from "smart-account-kit";
import { addressScVal, i128 } from "./stellar";
import { SMART_ACCOUNT_TESTNET } from "./testnet";

export type Assembled = contract.AssembledTransaction<unknown>;

/** Build (simulate) a contract call whose auth entries the smart account signs. */
export async function buildCall(kit: SmartAccountKit, contractId: string, method: string, args: xdr.ScVal[]): Promise<Assembled> {
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(contractId).toScAddress(),
      functionName: method,
      args,
    }),
  );
  const tx = await contract.AssembledTransaction.buildWithOp(Operation.invokeHostFunction({ func }), {
    contractId,
    networkPassphrase: kit.networkPassphrase,
    rpcUrl: kit.rpcUrl,
    publicKey: kit.deployerPublicKey,
    timeoutInSeconds: 60,
    method,
    parseResultXdr: () => undefined,
  });
  const simulation = tx.simulation;
  if (simulation && StellarRpc.Api.isSimulationError(simulation)) {
    throw new Error(`simulation failed for ${method}() on ${contractId}: ${simulation.error}`);
  }
  return tx;
}

/** Sign with the passkey, re-simulate and submit through the relay. */
export async function submit(kit: SmartAccountKit, tx: Assembled): Promise<TransactionSuccess> {
  const result = await kit.signAndSubmit(tx);
  if (!result.success) {
    throw new Error(`[${result.error.code}] ${result.error.message}`);
  }
  return result;
}

export async function call(kit: SmartAccountKit, contractId: string, method: string, args: xdr.ScVal[]): Promise<TransactionSuccess> {
  return submit(kit, await buildCall(kit, contractId, method, args));
}

/** SEP-41 transfer out of the smart account. `to` may be G…, C… or muxed M…. */
export async function transferToken(kit: SmartAccountKit, tokenContract: string, to: string, amountStroops: bigint): Promise<TransactionSuccess> {
  const from = kit.contractId;
  if (!from) throw new Error("wallet not connected");
  return call(kit, tokenContract, "transfer", [addressScVal(from), addressScVal(to), i128(amountStroops)]);
}

export function findPasskeySigner(rules: ContextRule[], credentialId: string): ContractSigner | null {
  for (const rule of rules) {
    for (const signer of rule.signers) {
      if (getCredentialIdFromSigner(signer) === credentialId) return signer;
    }
  }
  return null;
}

export function findSpendingRule(rules: ContextRule[], tokenContract: string, policyAddress = SMART_ACCOUNT_TESTNET.spendingLimitPolicyAddress): ContextRule | null {
  return (
    rules.find(
      (rule) =>
        rule.context_type.tag === "CallContract" &&
        rule.context_type.values[0] === tokenContract &&
        rule.policies.includes(policyAddress),
    ) ?? null
  );
}

export interface SpendingLimitView {
  ruleId: number;
  limit: bigint;
  spent: bigint;
  periodLedgers: number;
}

export async function readSpendingLimit(kit: SmartAccountKit, tokenContract: string, policyAddress = SMART_ACCOUNT_TESTNET.spendingLimitPolicyAddress): Promise<SpendingLimitView | null> {
  const rules = await kit.rules.list();
  const rule = findSpendingRule(rules, tokenContract, policyAddress);
  if (!rule) return null;
  const data = await kit.policyClients.spendingLimit(policyAddress).getSpendingLimitData(rule.id);
  return { ruleId: rule.id, limit: data.spending_limit, spent: data.cached_total_spent, periodLedgers: data.period_ledgers };
}

/**
 * Install a spending limit the way @sembol/passkey-react does: a new
 * CallContract(token) rule carrying the connected passkey and the
 * spending-limit policy. Over-limit transfers are then rejected on-chain.
 */
export async function installSpendingLimit(
  kit: SmartAccountKit,
  credentialId: string,
  tokenContract: string,
  limitStroops: bigint,
  periodLedgers: number,
  policyAddress = SMART_ACCOUNT_TESTNET.spendingLimitPolicyAddress,
): Promise<TransactionSuccess> {
  const rules = await kit.rules.list();
  const signer = findPasskeySigner(rules, credentialId);
  if (!signer) throw new Error("connected passkey not found among the account's signers");
  const params = kit.convertPolicyParams("spending_limit", createSpendingLimitParams(limitStroops, periodLedgers));
  const tx = await kit.rules.add(
    createCallContractContext(tokenContract),
    "Kumbara USDC limit",
    [signer],
    new Map<string, unknown>([[policyAddress, params]]),
  );
  return submit(kit, tx as unknown as Assembled);
}
