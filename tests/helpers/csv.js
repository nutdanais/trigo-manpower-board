/* Test fixture helper only: lets the unit tests write a small table as CSV text
   instead of nested arrays. The app itself reads Excel (.xlsx) files only. */
"use strict";

function parseCsv(text) {
  text = String(text || "").replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] || "";
  const count = (c) => { let n = 0, q = false; for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q && ch === c) n++; } return n; };
  const delim = [",", ";", "\t"].map((c) => [c, count(c)]).sort((a, b) => b[1] - a[1])[0];
  const d = delim[1] ? delim[0] : ",";
  const rows = [];
  let row = [], field = "", q = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { parseCsv };
