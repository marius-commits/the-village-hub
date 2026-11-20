// GET  /.netlify/functions/staff-access          owner only: the approval queue
// POST /.netlify/functions/staff-access
//   { email, action: 'approve'|'revoke', role?: 'admin'|'reviewer' }
// Approving emails the person from hello@villagehub.co.za.
// Marius cannot be revoked from this screen.

const L = require('./_lib');
const T = require('./_emails');

const ROLES = ['admin', 'reviewer'];

exports.handler = async function (event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  if (gate.staff.role !== 'owner') return L.bad('Only Marius can manage access.', 403, 'owner');

  try {
    if (event.httpMethod === 'GET') {
      const rows = await L.selectRows(
        'staff_access',
        'select=email,full_name,role,active,status,requested_at,approved_by,approved_at,created_at&order=requested_at.desc.nullslast'
      );
      return L.ok({ people: rows || [], owner: gate.staff.email });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return L.bad('Bad JSON'); }
    const email = (L.clean(body.email, 180) || '').toLowerCase();
    const action = L.clean(body.action, 20);
    if (!L.validEmail(email)) return L.bad('That email does not look right.');
    if (!['approve', 'revoke'].includes(action)) return L.bad('Unknown action');
    if (email === L.OWNER_EMAIL && action === 'revoke') {
      return L.bad('The owner account stays approved.');
    }

    const existing = await L.staffByEmail(email);
    if (!existing) return L.bad('That person is not on the list.', 404);

    const now = new Date().toISOString();
    let patch;
    if (action === 'approve') {
      const role = ROLES.includes(body.role) ? body.role : (existing.role === 'owner' ? 'owner' : 'admin');
      if (email === L.OWNER_EMAIL) {
        patch = { status: 'approved', active: true, role: 'owner', approved_by: gate.staff.email, approved_at: now };
      } else {
        patch = { status: 'approved', active: true, role, approved_by: gate.staff.email, approved_at: now };
      }
    } else {
      patch = { status: 'revoked', active: false };
    }

    const rows = await L.updateRows('staff_access', `email=eq.${encodeURIComponent(email)}`, patch);
    const person = rows && rows[0];
    if (!person) return L.bad('Not found', 404);

    // The database trigger mirrors this into wa_approvers once the migration
    // is applied. Do it here as well so a function deploy is enough if the
    // trigger is already in place, and so a missing trigger still updates the
    // list the WhatsApp functions read.
    try {
      if (action === 'approve') {
        await L.sb('/rest/v1/wa_approvers?on_conflict=email', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            email,
            name: person.full_name || email.split('@')[0],
            active: true,
          }),
        });
      } else {
        await L.updateRows('wa_approvers', `email=eq.${encodeURIComponent(email)}`, { active: false });
      }
    } catch (err) {
      console.error('wa_approvers sync failed:', err.message);
    }

    if (action === 'approve') {
      const mail = T.accessApproved();
      await L.sendEmail({ to: email, subject: mail.subject, html: mail.html });
    }

    return L.ok({ person });
  } catch (err) {
    console.error('staff-access failed:', err.message);
    if (/status|column|schema cache/i.test(err.message)) {
      return L.bad('The access migration has not been applied yet.', 503, 'migration');
    }
    return L.bad('Could not update access', 500);
  }
};
