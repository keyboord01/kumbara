// Recovery end-to-end: create a kumbara in one browser context, move the same
// passkey (virtual authenticator credential) into fresh contexts, and reach
// Savings both through "Sign in with your passkey" and through the recovery
// screen, with no third-party indexer. Also checks the registry the relay
// wrote at deployment and the backup-passkey write path.
//   pnpm e2e:recover   (APP_URL defaults to http://localhost:3100)
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const consoleErrors = [];
async function freshContext(credential) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "tr"); } catch { /* storage off */ } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_NAME_NOT_RESOLVED/.test(m.text())) consoleErrors.push(m.text().slice(0, 300));
    if (m.text().startsWith("[kumbara]")) log("  console:", m.text().slice(0, 200));
  });
  return { context, page, cdp, authenticatorId };
}
const contractOf = async (page) => (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();

let a = null;
try {
  log("A: create a kumbara");
  a = await freshContext(null);
  await a.page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  await a.page.getByRole("button", { name: /Başla|Get started/ }).click();
  await a.page.waitForURL("**/kumbara**", { timeout: 60000 });
  await a.page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const contract = await contractOf(a.page);
  log("  contract:", contract);
  if (!contract) throw new Error("no contract on Savings");
  const { credentials } = await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId });
  if (credentials.length !== 1) throw new Error(`expected one virtual credential, found ${credentials.length}`);
  const credential = credentials[0];
  log("  passkey credential id (base64):", credential.credentialId.slice(0, 16) + "…", "rpId", credential.rpId);

  log("registry: the relay recorded this passkey's kumbara at deployment");
  let registry = null;
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${APP}/api/registry?credential=${encodeURIComponent(credential.credentialId)}`);
    if (res.ok) {
      registry = await res.json();
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!registry) throw new Error("registry has no entry for the new passkey");
  if (registry.contractId !== contract || !registry.verified) throw new Error(`registry answered ${JSON.stringify(registry)}, expected verified ${contract}`);
  log("  ✓ registry:", registry.kind, registry.verified ? "verified" : "unverified", registry.contractId.slice(0, 8) + "…");

  log("B: fresh context with the same passkey → 'Sign in with your passkey'");
  const b = await freshContext({ credentialId: credential.credentialId, isResidentCredential: true, rpId: credential.rpId, privateKey: credential.privateKey, userHandle: credential.userHandle, signCount: credential.signCount });
  const bAt = Date.now();
  await b.page.goto(`${APP}/?net=testnet`, { waitUntil: "networkidle" });
  await b.page.getByRole("button", { name: /Passkey ile gir|Sign in with your passkey/ }).click();
  await b.page.waitForURL("**/kumbara**", { timeout: 60000 });
  await b.page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const bContract = await contractOf(b.page);
  if (bContract !== contract) throw new Error(`fresh context connected to ${bContract}, expected ${contract}`);
  log(`  ✓ same kumbara on Savings from a fresh context in ${((Date.now() - bAt) / 1000).toFixed(1)}s (derived from the passkey, no indexer)`);
  await b.context.close();

  log("C: fresh context → recovery screen");
  const c = await freshContext({ credentialId: credential.credentialId, isResidentCredential: true, rpId: credential.rpId, privateKey: credential.privateKey, userHandle: credential.userHandle, signCount: credential.signCount + 1 });
  const cAt = Date.now();
  await c.page.goto(`${APP}/kurtar`, { waitUntil: "networkidle" });
  await c.page.getByTestId("recover-find").click();
  await c.page.waitForURL("**/kumbara**", { timeout: 60000 });
  await c.page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  const cContract = await contractOf(c.page);
  if (cContract !== contract) throw new Error(`recovery connected to ${cContract}, expected ${contract}`);
  log(`  ✓ recovery screen reached the same kumbara in ${((Date.now() - cAt) / 1000).toFixed(1)}s`);
  await c.context.close();

  log("D: sign out on this device, then back in with the same passkey");
  await a.page.goto(`${APP}/kumbara/guvenlik`, { waitUntil: "domcontentloaded" });
  await a.page.getByTestId("sign-out").first().click();
  await a.page.getByTestId("sign-out-dialog").waitFor({ timeout: 10000 });
  await a.page.getByTestId("sign-out-confirm").click();
  // Signed out: the landing page offers the first action again, and the kumbara screen no longer opens.
  await a.page.getByRole("button", { name: /Başla|Get started/ }).waitFor({ timeout: 20000 });
  log("  ✓ signed out: back to the first screen");
  await a.page.getByRole("button", { name: /Passkey ile gir|Sign in with your passkey/ }).click();
  await a.page.waitForURL("**/kumbara**", { timeout: 60000 });
  await a.page.getByText(/Kumbara adresi|Kumbara address/).first().waitFor({ timeout: 30000 });
  const backIn = await contractOf(a.page);
  if (backIn !== contract) throw new Error(`signing back in reached ${backIn}, expected ${contract}`);
  log("  ✓ the same passkey opened the same kumbara again");

  log("registry: a backup passkey can be registered and looked up (unverified)");
  const fake = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const post = await fetch(`${APP}/api/registry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentialId: fake, contractId: contract }) });
  const posted = await post.json();
  if (post.status !== 201 || posted.contractId !== contract || posted.verified !== false) throw new Error(`backup registration answered ${post.status} ${JSON.stringify(posted)}`);
  const get = await (await fetch(`${APP}/api/registry?credential=${fake}`)).json();
  if (get.contractId !== contract || get.kind !== "backup") throw new Error(`backup lookup answered ${JSON.stringify(get)}`);
  const bogus = await fetch(`${APP}/api/registry?credential=not-a-credential!`);
  if (bogus.status !== 400) throw new Error(`malformed credential answered ${bogus.status}`);
  log("  ✓ backup registered as unverified; malformed ids refused");

  console.log("\nE2E RECOVER OK. console errors:", consoleErrors.length ? consoleErrors : "none");
  console.log("CONTRACT=" + contract);
} catch (err) {
  console.error("E2E RECOVER FAILED:", err);
  if (a) await a.page.screenshot({ path: ".data/e2e-recover-failure.png", fullPage: true }).catch(() => {});
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
