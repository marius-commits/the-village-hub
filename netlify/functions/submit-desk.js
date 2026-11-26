// POST /.netlify/functions/submit-desk
//
// One call, start to finish. A desk sign-up has no documents, so there is no
// second phase that a closed browser tab could leave undone: by the time this
// returns, the sign-up is saved, the person has their confirmation and the
// team has been told.
//
// Order matters. The row is saved first and nothing after that can lose it.
// Every later step (emails, CRM mirror, Spacebring set-up) records its own
// failure and never turns a saved sign-up into an error for the person.

const L  = require('./_lib');
const T  = require('./_emails');
const D  = require('./_desk');
const SB = require('./_spacebring');
const O  = require('./_onboarding');
const Live = require('./_onboarding_live');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One retry. A sign-up that nobody hears about is the failure this system
// exists to prevent, and most email failures are a blip.
async function sendTwice(send, args, wait) {
  let r = await send(args);
  if (r && r.error) {
    await (wait || sleep)(700);
    r = await send(args);
  }
  return { ok: Boolean(r) && !r.error && !r.skipped, skipped: Boolean(r && r.skipped), error: (r && r.error) || null };
}

// Mirror into Zoho so the CRM pipeline sees it. Never blocks the sign-up.
async function mirrorToZoho(app, o, fetchFn) {
  try {
    const body = new URLSearchParams({
      xnQsjsdp: '3bab74f7e8aba6be99b9d1863cff751310a973b2c6f80cb471b7a4eede332658',
      xmIwtLD: 'bdb9fc7c567f2c2566b234583069f587376dc60a5539756d51c3e410227569ad393d23a4d15100a62a79b7c7a7284819',
      actionType: 'TGVhZHM=',
      returnURL: 'https://www.villagehub.co.za/',
      'First Name': app.first_name,
      'Last Name':  app.last_name,
      Email:        app.email,
      Phone:        app.phone,
      Company:      app.company_name || '',
      'Lead Source': 'Website - Application Form',
      Description: [
        `Plan Interest: ${app.plan}`,
        `Desk sign-up reference: ${app.reference}`,
        `Price: ${D.rand(o.price)} a month excl. VAT${o.discounted ? ` (${o.percentOff}% off for ${o.months} months)` : ''}`,
        app.preferred_start_date ? `Preferred start: ${app.preferred_start_date}` : '',
        'Signed up through the desk sign-up form. No documents required.',
      ].filter(Boolean).join('\n'),
    });
    await (fetchFn || fetch)('https://crm.zoho.com/crm/WebToLeadForm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    return true;
  } catch (err) {
    console.error('Zoho mirror failed (non-blocking):', err.message);
    return false;
  }
}

// The whole flow with its outside world passed in, so it can be tested
// without a database, an inbox or Spacebring.
async function run(payload, io) {
  const now = io.now();

  // A filled honeypot gets a plausible success and nothing else: no row, no
  // email, and no hint to the script that it was caught.
  if (D.looksAutomated(payload)) return { status: 200, body: { reference: 'DK-0000', accepted: true } };

  const parsed = D.parse(payload, now);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const row = parsed.row;

  // The same person pressing the button twice, or a retry after a slow
  // response, gets the reference they already have and no second email.
  try {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const dupes = await io.select('applications',
      `type=eq.desk&email=eq.${encodeURIComponent(row.email)}&plan=eq.${encodeURIComponent(row.plan)}&created_at=gte.${tenMinutesAgo}&select=id,reference,plan&order=created_at.desc&limit=1`);
    if (dupes && dupes.length) {
      return { status: 200, body: { reference: dupes[0].reference, plan: dupes[0].plan, already_received: true } };
    }
    const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
    const recent = await io.select('applications',
      `email=eq.${encodeURIComponent(row.email)}&created_at=gte.${hourAgo}&select=id`);
    if (recent && recent.length >= 3) {
      return { status: 429, body: { error: 'You have signed up a few times just now. WhatsApp us on 063 260 3513 and we will sort it out.' } };
    }
  } catch (err) {
    console.error('duplicate check failed, allowing through:', err.message);
  }

  // 1. Save. If this fails the person is told plainly and nothing was sent.
  let app;
  try {
    app = await io.insert('applications', row);
  } catch (err) {
    console.error('submit-desk insert failed:', err.message);
    return { status: 500, body: { error: 'We could not save your sign-up. Please try again, or WhatsApp us on 063 260 3513.' } };
  }
  await io.log(app.id, 'submitted', 'applicant', { plan: app.plan, type: 'desk' });

  // 2. Accepted on arrival: there is nothing to review for a desk.
  try {
    const patch = { status: 'approved', reviewed_at: now.toISOString() };
    await io.update('applications', `id=eq.${app.id}`, patch);
    Object.assign(app, patch);
    await io.log(app.id, 'auto_accepted', 'system', { reason: 'desk sign-ups need no review' });
  } catch (err) {
    console.error('submit-desk accept failed:', err.message);
  }

  const o = D.offer(app.plan, now);
  const automated = io.provisioning.mode() === 'live'
    && Boolean(io.provisioning.planMapped(app.plan))
    && io.provisioning.credentialsSet();
  const reviewUrl = `${io.siteUrl}/admin/applications?ref=${encodeURIComponent(app.reference)}`;

  // 3. Tell the person and tell the team. Independent of each other.
  const toPerson = T.deskReceived(app, o, { automated });
  const toStaff  = T.deskStaffAlert(app, o, reviewUrl, { automated });
  const [person, staff] = await Promise.all([
    sendTwice(io.send, { to: app.email, subject: toPerson.subject, html: toPerson.html, replyTo: io.notifyEmail, client: true }, io.wait),
    sendTwice(io.send, { to: io.staffEmails, subject: toStaff.subject, html: toStaff.html, replyTo: app.email }, io.wait),
  ]);

  // The team alert is the one that must not be lost. If it failed twice, try
  // the shared inbox on its own before giving up.
  let staffTold = staff.ok;
  if (!staffTold && !staff.skipped) {
    const last = await sendTwice(io.send, { to: [io.notifyEmail], subject: toStaff.subject, html: toStaff.html, replyTo: app.email }, io.wait);
    staffTold = last.ok;
  }

  try {
    if (person.ok) await io.update('applications', `id=eq.${app.id}`, { notified_at: now.toISOString() });
  } catch (err) { console.error('submit-desk notified_at failed:', err.message); }
  await io.log(app.id, 'emails_sent', 'system', { applicant: person.ok, staff: staffTold, staff_to: io.staffEmails });
  if (!person.ok || !staffTold) {
    await io.log(app.id, 'email_failed', 'system', {
      applicant: person.ok ? null : (person.error || 'not sent'),
      staff: staffTold ? null : (staff.error || 'not sent'),
    });
  }

  // 4. CRM mirror, then Spacebring. Neither can undo the sign-up.
  await io.mirror(app, o);

  let onboarding = null;
  if (io.provisioning.mode() !== 'off' && io.provisioning.planMapped(app.plan)) {
    try { onboarding = await io.provisioning.provision(app); }
    catch (err) { console.error('submit-desk provision failed:', err.message); }
  }

  return {
    status: 200,
    body: {
      reference: app.reference,
      plan: app.plan,
      price: o.price,
      price_incl_vat: o.priceInclVat,
      email_sent: person.ok,
      automated,
      onboarding_state: (onboarding && onboarding.state) || null,
    },
  };
}

function liveIo() {
  return {
    now: () => new Date(),
    wait: sleep,
    select: (table, query) => L.selectRows(table, query),
    insert: (table, row) => L.insertRow(table, row),
    update: (table, filter, patch) => L.updateRows(table, filter, patch),
    log: (id, type, actor, detail) => L.logEvent(id, type, actor, detail),
    send: (args) => L.sendEmail(args),
    mirror: (app, o) => mirrorToZoho(app, o),
    staffEmails: L.STAFF_EMAILS,
    notifyEmail: L.NOTIFY_EMAIL,
    siteUrl: L.SITE_URL,
    provisioning: {
      mode: () => SB.mode(),
      credentialsSet: () => SB.credentialsSet(),
      planMapped: (plan) => SB.PLAN_REFS[plan],
      provision: (app) => O.provision(app, 'desk sign-up (automatic)', Live.deps()),
    },
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return L.bad('Sign-ups are temporarily unavailable. Please WhatsApp us on 063 260 3513.', 503);
  }
  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }

  try {
    const result = await run(payload, liveIo());
    return { statusCode: result.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.body) };
  } catch (err) {
    console.error('submit-desk failed:', err.message);
    return L.bad('Something went wrong on our side. Please WhatsApp us on 063 260 3513.', 500);
  }
};

exports.run = run;
exports.sendTwice = sendTwice;
exports.mirrorToZoho = mirrorToZoho;
