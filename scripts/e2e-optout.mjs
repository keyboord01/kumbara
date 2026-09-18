// The vault opt-out: deposit, then take the USDC back out of the vault into the kumbara's own account.
// Proves the headline keeps counting money that is no longer in the vault.
//   pnpm e2e:optout   (APP_URL defaults to http://localhost:3100)
// Not in e2e:all or CI yet; run it by hand after touching the vault helpers or the savings balance.
import { chromium } from "playwright";
const APP = process.env.APP_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "en"); } catch {} });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
page.on("console", (m) => { if (m.text().startsWith("[kumbara]")) log("  console:", m.text().slice(0, 160)); });
const read = async (id) => ((await page.getByTestId(id).textContent().catch(() => "")) ?? "").trim();
try {
  await page.goto(`${APP}/?ref=optout`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Get started|Başla/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.locator("section[aria-label='In the kumbara'] a[href='/yukle']").waitFor({ timeout: 90000 });
  await page.locator("section[aria-label='In the kumbara'] a[href='/yukle']").click();
  await page.waitForURL("**/yukle**", { timeout: 15000 });
  await page.locator("input[type=number]").waitFor({ timeout: 20000 });
  await page.locator("input[type=number]").fill("100");
  await page.getByRole("button", { name: /Continue|Devam/ }).click();
  await page.getByTestId("deposit-reference").waitFor({ timeout: 90000 });
  log("deposit started; waiting for the vault");
  for (let i = 0; i < 100; i += 1) {
    const cur = await read("deposit-current");
    if (/^Done\./i.test(cur)) break;
    const tap = page.getByRole("button", { name: /Put it in the vault/i }).first();
    if (await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await page.goto(`${APP}/kumbara`, { waitUntil: "networkidle" });
  await page.getByTestId("take-out-of-vault").waitFor({ timeout: 60000 });
  log("total:", await read("savings-total"), "| vault:", await read("vault-usdc"));
  await page.screenshot({ path: ".data/e2e-optout-before.png" });
  log("taking it out of the vault");
  await page.getByTestId("take-out-of-vault").click();
  let wallet = "";
  for (let i = 0; i < 40; i += 1) {
    wallet = await read("wallet-usdc");
    if (/USDC/.test(wallet)) break;
    await page.waitForTimeout(2000);
  }
  const total = await read("savings-total");
  const vault = await read("vault-usdc");
  log(`after opting out -> total ${total} | vault ${vault} | in the kumbara ${wallet}`);
  await page.screenshot({ path: ".data/e2e-optout-after.png" });
  if (!/USDC/.test(wallet)) throw new Error("the USDC did not come back into the kumbara");
  if (!/^0[.,]00/.test(vault)) throw new Error(`the vault should be empty, saw ${vault}`);
  console.log("\nE2E OPTOUT OK");
} catch (err) {
  console.error("E2E OPTOUT FAILED:", err);
  await page.screenshot({ path: ".data/e2e-optout-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally { await browser.close(); }
