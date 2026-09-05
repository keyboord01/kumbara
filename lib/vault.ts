/**
 * Read-only DeFindex vault views from the browser (RPC simulation). The vault
 * is a share token: `balance(user)` gives shares, `get_asset_amounts_per_shares`
 * converts them to USDC. `get_assets` tells whether any strategy is active.
 */
import { Account, Address, BASE_FEE, Operation, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

const READ_ONLY = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");

export interface VaultPosition {
  shares: bigint;
  usdc: bigint;
  name: string;
  activeStrategy: boolean;
}

async function read(server: rpc.Server, passphrase: string, contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<unknown> {
  const tx = new TransactionBuilder(READ_ONLY, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contractId).toScAddress(), functionName: fn, args }),
        ),
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) throw new Error(`vault ${fn} failed`);
  return scValToNative(sim.result.retval);
}

export async function readVaultPosition(rpcUrl: string, passphrase: string, vaultId: string, address: string): Promise<VaultPosition> {
  const server = new rpc.Server(rpcUrl);
  const [shares, name, assets] = await Promise.all([
    read(server, passphrase, vaultId, "balance", [Address.fromString(address).toScVal()]) as Promise<bigint>,
    read(server, passphrase, vaultId, "name") as Promise<string>,
    read(server, passphrase, vaultId, "get_assets") as Promise<Array<{ strategies: Array<{ paused: boolean }> }>>,
  ]);
  let usdc = 0n;
  if (BigInt(shares) > 0n) {
    const amounts = (await read(server, passphrase, vaultId, "get_asset_amounts_per_shares", [xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString(shares.toString()) }))])) as bigint[];
    usdc = BigInt(amounts[0] ?? 0n);
  }
  const activeStrategy = assets.some((a) => a.strategies.some((s) => !s.paused));
  return { shares: BigInt(shares), usdc, name, activeStrategy };
}

/** SEP-41 `balance(id)` of any G… or C… address, in stroops. */
export async function readTokenBalance(rpcUrl: string, passphrase: string, tokenContract: string, address: string): Promise<bigint> {
  const server = new rpc.Server(rpcUrl);
  const value = (await read(server, passphrase, tokenContract, "balance", [Address.fromString(address).toScVal()])) as bigint;
  return BigInt(value);
}

export interface VaultTotals {
  totalSupply: bigint;
  totalAssets: bigint;
}

/** Share supply and total managed USDC, for converting an amount into shares. */
export async function readVaultTotals(rpcUrl: string, passphrase: string, vaultId: string): Promise<VaultTotals> {
  const server = new rpc.Server(rpcUrl);
  const [supply, managed] = await Promise.all([
    read(server, passphrase, vaultId, "total_supply") as Promise<bigint>,
    read(server, passphrase, vaultId, "fetch_total_managed_funds") as Promise<Array<{ total_amount: bigint }>>,
  ]);
  return { totalSupply: BigInt(supply), totalAssets: BigInt(managed[0]?.total_amount ?? 0n) };
}

/**
 * Shares to burn so the vault pays out at least `amount` (stroops): the
 * proportional amount rounded up plus one share of slack. Any excess USDC
 * simply stays in the kumbara.
 */
export function sharesForAmount(amount: bigint, totals: VaultTotals): bigint {
  if (totals.totalSupply === 0n || totals.totalAssets === 0n) return amount;
  const exact = (amount * totals.totalSupply + totals.totalAssets - 1n) / totals.totalAssets;
  return exact + 1n;
}
