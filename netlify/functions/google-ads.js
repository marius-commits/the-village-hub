// Netlify serverless function: google-ads
// Pulls live performance data for the Village Hub Google Ads account
// and returns clean JSON for the live dashboard (ads-dashboard.html).
//
// Reads credentials from environment variables (set in Netlify → Site settings
// → Environment variables). NOTHING secret is ever sent to the browser.
//
// Required env vars:
//   GADS_DEVELOPER_TOKEN     - Google Ads API developer token (from API Center)
//   GADS_CLIENT_ID           - OAuth2 client ID (Google Cloud Console)
//   GADS_CLIENT_SECRET       - OAuth2 client secret
//   GADS_REFRESH_TOKEN       - OAuth2 refresh token for the account
//   GADS_LOGIN_CUSTOMER_ID   - Manager (MCC) account ID, digits only
//   GADS_CUSTOMER_ID         - The ad account ID, digits only (e.g. 7631185996)
//   DASH_KEY                 - Shared secret the dashboard must send (access gate)
// Optional:
//   GADS_API_VERSION         - e.g. "v17" (default). Bump if Google deprecates.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const RANGE_MAP = {
  '7':  'LAST_7_DAYS',
  '14': 'LAST_14_DAYS',
  '30': 'LAST_30_DAYS',
  '90': 'LAST_90_DAYS',
  'month': 'THIS_MONTH',
};

function digits(s) { return (s || '').replace(/[^0-9]/g, ''); }

exports.handler = async function (event) {
  const qs = event.queryStringParameters || {};
  const debug = qs.debug === '1';
  const json = (code, obj) => ({
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(obj),
  });

  // --- Access gate -------------------------------------------------------
  const dashKey = process.env.DASH_KEY;
  const provided = qs.key || event.headers['x-dash-key'] || '';
  if (!dashKey) {
    return json(200, { configured: false, missing: ['DASH_KEY'],
      message: 'Dashboard access key not set yet.' });
  }
  if (provided !== dashKey) {
    return json(401, { error: 'unauthorized', message: 'Invalid or missing access key.' });
  }

  // --- Config check ------------------------------------------------------
  const required = ['GADS_DEVELOPER_TOKEN','GADS_CLIENT_ID','GADS_CLIENT_SECRET',
    'GADS_REFRESH_TOKEN','GADS_LOGIN_CUSTOMER_ID','GADS_CUSTOMER_ID'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    return json(200, { configured: false, missing,
      message: 'Google Ads API credentials not set yet. Complete the setup runbook.' });
  }

  const apiVersion = process.env.GADS_API_VERSION || 'v17';
  const customerId = digits(process.env.GADS_CUSTOMER_ID);
  const loginCustomerId = digits(process.env.GADS_LOGIN_CUSTOMER_ID);
  const range = RANGE_MAP[qs.range] || 'LAST_30_DAYS';

  try {
    // --- 1. Exchange refresh token for an access token -------------------
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GADS_CLIENT_ID,
        client_secret: process.env.GADS_CLIENT_SECRET,
        refresh_token: process.env.GADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return json(500, { error: 'token_exchange_failed',
        message: 'Could not get an access token. Check CLIENT_ID/SECRET/REFRESH_TOKEN.',
        detail: debug ? tokenData : undefined });
    }
    const accessToken = tokenData.access_token;

    const base = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:search`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': process.env.GADS_DEVELOPER_TOKEN,
      'login-customer-id': loginCustomerId,
      'Content-Type': 'application/json',
    };

    async function runQuery(query) {
      let rows = [];
      let pageToken = undefined;
      do {
        const res = await fetch(base, {
          method: 'POST',
          headers,
          body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
        });
        const data = await res.json();
        if (!res.ok) {
          const apiMsg = data && data.error && data.error.message;
          const err = new Error(apiMsg || 'Google Ads API error');
          err.detail = data;
          throw err;
        }
        if (Array.isArray(data.results)) rows = rows.concat(data.results);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return rows;
    }

    // --- 2. Summary (campaign-level totals for the period) --------------
    const summaryQuery = `
      SELECT campaign.id, campaign.name, campaign.status,
             campaign.advertising_channel_type,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.conversions_value, metrics.ctr,
             metrics.average_cpc, metrics.search_impression_share,
             metrics.search_budget_lost_impression_share,
             metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE segments.date DURING ${range} AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC`;

    // --- 3. Daily series (for trend charts) -----------------------------
    const dailyQuery = `
      SELECT campaign.id, campaign.name, segments.date,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING ${range} AND campaign.status != 'REMOVED'
      ORDER BY segments.date`;

    const [summaryRows, dailyRows] = await Promise.all([
      runQuery(summaryQuery),
      runQuery(dailyQuery),
    ]);

    const ZAR = (micros) => Number(micros || 0) / 1e6;

    const summary = summaryRows.map(r => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      channel: r.campaign.advertisingChannelType,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      cost: ZAR(r.metrics.costMicros),
      conversions: Number(r.metrics.conversions || 0),
      convValue: Number(r.metrics.conversionsValue || 0),
      ctr: Number(r.metrics.ctr || 0),            // fraction (0-1)
      avgCpc: ZAR(r.metrics.averageCpc),
      imprShare: r.metrics.searchImpressionShare != null ? Number(r.metrics.searchImpressionShare) : null,
      lostBudget: r.metrics.searchBudgetLostImpressionShare != null ? Number(r.metrics.searchBudgetLostImpressionShare) : null,
      lostRank: r.metrics.searchRankLostImpressionShare != null ? Number(r.metrics.searchRankLostImpressionShare) : null,
    }));

    const daily = dailyRows.map(r => ({
      id: r.campaign.id,
      name: r.campaign.name,
      date: r.segments.date,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      cost: ZAR(r.metrics.costMicros),
      conversions: Number(r.metrics.conversions || 0),
      convValue: Number(r.metrics.conversionsValue || 0),
    }));

    return json(200, {
      configured: true,
      range,
      rangeLabel: range.replace(/_/g, ' ').toLowerCase(),
      currency: 'ZAR',
      fetchedAt: new Date().toISOString(),
      summary,
      daily,
    });
  } catch (e) {
    return json(500, { error: 'query_failed',
      message: e.message || 'Unexpected error',
      detail: debug ? (e.detail || String(e)) : undefined });
  }
};
