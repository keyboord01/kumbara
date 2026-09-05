/**
 * Plays the bank for the newest pending deposit: tells the sandbox anchor
 * that the TRY transfer with the deposit's reference arrived. Deterministic
 * rehearsal of the deposit flow; the /booth/admin button does the same.
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

const anchorBaseUrl = process.env.ANCHOR_BASE_URL ?? "";
const anchorApiKey = process.env.ANCHOR_API_KEY ?? "";
if (!anchorBaseUrl || !anchorApiKey) {
  console.error("ANCHOR_BASE_URL and ANCHOR_API_KEY are required (run with node --env-file=.env)");
  process.exit(1);
}

try {
  const input: Parameters<typeof playBank>[0] = { anchorBaseUrl, anchorApiKey };
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
