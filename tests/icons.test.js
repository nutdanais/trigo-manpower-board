/* The app icon, web manifest and loading screen are wired together by hand in
   index.html; this catches a renamed or missing file, a manifest pointing at
   nothing, and the loading screen losing its version line.
     node --test tests/icons.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel.split("?")[0]));
const pngSize = (rel) => {
  const b = fs.readFileSync(path.join(ROOT, rel));
  assert.equal(b.toString("latin1", 1, 4), "PNG", rel + " must be a PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test("every icon index.html links exists, at the size it claims", () => {
  const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 4, "svg + png favicons + apple touch icon, found " + links.length);
  for (const tag of links) {
    const href = /href="([^"]+)"/.exec(tag)[1];
    assert.ok(exists(href), href + " is linked but missing");
    const size = /sizes="(\d+)x(\d+)"/.exec(tag);
    if (size) assert.deepEqual(pngSize(href.split("?")[0]), [+size[1], +size[2]], href);
  }
});

test("the manifest is linked and each of its icons exists at its stated size", () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest/);
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  assert.equal(man.background_color, "#004983");
  assert.ok(man.icons.some((i) => i.sizes === "192x192") && man.icons.some((i) => i.sizes === "512x512"));
  assert.ok(man.icons.some((i) => i.purpose === "maskable"), "an Android adaptive icon");
  for (const i of man.icons) {
    assert.ok(exists(i.src), i.src + " is in the manifest but missing");
    const [w, h] = i.sizes.split("x").map(Number);
    assert.deepEqual(pngSize(i.src), [w, h], i.src);
  }
});

test("the loading screen is the first thing in <body>, shows the version, and is dismissed by app.js", () => {
  const body = html.slice(html.indexOf("<body>"));
  assert.ok(/^<body>\s*(<!--[\s\S]*?-->\s*)?<div id="splash"/.test(body), "#splash must open the body so it paints first");
  const splash = /<div id="splash"[\s\S]*?<img class="splash-logo"[^>]*>\s*<\/div>/.exec(body);
  assert.ok(splash, "splash block");
  assert.match(splash[0], /Version <span data-app-version><\/span>/, "version line under the name");
  assert.ok(splash[0].indexOf("splash-grid") < splash[0].indexOf("splash-version"), "the version sits below the icon");
  assert.ok(body.indexOf('src="version.js') < body.indexOf("planning.js"), "version.js loads early so the version shows on first paint");
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(app, /finally \{\s*hideSplash\(\)/, "main() must dismiss the splash even if boot() throws");
});
