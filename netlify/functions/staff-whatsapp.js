// WhatsApp inside the command centre.
//
// Queue approve / edit / skip writes the same columns as the wa-approvals
// edge function. It does not send. Sending stays in wa-sender, which is
// still hard-disabled.
//
// Backlog decisions call the existing wa_backlog_decide RPC with the staff
// member's own token, so there is one implementation.
//
// Inbox is proxied to wa-inbox-reply. That function is what actually sends
// a message, and only after a person presses Send.

const L = require('./_lib');

const QUEUE_COLS = [
  'id', 'created_at', 'trigger_id', 'lead_id', 'entity_ref', 'channel', 'kind',
  'template_name', 'template_code', 'template_lang', 'variables', 'rendered_text',
  'parent_queue_id', 'status', 'is_test', 'send_after', 'approved_by', 'approved_at',
  'approval_via', 'skip_reason', 'edited_at', 'original_rendered_text', 'blocked_reason',
  'contact_id',
].join(',');

function tokenOf(event) {
  const token = L.bearerToken(event);
  if (!token) return null;
  return token;
}

async function userRpc(token, name, args) {
  const res = await fetch(`${L.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: L.PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const message = (data && (data.message || data.error || data.hint)) || 'Request failed';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function inbox(token, path, method, body) {
  const res = await fetch(`${L.SUPABASE_URL}/functions/v1/wa-inbox-reply${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      apikey: L.PUBLISHABLE_KEY,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || 'The inbox could not be reached');
    err.status = res.status || 502;
    err.code = /approver list/i.test(err.message) ? 'wa_auth' : 'wa';
    throw err;
  }
  return data;
}

async function loadQueue() {
  const queue = await L.selectRows('wa_message_queue', `select=${QUEUE_COLS}&order=created_at.desc&limit=200`);
  const ids = [...new Set((queue || []).map(r => r.contact_id).filter(Boolean))];
  const contacts = {};
  if (ids.length) {
    const rows = await L.selectRows(
      'wa_contacts',
      `id=in.(${ids.join(',')})&select=id,first_name,phone_e164,email,kind`
    );
    for (const c of rows || []) contacts[c.id] = c;
  }
  const rows = (queue || []).map(r => ({ ...r, contact: r.contact_id ? contacts[r.contact_id] || null : null }));
  return {
    counts: {
      pending_approval: rows.filter(r => r.status === 'pending_approval' || r.status === 'draft').length,
      approved: rows.filter(r => r.status === 'approved').length,
      skipped: rows.filter(r => r.status === 'skipped').length,
    },
    queue: rows,
  };
}

async function actOnQueue(staff, body) {
  const action = String(body.action || '').toLowerCase();
  const id = L.clean(body.id, 60);
  if (!id || !['approve', 'edit', 'skip'].includes(action)) return L.bad('Action must be approve, edit or skip');

  const rows = await L.selectRows('wa_message_queue', `id=eq.${id}&select=*`);
  const row = rows && rows[0];
  if (!row) return L.bad('Queue row not found', 404);
  if (!['pending_approval', 'draft'].includes(row.status)) {
    return L.bad(`That row is ${row.status} and cannot be changed here`, 409);
  }

  const now = new Date().toISOString();
  const patch = { approved_by: staff.email, approved_at: now, approval_via: 'command-centre' };
  if (action === 'skip') {
    patch.status = 'skipped';
    patch.skip_reason = L.clean(body.reason, 500) || 'skipped in the command centre';
  } else if (action === 'edit') {
    const text = L.clean(body.rendered_text, 4000);
    if (!text) return L.bad('Edited text is required');
    if (!row.original_rendered_text) patch.original_rendered_text = row.rendered_text;
    patch.rendered_text = text;
    patch.edited_at = now;
    patch.status = 'approved';
  } else {
    patch.status = 'approved';
  }

  const updated = await L.updateRows(
    'wa_message_queue',
    `id=eq.${id}`,
    patch
  );
  return L.ok({
    ok: true,
    sent: false,
    action,
    approver: staff.email,
    at: now,
    row: updated && updated[0],
  });
}

exports.handler = async function (event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  const staff = gate.staff;
  const token = tokenOf(event);

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch { return L.bad('Bad JSON'); }
  }
  const section = L.clean(body.section || q.section, 20) || 'queue';

  try {
    if (section === 'queue' && event.httpMethod === 'GET') {
      const payload = await loadQueue();
      return L.ok({ ...payload, staff: { email: staff.email } });
    }
    if (section === 'queue' && event.httpMethod === 'POST') return actOnQueue(staff, body);

    if (section === 'backlog' && event.httpMethod === 'GET') {
      const data = await userRpc(token, 'wa_backlog_list', { p_batch: q.batch || null });
      return L.ok(data || { rows: [], templates: [] });
    }
    if (section === 'backlog' && event.httpMethod === 'POST') {
      const id = L.clean(body.id, 60);
      const action = L.clean(body.action, 20);
      if (!id || !['approve', 'decline', 'change', 'reset'].includes(action)) return L.bad('Unknown backlog action');
      const data = await userRpc(token, 'wa_backlog_decide', {
        p_id: id,
        p_action: action,
        p_note: L.clean(body.note, 2000),
      });
      return L.ok(data);
    }

    if (section === 'inbox' && event.httpMethod === 'GET') {
      const data = await inbox(token, '/threads', 'GET');
      return L.ok(data);
    }
    if (section === 'thread' && event.httpMethod === 'GET') {
      if (!q.id) return L.bad('Missing conversation');
      const data = await inbox(token, '/thread?id=' + encodeURIComponent(q.id), 'GET');
      return L.ok(data);
    }
    if (section === 'read' && event.httpMethod === 'POST') {
      return L.ok(await inbox(token, '/read', 'POST', { id: body.id }));
    }
    if (section === 'send' && event.httpMethod === 'POST') {
      if (body.human_confirmed !== true) return L.bad('Send must be pressed by a person');
      const data = await inbox(token, '/send', 'POST', body);
      return L.ok(data);
    }

    return L.bad('Unknown section');
  } catch (err) {
    console.error('staff-whatsapp failed:', err.message);
    if (/not on the approver|42501/i.test(err.message)) {
      return L.bad('WhatsApp still checks the old approver list. Apply the command centre migration so approved staff are recognised.', 403, 'wa_auth');
    }
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
    return L.bad(err.message || 'WhatsApp request failed', status, err.code || 'wa');
  }
};
