/* Cut a new release version.
     node bump-version.js            next version: today's date, or the next
                                     letter if today already has a release
     node bump-version.js 2026-10-04a   set it explicitly
   Rewrites version.js and every ?v= on a local script / stylesheet in
   index.html so they all carry the same string. Favicon ?v= are left alone. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const VERSION_FILE = path.join(__dirname, "version.js");
const INDEX_FILE = path.join(__dirname, "index.html");
const FORMAT = /^\d{4}-\d{2}-\d{2}[a-z]$/;
const VERSION_RE = /(window\.APP_VERSION\s*=\s*")([^"]*)(")/;
// local .js / .css only: <script src="x.js?v=…"> and <link href="x.css?v=…">
const TAG_RE = /((?:src|href)="(?!https?:)[^"?]+\.(?:js|css))\?v=[^"]*(")/g;

function today(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function nextVersion(current, date = today()) {
  if (!current.startsWith(date)) return date + "a";
  const letter = current.slice(-1);
  if (letter === "z") throw new Error("Already at " + current + " — pass a version explicitly.");
  return date + String.fromCharCode(letter.charCodeAt(0) + 1);
}

function apply(version, versionJs, indexHtml) {
  if (!FORMAT.test(version)) throw new Error('Version must look like 2026-10-04a, got "' + version + '"');
  if (!VERSION_RE.test(versionJs)) throw new Error("version.js has no window.APP_VERSION line");
  return {
    versionJs: versionJs.replace(VERSION_RE, "$1" + version + "$3"),
    indexHtml: indexHtml.replace(TAG_RE, "$1?v=" + version + "$2"),
  };
}

module.exports = { nextVersion, apply, today };

if (require.main === module) {
  const versionJs = fs.readFileSync(VERSION_FILE, "utf8");
  const current = (versionJs.match(VERSION_RE) || [])[2] || "";
  const version = process.argv[2] || nextVersion(current);
  const out = apply(version, versionJs, fs.readFileSync(INDEX_FILE, "utf8"));
  fs.writeFileSync(VERSION_FILE, out.versionJs);
  fs.writeFileSync(INDEX_FILE, out.indexHtml);
  console.log(current + " -> " + version);
}
