const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../netlify/functions/_desk');
const T = require('../netlify/functions/_emails');
const L = require('../netlify/functions/_lib');
const O = require('../netlify/functions/_onboarding');
const SB = require('../netlify/functions/_spacebring');
const F = require('../netlify/functions/_desk_followup');
const S = require('../netlify/functions/submit-desk');

const NOW = new Date('2026-11-27T08:00:00Z'); // 10:00 SAST, a Friday

function good(over) {
  return {
    plan: 'Village Local', first_name: 'Thandi', last_name: 'Mokoena',
    email: 'Thandi@Example.co.za', phone: '082 123 4567',
    terms_accepted: true, popia_consent: true, ...over,
  };
}

// A stand-in for the database, the inbox and Spacebring.
function io(opts) {
  const o = opts || {};
  const rows = o.rows ? o.rows.slice() : [];
  const sent = [];
  const events = [];
  const provisioned = [];
  let n = 0;
  const api = {
    now: () => o.now || NOW,
    wait: async () => {},
    async select(table, query) {
      if (o.selectFails) throw new Error('db down');
      if (/created_at=gte/.test(query) && /plan=eq/.test(query)) return o.duplicate ? [o.duplicate] : [];
      if (/created_at=gte/.test(query)) return o.recent || [];
      return rows;
    },
    async insert(table, row) {
      if (o.insertFails) throw new Error('insert refused');
      const app = { id: 'app-' + (++n), reference: 'DK-2026-00' + (40 + n), status: 'submitted', created_at: (o.now || NOW).toISOString(), ...row };
      rows.push(app);
      return app;
    },
    async update(table, filter, patch) { const r = rows[rows.length - 1]; if (r) Object.assign(r, patch); return [r]; },
    async log(id, type, actor, detail) { events.push([type, detail]); },
    async send(args) {
      sent.push(args);
      const toStaff = Array.isArray(args.to);
      if (o.failStaff && toStaff && args.to.length > 1) return { error: 'resend 500' };
      if (o.failAll) return { error: 'resend 500' };
      if (o.failPerson && !toStaff) return { error: 'bad address' };
      if (o.skipped) return { skipped: true };
      return { id: 'email-' + sent.length };
    },
    async mirror() { events.push(['mirror', null]); return true; },
    staffEmails: ['marius@brick-field.co.za', 'christel@villagehub.co.za', 'francois@brick-field.co.za'],
    notifyEmail: 'hello@villagehub.co.za',
    siteUrl: 'https://www.villagehub.co.za',
    provisioning: {
      mode: () => o.mode || 'off',
      credentialsSet: () => o.credentials !== false,
      planMapped: (plan) => SB.PLAN_REFS[plan],
      async provision(app) { provisioned.push(app.plan); if (o.provisionThrows) throw new Error('spacebring down'); return { state: 'in_progress' }; },
    },
  };
  return { api, rows, sent, events, provisioned };
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

test('offer prices: 50% on the monthly desks, 30% on the passes, VAT at 15%', () => {
  const at = new Date('2026-11-27T08:00:00Z');
  assert.deepEqual(
    D.PLAN_TITLES.map(p => [p, D.offer(p, at).price, D.offer(p, at).priceInclVat, D.offer(p, at).percentOff]),
    [
      ['Village Wanderer', 700, 805, 30],
      ['Village Visitor', 1120, 1288, 30],
      ['Village Local', 1500, 1725, 50],
      ['Village Resident', 1750, 2012.5, 50],
    ]);
  for (const p of D.PLAN_TITLES) assert.equal(D.offer(p, at).months, 12);
});

test('the ladder holds: more access always costs more', () => {
  const price = p => D.offer(p, NOW).price;
  assert.ok(price('Village Wanderer') < price('Village Visitor'));
  assert.ok(price('Village Visitor') < price('Village Local'));
  assert.ok(price('Village Local') < price('Village Resident'));
});

test('the offer ends at midnight South African time on 31 December', () => {
  assert.equal(D.offer('Village Local', new Date('2026-12-31T21:59:00Z')).price, 1500); // 23:59 SAST
  assert.equal(D.offer('Village Local', new Date('2026-12-31T22:00:00Z')).price, 3000); // 00:00 SAST, 1 Jan
  assert.equal(D.offer('Village Local', new Date('2026-12-31T22:00:00Z')).code, null);
});

test('money is written the way the site writes it', () => {
  assert.equal(D.rand(700), 'R700');
  assert.equal(D.rand(1750), 'R1,750');
  assert.equal(D.rand(2012.5), 'R2,012.50');
});

test('the sign-up page shows exactly the prices the server charges', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apply-desk.html'), 'utf8');
  const block = html.slice(html.indexOf('var PLANS = {'), html.indexOf('var ALIASES'));
  for (const title of D.PLAN_TITLES) {
    const o = D.offer(title, NOW);
    const m = new RegExp(`'${title}':\\s*\\{[^}]*list: (\\d+), price: (\\d+),\\s*percentOff: (\\d+)`).exec(block);
    assert.ok(m, `${title} is missing from the page`);
    assert.deepEqual([Number(m[1]), Number(m[2]), Number(m[3])], [o.list, o.price, o.percentOff], title);
    // The card a person reads, not only the script.
    const card = html.slice(html.indexOf(`data-plan="${title}"`), html.indexOf('</label>', html.indexOf(`data-plan="${title}"`)));
    assert.ok(card.includes(`>${D.rand(o.price)}<`), `${title} card price`);
    assert.ok(card.includes(`<s>${D.rand(o.list)}</s>`), `${title} card list price`);
  }
  assert.ok(!/—/.test(html), 'no em dashes on the page');
});

