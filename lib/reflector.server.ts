/**
 * USD/TRY from Reflector's foreign-exchange oracle (Stellar mainnet), read by
 * simulation. The oracle quotes each asset in its base (USD) with 14
 * decimals, so USD/TRY = 1 / price(TRY).
 */
import "server-only";
import { Account, Address, BASE_FEE, Operation, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { serverEnv } from "./env.server";

export interface Rate {
  usdTry: number;
  source: "reflector" | "anchor";
  oracle: string | null;
  observedAt: string;
}

const READ_ONLY = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
const MAINNET = "Public Global Stellar Network ; September 2015";

async function read(server: rpc.Server, oracle: string, fn: string, args: xdr.ScVal[]): Promise<unknown> {
  const tx = new TransactionBuilder(READ_ONLY, { fee: BASE_FEE, networkPassphrase: MAINNET })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({ contractAddress: Address.fromString(oracle).toScAddress(), functionName: fn, args }),
        ),
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) throw new Error(`oracle ${fn} failed`);
  return scValToNative(sim.result.retval);
}

let cached: { rate: Rate; at: number } | null = null;
const TTL_MS = 60_000;

export async function usdTryRate(): Promise<Rate> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  const oracle = serverEnv.reflectorFxOracle();
  try {
    const server = new rpc.Server(serverEnv.reflectorRpcUrl());
    const decimals = Number(await read(server, oracle, "decimals", []));
    const asset = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol("TRY")]);
    const price = (await read(server, oracle, "lastprice", [asset])) as { price: bigint; timestamp: bigint } | null;
    if (!price) throw new Error("no TRY price");
    const tryInUsd = Number(price.price) / 10 ** decimals;
    const rate: Rate = {
      usdTry: 1 / tryInUsd,
      source: "reflector",
      oracle,
      observedAt: new Date(Number(price.timestamp) * 1000).toISOString(),
    };
    cached = { rate, at: Date.now() };
    return rate;
  } catch {
    // Fallback: the anchor's mid rate, itself sourced from Reflector.
    const res = await fetch(`${serverEnv.anchorBaseUrl()}/v1/rates`, {
      headers: { "X-API-Key": serverEnv.anchorApiKey() },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("no rate source available");
    const body = (await res.json()) as { mid_rate: string };
    const rate: Rate = { usdTry: Number(body.mid_rate), source: "anchor", oracle: null, observedAt: new Date().toISOString() };
    cached = { rate, at: Date.now() };
    return rate;
  }
}
