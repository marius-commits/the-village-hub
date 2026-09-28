export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-village-lead-key, x-control-room-secret",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PATCH",
  "Content-Type": "application/json",
};

export function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extra },
  });
}
