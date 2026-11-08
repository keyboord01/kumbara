/**
 * Read-only chain checks the API runs before it believes the browser. The
 * browser reports transaction hashes and backup passkeys; without these checks
 * anyone who knows a kumbara's (public) address could report a made-up hash or
 * claim a passkey for someone else's kumbara (SECURITY.md, KB-02 and KB-03).
 * Nothing here signs or submits anything; reads are simulations and lookups.
 */
import "server-only";
import { Account, Address, Keypair, Operation, StrKey, TransactionBuilder, rpc, xdr, type FeeBumpTransaction, type Transaction } from "@stellar/stellar-sdk";
import { networkPassphrase } from "./env.server";
import { rpcServer } from "./landing.server";

/** Simulations need a source account but never touch it; a random key keeps this free of any secret. */
const READ_SOURCE = Keypair.random().publicKey();
/** Same probe range as the kit (rule ids 0–8); probed in parallel, so one check costs one round of simulations. */
const MAX_RULE_ID = 8;

async function simulateRead(server: rpc.Server, contractId: string, functionName: string, args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
  const tx = new TransactionBuilder(new Account(READ_SOURCE, "0"), { fee: "100", networkPassphrase: networkPassphrase() })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contractId).toScAddress(), functionName, args })),
      auth: [],
    }))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  return sim.result?.retval ?? null;
}

/**
 * True when one of the kumbara's context rules holds a signer whose key data
 * ends in this credential id (the kit stores a passkey signer as the 65-byte
 * public key followed by the credential id). Credential ids are 16+ random
 * bytes, so a byte match inside the rule cannot be a coincidence.
 */
export async function credentialIsSigner(contractId: string, credentialId: Buffer, server: rpc.Server = rpcServer()): Promise<boolean> {
  if (!StrKey.isValidContract(contractId) || credentialId.length < 16) return false;
  // Removed rules leave gaps, so every id in the small range is read rather than stopping at the first miss.
  const ids = Array.from({ length: MAX_RULE_ID + 1 }, (_, id) => id);
  const rules = await Promise.all(ids.map((id) => simulateRead(server, contractId, "get_context_rule", [xdr.ScVal.scvU32(id)]).catch(() => null)));
  return rules.some((rule) => rule !== null && rule.toXDR().includes(credentialId));
}

/**
 * The P-256 public key the chain holds for this passkey on this kumbara, or null when it is not a signer. The kit's
 * key data is the 65-byte uncompressed key followed by the credential id, so the key is the 65 bytes in front of it.
 */
export async function signerPublicKey(contractId: string, credentialId: Buffer, server: rpc.Server = rpcServer()): Promise<Buffer | null> {
  if (!StrKey.isValidContract(contractId) || credentialId.length < 16) return null;
  const ids = Array.from({ length: MAX_RULE_ID + 1 }, (_, id) => id);
  const rules = await Promise.all(ids.map((id) => simulateRead(server, contractId, "get_context_rule", [xdr.ScVal.scvU32(id)]).catch(() => null)));
  for (const rule of rules) {
    if (!rule) continue;
    const bytes = rule.toXDR();
    const at = bytes.indexOf(credentialId);
    if (at >= 65 && bytes[at - 65] === 0x04) return Buffer.from(bytes.subarray(at - 65, at));
  }
  return null;
}

export type TxCheck = { ok: true } | { ok: false; reason: "not_found" | "failed" | "unrelated" };

function innerTransaction(envelopeXdr: xdr.TransactionEnvelope): Transaction {
  const parsed = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase()) as Transaction | FeeBumpTransaction;
  return "innerTransaction" in parsed ? parsed.innerTransaction : parsed;
}

/** Every contract a Soroban transaction's footprint reads or writes. */
export function footprintContracts(tx: Transaction): Set<string> {
  const out = new Set<string>();
  const ext = tx.toEnvelope().v1().tx().ext();
  if (ext.switch() !== 1) return out;
  const footprint = ext.sorobanData().resources().footprint();
  for (const key of [...footprint.readOnly(), ...footprint.readWrite()]) {
    if (key.switch().name === "contractData") out.add(Address.fromScAddress(key.contractData().contract()).toString());
  }
  return out;
}

/**
 * The reported hash is a successful transaction on this network that touched
 * the kumbara's own contract. RPC can trail the relay by a few seconds, so a
 * hash the node has not seen yet is retried before it counts as missing.
 */
export async function txTouchesContract(hash: string, contractId: string, server: rpc.Server = rpcServer(), waitMs = 10_000): Promise<TxCheck> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const res = await server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return footprintContracts(innerTransaction(res.envelopeXdr)).has(contractId) ? { ok: true } : { ok: false, reason: "unrelated" };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) return { ok: false, reason: "failed" };
    if (Date.now() >= deadline) return { ok: false, reason: "not_found" };
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** Why a hash the browser reported cannot be accepted for this kumbara, or null when it can. */
export async function reportedTxProblem(hash: string, contractId: string): Promise<string | null> {
  const check = await txTouchesContract(hash, contractId).catch((err: unknown) => ({ ok: false as const, reason: `rpc: ${err instanceof Error ? err.message : String(err)}` }));
  if (check.ok) return null;
  const why = { not_found: "is not on the network (yet)", failed: "failed on chain", unrelated: "does not involve this kumbara" }[check.reason as string] ?? check.reason;
  return `transaction ${hash.slice(0, 8)}… ${why}`;
}
