// admin-users — the only place the service-role key is used.
//
// Everything else the Users pane does is a plain table write under RLS. Two
// things are not: creating an account (invite) and destroying one (delete),
// because both live in auth.users, which the browser can never be given access
// to. This function is that narrow bridge, plus the notification emails.
//
// Deploy it from the Supabase dashboard (Edge Functions → Deploy a new
// function → paste this file) or with `supabase functions deploy admin-users`.
// The CLI is not required.
//
// Secrets to set on the function (Edge Functions → admin-users → Secrets):
//   RESEND_API_KEY  re_...          from resend.com → API Keys
//   MAIL_FROM       "TRIGO Manpower Board <no-reply@mail.trigo-group.com>"
//   APP_URL         https://your-site.netlify.app   (where invite links land)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// Without RESEND_API_KEY the function still invites and deletes — it just
// reports that no email went out, which is why the Users pane is usable before
// the mail side is set up.

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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* ---------- email ---------- */

type MailKind = "invited" | "approved" | "rejected" | "role-changed";

function mailFor(kind: MailKind, name: string, roleLabel: string) {
  const who = name || "there";
  const link = APP_URL ? `\n\nOpen the board: ${APP_URL}` : "";
  switch (kind) {
    case "approved":
      return {
        subject: "Your Manpower Board access is approved",
        text: `Hi ${who},\n\nYour access to the TRIGO Manpower Board has been approved. You're set up as ${roleLabel}.${link}\n\nIf you don't remember your password, use "Forgot password?" on the sign-in screen.`,
      };
    case "rejected":
      return {
        subject: "About your Manpower Board request",
        text: `Hi ${who},\n\nYour request for access to the TRIGO Manpower Board hasn't been approved. If you think that's a mistake, reply to the person who manages the board.`,
      };
    case "role-changed":
      return {
        subject: "Your Manpower Board role has changed",
        text: `Hi ${who},\n\nYour role on the TRIGO Manpower Board is now ${roleLabel}. That changes which tabs you see and what you can edit.${link}`,
      };
    case "invited":
      return {
        subject: "You've been invited to the Manpower Board",
        text: `Hi ${who},\n\nYou've been invited to the TRIGO Manpower Board as ${roleLabel}. Check your inbox for the invitation link — it sets your password and signs you in.${link}`,
      };
  }
}

async function sendMail(to: string, kind: MailKind, name: string, roleLabel: string) {
  if (!RESEND_API_KEY || !MAIL_FROM) return { sent: false, reason: "mail not configured" };
  const body = mailFor(kind, name, roleLabel);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: body.subject, text: body.text }),
  });
  if (!res.ok) return { sent: false, reason: `resend ${res.status}: ${await res.text()}` };
  return { sent: true };
}

/* ---------- guards ----------
   The same two rules the UI shows and the database enforces with triggers.
   Checked here as well because this function bypasses RLS: a rule that only
   holds in two of the three places is not a rule. */

async function assertNotSelf(callerId: string, targetId: string) {
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

async function roleLabelFor(key: string) {
  const { data } = await admin.from("roles").select("label").eq("key", key).maybeSingle();
  return data?.label ?? key;
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

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const roleKey = String(body.roleKey ?? "viewer");
      if (!email.includes("@")) return json({ error: "That doesn't look like an email address." }, 400);
      const domains = await allowedDomains();
      if (domains.length && !domains.includes(email.split("@")[1])) {
        return json({ error: `Only ${domains.map((d) => "@" + d).join(" or ")} addresses can be invited.` }, 400);
      }
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: APP_URL || undefined,
      });
      if (error) return json({ error: error.message }, 400);
      // The invite arrives already approved at the role the admin picked —
      // making them accept and then wait for approval would be silly.
      await admin.from("profiles").update({
        role_key: roleKey,
        status: "active",
        approved_at: new Date().toISOString(),
        approved_by: user.email,
        updated_at: new Date().toISOString(),
      }).eq("id", data.user.id);
      return json({ ok: true, id: data.user.id });
    }

    if (action === "delete") {
      const id = String(body.id ?? "");
      await assertNotSelf(user.id, id);
      await assertNotLastAdmin(id);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      // profiles.id references auth.users on delete cascade, so the row goes too
      return json({ ok: true });
    }

    if (action === "notify") {
      const id = String(body.id ?? "");
      const kind = String(body.kind ?? "") as MailKind;
      if (!["invited", "approved", "rejected", "role-changed"].includes(kind)) {
        return json({ error: "Unknown notification." }, 400);
      }
      const { data: target } = await admin.from("profiles")
        .select("email, full_name, role_key").eq("id", id).maybeSingle();
      if (!target) return json({ error: "No such user." }, 404);
      const result = await sendMail(target.email, kind, target.full_name ?? "", await roleLabelFor(target.role_key));
      return json({ ok: true, ...result });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong." }, 400);
  }
});
