// POST /.netlify/functions/application-action
// { application_id, action, message?, spacebring_customer_ref?, spacebring_subscription_ref? }
//
// actions: take        -> under_review
//          request_info-> info_requested  (emails the applicant)
//          approve     -> approved        (emails the applicant)
//          decline     -> declined        (emails the applicant)
//          activate    -> activated       (records the Spacebring links)
//          note        -> internal note only, no status change, no email
//
// Staff only. Every action writes to the audit trail; the status-change
// trigger in the database writes a second record independently, so an
// action cannot be performed without leaving a mark.

const L = require('./_lib');
const T = require('./_emails');

const ACTIONS = {
  take:         { status: 'under_review',  email: null },
  request_info: { status: 'info_requested', email: T.infoRequested, needsMessage: true },
  approve:      { status: 'approved',      email: T.approved },
  decline:      { status: 'declined',      email: T.declined, needsMessage: true },
  activate:     { status: 'activated',     email: null },
  note:         { status: null,            email: null },
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let staff;
  try { staff = await L.requireStaff(event); }
  catch (err) {
    console.error('staff check failed:', err.message);
    return L.bad('Could not verify your access', 500);
  }
  if (!staff) return L.bad('Not authorised', 401);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  const id     = L.clean(payload.application_id, 60);
  const action = L.clean(payload.action, 30);
  const message = L.clean(payload.message, 2000);

  if (!id) return L.bad('Missing application');
  const spec = ACTIONS[action];
  if (!spec) return L.bad('Unknown action');
  if (spec.needsMessage && !message) {
    return L.bad(action === 'decline'
      ? 'Give the applicant a reason. A decline with no reason is worse than no reply.'
      : 'Say what you need from the applicant.');
  }

  try {
    const rows = await L.selectRows('applications', `id=eq.${id}&select=*`);
    if (!rows || !rows.length) return L.bad('Not found', 404);
    const before = rows[0];

    const patch = {
      reviewed_by: staff.user_id,
      reviewed_at: new Date().toISOString(),
    };
    if (spec.status) patch.status = spec.status;
    if (message && action !== 'note') patch.decision_reason = message;

    if (action === 'note') {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      patch.internal_notes = `${before.internal_notes ? before.internal_notes + '\n' : ''}[${stamp} ${staff.email}] ${message}`;
    }

    if (action === 'activate') {
      patch.spacebring_customer_ref     = L.clean(payload.spacebring_customer_ref, 80);
      patch.spacebring_subscription_ref = L.clean(payload.spacebring_subscription_ref, 80);
    }

    // Declined applications do not need a five-year FICA retention. Bring
    // their deletion date forward so the documents do not sit around.
    if (action === 'decline') {
      patch.retention_review_date = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    }

    const updated = await L.updateRows('applications', `id=eq.${id}`, patch);
    const app = Array.isArray(updated) ? updated[0] : updated;

    let emailed = false;
    if (spec.email) {
      const mail = spec.email(app, message);
      const result = await L.sendEmail({
        to: app.email,
        subject: mail.subject,
        html: mail.html,
        replyTo: L.NOTIFY_EMAIL,
      });
      emailed = !result.error && !result.skipped;
      if (!emailed) {
        // Say so rather than letting staff believe the applicant was told.
        await L.logEvent(app.id, 'email_failed', staff.email, { action, detail: result.error || 'not configured' });
      }
    }

    await L.logEvent(app.id, `action:${action}`, staff.email, { message: message || null, emailed });

    return L.ok({ application: app, emailed });
  } catch (err) {
    console.error('application-action failed:', err.message);
    return L.bad('Could not complete that action', 500);
  }
};
