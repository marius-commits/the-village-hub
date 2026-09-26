import { Webhook } from "npm:svix@2.5.0";
import { adminClient } from "../_shared/db.ts";
import { json } from "../_shared/cors.ts";
import { normalizePhone } from "../_shared/phone.ts";

type AnyRecord = Record<string, any>;
function eventName(payload: AnyRecord, req: Request) { return String(payload.type ?? payload.eventType ?? payload.event_type ?? req.headers.get("x-event-type") ?? "unknown"); }
function eventData(payload: AnyRecord) { return (payload.data ?? payload.event?.data ?? payload) as AnyRecord; }
function bookingId(data: AnyRecord) { return String(data.id ?? data.bookingId ?? data.booking_id ?? ""); }
function bookingUser(data: AnyRecord) { return data.userOwner ?? data.user_owner ?? data.user ?? {}; }
function customerRef(data: AnyRecord) { return data.membershipRefOwner ?? data.customerRef ?? data.customer_ref ?? null; }
function resourceRef(data: AnyRecord) { return data.resourceRef ?? data.resource_ref ?? data.resource?.id ?? null; }
function payment(data: AnyRecord) { return data.payment ?? {}; }

async function upsertContact(db: ReturnType<typeof adminClient>, data: AnyRecord) {
  const user = bookingUser(data);
  const userRef = user.id ?? data.userRefOwner ?? data.user_ref_owner ?? null;
  const phone = normalizePhone(user.phoneNumber ?? user.phone ?? data.phoneNumber ?? data.phone);
  const email = user.email ?? data.email ?? null;
  const values: AnyRecord = { spacebring_customer_ref: customerRef(data), spacebring_user_ref: userRef, first_name: user.name ?? user.firstName ?? data.firstName ?? null, last_name: user.surname ?? user.lastName ?? data.lastName ?? null, email, phone_e164: phone, company_name: data.company?.name ?? data.companyName ?? null, last_seen_at: new Date().toISOString() };
  if (userRef) {
    const { data: contact, error } = await db.from("contacts").upsert(values, { onConflict: "spacebring_user_ref" }).select("*").single();
    if (error) throw error; return contact;
  }
  if (phone) {
    const { data: existing } = await db.from("contacts").select("*").eq("phone_e164", phone).limit(1).maybeSingle();
    if (existing) { const { data: updated, error } = await db.from("contacts").update(values).eq("id", existing.id).select("*").single(); if (error) throw error; return updated; }
  }
  if (email) {
    const { data: existing } = await db.from("contacts").select("*").ilike("email", email).limit(1).maybeSingle();
    if (existing) { const { data: updated, error } = await db.from("contacts").update(values).eq("id", existing.id).select("*").single(); if (error) throw error; return updated; }
  }
  const { data: contact, error } = await db.from("contacts").insert(values).select("*").single(); if (error) throw error; return contact;
}
async function enqueue(db: ReturnType<typeof adminClient>, values: AnyRecord) { const { error } = await db.from("message_queue").upsert(values, { onConflict: "unique_key", ignoreDuplicates: true }); if (error) throw error; }

