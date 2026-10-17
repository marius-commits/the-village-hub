// POST /.netlify/functions/complete-application
//
// Phase 2. Called once the browser has finished uploading every document.
// Confirms the files actually landed in storage, then sends the applicant
// confirmation and the internal alert, and mirrors a lead into Zoho.
//
// Verifying against storage rather than trusting the browser matters: a
// half-uploaded application that emails "we have your documents" is worse
// than no email at all.

const L = require('./_lib');
const T = require('./_emails');

// Lists the objects actually present under this application's folder.
// The list endpoint is used rather than object/info because it is stable
// across Storage versions and costs one call for all documents.
async function storedPaths(applicationId) {
  const prefix = `applications/${applicationId}`;
  const items = await L.sb(`/storage/v1/object/list/${L.BUCKET}`, {
    method: 'POST',
    body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
  });
  return new Set((items || []).map(i => `${prefix}/${i.name}`));
}

// Mirror the lead into Zoho so the CRM pipeline still sees it. Uses the
// existing Web-to-Lead form, which is the only Zoho path that works without
// OAuth credentials. Failure here never blocks the application.
async function mirrorToZoho(app) {
  try {
    const body = new URLSearchParams({
      xnQsjsdp: '3bab74f7e8aba6be99b9d1863cff751310a973b2c6f80cb471b7a4eede332658',
      xmIwtLD: 'bdb9fc7c567f2c2566b234583069f587376dc60a5539756d51c3e410227569ad393d23a4d15100a62a79b7c7a7284819',
      actionType: 'TGVhZHM=',
      returnURL: 'https://the-village-hub.netlify.app/success.html',
      'First Name': app.first_name,
      'Last Name':  app.last_name,
      Email:        app.email,
      Phone:        app.phone,
      Company:      app.company_name || app.institution || '',
      'Lead Source': 'Website - Application Form',
      Description: [
        `Plan Interest: ${app.plan}`,
        `Application reference: ${app.reference}`,
        app.preferred_start_date ? `Preferred start: ${app.preferred_start_date}` : '',
        'Submitted through the KYC application form. Documents are in Supabase.',
      ].filter(Boolean).join('\n'),
    });

    await fetch('https://crm.zoho.com/crm/WebToLeadForm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
  } catch (err) {
    console.error('Zoho mirror failed (non-blocking):', err.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Applications are temporarily unavailable.', 503);

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  const applicationId = L.clean(payload.application_id, 60);
  if (!applicationId) return L.bad('Missing application reference');

  try {
    const rows = await L.selectRows('applications', `id=eq.${applicationId}&select=*`);
    if (!rows || !rows.length) return L.bad('Application not found', 404);
    const app = rows[0];

    const docs = await L.selectRows(
      'application_documents',
      `application_id=eq.${applicationId}&select=*`
    );

    // Confirm each declared document is really in the bucket.
    const present = await storedPaths(applicationId);
    const landed = (docs || []).filter(d => present.has(d.storage_path));
    const absent = (docs || []).filter(d => !present.has(d.storage_path)).map(d => d.doc_type);

    // Mirrors the conditional rule in submit-application: an unregistered
    // business has no CIPC certificate to upload.
    const base = L.REQUIRED_DOCS[app.type] || [];
    const required = app.company_type === 'not_registered'
      ? base.filter(d => d !== 'cipc_certificate')
      : base;
    const missing = required.filter(r => !landed.some(d => d.doc_type === r));

    if (missing.length) {
      await L.logEvent(app.id, 'upload_incomplete', 'system', { missing, absent });
      return L.bad(`These documents did not upload: ${missing.join(', ')}. Please try again.`, 422);
    }

    // Only email once. If the browser retries, do not spam the applicant.
    if (app.notified_at) {
      return L.ok({ reference: app.reference, already_complete: true });
    }

    const reviewUrl = `${L.SITE_URL}/admin/applications?ref=${encodeURIComponent(app.reference)}`;

    const toApplicant = T.applicantReceived(app);
    const toStaff     = T.staffAlert(app, landed, reviewUrl);

    await Promise.all([
      L.sendEmail({ to: app.email,     subject: toApplicant.subject, html: toApplicant.html, replyTo: L.NOTIFY_EMAIL }),
      L.sendEmail({ to: L.NOTIFY_EMAIL, subject: toStaff.subject,     html: toStaff.html,     replyTo: app.email }),
    ]);

    await L.updateRows('applications', `id=eq.${app.id}`, { notified_at: new Date().toISOString() });
    await L.logEvent(app.id, 'documents_received', 'system', { documents: landed.map(d => d.doc_type) });
    await L.logEvent(app.id, 'emails_sent', 'system', { applicant: app.email, staff: L.NOTIFY_EMAIL });

    await mirrorToZoho(app);

    return L.ok({ reference: app.reference, documents: landed.length });
  } catch (err) {
    console.error('complete-application failed:', err.message);
    return L.bad('Your documents uploaded but we could not finish. Please email hello@villagehub.co.za with your reference.', 500);
  }
};
