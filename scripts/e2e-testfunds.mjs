// Self-serve test money (SOW 1, D2), end to end on live testnet with Chrome's virtual authenticator:
// a new visitor opens the app, creates a kumbara, taps "Get test USDC" once, sees the USDC arrive and puts it in
// the vault, with nobody else involved. Then the per-account limit refuses a second grant, through the API and on
// screen, and the presenter's pool view shows both. Records a video and screenshots into E2E_EVIDENCE_DIR when set.
//   pnpm e2e:testfunds   (APP_URL defaults to http://localhost:3100; needs BOOTH_ADMIN_TOKEN and TESTFUNDS_SECRET on the server)
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ADMIN_TOKEN = process.env.BOOTH_ADMIN_TOKEN?.trim() ?? "";
const EVIDENCE = process.env.E2E_EVIDENCE_DIR?.trim() ?? "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  ...(EVIDENCE ? { recordVideo: { dir: EVIDENCE, size: { width: 390, height: 844 } } } : {}),
});
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "en"); } catch { /* storage off */ } });
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
});

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const shot = async (name) => {
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });
};
const usdc = (text) => Number((text ?? "").replace(/[^\d.,]/g, "").replace(/,/g, "")) || 0;

try {
  log("a new visitor opens the app");
  await page.goto(`${APP}/?ref=e2e-testfunds&net=testnet`, { waitUntil: "networkidle" });
  await shot("01-landing");
  await page.getByRole("button", { name: /Get started|Başla/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("kumbara:", contract);
  if (!contract?.startsWith("C")) throw new Error("no kumbara address");

  const card = page.getByTestId("testfunds-card");
  await card.waitFor({ timeout: 30000 });
  const cardText = ((await card.textContent()) ?? "").replace(/\s+/g, " ");
  log("test-funds card:", cardText.slice(0, 160));
  if (!/TEST MONEY/.test(cardText) || !/not real money/.test(cardText)) throw new Error("the card does not say plainly that this is test money");
  await shot("02-empty-kumbara-with-test-funds-card");

  log("one tap: Get test USDC");
  const tapAt = Date.now();
  await page.getByTestId("testfunds-button").click();
  const txLink = page.getByTestId("testfunds-tx");
  await txLink.waitFor({ timeout: 90000 });
  const href = await txLink.getAttribute("href");
  const grantHash = href?.split("/tx/")[1] ?? "";
  log("grant transaction:", href);
  if (!/^[0-9a-f]{64}$/.test(grantHash) || !href?.includes("/testnet/")) throw new Error("no testnet transaction link");

  // The USDC lands in the account; the Savings screen offers to put it in the vault.
  let wallet = 0;
  for (let i = 0; i < 30 && wallet <= 0; i += 1) {
    const el = page.getByTestId("wallet-usdc");
    if (await el.count()) wallet = usdc(await el.textContent());
    if (wallet <= 0) await page.waitForTimeout(2000);
  }
  const funded = (Date.now() - tapAt) / 1000;
  const fromOpen = (Date.now() - t0) / 1000;
  log(`✓ ${wallet} test USDC in the kumbara ${funded.toFixed(1)}s after the tap, ${fromOpen.toFixed(1)}s after opening the app`);
  if (wallet <= 0) throw new Error("the test USDC never showed in the kumbara");
  await shot("03-funded");

  log("put it in the vault (one passkey approval)");
  await page.getByTestId("put-in-vault").click();
  let inVault = 0;
  for (let i = 0; i < 40 && inVault <= 0; i += 1) {
    await page.waitForTimeout(2000);
    inVault = usdc(await page.getByTestId("vault-usdc").textContent().catch(() => "0"));
  }
  log(`✓ ${inVault} USDC in the vault ${((Date.now() - t0) / 1000).toFixed(1)}s after opening the app`);
  if (inVault <= 0) throw new Error("vault deposit did not land");
  await shot("04-in-vault");

  log("a second grant for the same kumbara is refused by the per-account limit");
  const again = await page.evaluate(async (c) => {
    const r = await fetch("/api/testfunds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractId: c }) });
    return { status: r.status, body: await r.json() };
  }, contract);
  log("  API answered", again.status, JSON.stringify(again.body));
  if (again.status !== 429 || again.body.error?.code !== "account_limit") throw new Error("the second grant was not refused by the per-account limit");
  const allowance = await (await fetch(`${APP}/api/testfunds?contractId=${contract}`)).json();
  if (allowance.remaining !== 0) throw new Error(`allowance still shows ${allowance.remaining} remaining`);
  log("  ✓ refused: account_limit; allowance now", JSON.stringify(allowance));

  if (ADMIN_TOKEN) {
    const pool = await (await fetch(`${APP}/api/booth/admin/testfunds`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })).json();
    const mineGranted = pool.recent?.find((g) => g.hash === grantHash);
    const mineRefused = pool.refusals?.find((r) => r.contractId === contract && r.code === "account_limit");
    log(`pool: ${pool.usdc} USDC left, ${pool.grantsToday} grants today, latest refusal ${mineRefused?.code ?? "none"}`);
    if (!mineGranted || !mineRefused) throw new Error("the pool view does not list this grant and its refusal");
    // The presenter's page, signed in with the session cookie, for the screenshot.
    await page.request.post(`${APP}/api/booth/admin/session`, { data: { token: ADMIN_TOKEN } });
    await page.goto(`${APP}/booth/admin/funds`, { waitUntil: "networkidle" });
    await page.getByTestId("pool-usdc").waitFor({ timeout: 30000 });
    await shot("05-pool-admin");
    await page.request.delete(`${APP}/api/booth/admin/session`);
  }

  console.log(`\nE2E TESTFUNDS OK. contract ${contract} grant ${grantHash} zero-to-funded ${fromOpen.toFixed(1)}s. console errors:`, consoleErrors.length ? consoleErrors : "none");
  const video = page.video();
  await context.close();
  if (EVIDENCE && video) renameSync(await video.path(), path.join(EVIDENCE, "zero-to-funded.webm"));
  await browser.close();
} catch (err) {
  console.error("E2E TESTFUNDS FAILED:", err);
  console.error("body:", ((await page.locator("body").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 800));
  console.error("console errors:", consoleErrors);
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, "failure.png"), fullPage: true }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
