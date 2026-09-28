import { adminClient } from "../_shared/db.ts";
import { json } from "../_shared/cors.ts";
function digits(v?: string | null) { return (v || "").replace(/\D/g, ""); }

export default { async fetch(req: Request) {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const cronSecret = Deno.env.get("CONTROL_ROOM_CRON_SECRET"); if (!cronSecret || req.headers.get("x-control-room-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);
  const clientId = Deno.env.get("GADS_CLIENT_ID"), clientSecret = Deno.env.get("GADS_CLIENT_SECRET"), refreshToken = Deno.env.get("GADS_REFRESH_TOKEN"), customerId = digits(Deno.env.get("GADS_CUSTOMER_ID")), loginCustomerId = digits(Deno.env.get("GADS_LOGIN_CUSTOMER_ID")), apiVersion = Deno.env.get("GADS_API_VERSION") || "v25";
  if (!clientId || !clientSecret || !refreshToken || !customerId) return json({ configured: false, error: "Google Ads OAuth credentials are incomplete" }, 503);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const tokenData = await tokenRes.json(); if (!tokenRes.ok || !tokenData.access_token) return json({ error: "google_oauth_failed", detail: tokenData?.error_description ?? tokenData?.error }, 500);
  const end = new Date(), start = new Date(Date.now() - 100 * 86400000), ymd = (d: Date) => d.toISOString().slice(0, 10);
  const query = `SELECT campaign.id, campaign.name, segments.date, customer.currency_code, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${ymd(start)}' AND '${ymd(end)}' AND campaign.status != 'REMOVED' ORDER BY segments.date`;
  const headers: Record<string,string> = { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" }; const legacyDeveloperToken = Deno.env.get("GADS_DEVELOPER_TOKEN"); if (legacyDeveloperToken) headers["developer-token"] = legacyDeveloperToken; if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  const endpoint = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`; const adsRes = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ query }) }); const chunks = await adsRes.json(); if (!adsRes.ok) return json({ error: "google_ads_query_failed", detail: chunks?.error?.message ?? chunks }, 500);
  const rows: any[] = Array.isArray(chunks) ? chunks.flatMap((chunk) => chunk.results ?? []) : (chunks.results ?? []);
  const mapped = rows.map((r) => ({ platform: "google_ads", account_id: customerId, campaign_id: String(r.campaign?.id ?? ""), campaign_name: r.campaign?.name ?? "", metric_date: r.segments?.date, impressions: Number(r.metrics?.impressions ?? 0), clicks: Number(r.metrics?.clicks ?? 0), cost: Number(r.metrics?.costMicros ?? 0) / 1000000, conversions: Number(r.metrics?.conversions ?? 0), conversion_value: Number(r.metrics?.conversionsValue ?? 0), currency_code: r.customer?.currencyCode ?? null, fetched_at: new Date().toISOString() })).filter((r) => r.campaign_id && r.metric_date);
  const db = adminClient(); if (mapped.length) { const { error } = await db.from("ad_campaign_daily").upsert(mapped, { onConflict: "platform,account_id,campaign_id,metric_date" }); if (error) return json({ error: "snapshot_write_failed", detail: error.message }, 500); }
  await db.from("system_health").upsert({ key: "google_ads_sync", status: "ok", last_ok_at: new Date().toISOString(), last_event_at: new Date().toISOString(), details: { rows: mapped.length, account_id: customerId, api_version: apiVersion } });
  return json({ ok: true, rows: mapped.length, account_id: customerId, api_version: apiVersion });
}};
