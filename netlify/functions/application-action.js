// POST /.netlify/functions/application-action
// { application_id, action, message?, spacebring_customer_ref?, spacebring_subscription_ref? }
//
// actions: take        -> under_review
//          request_info-> info_requested  (emails the applicant)
//          approve     -> approved        (emails the applicant)
//          decline     -> declined        (emails the applicant)
//          activate    -> activated       (records the Spacebring links)
//          note        -> internal note only, no status change, no email
//          verify_doc  -> ticks (or unticks) one document as checked
//          retry_onboarding -> picks the automatic set-up back up where it stopped
//
// Approve is refused until every document has been ticked as checked, and on
// approval the automatic Spacebring set-up starts (see _onboarding.js) when
// SPACEBRING_PROVISIONING is dry or live.
//
// Staff only. Every action writes to the audit trail; the status-change
// trigger in the database writes a second record independently, so an
// action cannot be performed without leaving a mark.

const L = require('./_lib');
const T = require('./_emails');
const SB = require('./_spacebring');
const O = require('./_onboarding');
const Live = require('./_onboarding_live');
const Letter = require('./_registered_address_letter');

const ACTIONS = {
  take:         { status: 'under_review',  email: null },
  request_info: { status: 'info_requested', email: T.infoRequested, needsMessage: true },
  approve:      { status: 'approved',      email: T.approved },
  decline:      { status: 'declined',      email: T.declined, needsMessage: true },
  activate:     { status: 'activated',     email: null },
  note:         { status: null,            email: null },
  verify_doc:   { status: null,            email: null },
  retry_onboarding: { status: null,        email: null },
  save_vetting: { status: null,            email: null },
  upload_vetting_pdf: { status: null,      email: null },
  registered_address_letter: { status: null, email: null },
};

