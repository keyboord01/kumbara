/**
 * What the relay route agrees to pay fees for (SECURITY.md, KB-04). Before
 * this, /api/relay forwarded any Soroban call, so anyone could run their own
 * contracts on Kumbara's fee budget at up to 120 calls per IP per hour.
 *
 * Allowed:
 *   - deploying a smart account whose WASM is a known Kumbara account build;
 *   - calling a Kumbara account itself (signers, rules, spending limits);
 *   - calling the anchor's USDC or the vault, when a Kumbara account
 *     authorises it (transfers, vault deposits and withdrawals).
 * A "Kumbara account" is a contract whose instance runs a known account WASM,
 * read from the chain, so accounts created before the registry existed pass
 * too. Every other call is refused before it reaches the relay.
 */
import "server-only";
import { Address, TransactionBuilder, xdr, type FeeBumpTransaction, type Transaction } from "@stellar/stellar-sdk";
import { discoverAnchor } from "./anchor.server";
import { networkPassphrase, serverEnv } from "./env.server";
import { rpcServer } from "./landing.server";

/** The account build every kumbara runs (smart-account-kit, Protocol 27 canonical); RELAY_ACCOUNT_WASM_HASHES adds more. */
const DEFAULT_ACCOUNT_WASM = "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a";

export function accountWasmHashes(): Set<string> {
  const extra = (process.env.RELAY_ACCOUNT_WASM_HASHES ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[0-9a-f]{64}$/.test(h));
  return new Set([DEFAULT_ACCOUNT_WASM, ...extra]);
}

export type Verdict = { allowed: true } | { allowed: false; reason: string };

/** The pure part: given what the chain says about each contract, is this host function one Kumbara pays for? */
export function judgeHostFunction(
  func: xdr.HostFunction,
  authAddresses: string[],
  ctx: { accountWasm: Set<string>; isAccount: (contractId: string) => boolean; usdc: string; vault: string },
): Verdict {
  const kind = func.switch().name;
  if (kind === "hostFunctionTypeCreateContractV2" || kind === "hostFunctionTypeCreateContract") {
    const args = kind === "hostFunctionTypeCreateContractV2" ? func.createContractV2() : func.createContract();
    const exec = args.executable();
    if (exec.switch().name !== "contractExecutableWasm") return { allowed: false, reason: "only Kumbara accounts can be deployed" };
    const wasm = Buffer.from(exec.wasmHash()).toString("hex");
    return ctx.accountWasm.has(wasm) ? { allowed: true } : { allowed: false, reason: `contract WASM ${wasm.slice(0, 8)}… is not a Kumbara account` };
  }
  if (kind !== "hostFunctionTypeInvokeContract") return { allowed: false, reason: `${kind} is not relayed` };
  const target = Address.fromScAddress(func.invokeContract().contractAddress()).toString();
  if (ctx.isAccount(target)) return { allowed: true };
  if (target !== ctx.usdc && target !== ctx.vault) return { allowed: false, reason: `calls to ${target.slice(0, 6)}… are not relayed` };
  return authAddresses.some((a) => ctx.isAccount(a)) ? { allowed: true } : { allowed: false, reason: "USDC and vault calls are relayed only when a Kumbara account authorises them" };
}

function authAddressesOf(entries: xdr.SorobanAuthorizationEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const creds = entry.credentials();
    if (creds.switch().name === "sorobanCredentialsAddress") out.push(Address.fromScAddress(creds.address().address()).toString());
  }
  return out;
}

export async function accountContracts(candidates: string[], wasm: Set<string>): Promise<Set<string>> {
  const contracts = [...new Set(candidates.filter((c) => c.startsWith("C")))];
  if (contracts.length === 0) return new Set();
  const keys = contracts.map((c) => xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: Address.fromString(c).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent() })));
  const res = await rpcServer().getLedgerEntries(...keys);
  const out = new Set<string>();
  for (const entry of res.entries) {
    const data = entry.val.contractData();
    const exec = data.val().instance().executable();
    if (exec.switch().name === "contractExecutableWasm" && wasm.has(Buffer.from(exec.wasmHash()).toString("hex"))) out.add(Address.fromScAddress(data.contract()).toString());
  }
  return out;
}

/** The relay body is { func, auth } (base64 XDR) or { xdr } (a whole transaction envelope). */
export async function checkRelayPayload(body: { func?: unknown; auth?: unknown; xdr?: unknown }): Promise<Verdict> {
  const calls: { func: xdr.HostFunction; auth: string[] }[] = [];
  try {
    if (typeof body.func === "string") {
      const auth = Array.isArray(body.auth) ? body.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(String(a), "base64")) : [];
      calls.push({ func: xdr.HostFunction.fromXDR(body.func, "base64"), auth: authAddressesOf(auth) });
    } else if (typeof body.xdr === "string") {
      const parsed = TransactionBuilder.fromXDR(body.xdr, networkPassphrase()) as Transaction | FeeBumpTransaction;
      const tx = "innerTransaction" in parsed ? parsed.innerTransaction : parsed;
      for (const op of tx.operations) {
        if (op.type !== "invokeHostFunction") return { allowed: false, reason: `${op.type} operations are not relayed` };
        calls.push({ func: op.func, auth: authAddressesOf(op.auth ?? []) });
      }
    }
  } catch {
    return { allowed: false, reason: "the payload is not valid XDR" };
  }
  if (calls.length === 0) return { allowed: false, reason: "nothing to relay" };
  const wasm = accountWasmHashes();
  const candidates = calls.flatMap(({ func, auth }) => (func.switch().name === "hostFunctionTypeInvokeContract" ? [Address.fromScAddress(func.invokeContract().contractAddress()).toString(), ...auth] : auth));
  // With every anchor down, calls on the account itself still pass; USDC calls wait for discovery to come back.
  const [accounts, usdc] = await Promise.all([accountContracts(candidates, wasm), discoverAnchor().then((a) => a.usdc.contractId, () => "")]);
  const ctx = { accountWasm: wasm, isAccount: (c: string) => accounts.has(c), usdc, vault: serverEnv.defindexVaultId() };
  for (const { func, auth } of calls) {
    const verdict = judgeHostFunction(func, auth, ctx);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}
