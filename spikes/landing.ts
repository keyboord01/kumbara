/**
 * Gate 0 follow-up: landing-account on-ramp, ten times, plus one reverse
 * (off-ramp) landing account. Records whether the anchor's paid amount always
 * equals the quote and the net XLM cost per deposit.
 *
 *   pnpm spike:landing            # 10 on-ramps + 1 off-ramp
 *   RUNS=3 pnpm spike:landing
 */
import { Asset } from "@stellar/stellar-sdk";
import { Anchor } from "./lib/anchor";
import { assertTestnet, networkPassphrase, optionalEnv } from "./lib/env";
import { createLandingAccount, submitPreauthorized } from "./lib/forwarder";
import { ensureWallet, persistAuthenticator } from "./lib/kit";
import { Findings, fail, info, ok, step, txLink, warn } from "./lib/log";
import { relayFromEnv } from "./lib/relay";
import { loadState, saveState } from "./lib/state";
import { classicBalance, describeTransaction, ensureFunder, fromStroops, toStroops, tokenBalance } from "./lib/stellar";
import { transferToken } from "./lib/wallet";

assertTestnet();
const RUNS = Number(optionalEnv("RUNS") ?? "10");
const findings = new Findings("landing");
const anchor = new Anchor();
const relay = relayFromEnv();

step("Setup");
const toml = await anchor.stellarToml();
const health = await anchor.health();
const usdc = new Asset(toml.usdc.code, toml.usdc.issuer);
const usdcContract = usdc.contractId(networkPassphrase());
const sponsor = await ensureFunder();
const wallet = await ensureWallet();
let customerId = loadState().anchorCustomerId;
if (!customerId) {
  customerId = (await anchor.createCustomer({ first_name: "Kumbara", last_name: "Spike", iban: "TR330006100519786457841326" })).id;
  saveState({ anchorCustomerId: customerId });
}
const instructions = await anchor.depositInstructions(customerId);
await anchor.sandboxBankTransfer({ reference: instructions.reference, amount_try: String(RUNS * 100 + 100) + ".00" });
ok(`sponsor ${sponsor.publicKey()}, smart account ${wallet.contractId}, customer ${customerId}, ${RUNS} runs`);

interface RunResult {
  run: number;
  quoteId: string;
  quotedUsdc: string;
  paidUsdc: string;
  match: boolean;
  landing: string;
  createTx: string;
  lockTx: string;
  anchorTx: string;
  forwardTx: string;
  forwardVia: string;
  cleanupTx: string;
  cleanupVia: string;
  sponsorXlmDelta: string;
  relayFeesStroops: string;
  seconds: number;
}

