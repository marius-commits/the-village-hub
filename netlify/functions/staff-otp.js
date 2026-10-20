// POST /.netlify/functions/staff-otp   { email }
//
// Step one of staff sign-in. Replaces the browser calling /auth/v1/otp
// directly, which had two faults:
//
//   1. A first-time staff member had no auth account, so Supabase treated the
//      request as a sign-up and emailed the "Confirm signup" template — a
//      LINK, not a code. The login page asks for a code, so they were stuck.
//      Here the account is created first, which forces the OTP template.
//
//   2. Any address typed into the login box created an auth account on the
//      project. Now the email must already be on the staff list, and anyone
//      else is told so plainly instead of waiting for a code that is coming
//      but will never let them in.
//
// Deliberately uniform timing is not attempted: this endpoint is noindexed,
// staff-only, and confirming "not on the staff list" is the whole point of
// the better error message.

const L = require('./_lib');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  const email = (L.clean(payload.email, 180) || '').toLowerCase();
  if (!L.validEmail(email)) return L.bad('That email does not look right.');

  // Authorisation is by email on the staff list, exactly as every other
  // function checks it. Nobody self-registers into staff.
  let staff;
  try {
    const rows = await L.selectRows(
      'staff_access',
      `email=eq.${encodeURIComponent(email)}&active=is.true&select=email,full_name,role`
    );
    staff = rows && rows[0];
  } catch (err) {
    console.error('staff lookup failed:', err.message);
    return L.bad('Could not check that address. Try again in a moment.', 500);
  }

  if (!staff) {
    return L.bad('That email is not on the staff list. Ask Marius to add it.', 403);
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
    // Supabase rate-limits one-time codes per address.
    if (/rate|too many|60 seconds|429/i.test(err.message)) {
      return L.bad('A code was just sent. Wait a minute before asking for another.', 429);
    }
    return L.bad('Could not email that code. Try again in a moment.', 500);
  }

  return L.ok({ sent: true, email });
};
