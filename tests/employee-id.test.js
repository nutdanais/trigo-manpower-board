// node --test tests/*.test.js
// TRIGO ID rules shared by the form, cloud.js and bulk edit.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../employee-id.js");

test("normalizeTrigoId accepts T + digits in any case and spacing, and refuses anything else", () => {
  assert.equal(E.normalizeTrigoId("T329"), "T329");
  assert.equal(E.normalizeTrigoId(" t329 "), "T329");
  assert.equal(E.normalizeTrigoId("T 329"), "T329");
  assert.equal(E.normalizeTrigoId("t-329"), "T329");
  assert.equal(E.normalizeTrigoId("T0042"), "T0042", "leading zeros are part of the ID");
  assert.equal(E.normalizeTrigoId(""), "");
  assert.equal(E.normalizeTrigoId(null), "");
  for (const bad of ["329", "TT329", "T", "T12345678", "X329", "T32A"]) assert.equal(E.normalizeTrigoId(bad), null, bad);
});

test("splitNameAndId moves an ID at the start or end out of the name", () => {
  const ok = (raw, name, id) => assert.deepEqual(E.splitNameAndId(raw), { name, trigoId: id }, raw);
  ok("Wannaphatson T329", "Wannaphatson", "T329");
  ok("T329 Somchai Jaidee", "Somchai Jaidee", "T329");
  ok("Somchai Jaidee (T329)", "Somchai Jaidee", "T329");
  ok("Somchai Jaidee [t329]", "Somchai Jaidee", "T329");
  ok("Somchai - T329", "Somchai", "T329");
  ok("สมชาย ใจดี T001", "สมชาย ใจดี", "T001");
  ok("(T7) Chai Dee", "Chai Dee", "T7");
});

test("splitNameAndId leaves the cases a person must decide", () => {
  for (const raw of ["T329", "T329 123", "Somchai T329 Jaidee", "T1 Somchai T2", "Tanaporn Chai", "Matt5", "Somchai T1234567", "Somchai T", "Somchai.P"]) {
    assert.equal(E.splitNameAndId(raw), null, raw);
  }
});

test("checkFullName: a full name only — no ID inside, at least first name and surname", () => {
  assert.equal(E.checkFullName("สมชาย ใจดี"), "");
  assert.equal(E.checkFullName("Somchai Jaidee"), "");
  assert.match(E.checkFullName("Somchai Jaidee T329"), /own field/);
  assert.match(E.checkFullName("T329 Somchai"), /own field/);
  assert.match(E.checkFullName("Somchai"), /full name/);
  assert.match(E.checkFullName("Somchai.P"), /full name/);
  assert.match(E.checkFullName("Somchai 2"), /full name/);
  assert.match(E.checkFullName("  "), /full name/);
});

test("namesakes are allowed only when both have a TRIGO ID; a TRIGO ID is unique", () => {
  const emps = [{ id: "1", name: "Somchai Jaidee", trigoId: "T1" }, { id: "2", name: "Anan Dee", trigoId: "" }];
  assert.equal(E.nameClash(emps, "somchai jaidee", "T2", null), null, "both identified: fine");
  assert.equal(E.nameClash(emps, "Somchai Jaidee", "", null).id, "1", "the new one has no ID: clash");
  assert.equal(E.nameClash(emps, "Anan Dee", "T9", null).id, "2", "the existing one has no ID: clash");
  assert.equal(E.nameClash(emps, "Anan Dee", "", "2"), null, "editing yourself never clashes");
  assert.equal(E.idClash(emps, "t1", null).id, "1");
  assert.equal(E.idClash(emps, "T1", "1"), null);
  assert.equal(E.idClash(emps, "", null), null);
});
