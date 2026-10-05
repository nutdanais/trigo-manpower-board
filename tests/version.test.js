/* The release version has one source (version.js); everything else is checked
   against it here so a hand-edit that drifts is caught before it ships.
     node --test tests/version.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { nextVersion, apply } = require("../bump-version");

const ROOT = path.join(__dirname, "..");
const versionJs = fs.readFileSync(path.join(ROOT, "version.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const VERSION = (/window\.APP_VERSION\s*=\s*"([^"]*)"/.exec(versionJs) || [])[1];

test("version.js declares a date-and-letter version", () => {
  assert.match(VERSION, /^\d{4}-\d{2}-\d{2}[a-z]$/);
});

test("every local script and stylesheet in index.html carries that version", () => {
  const tags = [...indexHtml.matchAll(/(?:src|href)="((?!https?:)[^"?]+\.(?:js|css))(\?v=[^"]*)?"/g)];
  assert.ok(tags.length >= 8, "expected the app's scripts and stylesheet, found " + tags.length);
  for (const [, file, v] of tags) {
    if (file.startsWith("vendor/") || file === "config.js") continue;   // deliberately unversioned
    assert.equal(v, "?v=" + VERSION, file + " must be loaded as " + file + "?v=" + VERSION + " (run node bump-version.js)");
  }
  assert.ok(indexHtml.includes('src="version.js?v=' + VERSION + '"'), "version.js itself must be loaded");
});

test("nextVersion: first release of a day, then the next letter", () => {
  assert.equal(nextVersion("2026-10-03b", "2026-10-04"), "2026-10-04a");
  assert.equal(nextVersion("2026-10-04a", "2026-10-04"), "2026-10-04b");
  assert.equal(nextVersion("2026-10-04y", "2026-10-04"), "2026-10-04z");
  assert.throws(() => nextVersion("2026-10-04z", "2026-10-04"), /explicitly/);
});

test("apply rewrites version.js and the local ?v= tags, and nothing else", () => {
  const html = '<link rel="icon" href="favicon.svg?v=1">\n<link rel="stylesheet" href="styles.css?v=old">\n' +
    '<script src="https://cdn.example.com/x.js"></script>\n<script src="app.js?v=old"></script>\n<script src="config.js"></script>';
  const out = apply("2026-10-04a", 'window.APP_VERSION = "old";', html);
  assert.equal(out.versionJs, 'window.APP_VERSION = "2026-10-04a";');
  assert.ok(out.indexHtml.includes('styles.css?v=2026-10-04a'));
  assert.ok(out.indexHtml.includes('app.js?v=2026-10-04a'));
  assert.ok(out.indexHtml.includes('favicon.svg?v=1'), "favicon ?v= left alone");
  assert.ok(out.indexHtml.includes('src="https://cdn.example.com/x.js"'), "remote scripts untouched");
  assert.ok(out.indexHtml.includes('src="config.js"'), "unversioned scripts untouched");
  assert.throws(() => apply("2026-10-4", "", ""), /Version must look like/);
});
