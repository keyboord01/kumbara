// Invite link end-to-end: kumbara A shows its invite link on Savings; a fresh
// context opens a kumbara through that link (tagged e2e- so it stays out of
// the public numbers); A's Savings then counts one friend, and the metrics
// list the invite ref when E2E sources are included.
//   pnpm e2e:invite   (APP_URL defaults to http://localhost:3100)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const consoleErrors = [];
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  return { context, page };
}
async function onboard(page, query) {
  await page.goto(`${APP}/?${query}&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  return (await page.locator("p.font-mono").first().getAttribute("title"))?.trim();
}
const text = async (page, id) => ((await page.getByTestId(id).textContent()) ?? "").replace(/\s+/g, " ").trim();

let a = null;
try {
  log("A: onboard and read the invite link");
  a = await fresh();
  const contractA = await onboard(a.page, "ref=e2e");
  log("  A:", contractA);
  await a.page.getByTestId("invite-link").waitFor({ timeout: 30000 });
  const link = await text(a.page, "invite-link");
  const code = new URL(link).searchParams.get("ref") ?? "";
  log("  link:", link);
  if (!/^inv-[0-9a-f]{10}$/.test(code)) throw new Error(`invite code ${code} has the wrong shape`);
  const before = await text(a.page, "invite-count");
  log("  count before:", before);
  if (!/^0 /.test(before)) throw new Error(`fresh kumbara should count 0 friends, saw "${before}"`);

  log("B: open a kumbara through the link (tagged e2e-)");
  const b = await fresh();
  const contractB = await onboard(b.page, `ref=e2e-${code}`);
  log("  B:", contractB);
  await b.context.close();

  log("A: the count follows");
  let after = "";
  for (let i = 0; i < 15; i += 1) {
    await a.page.reload({ waitUntil: "networkidle" });
    await a.page.getByTestId("invite-count").waitFor({ timeout: 30000 });
    after = await text(a.page, "invite-count");
    if (/^1 /.test(after)) break;
    await a.page.waitForTimeout(2000);
  }
  log("  count after:", after);
  if (!/^1 /.test(after)) throw new Error(`expected one friend, saw "${after}"`);

  log("metrics: the invite ref is listed when E2E sources are included, and absent from the public numbers");
  const included = await (await fetch(`${APP}/api/metrics?since=1&include=e2e`)).json();
  if (!(included.accounts.byRef[`e2e-${code}`] >= 1)) throw new Error(`metrics byRef lacks e2e-${code}: ${JSON.stringify(included.accounts.byRef).slice(0, 200)}`);
  const pub = await (await fetch(`${APP}/api/metrics?since=1`)).json();
  if (pub.accounts.byRef[`e2e-${code}`]) throw new Error("an E2E invite account leaked into the public metrics");
  log("  ✓ counted for the referrer and in /stats with include=e2e, hidden from the public numbers");
  console.log("\nE2E INVITE OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contractA);
} catch (err) {
  console.error("E2E INVITE FAILED:", err);
  if (a) await a.page.screenshot({ path: ".data/e2e-invite-failure.png", fullPage: true }).catch(() => {});
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
