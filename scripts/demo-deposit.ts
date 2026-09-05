/**
 * Plays the bank for the newest pending deposit: tells the sandbox anchor
 * that the TRY transfer with the deposit's reference arrived. Deterministic
 * rehearsal of the deposit flow.
 *
 *   pnpm demo:deposit                 # newest deposit awaiting a transfer
 *   pnpm demo:deposit --id dep_xxx    # a specific deposit
 *   pnpm demo:deposit --amount 250    # override the amount (TRY)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = (process.env.ANCHOR_BASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.ANCHOR_API_KEY ?? "";
if (!base || !key) {
  console.error("ANCHOR_BASE_URL and ANCHOR_API_KEY are required (run with node --env-file=.env)");
  process.exit(1);
}

interface Deposit {
  id: string;
  status: string;
  amountTry: string;
  createdAt: string;
  instructions: { reference: string };
}

const dir = path.join(process.cwd(), ".data", "kumbara", "deposits");
let deposits: Deposit[] = [];
try {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  deposits = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as Deposit));
} catch {
  deposits = [];
}
const wanted = flag("--id");
const target = wanted
  ? deposits.find((d) => d.id === wanted)
  : deposits.filter((d) => d.status === "awaiting_transfer").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
if (!target) {
  console.error(wanted ? `deposit ${wanted} not found` : "no deposit is awaiting a transfer (start one in the app first)");
  process.exit(1);
}
const amount = flag("--amount") ?? target.amountTry;
const res = await fetch(`${base}/v1/sandbox/bank-transfers`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-API-Key": key },
  body: JSON.stringify({ reference: target.instructions.reference, amount_try: Number(amount).toFixed(2), sender_name: "Kumbara demo" }),
});
const body = (await res.json()) as { id?: string; status?: string; error?: { message?: string } };
if (!res.ok) {
  console.error(`anchor rejected the transfer: ${body.error?.message ?? res.status}`);
  process.exit(1);
}
console.log(`✓ simulated bank transfer ${body.id} (${body.status}): ₺${Number(amount).toFixed(2)} with reference ${target.instructions.reference} for deposit ${target.id}`);
console.log("  the app's next poll picks it up and runs the on-ramp, the landing forward and the vault autopilot");
