// GET  /.netlify/functions/staff-leads[?status=<s>|all]  -> leads list (open by default)
// POST /.netlify/functions/staff-leads  {id, status?, note?, lost_reason?, won_value_zar?}
//      -> updates public.leads; the leads_log trigger records status changes in
//         lead_events with the staff email, notes are added as 'note' events.
// Same auth as staff-applications: Supabase session JWT of an active staff_access row.

const L = require('./_lib');

const STATUSES = ['new', 'contacted', 'viewing_booked', 'quoted', 'won', 'lost'];
const COLS = 'id,created_at,updated_at,source,source_detail,landing_page,product,first_name,last_name,company,email,phone,preferred_date,message,utm_source,utm_medium,utm_campaign,utm_term,gclid,status,first_response_at,won_value_zar,lost_reason,notes';

exports.handler = async function (event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let staff;
  try { staff = await L.requireStaff(event); }
  catch (err) { console.error('staff check failed:', err.message); return L.bad('Could not verify your access', 500); }
  if (!staff) return L.bad('Not authorised', 401);

  try {
    if (event.httpMethod === 'GET') {
      const status = L.clean((event.queryStringParameters || {}).status, 30);
      let filter = 'status=in.(new,contacted,viewing_booked,quoted)';
      if (status === 'all') filter = 'id=not.is.null';
      else if (STATUSES.includes(status)) filter = `status=eq.${status}`;
      const leads = await L.selectRows('leads', `${filter}&select=${COLS}&order=created_at.desc&limit=300`);
      return L.ok({ leads: leads || [], staff: { email: staff.email, role: staff.role } });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return L.bad('Bad JSON'); }
    const id = L.clean(body.id, 60);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return L.bad('Missing lead id');

    const patch = {};
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return L.bad('Unknown status');
      patch.status = body.status;
    }
    if (body.lost_reason !== undefined) patch.lost_reason = L.clean(body.lost_reason, 300);
    if (body.won_value_zar !== undefined && body.won_value_zar !== null && body.won_value_zar !== '') {
      const v = Number(body.won_value_zar);
      if (!Number.isFinite(v) || v < 0) return L.bad('Won value must be a number');
      patch.won_value_zar = v;
    }
    const note = L.clean(body.note, 2000);

    let lead = null;
    if (Object.keys(patch).length) {
      const rows = await L.updateRows('leads', `id=eq.${id}`, patch);
      lead = rows && rows[0];
      if (!lead) return L.bad('Not found', 404);
      // Trigger logs as 'system' under the service role; attribute it to the staff member.
      if (patch.status) {
        await L.sb(`/rest/v1/lead_events?lead_id=eq.${id}&kind=eq.status_change&actor=eq.system&at=gte.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`, {
          method: 'PATCH', body: JSON.stringify({ actor: staff.email }),
        }).catch(e => console.error('actor patch failed:', e.message));
      }
    }
    if (note) {
      await L.insertRow('lead_events', { lead_id: id, kind: 'note', actor: staff.email, detail: note });
      if (!lead) {
        const rows = await L.selectRows('leads', `id=eq.${id}&select=notes`);
        if (!rows || !rows.length) return L.bad('Not found', 404);
      }
      const prev = (await L.selectRows('leads', `id=eq.${id}&select=notes`))[0].notes;
      const stamp = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', timeZone: 'Africa/Johannesburg' });
      const rows = await L.updateRows('leads', `id=eq.${id}`, { notes: `${stamp} ${staff.email.split('@')[0]}: ${note}${prev ? '\n' + prev : ''}`.slice(0, 8000) });
      lead = rows && rows[0];
    }
    if (!lead) return L.bad('Nothing to change');
    return L.ok({ lead });
  } catch (err) {
    console.error('staff-leads failed:', err.message);
    return L.bad('Could not update the lead', 500);
  }
};
