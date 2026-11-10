// Recovery drill, automated part (SOW 1, D1): a backup passkey restores access. Live testnet, Chrome's virtual
// authenticator. Device A creates a kumbara and enrols a recovery passkey on the Security page (the chain adds it as a
// signer, and the registry stores it only after reading it there). Device B is a fresh browser holding ONLY the backup
// passkey: the recovery screen finds the same kumbara through the registry and opens it. Device B then signs a profile
// change with the backup passkey, which proves the server accepts it as an owner.
// This stands in for, and does not replace, the drill on three real device/browser pairs (docs/drills/recovery.md).
// Records a video of device B and screenshots into E2E_EVIDENCE_DIR when set.
//   APP_URL=http://localhost:3100 node scripts/drill-recovery.mjs
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const EVIDENCE = process.env.E2E_EVIDENCE_DIR?.trim() ?? "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const AUTH = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

async function device(credential, record = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...(record && EVIDENCE ? { recordVideo: { dir: EVIDENCE, size: { width: 390, height: 844 } } } : {}),
  });
  await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "en"); } catch { /* storage off */ } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH });
  if (credential) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
  return { context, page, cdp, authenticatorId };
}
const shot = async (page, name) => {
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });
};
const contractOf = async (page) => (await page.getByTestId("kumbara-address").getAttribute("title"))?.trim();

try {
  log("device A: create a kumbara");
  const a = await device();
  await a.page.goto(`${APP}/?ref=e2e-drill&net=testnet`, { waitUntil: "networkidle" });
  await a.page.getByRole("button", { name: /Get started/ }).click();
  await a.page.waitForURL("**/kumbara**", { timeout: 300000 });
  await a.page.getByTestId("kumbara-address").waitFor({ timeout: 60000 });
  const contract = await contractOf(a.page);
  const before = (await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId })).credentials;
  log("  kumbara", contract, "primary passkey", before[0].credentialId.slice(0, 12) + "…");

  log("device A: enrol a recovery passkey on the Security page");
  await a.page.goto(`${APP}/kumbara/guvenlik`, { waitUntil: "load" });
  await a.page.getByRole("button", { name: /Recovery passkey/ }).click();
  const registered = a.page.waitForResponse((r) => r.url().includes("/api/registry") && r.request().method() === "POST", { timeout: 180000 });
  await a.page.getByRole("button", { name: /Create recovery passkey/ }).click();
  await a.page.getByText("Recovery credential added.").waitFor({ timeout: 180000 });
  const reg = await registered;
  const regBody = await reg.json();
  log("  registry answered", reg.status(), JSON.stringify(regBody));
  if (reg.status() !== 201 || regBody.contractId !== contract || regBody.kind !== "backup" || regBody.verified !== true) throw new Error("the backup passkey was not registered as a verified backup of this kumbara");
  await shot(a.page, "recovery-1-backup-enrolled");
  const after = (await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId })).credentials;
  const backup = after.find((c) => !before.some((b) => b.credentialId === c.credentialId));
  if (!backup) throw new Error("no second passkey on device A");
  log("  backup passkey", backup.credentialId.slice(0, 12) + "…");
  await a.context.close();

  log("device B: a fresh browser that holds ONLY the backup passkey");
  const b = await device({ credentialId: backup.credentialId, isResidentCredential: true, rpId: backup.rpId, privateKey: backup.privateKey, userHandle: backup.userHandle, signCount: backup.signCount }, true);
  const bAt = Date.now();
  await b.page.goto(`${APP}/kurtar`, { waitUntil: "load" });
  await shot(b.page, "recovery-2-recovery-screen");
  await b.page.getByTestId("recover-find").click();
  await b.page.waitForURL("**/kumbara**", { timeout: 120000 });
  await b.page.getByTestId("kumbara-address").waitFor({ timeout: 60000 });
  const recovered = await contractOf(b.page);
  const seconds = (Date.now() - bAt) / 1000;
  log(`  opened ${recovered} in ${seconds.toFixed(1)}s`);
  if (recovered !== contract) throw new Error(`the backup passkey opened ${recovered}, expected ${contract}`);
  await shot(b.page, "recovery-3-same-kumbara-on-device-b");

  log("device B: the backup passkey signs a change the server accepts (rename the kumbara)");
  await b.page.getByTestId("goal-edit").click();
  await b.page.getByTestId("goal-name").fill("Recovered");
  await b.page.getByTestId("goal-save").click();
  await b.page.getByTestId("goal-name-shown").waitFor({ timeout: 60000 });
  const name = ((await b.page.getByTestId("goal-name-shown").textContent()) ?? "").trim();
  if (name !== "Recovered") throw new Error(`rename with the backup passkey showed "${name}"`);
  log("  ✓ renamed with a signature from the backup passkey");
  await shot(b.page, "recovery-4-backup-passkey-signs");

  const video = b.page.video();
  await b.context.close();
  if (EVIDENCE && video) renameSync(await video.path(), path.join(EVIDENCE, "recovery-with-backup-passkey.webm"));
  if (EVIDENCE) writeFileSync(path.join(EVIDENCE, "recovery-drill.json"), `${JSON.stringify({ at: new Date().toISOString(), app: APP, environment: "Chrome (headless) with a CDP virtual authenticator, mobile viewport", contract, recoveredInSeconds: Math.round(seconds * 10) / 10, registry: regBody }, null, 2)}\n`);
  console.log(`\nDRILL RECOVERY OK: backup passkey reopened ${contract} on a fresh device in ${seconds.toFixed(1)}s`);
  await browser.close();
} catch (err) {
  console.error("DRILL RECOVERY FAILED:", err);
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (EVIDENCE) await p.screenshot({ path: path.join(EVIDENCE, "recovery-failure.png"), fullPage: true }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
