// Failure drills (SOW 1, D1) on live testnet with Chrome's virtual authenticator. Each drill breaks one thing a user
// can hit, checks the screen says what happened in plain words, then puts it back and checks the recovery path works:
//   1. passkey prompt cancelled halfway   (the authenticator refuses user verification)
//   2. relay down                         (/api/relay answers 502 RELAY_UNREACHABLE, as during the 8 Nov outage)
//   3. slow network                       (3G-like latency and bandwidth for a whole onboarding, then offline and back)
// Writes screenshots and drills.json into E2E_EVIDENCE_DIR when set.
//   APP_URL=http://localhost:3100 node scripts/drill-failures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const EVIDENCE = process.env.E2E_EVIDENCE_DIR?.trim() ?? "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results = [];

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "en"); } catch { /* storage off */ } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { context, page, cdp, authenticatorId };
}

const shot = async (page, name) => {
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });
};

async function failureShown(page, kind) {
  const screen = page.locator(`[data-testid='failure-screen'][data-kind='${kind}']`).first();
  await screen.waitFor({ timeout: 120000 });
  const text = ((await screen.textContent()) ?? "").replace(/\s+/g, " ").trim();
  // Plain words on the surface; the raw error only behind "Details".
  if (/Error:|at \w+ \(|stack|undefined/.test(text.replace(/Details.*$/, ""))) throw new Error(`raw error text on the ${kind} screen: ${text.slice(0, 200)}`);
  return text;
}

async function drill(name, fn) {
  const started = Date.now();
  log(`drill: ${name}`);
  try {
    const detail = await fn();
    results.push({ drill: name, ok: true, seconds: Math.round((Date.now() - started) / 100) / 10, ...detail });
    log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ drill: name, ok: false, error: String(err).slice(0, 300) });
    log(`  ✗ ${name}: ${String(err).slice(0, 300)}`);
  }
}

await drill("passkey prompt cancelled halfway", async () => {
  const { context, page, cdp, authenticatorId } = await fresh();
  await page.goto(`${APP}/?ref=e2e-drill&net=testnet`, { waitUntil: "networkidle" });
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  await page.getByRole("button", { name: /Get started/ }).click();
  const message = await failureShown(page, "passkey_cancelled");
  log("  screen:", message.slice(0, 120));
  await shot(page, "drill-1-passkey-cancelled");
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  await page.locator("[data-testid='failure-screen']").getByRole("button", { name: /Try again/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 180000 });
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("  recovered: kumbara", contract);
  await context.close();
  return { screen: "passkey_cancelled", message: message.slice(0, 200), recovery: "Try again with the passkey approved: kumbara created", contract };
});

await drill("relay down", async () => {
  const { context, page } = await fresh();
  let refused = 0;
  await page.route("**/api/relay", (route) => {
    refused += 1;
    return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ success: false, error: "relay unreachable: drill (upstream 504)", errorCode: "RELAY_UNREACHABLE" }) });
  });
  await page.goto(`${APP}/?ref=e2e-drill&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Get started/ }).click();
  const message = await failureShown(page, "relay_unreachable");
  log(`  screen after ${refused} refused relay call(s):`, message.slice(0, 120));
  await shot(page, "drill-2-relay-down");
  await page.unroute("**/api/relay");
  await page.locator("[data-testid='failure-screen']").getByRole("button", { name: /Try again/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 300000 });
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("  recovered: kumbara", contract);
  await context.close();
  return { screen: "relay_unreachable", message: message.slice(0, 200), recovery: "relay back, Try again: kumbara created", contract };
});

await drill("slow network", async () => {
  const { context, page, cdp } = await fresh();
  // Roughly "regular 3G": 400 ms extra round trip, 750 kbit/s down, 250 kbit/s up.
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: (750 * 1024) / 8, uploadThroughput: (250 * 1024) / 8 });
  const opened = Date.now();
  await page.goto(`${APP}/?ref=e2e-drill&net=testnet`, { waitUntil: "load", timeout: 120000 });
  await page.getByRole("button", { name: /Get started/ }).click({ timeout: 120000 });
  await page.waitForURL("**/kumbara**", { timeout: 300000 });
  await page.getByTestId("kumbara-address").waitFor({ timeout: 120000 });
  const onboardSeconds = Math.round((Date.now() - opened) / 1000);
  log(`  onboarded on a 3G-like connection in ${onboardSeconds}s`);
  await shot(page, "drill-3-slow-network-onboarded");
  // Then the connection drops and comes back.
  await context.setOffline(true);
  await page.getByTestId("offline-banner").waitFor({ timeout: 15000 });
  await shot(page, "drill-3-offline-banner");
  const banner = ((await page.getByTestId("offline-banner").textContent()) ?? "").trim();
  log("  offline banner:", banner.slice(0, 120));
  await context.setOffline(false);
  await page.getByTestId("offline-banner").waitFor({ state: "detached", timeout: 30000 });
  await page.getByTestId("kumbara-address").waitFor({ timeout: 30000 });
  await context.close();
  return { screen: "offline banner", message: banner.slice(0, 200), recovery: `onboarding completes on 3G-like conditions (${onboardSeconds}s); banner clears when the connection returns`, onboardSeconds };
});

await browser.close();
if (EVIDENCE) writeFileSync(path.join(EVIDENCE, "drills.json"), `${JSON.stringify({ at: new Date().toISOString(), app: APP, results }, null, 2)}\n`);
const failed = results.filter((r) => !r.ok);
console.log(`\nDRILLS ${failed.length ? "FAILED" : "OK"}: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