// Netlify caps a function body near 6MB. Base64 adds a third, so the PDF
// itself stops at 4MB, which a BizProfile is.
const VETTING_PDF_MAX_BYTES = 4 * 1024 * 1024;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  const staff = gate.staff;

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

    // --- One document ticked as checked -----------------------------------
    if (action === 'verify_doc') {
      const docId = L.clean(payload.document_id, 60);
      const verified = payload.verified !== false;
      if (!docId) return L.bad('Missing document');
      const docs = await L.updateRows('application_documents', `id=eq.${docId}&application_id=eq.${id}`, {
        verified,
        verified_by: verified ? staff.user_id : null,
        verified_at: verified ? new Date().toISOString() : null,
      });
      const doc = Array.isArray(docs) ? docs[0] : docs;
      if (!doc) return L.bad('Not found', 404);
      await L.logEvent(id, verified ? 'document_verified' : 'document_unverified', staff.email, { doc_type: doc.doc_type });
      return L.ok({ document: { id: doc.id, verified: doc.verified } });
    }

    // --- CIPC BizPortal BizProfile recorded by staff ----------------------
    // The registered name captured here is the one printed on the agreement
    // and the invoice, so a typo on the application form never reaches a client.
    if (action === 'save_vetting') {
      if (before.type !== 'virtual_office') return L.bad('Vetting applies to virtual office applications.');
      if (before.status === 'activated') return L.bad('This client is already live.');
      const cipcName = L.clean(payload.cipc_name, 200);
      if (!cipcName) return L.bad('Enter the company name exactly as the BizProfile shows it.');
      if (typeof payload.company_active !== 'boolean' || typeof payload.director_listed !== 'boolean') {
        return L.bad('Answer both questions: is the company in business, and is the applicant a director.');
      }
      const vetting = O.vettingRecord({ ...payload, cipc_name: cipcName }, staff.email, before.vetting, new Date().toISOString());
      await L.updateRows('applications', `id=eq.${id}`, { vetting });
      await L.logEvent(id, 'vetting_recorded', staff.email, {
        source: vetting.source,
        company_active: vetting.company_active, director_listed: vetting.director_listed,
        name_matches_form: cipcName.trim().toLowerCase() === String(before.company_name || '').trim().toLowerCase(),
      });
      return L.ok({ vetting, passed: O.vettingPassed({ vetting }) });
    }

    // Staff upload (or replace) the BizProfile PDF. The file lands in the
    // private kyc-documents bucket and the vetting row points at it.
    if (action === 'upload_vetting_pdf') {
      if (before.type !== 'virtual_office') return L.bad('Vetting applies to virtual office applications.');
      if (before.status === 'activated') return L.bad('This client is already live.');
      const filename = L.clean(payload.filename, 200) || 'cipc-bizprofile.pdf';
      const raw = String(payload.pdf_base64 || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s/g, '');
      if (!raw) return L.bad('Choose the BizProfile PDF first.');
      if (raw.length > Math.ceil(VETTING_PDF_MAX_BYTES * 4 / 3) + 16) {
        return L.bad('That PDF is over 4MB. Export a smaller BizProfile and try again.');
      }
      const bytes = Buffer.from(raw, 'base64');
      if (!bytes.length || bytes.length > VETTING_PDF_MAX_BYTES) {
        return L.bad('That PDF is over 4MB. Export a smaller BizProfile and try again.');
      }
      if (bytes.subarray(0, 4).toString() !== '%PDF') return L.bad('The verification file must be a PDF.');

      const rand = Math.random().toString(36).slice(2, 10);
      const path = `applications/${id}/cipc_bizprofile-${rand}.pdf`;
      try {
        await L.uploadObject(path, bytes, 'application/pdf');
      } catch (err) {
        console.error('vetting pdf upload failed:', err.message);
        return L.bad('The BizProfile PDF could not be stored. Try again.', 502);
      }

      let doc;
      try {
        doc = await L.insertRow('application_documents', {
          application_id: id,
          doc_type: 'cipc_bizprofile',
          storage_path: path,
          original_filename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: bytes.length,
          verified: true,
          verified_by: staff.user_id,
          verified_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('vetting pdf row failed:', err.message);
        try { await L.deleteObject(path); } catch (cleanup) { console.error('vetting pdf cleanup failed:', cleanup.message); }
        if (/document_type|enum|cipc_bizprofile/i.test(err.message)) {
          return L.bad('The database does not know the cipc_bizprofile document type yet. Apply the migration, then upload again.', 500);
        }
        return L.bad('The PDF was stored but could not be attached. Try again.', 500);
      }

      const prev = before.vetting && typeof before.vetting === 'object' ? before.vetting : {};
      const vetting = {
        ...prev,
        source: prev.source || O.VETTING_SOURCE,
        document_id: doc.id,
        storage_path: path,
      };
      await L.updateRows('applications', `id=eq.${id}`, { vetting });
      await L.logEvent(id, 'vetting_pdf_uploaded', staff.email, { document_id: doc.id, storage_path: path, bytes: bytes.length });
      return L.ok({ vetting, document: { id: doc.id, doc_type: 'cipc_bizprofile', storage_path: path, verified: true } });
    }

    // Staff generate (or regenerate) the CIPC / SARS / bank confirmation
    // letter. It is stored with the application and opened from the page.
    // The same letter is attached automatically when the address goes live.
    if (action === 'registered_address_letter') {
      if (!O.needsRegisteredAddress(before)) {
        return L.bad('This application does not include a registered address.');
      }
      if (before.status === 'declined' || before.status === 'withdrawn') {
        return L.bad('This application is closed.');
      }
      try {
        const document = await Letter.generateForStaff(before, staff);
        return L.ok({ document });
      } catch (err) {
        console.error('confirmation letter failed:', err.message);
        if (/document_type|enum|registered_address_confirmation/i.test(err.message)) {
          return L.bad('The database does not know the registered_address_confirmation document type yet. Apply the migration, then try again.', 500);
        }
        if (err.code === 'missing_company' || /does not fit on one page/i.test(err.message)) return L.bad(err.message);
        return L.bad('The confirmation letter could not be written. Try again.', 500);
      }
    }

    // --- Automatic set-up, picked back up ---------------------------------
    if (action === 'retry_onboarding') {
      if (before.status !== 'approved') return L.bad('Only an approved application can be set up.');
      if (O.isVO(before) && (O.vettingRequired() || before.vetting) && !O.vettingPassed(before)) {
        return L.bad(before.vetting
          ? 'The recorded company check failed. Update it or decline before setting this client up.'
          : 'Record the CIPC BizPortal BizProfile check first. Set-up uses the registered name from it.');
      }
      await L.logEvent(id, 'action:retry_onboarding', staff.email, null);
      const result = await O.provision(before, staff.email, Live.deps());
      return L.ok({ application: before, onboarding: result });
    }

    if (action === 'approve') {
      if (before.status === 'approved' || before.status === 'activated') {
        return L.bad('This application is already approved. Nothing was sent again.');
      }
      // The registry gate, virtual office only.
      if (O.isVO(before)) {
        const v = before.vetting;
        if (!v && O.vettingRequired()) return L.bad('Record the CIPC BizPortal BizProfile check before approving.');
        if (v && v.company_active !== true) return L.bad('The register shows this company is not in business. Decline, or request information.');
        if (v && v.director_listed !== true) return L.bad('The applicant is not a director on the register. Decline, or request information.');
      }
      // The KYC gate. Approving is a statement that the documents were read.
      const docs = await L.selectRows('application_documents', `application_id=eq.${id}&select=id,doc_type,verified`);
      const unchecked = (docs || []).filter(d => d.verified !== true);
      // A desk sign-up carries no documents, so there is nothing to tick.
      if ((!docs || !docs.length) && !O.isDesk(before)) return L.bad('There are no documents on this application to check.');
      if (unchecked.length) {
        const names = unchecked.map(d => T.DOC_LABELS[d.doc_type] || d.doc_type).join(', ');
        return L.bad(`Open and tick every document before approving. Still unchecked: ${names}.`);
      }
    }

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
      // Only overwrite a reference when one was typed in: the automation may
      // already have recorded both.
      const customerRef = L.clean(payload.spacebring_customer_ref, 80);
      const subRef      = L.clean(payload.spacebring_subscription_ref, 80);
      if (customerRef) patch.spacebring_customer_ref = customerRef;
      if (subRef)      patch.spacebring_subscription_ref = subRef;
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
      const automated = action === 'approve' && SB.mode() === 'live';
      const mail = action === 'approve'
        ? T.approved(app, message, { automated, startDate: automated ? O.startDate(app, new Date()) : null })
        : spec.email(app, message);
      // client:true blind-copies the Hub inbox on everything a client is sent.
      const result = await L.sendEmail({
        to: app.email,
        subject: mail.subject,
        html: mail.html,
        replyTo: L.NOTIFY_EMAIL,
        client: true,
      });
      emailed = !result.error && !result.skipped;
      if (!emailed) {
        // Say so rather than letting staff believe the applicant was told.
        await L.logEvent(app.id, 'email_failed', staff.email, { action, detail: result.error || 'not configured' });
      }
    }

    await L.logEvent(app.id, `action:${action}`, staff.email, { message: message || null, emailed });

    // Set-up in Spacebring starts here. It records each step as it goes and
    // reports its own failures, so it can never undo or block the approval.
    let onboarding = null;
    if (action === 'approve') {
      try { onboarding = await O.provision(app, staff.email, Live.deps()); }
      catch (err) { console.error('provision failed:', err.message); }
    }

    // Activated by hand (set up outside the automation): the client still
    // gets the welcome and the mail desk still gets told, once each.
    if (action === 'activate' && before.status !== 'activated') {
      try {
        const d = Live.deps();
        const done = (app.onboarding && app.onboarding.steps) || {};
        const stepsNow = { ...done };
        if (!done.welcome && await d.mail.welcome(app)) stepsNow.welcome = { at: new Date().toISOString() };
        if (O.isDesk(app) && !done.paid_alert) {
          const to = await d.mail.paidAlert(app);
          if (to) stepsNow.paid_alert = { at: new Date().toISOString(), to };
        }
        if (O.isVO(app) && !done.mail_desk) {
          const to = await d.mail.mailDesk(app);
          if (to) stepsNow.mail_desk = { at: new Date().toISOString(), to };
        }
        await L.updateRows('applications', `id=eq.${id}`, {
          onboarding: { ...(app.onboarding || {}), steps: stepsNow },
          onboarding_state: 'complete',
        });
      } catch (err) { console.error('activation notices failed:', err.message); }
    }

    return L.ok({ application: app, emailed, onboarding });
  } catch (err) {
    console.error('application-action failed:', err.message);
    return L.bad('Could not complete that action', 500);
  }
};