const runs: RunResult[] = [];
for (let i = 1; i <= RUNS; i += 1) {
  step(`On-ramp ${i}/${RUNS}`);
  const started = Date.now();
  const sponsorBefore = toStroops(await classicBalance(sponsor.publicKey(), Asset.native()));
  const quote = await anchor.quote({ customer_id: customerId, side: "buy", amount: "100.00", amount_currency: "TRY" });
  const amount = toStroops(quote.destination_amount);
  const plan = await createLandingAccount({
    sponsor,
    usdc,
    usdcContract,
    kind: { type: "onramp", destinationContract: wallet.contractId, amountStroops: amount },
  });
  if (Date.now() > Date.parse(quote.expires_at)) fail(`quote expired during setup on run ${i}`);
  const onramp = await anchor.pollOnramp((await anchor.createOnramp({ customer_id: customerId, quote_id: quote.id, destination_address: plan.publicKey })).id);
  if (onramp.status !== "completed" || !onramp.stellar_tx_hash) fail(`run ${i}: on-ramp ${onramp.status} (${onramp.failure_reason ?? onramp.pending_reason})`);
  const match = toStroops(onramp.amount_usdc) === amount;
  if (!match) {
    warn(`run ${i}: anchor paid ${onramp.amount_usdc}, quote said ${quote.destination_amount}; forward NOT submitted`);
    runs.push({ run: i, quoteId: quote.id, quotedUsdc: quote.destination_amount, paidUsdc: onramp.amount_usdc, match, landing: plan.publicKey, createTx: plan.createTxHash, lockTx: plan.lockTxHash, anchorTx: onramp.stellar_tx_hash, forwardTx: "", forwardVia: "", cleanupTx: "", cleanupVia: "", sponsorXlmDelta: "", relayFeesStroops: "", seconds: 0 });
    continue;
  }
  const before = await tokenBalance(usdcContract, wallet.contractId);
  const forward = await submitPreauthorized(plan.forwardTxXdr, relay);
  const after = await tokenBalance(usdcContract, wallet.contractId);
  if (after - before !== amount) fail(`run ${i}: forward moved ${fromStroops(after - before)}, expected ${fromStroops(amount)}`);
  const cleanup = await submitPreauthorized(plan.cleanupTxXdr, relay);
  const sponsorAfter = toStroops(await classicBalance(sponsor.publicKey(), Asset.native()));
  const forwardInfo = await describeTransaction(forward.hash);
  const cleanupInfo = await describeTransaction(cleanup.hash);
  const relayFees = (forward.via === "relay" ? BigInt(forwardInfo.feeCharged) : 0n) + (cleanup.via === "relay" ? BigInt(cleanupInfo.feeCharged) : 0n);
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  ok(`quote ${quote.destination_amount} = paid ${onramp.amount_usdc}; forward via ${forward.via} ${txLink(forward.hash)}; cleanup via ${cleanup.via}; sponsor Δ ${fromStroops(sponsorAfter - sponsorBefore)} XLM; ${seconds}s`);
  runs.push({
    run: i,
    quoteId: quote.id,
    quotedUsdc: quote.destination_amount,
    paidUsdc: onramp.amount_usdc,
    match,
    landing: plan.publicKey,
    createTx: plan.createTxHash,
    lockTx: plan.lockTxHash,
    anchorTx: onramp.stellar_tx_hash,
    forwardTx: forward.hash,
    forwardVia: forward.via,
    cleanupTx: cleanup.hash,
    cleanupVia: cleanup.via,
    sponsorXlmDelta: fromStroops(sponsorAfter - sponsorBefore),
    relayFeesStroops: relayFees.toString(),
    seconds,
  });
}
findings.set("onrampRuns", runs);
const matched = runs.filter((r) => r.match).length;
info(`amount match: ${matched}/${runs.length}`);

step("Reverse landing account (off-ramp)");
const offramp = await anchor.createOfframp({ customer_id: customerId, amount_usdc: "2.0000000", auto_payout: true });
const offAmount = toStroops("2");
const sponsorBeforeOff = toStroops(await classicBalance(sponsor.publicKey(), Asset.native()));
const offPlan = await createLandingAccount({
  sponsor,
  usdc,
  usdcContract,
  kind: { type: "offramp", treasury: offramp.deposit.address, memoId: offramp.deposit.memo, amountStroops: offAmount },
});
const toLanding = await transferToken(wallet.kit, usdcContract, offPlan.publicKey, offAmount);
persistAuthenticator(wallet.authenticator, wallet.contractId);
ok(`smart account → landing ${fromStroops(offAmount)} USDC via relay: ${txLink(toLanding.hash)}`);
const pay = await submitPreauthorized(offPlan.forwardTxXdr, relay);
ok(`pre-authorized payment to treasury with memo ${offramp.deposit.memo} via ${pay.via}: ${txLink(pay.hash)}`);
const finalOff = await anchor.pollOfframp(offramp.id, 120_000);
const offCleanup = await submitPreauthorized(offPlan.cleanupTxXdr, relay);
const sponsorAfterOff = toStroops(await classicBalance(sponsor.publicKey(), Asset.native()));
if (finalOff.status === "completed") {
  ok(`anchor completed the off-ramp: received ${String(finalOff.received_usdc)} USDC → ${String(finalOff.amount_try)} TRY, payout ${String(finalOff.payout_id)}`);
} else {
  warn(`off-ramp ${finalOff.status} after 120s`);
}
findings.set("offrampRun", {
  offrampId: offramp.id,
  status: finalOff.status,
  receivedUsdc: finalOff.received_usdc,
  amountTry: finalOff.amount_try,
  payoutId: finalOff.payout_id,
  landing: offPlan.publicKey,
  createTx: offPlan.createTxHash,
  lockTx: offPlan.lockTxHash,
  walletToLandingTx: toLanding.hash,
  paymentTx: pay.hash,
  paymentVia: pay.via,
  cleanupTx: offCleanup.hash,
  cleanupVia: offCleanup.via,
  sponsorXlmDelta: fromStroops(sponsorAfterOff - sponsorBeforeOff),
});
findings.set("treasuryBefore", health.treasury.usdc_balance);
const file = findings.write();
ok(`findings written to ${file}`);
if (matched !== runs.length) fail(`${runs.length - matched} run(s) had an amount mismatch`);
