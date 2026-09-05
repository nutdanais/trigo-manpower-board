// admin-users — the only place the service-role key is used.
//
// This deployment sends no email at all: there is no DNS access for a sending
// domain, and Supabase's built-in sender only delivers to members of the
// Supabase project. So accounts are created with a temporary password that an
// admin hands over in person, and the app makes the person choose their own the
// first time they sign in.
//
// Three things here need the service-role key, because all three live in
// auth.users, which a browser can never be given access to:
//   create        make an account with a password, no email sent
//   set-password  reissue a password for someone who has forgotten theirs
//   delete        destroy an account
// Everything else the Users pane does — approve, reject, change role, disable —
// is a plain table write under RLS and needs nothing from this file.
//
// Deploy it from the Supabase dashboard (Edge Functions → Deploy a new
// function → paste this file) or with `supabase functions deploy admin-users`.
// The CLI is not required.
//
// There are no secrets to configure. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are all provided by the platform.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* ---------- temporary passwords ----------
   Generated here rather than typed by the admin: it is one less weak password,
   and it means the value is never something the admin might reuse elsewhere.
   The alphabet is 32 characters, so 256 % 32 === 0 and the modulo introduces no
   bias. I, O, 0 and 1 are left out — these get read out over the phone. */

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789#$";

function tempPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/* ---------- guards ----------
   The same two rules the UI shows and the database enforces with triggers.
   Checked here as well because this function bypasses RLS: a rule that only
   holds in two of the three places is not a rule. */

function assertNotSelf(callerId: string, targetId: string) {
  if (callerId === targetId) throw new Error("You can't change your own account here — ask another admin.");
}

async function assertNotLastAdmin(targetId: string) {
  const { data: target } = await admin.from("profiles").select("role_key, status").eq("id", targetId).maybeSingle();
  if (!target || target.role_key !== "admin" || target.status !== "active") return;
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
    .eq("role_key", "admin").eq("status", "active").neq("id", targetId);
  if (!count) throw new Error("This is the only active admin — promote someone else first.");
}

async function allowedDomains(): Promise<string[]> {
  const { data } = await admin.from("allowed_email_domains").select("domain");
  return (data ?? []).map((d: { domain: string }) => d.domain.toLowerCase());
}

/* ---------- handler ---------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    // 1. who is calling? The anon client validates the caller's own JWT — the
    //    service-role client below would happily accept anything.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Not signed in." }, 401);
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !user) return json({ error: "Not signed in." }, 401);

    // 2. may they? public.can() reads auth.uid(), which is null under the
    //    service key, so the same question is asked directly here.
    const { data: me } = await admin.from("profiles").select("role_key, status").eq("id", user.id).maybeSingle();
    if (!me || me.status !== "active") return json({ error: "Your account is not active." }, 403);
    const { data: perm } = await admin.from("role_permissions").select("level")
      .eq("role_key", me.role_key).eq("area", "users").maybeSingle();
    if (perm?.level !== "edit") return json({ error: "Your role can't manage users." }, 403);

    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.fullName ?? "").trim();
      const roleKey = String(body.roleKey ?? "viewer");
      if (!email.includes("@")) return json({ error: "That doesn't look like an email address." }, 400);
      // The domain rule is a trigger on auth.users, so this check is not what
      // enforces it — it is what turns an opaque trigger 500 into a sentence.
      const domains = await allowedDomains();
      if (domains.length && !domains.includes(email.split("@")[1])) {
        return json({ error: `Only ${domains.map((d) => "@" + d).join(" or ")} addresses can be added.` }, 400);
      }

      const password = tempPassword();
      // email_confirm: true is what stops Supabase trying to send a
      // confirmation message that could never be delivered here.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) return json({ error: error.message }, 400);

      // The account arrives already approved at the role the admin picked —
      // making them wait for an approval the same admin would give is silly.
      await admin.from("profiles").update({
        full_name: fullName || null,
        role_key: roleKey,
        status: "active",
        approved_at: new Date().toISOString(),
        approved_by: user.email,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      }).eq("id", data.user.id);

      return json({ ok: true, id: data.user.id, password });
    }

    if (action === "set-password") {
      const id = String(body.id ?? "");
      // An admin changes their own password in Settings → My account. Keeping
      // it out of here means they cannot replace it with a value they only saw
      // once and then close the dialog.
      assertNotSelf(user.id, id);

      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({
        must_change_password: true,
        updated_at: new Date().toISOString(),
      }).eq("id", id);

      return json({ ok: true, password });
    }

    if (action === "delete") {
      const id = String(body.id ?? "");
      assertNotSelf(user.id, id);
      await assertNotLastAdmin(id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      // profiles.id references auth.users on delete cascade, so the row goes too
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong." }, 400);
  }
});
