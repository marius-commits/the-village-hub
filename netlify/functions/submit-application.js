// POST /.netlify/functions/submit-application
//
// Phase 1 of a two-phase submission. Creates the application row and hands
// back one short-lived signed upload URL per declared document. The browser
// then PUTs each file straight to Supabase Storage and calls
// complete-application when they are all in.
//
// Two phases rather than one because Netlify functions cap request bodies at
// about 6MB, and three photographed documents will exceed that.

const L = require('./_lib');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return L.bad('Applications are temporarily unavailable. Please email hello@villagehub.co.za.', 503);
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  const type = L.clean(payload.type, 40);
  if (!L.PLANS[type]) return L.bad('Unknown application type');

  const plan = L.clean(payload.plan, 80);
  if (!L.PLANS[type].includes(plan)) return L.bad('Unknown package');

  const firstName = L.clean(payload.first_name, 80);
  const lastName  = L.clean(payload.last_name, 80);
  const email     = L.clean(payload.email, 160);
  const phone     = L.clean(payload.phone, 40);

  if (!firstName || !lastName) return L.bad('Please give your first and last name');
  if (!L.validEmail(email))    return L.bad('Please give a valid email address');
  if (!phone)                  return L.bad('Please give a contact number');
  if (!payload.popia_consent)  return L.bad('We cannot process the application without your consent to handle these documents');

  // Documents the browser says it is about to upload.
  const declared = Array.isArray(payload.documents) ? payload.documents : [];
  const notRegistered = type === 'virtual_office' && L.clean(payload.company_type, 40) === 'not_registered';

  // A business that is not registered yet has no CIPC certificate to give,
  // and cannot be given a registered CIPC/SARS address at all.
  if (notRegistered && plan === 'Village Virtual Pro') {
    return L.bad('Village Virtual Pro includes a registered CIPC address, which needs a registered company. Choose Village Address or Village Virtual for now.');
  }

  const required = notRegistered
    ? L.REQUIRED_DOCS[type].filter(d => d !== 'cipc_certificate')
    : L.REQUIRED_DOCS[type];
  const supplied = declared.map(d => d.doc_type);
  const missing  = required.filter(r => !supplied.includes(r));
  if (missing.length) return L.bad(`Still needed: ${missing.join(', ')}`);

  for (const d of declared) {
    if (!L.ALLOWED_MIME.includes(d.mime_type)) {
      return L.bad('Documents must be a PDF or a photo (JPG, PNG, HEIC or WebP)');
    }
    if (Number(d.size_bytes) > L.MAX_FILE_BYTES) {
      return L.bad('Each document must be 10MB or smaller');
    }
  }

  // Cheap abuse guard: the same address cannot open more than three
  // applications an hour. Not a substitute for a WAF, but it stops the
  // obvious script.
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await L.selectRows(
      'applications',
      `email=eq.${encodeURIComponent(email)}&created_at=gte.${since}&select=id`
    );
    if (recent && recent.length >= 3) {
      return L.bad('You have already applied a few times just now. Email hello@villagehub.co.za and we will sort it out.', 429);
    }
  } catch (err) {
    console.error('rate-limit check failed, allowing through:', err.message);
  }

  const row = {
    type,
    plan,
    first_name: firstName,
    last_name:  lastName,
    email,
    phone,
    preferred_start_date: L.clean(payload.preferred_start_date, 20),
    popia_consent_at: new Date().toISOString(),
    popia_consent_version: '2026-10',
    source_page: L.clean(payload.source_page, 200),
    utm: payload.utm && typeof payload.utm === 'object' ? payload.utm : null,
  };

  if (type === 'virtual_office') {
    Object.assign(row, {
      company_name:             L.clean(payload.company_name, 160),
      company_trading_name:     L.clean(payload.company_trading_name, 160),
      company_type:             L.clean(payload.company_type, 40),
      cipc_registration_number: L.clean(payload.cipc_registration_number, 40),
      vat_number:               L.clean(payload.vat_number, 40),
      business_activity:        L.clean(payload.business_activity, 600),
      website:                  L.clean(payload.website, 200),
      wants_registered_address: Boolean(payload.wants_registered_address),
      expected_mail_volume:     L.clean(payload.expected_mail_volume, 40),
      director_full_name:       L.clean(payload.director_full_name, 160),
      director_role:            L.clean(payload.director_role, 80),
    });
    if (!row.company_name) return L.bad('Please give the company or trading name');
    if (!row.director_full_name) return L.bad('Please give the name of the director or owner');
  } else {
    Object.assign(row, {
      institution:              L.clean(payload.institution, 120),
      student_number:           L.clean(payload.student_number, 40),
      course_of_study:          L.clean(payload.course_of_study, 160),
      year_of_study:            L.clean(payload.year_of_study, 40),
      is_nooitgedacht_resident: Boolean(payload.is_nooitgedacht_resident),
      residence_area:           L.clean(payload.residence_area, 160),
    });
    if (!row.institution)    return L.bad('Please tell us where you study');
    if (!row.student_number) return L.bad('Please give your student number');
  }

  try {
    const app = await L.insertRow('applications', row);

    // One signed upload URL per document, each scoped to a single object
    // path under this application's folder. A URL cannot be reused for a
    // different path or a different application.
    const uploads = [];
    for (const d of declared) {
      const ext  = L.safeExtension(d.filename, d.mime_type);
      const rand = Math.random().toString(36).slice(2, 10);
      const path = `applications/${app.id}/${d.doc_type}-${rand}.${ext}`;
      const signed = await L.createSignedUploadUrl(path);

      await L.insertRow('application_documents', {
        application_id: app.id,
        doc_type: d.doc_type,
        storage_path: path,
        original_filename: L.clean(d.filename, 200),
        mime_type: d.mime_type,
        size_bytes: Number(d.size_bytes) || null,
      });

      uploads.push({ doc_type: d.doc_type, path, url: signed.url, token: signed.token });
    }

    await L.logEvent(app.id, 'submitted', 'applicant', {
      plan: app.plan,
      documents: declared.map(d => d.doc_type),
    });

    return L.ok({ application_id: app.id, reference: app.reference, uploads });
  } catch (err) {
    console.error('submit-application failed:', err.message);
    return L.bad('We could not save your application. Please try again, or email hello@villagehub.co.za.', 500);
  }
};
