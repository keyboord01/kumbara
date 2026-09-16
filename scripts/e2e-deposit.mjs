// Gate 2 end-to-end: onboard → deposit 100 TRY → simulated bank transfer →
// landing on-ramp → arrival autopilot → USDC in the vault. Live testnet,
// Chrome virtual authenticator.
//   pnpm e2e:deposit   (APP_URL defaults to http://localhost:3100; needs BOOTH_ADMIN_TOKEN in .env)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
// The bank is played through the presenter API (the anchor's SEP-6 sandbox hook), so only the admin token is needed.
const ADMIN_TOKEN = process.env.BOOTH_ADMIN_TOKEN?.trim() ?? "";
if (!ADMIN_TOKEN) throw new Error("BOOTH_ADMIN_TOKEN is required (pnpm e2e:deposit loads .env)");
// E2E_ANCHOR=<home domain>: switch the active anchor first and restore it afterwards.
// E2E_EXPECT=instructions: stop once the anchor's bank instructions are on screen, cancelling the deposit.
// E2E_EXPECT=autofund: the anchor funds the deposit by itself (testanchor.stellar.org's reference server does), so nobody plays the bank.
const E2E_ANCHOR = process.env.E2E_ANCHOR?.trim() ?? "";
const EXPECT_INSTRUCTIONS = process.env.E2E_EXPECT === "instructions";
const AUTOFUND = process.env.E2E_EXPECT === "autofund";
// E2E_LEAVE_AFTER_IBAN=1: the booth flow. The visitor leaves the page after the IBAN step, the presenter console
// (its driver ticks every 5 s) carries the deposit to the wallet on its own, the visitor comes back and taps once.
const LEAVE_AFTER_IBAN = process.env.E2E_LEAVE_AFTER_IBAN === "1";
const AMOUNT = process.env.E2E_DEPOSIT_AMOUNT?.trim() || "100";
const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" };
let previousAnchor = null;
async function switchAnchor(homeDomain) {
  const before = await (await fetch(`${APP}/api/booth/admin/anchor`, { headers: adminHeaders })).json();
  previousAnchor = before.active ?? null;
  const res = await fetch(`${APP}/api/booth/admin/anchor`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ homeDomain }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`anchor switch failed: ${JSON.stringify(body)}`);
  console.log(`anchor switched ${previousAnchor} → ${body.active}`);
}
// Without an override, make sure the default anchor is active: a run cancelled mid-way through the testanchor step
// cannot restore it, and the next run would otherwise inherit testanchor's limits.
async function ensureDefaultAnchor() {
  const state = await (await fetch(`${APP}/api/booth/admin/anchor`, { headers: adminHeaders })).json();
  const first = state.anchors?.[0]?.homeDomain;
  if (!first || state.active === first) return;
  const res = await fetch(`${APP}/api/booth/admin/anchor`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ homeDomain: first }) });
  console.log(`anchor reset ${state.active} → ${first} (${res.status})`);
}
async function restoreAnchor() {
  if (!previousAnchor) return;
  await fetch(`${APP}/api/booth/admin/anchor`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ homeDomain: previousAnchor }) }).catch(() => undefined);
  console.log(`anchor restored → ${previousAnchor}`);
}

