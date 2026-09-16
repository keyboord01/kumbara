// Gate 5 end-to-end for the failure screens that can be triggered without an
// outage: the wrong-network block, the offline banner, the passkey-lost
// recovery page and the gallery of every state. Read-only; creates nothing.
//   APP_URL=https://kumbara.sembol.xyz node scripts/e2e-failures.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "tr"); } catch { /* storage off */ } });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

try {
  log("wrong network: a mainnet link on the testnet build");
  await page.goto(`${APP}/?net=mainnet`, { waitUntil: "networkidle" });
  const guard = page.locator("[data-testid='failure-screen'][data-kind='wrong_network']");
  await guard.waitFor({ timeout: 20000 });
  const guardText = ((await guard.textContent()) ?? "").replace(/\s+/g, " ");
  if (!/MAINNET/.test(guardText) || !/TESTNET/.test(guardText)) throw new Error(`wrong-network screen does not name both networks: ${guardText.slice(0, 160)}`);
  if ((await page.getByRole("button", { name: /Başla|Get started/ }).count()) !== 0) throw new Error("onboarding button still rendered behind the wrong-network block");
  log("✓ wrong-network block replaces the app and names both networks");

  log("offline banner");
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Başla|Get started/ }).waitFor({ timeout: 30000 });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByTestId("offline-banner").waitFor({ timeout: 10000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(500);
  if ((await page.getByTestId("offline-banner").count()) !== 0) throw new Error("offline banner did not clear when back online");
  log("✓ offline banner appears offline and clears online");

  log("passkey lost → recovery page");
  await page.getByRole("link", { name: /Passkey'imi bulamıyorum|I can't find my passkey/ }).click();
  await page.waitForURL("**/kurtar", { timeout: 15000 });
  await page.getByRole("heading", { name: /Erişimi kurtar|Recover access/ }).waitFor({ timeout: 15000 });
  log("✓ /kurtar renders the recovery flow");

  log("gallery: every state renders in both languages with no raw error on the surface");
  await page.goto(`${APP}/failures`, { waitUntil: "networkidle" });
  const kinds = await page.locator("[data-testid^='gallery-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("gallery-", "")));
  if (kinds.length < 25) throw new Error(`expected 25 failure kinds, saw ${kinds.length}`);
  for (const lang of ["tr", "en"]) {
    await page.getByRole("button", { name: lang, exact: true }).click();
    const screens = page.locator("[data-testid='failure-screen']");
    if ((await screens.count()) !== kinds.length) throw new Error(`gallery (${lang}) shows ${await screens.count()} screens for ${kinds.length} kinds`);
    const surface = (await screens.allTextContents()).join(" ");
    if (/preview\)/.test(surface)) throw new Error(`raw detail visible on the surface (${lang})`);
    const details = await page.locator("[data-testid='failure-detail']").count();
    if (details !== 0) throw new Error("details expander open by default");
  }
  const withAddress = await page.locator("[data-testid='failure-landing']").count();
  if (withAddress < 2) throw new Error("amount-mismatch and USDC-not-received screens should show the bridge account");
  log(`✓ ${kinds.length} states, TR and EN, raw detail only behind the expander; ${withAddress} screens show a bridge account`);
  console.log("\nE2E FAILURES OK. console errors:", consoleErrors.length ? consoleErrors : "none");
} catch (err) {
  console.error("E2E FAILURES FAILED:", err);
  await page.screenshot({ path: ".data/e2e-failures-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
  process.exitCode = 1;
} finally {
  await browser.close();
}
