/**
 * Gate 0 spike: DeFindex vault for the anchor's USDC.
 *
 * 1. Uses DEFINDEX_VAULT_ID if it accepts the anchor's USDC; otherwise deploys
 *    a vault through the DeFindex factory (no strategies yet: the testnet Blend
 *    strategies are for Blend's own test USDC, not Circle's).
 * 2. Deposits from the smart account (passkey-signed, relay-submitted),
 *    reads shares and underlying value, withdraws everything back.
 * 3. Records how the token-scoped spending limit interacts with vault deposits.
 *
 *   pnpm spike:defindex
 */
import { Asset, Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Anchor } from "./lib/anchor";
import { assertTestnet, networkPassphrase, optionalEnv } from "./lib/env";
import { ensureWallet, persistAuthenticator } from "./lib/kit";
import { Findings, contractLink, fail, info, ok, step, txLink, warn } from "./lib/log";
import { loadState, saveState } from "./lib/state";
import { addressScVal, changeTrust, classicBalance, ensureFunder, fromStroops, hasTrustline, i128, invokeFromClassic, readNative, toStroops, tokenBalance } from "./lib/stellar";
import { defindexFactoryId, soroswapRouterId } from "./lib/testnet";
import { call, readSpendingLimit } from "./lib/wallet";

assertTestnet();
const findings = new Findings("defindex");
const anchor = new Anchor();

step("Anchor USDC (from stellar.toml)");
const toml = await anchor.stellarToml();
const usdc = new Asset(toml.usdc.code, toml.usdc.issuer);
const usdcContract = usdc.contractId(networkPassphrase());
ok(`USDC SAC ${usdcContract}`);

interface AssetStrategySet {
  address: string;
  strategies: Array<{ address: string; name: string; paused: boolean }>;
}

async function vaultAssets(vaultId: string): Promise<AssetStrategySet[]> {
  return readNative<AssetStrategySet[]>(vaultId, "get_assets");
}

step("Find or deploy a DeFindex vault that accepts this USDC");
const funder = await ensureFunder();
let vaultId = optionalEnv("DEFINDEX_VAULT_ID") ?? loadState().vaultId;
let deployedNow = false;
if (vaultId) {
  const assets = await vaultAssets(vaultId);
  if (assets.some((a) => a.address === usdcContract)) {
    ok(`vault ${vaultId} accepts ${usdcContract}`);
  } else {
    warn(`vault ${vaultId} accepts ${assets.map((a) => a.address).join(",")}, not the anchor's USDC; deploying a new one`);
    vaultId = undefined;
  }
}
if (!vaultId) {
  const factory = defindexFactoryId();
  const router = soroswapRouterId();
  const roles = xdr.ScVal.scvMap(
    [0, 1, 2, 3].map(
      (role) => new xdr.ScMapEntry({ key: xdr.ScVal.scvU32(role), val: addressScVal(funder.publicKey()) }),
    ),
  );
  const assets = xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("address"), val: addressScVal(usdcContract) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("strategies"), val: xdr.ScVal.scvVec([]) }),
    ]),
  ]);
  const nameSymbol = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvString("name"), val: xdr.ScVal.scvString("Kumbara USDC") }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvString("symbol"), val: xdr.ScVal.scvString("KMBRUSDC") }),
  ]);
  const args = [roles, xdr.ScVal.scvU32(0), assets, addressScVal(router), nameSymbol, xdr.ScVal.scvBool(false)];
  const result = await invokeFromClassic(funder, factory, "create_defindex_vault", args);
  if (!result.returnValue) fail("factory returned no vault address");
  vaultId = String(scValToNative(result.returnValue));
  deployedNow = true;
  saveState({ vaultId });
  ok(`deployed vault ${vaultId} via factory ${factory}: ${txLink(result.hash)}`);
  info(`add to .env: DEFINDEX_VAULT_ID=${vaultId}`);
  findings.set("vaultDeployTx", result.hash);
}
info(contractLink(vaultId));
const name = await readNative<string>(vaultId, "name");
const symbol = await readNative<string>(vaultId, "symbol");
const assets = await vaultAssets(vaultId);
ok(`vault "${name}" (${symbol}), assets ${JSON.stringify(assets)}`);
findings.set("vault", { id: vaultId, name, symbol, assets, deployedNow, factory: defindexFactoryId() });

