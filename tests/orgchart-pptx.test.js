// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../orgchart-pptx.js");

const emp = (i) => ({ type: "employee", name: "Person " + i, position: "Inspector", contract: "permanent", areaColor: "#7fb8ec", children: [] });
const mission = (id, crew) => ({ type: "mission", name: id, sub: "Host", shift: "day", count: crew + " crew", children: Array.from({ length: crew }, (_, i) => emp(id + "-" + i)) });
const area = (name, ms) => ({ type: "area", name, color: "#7fb8ec", count: "", children: ms });
const eng = (name, as) => ({ type: "engineer", name, role: "Engineer", color: "#a8d98a", count: "", children: as });
const board = (name, es) => ({ type: "board", name, count: "", children: es });

test("a small board is one slide, at full size, with every card on it", () => {
  const b = board("Board One", [eng("Eng A", [area("AMATA", [mission("M1", 3), mission("M2", 2)])])]);
  const d = O.layoutDeck([b]);
  assert.equal(d.slides.length, 1);
  assert.equal(d.slides[0].scale, 1);
  // board, engineer, area, 2 missions, 5 crew rows
  assert.equal(d.slides[0].boxes.length, 10);
  assert.match(O.summaryText(d), /^1 slide, one per board\. Board One: 1 slide\.$/);
});

test("a board too wide for one slide splits between its engineers and every slide fits", () => {
  const es = Array.from({ length: 9 }, (_, i) => eng("Eng " + i, [area("A" + i, [mission("M" + i + "a", 4), mission("M" + i + "b", 4)])]));
  const d = O.layoutDeck([board("Big Board", es)]);
  assert.ok(d.slides.length > 1, "split");
  assert.deepEqual(d.summary[0].splitBy, ["engineers"]);
  assert.match(O.summaryText(d), /split between its engineers/);
  for (const s of d.slides) {
    assert.ok(s.scale >= O.MIN_SCALE - 1e-9, "readable size");
    for (const b of s.boxes) {
      assert.ok(b.x >= 0 && b.x + b.w <= O.SLIDE_W + 1e-6 && b.y + b.h <= O.SLIDE_H + 1e-6, "on the slide");
    }
    assert.equal(s.boxes.filter(b => b.node.type === "board").length, 1, "each part repeats the board card");
  }
  // nobody lost or doubled across the parts
  const crew = d.slides.flatMap(s => s.boxes.filter(b => b.kind === "row").map(b => b.node.name));
  assert.equal(crew.length, 72);
  assert.equal(new Set(crew).size, 72);
});

test("collapsed nodes (Show to) come in with no children and stay single cards", () => {
  const b = board("B", [eng("E", [])]);
  const d = O.layoutDeck([b, board("C", [])]);
  assert.equal(d.slides.length, 2);
  assert.equal(d.slides[1].boxes.length, 1);
});

test("a long crew list wraps into columns under its mission", () => {
  const d = O.layoutDeck([board("B", [eng("E", [area("A", [mission("M", 30)])])])]);
  const xs = new Set(d.slides[0].boxes.filter(b => b.kind === "row").map(b => b.x.toFixed(3)));
  assert.ok(xs.size >= 3);
});
