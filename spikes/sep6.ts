/**
 * SEP-6 spike: can the bridge account do SEP-10 → SEP-38 → SEP-6 before it is locked, and does
 * the anchor then pay the locked account directly (no pending_trust, no claimable balance)?
 *   node --env-file=.env --import tsx spikes/sep6.ts
 * Writes docs/spike-findings/sep6.json. Testnet only; friendbot funds the throwaway accounts.
 */
import { writeFileSync } from "node:fs";
import { Account, Asset, BASE_FEE, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { anchorBaseUrl, assertTestnet } from "./lib/env.js";
import { changeTrust, classicBalance, describeTransaction, ensureFunder, friendbot, hasTrustline, server, submitTransaction } from "./lib/stellar.js";

assertTestnet();
const PASSPHRASE = Networks.TESTNET;
const SANDBOX_IBAN = "TR330006100519786457841326";
const t0 = Date.now();
const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const log = (...a: unknown[]) => console.log(`[${now()}s]`, ...a);
const findings: Record<string, unknown> = { recordedAt: new Date().toISOString() };

interface Toml { homeDomain: string; webAuth: string; transfer: string; quotes: string | undefined; kyc: string | undefined; signingKey: string; usdcIssuer: string }
async function discover(base: string): Promise<Toml> {
  const text = await (await fetch(`${base}/.well-known/stellar.toml`)).text();
  const get = (k: string) => text.match(new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
  const cur = text.split("[[CURRENCIES]]").slice(1).map((b) => ({ code: b.match(/code\s*=\s*"([^"]+)"/)?.[1], issuer: b.match(/issuer\s*=\s*"([^"]+)"/)?.[1] })).find((c) => c.code === "USDC");
  if (!get("WEB_AUTH_ENDPOINT") || !get("TRANSFER_SERVER") || !cur?.issuer) throw new Error(`stellar.toml at ${base} lacks WEB_AUTH_ENDPOINT / TRANSFER_SERVER / USDC`);
  return { homeDomain: new URL(base).host, webAuth: get("WEB_AUTH_ENDPOINT")!, transfer: get("TRANSFER_SERVER")!, quotes: get("ANCHOR_QUOTE_SERVER"), kyc: get("KYC_SERVER"), signingKey: get("SIGNING_KEY")!, usdcIssuer: cur.issuer };
}
async function sep10(toml: Toml, kp: Keypair): Promise<{ token: string; ms: number; lifetime: number }> {
  const s = Date.now();
  const ch = (await (await fetch(`${toml.webAuth}?account=${kp.publicKey()}&home_domain=${toml.homeDomain}`)).json()) as { transaction: string; network_passphrase: string };
  const tx = new Transaction(ch.transaction, ch.network_passphrase);
  if (tx.source !== toml.signingKey) throw new Error("challenge not signed by SIGNING_KEY");
  tx.sign(kp);
  const res = await fetch(toml.webAuth, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transaction: tx.toXDR() }) });
  const body = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(`SEP-10 ${res.status}: ${body.error ?? JSON.stringify(body)}`);
  const claims = JSON.parse(Buffer.from(body.token.split(".")[1]!, "base64url").toString()) as { exp: number; iat: number };
  return { token: body.token, ms: Date.now() - s, lifetime: claims.exp - claims.iat };
}
async function sep12(toml: Toml, token: string, fields: Record<string, string>): Promise<{ status: string; ms: number }> {
  if (!toml.kyc) return { status: "no KYC_SERVER", ms: 0 };
  const s = Date.now();
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const put = await fetch(`${toml.kyc}/customer`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: form });
  const putBody = await put.text();
  const get = (await (await fetch(`${toml.kyc}/customer`, { headers: { authorization: `Bearer ${token}` } })).json()) as { status?: string };
  if (!put.ok) throw new Error(`SEP-12 PUT ${put.status}: ${putBody.slice(0, 200)}`);
  return { status: get.status ?? "?", ms: Date.now() - s };
}
async function sep38Quote(toml: Toml, token: string, body: Record<string, string>): Promise<{ id: string; buy_amount: string; sell_amount: string; price: string; expires_at: string; ms: number }> {
  const s = Date.now();
  const res = await fetch(`${toml.quotes}/quote`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const q = (await res.json()) as { id: string; buy_amount: string; sell_amount: string; price: string; expires_at: string; error?: string };
  if (!res.ok) throw new Error(`SEP-38 quote ${res.status}: ${q.error ?? JSON.stringify(q)}`);
  return { ...q, ms: Date.now() - s };
}
async function sep6(toml: Toml, token: string, path: string, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown>; ms: number }> {
  const s = Date.now();
  const res = await fetch(`${toml.transfer}/${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, ms: Date.now() - s };
}
async function sep6Tx(toml: Toml, token: string, id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${toml.transfer}/transaction?id=${id}`, { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as { transaction: Record<string, unknown> }).transaction;
}
async function pollSep6(toml: Toml, token: string, id: string, until: string[], maxMs: number): Promise<{ statuses: { status: string; at: string }[]; final: Record<string, unknown>; ms: number }> {
  const s = Date.now(); const statuses: { status: string; at: string }[] = []; let last = "";
  for (;;) {
    const tx = await sep6Tx(toml, token, id);
    const st = String(tx.status);
    if (st !== last) { statuses.push({ status: st, at: now() + "s" }); log("  sep6 status:", st); last = st; }
    if (until.includes(st) || st === "error" || Date.now() - s > maxMs) return { statuses, final: tx, ms: Date.now() - s };
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function lockBridge(sponsor: Keypair, kp: Keypair, forward: Transaction, cleanup: Transaction): Promise<string> {
  // Sourced by the sponsor with bridge-sourced operations, exactly like production: the bridge's own sequence stays at seq,
  // so the pre-authorized forward (seq+1) and cleanup (seq+2) remain valid.
  const acct = await server().getAccount(sponsor.publicKey());
  const lock = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: PASSPHRASE })
    .addOperation(Operation.setOptions({ source: kp.publicKey(), signer: { preAuthTx: forward.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ source: kp.publicKey(), signer: { preAuthTx: cleanup.hash(), weight: 1 } }))
    .addOperation(Operation.setOptions({ source: kp.publicKey(), masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(120).build();
  lock.sign(sponsor, kp);
  return (await submitTransaction(lock)).hash;
}

const base = anchorBaseUrl();
const toml = await discover(base);
findings.discovery = toml;
log("discovered:", toml.transfer, toml.quotes, toml.kyc, "USDC issuer", toml.usdcIssuer.slice(0, 8) + "…");
const usdc = new Asset("USDC", toml.usdcIssuer);
const funder = await ensureFunder();
if (!(await hasTrustline(funder.publicKey(), usdc))) await changeTrust(funder, usdc);
log("funder", funder.publicKey().slice(0, 8) + "…", "USDC", await classicBalance(funder.publicKey(), usdc));

// ---------------- 1. deposit through SEP-6 with a locked bridge account ----------------
const dep: Record<string, unknown> = {};
try {
  const bridge = Keypair.random();
  const tCreate = Date.now();
  await friendbot(bridge.publicKey());
  await changeTrust(bridge, usdc);
  dep.createMs = Date.now() - tCreate;
  log("bridge", bridge.publicKey(), "created with USDC trustline (friendbot stands in for the sponsor)");
  const auth = await sep10(toml, bridge); dep.sep10Ms = auth.ms; dep.jwtLifetimeS = auth.lifetime; log("SEP-10 ok", auth.ms + "ms, token lifetime", auth.lifetime + "s");
  const kyc = await sep12(toml, auth.token, { first_name: "Kumbara", last_name: "Spike" }); dep.sep12 = kyc; log("SEP-12", kyc.status, kyc.ms + "ms");
  const quote = await sep38Quote(toml, auth.token, { sell_asset: "iso4217:TRY", buy_asset: `stellar:USDC:${toml.usdcIssuer}`, sell_amount: "100", sell_delivery_method: "bank_account", context: "sep6" });
  dep.quote = { id: quote.id, sell: quote.sell_amount, buy: quote.buy_amount, price: quote.price, expires: quote.expires_at, ms: quote.ms }; log("SEP-38 quote", quote.id, "100 TRY →", quote.buy_amount, "USDC @", quote.price, quote.ms + "ms");
  const req = await sep6(toml, auth.token, "deposit-exchange", { source_asset: "iso4217:TRY", destination_asset: "USDC", amount: "100", quote_id: quote.id, account: bridge.publicKey(), type: "bank_account" });
  dep.depositRequest = { status: req.status, ms: req.ms, keys: Object.keys(req.body), instructions: req.body.instructions ?? req.body.how, id: req.body.id, eta: req.body.eta, moreInfo: req.body.more_info_url };
  log("SEP-6 deposit-exchange HTTP", req.status, req.ms + "ms", JSON.stringify(req.body).slice(0, 400));
  if (req.status !== 200) throw new Error(`deposit-exchange failed: ${JSON.stringify(req.body)}`);
  const txId = String(req.body.id);
  const before = await sep6Tx(toml, auth.token, txId);
  dep.initialTx = { status: before.status, amount_in: before.amount_in, amount_out: before.amount_out, amount_fee: before.amount_fee, quote_id: before.quote_id };
  const payAmount = String(before.amount_out ?? quote.buy_amount);
  log("anchor will pay", payAmount, "USDC; initial status", before.status);
  // lock: forward (seq+1) pays the exact amount to the funder (stands in for the smart account), cleanup (seq+2) merges
  const acct = await server().getAccount(bridge.publicKey());
  const seq = BigInt(acct.sequenceNumber());
  const forward = new TransactionBuilder(new Account(bridge.publicKey(), seq.toString()), { fee: "1000", networkPassphrase: PASSPHRASE }).addOperation(Operation.payment({ destination: funder.publicKey(), asset: usdc, amount: payAmount })).setTimeout(0).build();
  const cleanup = new TransactionBuilder(new Account(bridge.publicKey(), (seq + 1n).toString()), { fee: "1000", networkPassphrase: PASSPHRASE }).addOperation(Operation.changeTrust({ asset: usdc, limit: "0" })).addOperation(Operation.accountMerge({ destination: funder.publicKey() })).setTimeout(0).build();
  forward.sign(bridge); cleanup.sign(bridge);
  const tLock = Date.now(); dep.lockTx = await lockBridge(funder, bridge, forward, cleanup); dep.lockMs = Date.now() - tLock; log("locked", dep.lockTx, dep.lockMs + "ms");
  try { await sep10(toml, bridge); dep.sep10AfterLock = "ACCEPTED (unexpected)"; } catch (e) { dep.sep10AfterLock = `rejected: ${(e as Error).message.slice(0, 120)}`; }
  log("SEP-10 after the lock:", dep.sep10AfterLock);
  bridge.rawSecretKey().fill(0);
  // play the bank through the SEP-6 sandbox hook
  const tBank = Date.now();
  const sim = await fetch(`${toml.transfer}/tx/${txId}/simulate-bank-transfer`, { method: "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" }, body: "{}" });
  dep.simulate = { status: sim.status, body: (await sim.text()).slice(0, 200) };
  log("simulate-bank-transfer HTTP", sim.status, dep.simulate);
  const settled = await pollSep6(toml, auth.token, txId, ["completed"], 180_000);
  dep.statuses = settled.statuses; dep.settleMs = Date.now() - tBank; dep.finalTx = { status: settled.final.status, amount_out: settled.final.amount_out, stellar_transaction_id: settled.final.stellar_transaction_id, completed_at: settled.final.completed_at };
  const paid = await classicBalance(bridge.publicKey(), usdc);
  dep.bridgeBalanceAfterAnchor = paid; dep.exactMatch = paid === payAmount || Number(paid) === Number(payAmount);
  log("bridge USDC after settlement", paid, "(expected", payAmount + ") match:", dep.exactMatch);
  if (settled.final.stellar_transaction_id) { const d = await describeTransaction(String(settled.final.stellar_transaction_id)); dep.anchorPaymentOps = d; log("anchor tx ops:", JSON.stringify(d).slice(0, 200)); }
  const tFwd = Date.now(); const f = await submitTransaction(forward); dep.forwardTx = f.hash; dep.forwardMs = Date.now() - tFwd; log("forward", f.hash);
  const tCl = Date.now(); const c = await submitTransaction(cleanup); dep.cleanupTx = c.hash; dep.cleanupMs = Date.now() - tCl; log("cleanup", c.hash);
  dep.totalMs = Date.now() - tCreate; dep.ok = true;
} catch (e) { dep.ok = false; dep.error = (e as Error).message; log("DEPOSIT SPIKE FAILED:", dep.error); }
findings.sep6Deposit = dep;

// ---------------- 2. withdrawal through SEP-6 with a reverse bridge ----------------
const wd: Record<string, unknown> = {};
try {
  const bridge = Keypair.random(); const tStart = Date.now();
  await friendbot(bridge.publicKey()); await changeTrust(bridge, usdc);
  const auth = await sep10(toml, bridge); wd.sep10Ms = auth.ms;
  await sep12(toml, auth.token, { first_name: "Kumbara", last_name: "Spike" });
  const quote = await sep38Quote(toml, auth.token, { sell_asset: `stellar:USDC:${toml.usdcIssuer}`, buy_asset: "iso4217:TRY", sell_amount: "1", buy_delivery_method: "bank_account", context: "sep6" });
  wd.quote = { id: quote.id, sell: quote.sell_amount, buy: quote.buy_amount, price: quote.price }; log("withdraw quote: 1 USDC →", quote.buy_amount, "TRY");
  const req = await sep6(toml, auth.token, "withdraw-exchange", { source_asset: "USDC", destination_asset: "iso4217:TRY", amount: "1", quote_id: quote.id, type: "bank_account", dest: SANDBOX_IBAN, account: bridge.publicKey() });
  wd.withdrawRequest = { status: req.status, ms: req.ms, body: req.body }; log("SEP-6 withdraw-exchange HTTP", req.status, JSON.stringify(req.body).slice(0, 300));
  if (req.status !== 200) throw new Error(`withdraw-exchange failed: ${JSON.stringify(req.body)}`);
  const txId = String(req.body.id); const dest = String(req.body.account_id); const memoType = String(req.body.memo_type); const memoVal = String(req.body.memo);
  const memo = memoType === "id" ? Memo.id(memoVal) : memoType === "hash" ? Memo.hash(memoVal) : Memo.text(memoVal);
  const acct = await server().getAccount(bridge.publicKey()); const seq = BigInt(acct.sequenceNumber());
  const forward = new TransactionBuilder(new Account(bridge.publicKey(), seq.toString()), { fee: "1000", networkPassphrase: PASSPHRASE }).addOperation(Operation.payment({ destination: dest, asset: usdc, amount: "1.0000000" })).addMemo(memo).setTimeout(0).build();
  const cleanup = new TransactionBuilder(new Account(bridge.publicKey(), (seq + 1n).toString()), { fee: "1000", networkPassphrase: PASSPHRASE }).addOperation(Operation.changeTrust({ asset: usdc, limit: "0" })).addOperation(Operation.accountMerge({ destination: funder.publicKey() })).setTimeout(0).build();
  forward.sign(bridge); cleanup.sign(bridge);
  wd.lockTx = await lockBridge(funder, bridge, forward, cleanup); bridge.rawSecretKey().fill(0); log("reverse bridge locked", wd.lockTx);
  // the user's kumbara pays the bridge (the funder stands in)
  const pay = new TransactionBuilder(await server().getAccount(funder.publicKey()), { fee: BASE_FEE, networkPassphrase: PASSPHRASE }).addOperation(Operation.payment({ destination: bridge.publicKey(), asset: usdc, amount: "1.0000000" })).setTimeout(120).build();
  pay.sign(funder); wd.userPaymentTx = (await submitTransaction(pay)).hash;
  const tFwd = Date.now(); wd.forwardTx = (await submitTransaction(forward)).hash; wd.forwardMs = Date.now() - tFwd; log("forward to anchor with memo", wd.forwardTx);
  const settled = await pollSep6(toml, auth.token, txId, ["completed"], 180_000);
  wd.statuses = settled.statuses; wd.finalTx = { status: settled.final.status, amount_in: settled.final.amount_in, amount_out: settled.final.amount_out, external_transaction_id: settled.final.external_transaction_id, completed_at: settled.final.completed_at }; wd.anchorSettleMs = settled.ms;
  wd.cleanupTx = (await submitTransaction(cleanup)).hash; wd.totalMs = Date.now() - tStart; wd.ok = true;
} catch (e) { wd.ok = false; wd.error = (e as Error).message; log("WITHDRAW SPIKE FAILED:", wd.error); }
findings.sep6Withdraw = wd;


// ---------------- 3. testanchor.stellar.org as a second anchor config ----------------
const ta: Record<string, unknown> = {};
try {
  const t2 = await discover("https://testanchor.stellar.org"); ta.discovery = t2;
  const bridge = Keypair.random(); await friendbot(bridge.publicKey()); await changeTrust(bridge, new Asset("USDC", t2.usdcIssuer));
  const auth = await sep10(t2, bridge); ta.sep10Ms = auth.ms;
  let kyc: unknown; try { kyc = await sep12(t2, auth.token, { first_name: "Kumbara", last_name: "Spike", email_address: "spike@example.com" }); } catch (e) { kyc = (e as Error).message; }
  ta.sep12 = kyc; log("testanchor SEP-12:", JSON.stringify(kyc).slice(0, 160));
  const req = await sep6(t2, auth.token, "deposit", { asset_code: "USDC", amount: "2", type: "SEPA", account: bridge.publicKey() });
  ta.depositRequest = { status: req.status, body: req.body }; log("testanchor SEP-6 deposit HTTP", req.status, JSON.stringify(req.body).slice(0, 300));
  if (req.status === 200 && req.body.id) {
    const first = await sep6Tx(t2, auth.token, String(req.body.id));
    const needs = (await (await fetch(`${t2.kyc}/customer?transaction_id=${req.body.id}`, { headers: { authorization: `Bearer ${auth.token}` } })).json()) as { status?: string; fields?: Record<string, { description?: string; optional?: boolean }> };
    ta.kycNeeded = { status: needs.status, fields: Object.fromEntries(Object.entries(needs.fields ?? {}).map(([k, v]) => [k, v.optional ? "optional" : "required"])) };
    log("testanchor KYC for the deposit:", JSON.stringify(ta.kycNeeded).slice(0, 300), "| tx status", first.status, JSON.stringify(first.required_info_updates ?? "").slice(0, 200));
    const extra: Record<string, string> = { first_name: "Kumbara", last_name: "Spike", email_address: "spike@example.com", address: "Istanbul", bank_account_number: "TR330006100519786457841326", bank_number: "00061", bank_account_type: "checking", mobile_number: "+905550000000", birth_date: "1990-01-01", address_country_code: "TUR", state_or_province: "Istanbul", city: "Istanbul", postal_code: "34000", id_type: "passport", id_number: "U12345678", id_country_code: "TUR", id_issue_date: "2020-01-01", id_expiration_date: "2030-01-01" };
    const wanted = Object.fromEntries(Object.entries(extra).filter(([k]) => !needs.fields || k in needs.fields || k === "first_name" || k === "last_name" || k === "email_address"));
    try { ta.sep12Second = await sep12(t2, auth.token, wanted); } catch (e) { ta.sep12Second = (e as Error).message; }
    const w = await pollSep6(t2, auth.token, String(req.body.id), ["completed", "pending_user_transfer_start"], 90_000);
    ta.statuses = w.statuses; ta.final = { status: w.final.status, instructions: w.final.instructions, how: w.final.how, more_info_url: w.final.more_info_url, required_info_message: w.final.required_info_message };
    log("testanchor deposit final:", JSON.stringify(ta.final).slice(0, 400));
  }
  ta.ok = true;
} catch (e) { ta.ok = false; ta.error = (e as Error).message; log("TESTANCHOR SPIKE FAILED:", ta.error); }
findings.testanchor = ta;

writeFileSync("docs/spike-findings/sep6.json", JSON.stringify(findings, null, 2));
log("findings written to docs/spike-findings/sep6.json");
console.log("\nSUMMARY", JSON.stringify({ deposit: { ok: dep.ok, sep10Ms: dep.sep10Ms, quoteMs: (dep.quote as { ms?: number })?.ms, settleMs: dep.settleMs, totalMs: dep.totalMs, statuses: (dep.statuses as { status: string }[] | undefined)?.map((s) => s.status), exactMatch: dep.exactMatch, sep10AfterLock: dep.sep10AfterLock }, withdraw: { ok: wd.ok, anchorSettleMs: wd.anchorSettleMs, totalMs: wd.totalMs, statuses: (wd.statuses as { status: string }[] | undefined)?.map((s) => s.status) }, testanchor: { ok: ta.ok, depositStatus: (ta.depositRequest as { status?: number })?.status, statuses: (ta.statuses as { status: string }[] | undefined)?.map((s) => s.status) } }, null, 1));
