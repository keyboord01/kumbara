/**
 * Reachability of the four things Kumbara depends on, each with latency,
 * measured on every call (no process memory).
 */
import "server-only";
import { Account, Address, BASE_FEE, Operation, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { activeAnchorHomeDomain, discoverAnchor } from "./anchor.server";
import { networkPassphrase, serverEnv } from "./env.server";

export interface DependencyStatus {
  ok: boolean;
  ms: number;
  detail: string;
}

export interface DependencyHealth {
  anchor: DependencyStatus;
  relay: DependencyStatus;
  rpc: DependencyStatus;
  vault: DependencyStatus;
  checkedAt: string;
}

const READ_ONLY = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
const TIMEOUT_MS = 6000;

async function timed(fn: () => Promise<string>): Promise<DependencyStatus> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, detail: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) };
  }
}

async function checkAnchor(): Promise<string> {
  // Reachability is measured live on the signboard itself; the parsed discovery may come from the data cache.
  const domain = await activeAnchorHomeDomain();
  const res = await fetch(`https://${domain}/.well-known/stellar.toml`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`stellar.toml HTTP ${res.status}`);
  const anchor = await discoverAnchor(domain);
  const parts = [anchor.orgName ?? domain, `SEP-6 deposit ${anchor.sep6?.deposit?.enabled ? "on" : "off"}`];
  if (anchor.treasury) parts.push(`treasury ${anchor.treasury.balance ?? "?"} ${anchor.usdc.code}${anchor.treasury.low ? " (low)" : ""}`);
  return parts.join(", ");
}

async function checkRelay(): Promise<string> {
  // Any HTTP answer means the relay is up; an unauthenticated probe is expected to be refused.
  const res = await fetch(`${serverEnv.sembolCloudUrl()}/`, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
  return `HTTP ${res.status}`;
}

async function checkRpc(): Promise<string> {
  const server = new rpc.Server(serverEnv.stellarRpcUrl());
  const ledger = await server.getLatestLedger();
  return `ledger ${ledger.sequence}, protocol ${ledger.protocolVersion}`;
}

async function checkVault(): Promise<string> {
  const server = new rpc.Server(serverEnv.stellarRpcUrl());
  const vault = serverEnv.defindexVaultId();
  const tx = new TransactionBuilder(READ_ONLY, { fee: BASE_FEE, networkPassphrase: networkPassphrase() })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(vault).toScAddress(), functionName: "name", args: [] })),
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error.slice(0, 120));
  return `vault ${vault.slice(0, 6)}… answers`;
}

export async function dependencyHealth(): Promise<DependencyHealth> {
  const [anchor, relay, rpcStatus, vault] = await Promise.all([timed(checkAnchor), timed(checkRelay), timed(checkRpc), timed(checkVault)]);
  return { anchor, relay, rpc: rpcStatus, vault, checkedAt: new Date().toISOString() };
}