async function processBooking(db: ReturnType<typeof adminClient>, type: string, data: AnyRecord) {
  const externalId = bookingId(data); if (!externalId) return { ignored: "missing_booking_id" };
  if (type === "booking.deleted") {
    const { data: booking } = await db.from("bookings").update({ status: "canceled", raw_json: data }).eq("spacebring_booking_id", externalId).select("id").maybeSingle();
    if (booking?.id) await db.from("message_queue").update({ status: "canceled", last_error: "booking canceled" }).eq("booking_id", booking.id).in("status", ["queued", "processing"]);
    return { canceled: externalId };
  }
  const contact = await upsertContact(db, data); const pay = payment(data);
  const startAt = data.startDate ?? data.start_at ?? data.start; const endAt = data.endDate ?? data.end_at ?? data.end;
  if (!startAt || !endAt) return { ignored: "missing_booking_times" };
  const statusRaw = String(data.status ?? "confirmed").toLowerCase(); const status = ["tentative", "confirmed", "canceled"].includes(statusRaw) ? statusRaw : "confirmed";
  const bookingValues: AnyRecord = { spacebring_booking_id: externalId, spacebring_customer_ref: customerRef(data), spacebring_user_ref: bookingUser(data)?.id ?? data.userRefOwner ?? null, contact_id: contact.id, resource_id: resourceRef(data), resource_name: data.resourceName ?? data.resource?.name ?? null, resource_type: data.resourceType ?? data.resource_type ?? data.resource?.type ?? null, booking_title: data.title ?? null, start_at: startAt, end_at: endAt, status, source: data.source ?? data.createSource ?? null, payment_status: pay.status ?? null, payment_category: pay.type ?? pay.category ?? null, payment_amount: pay.amount ?? null, payment_currency: pay.currencyCode ?? pay.currency ?? null, raw_json: data };
  const { data: booking, error } = await db.from("bookings").upsert(bookingValues, { onConflict: "spacebring_booking_id" }).select("*").single(); if (error) throw error;
  if (status === "canceled") { await db.from("message_queue").update({ status: "canceled", last_error: "booking canceled" }).eq("booking_id", booking.id).in("status", ["queued", "processing"]); return { booking: externalId, status }; }
  if (type === "booking.created" && contact.phone_e164) {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: recentWelcome } = await db.from("message_queue").select("id").eq("contact_id", contact.id).eq("template_key", "booking_welcome").gte("created_at", twelveHoursAgo).limit(1).maybeSingle();
    if (!recentWelcome) await enqueue(db, { booking_id: booking.id, contact_id: contact.id, template_key: "booking_welcome", due_at: new Date().toISOString(), unique_key: `booking_welcome:${externalId}`, payload_json: { booking_ref: externalId } });
  }
  if (contact.phone_e164) {
    const due = new Date(new Date(endAt).getTime() + 60 * 60 * 1000).toISOString(); const postKey = `post_visit_feedback:${externalId}`;
    const { data: existing } = await db.from("message_queue").select("id,status").eq("unique_key", postKey).maybeSingle();
    if (!existing) await enqueue(db, { booking_id: booking.id, contact_id: contact.id, template_key: "post_visit_feedback", due_at: due, unique_key: postKey, payload_json: { booking_ref: externalId } });
    else if (existing.status === "queued") await db.from("message_queue").update({ due_at: due }).eq("id", existing.id);
  }
  return { booking: externalId, status, contact_id: contact.id };
}

export default { async fetch(req: Request) {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("SPACEBRING_WEBHOOK_SECRET"); if (!secret) return json({ error: "SPACEBRING_WEBHOOK_SECRET is not configured" }, 503);
  const raw = await req.text(); const headers = { "svix-id": req.headers.get("svix-id") ?? "", "svix-timestamp": req.headers.get("svix-timestamp") ?? "", "svix-signature": req.headers.get("svix-signature") ?? "" };
  let payload: AnyRecord; try { payload = new Webhook(secret).verify(raw, headers) as AnyRecord; } catch { return json({ error: "invalid_signature" }, 401); }
  const db = adminClient(); const providerEventId = headers["svix-id"] || crypto.randomUUID(); const type = eventName(payload, req); const data = eventData(payload); const entity = bookingId(data) || String(data.id ?? "");
  const { error: auditError } = await db.from("inbound_events").insert({ provider: "spacebring", provider_event_id: providerEventId, event_type: type, entity_ref: entity || null, payload_json: payload });
  if (auditError?.code === "23505") return json({ ok: true, duplicate: true }); if (auditError) return json({ error: "event_audit_failed" }, 500);
  try {
    let result: AnyRecord = { stored: true }; if (type.startsWith("booking.")) result = await processBooking(db, type, data);
    await db.from("inbound_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("provider", "spacebring").eq("provider_event_id", providerEventId);
    await db.from("system_health").upsert({ key: "spacebring_webhook", status: "ok", last_ok_at: new Date().toISOString(), last_event_at: new Date().toISOString(), details: { last_event_type: type } });
    return json({ ok: true, type, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("inbound_events").update({ processing_status: "failed", processed_at: new Date().toISOString(), error_text: message.slice(0, 1000) }).eq("provider", "spacebring").eq("provider_event_id", providerEventId);
    await db.from("system_health").upsert({ key: "spacebring_webhook", status: "error", last_event_at: new Date().toISOString(), details: { error: message, event_type: type } });
    return json({ error: "processing_failed", message }, 500);
  }
}};
