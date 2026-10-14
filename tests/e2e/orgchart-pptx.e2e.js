/* Acceptance run for Org Chart → Export → PowerPoint:
     - the Export panel offers PowerPoint on the Org Chart, says how many
       slides it will make (one per board) and shows a thumbnail of each;
     - the button names the slide count, and the download is a real .pptx
       whose slides hold the names as text (editable, not a picture);
     - it follows the Board dropdown and "Show to".
     NODE_PATH=$(npm root -g) node tests/e2e/orgchart-pptx.e2e.js
   Exits non-zero on the first failed check. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const JSZip = require("../../vendor/jszip.min.js");
const h = require("./harness");

async function step(name, fn) {
  try { await fn(); console.log("ok - " + name); }
  catch (e) { console.log("FAIL - " + name + "\n   " + (e && e.stack || e).split("\n").slice(0, 6).join("\n   ")); throw e; }
}

(async () => {
  const env = await h.launch();
  let failed = false;
  try {
    const TODAY = h.iso(new Date());
    const SRC = h.isWeekend(TODAY) ? h.prevWorking(TODAY) : TODAY;
    const db = new h.FakeDb();
    h.seedBase(db, { src: SRC });
    const p = (await env.openAs(db, h.USERS.a)).page;
    await p.evaluate((d) => { state.date = d; D().activeBoardId = ORGCHART_ID; return refreshAndRender(); }, SRC);
    const open = async () => {
      await p.click("#btn-export");
      await p.waitForSelector("#modal-xlsx:not(.hidden)");
      await p.check('#board-export-type input[value="pptx"]');
    };

    await step("the panel says how many slides and previews each one", async () => {
      await p.selectOption("#oc-level", "all");
      await open();
      assert.match(await p.textContent("#pptx-summary"), /^2 slides, one per board\. Board One: 1 slide; Board Two: 1 slide\./);
      assert.equal(await p.locator("#pptx-preview .pptx-thumb svg").count(), 2);
      assert.equal((await p.textContent("#btn-xlsx-go")).trim(), "Export 2 slides");
    });

    await step("Export saves an editable .pptx with the names as text", async () => {
      const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-xlsx-go")]);
      assert.match(dl.suggestedFilename(), /^org_chart_\d{4}-\d{2}-\d{2}\.pptx$/);
      const f = path.join(os.tmpdir(), "oc-" + Date.now() + ".pptx");
      await dl.saveAs(f);
      const zip = await JSZip.loadAsync(fs.readFileSync(f));
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      assert.equal(slides.length, 2);
      const xml = await zip.file("ppt/slides/slide1.xml").async("string");
      for (const t of ["Board One", "Eng One", "Person A", "101"]) assert.ok(xml.includes(t), "slide 1 has the text " + t);
      assert.ok(!/<p:pic>/.test(xml), "no pictures: every card is a shape with text");
    });

    await step("one board picked and Show to Mission: one slide, no crew", async () => {
      await p.evaluate(() => setOvBoard("b1"));
      await p.selectOption("#oc-level", "mission");
      await open();
      assert.match(await p.textContent("#pptx-summary"), /^1 slide, one per board\. Board One: 1 slide\./);
      const names = await p.evaluate(() => pptxDeck.slides[0].boxes.map((b) => b.node.type));
      assert.ok(!names.includes("employee"), "crew stays folded under its mission");
      await p.evaluate(() => { closeModal(); setOvBoard(""); });
    });
  } catch (e) {
    failed = true;
  } finally {
    await env.close();
  }
  if (failed) process.exit(1);
  console.log("all org chart PowerPoint checks passed");
})();
