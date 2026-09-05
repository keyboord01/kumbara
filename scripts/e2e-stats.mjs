// Gate 5 end-to-end: the public /stats page renders headline numbers that are
// non-negative integers, the feed renders, the TV mode loads, and the seed/e2e
// sources stay out of the default numbers.
//   APP_URL=https://kumbara.vercel.app node scripts/e2e-stats.mjs
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3100";
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
});
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

try {
  log("open /stats");
  await page.goto(`${APP}/stats`, { waitUntil: "networkidle" });
  await page.getByTestId("headline").waitFor({ timeout: 30000 });
  const numbers = {};
  for (const key of ["accounts", "deposits", "withdrawals"]) {
    const el = page.getByTestId(`headline-${key}`);
    for (let i = 0; i < 20 && (await el.textContent())?.trim() === "–"; i += 1) await page.waitForTimeout(1000);
    const text = ((await el.textContent()) ?? "").trim();
    const n = Number(text.replace(/[.,\s]/g, ""));
    if (!Number.isInteger(n) || n < 0) throw new Error(`headline ${key} is not a non-negative integer: "${text}"`);
    numbers[key] = n;
  }
  const badges = await page.locator("[data-testid='headline'] [aria-label='TESTNET']").count();
  log("headline:", JSON.stringify(numbers), `TESTNET badges: ${badges}`);
  if (badges < 5) throw new Error(`expected a TESTNET badge next to every money figure, saw ${badges}`);
  for (const key of ["tryIn", "tryOut"]) {
    const text = ((await page.getByTestId(`headline-${key}`).textContent()) ?? "").trim();
    if (!/[0-9]/.test(text)) throw new Error(`headline ${key} shows no number: "${text}"`);
  }
  const vault = ((await page.getByTestId("headline-usdcInVault").textContent()) ?? "").trim();
  log("vault (live):", vault);

  await page.getByTestId("feed").waitFor({ timeout: 10000 });
  const items = await page.locator("[data-testid='feed-item']").count();
  log("feed items:", items);
  if (items > 20) throw new Error("feed shows more than 20 events");
  if (items > 0) {
    const links = await page.locator("[data-testid='feed-item'] a[href*='stellar.expert']").count();
    if (links < 1) throw new Error("feed items carry no explorer links");
    const addr = ((await page.locator("[data-testid='feed-item'] .font-mono").first().textContent()) ?? "").trim();
    if (!/…/.test(addr)) throw new Error(`feed shows an untruncated address: ${addr}`);
  } else {
    await page.getByTestId("feed-empty").waitFor({ timeout: 5000 });
  }
  await page.getByTestId("curve").waitFor({ timeout: 10000 });
  await page.getByTestId("timings").waitFor({ timeout: 10000 });
  const timingsText = ((await page.getByTestId("timings").textContent()) ?? "").replace(/\s+/g, " ");
  log("timings:", timingsText.slice(0, 160));
  await page.getByTestId("health").waitFor({ timeout: 20000 });
  log("✓ headline, feed, curve, timings, health rendered");

  log("default numbers exclude seed and e2e");
  const [plain, all] = await Promise.all([fetch(`${APP}/api/metrics`).then((r) => r.json()), fetch(`${APP}/api/metrics?include=all`).then((r) => r.json())]);
  if (!plain.filter.sources.every((s) => s === "user")) throw new Error(`default sources: ${plain.filter.sources}`);
  if (all.headline.accounts < plain.headline.accounts) throw new Error("include=all returned fewer accounts than the default");
  log(`  default accounts ${plain.headline.accounts}, with seed+e2e ${all.headline.accounts}`);

  log("EN toggle");
  await page.getByRole("button", { name: "en", exact: true }).click();
  await page.getByText("kumbaras opened").first().waitFor({ timeout: 10000 });

  log("TV mode");
  await page.goto(`${APP}/stats?mode=tv`, { waitUntil: "networkidle" });
  await page.getByTestId("headline").waitFor({ timeout: 30000 });
  if ((await page.getByTestId("how").count()) !== 0) throw new Error("TV mode still shows the how-it-works section");
  log("✓ TV mode hides the reference sections");
  console.log("\nE2E STATS OK. console errors:", consoleErrors.length ? consoleErrors : "none");
} catch (err) {
  console.error("E2E STATS FAILED:", err);
  await page.screenshot({ path: ".data/e2e-stats-failure.png", fullPage: true }).catch(() => {});
  console.log("body:", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 800));
  console.log("console errors:", consoleErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
