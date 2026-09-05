// Screenshots of every failure screen (TR and EN) from the /failures gallery,
// for the runbook and the Gate 5 report. Writes docs/screenshots/failures/<kind>-<lang>.png.
//   APP_URL=http://localhost:3100 node scripts/shots-failures.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const OUT = process.env.SHOTS_DIR ?? "docs/screenshots/failures";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${APP}/failures`, { waitUntil: "networkidle" });
const kinds = await page.locator("[data-testid^='gallery-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("gallery-", "")));
console.log(`${kinds.length} failure kinds in the gallery`);
let count = 0;
for (const lang of ["tr", "en"]) {
  for (const kind of kinds) {
    await page.goto(`${APP}/failures?kind=${kind}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: lang, exact: true }).click();
    const card = page.locator("[data-testid='failure-screen']").first();
    await card.waitFor({ timeout: 10000 });
    // Open the details expander so the screenshot shows the raw detail stays behind it.
    const title = (await card.locator("h2").textContent())?.trim();
    await card.screenshot({ path: `${OUT}/${kind}-${lang}.png` });
    count += 1;
    console.log(`  ${kind} (${lang}): ${title}`);
  }
}
await page.goto(`${APP}/failures`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "tr", exact: true }).click();
await page.screenshot({ path: `${OUT}/_gallery-tr.png`, fullPage: true });
console.log(`${count} screenshots written to ${OUT}; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
if (errors.length) process.exitCode = 1;
