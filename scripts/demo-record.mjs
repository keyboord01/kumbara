// Fallback demo recording: the full round trip (onboard → deposit → vault →
// withdraw → payout) against APP_URL with Playwright's video recorder and the
// virtual passkey, written to docs/demo/ with a caption file that lists what
// happens at each timestamp. The real backup video is the one recorded on a
// phone; this is the fallback to the fallback.
//   APP_URL=https://kumbara.sembol.xyz pnpm demo:record
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "https://kumbara.sembol.xyz";
const ADMIN = process.env.BOOTH_ADMIN_TOKEN?.trim();
const OUT = process.env.DEMO_DIR ?? "docs/demo";
const MAX_SECONDS = 300;
if (!ADMIN) throw new Error("BOOTH_ADMIN_TOKEN is required to play the bank (pnpm demo:record loads .env)");
mkdirSync(OUT, { recursive: true });
const tmp = `${OUT}/.recording`;
rmSync(tmp, { recursive: true, force: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: tmp, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const t0 = Date.now();
const captions = [];
const stamp = () => (Date.now() - t0) / 1000;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const caption = (text) => {
  const at = stamp();
  captions.push({ at, text });
  console.log(`[${mmss(at)}] ${text}`);
};
const pause = (ms) => page.waitForTimeout(ms);

async function waitStatus(testId, doneRe, maxPolls, onTick) {
  let last = "";
  for (let i = 0; i < maxPolls; i += 1) {
    const current = ((await page.getByTestId(testId).textContent().catch(() => "")) ?? "").trim();
    if (current && current !== last) {
      caption(`Status: ${current}`);
      last = current;
    }
    if (doneRe.test(current)) return;
    if (/Olmadı/.test(current)) throw new Error(`flow failed: ${current}`);
    if (onTick) await onTick();
    await page.waitForTimeout(2000);
  }
  throw new Error(`timed out waiting for ${doneRe}; last: ${last}`);
}

async function playBank(reference) {
  const admin = await context.newPage();
  await admin.goto(`${APP}/booth/admin?token=${encodeURIComponent(ADMIN)}`, { waitUntil: "networkidle" });
  await admin.getByText(reference).first().waitFor({ timeout: 20000 });
  await admin.getByRole("button", { name: /Bankayı oynat|Play the bank/ }).click();
  await admin.locator("[role=status]").filter({ hasText: /simüle edildi|simulated/ }).waitFor({ timeout: 30000 });
  await admin.close();
}

let videoPath = null;
try {
  await page.goto(`${APP}/?ref=e2e&net=testnet`, { waitUntil: "networkidle" });
  caption("Landing page on Stellar TESTNET: one button, no password, no app, no XLM.");
  await pause(2500);
  await page.getByRole("button", { name: /Kumbaranı aç/ }).click();
  caption("Tap 'Kumbaranı aç': the passkey (Face ID, Touch ID or a password manager) creates the key; the relay deploys the smart account.");
  await page.waitForURL("**/kumbara**", { timeout: 60000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  caption("Savings screen: the kumbara exists on-chain, TESTNET address with a stellar.expert link.");
  await page.locator("a[href='/yukle']").waitFor({ timeout: 90000 });
  caption("Spending limit (1,000 USDC per transaction) installed in the background; Deposit unlocks.");
  await pause(2000);

  await page.locator("a[href='/yukle']").click();
  await page.waitForURL("**/yukle", { timeout: 15000 });
  const input = page.locator("input[type=number]");
  await input.waitFor({ timeout: 20000 });
  await input.fill("100");
  caption("Deposit: 100 TRY, indicative USDC quote from the anchor.");
  await pause(1500);
  await page.getByRole("button", { name: /Devam/ }).click();
  const reference = ((await page.getByTestId("deposit-reference").textContent({ timeout: 30000 })) ?? "").trim();
  caption(`IBAN screen: bank details and the reference ${reference} the visitor puts in the transfer description.`);
  await pause(2500);
  await playBank(reference);
  caption("Presenter plays the bank on /booth/admin (sandbox transfer); the app detects the lira.");
  await waitStatus("deposit-current", /Tamam\. USDC kasada\./, 100, async () => {
    const tap = page.getByRole("button", { name: /Kasaya koy/ });
    if (await tap.isVisible().catch(() => false)) await tap.click();
  });
  caption("USDC went anchor → bridge account → kumbara → DeFindex vault; three TESTNET transaction links.");
  await pause(2500);

  await page.locator("a[href='/kumbara']").first().click();
  await page.waitForURL("**/kumbara", { timeout: 15000 });
  await page.getByText("Kumbara adresi").first().waitFor({ timeout: 30000 });
  for (let i = 0; i < 10; i += 1) {
    const inVault = ((await page.locator("section[aria-label='Kumbarada'] p.tnum").first().textContent()) ?? "").trim();
    if (/[1-9]/.test(inVault)) break;
    await page.getByRole("button", { name: "Yenile" }).click().catch(() => {});
    await pause(3000);
  }
  caption("Savings shows the vault balance and its lira equivalent (Reflector rate).");
  await pause(2500);

  await page.goto(`${APP}/cek`, { waitUntil: "networkidle" });
  const wInput = page.locator("input[type=number]");
  await wInput.waitFor({ timeout: 20000 });
  await wInput.fill("1");
  await page.locator("div.rounded-xl.bg-paper-2 p.tnum").first().waitFor({ timeout: 20000 });
  caption("Withdraw: 1 USDC, sell quote in lira; the payout goes to the visitor's IBAN.");
  await pause(2000);
  await page.getByRole("button", { name: /Devam/ }).click();
  await waitStatus("withdraw-current", /Tamam\. Lira IBAN/, 120, async () => {
    const tap = page.getByRole("button", { name: /passkey/i });
    if (await tap.isVisible().catch(() => false)) await tap.click();
  });
  const payout = ((await page.getByTestId("withdraw-payout").textContent()) ?? "").trim();
  caption(`Payout ${payout}: vault withdrawal, transfer through the reverse bridge account, anchor FAST payout (simulated).`);
  await pause(3000);
  await page.locator("a[href='/kumbara']").first().click();
  await page.waitForURL("**/kumbara", { timeout: 15000 });
  caption("Back on Savings: the remaining USDC stays in the vault. End of the round trip.");
  await pause(2000);
} finally {
  const video = page.video();
  await context.close();
  videoPath = video ? await video.path() : null;
  await browser.close();
}
if (!videoPath) throw new Error("no video was recorded");
const total = stamp();
const mp4 = `${OUT}/round-trip.mp4`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", videoPath, "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
rmSync(tmp, { recursive: true, force: true });
copyFileSync(mp4, mp4); // keep the mp4; the webm is gone with the temp dir
const size = statSync(mp4).size;
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", mp4]).toString().trim());
if (duration > MAX_SECONDS) throw new Error(`video is ${duration.toFixed(0)} s, over the ${MAX_SECONDS} s cap`);

const recordedAt = new Date().toISOString();
const md = [
  "# Fallback demo recording",
  "",
  `Recorded ${recordedAt} against ${APP} (Stellar TESTNET) by \`pnpm demo:record\`: Playwright, Chrome, virtual passkey, 390×844. Duration ${mmss(duration)} (${duration.toFixed(0)} s), ${(size / 1_000_000).toFixed(1)} MB, no audio. The real backup video is the one recorded on a phone at the booth; this file is the fallback to that fallback.`,
  "",
  "| Time | What happens |",
  "| --- | --- |",
  ...captions.map((c) => `| ${mmss(c.at)} | ${c.text} |`),
  "",
];
writeFileSync(`${OUT}/round-trip.captions.md`, md.join("\n"));
const vtt = ["WEBVTT", ""];
captions.forEach((c, i) => {
  const end = captions[i + 1]?.at ?? total;
  const ts = (s) => `${mmss(s)}.${String(Math.floor((s % 1) * 1000)).padStart(3, "0")}`;
  vtt.push(`${ts(c.at)} --> ${ts(Math.max(c.at + 0.5, end))}`, c.text, "");
});
writeFileSync(`${OUT}/round-trip.vtt`, vtt.join("\n"));
console.log(`\nvideo: ${mp4} (${mmss(duration)}, ${(size / 1_000_000).toFixed(1)} MB); captions: ${OUT}/round-trip.captions.md, ${OUT}/round-trip.vtt`);
