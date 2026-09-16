// Proof screen end-to-end: onboard, open /kumbara/kanit from Savings, and check
// that the chain-read lines say what the deck says: one signer (the passkey),
// no Kumbara key, the default per-transaction limit, explorer links labeled
// testnet, in both languages.
//   pnpm e2e:proof   (APP_URL defaults to http://localhost:3100)
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
const text = async (id) => ((await page.getByTestId(id).textContent()) ?? "").replace(/\s+/g, " ").trim();
async function readProof(timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const signers = await text("proof-signers");
    const limit = await text("proof-limit");
    const kumbara = await text("proof-kumbara");
    if (/\d/.test(signers) && /USDC|kurulmamış|not set/.test(limit) && kumbara.length > 8) return { signers, limit, kumbara };
    await page.waitForTimeout(1500);
  }
  throw new Error("proof lines did not load");
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
  log("✓ deposit enabled (the safety limit is set at the first withdrawal)");

  log("Savings → Kanıt");
  await page.getByTestId("proof-link").click();
  await page.waitForURL("**/kumbara/kanit", { timeout: 15000 });
  const tr = await readProof();
  log("  TR:", tr.signers, "|", tr.kumbara, "|", tr.limit);
  if (!/^İmzacılar: 1, senin passkey'in\.$/.test(tr.signers)) throw new Error(`signers line: ${tr.signers}`);
  if (!/^Kumbara: yok\.$/.test(tr.kumbara)) throw new Error(`kumbara line: ${tr.kumbara}`);
  if (!/^Limit: (işlem başına [\d.,]+ USDC|kurulmamış)\.$/.test(tr.limit)) throw new Error(`limit line: ${tr.limit}`);
  const links = await page.locator("[data-testid='proof-links'] a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  log("  links:", links.length, links.map((l) => l.replace("https://stellar.expert/explorer/", "")).join(" "));
  if (links.length < 3 || links.some((l) => !l.includes("/testnet/contract/"))) throw new Error("expected three testnet contract links");
  if (!links[0].endsWith(contract)) throw new Error(`first link ${links[0]} is not this kumbara`);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/TESTNET/.test(body)) throw new Error("no testnet label");

  log("EN");
  await page.getByRole("button", { name: "en" }).click();
  const en = await readProof(20000);
  log("  EN:", en.signers, "|", en.kumbara, "|", en.limit);
  if (!/^Signers: 1, your passkey\.$/.test(en.signers)) throw new Error(`EN signers line: ${en.signers}`);
  if (!/^Kumbara: none\.$/.test(en.kumbara)) throw new Error(`EN kumbara line: ${en.kumbara}`);
  if (!/^Limit: ([\d.,]+ USDC per transaction|not set)\.$/.test(en.limit)) throw new Error(`EN limit line: ${en.limit}`);
  console.log("\nE2E PROOF OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contract);
} catch (err) {
  console.error("E2E PROOF FAILED:", err);
  await page.screenshot({ path: ".data/e2e-proof-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