test('every plan the form offers is one the server accepts, and the reverse', () => {
  assert.deepEqual(L.PLANS.desk.slice().sort(), D.PLAN_TITLES.slice().sort());
  assert.deepEqual(L.REQUIRED_DOCS.desk, []);
});

// ---------------------------------------------------------------------------
// Checking a sign-up
// ---------------------------------------------------------------------------

test('a complete sign-up is accepted and tidied', () => {
  const { row, error } = D.parse(good({ company_name: '  Mokoena Design  ', preferred_start_date: '2026-12-01' }), NOW);
  assert.equal(error, undefined);
  assert.equal(row.type, 'desk');
  assert.equal(row.email, 'thandi@example.co.za');
  assert.equal(row.company_name, 'Mokoena Design');
  assert.equal(row.preferred_start_date, '2026-12-01');
  assert.equal(row.popia_consent_version, '2026-11-desk');
});

test('each missing or wrong field is refused with a sentence a person can act on', () => {
  const cases = [
    [{ plan: 'Village Penthouse' }, /four desk plans/],
    [{ plan: undefined }, /four desk plans/],
    [{ first_name: ' ' }, /first and last name/],
    [{ last_name: '' }, /first and last name/],
    [{ email: 'thandi@example' }, /valid email/],
    [{ email: 'not an email' }, /valid email/],
    [{ phone: '12345' }, /contact number/],
    [{ phone: undefined }, /contact number/],
    [{ popia_consent: false }, /tick the box/],
    [{ popia_consent: 'true' }, /tick the box/],
    [{ terms_accepted: false }, /accept the membership terms/],
  ];
  for (const [over, re] of cases) {
    const r = D.parse(good(over), NOW);
    assert.match(r.error || '', re, JSON.stringify(over));
    assert.equal(r.row, undefined);
  }
  assert.match(D.parse(null, NOW).error, /four desk plans/);
});

test('phone numbers people really type are accepted', () => {
  for (const p of ['082 123 4567', '+27 82 123 4567', '27821234567', '(082) 123-4567', '+44 20 7946 0958']) {
    assert.equal(D.validPhone(p), true, p);
  }
  for (const p of ['', '123', 'call me', '1'.repeat(16)]) assert.equal(D.validPhone(p), false, p);
});

