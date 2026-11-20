// GET /.netlify/functions/staff-numbers
// Counts from the database only. Nothing here is estimated or filled in.

const L = require('./_lib');
const D = require('./_digest');

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(n * 10) / 10;
}

function tally(rows, key) {
  const out = {};
  for (const row of rows) {
    const k = row[key] || 'unknown';
    out[k] = (out[k] || 0) + 1;
  }
  return Object.keys(out).sort().map(k => ({ key: k, label: key === 'unknown' ? 'Unknown' : (D.productLabel(k) === k && key.length < 40 ? k : D.PRODUCT_LABELS[k] || k), count: out[k] }));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;

  try {
    const leads = await L.selectRows(
      'leads',
      'select=id,status,source,product,created_at,first_response_at&order=created_at.asc&limit=5000'
    ) || [];
    const now = Date.now();
    const open = leads.filter(l => D.OPEN.includes(l.status));
    const byStatus = {};
    for (const s of ['new', 'contacted', 'viewing_booked', 'quoted', 'won', 'lost']) byStatus[s] = 0;
    for (const l of leads) byStatus[l.status] = (byStatus[l.status] || 0) + 1;

    const minutes = leads.map(l => {
      if (!l.first_response_at) return null;
      const m = (new Date(l.first_response_at) - new Date(l.created_at)) / 60000;
      return Number.isFinite(m) && m >= 0 ? m : null;
    }).filter(m => m !== null);

    const unanswered = open.filter(l => !l.first_response_at && (now - new Date(l.created_at)) > 24 * 3600 * 1000).length;
    const won = byStatus.won || 0;
    const total = leads.length;

    let applications = null;
    try {
      applications = await L.sb('/rest/v1/rpc/dashboard_application_stats', { method: 'POST', body: '{}' });
    } catch (err) {
      console.error('application stats failed:', err.message);
    }

    const queue = await L.selectRows('wa_message_queue', 'select=status&limit=2000').catch(() => []);
    const queueCounts = {};
    for (const row of queue || []) queueCounts[row.status] = (queueCounts[row.status] || 0) + 1;

    const reviews = await L.selectRows(
      'marketing_caption_reviews',
      'select=week_id,post_id,status,created_at&order=created_at.asc&limit=2000'
    ).catch(() => []);
    const reviewCounts = { approved: 0, edits_requested: 0 };
    for (const row of reviews || []) {
      if (reviewCounts[row.status] !== undefined) reviewCounts[row.status] += 1;
    }
    const latest = {};
    for (const row of reviews || []) {
      const key = `${row.week_id}:${row.post_id}`;
      latest[key] = row;
    }
    const openEdits = Object.values(latest).filter(r => r.status === 'edits_requested').length;

    let bookings = null;
    try {
      const rows = await L.selectRows('dashboard_metrics', 'source=eq.spacebring&select=data,captured_at');
      if (rows && rows[0] && rows[0].data && Object.keys(rows[0].data).length) {
        bookings = { captured_at: rows[0].captured_at, summary: rows[0].data };
      }
    } catch (err) { /* no snapshot yet */ }

    const avg = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null;

    return L.ok({
      leads: {
        total,
        open: open.length,
        by_status: byStatus,
        by_source: tally(leads, 'source'),
        by_product: tally(leads, 'product').map(row => ({ ...row, label: D.productLabel(row.key) })),
        first_response: {
          responded: minutes.length,
          median_minutes: round1(median(minutes)),
          average_minutes: round1(avg),
        },
        unanswered_over_24h: unanswered,
        conversion: {
          won,
          total,
          rate: total ? round1(100 * won / total) : null,
        },
      },
      applications: applications ? {
        pending_review: applications.pending_review || 0,
        by_status: applications.by_status || {},
        last_7_days: applications.last_7_days || 0,
        last_30_days: applications.last_30_days || 0,
        activated: applications.activated || 0,
      } : null,
      whatsapp: { queue: queueCounts, rows: (queue || []).length },
      marketing: { ...reviewCounts, open_edit_requests: openEdits, rows: (reviews || []).length },
      bookings,
      links: {
        ads: '/ads-dashboard',
        search_console: 'https://search.google.com/search-console?resource_id=sc-domain:villagehub.co.za',
        business_profile: 'https://business.google.com/',
      },
    });
  } catch (err) {
    console.error('staff-numbers failed:', err.message);
    return L.bad('Could not load the numbers', 500);
  }
};
