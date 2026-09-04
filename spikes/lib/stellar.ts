/**
 * Thin Stellar helpers shared by the spikes: RPC/Horizon clients, friendbot,
 * read-only contract simulation, classic-account signing and SAC math.
 */
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  StrKey,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { horizonUrl, networkPassphrase, rpcUrl } from "./env";
import { info, sleep } from "./log";
import { loadState, saveState } from "./state";
import { FRIENDBOT_URL } from "./testnet";

let serverInstance: rpc.Server | null = null;

export function server(): rpc.Server {
  if (!serverInstance) serverInstance = new rpc.Server(rpcUrl());
  return serverInstance;
}

/** A source account for simulations only; it never needs to exist on-chain. */
export const READ_ONLY_SOURCE = new Account(
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "0",
);

export const SEVEN_DECIMALS = 10_000_000n;

/** "12.3456789" -> 123456789n (7 decimals, truncating extra digits). */
export function toStroops(amount: string | number): bigint {
  const [whole = "0", frac = ""] = String(amount).trim().split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole) * SEVEN_DECIMALS + BigInt(fracPadded);
}

/** 123456789n -> "12.3456789" */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / SEVEN_DECIMALS;
  const frac = (abs % SEVEN_DECIMALS).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export async function friendbot(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`Friendbot failed (${res.status}): ${await res.text()}`);
  }
  // 400 = already funded; both are fine for our purposes.
  for (let i = 0; i < 20; i += 1) {
    try {
      await server().getAccount(publicKey);
      return;
    } catch {
      await sleep(1500);
    }
  }
  throw new Error(`Friendbot funded ${publicKey} but the account never appeared`);
}

/** A funded classic account the spikes control (created once, kept in state). */
export async function ensureFunder(): Promise<Keypair> {
  const state = loadState();
  if (state.funder) {
    const kp = Keypair.fromSecret(state.funder.secret);
    try {
      await server().getAccount(kp.publicKey());
      return kp;
    } catch {
      info("funder account missing on-chain (testnet reset?), re-funding");
      await friendbot(kp.publicKey());
      return kp;
    }
  }
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  saveState({ funder: { secret: kp.secret(), publicKey: kp.publicKey() } });
  return kp;
}

export async function simulateRead(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<xdr.ScVal> {
  const tx = new TransactionBuilder(READ_ONLY_SOURCE, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: fn,
            args,
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${fn} on ${contractId} failed: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`simulate ${fn} on ${contractId} returned no value`);
  return retval;
}

export async function readNative<T = unknown>(contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<T> {
  return scValToNative(await simulateRead(contractId, fn, args)) as T;
}

/** SEP-41 balance of any G… or C… address on a token contract, in stroops. */
export async function tokenBalance(tokenContract: string, address: string): Promise<bigint> {
  const value = await readNative<bigint>(tokenContract, "balance", [
    Address.fromString(address).toScVal(),
  ]);
  return BigInt(value);
}

export function addressScVal(address: string): xdr.ScVal {
  return Address.fromString(address).toScVal();
}

export function i128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export interface SubmitResult {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
}

/** Send a signed (or pre-authorized) transaction through RPC and wait for it. */
export async function submitTransaction(tx: Transaction): Promise<SubmitResult> {
  const sent = await server().sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(
      `sendTransaction rejected ${sent.hash}: ${sent.errorResult?.toXDR("base64") ?? "unknown"}`,
    );
  }
  const result = await server().pollTransaction(sent.hash, { attempts: 40 });
  if (result.status !== "SUCCESS") {
    const detail =
      result.status === "FAILED" ? result.resultXdr?.toXDR("base64") : "not found / timed out";
    throw new Error(`transaction ${sent.hash} ${result.status}: ${detail}`);
  }
  const out: SubmitResult = { hash: sent.hash, ledger: result.ledger };
  if (result.returnValue) out.returnValue = result.returnValue;
  return out;
}

/** Invoke a contract function from a classic account (source-account auth). */
export async function invokeFromClassic(
  source: Keypair,
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<SubmitResult> {
  const account = await server().getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: fn,
            args,
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(120)
    .build();
  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation of ${fn} failed: ${sim.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(source);
  return submitTransaction(prepared);
}

export async function changeTrust(source: Keypair, asset: Asset, limit?: string): Promise<SubmitResult> {
  const account = await server().getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(Operation.changeTrust(limit ? { asset, limit } : { asset }))
    .setTimeout(120)
    .build();
  tx.sign(source);
  return submitTransaction(tx);
}

export async function hasTrustline(publicKey: string, asset: Asset): Promise<boolean> {
  const res = await fetch(`${horizonUrl()}/accounts/${publicKey}`);
  if (!res.ok) return false;
  const body = (await res.json()) as { balances: Array<{ asset_code?: string; asset_issuer?: string }> };
  return body.balances.some((b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
}

export async function classicBalance(publicKey: string, asset: Asset): Promise<string> {
  const res = await fetch(`${horizonUrl()}/accounts/${publicKey}`);
  if (!res.ok) throw new Error(`Horizon account lookup failed: ${res.status}`);
  const body = (await res.json()) as {
    balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
  };
  const line = body.balances.find(
    (b) =>
      (asset.isNative() && b.asset_type === "native") ||
      (b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()),
  );
  return line?.balance ?? "0";
}

export interface TxSummary {
  hash: string;
  envelopeType: string;
  sourceAccount: string;
  feeSource?: string;
  feeCharged: string;
  operationTypes: string[];
}

/** Inspect a confirmed transaction: envelope type, who paid, what it did. */
export async function describeTransaction(hash: string): Promise<TxSummary> {
  const res = await server().getTransaction(hash);
  if (res.status !== "SUCCESS") throw new Error(`transaction ${hash} is ${res.status}`);
  const envelope = res.envelopeXdr;
  const isFeeBump = envelope.switch().name === "envelopeTypeTxFeeBump";
  const inner = isFeeBump ? envelope.feeBump().tx().innerTx().v1().tx() : envelope.v1().tx();
  const sourceAccount = muxedToAddress(inner.sourceAccount());
  const feeSource = isFeeBump ? muxedToAddress(envelope.feeBump().tx().feeSource()) : undefined;
  const summary: TxSummary = {
    hash,
    envelopeType: envelope.switch().name,
    sourceAccount,
    feeCharged: res.resultXdr.feeCharged().toString(),
    operationTypes: inner.operations().map((op) => op.body().switch().name),
  };
  if (feeSource) summary.feeSource = feeSource;
  return summary;
}

function muxedToAddress(muxed: xdr.MuxedAccount): string {
  if (muxed.switch().name === "keyTypeEd25519") {
    return StrKey.encodeEd25519PublicKey(muxed.ed25519());
  }
  return StrKey.encodeEd25519PublicKey(muxed.med25519().ed25519());
}
