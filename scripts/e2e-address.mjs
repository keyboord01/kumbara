// Address round trip: kumbara A onboards and deposits ₺300 (above the ₺250 auto-play
// cap, so the presenter console plays the bank); kumbara B onboards in a second browser context; A withdraws 1 USDC
// to B's contract address (vault withdrawal + transfer, both passkey-signed, the
// safety limit installed first); B sees the USDC in its kumbara and puts it in the
// vault with one approval. Live testnet, Chrome virtual authenticators.
//   pnpm e2e:address   (APP_URL defaults to http://localhost:3100; needs BOOTH_ADMIN_TOKEN in .env)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim();
if (!ADMIN) throw new Error("BOOTH_ADMIN_TOKEN is required (pnpm e2e:address loads .env)");

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const consoleErrors = [];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function kumbara(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "tr"); } catch { /* storage off */ } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  page.on("pageerror", (e) => consoleErrors.push(`${name} pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${name}: ${m.text().slice(0, 300)}`);
    if (m.text().startsWith("[kumbara]")) log(`  ${name} console:`, m.text().slice(0, 300));
  });
  log(`${name}: onboard`);
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Başla|Get started/ }).click();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const address = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  if (!address?.startsWith("C")) throw new Error(`${name}: no contract address`);
  log(`${name}: ${address}`);
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").waitFor({ timeout: 90000 });
  return { name, context, page, address };
}

// The presenter page plays the bank through the anchor's SEP-6 sandbox hook, exactly as at the booth.
async function playBank(context, reference) {
  const admin = await context.newPage();
  await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN)}`, { waitUntil: "networkidle" });
  await admin.getByText(reference).first().waitFor({ timeout: 20000 });
  // One button per manual row in the queue.
  await admin.locator("[data-testid='queue-item']").filter({ hasText: reference }).getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
  await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).first().waitFor({ timeout: 30000 });
  await admin.close();
}

async function waitFor(page, testId, doneRe, failRe, maxPolls, onTick) {
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

let a = null;
let b = null;
try {
  a = await kumbara("A");
  log("A: deposit 300 TRY");
  await a.page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").click();
  await a.page.waitForURL("**/yukle**", { timeout: 15000 }).catch(async () => {
    await a.page.goto(`${APP}/yukle`, { waitUntil: "networkidle" });
  });
  const depositInput = a.page.locator("input[type=number]");
  await depositInput.waitFor({ timeout: 20000 });
  await depositInput.fill("300");
  await a.page.getByRole("button", { name: /Devam/ }).click();
  await a.page.getByTestId("deposit-reference").waitFor({ timeout: 90000 });
  const reference = ((await a.page.getByTestId("deposit-reference").textContent()) ?? "").trim();
  log("A: reference", reference);
  await playBank(a.context, reference);
  await waitFor(a.page, "deposit-current", /Tamam\. USDC kasada\./, /Olmadı/, 100, async () => {
    const tap = a.page.getByRole("button", { name: /Kasaya koy/ });
    if (await tap.isVisible().catch(() => false)) await tap.click();
  });
  log("✓ A: deposit in the vault");

  b = await kumbara("B");

  log("A: withdraw 1 USDC to B's address");
  await a.page.goto(`${APP}/cek`, { waitUntil: "networkidle" });
  const amount = a.page.locator("input[type=number]");
  await amount.waitFor({ timeout: 20000 });
  await amount.fill("1");
  await a.page.getByTestId("withdraw-method").getByRole("button", { name: /Stellar adresine|Stellar address/ }).click();
  const destination = a.page.getByTestId("withdraw-destination");
  await destination.waitFor({ timeout: 10000 });
  await destination.fill(b.address);
  const box = ((await a.page.getByTestId("withdraw-quote").textContent()) ?? "").replace(/\s+/g, " ");
  log("A: sending box:", box.slice(0, 120));
  if (!box.includes(b.address)) throw new Error("the destination is not shown in the amount box");
  await a.page.getByRole("button", { name: /Devam/ }).click();
  const withdrawAt = Date.now();
  // The first withdrawal installs the safety limit, then withdraws from the vault, then transfers: three approvals, each retryable by its button.
  await waitFor(a.page, "withdraw-current", /Tamam\. USDC adrese gönderildi\./, /Olmadı/, 200, async () => {
    const tap = a.page.getByRole("button", { name: /passkey/i }).first();
    if (await tap.isVisible().catch(() => false)) {
      log("  A: client step needs a tap; tapping");
      await tap.click();
    }
  });
  log(`✓ A: sent to B's address ${((Date.now() - withdrawAt) / 1000).toFixed(1)}s after confirm`);
  const shown = ((await a.page.getByTestId("withdraw-destination-shown").textContent()) ?? "").trim();
  if (shown !== b.address) throw new Error(`destination shown ${shown} is not B`);
  const links = await a.page.locator("a[href*='stellar.expert']").evaluateAll((as) => as.map((el) => el.getAttribute("href")));
  log("A: tx links:", links.join(" "));
  if (links.length < 2 || links.some((l) => !l.includes("/testnet/"))) throw new Error("expected two testnet-labeled links (vault withdrawal, transfer)");

  log("B: USDC arrives in the kumbara");
  await b.page.goto(`${APP}/kumbara`, { waitUntil: "networkidle" });
  let walletLine = "";
  for (let i = 0; i < 20; i += 1) {
    walletLine = ((await b.page.getByTestId("wallet-usdc").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (walletLine) break;
    await b.page.getByRole("button", { name: "Yenile" }).click().catch(() => {});
    await b.page.waitForTimeout(3000);
  }
  log("B: wallet line:", walletLine);
  if (!walletLine) throw new Error("B never showed USDC in the kumbara");
  await b.page.getByTestId("put-in-vault").click();
  let inVault = "";
  for (let i = 0; i < 30; i += 1) {
    inVault = ((await b.page.locator("section[aria-label='Kumbarada'] p.tnum").first().textContent()) ?? "").trim();
    if (/^1,00 USDC/.test(inVault)) break;
    const tap = b.page.getByTestId("put-in-vault");
    if (await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
    await b.page.getByRole("button", { name: "Yenile" }).click().catch(() => {});
    await b.page.waitForTimeout(3000);
  }
  log("B: in vault:", inVault);
  if (!/^1,00 USDC/.test(inVault)) throw new Error(`expected 1,00 USDC in B's vault, saw ${inVault}`);
  console.log("\nE2E ADDRESS OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + a.address + " DESTINATION=" + b.address);
} catch (err) {
  console.error("E2E ADDRESS FAILED:", err);
  await a?.page.screenshot({ path: ".data/e2e-address-failure-a.png", fullPage: true }).catch(() => {});
  await b?.page.screenshot({ path: ".data/e2e-address-failure-b.png", fullPage: true }).catch(() => {});
  console.log("A body:", (await a?.page.locator("body").innerText().catch(() => "")) ?? "".replace(/\s+/g, " ").slice(0, 600));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
