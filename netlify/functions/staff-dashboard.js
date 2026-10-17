// GET /.netlify/functions/staff-dashboard
// Returns the applications funnel (live from our DB) plus any cached
// Spacebring snapshot. Staff only.

const L = require('./_lib');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let staff;
  try { staff = await L.requireStaff(event); }
  catch (err) { console.error('staff check failed:', err.message); return L.bad('Could not verify your access', 500); }
  if (!staff) return L.bad('Not authorised', 401);

  try {
    // Whole applications funnel in one call.
    const applications = await L.sb('/rest/v1/rpc/dashboard_application_stats', { method: 'POST', body: '{}' });

    // Optional Spacebring snapshot, written by a scheduled refresh.
    let spacebring = null;
    try {
      const rows = await L.selectRows('dashboard_metrics', 'source=eq.spacebring&select=*');
      if (rows && rows[0]) spacebring = { ...rows[0].data, captured_at: rows[0].captured_at };
    } catch (e) { /* table may be empty */ }

    return L.ok({ applications, spacebring, staff: { email: staff.email, role: staff.role } });
  } catch (err) {
    console.error('staff-dashboard failed:', err.message);
    return L.bad('Could not load the dashboard', 500);
  }
};
