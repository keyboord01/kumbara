/**
 * Gate 0 spike: TR Mock Anchor Partner API against a smart account.
 *
 * Answers, with real testnet transactions:
 *  1. Does POST /v1/onramps accept a C… destination? (No: recorded verbatim.)
 *  2. How does USDC arrive for a G… destination, and can it be moved into the
 *     smart account's SAC balance?
 *  3. Trustless landing account: can the on-ramp land on a key-less classic
 *     account whose only signers are pre-authorized "forward to kumbara" and
 *     "self-destruct" transactions?
 *  4. Off-ramp: does the anchor detect a contract-initiated SAC transfer to its
 *     treasury when the memo id is carried as a muxed destination?
 *
 *   pnpm spike:anchor
 */
import { Account, Asset, MuxedAccount } from "@stellar/stellar-sdk";
import { Anchor, AnchorError } from "./lib/anchor";
import { assertTestnet, horizonUrl, networkPassphrase } from "./lib/env";
import { createLandingAccount, submitPreauthorized } from "./lib/forwarder";
import { ensureWallet, persistAuthenticator } from "./lib/kit";
import { Findings, accountLink, contractLink, fail, info, ok, sleep, step, txLink, warn } from "./lib/log";
import { loadState, saveState } from "./lib/state";
import { addressScVal, changeTrust, classicBalance, describeTransaction, ensureFunder, fromStroops, hasTrustline, i128, invokeFromClassic, toStroops, tokenBalance } from "./lib/stellar";
import { transferToken } from "./lib/wallet";

assertTestnet();
const findings = new Findings("anchor");
const anchor = new Anchor();

step("Anchor discovery (health + stellar.toml)");
const health = await anchor.health();
const toml = await anchor.stellarToml();
if (health.asset.issuer !== toml.usdc.issuer) fail(`issuer mismatch: health=${health.asset.issuer} toml=${toml.usdc.issuer}`);
if (toml.networkPassphrase !== networkPassphrase()) fail(`anchor is on "${toml.networkPassphrase}", spikes run on "${networkPassphrase()}"`);
const usdc = new Asset(toml.usdc.code, toml.usdc.issuer);
const usdcContract = usdc.contractId(networkPassphrase());
ok(`USDC issuer ${toml.usdc.issuer} (SAC ${usdcContract})`);
info(`treasury ${health.treasury.address} holds ${health.treasury.usdc_balance} USDC; stellar_mode=${health.stellar_mode}`);
info(`rates: mid ${health.rates.mid_rate} buy ${health.rates.buy_rate} sell ${health.rates.sell_rate} (${health.rates.spread_bps} bps, ${health.rates.source})`);
findings.set("discovery", { issuer: toml.usdc.issuer, usdcContract, treasury: health.treasury.address, endpoints: toml.endpoints, rates: health.rates });

step("Accounts: smart account (C…) and a classic funder (G…) with a USDC trustline");
const wallet = await ensureWallet();
const funder = await ensureFunder();
if (!(await hasTrustline(funder.publicKey(), usdc))) {
  const t = await changeTrust(funder, usdc);
  ok(`funder trustline added: ${txLink(t.hash)}`);
}
info(`smart account ${wallet.contractId} ${contractLink(wallet.contractId)}`);
info(`funder ${funder.publicKey()} ${accountLink(funder.publicKey())}`);

step("Customer, deposit instructions, sandbox bank transfer");
let customerId = loadState().anchorCustomerId;
if (!customerId) {
  const customer = await anchor.createCustomer({
    first_name: "Kumbara",
    last_name: "Spike",
    iban: "TR330006100519786457841326",
    external_id: `kumbara-spike-${wallet.contractId.slice(-8)}`,
  });
  customerId = customer.id;
  saveState({ anchorCustomerId: customerId });
}
const instructions = await anchor.depositInstructions(customerId);
ok(`customer ${customerId}, reference ${instructions.reference}`);
info(`bank transfer pattern -> IBAN: ${instructions.iban_formatted} | alıcı: ${instructions.account_holder} | açıklama: ${instructions.reference}`);
const transfer = await anchor.sandboxBankTransfer({ reference: instructions.reference, amount_try: "300.00" });
ok(`sandbox bank transfer ${transfer.id} ${transfer.status} (${transfer.amount_try} TRY)`);
findings.set("depositInstructions", { bank_name: instructions.bank_name, iban: instructions.iban_formatted, account_holder: instructions.account_holder, reference: instructions.reference, rails: instructions.rails });

