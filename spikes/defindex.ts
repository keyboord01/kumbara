/**
 * Gate 0 spike: DeFindex vault for the anchor's USDC.
 *
 * 1. Uses DEFINDEX_VAULT_ID if it accepts the anchor's USDC (and, when
 *    DEFINDEX_STRATEGY_ID is set, lists that strategy); otherwise deploys a
 *    vault through the DeFindex factory with the strategy attached from the
 *    start (the vault has no add_strategy). The testnet Blend strategies are
 *    for Blend's own test USDC, not Circle's, so the strategy is our own
 *    deployment of DeFindex's hodl strategy for the anchor's USDC.
 * 2. Deposits from the smart account (passkey-signed, relay-submitted) with
 *    invest=true, proves the funds reached the strategy, reads shares and
 *    underlying value, withdraws this run's shares back (the vault unwinds
 *    them from the strategy). Invest-on-deposit is proportional to the
 *    vault's current allocation, so on a fresh vault the Manager bootstraps
 *    it once with rebalance(Invest) and a 1 USDC seed position stays invested.
 * 3. Records how the token-scoped spending limit interacts with vault deposits.
 *
 *   DEFINDEX_STRATEGY_ID=C... pnpm spike:defindex
 */
import { Asset, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Anchor } from "./lib/anchor";
import { assertTestnet, networkPassphrase, optionalEnv } from "./lib/env";
import { ensureWallet, persistAuthenticator } from "./lib/kit";
import { Findings, contractLink, fail, info, ok, step, txLink, warn } from "./lib/log";
import { loadState, saveState } from "./lib/state";
import { addressScVal, changeTrust, ensureFunder, fromStroops, hasTrustline, i128, invokeFromClassic, readNative, toStroops, tokenBalance } from "./lib/stellar";
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
const strategyId = optionalEnv("DEFINDEX_STRATEGY_ID");
const invest = Boolean(strategyId);
let vaultId = optionalEnv("DEFINDEX_VAULT_ID") ?? loadState().vaultId;
let deployedNow = false;
if (vaultId) {
  const assets = await vaultAssets(vaultId);
  const acceptsAsset = assets.some((a) => a.address === usdcContract);
  const hasStrategy = !strategyId || assets.some((a) => a.strategies.some((st) => st.address === strategyId));
  if (acceptsAsset && hasStrategy) {
    ok(`vault ${vaultId} accepts ${usdcContract}${strategyId ? ` with strategy ${strategyId}` : ""}`);
  } else {
    warn(`vault ${vaultId} does not match (asset ok: ${acceptsAsset}, strategy ok: ${hasStrategy}); deploying a new one`);
    vaultId = undefined;
  }
}
if (!vaultId) {
  const factory = defindexFactoryId();
  const router = soroswapRouterId();
  if (strategyId) {
    const strategyAsset = await readNative<string>(strategyId, "asset");
    if (strategyAsset !== usdcContract) fail(`strategy ${strategyId} is for ${strategyAsset}, not ${usdcContract}`);
    ok(`strategy ${strategyId} reports asset ${strategyAsset}`);
  }
  const roles = xdr.ScVal.scvMap(
    [0, 1, 2, 3].map(
      (role) => new xdr.ScMapEntry({ key: xdr.ScVal.scvU32(role), val: addressScVal(funder.publicKey()) }),
    ),
  );
  const strategies = strategyId
    ? [
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("address"), val: addressScVal(strategyId) }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("name"), val: xdr.ScVal.scvString("Hodl USDC") }),
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("paused"), val: xdr.ScVal.scvBool(false) }),
        ]),
      ]
    : [];
  const assets = xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("address"), val: addressScVal(usdcContract) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("strategies"), val: xdr.ScVal.scvVec(strategies) }),
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

type ManagedFunds = Array<{ idle_amount: bigint; invested_amount: bigint; strategy_allocations: Array<{ amount: bigint; strategy_address: string }> }>;
async function managedFunds(): Promise<{ idle: bigint; invested: bigint; raw: ManagedFunds }> {
  const raw = await readNative<ManagedFunds>(vaultId!, "fetch_total_managed_funds");
  return { idle: BigInt(raw[0]?.idle_amount ?? 0n), invested: BigInt(raw[0]?.invested_amount ?? 0n), raw };
}
const strategyUsdc = async () => (strategyId ? tokenBalance(usdcContract, strategyId) : 0n);
const depositArgs = () => [xdr.ScVal.scvVec([i128(DEPOSIT)]), xdr.ScVal.scvVec([i128(DEPOSIT)]), addressScVal(wallet.contractId), xdr.ScVal.scvBool(invest)];

step(`Deposit 1 USDC into the vault from the smart account (passkey-signed, relay-submitted, invest=${invest})`);
const sharesBefore = await tokenBalance(vaultId, wallet.contractId);
const investedBefore = (await managedFunds()).invested;
const deposit = await call(wallet.kit, vaultId, "deposit", depositArgs());
persistAuthenticator(wallet.authenticator, wallet.contractId);
ok(`deposit confirmed: ${txLink(deposit.hash)}`);
const sharesAfter = await tokenBalance(vaultId, wallet.contractId);
const underlying = await readNative<bigint[]>(vaultId, "get_asset_amounts_per_shares", [i128(sharesAfter)]);
const usdcAfterDeposit = await tokenBalance(usdcContract, wallet.contractId);
ok(`vault shares ${fromStroops(sharesBefore)} -> ${fromStroops(sharesAfter)}; underlying ${underlying.map((u) => fromStroops(BigInt(u))).join(",")} USDC; wallet USDC now ${fromStroops(usdcAfterDeposit)}`);
const managed = await managedFunds();
const strategyBalance = await strategyUsdc();
ok(`vault idle ${fromStroops(managed.idle)} / invested ${fromStroops(managed.invested)} USDC${strategyId ? `; strategy holds ${fromStroops(strategyBalance)} USDC` : ""}`);
findings.set("deposit", { tx: deposit.hash, invest, sharesBefore: fromStroops(sharesBefore), sharesAfter: fromStroops(sharesAfter), underlyingUsdc: underlying.map((u) => fromStroops(BigInt(u))), totalManagedFunds: managed.raw, strategyUsdcAfterDeposit: fromStroops(strategyBalance) });

