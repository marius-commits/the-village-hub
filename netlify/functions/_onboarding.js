// What happens to an application after a human approves it.
//
// Virtual office:  company -> member invite -> agreement issued for signature
//                  -> (client signs: Spacebring creates the subscription and
//                  the first invoice) -> paid -> activated -> welcome email
//                  and mail-desk notice.
// Student:         member invite -> subscription and first invoice -> paid ->
//                  activated -> welcome email.
//
// Rules this file keeps:
//  - Every step is recorded on the application the moment it succeeds, so a
//    failure half way never repeats a step that already created something in
//    Spacebring. Retrying picks up at the step that failed.
//  - A failure stops the run, marks the application "needs attention" and
//    tells staff. It never guesses and never carries on past a missing piece.
//  - Nothing here decides KYC. It only runs after Approve.
//
// Spacebring, the database and email are passed in (deps) so the whole flow
// can be tested without touching any of them.

const SAST_OFFSET_MS = 2 * 3600 * 1000;

function isVO(app) { return app.type === 'virtual_office'; }

function needsRegisteredAddress(app) {
  return isVO(app) && (app.wants_registered_address === true || app.plan === 'Village Virtual Pro');
}

function sastDate(d) {
  return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

// The membership starts on the applicant's chosen date when that is still
// ahead, otherwise today. Spacebring only issues the first invoice once the
// subscription has started, so defaulting to a later date would leave an
// approved client waiting with nothing to pay.
function startDate(app, now) {
  const today = sastDate(now);
  const preferred = app.preferred_start_date && String(app.preferred_start_date).slice(0, 10);
  return preferred && preferred > today ? preferred : today;
}

// Midnight SAST on that date, as the UTC instant Spacebring stores.
function startInstant(dateStr) {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() - SAST_OFFSET_MS).toISOString();
}

function steps(app) {
  return (app.onboarding && app.onboarding.steps) || {};
}

// The bar on the staff page. One list, in order, each with done / when.
function stages(app, documents) {
  const s = steps(app);
  const docs = documents || [];
  const allVerified = docs.length > 0 && docs.every(d => d.verified === true);
  const approved = ['approved', 'activated'].includes(app.status);
  const live = app.status === 'activated';
  const at = k => (s[k] && s[k].at) || null;

  const list = [
    { key: 'received', label: 'Application received', done: true, at: app.created_at || null },
    { key: 'verified', label: 'Documents checked', done: allVerified || approved, at: null },
    { key: 'approved', label: 'Approved', done: approved, at: approved ? app.reviewed_at || null : null },
    { key: 'account', label: 'Set up in Spacebring', done: Boolean(s.company || s.membership) || live, at: at('company') || at('membership') },
  ];
  if (isVO(app)) {
    list.push(
      { key: 'contract_issued', label: 'Agreement sent', done: Boolean(s.contract_issued) || live, at: at('contract_issued') },
      { key: 'contract_signed', label: 'Agreement signed', done: Boolean(s.contract_signed) || live, at: at('contract_signed') },
    );
  }
  list.push(
    { key: 'invoice', label: 'Invoice sent', done: Boolean(s.invoice) || live, at: at('invoice') },
    { key: 'paid', label: 'Paid and live', done: live, at: at('paid') },
  );
  if (isVO(app)) {
    list.push({ key: 'mail_desk', label: 'Mail desk told', done: Boolean(s.mail_desk), at: at('mail_desk') });
  }

  const firstOpen = list.findIndex(x => !x.done);
  list.forEach((x, i) => { x.current = i === firstOpen; });
  return {
    stages: list,
    done: list.filter(x => x.done).length,
    total: list.length,
    state: app.onboarding_state || null,
    mode: (app.onboarding && app.onboarding.mode) || null,
    error: (app.onboarding && app.onboarding.error) || null,
  };
}

function companyNotes(app, staffEmail, now) {
  return [
    `Village Hub application ${app.reference} (${app.plan}).`,
    app.cipc_registration_number ? `CIPC registration number ${app.cipc_registration_number}.` : null,
    `KYC checked and approved by ${staffEmail} on ${sastDate(now)}. FICA documents are held in the Village Hub application system under ${app.reference}.`,
    `Registered CIPC / SARS address: ${needsRegisteredAddress(app) ? 'YES, mandate is part of the signed agreement' : 'no'}.`,
    app.expected_mail_volume ? `Expected post: ${app.expected_mail_volume}.` : null,
  ].filter(Boolean).join(' ');
}

async function record(app, deps, stepKey, value, extraPatch) {
  const onboarding = {
    ...(app.onboarding || {}),
    steps: { ...steps(app), [stepKey]: { at: deps.now().toISOString(), ...value } },
  };
  delete onboarding.error;
  const patch = { onboarding, ...(extraPatch || {}) };
  await deps.store.save(app.id, patch);
  Object.assign(app, patch);
  await deps.store.log(app.id, `onboarding:${stepKey}`, 'system', value);
}

