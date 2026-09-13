// Screenshots of the main screens on a phone viewport, for design review (not a test).
//   OUT=.data/shots-before APP_URL=http://localhost:3100 node --env-file=.env scripts/shots.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const APP = process.env.APP_URL ?? "http://localhost:3100";
const OUT = process.env.OUT ?? ".data/shots";
const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim() ?? "";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log("shot", name); };
try {
  await page.goto(`${APP}/?ref=shots&net=testnet`, { waitUntil: "networkidle" });
  await shot("01-home");
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  await shot("02-savings-setup");
  await page.locator("a[href='/yukle']").waitFor({ timeout: 90000 });
  await shot("03-savings");
  await page.goto(`${APP}/yukle`, { waitUntil: "networkidle" });
  await page.locator("input[type=number]").waitFor({ timeout: 20000 });
  await shot("04-deposit-form");
  await page.locator("input[type=number]").fill("100");
  await page.getByRole("button", { name: /Devam/ }).click();
  await page.getByTestId("deposit-reference").waitFor({ timeout: 90000 });
  await shot("05-deposit-waiting");
  if (ADMIN) {
    const admin = await context.newPage();
    await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN)}`, { waitUntil: "networkidle" });
    await admin.getByTestId("health-dots").waitFor({ timeout: 20000 });
    await admin.waitForTimeout(6000);
    await admin.screenshot({ path: `${OUT}/08-admin.png`, fullPage: true }); console.log("shot 08-admin");
    await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click().catch(() => undefined);
    await admin.waitForTimeout(3000);
    await admin.screenshot({ path: `${OUT}/09-admin-played.png`, fullPage: true }); console.log("shot 09-admin-played");
    await admin.close();
    for (let i = 0; i < 40; i += 1) {
      const current = ((await page.getByTestId("deposit-current").textContent()) ?? "").trim();
      if (/USDC kumbarana taşınıyor|Neredeyse/.test(current)) { await shot("06-deposit-progress"); break; }
      await page.waitForTimeout(2000);
    }
    for (let i = 0; i < 60; i += 1) {
      const current = ((await page.getByTestId("deposit-current").textContent()) ?? "").trim();
      if (/Tamam\. USDC kasada\./.test(current)) { await shot("07-deposit-done"); break; }
      const tap = page.getByRole("button", { name: /Kasaya koy/ });
      if (await tap.isVisible().catch(() => false)) await tap.click();
      await page.waitForTimeout(3000);
    }
  }
  await page.goto(`${APP}/cek`, { waitUntil: "networkidle" });
  await page.locator("input[type=number]").waitFor({ timeout: 20000 }).catch(() => undefined);
  await page.locator("input[type=number]").fill("1").catch(() => undefined);
  await page.waitForTimeout(3000);
  await shot("10-withdraw-form");
  await page.goto(`${APP}/failures`, { waitUntil: "networkidle" });
  await shot("11-failures");
  await page.goto(`${APP}/kumbara/guvenlik`, { waitUntil: "networkidle" });
  await shot("12-security");
  await page.goto(`${APP}/booth?n=3`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot("13-booth");
  await page.goto(`${APP}/stats`, { waitUntil: "networkidle" });
  await shot("14-stats");
} catch (err) {
  console.error("shots failed:", err);
} finally {
  await browser.close();
}
