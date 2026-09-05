// Screenshots of /stats: mobile (TR and EN, full page) and the projector
// variant (?mode=tv at 1920×1080), for the runbook and the Gate 5 report.
//   APP_URL=https://kumbara.sembol.xyz node scripts/shots-stats.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const OUT = process.env.SHOTS_DIR ?? "docs/screenshots/stats";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });

async function shoot(name, { viewport, url, lang, fullPage }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (lang) await page.getByRole("button", { name: lang, exact: true }).click();
  await page.getByTestId("headline").waitFor({ timeout: 30000 });
  // Wait for the numbers and the feed to be filled in.
  for (let i = 0; i < 20 && (await page.getByTestId("headline-accounts").textContent())?.trim() === "–"; i += 1) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`${name}: ${viewport.width}×${viewport.height}${fullPage ? " (full page)" : ""}`);
  await context.close();
}

await shoot("stats-mobile-tr", { viewport: { width: 390, height: 844 }, url: `${APP}/stats`, lang: "tr", fullPage: true });
await shoot("stats-mobile-en", { viewport: { width: 390, height: 844 }, url: `${APP}/stats`, lang: "en", fullPage: true });
await shoot("stats-tv", { viewport: { width: 1920, height: 1080 }, url: `${APP}/stats?mode=tv`, lang: null, fullPage: false });
await shoot("stats-tablet", { viewport: { width: 1024, height: 768 }, url: `${APP}/stats?mode=tv`, lang: null, fullPage: false });
await browser.close();