// The deposit whose shares this run withdraws again; earlier shares stay in the vault as the seed position.
let investTx = deposit.hash;
let proofSharesBefore = sharesBefore;
let proofSharesAfter = sharesAfter;
if (invest && strategyId && managed.invested - investedBefore < DEPOSIT) {
  // Fresh vault: invest-on-deposit is proportional to the current allocation (vault/src/investment.rs,
  // generate_investment_allocations invests only when the asset already has invested funds), so the
  // Manager bootstraps the allocation once with rebalance(Invest). Testnet only; the Manager is the spike funder.
  step("Bootstrap the allocation: Manager rebalance(Invest) moves the idle funds into the strategy");
  const instruction = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Invest"), addressScVal(strategyId), i128(managed.idle)]);
  const rebalance = await invokeFromClassic(funder, vaultId, "rebalance", [addressScVal(funder.publicKey()), xdr.ScVal.scvVec([instruction])]);
  const booted = await managedFunds();
  ok(`rebalance confirmed: ${txLink(rebalance.hash)}; vault idle ${fromStroops(booted.idle)} / invested ${fromStroops(booted.invested)} USDC; strategy holds ${fromStroops(await strategyUsdc())} USDC`);
  if (booted.invested < managed.idle) fail("rebalance(Invest) did not move the idle funds into the strategy");
  findings.set("bootstrapRebalance", { tx: rebalance.hash, investedUsdc: fromStroops(booted.invested), why: "invest-on-deposit follows the vault's current allocation, so a fresh vault needs one Manager Invest before deposits reach the strategy; the 1 USDC seed position stays invested" });

  step("Deposit 1 more USDC with invest=true: the deposit itself must reach the strategy");
  const second = await call(wallet.kit, vaultId, "deposit", depositArgs());
  persistAuthenticator(wallet.authenticator, wallet.contractId);
  const after = await managedFunds();
  const strategyAfterSecond = await strategyUsdc();
  ok(`deposit confirmed: ${txLink(second.hash)}; invested ${fromStroops(booted.invested)} -> ${fromStroops(after.invested)} USDC; strategy holds ${fromStroops(strategyAfterSecond)} USDC`);
  if (after.invested - booted.invested < DEPOSIT) fail("deposit with invest=true did not move funds into the strategy");
  investTx = second.hash;
  proofSharesBefore = sharesAfter;
  proofSharesAfter = await tokenBalance(vaultId, wallet.contractId);
  findings.set("investDeposit", { tx: second.hash, investedBefore: fromStroops(booted.invested), investedAfter: fromStroops(after.invested), strategyUsdcAfter: fromStroops(strategyAfterSecond) });
} else if (invest && strategyId) {
  ok(`invest path: deposit moved ${fromStroops(managed.invested - investedBefore)} USDC into the strategy`);
}
if (strategyId) findings.set("investTx", investTx);

const withdrawShares = proofSharesAfter - proofSharesBefore;
step(`Withdraw this run's ${fromStroops(withdrawShares)} shares back to the smart account${strategyId ? " (the vault unwinds them from the strategy; the seed position stays)" : ""}`);
const strategyBeforeWithdraw = await strategyUsdc();
const withdraw = await call(wallet.kit, vaultId, "withdraw", [i128(withdrawShares), xdr.ScVal.scvVec([i128(0n)]), addressScVal(wallet.contractId)]);
persistAuthenticator(wallet.authenticator, wallet.contractId);
const sharesFinal = await tokenBalance(vaultId, wallet.contractId);
const usdcFinal = await tokenBalance(usdcContract, wallet.contractId);
const managedAfter = await managedFunds();
const strategyAfter = await strategyUsdc();
ok(`withdraw confirmed: ${txLink(withdraw.hash)}; shares ${fromStroops(sharesFinal)}, wallet USDC ${fromStroops(usdcFinal)}; vault invested now ${fromStroops(managedAfter.invested)}${strategyId ? `, strategy holds ${fromStroops(strategyAfter)} (was ${fromStroops(strategyBeforeWithdraw)})` : ""}`);
if (strategyId && strategyAfter >= strategyBeforeWithdraw) fail("withdraw did not divest from the strategy");
findings.set("withdraw", { tx: withdraw.hash, divestsFromStrategy: Boolean(strategyId), sharesWithdrawn: fromStroops(withdrawShares), sharesKept: fromStroops(sharesFinal), walletUsdc: fromStroops(usdcFinal), usdcBeforeDeposit: fromStroops(balance), investedAfterWithdraw: fromStroops(managedAfter.invested), strategyUsdcBeforeWithdraw: fromStroops(strategyBeforeWithdraw), strategyUsdcAfterWithdraw: fromStroops(strategyAfter) });
if (strategyId) findings.set("divestTx", withdraw.hash);

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