async function runBoothFlow(reference) {
  const closeHint = ((await page.getByTestId("close-hint").textContent().catch(() => "")) ?? "").trim();
  log("timeline says:", closeHint);
  if (!/Kapatabilirsin|You can close/.test(closeHint)) throw new Error(`no close hint under the current step (saw "${closeHint}")`);
  const pendingList = await (await fetch(`${APP}/api/booth/admin/pending`, { headers: adminHeaders })).json();
  const mine = (pendingList.pending ?? []).find((d) => d.reference === reference);
  if (!mine) throw new Error("deposit not listed for the presenter");
  log("visitor leaves the page (about:blank): no more polls from the user");
  await page.goto("about:blank");
  const leftAt = Date.now();

  log("presenter console opens; its driver ticks every 5 s");
  const admin = await context.newPage();
  await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`, { waitUntil: "networkidle" });
  await admin.getByTestId("driver").waitFor({ timeout: 20000 });
  for (let i = 0; i < 10; i += 1) {
    if ((await admin.getByTestId("driver").getAttribute("data-on")) === "true") break;
    if (i === 9) throw new Error(`driver never came on: ${await admin.getByTestId("driver").textContent()}`);
    await admin.waitForTimeout(2000);
  }
  log("  driver chip:", ((await admin.getByTestId("driver").textContent()) ?? "").trim());
  await admin.getByText(reference).first().waitFor({ timeout: 20000 });
  await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
  await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).first().waitFor({ timeout: 30000 });
  const bankAt = Date.now();
  log("  bank played:", ((await admin.locator("[role=status]").first().textContent()) ?? "").trim());
  // The second press must be refused with the server's reason (already paid), rendered in the console.
  await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click().catch(() => undefined);
  const refused = await admin.getByTestId("admin-error").textContent({ timeout: 15000 }).catch(() => "");
  log("  second press:", (refused ?? "").trim().slice(0, 160));
  if (!refused || !/already_paid|no_pending_deposit|anchor_rejected|\b(404|409|502)\b/.test(refused)) throw new Error(`second press did not show a server reason: ${refused}`);

  // Nobody polls for the visitor: only the console's ticks move the record. Watch it through the read-only admin route.
  let status = "";
  for (let i = 0; i < 100; i += 1) {
    const rec = await (await fetch(`${APP}/api/booth/admin/record?deposit=${mine.id}`, { headers: adminHeaders })).json();
    if (rec.status !== status) {
      status = rec.status;
      log(`  server status: ${status}${rec.forwardTxHash ? ` (forward ${rec.forwardTxHash.slice(0, 8)})` : ""}`);
    }
    if (status === "in_wallet") break;
    if (status === "failed" || status === "cancelled") throw new Error(`deposit ${status}: ${JSON.stringify(rec.error)}`);
    await admin.waitForTimeout(3000);
  }
  if (status !== "in_wallet") throw new Error(`driver did not carry the deposit to the wallet; last status ${status}`);
  log(`✓ driver carried the deposit to the wallet ${((Date.now() - bankAt) / 1000).toFixed(1)}s after the bank, with the visitor away for ${((Date.now() - leftAt) / 1000).toFixed(1)}s`);
  log("  last driver line:", ((await admin.getByTestId("driver-last").textContent()) ?? "").trim().slice(0, 200));

  log("visitor returns");
  await page.goto(`${APP}/yukle`, { waitUntil: "networkidle" });
  await page.getByTestId("resume-notice").waitFor({ timeout: 30000 });
  const arrived = ((await page.getByTestId("arrived").textContent({ timeout: 30000 })) ?? "").replace(/\s+/g, " ").trim();
  log("  arrived banner:", arrived.slice(0, 120));
  if (!/USDC geldi|USDC arrived/.test(arrived)) throw new Error(`no arrived banner on return (saw "${arrived}")`);
  const returnedAt = Date.now();
  await page.getByRole("button", { name: /Kasaya koy|Put it in the vault/ }).click();
  let last = "";
  for (let i = 0; i < 60; i += 1) {
    const current = ((await page.getByTestId("deposit-current").textContent()) ?? "").trim();
    if (current !== last) {
      log("  status:", current);
      last = current;
    }
    if (/Tamam\. USDC kasada\./.test(current)) break;
    if (/Olmadı/.test(current)) throw new Error(`deposit failed after the tap: ${(await page.locator("[role=alert]").allTextContents()).join(" | ")}`);
    await page.waitForTimeout(3000);
  }
  if (!/Tamam\. USDC kasada\./.test(last)) throw new Error(`vault step did not finish after the tap; last status: ${last}`);
  log(`✓ one tap on return: USDC in the vault ${((Date.now() - returnedAt) / 1000).toFixed(1)}s after the tap`);
  await admin.close();
}

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
page.on("requestfailed", (r) => consoleErrors.push(`requestfailed ${r.failure()?.errorText ?? ""} ${r.url().slice(0, 120)}`));
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
  // The presenter switches the anchor before the visitor opens the app; the browser then learns that anchor's limits.
  if (E2E_ANCHOR) await switchAnchor(E2E_ANCHOR);
  else await ensureDefaultAnchor();
  log("onboard");
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  const tapAt = Date.now();
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  log(`savings visible ${((Date.now() - tapAt) / 1000).toFixed(1)}s after tap`);
  const contract = (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();
  log("contract:", contract);
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").waitFor({ timeout: 90000 });
  log("✓ spending limit installed, deposit enabled");

  log(`deposit ${AMOUNT} ${E2E_ANCHOR ? `on ${E2E_ANCHOR}` : ""}`);
  await page.locator("section[aria-label='Kumbarada'] a[href='/yukle']").click();
  // The link can be re-rendered under the click while the limit card settles; make sure the deposit page is actually open.
  await page.waitForURL("**/yukle", { timeout: 15000 }).catch(async () => {
    log("  deposit link click did not navigate; opening /yukle directly");
    await page.goto(`${APP}/yukle`, { waitUntil: "networkidle" });
  });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  await input.fill(AMOUNT);
  await page.getByRole("button", { name: /Devam/ }).click();
  const refEl = page.getByTestId("deposit-reference");
  await refEl.waitFor({ timeout: 90000 }); // the request builds and locks the bridge account first
  const reference = (await refEl.textContent())?.trim();
  log("IBAN screen shown; reference:", reference);
  if (!E2E_ANCHOR && !/^TRMA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(reference ?? "")) throw new Error(`unexpected reference ${reference}`);
  if (!reference) throw new Error("no reference rendered");
  // Some anchors attach the bank details to the transaction a few seconds after the request; the page polls for them.
  let iban = "";
  for (let i = 0; i < 12 && !iban; i += 1) {
    iban = ((await page.getByTestId("deposit-iban").first().textContent().catch(() => "")) ?? "").trim();
    if (!iban) await page.waitForTimeout(3000);
  }
  log("IBAN:", iban);
  if (!iban) throw new Error("no bank account rendered");

  if (EXPECT_INSTRUCTIONS) {
    // Anchors without a sandbox hook stop here: the request path (SEP-10, SEP-12, SEP-38, SEP-6) worked and the
    // instructions are on screen. Cancel the deposit so the abort envelope returns the sponsor's reserves.
    const pending = await (await fetch(`${APP}/api/booth/admin/pending`, { headers: adminHeaders })).json();
    const mine = (pending.pending ?? []).find((d) => d.reference === reference);
    if (!mine) throw new Error("deposit not listed for the presenter");
    const cancel = await fetch(`${APP}/api/deposit/${mine.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const cancelled = await cancel.json();
    if (!cancel.ok || cancelled.status !== "cancelled") throw new Error(`cancel failed: ${JSON.stringify(cancelled).slice(0, 200)}`);
    log(`✓ instructions rendered from ${E2E_ANCHOR || "the active anchor"}; deposit ${mine.id} cancelled${cancelled.abortTxHash ? `, bridge merged back (${cancelled.abortTxHash.slice(0, 8)}…)` : ""}`);
    await restoreAnchor();
    console.log("\nE2E DEPOSIT OK (instructions only). console errors:", consoleErrors.length ? consoleErrors : "none");
    await browser.close();
    process.exit(0);
  }

  if (LEAVE_AFTER_IBAN) {
    await runBoothFlow(reference);
    await restoreAnchor();
    console.log("\nE2E DEPOSIT OK (visitor left after the IBAN step; driver carried it). console errors:", consoleErrors.length ? consoleErrors : "none");
    console.log("CONTRACT=" + contract);
    await browser.close();
    process.exit(0);
  }

  // Resumability: reopening the app mid-deposit must return to the same timeline from stored state.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("resume-notice").waitFor({ timeout: 30000 });
  if (AUTOFUND) {
    // The anchor is already funding this deposit, so the timeline may have moved past the bank details by now.
    log("✓ reload resumed the deposit from stored state (the anchor is already funding it)");
  } else {
    const referenceAfterReload = (await page.getByTestId("deposit-reference").textContent())?.trim();
    if (referenceAfterReload !== reference) throw new Error(`resumed deposit shows ${referenceAfterReload}, expected ${reference}`);
    log("✓ reload resumed the same deposit from stored state");
  }

  const adminToken = process.env.BOOTH_ADMIN_TOKEN?.trim();
  if (AUTOFUND) {
    log("the anchor funds this deposit itself; nobody plays the bank");
  } else if (adminToken) {
    log("play the bank from the presenter page (/booth/admin)");
    const admin = await context.newPage();
    await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(adminToken)}`, { waitUntil: "networkidle" });
    if (admin.url().includes("token=")) throw new Error("admin token was not removed from the URL");
    await admin.getByText(reference).first().waitFor({ timeout: 20000 });
    await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
    await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).first().waitFor({ timeout: 30000 });
    log("  admin page:", ((await admin.locator("[role=status]").first().textContent()) ?? "").trim());
    await admin.close();
  } else {
    throw new Error("BOOTH_ADMIN_TOKEN is required: the presenter API plays the bank through the anchor's SEP-6 sandbox hook");
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
  await restoreAnchor();
} catch (err) {
  await restoreAnchor();
  console.error("E2E DEPOSIT FAILED:", err);
  await page.screenshot({ path: ".data/e2e-deposit-failure.png", fullPage: true }).catch(() => {});
  await page.getByRole("button", { name: /Ayrıntılar|Details/ }).first().click({ timeout: 2000 }).catch(() => undefined);
  console.log("alerts:", (await page.locator("[role=alert]").allTextContents().catch(() => [])).join(" | ").slice(0, 900));
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 1500));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
