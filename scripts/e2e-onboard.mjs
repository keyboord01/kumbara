// Gate 1 end-to-end check against a running Kumbara build and LIVE Stellar
// testnet: Chrome's virtual authenticator plays the passkey.
//   APP_URL=http://localhost:3100 node scripts/e2e-onboard.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  if (m.text().startsWith("[kumbara]")) log("  console:", m.text().slice(0, 300));
});
page.on("response", (r) => {
  if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
try {
  log("open /?ref=e2e");
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  const title = await page.locator("h1").first().textContent();
  log("h1:", title?.trim());
  const footer = await page.locator("footer").textContent();
  if (!footer?.includes("Test ağı")) throw new Error("testnet footer missing");

  log("tap 'Kumbaranı aç'");
  const cta = page.getByRole("button", { name: /Kumbaranı aç/ });
  await cta.waitFor({ timeout: 30000 });
  await cta.click();
  const tapAt = Date.now();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const toSavings = (Date.now() - tapAt) / 1000;
  log(`savings screen visible ${toSavings.toFixed(1)}s after tap (target < 20 s)`);
  if (toSavings > 40) throw new Error(`savings screen took ${toSavings.toFixed(1)}s`);

  // The spending limit installs in the background from Savings; Deposit waits on it.
  await page.getByText(/Güvenlik kuralı kuruluyor/).first().waitFor({ timeout: 20000 });
  const depositDisabled = await page.getByRole("button", { name: "Yükle" }).isDisabled().catch(() => false);
  log("limit setup status shown; deposit disabled:", depositDisabled);
  if (!depositDisabled) throw new Error("deposit button should be disabled while the limit installs");
  const addr = (await page.locator("p.font-mono").first().getAttribute("title"))?.trim();
  log("contract:", addr);
  if (!addr?.startsWith("C")) throw new Error("no contract address rendered");
  const explorer = await page.locator("a[href*='stellar.expert']").first().getAttribute("href");
  log("explorer link:", explorer);
  if (!explorer?.includes("/testnet/")) throw new Error("explorer link not labeled testnet");
  const badge = await page.locator("[aria-label='TESTNET']").count();
  log("TESTNET badges on screen:", badge);

  // Limit card shows the default per-transaction cap once the rule is installed.
  let limitText = "";
  const limitAt = Date.now();
  for (let i = 0; i < 30; i += 1) {
    limitText = (await page.getByTestId("limit-card").textContent()) ?? "";
    if (/1\.000,00|1,000\.00/.test(limitText)) break;
    await page.waitForTimeout(3000);
  }
  log(`limit card after ${((Date.now() - limitAt) / 1000).toFixed(1)}s:`, limitText.replace(/\s+/g, " ").slice(0, 120));
  if (!/1\.000,00|1,000\.00/.test(limitText)) throw new Error("spending limit not shown");
  await page.locator("a[href='/yukle']").waitFor({ timeout: 15000 });
  log("✓ deposit enabled after the limit installed");
  const vault = (await page.locator("section[aria-label='Kasa']").textContent()) ?? "";
  log("vault card:", vault.replace(/\s+/g, " ").slice(0, 160));
  if (!vault.includes("DeFindex")) throw new Error("vault name missing");

  log("reload: session restore");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 45000 });
  log("✓ session restored");

  log("language toggle → EN");
  await page.getByRole("button", { name: "en", exact: true }).click();
  await page.getByText("My kumbara").first().waitFor({ timeout: 10000 });
  log("✓ EN copy rendered");

  await page.goto(`${APP}/kumbara/guvenlik`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Security|Güvenlik/ }).waitFor({ timeout: 30000 });
  log("✓ security page renders library components");
  console.log("\nE2E OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + addr);
} catch (err) {
  console.error("E2E FAILED:", err);
  await page.screenshot({ path: ".data/e2e-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
