// Phone screenshots of the four product screens (Onboard, Savings, Deposit IBAN,
// Withdraw) against APP_URL with the virtual passkey, for the deck and the
// README. Creates one e2e-tagged account. Writes docs/screenshots/app/*.png.
//   APP_URL=https://kumbara.sembol.xyz node scripts/shots-app.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const OUT = process.env.SHOTS_DIR ?? "docs/screenshots/app";
const LANG = process.env.SHOTS_LANG ?? "tr";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-${LANG}.png` });
  log(`${name}-${LANG}.png`);
};

try {
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: LANG, exact: true }).click();
  await page.getByRole("button", { name: /Başla|Get started/ }).waitFor({ timeout: 30000 });
  await shot("onboard");

  await page.getByRole("button", { name: /Başla|Get started/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText(/Kumbara adresi|Kumbara address/).first().waitFor({ timeout: 30000 });
  await page.locator("main section a[href='/yukle']").waitFor({ timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot("savings");

  await page.locator("main section a[href='/yukle']").click();
  await page.waitForURL("**/yukle", { timeout: 15000 });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  await input.fill("100"); // under BOOTH_AUTO_BANK_MAX_TRY: the driver plays the bank itself
  await page.getByRole("button", { name: /Devam|Continue/ }).click();
  await page.getByTestId("deposit-reference").waitFor({ timeout: 30000 });
  await shot("deposit");

  // The withdraw screen is only worth a picture with money in the vault, so finish this deposit: the driver
  // plays the bank for it by itself (it is under the auto threshold), then one approval puts it in the vault.
  log("finishing the deposit so the withdraw screen has a balance");
  // Nobody is on the presenter console during a screenshot run, so this script drives the pipeline itself;
  // the bank is played by the driver because the amount is under the auto threshold.
  const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim();
  if (!ADMIN) throw new Error("BOOTH_ADMIN_TOKEN is required to finish the deposit for the withdraw screenshot");
  for (let i = 0; i < 100; i += 1) {
    const status = ((await page.getByTestId("deposit-current").textContent().catch(() => "")) ?? "").trim();
    if (/Tamam\. USDC kasada\.|Done\. USDC is in the vault\./.test(status)) break;
    await fetch(`${APP}/api/pipeline/tick`, { method: "POST", headers: { authorization: `Bearer ${ADMIN}` } }).catch(() => undefined);
    const tap = page.getByRole("button", { name: /Kasaya koy|Put it in the vault/ });
    if (await tap.isVisible().catch(() => false)) await tap.click();
    if (i === 99) throw new Error(`the deposit never reached the vault: ${status}`);
    await page.waitForTimeout(3000);
  }

  await page.goto(`${APP}/cek`, { waitUntil: "networkidle" });
  const wInput = page.locator("input[type=number]");
  await wInput.waitFor({ timeout: 20000 });
  await wInput.fill("1");
  await page.waitForTimeout(2500);
  await shot("withdraw");
  console.log("\nSHOTS OK");
} catch (err) {
  console.error("SHOTS FAILED:", err);
  await page.screenshot({ path: ".data/shots-app-failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
