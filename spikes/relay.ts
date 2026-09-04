/**
 * Gate 0 spike: Sembol Cloud relay.
 *
 * Creates a smart account through the relay with the kumbara project key,
 * confirms the user paid no fees, installs the spending-limit policy through
 * the relay, and checks the failure modes (bad key, unreachable relay, no
 * relay configured) fail loudly with no XLM fallback.
 *
 *   pnpm spike:relay
 */
import { Asset } from "@stellar/stellar-sdk";
import { LEDGERS_PER_DAY, MemoryStorage, SmartAccountKit } from "smart-account-kit";
import { fetchStellarToml } from "./lib/anchor";
import { anchorBaseUrl, assertTestnet, networkPassphrase, rpcUrl } from "./lib/env";
import { createSmartAccount, RP_ID, ORIGIN } from "./lib/kit";
import { Findings, contractLink, fail, info, ok, step, txLink, warn } from "./lib/log";
import { SoftwareAuthenticator } from "./lib/passkey";
import { relayFromEnv, SembolCloudClient } from "./lib/relay";
import { loadState, saveState } from "./lib/state";
import { describeTransaction, fromStroops, tokenBalance } from "./lib/stellar";
import { SMART_ACCOUNT_TESTNET } from "./lib/testnet";
import { installSpendingLimit, readSpendingLimit } from "./lib/wallet";

assertTestnet();
const findings = new Findings("relay");

step("Relay target");
const relay = relayFromEnv();
info(relay.describe());
findings.set("relay", relay.describe());

step("Create a smart account through the relay (passkey signer, no XLM)");
const created = await createSmartAccount(`kumbara-relay-${Date.now()}`, relay);
ok(`smart account ${created.contractId}`);
info(contractLink(created.contractId));
info(txLink(created.hash));
const createTx = await describeTransaction(created.hash);
info(`envelope=${createTx.envelopeType} source=${createTx.sourceAccount} feeSource=${createTx.feeSource ?? "(source)"} feeCharged=${createTx.feeCharged} stroops`);
const xlm = await tokenBalance(SMART_ACCOUNT_TESTNET.nativeTokenContract, created.contractId);
if (xlm !== 0n) fail(`expected the new smart account to hold 0 XLM, it holds ${fromStroops(xlm)}`);
ok("the smart account holds 0 XLM: fees were paid by the relay's channel account");
findings.set("createWallet", { contractId: created.contractId, tx: createTx, smartAccountXlm: "0" });

if (!loadState().passkey) {
  saveState({ passkey: { ...created.authenticator.toState(), contractId: created.contractId } });
  info("saved as the spikes' shared smart account (spikes/.state.json)");
}

step("Install the spending-limit policy through the relay");
const toml = await fetchStellarToml(anchorBaseUrl());
const usdcContract = new Asset(toml.usdc.code, toml.usdc.issuer).contractId(networkPassphrase());
info(`USDC issuer from stellar.toml: ${toml.usdc.issuer} -> SAC ${usdcContract}`);
const LIMIT_USDC = 100n * 10_000_000n;
const limitTx = await installSpendingLimit(created.kit, created.authenticator.credentialId, usdcContract, LIMIT_USDC, LEDGERS_PER_DAY);
ok(`spending-limit rule installed: ${txLink(limitTx.hash)}`);
const limitTxInfo = await describeTransaction(limitTx.hash);
const limit = await readSpendingLimit(created.kit, usdcContract);
if (!limit || limit.limit !== LIMIT_USDC) fail(`spending limit not readable after install: ${JSON.stringify(limit)}`);
ok(`on-chain limit ${fromStroops(limit.limit)} USDC per ${limit.periodLedgers} ledgers (rule ${limit.ruleId})`);
findings.set("spendingLimit", { tx: limitTxInfo, ruleId: limit.ruleId, limitUsdc: fromStroops(limit.limit), periodLedgers: limit.periodLedgers });

step("Failure mode: wrong project key");
try {
  await createSmartAccount(`kumbara-badkey-${Date.now()}`, relayFromEnv({ projectKey: "sk_definitely_wrong" }));
  fail("a wrong project key was accepted by the relay");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ok(`rejected: ${message}`);
  findings.set("wrongKey", message);
}

step("Failure mode: relay unreachable (must fail loudly, never fall back to RPC)");
try {
  await createSmartAccount(`kumbara-down-${Date.now()}`, new SembolCloudClient({ url: "https://127.0.0.1:9/relay", projectId: "kumbara", projectKey: "x", timeoutMs: 10_000 }));
  fail("wallet creation succeeded with an unreachable relay");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ok(`failed loudly: ${message}`);
  findings.set("relayDown", message);
}

step("Failure mode: no relay configured at all");
const bare = new SmartAccountKit({
  rpcUrl: rpcUrl(),
  networkPassphrase: networkPassphrase(),
  accountWasmHash: SMART_ACCOUNT_TESTNET.accountWasmHash,
  webauthnVerifierAddress: SMART_ACCOUNT_TESTNET.webauthnVerifierAddress,
  storage: new MemoryStorage(),
  rpId: RP_ID,
  rpName: "Kumbara",
  webAuthn: new SoftwareAuthenticator(RP_ID, ORIGIN) as never,
});
try {
  await bare.createWallet("Kumbara", "no-relay", { autoSubmit: true });
  fail("the kit deployed a wallet without a relay");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ok(`refused before the passkey ceremony: ${message.split("\n")[0]}`);
  findings.set("noRelay", message);
}

step("Per-project budget and allowlist");
warn("Sembol Cloud (project keys, per-project budgets, allowlists) is not deployed anywhere reachable;");
warn("SEMBOL_CLOUD_URL currently points at the relay endpoint named above, whose own limits apply.");
findings.set("budgetAllowlist", "not verifiable: no Sembol Cloud deployment; the configured relay's per-key limits apply instead");

const file = findings.write();
ok(`findings written to ${file}`);
