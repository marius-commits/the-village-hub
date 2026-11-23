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
};

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

    // --- Registry check recorded (Lexis WinDeed company search) ------------
    // Staff run the search in WinDeed and record what the register says. The
    // registered name captured here is the one printed on the agreement and
    // the invoice, so a typo on the application form never reaches a client.
    if (action === 'save_vetting') {
      if (before.type !== 'virtual_office') return L.bad('Vetting applies to virtual office applications.');
      if (before.status === 'activated') return L.bad('This client is already live.');
      const cipcName = L.clean(payload.cipc_name, 200);
      if (!cipcName) return L.bad('Enter the company name exactly as the register shows it.');
      if (typeof payload.company_active !== 'boolean' || typeof payload.director_listed !== 'boolean') {
        return L.bad('Answer both questions: is the company in business, and is the applicant a director.');
      }
      const vetting = {
        source: 'Lexis WinDeed company search',
        cipc_name: cipcName,
        company_active: payload.company_active,
        director_listed: payload.director_listed,
        notes: L.clean(payload.notes, 1000) || null,
        checked_by: staff.email,
        checked_at: new Date().toISOString(),
      };
      await L.updateRows('applications', `id=eq.${id}`, { vetting });
      await L.logEvent(id, 'vetting_recorded', staff.email, {
        company_active: vetting.company_active, director_listed: vetting.director_listed,
        name_matches_form: cipcName.trim().toLowerCase() === String(before.company_name || '').trim().toLowerCase(),
      });
      return L.ok({ vetting, passed: O.vettingPassed({ vetting }) });
    }

    // --- Automatic set-up, picked back up ---------------------------------
    if (action === 'retry_onboarding') {
      if (before.status !== 'approved') return L.bad('Only an approved application can be set up.');
      if (O.isVO(before) && (O.vettingRequired() || before.vetting) && !O.vettingPassed(before)) {
        return L.bad(before.vetting
          ? 'The recorded company check failed. Update it or decline before setting this client up.'
          : 'Record the WinDeed company check first. Set-up uses the registered name from it.');
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
        if (!v && O.vettingRequired()) return L.bad('Run the WinDeed company search and record the result before approving.');
        if (v && v.company_active !== true) return L.bad('The register shows this company is not in business. Decline, or request information.');
        if (v && v.director_listed !== true) return L.bad('The applicant is not a director on the register. Decline, or request information.');
      }
      // The KYC gate. Approving is a statement that the documents were read.
      const docs = await L.selectRows('application_documents', `application_id=eq.${id}&select=id,doc_type,verified`);
      const unchecked = (docs || []).filter(d => d.verified !== true);
      if (!docs || !docs.length) return L.bad('There are no documents on this application to check.');
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
