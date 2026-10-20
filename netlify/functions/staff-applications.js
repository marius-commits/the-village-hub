// GET /.netlify/functions/staff-applications           -> the queue
// GET /.netlify/functions/staff-applications?id=<uuid>  -> one application,
//     its documents and its audit trail.
// GET /.netlify/functions/staff-applications?doc=<uuid> -> a freshly signed
//     view URL for one document.
//
// Requires a Supabase session JWT in the Authorization header belonging to
// an active row in the staff table.
//
// Documents are signed ON CLICK, not when the application is opened. Signing
// them up front meant a link was already counting down while the reviewer
// read the page, and anything opened more than fifteen minutes later died
// with "InvalidJWT: exp claim timestamp check failed". A URL minted at the
// moment of the click cannot be stale.

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
  const docId  = L.clean((event.queryStringParameters || {}).doc, 60);
  const status = L.clean((event.queryStringParameters || {}).status, 30);

  try {
    // One document, signed right now. Thirty minutes is plenty to open and
    // read it, and the link is never handed out before it is wanted.
    if (docId) {
      const rows = await L.selectRows(
        'application_documents',
        `id=eq.${docId}&select=id,application_id,doc_type,storage_path,original_filename,mime_type`
      );
      if (!rows || !rows.length) return L.bad('Not found', 404);
      const doc = rows[0];

      let url;
      try {
        url = await L.createSignedViewUrl(doc.storage_path, 1800);
      } catch (err) {
        console.error('sign failed for', doc.storage_path, err.message);
        return L.bad('That document could not be opened. It may not have uploaded.', 502);
      }

      await L.logEvent(doc.application_id, 'document_viewed', staff.email, {
        doc_type: doc.doc_type,
        filename: doc.original_filename || null,
      });

      return L.ok({ view_url: url, filename: doc.original_filename || null, mime_type: doc.mime_type || null });
    }

    if (id) {
      const rows = await L.selectRows('applications', `id=eq.${id}&select=*`);
      if (!rows || !rows.length) return L.bad('Not found', 404);
      const app = rows[0];

      const docs = await L.selectRows(
        'application_documents',
        `application_id=eq.${id}&select=*&order=uploaded_at.asc`
      );

      // No signed URLs here on purpose — see the note at the top of the file.
      // The browser asks for one per document at the moment it is clicked.
      const withUrls = (docs || []).map(d => ({ ...d, view_url: null }));

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