step("On-ramp to the smart account address (C…) directly");
const quoteC = await anchor.quote({ customer_id: customerId, side: "buy", amount: "100.00", amount_currency: "TRY" });
info(`quote ${quoteC.id}: ${quoteC.source_amount} TRY -> ${quoteC.destination_amount} USDC @ ${quoteC.rate}`);
try {
  const onramp = await anchor.createOnramp({ customer_id: customerId, quote_id: quoteC.id, destination_address: wallet.contractId });
  warn(`the anchor ACCEPTED a C-address (order ${onramp.id}); polling…`);
  const done = await anchor.pollOnramp(onramp.id);
  findings.set("cAddressOnramp", { accepted: true, order: done });
  info(`status=${done.status} settlement=${done.settlement} tx=${done.stellar_tx_hash}`);
} catch (err) {
  if (!(err instanceof AnchorError)) throw err;
  ok(`rejected: HTTP ${err.status} ${err.code}`);
  info(`message: ${err.message}`);
  findings.set("cAddressOnramp", { accepted: false, status: err.status, code: err.code, message: err.message });
}

step("On-ramp to a classic address (G…) for comparison");
const funderUsdcBefore = toStroops(await classicBalance(funder.publicKey(), usdc));
const quoteG = await anchor.quote({ customer_id: customerId, side: "buy", amount: "100.00", amount_currency: "TRY" });
const onrampG = await anchor.createOnramp({ customer_id: customerId, quote_id: quoteG.id, destination_address: funder.publicKey() });
info(`order ${onrampG.id} pending, ${onrampG.amount_try} TRY -> ${onrampG.amount_usdc} USDC`);
const doneG = await anchor.pollOnramp(onrampG.id);
if (doneG.status !== "completed" || !doneG.stellar_tx_hash) fail(`G-address on-ramp ended ${doneG.status}: ${doneG.failure_reason ?? doneG.pending_reason}`);
const gTx = await describeTransaction(doneG.stellar_tx_hash);
ok(`completed via ${doneG.settlement}: ${txLink(doneG.stellar_tx_hash)} (${gTx.operationTypes.join(",")})`);
await sleep(1500);
const funderUsdcAfter = toStroops(await classicBalance(funder.publicKey(), usdc));
if (funderUsdcAfter - funderUsdcBefore !== toStroops(doneG.amount_usdc)) fail(`funder balance moved by ${fromStroops(funderUsdcAfter - funderUsdcBefore)}, expected ${doneG.amount_usdc}`);
ok(`funder received exactly ${doneG.amount_usdc} USDC (quote said ${quoteG.destination_amount})`);
findings.set("gAddressOnramp", { order: doneG, tx: gTx, quoteDestinationAmount: quoteG.destination_amount });

step("Move the USDC from the classic account into the smart account (SAC transfer, classic source)");
const cBefore = await tokenBalance(usdcContract, wallet.contractId);
const moveAmount = toStroops(doneG.amount_usdc);
const move = await invokeFromClassic(funder, usdcContract, "transfer", [addressScVal(funder.publicKey()), addressScVal(wallet.contractId), i128(moveAmount)]);
const cAfter = await tokenBalance(usdcContract, wallet.contractId);
if (cAfter - cBefore !== moveAmount) fail(`smart account balance moved by ${fromStroops(cAfter - cBefore)}, expected ${fromStroops(moveAmount)}`);
ok(`smart account USDC balance ${fromStroops(cBefore)} -> ${fromStroops(cAfter)}: ${txLink(move.hash)}`);
findings.set("classicToContractTransfer", { tx: move.hash, before: fromStroops(cBefore), after: fromStroops(cAfter) });

