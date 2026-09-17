// Gate 4 end-to-end: booth QR screen, presenter console (health dots, sponsor,
// seed demo account), and the public metrics with booth refs.
//   pnpm e2e:booth   (needs BOOTH_ADMIN_TOKEN in .env; APP_URL defaults to http://localhost:3100)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim();
if (!ADMIN) throw new Error("BOOTH_ADMIN_TOKEN is required (pnpm e2e:booth loads .env)");

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "tr"); } catch { /* storage off */ } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  if (m.text().startsWith("[kumbara]")) log("  console:", m.text().slice(0, 300));
});

const adminHeaders = { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" };
// The seed deposits on the active anchor; make sure it is the default one (a cancelled run may have left another active).
async function ensureDefaultAnchor() {
  const state = await (await fetch(`${APP}/api/booth/admin/anchor`, { headers: adminHeaders })).json();
  const first = state.anchors?.[0]?.homeDomain;
  if (!first || state.active === first) return;
  const res = await fetch(`${APP}/api/booth/admin/anchor`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ homeDomain: first }) });
  log(`anchor reset ${state.active} → ${first} (${res.status})`);
}

try {
  await ensureDefaultAnchor();
  log("booth screen");
  await page.goto(`${APP}/booth?n=7`, { waitUntil: "networkidle" });
  await page.locator("svg").first().waitFor({ timeout: 20000 });
  const url = ((await page.locator("p.font-mono").first().textContent()) ?? "").trim();
  log("QR encodes:", url);
  if (!url.endsWith("/?ref=booth-7&net=testnet")) throw new Error(`QR url unexpected: ${url}`);
  // The QR targets the canonical site in production (NEXT_PUBLIC_SITE_URL) and the deployment itself elsewhere.
  if (!url.startsWith(APP.replace(/\/+$/, ""))) throw new Error(`QR url ${url} does not start with ${APP}`);
  const counter = ((await page.getByTestId("booth-counter").textContent()) ?? "").trim();
  log("counter:", counter);
  if (!/^\d+$/.test(counter)) throw new Error(`counter not numeric: ${counter}`);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/TESTNET/.test(body) || !/Test ağı/.test(body)) throw new Error("booth screen lacks the testnet label");

  log("presenter console");
  await page.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("health-dots").waitFor({ timeout: 20000 });
  // The page lifts the token out of the address bar as soon as it mounts; check once it has.
  await page.waitForFunction(() => !window.location.search.includes("token="), null, { timeout: 10000 }).catch(() => undefined);
  if (page.url().includes("token=")) throw new Error("token still in URL");
  for (let i = 0; i < 10; i += 1) {
    const dots = await page.locator("[data-testid='health-dots'] span[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    if (dots.length === 4 && dots.every((d) => d === "ok")) {
      log("health dots:", dots.join(","));
      break;
    }
    if (i === 9) throw new Error(`health dots not all green: ${dots.join(",")}`);
    await page.waitForTimeout(2000);
  }
  await page.getByTestId("sponsor-balance").waitFor({ timeout: 20000 });
  log("sponsor:", ((await page.getByTestId("sponsor-balance").textContent()) ?? "").trim());
  await page.getByTestId("driver").waitFor({ timeout: 20000 });
  for (let i = 0; i < 10; i += 1) {
    if ((await page.getByTestId("driver").getAttribute("data-on")) === "true") break;
    if (i === 9) throw new Error(`driver never came on: ${await page.getByTestId("driver").textContent()}`);
    await page.waitForTimeout(2000);
  }
  log("driver:", ((await page.getByTestId("driver").textContent()) ?? "").trim(), "·", ((await page.getByTestId("driver-last").textContent()) ?? "").trim().slice(0, 120));
  // The queue lists a play button per deposit above the auto-bank threshold; with nothing waiting there is none.
  const playable = page.getByRole("button", { name: /Bankayı oynat|Play the bank/ });
  const waiting = await playable.count();
  log("queue: deposits waiting for a press:", waiting);
  // A refused action shows the server's reason, not a bare status. Ask for a deposit that cannot exist: an
  // empty body would play whichever deposit is pending, and with automatic confirmation a pending deposit
  // is no longer the same thing as a deposit waiting for a press.
  const refused = await (await fetch(`${APP}/api/booth/admin/play-bank`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ depositId: "dep_thisdoesnotexist" }) })).json();
  log("play-bank for a deposit that does not exist →", JSON.stringify(refused.error));
  if (!refused.error?.code || !refused.error?.message) throw new Error("play-bank refusal carries no code/message");

  log("seed a demo account (presenter passkey, fixed deposit, autopilot)");
  const seedAt = Date.now();
  await page.getByRole("button", { name: /Demo hesabı hazırla|Seed a demo account/ }).click();
  let last = "";
  // Up to 10 minutes: the seed's own two attempts can take five on a slow runner before the tap button appears, and the tap below then retries.
  for (let i = 0; i < 200; i += 1) {
    const status = ((await page.getByTestId("seed-status").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (status !== last) {
      log("  seed:", status.slice(0, 140));
      last = status;
    }
    if (/Demo hesabı hazır\.|Demo account ready\./.test(status)) break;
    const tap = page.getByRole("button", { name: /Kasaya koy|Put it in the vault/ });
    if (await tap.isVisible().catch(() => false)) await tap.click();
    await page.waitForTimeout(3000);
  }
  if (!/Demo hesabı hazır\.|Demo account ready\./.test(last)) throw new Error(`seed did not finish: ${last}`);
  log(`✓ demo account seeded in ${((Date.now() - seedAt) / 1000).toFixed(1)}s`);
  const seeded = last.match(/C[A-Z2-7]{55}/)?.[0];
  log("seeded contract:", seeded);

  log("metrics (public endpoint is edge-cached for 30 s; polling until the seeded account appears; seed is hidden unless included)");
  // since=1: all time; the default window starts at BOOTH_START_TS, which is the event day.
  const hidden = await (await fetch(`${APP}/api/metrics?since=1`)).json();
  if (hidden.accounts.items.some((a) => a.contractId === seeded) || hidden.accounts.byRef.seed) throw new Error("seed account leaked into the default metrics");
  let metrics = null;
  for (let i = 0; i < 20; i += 1) {
    metrics = await (await fetch(`${APP}/api/metrics?since=1&include=seed`)).json();
    if (metrics.accounts.items.some((a) => a.contractId === seeded)) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  log("accounts byRef:", JSON.stringify(metrics.accounts.byRef));
  if (!(metrics.accounts.byRef.seed >= 1)) throw new Error("seed account not counted");
  const item = metrics.accounts.items.find((a) => a.contractId === seeded);
  if (!item?.deployTx || !item.link?.includes("/testnet/tx/")) throw new Error("seeded account has no deploy tx link in metrics");
  const dep = metrics.deposits.items.find((d) => d.contractId === seeded);
  if (!dep?.vaultTx) throw new Error("seed deposit not in vault in metrics");
  log("✓ metrics list the seeded account and its vault deposit with hashes");
  const filtered = await (await fetch(`${APP}/api/metrics?since=1&ref=seed&include=seed`)).json();
  if (filtered.accounts.sinceStart < 1 || filtered.deposits.inVault < 1) throw new Error("ref filter failed");
  log("✓ ref filter works:", JSON.stringify({ accounts: filtered.accounts.sinceStart, inVault: filtered.deposits.inVault }));
  console.log("\nE2E BOOTH OK. console errors:", consoleErrors.length ? consoleErrors : "none");
} catch (err) {
  console.error("E2E BOOTH FAILED:", err);
  await page.screenshot({ path: ".data/e2e-booth-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 800));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
