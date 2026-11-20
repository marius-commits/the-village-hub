// GET /.netlify/functions/staff-session
// Who is signed in, and whether they may use the command centre.
// Pending callers get 200 with status "pending" so the page can show the
// waiting screen without throwing away the session.

const L = require('./_lib');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let user;
  try { user = await L.readUser(event); }
  catch (err) {
    console.error('session read failed:', err.message);
    return L.bad('Could not verify your access', 500);
  }
  if (!user) return L.bad('Not authorised', 401, 'auth');

  let row;
  try { row = await L.staffByEmail(user.email.toLowerCase()); }
  catch (err) {
    console.error('staff lookup failed:', err.message);
    return L.bad('Could not verify your access', 500);
  }

  const status = L.accessStatus(row);
  if (status === 'none' || status === 'revoked' || (row && row.active === false && status !== 'pending')) {
    return L.bad('This address does not have access.', 403, 'revoked');
  }

  const staff = L.staffView(row, user.id);
  let team = [];
  if (status === 'approved') {
    team = await L.selectRows(
      'staff_access',
      'status=eq.approved&active=is.true&select=email,full_name,role&order=full_name.asc'
    ).catch(() => []);
  }

  return L.ok({ staff, team: team || [] });
};