async function fail(app, deps, stepKey, message) {
  const onboarding = {
    ...(app.onboarding || {}),
    steps: steps(app),
    error: { step: stepKey, message, at: deps.now().toISOString() },
  };
  const patch = { onboarding, onboarding_state: 'needs_attention' };
  await deps.store.save(app.id, patch);
  Object.assign(app, patch);
  await deps.store.log(app.id, 'onboarding:needs_attention', 'system', { step: stepKey, message });
  if (deps.mail && deps.mail.attention) await deps.mail.attention(app, stepKey, message);
  return { state: 'needs_attention', step: stepKey, message };
}

// Runs straight after Approve, and again on Retry. Safe to call repeatedly.
async function provision(app, staffEmail, deps) {
  const sb = deps.sb;
  const mode = sb.mode();
  if (mode === 'off') return { state: null, skipped: 'off' };
  if (!sb.PLAN_REFS[app.plan]) return fail(app, deps, 'plan', `No Spacebring plan is mapped to "${app.plan}".`);

  const dry = mode === 'dry';
  if (!dry && !sb.credentialsSet()) return fail(app, deps, 'credentials', 'Spacebring API credentials are not set in Netlify.');

  // Steps recorded in test mode created nothing in Spacebring. A live run
  // must not mistake them for finished work, so it starts from a clean slate.
  if (!dry && app.onboarding && app.onboarding.mode === 'dry') {
    app.onboarding = { approved_by: app.onboarding.approved_by };
    app.spacebring_customer_ref = null;
    app.spacebring_subscription_ref = null;
    await deps.store.save(app.id, { onboarding: app.onboarding, spacebring_customer_ref: null, spacebring_subscription_ref: null });
  }

  {
    const onboarding = { ...(app.onboarding || {}), steps: steps(app), mode, approved_by: staffEmail,
      start_date: (app.onboarding && app.onboarding.start_date) || startDate(app, deps.now()) };
    delete onboarding.error;
    const patch = { onboarding, onboarding_state: dry ? 'dry_run' : 'in_progress' };
    await deps.store.save(app.id, patch);
    Object.assign(app, patch);
  }
  const start = app.onboarding.start_date;

  let stepKey = 'company';
  try {
    // 1. Company (virtual office only).
    if (isVO(app) && !steps(app).company) {
      const title = app.company_trading_name || app.company_name;
      const company = dry ? { id: 'dry-run' } : await sb.createCompany({
        title,
        // The registration number rides on the legal name because that is the
        // only company field Spacebring prints on agreements and invoices.
        legalName: app.cipc_registration_number ? `${app.company_name} (Reg. No. ${app.cipc_registration_number})` : app.company_name,
        taxId: app.vat_number || undefined,
        notes: companyNotes(app, staffEmail, deps.now()),
        metadata: { application_reference: app.reference, cipc_registration_number: app.cipc_registration_number || '' },
      });
      await record(app, deps, 'company', { ref: company.id, title }, { spacebring_customer_ref: company.id });
    }

    // 2. Member. Spacebring emails the invitation to the member app.
    stepKey = 'membership';
    if (!steps(app).membership) {
      const companyRef = isVO(app) ? steps(app).company.ref : undefined;
      let value;
      if (dry) {
        value = { ref: 'dry-run' };
      } else {
        try {
          const m = await sb.createMembership({
            email: app.email, name: app.first_name, surname: app.last_name,
            phoneNumber: app.phone || undefined, companyRef,
            notes: isVO(app) ? undefined : `Village Hub application ${app.reference} (${app.plan}). Student documents checked by ${staffEmail} on ${sastDate(deps.now())}.`,
            metadata: { application_reference: app.reference },
          });
          value = { ref: m.id };
        } catch (err) {
          // A company can go on without a new login: the person usually
          // already has one (one director, two companies). The agreement
          // still reaches them by email. A student plan cannot go on, because
          // the subscription hangs off the membership.
          if (!isVO(app)) throw err;
          value = { skipped: true, note: `Member not created (${err.message}). If ${app.email} is already a member, link them to this company in Spacebring.` };
        }
      }
      await record(app, deps, 'membership', value, isVO(app) ? undefined : { spacebring_customer_ref: value.ref });
    }

    if (isVO(app)) {
      // 3. Agreement, drafted against the right template.
      stepKey = 'contract';
      const registered = needsRegisteredAddress(app);
      const templateRef = registered ? sb.TEMPLATE_VO_REGISTERED : sb.TEMPLATE_VO;
      if (!steps(app).contract) {
        if (!templateRef) {
          return fail(app, deps, 'contract',
            `The ${registered ? 'registered-address ' : ''}virtual office agreement template is not set up in Spacebring yet. The customer exists; issue the agreement by hand or set the template id and press Retry.`);
        }
        const contract = dry ? { id: 'dry-run', title: 'dry-run' } : await sb.createContract({
          customerRef: steps(app).company.ref,
          templateRef,
          planTitle: app.plan,
          startDate: startInstant(start),
          expirationDate: new Date(deps.now().getTime() + 14 * 86400_000).toISOString(),
          signer: { email: app.email, name: app.first_name, surname: app.last_name, phoneNumber: app.phone || undefined },
        });
        await record(app, deps, 'contract', { ref: contract.id, title: contract.title || null, registered_address: registered });
      }

      // 4. Issued for e-signature. Spacebring emails the signing link.
      stepKey = 'contract_issued';
      if (!steps(app).contract_issued) {
        const issued = dry ? {} : await sb.issueContract(steps(app).contract.ref);
        const sub = issued && issued.subscriptionRef ? { spacebring_subscription_ref: issued.subscriptionRef } : undefined;
        await record(app, deps, 'contract_issued', { title: (issued && issued.title) || steps(app).contract.title || null }, sub);
      }
    } else {
      // Student plans have no agreement: subscription and first invoice now.
      stepKey = 'subscription';
      if (!steps(app).subscription) {
        const sub = dry ? { id: 'dry-run' } : await sb.createSubscription({
          membershipRef: steps(app).membership.ref, planTitle: app.plan, startDate: startInstant(start),
        });
        await record(app, deps, 'subscription', { ref: sub.id }, { spacebring_subscription_ref: sub.id });
      }
    }
  } catch (err) {
    return fail(app, deps, stepKey, err.message);
  }

  return { state: app.onboarding_state, mode };
}

