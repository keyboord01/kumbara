// Gate 3 end-to-end: onboard → deposit 300 TRY (above the ₺250 auto-play cap, so the presenter console plays the bank) →
// withdraw 1 USDC (installs the safety limit first) → reverse landing account → anchor payout. Live testnet,
// Chrome virtual authenticator.
//   pnpm e2e:withdraw   (APP_URL defaults to http://localhost:3100; needs BOOTH_ADMIN_TOKEN in .env)
import { chromium } from "playwright";

/**
 * An amount the presenter has to confirm by hand: above the automatic line, below the anchor's per-deposit
 * maximum. Both move (the line is a dollar figure converted at the live rate), so it is read rather than
 * guessed, and the check says so plainly when the two leave no room between them.
 */
async function manualAmount(app) {
  const info = await (await fetch(`${app}/api/anchor/info?cb=${Date.now()}`)).json();
  const auto = Number(info?.autoConfirm?.try ?? 0);
  // The anchor publishes two ceilings: `deposit` is in USDC, `fiat` is the lira the visitor types. This is lira.
  const anchorMax = Number(info?.anchor?.limits?.fiat?.max ?? 0);
  if (auto <= 0) return "300"; // automatic confirmation is off: any amount needs the press
  const wanted = Math.ceil((auto + 50) / 50) * 50;
  if (anchorMax > 0 && wanted > anchorMax) {
    throw new Error(`no amount needs a manual press: the automatic line is ₺${auto} and the anchor's maximum is ₺${anchorMax}`);
  }
  return String(wanted);
}

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim();
if (!ADMIN) throw new Error("BOOTH_ADMIN_TOKEN is required (pnpm e2e:withdraw loads .env)");

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
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  if (m.text().startsWith("[kumbara]")) log("  console:", m.text().slice(0, 300));
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// The presenter page plays the bank through the anchor's SEP-6 sandbox hook, exactly as at the booth.
async function playBank(reference) {
  const admin = await context.newPage();
  await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN)}`, { waitUntil: "domcontentloaded" });
  await admin.getByText(reference).first().waitFor({ timeout: 20000 });
  // One button per manual row in the queue.
  await admin.locator("[data-testid='queue-item']").filter({ hasText: reference }).getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
  await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).first().waitFor({ timeout: 30000 });
  await admin.close();
  return "admin page";
}

/** "6,16 USDC" (tr) or "6.16 USDC" (en) → 6.16 */
function parseUsdc(text) {
  const raw = (text.match(/[\d.,]+/)?.[0] ?? "").trim();
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

async function waitFor(testId, doneRe, failRe, maxPolls, onTick) {
  let last = "";
  for (let i = 0; i < maxPolls; i += 1) {
    const current = ((await page.getByTestId(testId).textContent().catch(() => "")) ?? "").trim();
    if (current !== last) {
      log("  status:", current);
      last = current;
    }
    if (doneRe.test(current)) return current;
    if (failRe.test(current)) {
      const alert = await page.locator("[role=alert]").allTextContents();
      throw new Error(`failed: ${alert.join(" | ")}`);
    }
    if (onTick) await onTick();
    await page.waitForTimeout(3000);
  }
  throw new Error(`timed out; last status: ${last}`);
}

try {
  log("onboard");
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Başla|Get started/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("contract:", contract);
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").waitFor({ timeout: 90000 });

  log("deposit 300 TRY");
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").click();
  // The link can be re-rendered under the click while the limit card settles; make sure the deposit page is actually open.
  await page.waitForURL("**/yukle**", { timeout: 15000 }).catch(async () => {
    log("  deposit link click did not navigate; opening /yukle directly");
    await page.goto(`${APP}/yukle`, { waitUntil: "networkidle" });
  });
  const depositInput = page.locator("input[type=number]");
  await depositInput.waitFor({ timeout: 20000 });
  const amount = await manualAmount(APP);
  log(`a manual deposit today is ₺${amount}`);
  await depositInput.fill(amount);
  await page.getByRole("button", { name: /Devam/ }).click();
  // The request builds and locks the bridge account (SEP-10/12/38/6 inside) before the IBAN shows: up to 90 s on production.
  await page.getByTestId("deposit-reference").waitFor({ timeout: 90000 });
  const reference = ((await page.getByTestId("deposit-reference").textContent()) ?? "").trim();
  log("reference:", reference, "→ bank via", await playBank(reference));
  await waitFor("deposit-current", /Tamam\. USDC kasada\./, /Olmadı/, 100, async () => {
    const tap = page.getByRole("button", { name: /Kasaya koy/ });
    if (await tap.isVisible().catch(() => false)) await tap.click();
  });
  log("✓ deposit in the vault");

  log("withdraw 1 USDC");
  await page.goto(`${APP}/cek`, { waitUntil: "networkidle" });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  // What the vault holds before the withdrawal (Turkish number format); the remainder is checked against it afterwards.
  let availableText = "";
  for (let i = 0; i < 20 && !/USDC/.test(availableText); i += 1) {
    availableText = ((await page.getByTestId("withdraw-available").textContent()) ?? "").trim();
    if (!/USDC/.test(availableText)) await page.waitForTimeout(1000);
  }
  const available = parseUsdc(availableText);
  log("available before:", availableText);
  if (!(available > 1)) throw new Error(`the vault should hold the deposit before withdrawing, saw "${availableText}"`);
  await input.fill("1");
  await page.getByText(/Alacağın lira/).waitFor({ timeout: 20000 });
  await page.locator("[data-testid='withdraw-quote'] p.tnum").first().waitFor({ timeout: 20000 });
  const quoteText = ((await page.locator("[data-testid='withdraw-quote']").textContent()) ?? "").replace(/\s+/g, " ");
  log("quote shown:", quoteText.slice(0, 120));
  // The rate is lira per USDC (SEP-38 states the sell price the other way round); an inverted display would read 0.02.
  const rateText = quoteText.match(/([\d.,]+) ₺\/USDC/)?.[1] ?? "";
  const rate = Number(rateText.replace(/\./g, "").replace(",", "."));
  if (!(rate > 1)) throw new Error(`the withdrawal rate must be lira per USDC (saw "${rateText || "none"}")`);
  await page.getByRole("button", { name: /Devam/ }).click();
  const withdrawAt = Date.now();
  // Up to 10 minutes: each client step is bounded at 120 s and a stalled step surfaces a retry button, which this loop presses.
  await waitFor("withdraw-current", /Tamam\. Lira IBAN/, /Olmadı/, 200, async () => {
    const tap = page.getByRole("button", { name: /passkey/i }).first();
    if (await tap.isVisible().catch(() => false)) {
      log("  client step needs a tap; tapping");
      await tap.click();
    }
  });
  const tryOut = ((await page.getByTestId("withdraw-try").textContent()) ?? "").trim();
  const payout = ((await page.getByTestId("withdraw-payout").textContent()) ?? "").trim();
  log(`✓ withdrawal complete ${((Date.now() - withdrawAt) / 1000).toFixed(1)}s after confirm: ${tryOut}, payout ${payout}`);
  // The anchor's external transaction id for the payout (FAST-… on the sandbox); any non-empty identifier counts.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,}$/.test(payout)) throw new Error(`no payout reference (${payout})`);
  const links = await page.locator("a[href*='stellar.expert']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  log("tx links:", links.join(" "));
  if (links.length < 3 || links.some((l) => !l.includes("/testnet/"))) throw new Error("expected three testnet-labeled links");

  await page.locator("a[href='/kumbara']").first().click();
  await page.waitForURL("**/kumbara", { timeout: 15000 });
  const expected = available - 1;
  let inVault = "";
  for (let i = 0; i < 10; i += 1) {
    inVault = ((await page.locator("section[aria-label='Kumbarada'] p.tnum").first().textContent()) ?? "").trim();
    if (Math.abs(parseUsdc(inVault) - expected) <= 0.05) break;
    await page.getByRole("button", { name: "Yenile" }).click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  log("savings shows in vault:", inVault, "| expected about", expected.toFixed(2));
  if (Math.abs(parseUsdc(inVault) - expected) > 0.05) throw new Error(`expected about ${expected.toFixed(2)} USDC left in the vault, saw ${inVault}`);
  // A withdrawal spends two passkey approvals and no more: the safety limit stays opt-in, so the limit
  // card must still read "not set" (onboard's check covers installing it from "Set it now").
  const limitText = ((await page.getByTestId("limit-card").textContent()) ?? "").replace(/\s+/g, " ");
  log("limit card after the withdrawal:", limitText.slice(0, 100));
  if (/1\.000,00|1,000\.00/.test(limitText)) throw new Error(`a withdrawal must not install the limit by itself, saw: ${limitText}`);
  console.log("\nE2E WITHDRAW OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contract);
} catch (err) {
  console.error("E2E WITHDRAW FAILED:", err);
  await page.screenshot({ path: ".data/e2e-withdraw-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 800));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
