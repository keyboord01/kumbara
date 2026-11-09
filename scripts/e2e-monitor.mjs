// Pilot instrumentation (SOW 1, D3), end to end: a failure screen reports itself, one tap sends a problem report with
// the failure attached, the footer's "Report a problem" sends a note, and the presenter's monitor lists all three with
// anonymised context. The footer's status line shows live health. Screenshots into E2E_EVIDENCE_DIR when set.
//   pnpm e2e:monitor   (APP_URL defaults to http://localhost:3100; needs BOOTH_ADMIN_TOKEN)
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const ADMIN_TOKEN = process.env.BOOTH_ADMIN_TOKEN?.trim() ?? "";
if (!ADMIN_TOKEN) throw new Error("BOOTH_ADMIN_TOKEN is required");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR?.trim() ?? "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => { try { window.localStorage.setItem("kumbara.lang", "en"); } catch { /* storage off */ } });
const page = await context.newPage();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const shot = async (name) => {
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`), fullPage: true });
};
const note = `e2e monitor check ${Date.now()}`;

try {
  log("the footer's status line reads live health");
  await page.goto(`${APP}/`, { waitUntil: "load" });
  const status = page.getByTestId("status-line");
  await page.waitForFunction(() => document.querySelector("[data-testid='status-line']")?.getAttribute("data-tone") !== "unknown", null, { timeout: 60000 });
  log("  status line:", (await status.textContent())?.trim(), `(${await status.getAttribute("data-tone")})`);
  await status.scrollIntoViewIfNeeded();
  await shot("01-status-line");

  log("a failure screen reports itself; one tap sends a problem report with it");
  const errorReported = page.waitForResponse((r) => r.url().includes("/api/errors") && r.request().method() === "POST", { timeout: 30000 });
  await page.goto(`${APP}/?net=mainnet`, { waitUntil: "load" });
  await page.locator("[data-testid='failure-screen'][data-kind='wrong_network']").waitFor({ timeout: 30000 });
  log("  /api/errors answered", (await errorReported).status());
  const oneTap = page.waitForResponse((r) => r.url().includes("/api/feedback"), { timeout: 30000 });
  await page.getByTestId("feedback-instant").click();
  log("  one-tap report answered", (await oneTap).status());
  await page.getByTestId("feedback-instant").filter({ hasText: /Thanks/ }).waitFor({ timeout: 10000 });
  await shot("02-failure-screen-one-tap-report");

  log("the footer's 'Report a problem' sends a note");
  await page.goto(`${APP}/`, { waitUntil: "load" });
  await page.getByTestId("feedback-open").click();
  await page.getByTestId("feedback-message").fill(`${note} (address CDK3IMKYQN5BNGLBZQ4HWBIOITTNOBIXD6B2A5F4HRKIFSSB35N2BPZB should be cut)`);
  await shot("03-report-a-problem-dialog");
  const footerReport = page.waitForResponse((r) => r.url().includes("/api/feedback"), { timeout: 30000 });
  await page.getByTestId("feedback-send").click();
  log("  footer report answered", (await footerReport).status());

  log("the presenter's monitor lists them");
  const snap = await (await fetch(`${APP}/api/booth/admin/monitor`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } })).json();
  const wrong = snap.errors?.find((e) => e.kind === "wrong_network");
  const mine = snap.feedback?.find((f) => f.message.includes(note));
  const tapped = snap.feedback?.find((f) => f.kind === "wrong_network");
  log(`  errors by kind: ${snap.errors?.map((e) => `${e.kind}×${e.count}`).join(", ")}`);
  if (!wrong) throw new Error("the wrong_network failure is not on the monitor");
  if (!tapped) throw new Error("the one-tap report is not on the monitor");
  if (!mine) throw new Error("the footer report is not on the monitor");
  if (/CDK3IMKY/.test(mine.message) || !/\[address\]/.test(mine.message)) throw new Error(`the address was not cut from the note: ${mine.message}`);
  log(`  ✓ footer report stored as "${mine.message}" (${mine.browser} / ${mine.os}${mine.mobile ? ", phone" : ""}, ${mine.path})`);
  await page.request.post(`${APP}/api/booth/admin/session`, { data: { token: ADMIN_TOKEN } });
  await page.goto(`${APP}/booth/admin/monitor`, { waitUntil: "load" });
  await page.getByTestId("monitor-kinds").waitFor({ timeout: 30000 });
  await shot("04-monitor");
  await page.request.delete(`${APP}/api/booth/admin/session`);

  console.log("\nE2E MONITOR OK");
  await browser.close();
} catch (err) {
  console.error("E2E MONITOR FAILED:", err);
  if (EVIDENCE) await page.screenshot({ path: path.join(EVIDENCE, "failure.png"), fullPage: true }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
