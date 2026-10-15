/* Language: English (the app's own text) or Thai.
   The app is written in English. This file translates what it draws, after it
   draws it, so no render code has to know about languages:
     - a dictionary (i18n-th.js) maps each English string to its Thai text;
     - a few patterns cover strings with a number or name in them
       ("{n} assigned" -> "{n} มอบหมายแล้ว");
     - a MutationObserver walks everything added to the page — text, and the
       title / placeholder / aria-label / alt attributes — and swaps it;
     - alert / confirm / prompt are wrapped the same way.
   The English original is remembered for every node it changes, so switching
   back restores it exactly. Names and notes people typed are not in the
   dictionary and stay as they were written. The choice is kept in this
   browser (localStorage "manpower.lang"). Nothing happens in English.
   In the console, I18N.missing() lists the strings that were shown in Thai
   mode without a translation. */
(function () {
  "use strict";
  var KEY = "manpower.lang";
  var ATTRS = ["title", "placeholder", "aria-label", "alt"];
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/;
  var DATA = "[data-no-i18n], .emp-name, .emp-surname";   // people's names are data, not interface

  var dict = Object.create(null);
  var patterns = [];                 // { re, keys, th }
  var cache = new Map();             // English -> Thai (or null: no translation)
  var missing = new Set();
  var lang = "en";
  try { if (localStorage.getItem(KEY) === "th") lang = "th"; } catch (e) { /* private mode: English */ }

  var DOW = { Sun: "อา.", Mon: "จ.", Tue: "อ.", Wed: "พ.", Thu: "พฤ.", Fri: "ศ.", Sat: "ส." };
  var MON = { Jan: "ม.ค.", Feb: "ก.พ.", Mar: "มี.ค.", Apr: "เม.ย.", May: "พ.ค.", Jun: "มิ.ย.", Jul: "ก.ค.", Aug: "ส.ค.", Sep: "ก.ย.", Oct: "ต.ค.", Nov: "พ.ย.", Dec: "ธ.ค." };
  var MONTH_FULL = { January: "มกราคม", February: "กุมภาพันธ์", March: "มีนาคม", April: "เมษายน", May: "พฤษภาคม", June: "มิถุนายน", July: "กรกฎาคม", August: "สิงหาคม", September: "กันยายน", October: "ตุลาคม", November: "พฤศจิกายน", December: "ธันวาคม" };

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* "{n} of {m} placed" -> a regex with one capture per placeholder */
  function compile(en, th) {
    var keys = [];
    var src = en.split(/(\{\w+\})/).map(function (part) {
      var m = /^\{(\w+)\}$/.exec(part);
      if (m) { keys.push(m[1]); return m[1] === "time" ? "(\\d{1,2}:\\d{2})" : m[1] === "num" ? "(-?\\d[\\d,.]*)" : "(.*?)"; }
      return esc(part);
    }).join("");
    return { re: new RegExp("^" + src + "$"), keys: keys, th: th, len: en.length };
  }

  /* dates drawn by fmtDate / fmtDow ("Tue 25-Aug-2026") and month names */
  function dates(s) {
    return s
      .replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b(?=,? \d{1,2}[ -](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/g, function (m) { return DOW[m]; })
      .replace(/\b(\d{1,2}[ -])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, function (m, d, mo) { return d + MON[mo]; })
      .replace(/\b(January|February|March|April|June|July|August|September|October|November|December)\b(?= \d{4})/g, function (m) { return MONTH_FULL[m]; });
  }

  /* the Thai for one string, or null when there is none */
  function lookup(en) {
    if (en in dict) return dict[en];
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i], m = p.re.exec(en);
      if (!m) continue;
      var vals = {};
      p.keys.forEach(function (k, j) { vals[k] = tr(m[j + 1]); });
      return p.th.replace(/\{(\w+)\}/g, function (all, k) { return k in vals ? vals[k] : all; });
    }
    return null;
  }

  /* A string the app built from several pieces ("Person A • Permanent • AREA1",
     two sentences joined, a title with a second line) is translated piece by
     piece: lines, " • " and " · " parts, and sentences. A piece with no
     translation (a name, say) is left as it is. */
  var LINES = /(\n+)/;
  var SPLIT = /(\s*[•·]\s*|(?<=[.!?:;])\s+)/;
  function piece(p) {
    var core = p.trim();
    if (!/[A-Za-z]/.test(core)) return p;
    var th = lookup(core);
    if (th === null) {
      var m = /^(.*?)([.:!]+)$/.exec(core);          // "Saved." when the dictionary has "Saved"
      if (m) { th = lookup(m[1]); if (th !== null) th += m[2]; }
    }
    if (th === null) return null;
    return p.slice(0, p.indexOf(core)) + th + p.slice(p.indexOf(core) + core.length);
  }
  /* split on `sep` (separators sit at odd positions); each part is tried whole,
     then handed to `inner`. Returns null when nothing in it had a translation. */
  function eachPart(s, sep, inner, unknown) {
    var hit = false;
    var out = s.split(sep).map(function (p, i) {
      if (i % 2 || !/[A-Za-z]/.test(p)) return p;
      var t = piece(p);
      if (t === null && inner) t = inner(p, unknown);
      if (t === null) { if (/[A-Za-z]{3}/.test(p)) unknown.push(p.trim()); return p; }
      hit = true;
      return t;
    });
    return hit ? out.join("") : null;
  }
  function pieces(s) {
    var unknown = [];
    var out = eachPart(s, LINES, function (line, unk) { return eachPart(line, SPLIT, null, unk); }, unknown);
    if (out === null) return null;
    unknown.forEach(function (u) { missing.add(u); });
    return out;
  }

  /* The last resort for a sentence built from a count and a noun ("3 missions
     with no crew"): the count + noun becomes Thai, and the English left between
     the numbers and Thai is looked up as its own piece. */
  var UNITS = {
    board: "บอร์ด", mission: "ภารกิจ", host: "โฮสต์", engineer: "วิศวกร", inspector: "ผู้ตรวจสอบ", employee: "พนักงาน",
    person: "คน", people: "คน", staff: "คน", crew: "คน", day: "วัน", week: "สัปดาห์", month: "เดือน", year: "ปี", row: "แถว",
    slide: "สไลด์", file: "ไฟล์", number: "ตัวเลข", hold: "รายการจอง", shift: "กะ", area: "พื้นที่", name: "ชื่อ",
    change: "รายการเปลี่ยนแปลง", decision: "การตัดสินใจ", user: "ผู้ใช้", request: "คำขอ", site: "ไซต์", cell: "ช่อง", page: "หน้า",
    account: "บัญชี", role: "บทบาท", record: "รายการ", match: "รายการที่ตรงกัน", item: "รายการ", leave: "การลา", employees: "พนักงาน"
  };
  var UNIT_RE = new RegExp("\\b(\\d[\\d,]*) (" + Object.keys(UNITS).join("|") + ")(?:s|es)?\\b", "g");
  var THAI_RUN = /([\d,.:%]+(?: ?[ก-๙]+)?|[ก-๙][ก-๙ ]*)/;
  function stitch(body) {
    var changed = false;
    var withUnits = body.replace(UNIT_RE, function (m, n, w) { changed = true; return n + " " + UNITS[w]; });
    var unknown = [];
    var out = withUnits.split(THAI_RUN).map(function (part, i) {
      if (i % 2 || !/[A-Za-z]/.test(part)) return part;
      var t = piece(part);
      if (t === null) { if (/[A-Za-z]{3}/.test(part)) unknown.push(part.trim()); return part; }
      changed = true;
      return t;
    });
    if (!changed) return null;
    unknown.forEach(function (u) { missing.add(u); });
    return out.join("");
  }

  /* Translate a string, keeping its leading and trailing spaces and treating
     any run of whitespace inside it as one space (HTML source is indented). */
  function tr(s) {
    if (lang !== "th" || typeof s !== "string" || !/[A-Za-z]/.test(s)) return s;
    var hit = cache.get(s);
    if (hit === undefined) {
      var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
      var body = s.slice(lead.length, s.length - trail.length);
      var core = body.replace(/\s+/g, " ");
      var th = core ? lookup(core) : null;
      if (th === null && core) {
        var d = dates(core);
        if (d !== core) th = d;
        else if ((th = pieces(body)) === null && (th = stitch(body)) === null) missing.add(core);
      }
      hit = th === null ? s : lead + th + trail;
      cache.set(s, hit);
    }
    return hit;
  }

  /* alert / confirm / prompt messages: line by line, else as a whole */
  function tm(s) {
    if (lang !== "th" || typeof s !== "string") return s;
    var whole = tr(s);
    if (whole !== s) return whole;
    return s.split("\n").map(tr).join("\n");
  }

  /* ----- the page ----- */
  var texts = new WeakMap();   // Text node  -> { orig, out }
  var attrs = new WeakMap();   // Element    -> { attr: { orig, out } }

  function skipEl(el) {
    return !el || SKIP.test(el.nodeName) || (el.closest && el.closest(DATA));
  }
  function doText(node) {
    var rec = texts.get(node);
    if (rec && node.nodeValue === rec.out) return;          // already ours
    if (skipEl(node.parentNode)) return;
    var orig = node.nodeValue, out = tr(orig);
    if (out !== orig) { texts.set(node, { orig: orig, out: out }); node.nodeValue = out; }
    else if (rec) texts.delete(node);
  }
  function doAttrs(el) {
    if (skipEl(el)) return;
    var recs = attrs.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v == null) continue;
      var r = recs && recs[a];
      if (r && v === r.out) continue;
      var out = tr(v);
      if (out !== v) {
        if (!recs) { recs = {}; attrs.set(el, recs); }
        recs[a] = { orig: v, out: out };
        el.setAttribute(a, out);
      } else if (r) delete recs[a];
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { doAttrs(root); if (SKIP.test(root.nodeName)) return; }
    var w = document.createTreeWalker(root, 1 | 4);   // elements and text
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function restore(root) {
    var w = document.createTreeWalker(root, 1 | 4), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) {
        var r = texts.get(n);
        if (r && n.nodeValue === r.out) n.nodeValue = r.orig;
        texts.delete(n);
      } else {
        var recs = attrs.get(n);
        if (recs) {
          Object.keys(recs).forEach(function (a) { if (n.getAttribute(a) === recs[a].out) n.setAttribute(a, recs[a].orig); });
          attrs.delete(n);
        }
      }
    }
  }
  function doTitle() {
    var t = document.title;
    if (doTitle.rec && t === doTitle.rec.out) return;
    var out = tr(t);
    if (out !== t) { doTitle.rec = { orig: t, out: out }; document.title = out; }
  }

  var observer = null;
  function onMutations(list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === "childList") {
        if (m.target === document.head || (m.target.nodeName === "TITLE")) { doTitle(); continue; }
        for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      } else if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doAttrs(m.target);
    }
  }
  function start() {
    walk(document.body);
    doTitle();
    if (!observer) observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function stop() {
    if (observer) observer.disconnect();
    restore(document.body);
    if (doTitle.rec && document.title === doTitle.rec.out) document.title = doTitle.rec.orig;
    doTitle.rec = null;
  }

  /* ----- native dialogs ----- */
  ["alert", "confirm", "prompt"].forEach(function (name) {
    var native = window[name];
    if (typeof native !== "function") return;
    window[name] = function (msg) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = tm(msg);
      return native.apply(window, args);
    };
  });

  /* ----- public ----- */
  function setLang(next) {
    next = next === "th" ? "th" : "en";
    if (next === lang) return;
    try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered */ }
    if (next === "en") { stop(); lang = "en"; }
    else { lang = "th"; cache.clear(); start(); }
    document.documentElement.lang = lang;
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang: lang } }));
  }

  window.I18N = {
    t: tr,
    tm: tm,
    lang: function () { return lang; },
    setLang: setLang,
    /* English -> Thai, and patterns "…{name}…" -> "…{name}…" (longest first) */
    add: function (words, pats) {
      Object.keys(words || {}).forEach(function (k) { dict[k.replace(/\s+/g, " ").trim()] = words[k]; });
      Object.keys(pats || {}).forEach(function (k) { patterns.push(compile(k, pats[k])); });
      patterns.sort(function (a, b) { return b.len - a.len; });
      cache.clear();
    },
    missing: function () { return Array.from(missing).sort(); }
  };

  /* English never touches the page; Thai starts once the page is there */
  document.documentElement.lang = lang;
  if (lang === "th") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
