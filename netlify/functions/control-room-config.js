// Public runtime config for the authenticated Control Room.
// SUPABASE_URL and the publishable key are intentionally safe for browser use.
// All authorization still happens through Supabase Auth + the Control Room API allow-list.

exports.handler = async function () {
  const url = process.env.SUPABASE_URL || "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ enabled: Boolean(url && publishableKey), supabaseUrl: url, publishableKey, apiFunction: "control-room-api" }),
  };
};
