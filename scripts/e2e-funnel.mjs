// Funnel end-to-end: the metrics carry per-stage counts for deposits and
// withdrawals computed from stored records, monotonic down the pipeline,
// with seed and E2E records excluded unless asked for; /stats renders it.
// Runs after the deposit and withdraw checks, which leave E2E records behind.
//   pnpm e2e:funnel   (APP_URL defaults to http://localhost:3100)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

function check(name, f) {
  const stages = f.stages;
  if (!Array.isArray(stages) || stages.length !== 5) throw new Error(`${name}: expected 5 stages, got ${JSON.stringify(stages).slice(0, 200)}`);
  for (let i = 1; i < stages.length; i += 1) {
    if (stages[i].count > stages[i - 1].count) throw new Error(`${name}: stage ${stages[i].stage} (${stages[i].count}) exceeds ${stages[i - 1].stage} (${stages[i - 1].count})`);
    if (stages[i - 1].dropOff !== stages[i - 1].count - stages[i].count) throw new Error(`${name}: drop-off at ${stages[i - 1].stage} inconsistent`);
  }
  if (stages[stages.length - 1].dropOff !== 0) throw new Error(`${name}: last stage must have no drop-off`);
  return stages.map((s) => `${s.stage}=${s.count}`).join(" › ");
}

try {
  const pub = await (await fetch(`${APP}/api/metrics?since=1`)).json();
  const all = await (await fetch(`${APP}/api/metrics?since=1&include=all`)).json();
  log("public deposits:", check("public deposits", pub.funnel.deposits));
  log("public withdrawals:", check("public withdrawals", pub.funnel.withdrawals));
  log("all-sources deposits:", check("all deposits", all.funnel.deposits));
  if (all.funnel.deposits.stages[0].count <= pub.funnel.deposits.stages[0].count) throw new Error("E2E and seed deposits must add to the funnel only when included");
  log("  ✓ seed and E2E records excluded from the public funnel, present with include=all");
  const event = await (await fetch(`${APP}/api/metrics`)).json();
  check("since-event deposits", event.funnel.deposits);
  if (event.funnel.deposits.stages[0].count > pub.funnel.deposits.stages[0].count) throw new Error("since-event counts cannot exceed all-time counts");
  log("  ✓ since-event window is a subset of all-time");

  log("/stats renders the funnel");
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${APP}/stats`, { waitUntil: "networkidle" });
  await page.getByTestId("funnel").waitFor({ timeout: 30000 });
  const rows = await page.locator("[data-testid='funnel-deposits'] tbody tr").count();
  const wrows = await page.locator("[data-testid='funnel-withdrawals'] tbody tr").count();
  const text = ((await page.getByTestId("funnel").textContent()) ?? "").replace(/\s+/g, " ");
  log("  rows:", rows, wrows, "|", text.slice(0, 160));
  if (rows !== 5 || wrows !== 5) throw new Error(`expected 5 rows per funnel, saw ${rows} and ${wrows}`);
  if (!/Kasada|In the vault/.test(text)) throw new Error("funnel labels missing");
  await browser.close();
  console.log("\nE2E FUNNEL OK");
} catch (err) {
  console.error("E2E FUNNEL FAILED:", err);
  process.exitCode = 1;
}
