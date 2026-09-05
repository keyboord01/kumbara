// Render docs/deck/kumbara-deck.html (ten 1920×1080 slides) to
//   docs/deck/kumbara-deck.pdf, docs/deck/slides/slide-NN.png and
//   docs/deck/contact-sheet.png with Playwright (Chrome). The Mermaid diagram
//   is rendered in the page (cdnjs) and stays a vector in the PDF.
//   node scripts/build-deck.mjs
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DECK = path.resolve("docs/deck");
const HTML = path.join(DECK, "kumbara-deck.html");
const SLIDES = path.join(DECK, "slides");
mkdirSync(SLIDES, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${HTML}`, { waitUntil: "networkidle" });
// Wait for the Mermaid render (or its failure) so the PDF never ships a raw code block.
await page.waitForFunction(() => Boolean(document.body.dataset.mermaid), null, { timeout: 30000 }).catch(() => undefined);
const mermaidState = await page.evaluate(() => document.body.dataset.mermaid ?? "timeout");
const hasSvg = await page.locator("#seq svg").count();
console.log(`mermaid: ${mermaidState}; svg rendered: ${hasSvg}`);
if (mermaidState !== "ok" || !hasSvg) throw new Error(`Mermaid diagram did not render (${mermaidState})`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

// Every slide as a PNG (for the contact sheet and the PPTX export).
const slides = page.locator("section.slide");
const n = await slides.count();
for (let i = 0; i < n; i += 1) {
  await slides.nth(i).screenshot({ path: path.join(SLIDES, `slide-${String(i + 1).padStart(2, "0")}.png`) });
}
// The PDF: one page per slide at the CSS page size.
const pdf = path.join(DECK, "kumbara-deck.pdf");
await page.emulateMedia({ media: "print" });
await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });

// Contact sheet: 2 columns × 5 rows of the slide PNGs.
const files = readdirSync(SLIDES).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
const sheet = await browser.newPage({ viewport: { width: 1600, height: 100 } });
// Data URIs: a page created with setContent has no file: origin, so file:// images would be blocked.
const cells = files.map((f, i) => `<figure><img src="data:image/png;base64,${readFileSync(path.join(SLIDES, f)).toString("base64")}"><figcaption>${i + 1}</figcaption></figure>`).join("");
await sheet.setContent(`<!doctype html><html><head><style>
  body{margin:0;background:#fbf7f0;font-family:ui-sans-serif,system-ui,sans-serif;color:#12313a}
  .wrap{padding:28px 32px}
  h1{font-size:22px;margin:0 0 14px;letter-spacing:-.01em}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
  figure{margin:0}
  img{width:100%;display:block;border:1px solid #e3dccd;border-radius:8px;background:#fff}
  figcaption{font-family:ui-monospace,monospace;font-size:12px;color:#5a6b71;margin-top:4px}
</style></head><body><div class="wrap"><h1>Kumbara by Sembol · project deck · contact sheet (10 slides, 16:9, Stellar TESTNET)</h1><div class="grid">${cells}</div></div></body></html>`);
await sheet.waitForLoadState("networkidle");
await sheet.screenshot({ path: path.join(DECK, "contact-sheet.png"), fullPage: true });
await browser.close();

const size = statSync(pdf).size;
console.log(`slides: ${n}; pdf: ${pdf} (${(size / 1_000_000).toFixed(2)} MB); pngs: ${files.length}; contact sheet: docs/deck/contact-sheet.png`);
if (size > 10_000_000) throw new Error("PDF is over 10 MB");
