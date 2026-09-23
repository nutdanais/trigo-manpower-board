/* Load the real cloud.js (a browser script) into a node vm, wired to a FakeDb
   as the given user. Returns { cloud, sb, db }. planning.js is loaded into the
   same context first, exactly as index.html orders the two scripts. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { FakeDb } = require("./fake-db");
const { makeClient } = require("./fake-client");

const ROOT = path.join(__dirname, "..", "..");

function loadCloud({ db = new FakeDb(), user = { id: "u-a", email: "eng.a@example.com" } } = {}) {
  const sb = makeClient((q) => db.exec(q, user), { session: { user } });
  const context = {
    window: { supabase: { createClient: () => sb }, SUPABASE_CONFIG: { url: "http://fake", anonKey: "fake" } },
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, Set, Map, Object, Array, String, Number, Boolean, Error,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "planning.js"), "utf8"), context, { filename: "planning.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "cloud.js"), "utf8") + "\n;globalThis.__cloud = cloud;", context, { filename: "cloud.js" });
  return { cloud: context.__cloud, sb, db, context };
}

module.exports = { loadCloud, FakeDb };
