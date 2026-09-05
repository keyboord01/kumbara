// Gate 2 end-to-end: onboard → deposit 100 TRY → simulated bank transfer →
// landing on-ramp → arrival autopilot → USDC in the vault. Live testnet,
// Chrome virtual authenticator.
//   pnpm e2e:deposit   (APP_URL defaults to http://localhost:3100; needs ANCHOR_* in .env)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ANCHOR = (process.env.ANCHOR_BASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.ANCHOR_API_KEY ?? "";
if (!ANCHOR || !KEY) throw new Error("ANCHOR_BASE_URL and ANCHOR_API_KEY are required (pnpm e2e:deposit loads .env)");

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
  if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

try {
  log("onboard");
  await page.goto(`${APP}/?ref=e2e-deposit`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  const tapAt = Date.now();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  log(`savings visible ${((Date.now() - tapAt) / 1000).toFixed(1)}s after tap`);
  const contract = (await page.locator("p.font-mono").first().getAttribute("title"))?.trim();
  log("contract:", contract);
  await page.locator("a[href='/yukle']").waitFor({ timeout: 90000 });
  log("✓ spending limit installed, deposit enabled");

  log("deposit 100 TRY");
  await page.locator("a[href='/yukle']").click();
  await page.waitForURL("**/yukle", { timeout: 15000 });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  await input.fill("100");
  await page.getByRole("button", { name: /Devam/ }).click();
  const refEl = page.getByTestId("deposit-reference");
  await refEl.waitFor({ timeout: 30000 });
  const reference = (await refEl.textContent())?.trim();
  log("IBAN screen shown; reference:", reference);
  if (!/^TRMA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference ?? "")) throw new Error(`unexpected reference ${reference}`);
  const iban = await page.locator("dd .font-mono").first().textContent();
  log("IBAN:", iban?.trim());

  const adminToken = process.env.BOOTH_ADMIN_TOKEN?.trim();
  if (adminToken) {
    log("play the bank from the presenter page (/booth/admin)");
    const admin = await context.newPage();
    await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(adminToken)}`, { waitUntil: "networkidle" });
    if (admin.url().includes("token=")) throw new Error("admin token was not removed from the URL");
    await admin.getByText(reference).first().waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
    await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).waitFor({ timeout: 30000 });
    log("  admin page:", ((await admin.locator("[role=status]").first().textContent()) ?? "").trim());
    await admin.close();
  } else {
    log("simulate the bank transfer directly (what pnpm demo:deposit does)");
    const res = await fetch(`${ANCHOR}/v1/sandbox/bank-transfers`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": KEY },
      body: JSON.stringify({ reference, amount_try: "100.00", sender_name: "E2E" }),
    });
    const bt = await res.json();
    if (!res.ok) throw new Error(`sandbox transfer failed: ${JSON.stringify(bt)}`);
    log(`bank transfer ${bt.id} ${bt.status}`);
  }

  const transferAt = Date.now();
  let last = "";
  for (let i = 0; i < 100; i += 1) {
    const current = ((await page.getByTestId("deposit-current").textContent()) ?? "").trim();
    if (current !== last) {
      log("  status:", current);
      last = current;
    }
    if (/Tamam\. USDC kasada\./.test(current)) break;
    if (/Olmadı/.test(current)) {
      const alert = await page.locator("[role=alert]").allTextContents();
      throw new Error(`deposit failed: ${alert.join(" | ")}`);
    }
    const tap = page.getByRole("button", { name: /Kasaya koy/ });
    if (await tap.isVisible().catch(() => false)) {
      log("  autopilot needs a tap; tapping");
      await tap.click();
    }
    await page.waitForTimeout(3000);
  }
  if (!/Tamam\. USDC kasada\./.test(last)) throw new Error(`deposit did not complete; last status: ${last}`);
  log(`✓ deposit complete ${((Date.now() - transferAt) / 1000).toFixed(1)}s after the bank transfer`);
  const links = await page.locator("a[href*='stellar.expert']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  log("tx links:", links.join(" "));
  if (links.some((l) => !l.includes("/testnet/"))) throw new Error("an explorer link is not labeled testnet");

  await page.locator("a[href='/kumbara']").first().click();
  await page.waitForURL("**/kumbara", { timeout: 15000 });
  let inVault = "";
  for (let i = 0; i < 10; i += 1) {
    inVault = ((await page.locator("section[aria-label='Kumbarada'] p.tnum").first().textContent()) ?? "").trim();
    if (/[1-9]/.test(inVault)) break;
    await page.getByRole("button", { name: "Yenile" }).click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  log("savings shows in vault:", inVault);
  if (!/[1-9]/.test(inVault)) throw new Error("vault balance did not update on Savings");
  console.log("\nE2E DEPOSIT OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contract);
} catch (err) {
  console.error("E2E DEPOSIT FAILED:", err);
  await page.screenshot({ path: ".data/e2e-deposit-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 800));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
