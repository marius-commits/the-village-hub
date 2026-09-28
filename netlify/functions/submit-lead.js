// Village Hub lead intake proxy.
// Keeps backend secrets server-side and forwards website enquiries to Supabase Edge Functions.
// Replaces the legacy Zoho Web-to-Lead handoff.

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}
function pick(obj, ...keys) {
  for (const key of keys) { const value = obj[key]; if (value != null && String(value).trim() !== "") return String(value).trim(); }
  return "";
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  const supabaseUrl = process.env.SUPABASE_URL;
  const leadSecret = process.env.LEAD_INGEST_SECRET;
  if (!supabaseUrl || !leadSecret) return json(503, { error: "lead_intake_not_configured" });

  try {
    const contentType = (event.headers["content-type"] || "").toLowerCase();
    let input = {};
    if (contentType.includes("application/json")) input = JSON.parse(event.body || "{}");
    else input = Object.fromEntries(new URLSearchParams(event.body || "").entries());
    const qs = event.queryStringParameters || {};
    const payload = {
      source: pick(input, "lead_source", "source") || "website",
      external_lead_id: pick(input, "external_lead_id"),
      first_name: pick(input, "first_name", "firstName"),
      last_name: pick(input, "last_name", "lastName"),
      email: pick(input, "email"),
      phone: pick(input, "phone", "mobile"),
      company: pick(input, "company", "company_name"),
      interest: pick(input, "plan_interest", "interest"),
      preferred_date: pick(input, "preferred_date"),
      message: pick(input, "description", "message"),
      website: pick(input, "website"),
      gclid: pick(input, "gclid") || pick(qs, "gclid"),
      utm_source: pick(input, "utm_source") || pick(qs, "utm_source"),
      utm_medium: pick(input, "utm_medium") || pick(qs, "utm_medium"),
      utm_campaign: pick(input, "utm_campaign") || pick(qs, "utm_campaign"),
      utm_term: pick(input, "utm_term") || pick(qs, "utm_term"),
      utm_content: pick(input, "utm_content") || pick(qs, "utm_content"),
      campaign_id: pick(input, "campaign_id"), campaign_name: pick(input, "campaign_name"),
      ad_group_id: pick(input, "ad_group_id"), ad_id: pick(input, "ad_id"), form_id: pick(input, "form_id"),
      metadata: { page: event.headers.referer || event.headers.referrer || "", user_agent: event.headers["user-agent"] || "", submitted_at: new Date().toISOString() },
    };

    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/lead-intake`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-village-lead-key": leadSecret }, body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { console.error("lead-intake failed", response.status, data); return json(response.status >= 500 ? 502 : response.status, { success: false, error: data.error || "lead_intake_failed" }); }
    return json(200, { success: true, lead_id: data.lead_id });
  } catch (error) {
    console.error("submit-lead error", error);
    return json(500, { success: false, error: "unexpected_error" });
  }
};
