// VibeFlow — account deletion (Supabase Edge Function).
//
// Required by BOTH stores for any app that creates accounts:
//   • Apple App Store Review Guideline 5.1.1(v) — in-app account deletion.
//   • Google Play — account/data deletion.
//
// The signed-in user calls this with their JWT. We:
//   1. verify the user from the JWT,
//   2. delete every row tied to their IDENTITY — devices (user_id), user_profiles
//      (id), profiles (id) — explicitly (we don't rely on FK cascade), then
//   3. delete the auth user itself with the service role.
//
// device_usage is keyed by device_id (anonymous per-device free-quota metering,
// contains no PII and is not linked to the account once devices rows are gone), so
// it is intentionally NOT deleted — that also keeps delete→recreate from resetting
// a device's free allowance.
//
// Note: this does NOT cancel an active App Store / Play subscription — those are
// managed by the store and must be cancelled there (the app tells the user so).
//
// Secrets (auto-injected): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Authenticate the caller from their JWT (service role bypasses RLS below).
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!jwt) return json({ error: "unauthenticated" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  // 2. Delete all identity-linked rows first. Children (devices) before parents so
  //    any FK to profiles/auth is satisfied regardless of cascade config.
  const steps: Array<[string, Promise<{ error: unknown }>]> = [
    ["devices", admin.from("devices").delete().eq("user_id", userId)],
    ["user_profiles", admin.from("user_profiles").delete().eq("id", userId)],
    ["profiles", admin.from("profiles").delete().eq("id", userId)],
  ];
  for (const [name, p] of steps) {
    const { error } = await p;
    if (error) return json({ error: "row_delete_failed", table: name, detail: String((error as any)?.message ?? error) }, 500);
  }

  // 3. Delete the auth user itself. If this fails, the client can safely retry —
  //    the rows are already gone and deleteUser is idempotent for our purposes.
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: "auth_delete_failed", detail: delErr.message }, 500);

  return json({ ok: true }, 200);
});