test('a start date that cannot be used becomes "as soon as possible", never an error', () => {
  assert.equal(D.startDate('2026-11-27', NOW), '2026-11-27'); // today
  assert.equal(D.startDate('2026-11-26', NOW), null);         // yesterday
  assert.equal(D.startDate('2026-02-31', NOW), null);         // not a date
  assert.equal(D.startDate('2028-01-01', NOW), null);         // too far out
  assert.equal(D.startDate('01/12/2026', NOW), null);         // wrong shape
  assert.equal(D.startDate('', NOW), null);
  // 23:30 SAST on the 27th is still the 27th in South Africa.
  assert.equal(D.startDate('2026-11-27', new Date('2026-11-27T21:30:00Z')), '2026-11-27');
});

test('long and hostile input is cut down and never reaches the database raw', () => {
  const { row } = D.parse(good({ first_name: 'A'.repeat(500), company_name: 'Line1\nLine2\u0000', utm: ['not', 'an', 'object'] }), NOW);
  assert.equal(row.first_name.length, 80);
  assert.equal(row.company_name, 'Line1 Line2');
  assert.equal(row.utm, null);
});

// ---------------------------------------------------------------------------
// The whole sign-up
// ---------------------------------------------------------------------------

test('a sign-up is saved, accepted, and both emails go out, once', async () => {
  const f = io();
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 200);
  assert.match(r.body.reference, /^DK-2026-/);
  assert.equal(r.body.price, 1500);
  assert.equal(r.body.email_sent, true);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, 'approved');
  assert.ok(f.rows[0].notified_at);
  assert.equal(f.sent.length, 2);
  const person = f.sent.find(m => m.to === 'thandi@example.co.za');
  const staff = f.sent.find(m => Array.isArray(m.to));
  assert.equal(person.client, true); // blind-copied to the Hub inbox
  assert.match(person.subject, /You are signed up: Village Local/);
  assert.deepEqual(staff.to, ['marius@brick-field.co.za', 'christel@villagehub.co.za', 'francois@brick-field.co.za']);
  assert.equal(staff.replyTo, 'thandi@example.co.za');
  assert.ok(f.events.some(e => e[0] === 'auto_accepted'));
  assert.ok(f.events.some(e => e[0] === 'mirror'));
});

test('Francois is on the default team list for every alert', () => {
  assert.ok(L.STAFF_EMAILS.includes('francois@brick-field.co.za'));
  assert.ok(L.STAFF_EMAILS.includes('marius@brick-field.co.za'));
  assert.ok(L.STAFF_EMAILS.includes('christel@villagehub.co.za'));
});

test('a refused sign-up saves nothing and sends nothing', async () => {
  const f = io();
  const r = await S.run(good({ email: 'nope' }), f.api);
  assert.equal(r.status, 400);
  assert.equal(f.rows.length, 0);
  assert.equal(f.sent.length, 0);
});

test('a script that fills the hidden field gets a polite nothing', async () => {
  const f = io();
  const r = await S.run(good({ website_url: 'http://spam.example' }), f.api);
  assert.equal(r.status, 200);
  assert.equal(f.rows.length, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.events.length, 0);
});

test('pressing the button twice gives the same reference and no second email', async () => {
  const f = io({ duplicate: { id: 'app-9', reference: 'DK-2026-0031', plan: 'Village Local' } });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 200);
  assert.equal(r.body.reference, 'DK-2026-0031');
  assert.equal(r.body.already_received, true);
  assert.equal(f.rows.length, 0);
  assert.equal(f.sent.length, 0);
});

test('a fourth sign-up in an hour from one address is turned away', async () => {
  const f = io({ recent: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 429);
  assert.equal(f.rows.length, 0);
});

test('if the duplicate check itself fails, the sign-up still goes through', async () => {
  const f = io({ selectFails: true });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 200);
  assert.equal(f.rows.length, 1);
});

test('if the save fails the person is told and nobody is emailed', async () => {
  const f = io({ insertFails: true });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 500);
  assert.match(r.body.error, /could not save/);
  assert.equal(f.sent.length, 0);
});

