// Preflight for the scheduled production E2E run: skip (not fail) when the
// sponsor account is below SPONSOR_MIN_XLM + 5, so the run never drains it.
// Writes skip=true|false to $GITHUB_OUTPUT when present.
//   APP_URL=https://kumbara.sembol.xyz node scripts/ci-preflight.mjs
import { appendFileSync } from "node:fs";

const APP = process.env.APP_URL ?? "https://kumbara.sembol.xyz";
const MARGIN_XLM = 5;

const res = await fetch(`${APP}/api/health?cb=${Date.now()}`, { headers: { accept: "application/json" } });
const text = await res.text();
let health;
try {
  health = JSON.parse(text);
} catch {
  console.error(`health answered ${res.status} with a non-JSON body (deployment protection on?): ${text.slice(0, 120)}`);
  process.exit(1);
}
const sponsor = health.sponsor;
const deps = health.dependencies ?? {};
console.log(`health ok=${health.ok} network=${health.network} anchor=${deps.anchor?.ok} relay=${deps.relay?.ok} rpc=${deps.rpc?.ok} vault=${deps.vault?.ok}`);
let skip = false;
let reason = "";
if (!sponsor) {
  skip = true;
  reason = "sponsor balance unavailable";
} else {
  console.log(`sponsor ${sponsor.balanceXlm} XLM (min ${sponsor.minXlm}, run needs ≥ ${sponsor.minXlm + MARGIN_XLM})`);
  if (sponsor.balanceXlm < sponsor.minXlm + MARGIN_XLM) {
    skip = true;
    reason = `sponsor ${sponsor.balanceXlm} XLM is below SPONSOR_MIN_XLM + ${MARGIN_XLM}`;
  }
}
if (skip) console.log(`SKIP: ${reason}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\nreason=${reason}\n`);
