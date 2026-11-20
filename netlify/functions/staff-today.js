// GET /.netlify/functions/staff-today
// The phone home screen: open leads first, then the other queues.
// Pending account requests are included only for the owner.

const L = require('./_lib');
const D = require('./_digest');
const { latestByPost, reviewsFor } = require('./staff-marketing');
const M = require('./_marketing');

const LEAD_COLS = 'id,created_at,status,product,first_name,last_name,company,email,phone,owner,first_response_at,next_action,next_action_at,last_contacted_at,last_contact_channel';
const LEAD_COLS_BASE = 'id,created_at,status,product,first_name,last_name,company,email,phone,owner,first_response_at';

async function openLeads() {
  try {
    return await L.selectRows('leads', `status=in.(new,contacted,viewing_booked,quoted)&select=${LEAD_COLS}&order=created_at.asc&limit=100`);
  } catch (err) {
    if (!/column|schema cache/i.test(err.message)) throw err;
    return L.selectRows('leads', `status=in.(new,contacted,viewing_booked,quoted)&select=${LEAD_COLS_BASE}&order=created_at.asc&limit=100`);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  const staff = gate.staff;
  const now = new Date();

  try {
    const leads = await openLeads();
    const { start, end } = D.dayBoundsSAST(now);
    const decorated = (leads || []).map(l => {
      const ageMs = now.getTime() - new Date(l.created_at).getTime();
      const noResponse = !l.first_response_at;
      return {
        ...l,
        product_label: D.productLabel(l.product),
        name: D.leadName(l),
        age: D.ageLabel(l.created_at, now),
        no_response: noResponse,
        over_24h: noResponse && ageMs > 24 * 3600 * 1000,
        due_today: !!(l.next_action_at && new Date(l.next_action_at) >= start && new Date(l.next_action_at) < end),
      };
    }).sort((a, b) => {
      const rank = (x) => (x.over_24h ? 0 : x.no_response ? 1 : x.due_today ? 2 : 3);
      return rank(a) - rank(b) || new Date(a.created_at) - new Date(b.created_at);
    });

    let applications = null;
    try {
      applications = await L.sb('/rest/v1/rpc/dashboard_application_stats', { method: 'POST', body: '{}' });
    } catch (err) {
      console.error('application stats failed:', err.message);
    }

    let accessRequests = null;
    if (staff.role === 'owner') {
      try {
        accessRequests = await L.selectRows(
          'staff_access',
          'status=eq.pending&select=email,full_name,role,requested_at&order=requested_at.asc'
        );
      } catch (err) {
        accessRequests = [];
      }
    }

    let waPending = [];
    let backlogPending = [];
    try {
      waPending = await L.selectRows(
        'wa_message_queue',
        'status=in.(pending_approval,draft)&select=id,created_at,status,template_code,rendered_text,is_test,kind&order=created_at.asc&limit=30'
      );
    } catch (err) { console.error('wa queue failed:', err.message); }
    try {
      backlogPending = await L.selectRows(
        'wa_backlog_rows',
        'status=eq.pending&is_test=is.false&select=id,row_no,client_name,company,template_code,priority,trigger_name&order=row_no.asc&limit=30'
      );
    } catch (err) { console.error('backlog failed:', err.message); }

    let marketing = { week: null, edits: [] };
    try {
      const plan = await M.loadPublishedPlan();
      const reviews = await reviewsFor(plan.week);
      const latest = latestByPost(reviews);
      const edits = Object.values(latest)
        .filter(r => r.status === 'edits_requested')
        .map(r => {
          const post = (plan.posts || []).find(p => p.id === r.post_id);
          return { post_id: r.post_id, title: post ? post.title : r.post_id, note: r.note, reviewer: r.reviewer_email || r.reviewer, at: r.created_at };
        });
      marketing = { week: plan.week, range: plan.range, edits };
    } catch (err) {
      console.error('today marketing failed:', err.message);
      marketing = { week: null, edits: [], error: 'The weekly plan could not be loaded.' };
    }

    let bookings = null;
    try {
      const rows = await L.selectRows('dashboard_metrics', 'source=eq.spacebring&select=data,captured_at');
      if (rows && rows[0] && rows[0].data && Object.keys(rows[0].data).length) {
        bookings = { captured_at: rows[0].captured_at, data: rows[0].data };
      }
    } catch (err) { /* empty is the normal state */ }

    return L.ok({
      staff: { email: staff.email, role: staff.role, full_name: staff.full_name },
      leads: decorated,
      counts: {
        open: decorated.length,
        no_response: decorated.filter(l => l.no_response).length,
        over_24h: decorated.filter(l => l.over_24h).length,
        due_today: decorated.filter(l => l.due_today).length,
      },
      applications: applications ? {
        pending_review: applications.pending_review || 0,
        by_status: applications.by_status || {},
      } : null,
      access_requests: accessRequests,
      whatsapp: {
        pending_approval: (waPending || []).length,
        pending_backlog: (backlogPending || []).length,
        queue: (waPending || []).slice(0, 8),
        backlog: (backlogPending || []).slice(0, 8),
      },
      marketing,
      bookings,
    });
  } catch (err) {
    console.error('staff-today failed:', err.message);
    return L.bad('Could not load today', 500);
  }
};
