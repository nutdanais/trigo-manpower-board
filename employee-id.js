/* Employee identity rules, shared by the Edit Employee form, cloud.js and bulk
   edit (bulk-edit.js). Pure functions: no DOM, no network.

   An employee is told apart by their TRIGO ID ("T329": the letter T and 1-6
   digits), kept in its own field. The Name field holds the FULL name only —
   first name and surname — never an ID, an initial or a nickname added to make
   two people look different. That is what these helpers enforce:
     normalizeTrigoId  "t-329" -> "T329";  null when it isn't an ID at all
     splitNameAndId    "Somchai Jaidee T329" -> { name, trigoId }   (the one-off
                       clean-up of names that already carry an ID; the SQL in
                       migration-2026-10-03-trigo-id.sql does the same on the
                       database and is checked against this function by
                       tests/sql/trigo-id-split.test.sh)
     checkFullName     "" when fine, otherwise the reason it isn't a full name
     nameClash         is this name already taken by someone it can't be told
                       apart from? Two people may share a name only when both
                       have a TRIGO ID. */
(function (root) {
  "use strict";

  const norm = (s) => String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
  const ID = "T\\d{1,6}(?!\\d)";
  const SEP = "\\-–—:.,_/|";
  // a name part must hold something other than space, punctuation and digits ("T329 - 123" is not a name)
  const hasLetter = (s) => /[^\s\p{P}\p{S}\d]/u.test(s);

  function normalizeTrigoId(v) {
    const s = norm(v).toUpperCase().replace(/^T[\s-]+/, "T");
    if (!s) return "";
    return /^T\d{1,6}$/.test(s) ? s : null;
  }

  const LEAD = new RegExp(`^[(\\[\\s]*(${ID})[\\s)\\]${SEP}]*(.+)$`, "iu");
  const TRAIL = new RegExp(`^(.+?)[\\s${SEP}(\\[]+(${ID})[\\s)\\]]*$`, "iu");
  const cleanName = (s) => norm(s).replace(new RegExp(`^[\\s${SEP}()\\[\\]]+|[\\s${SEP}()\\[\\]]+$`, "gu"), "");

  /* The ID goes first or last in the name ("T329 Somchai", "Somchai (T329)",
     "Somchai - T329"). One ID, one name left over: anything else (an ID in the
     middle, two IDs, nothing but an ID) is left for a person to sort out. */
  function splitNameAndId(raw) {
    const s = norm(raw);
    const lead = LEAD.exec(s), trail = TRAIL.exec(s);
    if (lead && trail) return null;
    const m = lead || trail;
    if (!m) return null;
    const id = (lead ? m[1] : m[2]).toUpperCase();
    const name = cleanName(lead ? m[2] : m[1]);
    if (!hasLetter(name) || new RegExp(`(^|[\\s${SEP}(\\[])${ID}`, "iu").test(name)) return null;
    return { name, trigoId: id };
  }
  const hasIdInName = (name) => new RegExp(`(^|[\\s${SEP}(\\[])${ID}([\\s)\\]${SEP}]|$)`, "iu").test(norm(name));

  function checkFullName(name) {
    const s = norm(name);
    if (!s) return "Enter the employee's full name";
    if (hasIdInName(s)) return "Put the TRIGO ID in its own field — the name should be the full name only";
    if (s.split(" ").filter((w) => hasLetter(w)).length < 2) return "Enter the full name (first name and surname, e.g. สมชาย ใจดี)";
    return "";
  }

  /* employees: [{id, name, trigoId}]. Returns the existing employee this name/ID would clash with, or null. */
  function nameClash(employees, name, trigoId, exceptId) {
    const key = norm(name).toLowerCase();
    return (employees || []).find((e) => e.id !== exceptId && norm(e.name).toLowerCase() === key && !(trigoId && e.trigoId)) || null;
  }
  function idClash(employees, trigoId, exceptId) {
    if (!trigoId) return null;
    return (employees || []).find((e) => e.id !== exceptId && e.trigoId && e.trigoId.toUpperCase() === trigoId.toUpperCase()) || null;
  }

  const api = { normalizeTrigoId, splitNameAndId, checkFullName, hasIdInName, nameClash, idClash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EmployeeId = api;
})(globalThis);
