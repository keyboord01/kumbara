/**
 * Diagnostic: fee-bump the landing account's pre-authorized transactions from
 * the funder (instead of the relay) so the inner result code is visible.
 *   pnpm exec node --env-file=.env --import tsx spikes/probe-landing.ts
 */
import { Asset, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { Anchor } from "./lib/anchor";
import { assertTestnet, networkPassphrase } from "./lib/env";
import { createLandingAccount } from "./lib/forwarder";
import { ensureWallet } from "./lib/kit";
import { info, ok, step, warn } from "./lib/log";
import { loadState } from "./lib/state";
import { ensureFunder, fromStroops, server, toStroops, tokenBalance } from "./lib/stellar";

assertTestnet();
const anchor = new Anchor();
const toml = await anchor.stellarToml();
const usdc = new Asset(toml.usdc.code, toml.usdc.issuer);
const usdcContract = usdc.contractId(networkPassphrase());
const sponsor = await ensureFunder();
const wallet = await ensureWallet();
const customerId = loadState().anchorCustomerId!;

step("landing + on-ramp");
const quote = await anchor.quote({ customer_id: customerId, side: "buy", amount: "100.00", amount_currency: "TRY" });
const amount = toStroops(quote.destination_amount);
const plan = await createLandingAccount({ sponsor, usdc, usdcContract, kind: { type: "onramp", destinationContract: wallet.contractId, amountStroops: amount } });
const onramp = await anchor.pollOnramp((await anchor.createOnramp({ customer_id: customerId, quote_id: quote.id, destination_address: plan.publicKey })).id);
ok(`anchor paid ${onramp.amount_usdc} (${onramp.status})`);

async function feeBump(label: string, innerXdr: string) {
  const inner = TransactionBuilder.fromXDR(innerXdr, networkPassphrase()) as Transaction;
  const innerEnv = inner.toEnvelope().v1();
  info(`${label}: inner fee=${inner.fee} seq=${inner.sequence} sigs=${innerEnv.signatures().length} ops=${inner.operations.length}`);
  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, "1000", inner, networkPassphrase());
  bump.sign(sponsor);
  const sent = await server().sendTransaction(bump);
  if (sent.status === "ERROR") {
    const res = sent.errorResult!;
    const r = res.result();
    warn(`${label}: sendTransaction ERROR outer=${r.switch().name}`);
    try {
      const innerPair = r.innerResultPair();
      const innerRes = innerPair.result().result();
      warn(`${label}: inner=${innerRes.switch().name}`);
      if (innerRes.switch().name === "txFailed" || innerRes.switch().name === "txSuccess") {
        for (const op of innerRes.results()) warn(`  op ${op.switch().name} ${op.tr?.().switch?.().name ?? ""}`);
      }
    } catch (e) {
      warn(`${label}: could not decode inner: ${String(e)}`);
    }
    info(`raw: ${res.toXDR("base64")}`);
    return false;
  }
  const polled = await server().pollTransaction(sent.hash, { attempts: 40 });
  if (polled.status === "SUCCESS") {
    ok(`${label}: SUCCESS ${sent.hash} fee charged ${polled.resultXdr.feeCharged().toString()}`);
    return true;
  }
  warn(`${label}: ${polled.status} ${polled.status === "FAILED" ? polled.resultXdr.toXDR("base64") : ""}`);
  return false;
}

step("fee-bump forward from sponsor");
const before = await tokenBalance(usdcContract, wallet.contractId);
const fwd = await feeBump("forward", plan.forwardTxXdr);
const after = await tokenBalance(usdcContract, wallet.contractId);
info(`smart account USDC ${fromStroops(before)} -> ${fromStroops(after)}`);

step("fee-bump cleanup from sponsor");
if (fwd) await feeBump("cleanup", plan.cleanupTxXdr);
