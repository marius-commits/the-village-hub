import { adminClient } from "../_shared/db.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { normalizePhone } from "../_shared/phone.ts";

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export default {
  async fetch(req: Request) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const ingestKey = Deno.env.get("LEAD_INGEST_SECRET");
    if (!ingestKey || req.headers.get("x-village-lead-key") !== ingestKey) {
      return json({ error: "unauthorized" }, 401);
    }

    let body: Record<string, any>;
    try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

    if (clean(body.website, 100)) return json({ ok: true, spam: true });

    const source = clean(body.source, 100) ?? "website";
    const externalLeadId = clean(body.external_lead_id, 200);
    const phone = normalizePhone(clean(body.phone, 80));
    const email = clean(body.email, 320)?.toLowerCase() ?? null;

    if (!phone && !email) return json({ error: "phone_or_email_required" }, 400);

    const values = {
      source,
      external_lead_id: externalLeadId,
      campaign_id: clean(body.campaign_id, 200),
      campaign_name: clean(body.campaign_name, 300),
      ad_group_id: clean(body.ad_group_id, 200),
      ad_id: clean(body.ad_id, 200),
      form_id: clean(body.form_id, 200),
      gclid: clean(body.gclid, 300),
      utm_source: clean(body.utm_source, 200),
      utm_medium: clean(body.utm_medium, 200),
      utm_campaign: clean(body.utm_campaign, 300),
      utm_term: clean(body.utm_term, 300),
      utm_content: clean(body.utm_content, 300),
      first_name: clean(body.first_name, 120),
      last_name: clean(body.last_name, 120),
      email,
      phone_e164: phone,
      company_name: clean(body.company, 200),
      interest: clean(body.interest ?? body.plan_interest, 250),
      preferred_date: clean(body.preferred_date, 20),
      message: clean(body.message ?? body.description, 3000),
      metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
    };

    const db = adminClient();
    let query;
    if (externalLeadId) {
      query = db.from("leads").upsert(values, { onConflict: "source,external_lead_id", ignoreDuplicates: false });
    } else {
      query = db.from("leads").insert(values);
    }
    const { data: lead, error } = await query.select("*").single();
    if (error) return json({ error: "lead_insert_failed", detail: error.message }, 500);

    await db.from("attribution_events").insert({
      lead_id: lead.id,
      event_type: "lead_created",
      source,
      campaign_id: values.campaign_id,
      gclid: values.gclid,
      metadata: { utm_source: values.utm_source, utm_medium: values.utm_medium, utm_campaign: values.utm_campaign },
    });

    if (phone) {
      await db.from("message_queue").upsert({
        lead_id: lead.id,
        template_key: "lead_acknowledgement",
        due_at: new Date().toISOString(),
        unique_key: `lead_ack:${lead.id}`,
        payload_json: { lead_id: lead.id, first_name: values.first_name },
      }, { onConflict: "unique_key", ignoreDuplicates: true });
    }

    return json({ ok: true, lead_id: lead.id }, 201);
  },
};
