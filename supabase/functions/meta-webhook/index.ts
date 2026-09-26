import { adminClient } from "../_shared/db.ts";
import { json } from "../_shared/cors.ts";
import { normalizePhone } from "../_shared/phone.ts";

async function validMetaSignature(req: Request, raw: string) {
  const secret = Deno.env.get("META_APP_SECRET"); if (!secret) return false;
  const header = req.headers.get("x-hub-signature-256") || ""; if (!header.startsWith("sha256=")) return false;
  const hex = header.slice(7).toLowerCase(); const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
  return crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(raw));
}
function inboundText(message: any) { if (message?.type === "text") return message.text?.body ?? ""; if (message?.type === "button") return message.button?.text ?? message.button?.payload ?? ""; if (message?.type === "interactive") return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? `[${message.type}]`; return `[${message?.type ?? "message"}]`; }

export default { async fetch(req: Request) {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const token = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN"); const mode = url.searchParams.get("hub.mode"); const supplied = url.searchParams.get("hub.verify_token"); const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && supplied === token && challenge) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    return json({ error: "verification_failed" }, 403);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text(); if (!(await validMetaSignature(req, raw))) return json({ error: "invalid_signature" }, 401);
  const payload = JSON.parse(raw); const db = adminClient(); const results: any[] = [];
  for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
    const value = change.value ?? {};
    for (const status of value.statuses ?? []) {
      const wamid = status.id, state = status.status; const now = new Date(Number(status.timestamp || 0) * 1000 || Date.now()).toISOString();
      const patch: Record<string, any> = { status: ["sent", "delivered", "read", "failed"].includes(state) ? state : "sent", provider_payload: status };
      if (state === "delivered") patch.delivered_at = now; if (state === "read") patch.read_at = now;
      if (state === "failed") { patch.failed_at = now; patch.error_code = String(status.errors?.[0]?.code ?? ""); patch.error_text = status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? "WhatsApp delivery failed"; }
      await db.from("message_log").update(patch).eq("provider_message_id", wamid); results.push({ type: "status", id: wamid, status: state });
    }
    for (const message of value.messages ?? []) {
      const phone = normalizePhone(`+${String(message.from ?? "").replace(/\D/g, "")}`); let contact: any = null;
      if (phone) { const { data } = await db.from("contacts").select("*").eq("phone_e164", phone).limit(1).maybeSingle(); contact = data; }
      const text = inboundText(message).slice(0, 2000); const receivedAt = new Date(Number(message.timestamp || 0) * 1000 || Date.now()).toISOString();
      await db.from("message_log").upsert({ contact_id: contact?.id ?? null, channel: "whatsapp", direction: "inbound", provider_message_id: message.id, status: "received", body_preview: text, received_at: receivedAt, provider_payload: message }, { onConflict: "provider_message_id", ignoreDuplicates: true });
      if (contact?.id) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: recentReviewAsk } = await db.from("message_log").select("booking_id,created_at").eq("contact_id", contact.id).eq("direction", "outbound").eq("template_key", "post_visit_feedback").gte("created_at", sevenDaysAgo).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (recentReviewAsk) await db.from("feedback").insert({ booking_id: recentReviewAsk.booking_id, contact_id: contact.id, source: "whatsapp", message: text, needs_follow_up: true, follow_up_status: "open" });
      }
      results.push({ type: "inbound", id: message.id, contact_id: contact?.id ?? null });
    }
  }
  await db.from("system_health").upsert({ key: "meta_whatsapp_webhook", status: "ok", last_ok_at: new Date().toISOString(), last_event_at: new Date().toISOString(), details: { processed: results.length } });
  return json({ ok: true, processed: results.length });
}};