step("Trustless landing account: quote -> lock account -> on-ramp -> pre-authorized forward -> self-destruct");
const quoteL = await anchor.quote({ customer_id: customerId, side: "buy", amount: "100.00", amount_currency: "TRY" });
const landingAmount = toStroops(quoteL.destination_amount);
info(`quote ${quoteL.id}: ${quoteL.source_amount} TRY -> ${quoteL.destination_amount} USDC, expires ${quoteL.expires_at}`);
const plan = await createLandingAccount({ usdc, usdcContract, destinationContract: wallet.contractId, amountStroops: landingAmount, sponsor: funder.publicKey() });
ok(`landing ${plan.publicKey} locked: trustline ${plan.trustlineTxHash.slice(0, 8)}…, setup ${plan.setupTxHash.slice(0, 8)}… (master weight 0, two pre-authorized signers)`);
if (Date.now() > Date.parse(quoteL.expires_at)) fail("quote expired during landing-account setup; rerun");
const onrampL = await anchor.createOnramp({ customer_id: customerId, quote_id: quoteL.id, destination_address: plan.publicKey });
const doneL = await anchor.pollOnramp(onrampL.id);
if (doneL.status !== "completed" || !doneL.stellar_tx_hash) fail(`landing on-ramp ended ${doneL.status}: ${doneL.failure_reason ?? doneL.pending_reason}`);
ok(`anchor paid the landing account via ${doneL.settlement}: ${txLink(doneL.stellar_tx_hash)}`);
if (toStroops(doneL.amount_usdc) !== landingAmount) fail(`anchor paid ${doneL.amount_usdc} but the pre-authorized forward is for ${fromStroops(landingAmount)}`);
const cBeforeForward = await tokenBalance(usdcContract, wallet.contractId);
const forward = await submitPreauthorized(plan.forwardTxXdr);
const cAfterForward = await tokenBalance(usdcContract, wallet.contractId);
if (cAfterForward - cBeforeForward !== landingAmount) fail(`forward moved ${fromStroops(cAfterForward - cBeforeForward)}, expected ${fromStroops(landingAmount)}`);
ok(`pre-authorized forward landed ${fromStroops(landingAmount)} USDC in the smart account: ${txLink(forward.hash)}`);
const cleanup = await submitPreauthorized(plan.cleanupTxXdr);
ok(`landing account self-destructed (trustline removed, XLM merged to sponsor): ${txLink(cleanup.hash)}`);
findings.set("trustlessLanding", {
  landingAccount: plan.publicKey,
  trustlineTx: plan.trustlineTxHash,
  setupTx: plan.setupTxHash,
  anchorPaymentTx: doneL.stellar_tx_hash,
  forwardTx: forward.hash,
  cleanupTx: cleanup.hash,
  amountUsdc: fromStroops(landingAmount),
  smartAccountAfter: fromStroops(cAfterForward),
});

step("Off-ramp: contract-initiated SAC transfer to the treasury with the memo as a muxed destination");
const offramp = await anchor.createOfframp({ customer_id: customerId, amount_usdc: "1.0000000", auto_payout: true });
info(`offramp ${offramp.id}: pay ${offramp.deposit.address} memo ${offramp.deposit.memo_type}:${offramp.deposit.memo}`);
const muxed = new MuxedAccount(new Account(offramp.deposit.address, "0"), offramp.deposit.memo).accountId();
info(`muxed destination ${muxed}`);
let offrampResult: Record<string, unknown> = {};
try {
  const pay = await transferToken(wallet.kit, usdcContract, muxed, toStroops("1"));
  persistAuthenticator(wallet.authenticator, wallet.contractId);
  ok(`smart account paid 1 USDC to the muxed treasury address via relay: ${txLink(pay.hash)}`);
  const payTx = await describeTransaction(pay.hash);
  const final = await anchor.pollOfframp(offramp.id, 120_000);
  offrampResult = { paymentTx: pay.hash, paymentEnvelope: payTx, offramp: final };
  if (final.status === "completed") {
    ok(`anchor matched the deposit and completed the off-ramp (payout ${String(final.payout_id ?? "")})`);
  } else {
    warn(`off-ramp still ${final.status} after 120s; checking where the USDC went`);
    const unmatched = await anchor.unmatchedDeposits();
    const payments = await (await fetch(`${horizonUrl()}/accounts/${offramp.deposit.address}/payments?order=desc&limit=5`)).json();
    const ops = await (await fetch(`${horizonUrl()}/transactions/${pay.hash}/operations`)).json();
    offrampResult = { ...offrampResult, unmatched, treasuryPaymentsRecent: (payments as { _embedded?: { records?: unknown[] } })._embedded?.records?.map((r) => (r as { type: string; transaction_hash: string }).type + ":" + (r as { transaction_hash: string }).transaction_hash.slice(0, 8)), ourOperations: (ops as { _embedded?: { records?: unknown[] } })._embedded?.records };
    warn(`unmatched-deposits: ${JSON.stringify(unmatched).slice(0, 300)}`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  warn(`muxed transfer failed: ${message}`);
  offrampResult = { error: message, offramp: await anchor.getOfframp(offramp.id) };
}
findings.set("offramp", offrampResult);

const file = findings.write();
ok(`findings written to ${file}`);
