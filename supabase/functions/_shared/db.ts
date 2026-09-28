import { createClient } from "npm:@supabase/supabase-js@2.117.1";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Supabase service credentials are missing.");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticatedAdmin(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false as const, reason: "missing_bearer" };
  const token = authHeader.slice(7);
  const db = adminClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user?.email) return { ok: false as const, reason: "invalid_user" };
  const email = userData.user.email.toLowerCase();
  const { data: admin, error } = await db
    .from("control_room_admins")
    .select("email,role,active")
    .eq("active", true)
    .ilike("email", email)
    .maybeSingle();
  if (error || !admin) return { ok: false as const, reason: "not_authorized" };
  return { ok: true as const, db, user: userData.user, admin };
}
