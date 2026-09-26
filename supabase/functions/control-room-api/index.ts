import { authenticatedAdmin } from "../_shared/db.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
function boundedLimit(value: string | null, fallback = 50) { const n = Number(value ?? fallback); return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : fallback; }

export default { async fetch(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await authenticatedAdmin(req); if (!auth.ok) return json({ error: auth.reason }, 403); const { db, admin } = auth;
  const url = new URL(req.url); const view = url.searchParams.get("view") || "summary"; const limit = boundedLimit(url.searchParams.get("limit"));
  if (req.method === "GET") {
    if (view === "summary") { const { data, error } = await db.rpc("control_room_summary"); if (error) return json({ error: error.message }, 500); return json({ data, admin }); }
    if (view === "bookings") { const from = url.searchParams.get("from") ?? new Date(Date.now() - 86400000).toISOString(); const to = url.searchParams.get("to") ?? new Date(Date.now() + 7 * 86400000).toISOString(); const { data, error } = await db.from("bookings").select("*,contact:contacts(id,first_name,last_name,email,phone_e164,company_name)").gte("start_at", from).lte("start_at", to).order("start_at", { ascending: true }).limit(limit); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (view === "messages") { const { data, error } = await db.from("message_log").select("*,contact:contacts(id,first_name,last_name,phone_e164),booking:bookings(spacebring_booking_id,resource_name,booking_title,start_at,end_at)").order("created_at", { ascending: false }).limit(limit); if (error) return json({ error: error.message }, 500); const { data: queue } = await db.from("message_queue").select("*,contact:contacts(first_name,last_name,phone_e164),booking:bookings(resource_name,booking_title,start_at)").in("status", ["queued","processing","failed","dead_letter"]).order("due_at", { ascending: true }).limit(limit); return json({ data, queue: queue ?? [] }); }
    if (view === "leads") { const { data, error } = await db.from("leads").select("*").order("created_at", { ascending: false }).limit(limit); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (view === "feedback") { const { data, error } = await db.from("feedback").select("*,contact:contacts(first_name,last_name,email,phone_e164),booking:bookings(resource_name,booking_title,start_at)").order("created_at", { ascending: false }).limit(limit); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (view === "automations") { const { data, error } = await db.from("automation_rules").select("*").order("rule_key"); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (view === "health") { const { data, error } = await db.from("system_health").select("*").order("key"); if (error) return json({ error: error.message }, 500); const { data: failed } = await db.from("message_queue").select("id,template_key,due_at,attempts,last_error,status").in("status", ["failed","dead_letter"]).order("updated_at", { ascending: false }).limit(25); return json({ data, failed_messages: failed ?? [] }); }
    if (view === "marketing") { const days = Math.max(7, Math.min(365, Number(url.searchParams.get("days") || 90))); const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); const { data, error } = await db.from("ad_campaign_daily").select("*").gte("metric_date", since).order("metric_date", { ascending: true }).limit(5000); if (error) return json({ error: error.message }, 500); return json({ data }); }
    return json({ error: "unknown_view" }, 400);
  }
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({})); const resource = String(body.resource || ""), id = String(body.id || ""), patch = body.patch && typeof body.patch === "object" ? body.patch : {}; if (!id) return json({ error: "id_required" }, 400);
    if (resource === "lead") { const allowed: Record<string, any> = {}; for (const k of ["status","owner","first_response_at"]) if (k in patch) allowed[k] = patch[k]; const { data, error } = await db.from("leads").update(allowed).eq("id", id).select("*").single(); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (resource === "feedback") { const allowed: Record<string, any> = {}; for (const k of ["needs_follow_up","follow_up_owner","follow_up_status","resolved_at"]) if (k in patch) allowed[k] = patch[k]; const { data, error } = await db.from("feedback").update(allowed).eq("id", id).select("*").single(); if (error) return json({ error: error.message }, 500); return json({ data }); }
    if (resource === "automation" && admin.role === "admin") { const allowed: Record<string, any> = {}; for (const k of ["enabled","delay_minutes","cooldown_days","config_json"]) if (k in patch) allowed[k] = patch[k]; const { data, error } = await db.from("automation_rules").update(allowed).eq("id", id).select("*").single(); if (error) return json({ error: error.message }, 500); return json({ data }); }
    return json({ error: "unsupported_patch" }, 400);
  }
  return json({ error: "method_not_allowed" }, 405);
}};
