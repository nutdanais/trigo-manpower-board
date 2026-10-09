/* Builds the app icons in ../../icons/ — one mark everywhere: four tiles on
   TRIGO blue, three white (people) and one green (today), top right. The same
   2x2 mark is the browser-tab favicon, the home-screen icon and, drawn in HTML,
   the loading screen's grid (#splash in index.html).

     NODE_PATH=$(npm root -g) node design/icons/build-icons.js

   Writes SVG masters plus PNGs (needs Playwright + Chromium to rasterise; set
   CHROMIUM_PATH if Playwright's own browser isn't installed). Output is
   committed; the app never runs this. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "..", "icons");
const BLUE = "#004983", GREEN = "#a8c855", WHITE = "#fff";
const PATTERN = ["Wg", "WW"];   // W person, g today

function cell(x, y, w, c, r) {
  return `<rect x="${+x.toFixed(2)}" y="${+y.toFixed(2)}" width="${+w.toFixed(2)}" height="${+w.toFixed(2)}" rx="${+r.toFixed(2)}" fill="${c === "g" ? GREEN : WHITE}"/>`;
}
// a 2x2 grid `size` units wide, centred in the 100-unit tile; gap = 1/8 of a tile
function grid(size) {
  const w = size * 32 / 68, step = size * 36 / 68, origin = (100 - size) / 2, r = size * 3 / 68;
  return PATTERN.map((row, ri) => [...row].map((c, ci) => cell(origin + ci * step, origin + ri * step, w, c, r)).join("")).join("");
}
const MARK = grid(68);   // spans 16..84 of 100: the favicon the app already had, and now every icon
const SAFE = grid(52);   // maskable: corners inside Android's 80% safe circle (52/sqrt(2) < 40)

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLUE}"/>${inner}</svg>\n`;

// name, glyph, size in px (null = SVG only)
const FILES = [
  ["icon.svg", MARK, null], ["favicon.svg", MARK, null],
  ["app-icon-1024.png", MARK, 1024], ["icon-512.png", MARK, 512], ["icon-192.png", MARK, 192],
  ["maskable-512.png", SAFE, 512], ["apple-touch-180.png", MARK, 180],
  ["favicon-48.png", MARK, 48], ["favicon-32.png", MARK, 32], ["favicon-16.png", MARK, 16],
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