test('a failed team alert is retried, then sent to the shared inbox on its own', async () => {
  const f = io({ failStaff: true });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 200);
  const staffTries = f.sent.filter(m => Array.isArray(m.to) && m.to.length > 1);
  assert.equal(staffTries.length, 2); // first try and one retry
  const fallback = f.sent.filter(m => Array.isArray(m.to) && m.to.length === 1);
  assert.deepEqual(fallback[0].to, ['hello@villagehub.co.za']);
  const sentLog = f.events.find(e => e[0] === 'emails_sent')[1];
  assert.equal(sentLog.staff, true);
});

test('when every email fails the sign-up is still saved and the failure is on record', async () => {
  const f = io({ failAll: true });
  const r = await S.run(good(), f.api);
  assert.equal(r.status, 200);
  assert.equal(r.body.email_sent, false);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].notified_at, undefined);
  assert.ok(f.events.some(e => e[0] === 'email_failed'));
});

test('a bad confirmation address does not stop the team hearing about it', async () => {
  const f = io({ failPerson: true });
  const r = await S.run(good(), f.api);
  assert.equal(r.body.email_sent, false);
  assert.equal(f.events.find(e => e[0] === 'emails_sent')[1].staff, true);
});

test('with the automation off nothing is sent to Spacebring', async () => {
  const f = io({ mode: 'off' });
  await S.run(good({ plan: 'Village Wanderer' }), f.api);
  assert.deepEqual(f.provisioned, []);
});

test('with the automation live a pass is set up in Spacebring straight away', async () => {
  const f = io({ mode: 'live' });
  const r = await S.run(good({ plan: 'Village Visitor' }), f.api);
  assert.deepEqual(f.provisioned, ['Village Visitor']);
  assert.equal(r.body.automated, true);
  const staff = f.sent.find(m => Array.isArray(m.to));
  assert.match(staff.html, /Nothing to do yet/);
});

test('the two monthly desks stay manual even when the automation is live', async () => {
  for (const plan of ['Village Local', 'Village Resident']) {
    const f = io({ mode: 'live' });
    const r = await S.run(good({ plan }), f.api);
    assert.deepEqual(f.provisioned, [], plan);
    assert.equal(r.body.automated, false);
    const staff = f.sent.find(m => Array.isArray(m.to));
    assert.match(staff.html, /Apply promo code <strong>DESK50<\/strong>/);
    assert.match(staff.html, /Mark as activated/);
  }
});

test('a Spacebring failure never turns a saved sign-up into an error', async () => {
  const f = io({ mode: 'live', provisionThrows: true });
  const r = await S.run(good({ plan: 'Village Wanderer' }), f.api);
  assert.equal(r.status, 200);
  assert.equal(f.rows.length, 1);
});

test('sendTwice retries once and reports honestly', async () => {
  let n = 0;
  const flaky = async () => (++n === 1 ? { error: 'blip' } : { id: 'ok' });
  assert.deepEqual(await S.sendTwice(flaky, {}, async () => {}), { ok: true, skipped: false, error: null });
  assert.equal(n, 2);
  assert.equal((await S.sendTwice(async () => ({ skipped: true }), {}, async () => {})).ok, false);
  assert.equal((await S.sendTwice(async () => ({ error: 'dead' }), {}, async () => {})).error, 'dead');
});

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

function deskApp(over) {
  return {
    id: 'app-1', reference: 'DK-2026-0041', type: 'desk', plan: 'Village Wanderer', status: 'approved',
    first_name: 'Thandi', last_name: 'Mokoena', email: 'thandi@example.co.za', phone: '082 123 4567',
    company_name: null, preferred_start_date: null, created_at: '2026-11-25T08:00:00Z',
    onboarding: null, onboarding_state: null, ...over,
  };
}

