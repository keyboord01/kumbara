// Named kumbara with a goal: onboard, name the kumbara and set a goal from
// Savings, reload and see both plus the progress ring, and check the API
// refuses a write without the right passkey credential.
//   pnpm e2e:goal   (APP_URL defaults to http://localhost:3100)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "tr"); } catch { /* storage off */ } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});

try {
  log("onboard");
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("contract:", contract);
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").waitFor({ timeout: 90000 });

  log("name the kumbara and set a goal");
  await page.getByTestId("goal-edit").click();
  await page.getByTestId("goal-name").fill("Tatil kumbarası");
  await page.getByTestId("goal-amount").fill("250");
  await page.getByTestId("goal-save").click();
  await page.getByTestId("goal-name-shown").waitFor({ timeout: 20000 });
  const shown = ((await page.getByTestId("goal-name-shown").textContent()) ?? "").trim();
  const progress = ((await page.getByTestId("goal-progress").textContent()) ?? "").replace(/\s+/g, " ").trim();
  log("  shown:", shown, "|", progress);
  if (shown !== "Tatil kumbarası") throw new Error(`name shown: ${shown}`);
  if (!/250/.test(progress) || !/USDC/.test(progress)) throw new Error(`progress line: ${progress}`);
  const ring = await page.locator("[data-testid='goal-card'] svg[role='img']").getAttribute("aria-label");
  log("  ring:", ring);
  if (!/^\d+%$/.test(ring ?? "")) throw new Error(`ring label: ${ring}`);

  log("reload keeps it");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("goal-name-shown").waitFor({ timeout: 30000 });
  if (((await page.getByTestId("goal-name-shown").textContent()) ?? "").trim() !== "Tatil kumbarası") throw new Error("name lost after reload");

  log("API: public read, guarded write");
  const read = await (await fetch(`${APP}/api/profile?contractId=${contract}`)).json();
  if (read.profile?.name !== "Tatil kumbarası" || read.profile?.goalUsdc !== "250.00") throw new Error(`profile read: ${JSON.stringify(read)}`);
  const wrongKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const forged = await fetch(`${APP}/api/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractId: contract, credentialId: wrongKey, name: "Hacked", goalUsdc: "1" }) });
  if (forged.status !== 403) throw new Error(`write with a foreign credential answered ${forged.status}`);
  const after = await (await fetch(`${APP}/api/profile?contractId=${contract}`)).json();
  if (after.profile?.name !== "Tatil kumbarası") throw new Error("a forged write changed the name");
  log("  ✓ a write without this kumbara's passkey credential is refused (403) and changes nothing");
  console.log("\nE2E GOAL OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contract);
} catch (err) {
  console.error("E2E GOAL FAILED:", err);
  await page.screenshot({ path: ".data/e2e-goal-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
