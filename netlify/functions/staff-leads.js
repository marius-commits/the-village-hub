// GET  /.netlify/functions/staff-leads[?status=<s>|all]  -> leads list (open by default)
// POST /.netlify/functions/staff-leads
//   { id, status?, note?, lost_reason?, won_value_zar?,
//     owner?, contact?: call|whatsapp|email, next_action?, next_action_at? }
//
// Called / WhatsApped / Emailed set last_contacted_at and the channel, log a
// lead_events row, and count as the first response when none is recorded yet.
// A lead that is still "new" moves to "contacted" when a contact is logged.
// Status changes stay one tap, as before.

const L = require('./_lib');

const STATUSES = ['new', 'contacted', 'viewing_booked', 'quoted', 'won', 'lost'];
const CHANNELS = ['call', 'whatsapp', 'email'];
const OPEN = ['new', 'contacted', 'viewing_booked', 'quoted'];
const COLS = [
  'id', 'created_at', 'updated_at', 'source', 'source_detail', 'landing_page', 'product',
  'first_name', 'last_name', 'company', 'email', 'phone', 'preferred_date', 'message',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid', 'status', 'owner',
  'first_response_at', 'won_value_zar', 'lost_reason', 'notes', 'won_at',
  'last_contacted_at', 'last_contact_channel', 'next_action', 'next_action_at',
].join(',');

function sortLeads(rows) {
  const rank = (l) => {
    const open = OPEN.includes(l.status);
    const silent = open && !l.first_response_at;
    const age = Date.now() - new Date(l.created_at).getTime();
    const old = silent && age > 24 * 3600 * 1000;
    if (old) return 0;
    if (silent) return 1;
    if (open) return 2;
    return 3;
  };
  return rows.slice().sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}