test('the confirmation states the plan, both prices, the saving and what happens next', () => {
  const app = deskApp();
  const m = T.deskReceived(app, D.offer(app.plan, NOW));
  assert.match(m.html, /R700 a month<\/strong> excl\. VAT \(R805 incl\. VAT\)/);
  assert.match(m.html, /30% off the normal R1,000 for your first 12 months/);
  assert.match(m.html, /No minimum commitment/);
  assert.match(m.html, /Nothing is payable before it arrives/);
  assert.match(m.html, /DK-2026-0041/);
});

test('a pass member is told how to book and that the booking sends the Wi-Fi code', () => {
  const m = T.activated(deskApp({ plan: 'Village Visitor' }));
  assert.match(m.subject, /Welcome to The Village Hub/);
  assert.match(m.html, /10 desk days a month/);
  assert.match(m.html, /members\.villagehub\.co\.za/);
  assert.match(m.html, /Choose <strong>Desks<\/strong>/);
  assert.match(m.html, /The Village Hub Guest/);
  assert.match(m.html, /No booking means no Wi-Fi code/);
  assert.doesNotMatch(m.html, /student card/i);
});

test('a monthly member is told the Wi-Fi code comes separately and there is nothing to book', () => {
  for (const plan of ['Village Local', 'Village Resident']) {
    const m = T.activated(deskApp({ plan }));
    assert.match(m.html, /nothing to book day by day/);
    assert.match(m.html, /member Wi-Fi code separately/);
    assert.doesNotMatch(m.html, /No booking means no Wi-Fi code/);
  }
  assert.match(T.activated(deskApp({ plan: 'Village Resident' })).html, /your own dedicated desk/);
});

test('the welcome says access follows payment and never promises a minimum term', () => {
  const m = T.activated(deskApp());
  assert.match(m.html, /Payment received/);
  assert.match(m.html, /door access is being switched on now that your payment is in/);
  assert.match(m.html, /no minimum commitment/i);
});

test('the paid alert tells the team exactly what to do, by plan', () => {
  const pass = T.deskPaid(deskApp(), D.offer('Village Wanderer', NOW), 'https://x/admin');
  assert.match(pass.subject, /^New member paid: Thandi Mokoena, Village Wanderer/);
  assert.match(pass.html, /Switch on their door access/);
  assert.match(pass.html, /A code goes out automatically with each desk booking/);
  const res = T.deskPaid(deskApp({ plan: 'Village Resident' }), D.offer('Village Resident', NOW), 'https://x/admin');
  assert.match(res.html, /send Thandi the member Wi-Fi code today/);
  assert.match(res.html, /Allocate their dedicated desk/);
});

