/**
 * Plays the bank for the newest pending deposit: tells the sandbox anchor,
 * through its SEP-6 sandbox hook, that the TRY transfer for that transaction
 * arrived. Deterministic rehearsal of the deposit flow; the /booth/admin
 * button does the same. Needs the database (run with node --env-file=.env).
 *
 *   pnpm demo:deposit                 # newest deposit awaiting a transfer
 *   pnpm demo:deposit --id dep_xxx    # a specific deposit
 *   pnpm demo:deposit --amount 250    # override the amount (TRY)
 */
import { PlayBankError, playBank } from "../lib/demo-bank";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

try {
  const input: Parameters<typeof playBank>[0] = {};
  const id = flag("--id");
  const amount = flag("--amount");
  if (id) input.depositId = id;
  if (amount) input.amountTry = amount;
  const result = await playBank(input);
  console.log(`✓ simulated bank transfer ${result.transferId} (${result.transferStatus}): ₺${result.amountTry} with reference ${result.reference} for deposit ${result.depositId}`);
  console.log("  the app's next poll picks it up and runs the on-ramp, the landing forward and the vault autopilot");
} catch (err) {
  console.error(err instanceof PlayBankError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
}
