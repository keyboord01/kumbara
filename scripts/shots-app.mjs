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
  await page.locator("a[href='/yukle']").waitFor({ timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot("savings");

  await page.locator("a[href='/yukle']").click();
  await page.waitForURL("**/yukle", { timeout: 15000 });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  await input.fill("100");
  await page.getByRole("button", { name: /Devam|Continue/ }).click();
  await page.getByTestId("deposit-reference").waitFor({ timeout: 30000 });
  await shot("deposit");
  // Leave nothing pending for the presenter's list: cancel the deposit before the transfer.
  await page.getByRole("button", { name: /Vazgeç|Cancel/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(1500);

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
