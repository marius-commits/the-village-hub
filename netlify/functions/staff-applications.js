// GET /.netlify/functions/staff-applications          -> the queue
// GET /.netlify/functions/staff-applications?id=<uuid> -> one application,
//     with short-lived signed URLs for its documents and its audit trail.
//
// Requires a Supabase session JWT in the Authorization header belonging to
// an active row in the staff table. Documents are never public: the signed
// view URLs expire in 15 minutes.

const L = require('./_lib');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  let staff;
  try {
    staff = await L.requireStaff(event);
  } catch (err) {
    console.error('staff check failed:', err.message);
    return L.bad('Could not verify your access', 500);
  }
  if (!staff) return L.bad('Not authorised', 401);

  const id     = L.clean((event.queryStringParameters || {}).id, 60);
  const status = L.clean((event.queryStringParameters || {}).status, 30);

  try {
    if (id) {
      const rows = await L.selectRows('applications', `id=eq.${id}&select=*`);
      if (!rows || !rows.length) return L.bad('Not found', 404);
      const app = rows[0];

      const docs = await L.selectRows(
        'application_documents',
        `application_id=eq.${id}&select=*&order=uploaded_at.asc`
      );

      const withUrls = [];
      for (const d of docs || []) {
        let url = null;
        try { url = await L.createSignedViewUrl(d.storage_path, 900); }
        catch (err) { console.error('sign failed for', d.storage_path, err.message); }
        withUrls.push({ ...d, view_url: url });
      }

      const events = await L.selectRows(
        'application_events',
        `application_id=eq.${id}&select=*&order=created_at.desc&limit=50`
      );

      return L.ok({ application: app, documents: withUrls, events: events || [] });
    }

    // Queue view. Open work first, newest within that.
    const filter = status
      ? `status=eq.${status}`
      : `status=in.(submitted,under_review,info_requested,approved)`;

    const list = await L.selectRows(
      'applications',
      `${filter}&select=id,reference,type,plan,status,first_name,last_name,email,phone,company_name,institution,wants_registered_address,preferred_start_date,created_at,reviewed_at&order=created_at.desc&limit=200`
    );

    return L.ok({ applications: list || [], staff: { email: staff.email, role: staff.role } });
  } catch (err) {
    console.error('staff-applications failed:', err.message);
    return L.bad('Could not load applications', 500);
  }
};