step("Smart account with USDC");
const wallet = await ensureWallet();
const DEPOSIT = toStroops("1");
let balance = await tokenBalance(usdcContract, wallet.contractId);
if (balance < DEPOSIT) {
  info(`smart account holds ${fromStroops(balance)} USDC; topping up through the anchor (G on-ramp + SAC transfer)`);
  if (!(await hasTrustline(funder.publicKey(), usdc))) await changeTrust(funder, usdc);
  let customerId = loadState().anchorCustomerId;
  if (!customerId) {
    customerId = (await anchor.createCustomer({ first_name: "Kumbara", last_name: "Spike", iban: "TR330006100519786457841326" })).id;
    saveState({ anchorCustomerId: customerId });
  }
  const instructions = await anchor.depositInstructions(customerId);
  await anchor.sandboxBankTransfer({ reference: instructions.reference, amount_try: "150.00" });
  const onramp = await anchor.pollOnramp((await anchor.createOnramp({ customer_id: customerId, amount_try: "100.00", destination_address: funder.publicKey() })).id);
  if (onramp.status !== "completed") fail(`top-up on-ramp ${onramp.status}`);
  const amount = toStroops(onramp.amount_usdc);
  await invokeFromClassic(funder, usdcContract, "transfer", [addressScVal(funder.publicKey()), addressScVal(wallet.contractId), i128(amount)]);
  balance = await tokenBalance(usdcContract, wallet.contractId);
}
ok(`smart account ${wallet.contractId} holds ${fromStroops(balance)} USDC`);

step("Deposit 1 USDC into the vault from the smart account (passkey-signed, relay-submitted)");
const sharesBefore = await tokenBalance(vaultId, wallet.contractId);
const deposit = await call(wallet.kit, vaultId, "deposit", [
  xdr.ScVal.scvVec([i128(DEPOSIT)]),
  xdr.ScVal.scvVec([i128(DEPOSIT)]),
  addressScVal(wallet.contractId),
  xdr.ScVal.scvBool(false),
]);
persistAuthenticator(wallet.authenticator, wallet.contractId);
ok(`deposit confirmed: ${txLink(deposit.hash)}`);
const sharesAfter = await tokenBalance(vaultId, wallet.contractId);
const underlying = await readNative<bigint[]>(vaultId, "get_asset_amounts_per_shares", [i128(sharesAfter)]);
const usdcAfterDeposit = await tokenBalance(usdcContract, wallet.contractId);
ok(`vault shares ${fromStroops(sharesBefore)} -> ${fromStroops(sharesAfter)}; underlying ${underlying.map((u) => fromStroops(BigInt(u))).join(",")} USDC; wallet USDC now ${fromStroops(usdcAfterDeposit)}`);
const managed = await readNative<unknown>(vaultId, "fetch_total_managed_funds");
findings.set("deposit", { tx: deposit.hash, sharesBefore: fromStroops(sharesBefore), sharesAfter: fromStroops(sharesAfter), underlyingUsdc: underlying.map((u) => fromStroops(BigInt(u))), totalManagedFunds: managed });

step("Withdraw all shares back to the smart account");
const withdraw = await call(wallet.kit, vaultId, "withdraw", [i128(sharesAfter), xdr.ScVal.scvVec([i128(0n)]), addressScVal(wallet.contractId)]);
persistAuthenticator(wallet.authenticator, wallet.contractId);
const sharesFinal = await tokenBalance(vaultId, wallet.contractId);
const usdcFinal = await tokenBalance(usdcContract, wallet.contractId);
ok(`withdraw confirmed: ${txLink(withdraw.hash)}; shares ${fromStroops(sharesFinal)}, wallet USDC ${fromStroops(usdcFinal)}`);
findings.set("withdraw", { tx: withdraw.hash, sharesAfter: fromStroops(sharesFinal), walletUsdc: fromStroops(usdcFinal), usdcBeforeDeposit: fromStroops(balance) });

step("Spending limit vs. vault deposit (does the token-scoped limit count deposits?)");
const limit = await readSpendingLimit(wallet.kit, usdcContract);
if (!limit) {
  warn("no spending-limit rule on this account (run pnpm spike:relay first); skipping");
  findings.set("spendingLimitInteraction", "skipped: no limit installed");
} else {
  info(`limit ${fromStroops(limit.limit)} USDC / ${limit.periodLedgers} ledgers, spent ${fromStroops(limit.spent)}`);
  const over = limit.limit + toStroops("1");
  let outcome: string;
  if (usdcFinal < over) {
    outcome = `not testable: wallet holds ${fromStroops(usdcFinal)} USDC, below the limit+1 (${fromStroops(over)})`;
    warn(outcome);
  } else {
    try {
      const tx = await call(wallet.kit, vaultId, "deposit", [xdr.ScVal.scvVec([i128(over)]), xdr.ScVal.scvVec([i128(over)]), addressScVal(wallet.contractId), xdr.ScVal.scvBool(false)]);
      outcome = `over-limit deposit SUCCEEDED (${tx.hash}): the limit does not cover vault deposits`;
      warn(outcome);
    } catch (err) {
      outcome = `over-limit deposit rejected: ${err instanceof Error ? err.message : String(err)}`;
      ok(outcome);
    }
    persistAuthenticator(wallet.authenticator, wallet.contractId);
  }
  const after = await readSpendingLimit(wallet.kit, usdcContract);
  findings.set("spendingLimitInteraction", { limitUsdc: fromStroops(limit.limit), spentBefore: fromStroops(limit.spent), spentAfter: after ? fromStroops(after.spent) : null, outcome });
}

const file = findings.write();
ok(`findings written to ${file}`);