// Runs on a schedule for every application still in progress. Reads
// Spacebring, records what has moved, and activates on payment.
async function sync(app, deps) {
  const sb = deps.sb;
  if (sb.mode() !== 'live' || app.onboarding_state !== 'in_progress') return { changed: false };
  let changed = false;
  let stepKey = 'contract_signed';
  try {
    if (isVO(app) && steps(app).contract && !steps(app).contract_signed) {
      const c = await sb.getContract(steps(app).contract.ref);
      if (c && c.subscriptionRef && c.subscriptionRef !== app.spacebring_subscription_ref) {
        await deps.store.save(app.id, { spacebring_subscription_ref: c.subscriptionRef });
        app.spacebring_subscription_ref = c.subscriptionRef;
      }
      if (c && c.status === 'signed') {
        await record(app, deps, 'contract_signed', { title: c.title || null });
        changed = true;
      } else if (c && (c.status === 'declined' || c.status === 'terminated')) {
        await fail(app, deps, 'contract_signed', `The agreement was ${c.status} or expired unsigned. Speak to the client, then issue a new one in Spacebring.`);
        return { changed: true };
      } else {
        return { changed };
      }
    }

    stepKey = 'invoice';
    const customerRef = app.spacebring_customer_ref;
    if (!customerRef) return { changed };
    if (!steps(app).paid) {
      const invoices = await sb.listInvoices(customerRef);
      const sub = app.spacebring_subscription_ref;
      const mine = invoices
        .filter(i => i.status !== 'voided' && i.status !== 'draft')
        .filter(i => !sub || !i.subscriptionRef || i.subscriptionRef === sub)
        .sort((a, b) => String(a.createDate).localeCompare(String(b.createDate)))[0];
      if (!mine) return { changed };

      if (!steps(app).invoice) {
        await record(app, deps, 'invoice', { ref: mine.id, title: mine.title || null, total: mine.totalAmount });
        changed = true;
      }
      if (mine.status === 'paid') {
        stepKey = 'paid';
        await record(app, deps, 'paid', { ref: mine.id });
        await activate(app, deps);
        changed = true;
      }
    }
  } catch (err) {
    // A read that failed is not a broken onboarding. Log it and try again on
    // the next run rather than raising an alarm for a network blip.
    await deps.store.log(app.id, 'onboarding:sync_failed', 'system', { step: stepKey, message: err.message });
  }
  return { changed };
}

// Paid: the membership is live. Tell the client, then the mail desk.
async function activate(app, deps) {
  const patch = { status: 'activated', onboarding_state: 'complete' };
  await deps.store.save(app.id, patch);
  Object.assign(app, patch);
  await deps.store.log(app.id, 'action:activate', 'system', { automatic: true });

  if (deps.mail && deps.mail.welcome && !steps(app).welcome) {
    const sent = await deps.mail.welcome(app);
    if (sent) await record(app, deps, 'welcome', {});
  }
  if (isVO(app) && deps.mail && deps.mail.mailDesk && !steps(app).mail_desk) {
    const sent = await deps.mail.mailDesk(app);
    if (sent) await record(app, deps, 'mail_desk', { to: sent });
  }
}

module.exports = { provision, sync, activate, stages, startDate, startInstant, needsRegisteredAddress, isVO };
