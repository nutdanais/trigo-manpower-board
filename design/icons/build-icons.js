/* Builds the app icons in ../../icons/ from the B2 design ("Manpower Board - B2
   icon set", Claude Design): a 4x4 shift grid on TRIGO blue, white cells for
   people, one green column for today, hollow cells for gaps. At 48 px and below
   the favicon switches to a 2x2 version so it stays readable in a browser tab.

     NODE_PATH=$(npm root -g) node design/icons/build-icons.js

   Writes SVG masters plus PNGs (needs Playwright + Chromium to rasterise). The
   geometry below is the design's, unchanged, except the hollow cell's stroke
   scales with the cell (the design used a fixed 2 units, which is too heavy on
   the maskable version's smaller cells). Output is committed; the app never
   runs this. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "..", "icons");
const BLUE = "#004983", GREEN = "#a8c855", WHITE = "#fff";
const PATTERN = ["WgWW", "WgoW", "WgWW", "oWWW"];   // W person, g today's column, o gap

function cell(x, y, w, c, r) {
  if (c === "o") {
    const sw = w / 6;   // 2 units on the design's 12-unit cell
    return `<rect x="${(x + sw / 2).toFixed(2)}" y="${(y + sw / 2).toFixed(2)}" width="${(w - sw).toFixed(2)}" height="${(w - sw).toFixed(2)}" rx="${r}" fill="none" stroke="${WHITE}" stroke-width="${sw.toFixed(2)}"/>`;
  }
  return `<rect x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" width="${+w.toFixed(2)}" height="${+w.toFixed(2)}" rx="${r}" fill="${c === "g" ? GREEN : WHITE}"/>`;
}
function grid(rows, origin, step, w, r) {
  return rows.map((row, ri) => [...row].map((c, ci) => cell(origin + ci * step, origin + ri * step, w, c, r)).join("")).join("");
}
const FULL = grid(PATTERN, 22, 14.5, 12, 1);          // app icon: glyph spans 22..77.5 of 100
const SAFE = grid(PATTERN, 30.5, 10.4, 8.6, 0.7);     // maskable: inside Android's 80% safe circle
const MINI = grid(["Wg", "Wg"], 16, 36, 32, 3);       // favicon <= 48 px

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLUE}"/>${inner}</svg>\n`;

// name, glyph, size in px (null = SVG only)
const FILES = [
  ["icon.svg", FULL, null], ["favicon.svg", MINI, null],
  ["app-icon-1024.png", FULL, 1024], ["icon-512.png", FULL, 512], ["icon-192.png", FULL, 192],
  ["maskable-512.png", SAFE, 512], ["apple-touch-180.png", FULL, 180],
  ["favicon-48.png", MINI, 48], ["favicon-32.png", MINI, 32], ["favicon-16.png", MINI, 16],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const [name, glyph, px] of FILES) {
    const markup = svg(glyph);
    if (!px) { fs.writeFileSync(path.join(OUT, name), markup); console.log("wrote", name); continue; }
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${px}px;height:${px}px}</style>${markup}`);
    await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: px, height: px } });
    await page.close();
    console.log("wrote", name, px + "px");
  }
  await browser.close();
})();
