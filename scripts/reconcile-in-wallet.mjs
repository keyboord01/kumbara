// Reconcile deposit records stuck at in_wallet whose USDC verifiably reached
// the vault: the client signed the vault deposit through the relay (which
// recorded the transaction) but never reported it back, so the record stayed
// at in_wallet and the funnel shows it as a drop-off before in_vault.
//
// Evidence, per record: a relayed transaction to the vault within an hour of
// the record reaching in_wallet, not attributed to any other record, that
// Horizon shows as successful with a USDC transfer from that kumbara to the
// vault for exactly the amount the on-ramp paid. Matching records get what the
// app itself would have written (status in_vault, vaultTxHash, vaultDepositUsdc,
// a history entry at the chain time, a deposit_completed event) plus a
// reconciledAt stamp. Nothing else is touched; unmatched records are listed.
//
//   pnpm reconcile:in-wallet            dry run against production (prints the evidence)
//   pnpm reconcile:in-wallet --apply    write the matches
// Needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (the pnpm script loads .data/turso.prod.env).
import { createClient } from "@libsql/client";

const APP = process.env.APP_URL ?? "https://kumbara.sembol.xyz";
const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const apply = process.argv.includes("--apply");
const url = process.env.TURSO_DATABASE_URL;
if (!url || !url.startsWith("libsql://")) throw new Error("TURSO_DATABASE_URL must be the production libsql:// URL (load .data/turso.prod.env)");
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const info = await (await fetch(`${APP}/api/anchor/info?cb=${Date.now()}`)).json();
const VAULT = process.env.VAULT_ID ?? info.vault?.id;
if (!/^C[A-Z2-7]{55}$/.test(VAULT ?? "")) throw new Error("no vault id from /api/anchor/info");
const funnel = async (q) => {
  const d = await (await fetch(`${APP}/api/metrics?since=1${q}&cb=${Date.now()}`)).json();
  const f = d.funnel.deposits;
  return `${f.stages.map((s) => `${s.stage}=${s.count}`).join(" > ")} | exits ${JSON.stringify(f.exits)}`;
};
console.log(`vault ${VAULT}\nfunnel before (public):  ${await funnel("")}\nfunnel before (all):     ${await funnel("&include=all")}`);

const stuck = (await db.execute({ sql: "SELECT json FROM records WHERE kind = ? AND status = ? ORDER BY created_at", args: ["deposit", "in_wallet"] })).rows.map((r) => JSON.parse(r.json));
const used = new Set((await db.execute({ sql: "SELECT json FROM records WHERE kind = ? AND status = ?", args: ["deposit", "in_vault"] })).rows.map((r) => JSON.parse(r.json).vaultTxHash));
const projectId = (await db.execute({ sql: "SELECT project_id FROM events WHERE type = ? ORDER BY ts DESC LIMIT 1", args: ["deposit_completed"] })).rows[0]?.project_id ?? "kumbara";
console.log(`${stuck.length} deposit records at in_wallet\n`);

const plans = [];
const unmatched = [];
for (const r of stuck) {
  const t0 = Date.parse(r.history?.find((h) => h.status === "in_wallet")?.at ?? r.updatedAt);
  const events = (await db.execute({ sql: "SELECT ts, json FROM events WHERE type = ? AND ts BETWEEN ? AND ? ORDER BY ts", args: ["relayed_tx", t0 - 60_000, t0 + 60 * 60_000] })).rows
    .map((e) => ({ ts: e.ts, ...JSON.parse(e.json) }))
    .filter((e) => e.contract === VAULT && !used.has(e.hash));
  let match = null;
  for (const e of events) {
    const tx = await (await fetch(`${HORIZON}/transactions/${e.hash}`)).json().catch(() => null);
    if (!tx?.successful) continue;
    const ops = await (await fetch(`${HORIZON}/transactions/${e.hash}/operations`)).json().catch(() => null);
    const change = (ops?._embedded?.records ?? []).flatMap((op) => op.asset_balance_changes ?? [])
      .find((c) => c.type === "transfer" && c.asset_code === "USDC" && c.from === r.contractId && c.to === VAULT);
    if (!change) continue;
    if (Math.abs(Number(change.amount) - Number(r.paidUsdc)) > 5e-8) {
      console.log(`  ${r.id}: ${e.hash.slice(0, 8)} moves ${change.amount} USDC from this kumbara but the on-ramp paid ${r.paidUsdc}; skipped`);
      continue;
    }
    match = { hash: e.hash, at: tx.created_at, ledger: tx.ledger, amount: change.amount, delta: Math.round((e.ts - t0) / 1000) };
    break;
  }
  if (!match) { unmatched.push(r); console.log(`✗ ${r.id} ${r.ref ?? "user"} ${r.contractId.slice(0, 8)}… paid ${r.paidUsdc}: no verified vault deposit among ${events.length} candidate(s); left at in_wallet`); continue; }
  used.add(match.hash);
  plans.push({ r, match });
  console.log(`✓ ${r.id} ${(r.ref ?? "user").padEnd(4)} ${r.contractId.slice(0, 8)}… paid ${String(r.paidUsdc).padEnd(10)} → vault tx ${match.hash.slice(0, 12)}… +${match.delta}s after in_wallet, ${match.amount} USDC at ${match.at} (ledger ${match.ledger})`);
}
console.log(`\n${plans.length} verified, ${unmatched.length} unmatched`);

if (!apply) { console.log("dry run; pass --apply to write"); process.exit(0); }
let written = 0;
for (const { r, match } of plans) {
  const now = new Date().toISOString();
  const usdc = String(Number(match.amount)); // "3.9216000" → "3.9216", the form the app stores
  const next = { ...r, vaultTxHash: match.hash, vaultDepositUsdc: usdc, status: "in_vault", history: [...(r.history ?? []), { status: "in_vault", at: match.at }], reconciledAt: now, updatedAt: now };
  const res = await db.execute({ sql: "UPDATE records SET status = ?, updated_at = ?, json = ? WHERE id = ? AND kind = ? AND status = ?", args: ["in_vault", now, JSON.stringify(next), r.id, "deposit", "in_wallet"] });
  if (res.rowsAffected !== 1) { console.log(`  ${r.id}: not updated (status changed underneath?)`); continue; }
  const ts = Date.parse(match.at);
  const event = { type: "deposit_completed", ts, network: r.network, projectId, ref: r.ref ?? null, contractId: r.contractId, depositId: r.id, anchorTx: r.anchorTxHash ?? null, forwardTx: r.forwardTxHash ?? null, vaultTx: match.hash, usdc };
  await db.execute({ sql: "INSERT INTO events (type, ts, network, project_id, ref, json) VALUES (?, ?, ?, ?, ?, ?)", args: [event.type, ts, r.network, projectId, event.ref, JSON.stringify(event)] });
  written += 1;
  console.log(`  wrote ${r.id}: in_vault, vault tx ${match.hash.slice(0, 12)}…, deposit_completed event at ${match.at}`);
}
console.log(`\n${written} record(s) reconciled; waiting for the 30 s metrics cache`);
await new Promise((res) => setTimeout(res, 35_000));
console.log(`funnel after (public):   ${await funnel("")}\nfunnel after (all):      ${await funnel("&include=all")}`);