test('nothing a person types can inject markup into an email', () => {
  const app = deskApp({ first_name: '<img src=x onerror=1>', last_name: '"><b>', company_name: '<script>x</script>' });
  const o = D.offer(app.plan, NOW);
  for (const m of [T.deskReceived(app, o), T.deskStaffAlert(app, o, 'https://x'), T.activated(app), T.deskPaid(app, o, 'https://x'), T.deskReminder(app, o), T.deskStalled(app, o, 'https://x', 48)]) {
    assert.doesNotMatch(m.html, /<img src=x|<script>x|"><b>/);
  }
});

test('no desk email contains an em dash', () => {
  const app = deskApp({ plan: 'Village Resident' });
  const o = D.offer(app.plan, NOW);
  for (const m of [T.deskReceived(app, o), T.deskStaffAlert(app, o, 'u'), T.deskStaffAlert(app, o, 'u', { automated: true }), T.activated(app), T.deskPaid(app, o, 'u'), T.deskReminder(app, o), T.deskStalled(app, o, 'u', 48)]) {
    assert.doesNotMatch(m.subject + m.html, /—/);
  }
});

// ---------------------------------------------------------------------------
// Spacebring set-up and activation
// ---------------------------------------------------------------------------

function sbFakes(opts) {
  const o = opts || {};
  const calls = [];
  const sent = [];
  const deps = {
    sb: {
      mode: () => o.mode || 'live',
      credentialsSet: () => true,
      PLAN_REFS: SB.PLAN_REFS,
      async createMembership(x) { calls.push(['membership', x]); if (o.memberFails) throw new Error('email exists'); return { id: 'mem-1' }; },
      async createSubscription(x) { calls.push(['subscription', x]); return { id: 'sub-1' }; },
      async listInvoices() { calls.push(['invoices']); return o.invoices || []; },
    },
    now: () => NOW,
    store: { async save() {}, async log() {} },
    couponRef: (app) => (app.type === 'desk' ? 'coupon-30' : null),
    mail: {
      async welcome(app) { sent.push(['welcome', app.email]); return true; },
      async paidAlert(app) { sent.push(['paidAlert', app.reference]); return ['team@x']; },
      async mailDesk() { sent.push(['mailDesk']); return ['desk@x']; },
      async attention(app, step) { sent.push(['attention', step]); },
    },
  };
  return { deps, calls, sent };
}

test('a pass is set up as member then subscription, with the coupon granted', async () => {
  const f = sbFakes();
  const app = deskApp();
  const r = await O.provision(app, 'desk sign-up (automatic)', f.deps);
  assert.deepEqual(f.calls.map(c => c[0]), ['membership', 'subscription']);
  assert.equal(r.state, 'in_progress');
  assert.equal(f.calls[1][1].planTitle, 'Village Wanderer');
  assert.equal(f.calls[1][1].couponRef, 'coupon-30');
  assert.match(f.calls[0][1].notes, /Door access only after the first invoice is paid/);
  assert.doesNotMatch(f.calls[0][1].notes, /Student/);
  assert.equal(app.spacebring_subscription_ref, 'sub-1');
});

test('the real Spacebring call puts the coupon on the plan item', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', '_spacebring.js'), 'utf8');
  assert.match(src, /grantedDiscounts: \[\{ coupon: \{ id: couponRef \} \}\]/);
  assert.ok(SB.PLAN_REFS['Village Wanderer'] && SB.PLAN_REFS['Village Visitor']);
  assert.equal(SB.PLAN_REFS['Village Local'], undefined);
  assert.equal(SB.PLAN_REFS['Village Resident'], undefined);
});

test('a member who already exists stops the set-up and the team is told', async () => {
  const f = sbFakes({ memberFails: true });
  const app = deskApp();
  const r = await O.provision(app, 'auto', f.deps);
  assert.equal(r.state, 'needs_attention');
  assert.deepEqual(f.sent, [['attention', 'membership']]);
});

test('payment activates the member, sends the welcome and tells the team, once each', async () => {
  const f = sbFakes({ invoices: [{ id: 'inv-1', status: 'paid', createDate: '2026-11-26', subscriptionRef: 'sub-1' }] });
  const app = deskApp({ onboarding_state: 'in_progress', spacebring_customer_ref: 'mem-1', spacebring_subscription_ref: 'sub-1',
    onboarding: { mode: 'live', steps: { membership: { ref: 'mem-1' }, subscription: { ref: 'sub-1' } } } });
  await O.sync(app, f.deps);
  assert.equal(app.status, 'activated');
  assert.deepEqual(f.sent, [['welcome', 'thandi@example.co.za'], ['paidAlert', 'DK-2026-0041']]);
  // A second run changes nothing and sends nothing.
  app.onboarding_state = 'in_progress';
  await O.activate(app, f.deps);
  assert.equal(f.sent.length, 2);
});

test('an unpaid invoice activates nothing', async () => {
  const f = sbFakes({ invoices: [{ id: 'inv-1', status: 'issued', createDate: '2026-11-26', subscriptionRef: 'sub-1' }] });
  const app = deskApp({ onboarding_state: 'in_progress', spacebring_customer_ref: 'mem-1', spacebring_subscription_ref: 'sub-1',
    onboarding: { mode: 'live', steps: { membership: { ref: 'mem-1' }, subscription: { ref: 'sub-1' } } } });
  await O.sync(app, f.deps);
  assert.equal(app.status, 'approved');
  assert.deepEqual(f.sent, []);
});

