/* Demo mode switch. index.html loads this on every visit, right before cloud.js.

   Normal visit: it does nothing at all (a few lines, no network).
   Visit with ?demo in the address (e.g. https://your-site/?demo): it pulls in the
   in-memory backend, the invented sample data and demo.js, which put a fake
   Supabase in place before cloud.js runs. Nothing then talks to a real database,
   so a demo cannot touch real data and has nothing to pause or expire.

   document.write is the one way to add scripts that must run, in order, before
   the next <script> tag in the page. */
(function () {
  "use strict";
  if (!/(^|[?&])demo(=|&|$)/.test(location.search)) return;
  var v = encodeURIComponent(window.APP_VERSION || "");
  ["fake-db.js", "fake-client.js", "seed.js", "demo.js"].forEach(function (f) {
    document.write('<script src="demo/' + f + "?v=" + v + '"><\/script>');
  });
})();
