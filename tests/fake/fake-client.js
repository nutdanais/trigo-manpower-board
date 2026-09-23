/* The client half of the fake Supabase backend (see fake-db.js): a stand-in
   for supabase-js that builds the same query objects FakeDb.exec understands.

   Browser (end-to-end tests): served in place of the supabase-js CDN script.
   Queries go to window.__fakeSupabaseExec (a Playwright binding into the test
   process, where the one shared FakeDb lives); Realtime events come back in
   through window.__fakeSupabaseEmit. window.__fakeSession is the signed-in user.

   Node (unit tests): require() it and pass an exec function. */
(function (root) {
  "use strict";

  class Query {
    constructor(exec, table) {
      this._exec = exec;
      this.q = { table, op: "select", filters: [], order: [], select: "*", returning: false };
    }
    select(cols = "*", opts = {}) {
      if (this.q.op === "select") {
        this.q.select = cols;
        if (opts.head) this.q.head = true;
      } else {
        this.q.returning = true;
        this.q.select = cols;
      }
      return this;
    }
    _mut(op, values, extra = {}) { Object.assign(this.q, { op, values, select: null, returning: false }, extra); return this; }
    insert(values) { return this._mut("insert", values); }
    upsert(values, opts = {}) { return this._mut("upsert", values, { onConflict: opts.onConflict || null, ignoreDuplicates: !!opts.ignoreDuplicates }); }
    update(values) { return this._mut("update", values); }
    delete() { return this._mut("delete", null); }
    _f(op, col, val) { this.q.filters.push([op, col, val]); return this; }
    eq(c, v) { return this._f("eq", c, v); }
    neq(c, v) { return this._f("neq", c, v); }
    lt(c, v) { return this._f("lt", c, v); }
    lte(c, v) { return this._f("lte", c, v); }
    gt(c, v) { return this._f("gt", c, v); }
    gte(c, v) { return this._f("gte", c, v); }
    in(c, v) { return this._f("in", c, v); }
    is(c, v) { return this._f("is", c, v); }
    not(c, op, v) {
      if (op !== "is") throw new Error("fake client: only not(col, 'is', value) is supported");
      return this._f("notis", c, v);
    }
    order(col, opts = {}) { this.q.order.push({ col, asc: opts.ascending !== false }); return this; }
    limit(n) { this.q.limit = n; return this; }
    range(a, b) { this.q.range = [a, b]; return this; }
    single() { this.q.single = "single"; return this; }
    maybeSingle() { this.q.single = "maybe"; return this; }
    then(res, rej) { return Promise.resolve(this._exec(JSON.parse(JSON.stringify(this.q)))).then(res, rej); }
  }

  function makeClient(exec, opts = {}) {
    let session = opts.session || null;
    const authListeners = [];
    const channels = [];
    const client = {
      from: (table) => new Query(exec, table),
      rpc: (fn, args) => Promise.resolve(exec({ op: "rpc", fn, args: args || {} })),
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: (cb) => { authListeners.push(cb); setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithPassword: async () => ({ error: null }),
        signOut: async () => { session = null; for (const cb of authListeners) cb("SIGNED_OUT", null); return { error: null }; },
        signUp: async () => ({ error: null }),
        updateUser: async () => ({ error: null }),
      },
      functions: { invoke: async () => ({ data: null, error: { message: "admin-users is not available in tests" } }) },
      channel: () => {
        const handlers = [];
        const ch = {
          on: (_type, filter, cb) => { handlers.push({ table: filter.table, event: filter.event || "*", cb }); return ch; },
          subscribe: () => { channels.push(handlers); return ch; },
        };
        return ch;
      },
      /* test hook: deliver one Realtime change to this client's channels */
      _emit(evt) {
        for (const hs of channels) {
          for (const h of hs) {
            if (h.table === evt.table && (h.event === "*" || h.event === evt.eventType)) {
              Promise.resolve().then(() => h.cb({ eventType: evt.eventType, table: evt.table, schema: "public", new: evt.new, old: evt.old }));
            }
          }
        }
      },
    };
    return client;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { makeClient };
  } else {
    let theClient = null;
    root.supabase = {
      createClient() {
        theClient = makeClient((q) => root.__fakeSupabaseExec(q), { session: root.__fakeSession || null });
        return theClient;
      },
    };
    root.__fakeSupabaseEmit = (evt) => { if (theClient) theClient._emit(evt); };
  }
})(typeof window !== "undefined" ? window : globalThis);
