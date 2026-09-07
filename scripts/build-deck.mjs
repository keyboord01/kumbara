// Render docs/deck/kumbara-deck.html (1920×1080 slides) in its two variants:
//   scf        → docs/deck/kumbara-deck-scf.pdf        (12 slides: 1–9, Roadmap, Budget and metric, hours appendix)
//   hackathon  → docs/deck/kumbara-deck-hackathon.pdf  (8 slides for the Rise In × Stellar Pro Hackathon judges: no SCF material)
// plus docs/deck/slides-<variant>/slide-NN.png and docs/deck/contact-sheet-<variant>.png,
// with Playwright (Chrome). The Mermaid diagram renders in the page (cdnjs) and stays a vector in the PDF.
//   node scripts/build-deck.mjs            # both variants
//   VARIANT=hackathon node scripts/build-deck.mjs
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DECK = path.resolve("docs/deck");
const HTML = path.join(DECK, "kumbara-deck.html");
const VARIANTS = process.env.VARIANT ? [process.env.VARIANT] : ["scf", "hackathon"];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
for (const variant of VARIANTS) {
  const slidesDir = path.join(DECK, `slides-${variant}`);
  rmSync(slidesDir, { recursive: true, force: true });
  mkdirSync(slidesDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`file://${HTML}#variant=${variant}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(document.body.dataset.mermaid), null, { timeout: 30000 }).catch(() => undefined);
  const mermaidState = await page.evaluate(() => document.body.dataset.mermaid ?? "timeout");
  const diagrams = await page.locator("pre.mermaid:visible").count();
  const svgs = await page.locator("pre.mermaid:visible svg").count();
  if (diagrams > 0 && (mermaidState !== "ok" || svgs < diagrams)) throw new Error(`Mermaid did not render for ${variant} (${mermaidState}, ${svgs}/${diagrams} svg)`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const slides = page.locator("section.slide:visible");
  const n = await slides.count();
  for (let i = 0; i < n; i += 1) {
    await slides.nth(i).screenshot({ path: path.join(slidesDir, `slide-${String(i + 1).padStart(2, "0")}.png`) });
  }
  const pdf = path.join(DECK, `kumbara-deck-${variant}.pdf`);
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.close();

  // Contact sheet: two columns of the slide PNGs (data URIs: a setContent page has no file: origin).
  const files = readdirSync(slidesDir).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 100 } });
  const cells = files.map((f, i) => `<figure><img src="data:image/png;base64,${readFileSync(path.join(slidesDir, f)).toString("base64")}"><figcaption>${i + 1}</figcaption></figure>`).join("");
  await sheet.setContent(`<!doctype html><html><head><style>
    body{margin:0;background:#fbf7f0;font-family:ui-sans-serif,system-ui,sans-serif;color:#12313a}
    .wrap{padding:28px 32px} h1{font-size:22px;margin:0 0 14px;letter-spacing:-.01em}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px} figure{margin:0}
    img{width:100%;display:block;border:1px solid #e3dccd;border-radius:8px;background:#fff}
    figcaption{font-family:ui-monospace,monospace;font-size:12px;color:#5a6b71;margin-top:4px}
  </style></head><body><div class="wrap"><h1>Kumbara by Sembol · project deck · ${variant} variant · contact sheet (${files.length} slides, 16:9, Stellar TESTNET)</h1><div class="grid">${cells}</div></div></body></html>`);
  await sheet.waitForLoadState("networkidle");
  await sheet.screenshot({ path: path.join(DECK, `contact-sheet-${variant}.png`), fullPage: true });
  await sheet.close();

  const size = statSync(pdf).size;
  console.log(`${variant}: ${n} slides; ${path.relative(process.cwd(), pdf)} (${(size / 1_000_000).toFixed(2)} MB); contact-sheet-${variant}.png`);
  if (size > 10_000_000) throw new Error(`${variant} PDF is over 10 MB`);
}
await browser.close();
