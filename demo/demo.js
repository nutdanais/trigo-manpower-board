/* Demo mode: the app against an in-memory database, in this browser tab only.

   Loaded by demo-gate.js when the address has ?demo, after fake-db.js,
   fake-client.js (which replaces window.supabase) and seed.js, and before
   cloud.js. Everything is invented sample data, worked out from today's date.
   Nothing is saved: a reload (or the Reset button) starts again from the seed,
   and every visitor has a database of their own.

   ?demo                  signs in as an Admin (sees everything)
   ?demo&role=manager     or engineer, viewer: the same data, that role's permissions */
(function (root) {
  "use strict";

  const S = root.DemoSeed;
  const db = new root.FakeDb();
  S.seed(db);

  /* who is "signed in": the sample account for the chosen role */
  const ROLES = ["admin", "manager", "engineer", "viewer"];
  const asked = (new URLSearchParams(location.search).get("role") || "admin").toLowerCase();
  const role = ROLES.includes(asked) ? asked : "admin";
  const profile = db.t("profiles").find((p) => p.role_key === role && p.status === "active") || db.t("profiles")[0];
  const user = { id: profile.id, email: profile.email };

  root.__demo = { db, user, role };
  root.__fakeSession = { user: { id: user.id, email: user.email }, access_token: "demo" };
  root.__fakeSupabaseExec = (q) => db.exec(q, user);
  root.SUPABASE_CONFIG = { url: "demo", anonKey: "demo" };

  /* A real Realtime event arrives after the write has been answered; the fake
     one is called inside it, so hand it over on the next tick. */
  db.subscribe((evt) => setTimeout(() => { if (root.__fakeSupabaseEmit) root.__fakeSupabaseEmit(evt); }, 0));

  /* The two profile RPCs the Profile dialog and Engineer box call, which the
     test backend never needed. */
  db.rpcs.update_my_profile = (a, u) => {
    const me = db.t("profiles").find((p) => p.id === u.id);
    if (!me) return null;
    if (a.p_full_name != null) me.full_name = a.p_full_name;
    if (a.p_display_name !== undefined && a.p_display_name !== null) me.display_name = a.p_display_name || me.display_name;
    if (a.p_phone != null) me.phone = a.p_phone;
    return null;
  };
  db.rpcs.ensure_engineer_for_profile = (a) => {
    const have = db.t("engineers").find((e) => e.profile_id === a.p_profile_id);
    if (have) return have.id;
    const p = db.t("profiles").find((x) => x.id === a.p_profile_id);
    const colours = ["#2a78d6", "#e07b39", "#4d9a3a", "#c9a0e8", "#d9a400", "#d4577b"];
    return db._insertRow("engineers", {
      name: (p && (p.display_name || p.full_name)) || "Engineer", phone: (p && p.phone) || "",
      color: colours[db.t("engineers").length % colours.length], profile_id: a.p_profile_id,
    }, null).id;
  };

  /* Two things the test client does not do and a demo must:
     - accounts live in auth.users, which the browser never touches, so the
       admin-users function (create / reset / delete an account) says so politely;
     - there is no sign-in screen to come back to, so Sign out starts the demo over. */
  const createClient = root.supabase.createClient;
  root.supabase.createClient = function () {
    const client = createClient.apply(this, arguments);
    client.functions = {
      invoke: async () => ({ data: null, error: { message: "Creating, resetting and deleting accounts is switched off in the demo. Approving, role changes and disabling still work." } }),
    };
    client.auth.signOut = async () => { location.reload(); return { error: null }; };
    return client;
  };

  /* ---------- the "this is a demo" strip ---------- */
  const css = `
    #demo-strip{position:fixed;right:10px;bottom:10px;z-index:99;display:flex;align-items:center;gap:8px;
      max-width:calc(100vw - 20px);padding:6px 6px 6px 12px;border-radius:999px;background:#003a66;color:#fff;
      font:600 12px/1.2 Geist,"Noto Sans Thai",system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,30,60,.35)}
    #demo-strip b{letter-spacing:.06em;color:#a8d98a}
    #demo-strip span{opacity:.85;font-weight:500}
    #demo-strip select,#demo-strip button{font:inherit;font-weight:600;color:#003a66;background:#fff;border:0;border-radius:999px;padding:5px 10px;cursor:pointer}
    #demo-strip button.x{background:transparent;color:#fff;padding:5px 8px;opacity:.7}
    #demo-strip b{cursor:pointer}
    /* z-index 99: above the board, just below dialogs (100) and toasts (400), so it never covers a Save button */
    /* a phone has no room for the controls: only the DEMO tag shows until it is tapped */
    @media (max-width:700px){
      #demo-strip{bottom:76px;right:8px;padding:3px 3px 3px 10px;gap:6px}
      #demo-strip span,#demo-strip select,#demo-strip .reset{display:none}
      #demo-strip.open select,#demo-strip.open .reset{display:inline-block}
    }`;

  function strip() {
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    const el = document.createElement("div");
    el.id = "demo-strip";
    el.innerHTML = '<b>DEMO</b><span>Sample data · not saved</span>' +
      '<select aria-label="Sign in as">' + ROLES.map((r) => '<option value="' + r + '"' + (r === role ? " selected" : "") + ">" + r[0].toUpperCase() + r.slice(1) + "</option>").join("") + "</select>" +
      '<button type="button" class="reset">Reset</button><button type="button" class="x" aria-label="Hide this note">×</button>';
    el.querySelector("select").addEventListener("change", (e) => { location.search = "?demo&role=" + e.target.value; });
    el.querySelector(".reset").addEventListener("click", () => location.reload());
    el.querySelector("b").addEventListener("click", () => el.classList.toggle("open"));
    el.querySelector(".x").addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }
  if (document.body) strip(); else document.addEventListener("DOMContentLoaded", strip);
})(window);