exports.handler = async function (event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  const staff = gate.staff;

  try {
    if (event.httpMethod === 'GET') {
      const status = L.clean((event.queryStringParameters || {}).status, 30);
      let filter = 'status=in.(new,contacted,viewing_booked,quoted)';
      if (status === 'all') filter = 'id=not.is.null';
      else if (STATUSES.includes(status)) filter = `status=eq.${status}`;
      const baseCols = COLS.split(',').filter(c => !/last_contacted_at|last_contact_channel|next_action/.test(c)).join(',');
      let leads;
      let migration = true;
      try {
        leads = await L.selectRows('leads', `${filter}&select=${COLS}&order=created_at.asc&limit=300`);
      } catch (err) {
        if (!/last_contacted_at|next_action|column|schema cache/i.test(err.message)) throw err;
        migration = false;
        leads = await L.selectRows('leads', `${filter}&select=${baseCols}&order=created_at.asc&limit=300`);
      }
      const team = await L.selectRows(
        'staff_access',
        'status=eq.approved&active=is.true&select=email,full_name,role&order=full_name.asc'
      ).catch(() => []);
      return L.ok({
        leads: sortLeads(leads || []),
        team: team || [],
        migration,
        staff: { email: staff.email, role: staff.role, full_name: staff.full_name },
      });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return L.bad('Bad JSON'); }
    const id = L.clean(body.id, 60);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return L.bad('Missing lead id');

    const existingRows = await L.selectRows('leads', `id=eq.${id}&select=${COLS}`);
    const existing = existingRows && existingRows[0];
    if (!existing) return L.bad('Not found', 404);

    const patch = {};
    let statusChanged = false;

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return L.bad('Unknown status');
      patch.status = body.status;
      statusChanged = body.status !== existing.status;
    }
    if (body.lost_reason !== undefined) patch.lost_reason = L.clean(body.lost_reason, 300);
    if (body.won_value_zar !== undefined && body.won_value_zar !== null && body.won_value_zar !== '') {
      const v = Number(body.won_value_zar);
      if (!Number.isFinite(v) || v < 0) return L.bad('Won value must be a number');
      patch.won_value_zar = v;
    }
    if (body.owner !== undefined) {
      const owner = L.clean(body.owner, 180);
      patch.owner = owner;
    }
    if (body.next_action !== undefined) patch.next_action = L.clean(body.next_action, 300);
    if (body.next_action_at !== undefined) {
      if (body.next_action_at === null || body.next_action_at === '') patch.next_action_at = null;
      else {
        const when = new Date(body.next_action_at);
        if (Number.isNaN(when.getTime())) return L.bad('Next action date is not valid');
        patch.next_action_at = when.toISOString();
      }
    }

    const contact = body.contact ? String(body.contact) : null;
    if (contact) {
      if (!CHANNELS.includes(contact)) return L.bad('Unknown contact channel');
      const now = new Date().toISOString();
      patch.last_contacted_at = now;
      patch.last_contact_channel = contact;
      if (!existing.first_response_at && !patch.first_response_at) patch.first_response_at = now;
      if ((patch.status || existing.status) === 'new') {
        patch.status = 'contacted';
        statusChanged = existing.status !== 'contacted';
      }
    }

    const note = L.clean(body.note, 2000);
    if (!Object.keys(patch).length && !note) return L.bad('Nothing to change');

    let lead = existing;
    if (Object.keys(patch).length) {
      let rows;
      try {
        rows = await L.updateRows('leads', `id=eq.${id}`, patch);
      } catch (err) {
        if (/last_contacted_at|next_action|column|schema cache/i.test(err.message)) {
          return L.bad('The leads migration has not been applied yet.', 503, 'migration');
        }
        throw err;
      }
      lead = rows && rows[0];
      if (!lead) return L.bad('Not found', 404);
      if (statusChanged || (patch.status && patch.status !== existing.status)) {
        await L.sb(`/rest/v1/lead_events?lead_id=eq.${id}&kind=eq.status_change&actor=eq.system&at=gte.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`, {
          method: 'PATCH', body: JSON.stringify({ actor: staff.email }),
        }).catch(e => console.error('actor patch failed:', e.message));
      }
    }

    if (contact) {
      const label = { call: 'Called', whatsapp: 'WhatsApped', email: 'Emailed' }[contact];
      await L.insertRow('lead_events', {
        lead_id: id,
        kind: 'contact',
        actor: staff.email,
        detail: `${label} (${contact})`,
      });
    }

    if (body.owner !== undefined && patch.owner !== existing.owner) {
      await L.insertRow('lead_events', {
        lead_id: id,
        kind: 'owner',
        actor: staff.email,
        detail: patch.owner ? `Owner set to ${patch.owner}` : 'Owner cleared',
      });
    }

    if (body.next_action !== undefined || body.next_action_at !== undefined) {
      const bits = [];
      if (patch.next_action) bits.push(patch.next_action);
      if (patch.next_action_at) bits.push(new Date(patch.next_action_at).toISOString());
      if (!patch.next_action && !patch.next_action_at && (body.next_action !== undefined || body.next_action_at !== undefined)) {
        bits.push('cleared');
      }
      if (bits.length) {
        await L.insertRow('lead_events', {
          lead_id: id,
          kind: 'next_action',
          actor: staff.email,
          detail: bits.join(' · '),
        });
      }
    }

    if (note) {
      await L.insertRow('lead_events', { lead_id: id, kind: 'note', actor: staff.email, detail: note });
      const prev = (await L.selectRows('leads', `id=eq.${id}&select=notes`))[0].notes;
      const stamp = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', timeZone: 'Africa/Johannesburg' });
      const rows = await L.updateRows('leads', `id=eq.${id}`, {
        notes: `${stamp} ${staff.email.split('@')[0]}: ${note}${prev ? '\n' + prev : ''}`.slice(0, 8000),
      });
      lead = rows && rows[0];
    }

    return L.ok({ lead });
  } catch (err) {
    console.error('staff-leads failed:', err.message);
    return L.bad('Could not update the lead', 500);
  }
};
