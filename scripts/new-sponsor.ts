/**
 * Create a fresh testnet sponsor: a new keypair funded with ~50 XLM from a
 * throwaway Friendbot account. Prints the public key only; the secret is
 * written to the file given as the first argument (default .data/sponsor.env).
 *
 *   node --import tsx scripts/new-sponsor.ts [.data/sponsor.env] [50]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Keypair, Networks, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";

const out = process.argv[2] ?? ".data/sponsor.env";
const amount = process.argv[3] ?? "50";
const server = new rpc.Server("https://soroban-testnet.stellar.org");

const sponsor = Keypair.random();
const temp = Keypair.random();
const fb = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(temp.publicKey())}`);
if (!fb.ok) throw new Error(`friendbot HTTP ${fb.status}`);
let account = null;
for (let i = 0; i < 20 && !account; i += 1) {
  try {
    account = await server.getAccount(temp.publicKey());
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}
if (!account) throw new Error("friendbot account did not appear");
const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.createAccount({ destination: sponsor.publicKey(), startingBalance: amount }))
  .setTimeout(120)
  .build();
tx.sign(temp);
const sent = await server.sendTransaction(tx);
if (sent.status === "ERROR") throw new Error(`createAccount rejected: ${sent.errorResult?.toXDR("base64")}`);
const polled = await server.pollTransaction(sent.hash, { attempts: 30 });
if (polled.status !== "SUCCESS") throw new Error(`createAccount ${polled.status}`);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `SPONSOR_SECRET=${sponsor.secret()}\n`, { mode: 0o600 });
console.log(`✓ sponsor ${sponsor.publicKey()} funded with ${amount} XLM (tx ${sent.hash})`);
console.log(`  secret written to ${out} (not printed)`);