test('the staff progress bar for a desk has no document or agreement steps', () => {
  const keys = O.stages(deskApp(), []).stages.map(s => s.key);
  assert.deepEqual(keys, ['received', 'approved', 'account', 'invoice', 'paid']);
  assert.equal(O.stages(deskApp(), []).stages[1].label, 'Accepted');
});

test('virtual office and student flows are untouched by the desk type', () => {
  assert.equal(O.isDesk({ type: 'virtual_office' }), false);
  assert.equal(O.isDesk({ type: 'student' }), false);
  const student = T.activated({ type: 'student', plan: 'Student 5-Day', reference: 'ST-1', first_name: 'A' });
  assert.match(student.html, /student card/);
});

// ---------------------------------------------------------------------------
// The 48-hour follow-up
// ---------------------------------------------------------------------------

function followIo(apps, now) {
  const sent = []; const saved = []; const events = [];
  return {
    sent, saved, events,
    api: {
      now: () => now,
      async select() { return apps; },
      async save(id, patch) { saved.push([id, patch]); const a = apps.find(x => x.id === id); if (a) Object.assign(a, patch); },
      async log(id, type, actor, detail) { events.push([type, detail]); },
      async send(args) { sent.push(args); return { id: 'e' }; },
      staffEmails: ['marius@brick-field.co.za', 'christel@villagehub.co.za', 'francois@brick-field.co.za'],
      notifyEmail: 'hello@villagehub.co.za',
      siteUrl: 'https://www.villagehub.co.za',
    },
  };
}

test('a sign-up not live after 48 hours gets one reminder and one team alert', async () => {
  const apps = [deskApp({ created_at: '2026-11-25T07:00:00Z' })]; // 49 hours before NOW
  const f = followIo(apps, NOW);
  const r = await F.run(f.api);
  assert.equal(r.sent, 1);
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[0].subject, /is waiting/);
  assert.match(f.sent[1].subject, /not live after 49 hours/);
  assert.equal(f.sent[1].to.length, 3);
  // Next run, 15 minutes later: nothing more.
  const again = await F.run(f.api);
  assert.equal(again.sent, 0);
  assert.equal(f.sent.length, 2);
});

test('the follow-up leaves alone anything young, live, old or not a desk', () => {
  assert.equal(F.due(deskApp({ created_at: '2026-11-26T08:00:00Z' }), NOW), false); // 24 hours
  assert.equal(F.due(deskApp({ created_at: '2026-11-25T07:00:00Z', status: 'activated' }), NOW), false);
  assert.equal(F.due(deskApp({ created_at: '2026-11-01T07:00:00Z' }), NOW), false); // over 14 days
  assert.equal(F.due(deskApp({ created_at: '2026-11-25T07:00:00Z', type: 'student' }), NOW), false);
  assert.equal(F.due(deskApp({ created_at: '2026-11-25T07:00:00Z' }), NOW), true);
});

test('no reminder goes out at night', async () => {
  const night = new Date('2026-11-27T23:00:00Z'); // 01:00 SAST
  const f = followIo([deskApp({ created_at: '2026-11-25T07:00:00Z' })], night);
  const r = await F.run(f.api);
  assert.equal(r.sent, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(F.inOfficeHours(new Date('2026-11-27T06:00:00Z')), true);  // 08:00 SAST
  assert.equal(F.inOfficeHours(new Date('2026-11-27T16:00:00Z')), false); // 18:00 SAST
});

test('the reminder is recorded before it is sent, so a crash cannot repeat it', async () => {
  const apps = [deskApp({ created_at: '2026-11-25T07:00:00Z' })];
  const f = followIo(apps, NOW);
  f.api.send = async () => { throw new Error('resend down'); };
  await F.run(f.api);
  assert.equal(f.saved.length, 1);
  assert.ok(apps[0].onboarding.steps.desk_followup);
  f.api.send = async (a) => { f.sent.push(a); return { id: 'e' }; };
  await F.run(f.api);
  assert.equal(f.sent.length, 0);
});
