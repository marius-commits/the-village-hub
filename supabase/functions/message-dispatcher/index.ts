import { adminClient } from "../_shared/db.ts";
import { json } from "../_shared/cors.ts";

type QueueRow = Record<string, any>;

function templateName(key: string) {
  const envKey = `WA_TEMPLATE_${key.toUpperCase()}`;
  return Deno.env.get(envKey) || key;
}

function bodyParameters(templateKey: string, contact: any, booking: any, lead: any) {
  const name = contact?.first_name || lead?.first_name || "there";
  switch (templateKey) {
    case "booking_welcome":
      return [
        { type: "text", text: name },
        { type: "text", text: booking?.resource_name || booking?.booking_title || "your booking" },
        { type: "text", text: booking?.start_at ? new Date(booking.start_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }) : "" },
      ];
    case "post_visit_feedback":
      return [
        { type: "text", text: name },
        { type: "text", text: booking?.resource_name || booking?.booking_title || "The Village Hub" },
        { type: "text", text: Deno.env.get("GOOGLE_REVIEW_URL") || "https://www.google.com/search?q=The+Village+Hub+Nooitgedacht" },
      ];
    case "post_visit_thanks": return [{ type: "text", text: name }];
    case "lead_acknowledgement": return [{ type: "text", text: name }, { type: "text", text: lead?.interest || "The Village Hub" }];
    default: return [{ type: "text", text: name }];
  }
}

async function sendWhatsApp(phone: string, templateKey: string, params: any[]) {
  const token = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("META_PHONE_NUMBER_ID");
  const graphVersion = Deno.env.get("META_GRAPH_VERSION") || "v26.0";
  const language = Deno.env.get("WA_TEMPLATE_LANGUAGE") || "en_US";
  if (!token || !phoneNumberId) throw new Error("WhatsApp Cloud API is not configured.");
  const payload = { messaging_product: "whatsapp", to: phone.replace(/^\+/, ""), type: "template", template: { name: templateName(templateKey), language: { code: language }, components: params.length ? [{ type: "body", parameters: params }] : [] } };
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Meta API ${res.status}`);
  return { id: data?.messages?.[0]?.id ?? null, payload: data };
}

export default {
  async fetch(req: Request) {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const cronSecret = Deno.env.get("CONTROL_ROOM_CRON_SECRET");
    if (!cronSecret || req.headers.get("x-control-room-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);

    const db = adminClient();
    await db.rpc("requeue_stale_messages", { stale_after: "10 minutes" });
    const { data: jobs, error } = await db.rpc("claim_due_messages", { batch_size: 25 });
    if (error) return json({ error: "claim_failed", detail: error.message }, 500);
    if (!jobs?.length) return json({ ok: true, processed: 0 });

    const results: any[] = [];
    for (const job of jobs as QueueRow[]) {
      try {
        const [{ data: contact }, { data: booking }, { data: lead }] = await Promise.all([
          job.contact_id ? db.from("contacts").select("*").eq("id", job.contact_id).maybeSingle() : Promise.resolve({ data: null }),
          job.booking_id ? db.from("bookings").select("*").eq("id", job.booking_id).maybeSingle() : Promise.resolve({ data: null }),
          job.lead_id ? db.from("leads").select("*").eq("id", job.lead_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        let key = job.template_key;
        const phone = contact?.phone_e164 || lead?.phone_e164;
        if (!phone) throw new Error("No WhatsApp-capable phone number on contact/lead.");

        if (key === "post_visit_feedback" && contact?.last_review_request_at) {
          const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
          if (new Date(contact.last_review_request_at).getTime() > cutoff) key = "post_visit_thanks";
        }

        const sent = await sendWhatsApp(phone, key, bodyParameters(key, contact, booking, lead));
        const now = new Date().toISOString();
        await db.from("message_queue").update({ status: "sent", sent_at: now, locked_at: null, last_error: null }).eq("id", job.id);
        await db.from("message_log").insert({ queue_id: job.id, contact_id: job.contact_id, booking_id: job.booking_id, channel: "whatsapp", direction: "outbound", template_key: key, provider_message_id: sent.id, status: "sent", sent_at: now, provider_payload: sent.payload });
        if (key === "post_visit_feedback" && contact?.id) await db.from("contacts").update({ last_review_request_at: now }).eq("id", contact.id);
        if (key === "lead_acknowledgement" && lead?.id && !lead.first_response_at) await db.from("leads").update({ first_response_at: now, status: "contacted" }).eq("id", lead.id);
        results.push({ id: job.id, status: "sent", provider_message_id: sent.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const finalFailure = Number(job.attempts ?? 0) >= Number(job.max_attempts ?? 5);
        await db.from("message_queue").update({ status: finalFailure ? "dead_letter" : "queued", locked_at: null, due_at: new Date(Date.now() + Math.min(60, 2 ** Number(job.attempts ?? 1)) * 60000).toISOString(), last_error: message.slice(0, 1000) }).eq("id", job.id);
        results.push({ id: job.id, status: finalFailure ? "dead_letter" : "retry", error: message });
      }
    }
    await db.from("system_health").upsert({ key: "message_dispatcher", status: results.some((r) => r.status === "dead_letter") ? "warning" : "ok", last_ok_at: new Date().toISOString(), last_event_at: new Date().toISOString(), details: { processed: results.length } });
    return json({ ok: true, processed: results.length, results });
  },
};
