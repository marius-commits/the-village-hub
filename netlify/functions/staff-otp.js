// POST /.netlify/functions/staff-otp   { email }
//
// Step one of staff sign-in.
//
// Approved staff get a code and then the command centre.
// A new email is recorded as pending, Marius is emailed once, and the person
// still receives a code so they can sign in and see the waiting screen.
// Revoked or inactive addresses (including don@villagehub.co.za) are refused.

const L = require('./_lib');
const T = require('./_emails');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  const email = (L.clean(payload.email, 180) || '').toLowerCase();
  if (!L.validEmail(email)) return L.bad('That email does not look right.');

  let row;
  try {
    row = await L.staffByEmail(email);
  } catch (err) {
    console.error('staff lookup failed:', err.message);
    return L.bad('Could not check that address. Try again in a moment.', 500);
  }

  const status = L.accessStatus(row);

  if (status === 'revoked' || (row && row.active === false && status !== 'pending')) {
    return L.bad('This address does not have access. Ask Marius if that is unexpected.', 403, 'revoked');
  }

  let access = status === 'approved' ? 'approved' : 'pending';

  if (!row) {
    let created = false;
    try {
      await L.insertRow('staff_access', {
        email,
        full_name: null,
        role: 'reviewer',
        active: false,
        status: 'pending',
        requested_at: new Date().toISOString(),
      });
      created = true;
    } catch (err) {
      console.error('pending insert failed:', err.message);
      if (/status|column|schema cache/i.test(err.message)) {
        return L.bad('New sign-ups are not switched on yet. Ask Marius to add your email.', 503);
      }
      // A double tap can lose the race to the first insert.
      try { row = await L.staffByEmail(email); } catch (e) { /* fall through */ }
      if (!row) return L.bad('Could not save that request. Try again in a moment.', 500);
    }

    if (created) {
      const mail = T.accessRequested(email);
      try {
        await L.sendEmail({ to: L.OWNER_EMAIL, subject: mail.subject, html: mail.html, replyTo: email });
      } catch (err) {
        console.error('owner notify failed:', err.message);
      }
    }
    access = L.accessStatus(row) === 'approved' ? 'approved' : 'pending';
  }

  try {
    await L.ensureAuthUser(email);
  } catch (err) {
    console.error('ensureAuthUser failed:', err.message);
    return L.bad('Could not start sign-in. Try again in a moment.', 500);
  }

  try {
    await L.sendStaffOtp(email);
  } catch (err) {
    console.error('sendStaffOtp failed:', err.message);
    if (/rate|too many|60 seconds|429/i.test(err.message)) {
      return L.bad('A code was just sent. Wait a minute before asking for another.', 429);
    }
    return L.bad('Could not email that code. Try again in a moment.', 500);
  }

  return L.ok({ sent: true, email, access });
};
