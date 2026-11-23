const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../netlify/functions/_onboarding');
const T = require('../netlify/functions/_emails');
const L = require('../netlify/functions/_lib');

const NOW = new Date('2026-11-23T08:00:00Z'); // 10:00 SAST

function voApp(over) {
  return {
    id: 'app-1', reference: 'VO-2026-0099', type: 'virtual_office', plan: 'Village Address', status: 'approved',
    first_name: 'Test', last_name: 'Director', email: 'director@example.co.za', phone: '0600000000',
    company_name: 'Example Trading (Pty) Ltd', company_trading_name: 'Example Trading',
    cipc_registration_number: '2020/000000/07', vat_number: null, wants_registered_address: false,
    preferred_start_date: null, created_at: '2026-11-22T10:00:00Z', reviewed_at: '2026-11-23T08:00:00Z',
    onboarding: null, onboarding_state: null, ...over,
  };
}

function fakes(opts) {
  const o = opts || {};
  const calls = [];
  const sent = [];
  const sb = {
    mode: () => o.mode || 'live',
    credentialsSet: () => o.credentials !== false,
    PLAN_REFS: { 'Village Address': { id: 'p1', period: 'month' }, 'Village Virtual Pro': { id: 'p3', period: 'month' }, 'Student 5-Day': { id: 's1', period: 'month' } },
    TEMPLATE_VO: 'tpl' in o ? o.tpl : 'tpl-standard',
    TEMPLATE_VO_REGISTERED: 'tplReg' in o ? o.tplReg : 'tpl-registered',
    async createCompany(x) { calls.push(['company', x]); if (o.failAt === 'company') throw new Error('boom'); return { id: 'co-1' }; },
    async createMembership(x) { calls.push(['membership', x]); if (o.failAt === 'membership') throw new Error('email exists'); return { id: 'mem-1' }; },
    async createContract(x) { calls.push(['contract', x]); if (o.failAt === 'contract') throw new Error('bad template'); return { id: 'con-1', title: 'CON-1' }; },
    async issueContract(id) { calls.push(['issue', id]); return { id, title: 'CON-1', subscriptionRef: 'sub-1' }; },
    async createSubscription(x) { calls.push(['subscription', x]); return { id: 'sub-9' }; },
    async getContract() { return o.contract || { status: 'issued' }; },
    async listInvoices() { return o.invoices || []; },
  };
  const deps = {
    sb, now: () => NOW,
    store: { async save() {}, async log() {} },
    mail: {
      async welcome(app) { sent.push(['welcome', app.email]); return true; },
      async mailDesk(app) { sent.push(['mailDesk', app.company_name]); return ['desk@example.co.za']; },
      async attention(app, step) { sent.push(['attention', step]); },
    },
  };
  return { deps, calls, sent };
}

test('off mode does nothing at all', async () => {
  const f = fakes({ mode: 'off' });
  const app = voApp();
  const r = await O.provision(app, 'staff@x', f.deps);
  assert.equal(r.skipped, 'off');
  assert.equal(f.calls.length, 0);
  assert.equal(app.onboarding_state, null);
});

test('dry mode records the steps but calls nothing in Spacebring', async () => {
  const f = fakes({ mode: 'dry' });
  const app = voApp();
  await O.provision(app, 'staff@x', f.deps);
  assert.equal(f.calls.length, 0);
  assert.equal(app.onboarding_state, 'dry_run');
  assert.ok(app.onboarding.steps.contract_issued);
});

test('virtual office: company, member, agreement, issued, in that order', async () => {
  const f = fakes();
  const app = voApp();
  const r = await O.provision(app, 'christel@x', f.deps);
  assert.deepEqual(f.calls.map(c => c[0]), ['company', 'membership', 'contract', 'issue']);
  assert.equal(r.state, 'in_progress');
  assert.equal(app.spacebring_customer_ref, 'co-1');
  assert.equal(app.spacebring_subscription_ref, 'sub-1');
  const company = f.calls[0][1];
  assert.equal(company.title, 'Example Trading');
  assert.equal(company.legalName, 'Example Trading (Pty) Ltd (Reg. No. 2020/000000/07)');
  assert.match(company.notes, /VO-2026-0099/);
  assert.match(company.notes, /christel@x/);
  const contract = f.calls[2][1];
  assert.equal(contract.templateRef, 'tpl-standard');
  assert.equal(contract.customerRef, 'co-1');
  assert.equal(contract.startDate, '2026-11-22T22:00:00.000Z'); // 23 Nov 00:00 SAST
});

test('registered address or Pro uses the mandate template', async () => {
  for (const over of [{ wants_registered_address: true }, { plan: 'Village Virtual Pro' }]) {
    const f = fakes();
    await O.provision(voApp(over), 's@x', f.deps);
    assert.equal(f.calls.find(c => c[0] === 'contract')[1].templateRef, 'tpl-registered');
  }
});

test('no agreement template: stops after the customer, never bills without one', async () => {
  const f = fakes({ tpl: null });
  const app = voApp();
  const r = await O.provision(app, 's@x', f.deps);
  assert.equal(r.state, 'needs_attention');
  assert.equal(r.step, 'contract');
  assert.deepEqual(f.calls.map(c => c[0]), ['company', 'membership']);
  assert.deepEqual(f.sent, [['attention', 'contract']]);
});

test('retry after a failure does not repeat finished steps', async () => {
  const f = fakes({ failAt: 'contract' });
  const app = voApp();
  await O.provision(app, 's@x', f.deps);
  assert.equal(app.onboarding_state, 'needs_attention');
  assert.equal(app.onboarding.error.step, 'contract');

  const g = fakes();
  await O.provision(app, 's@x', g.deps);
  assert.deepEqual(g.calls.map(c => c[0]), ['contract', 'issue']);
  assert.equal(app.onboarding_state, 'in_progress');
  assert.equal(app.onboarding.error, undefined);
});

test('one director, second company: a refused member does not stop the agreement', async () => {
  const f = fakes({ failAt: 'membership' });
  const app = voApp();
  const r = await O.provision(app, 's@x', f.deps);
  assert.equal(r.state, 'in_progress');
  assert.equal(app.onboarding.steps.membership.skipped, true);
  assert.ok(app.onboarding.steps.contract_issued);
});

test('student: member then subscription, no agreement; a refused member stops it', async () => {
  const student = { type: 'student', plan: 'Student 5-Day', company_name: null, company_trading_name: null };
  const f = fakes();
  const app = voApp(student);
  await O.provision(app, 's@x', f.deps);
  assert.deepEqual(f.calls.map(c => c[0]), ['membership', 'subscription']);
  assert.equal(app.spacebring_customer_ref, 'mem-1');

  const g = fakes({ failAt: 'membership' });
  const r = await O.provision(voApp(student), 's@x', g.deps);
  assert.equal(r.state, 'needs_attention');
});

test('start date: a future preferred date is kept, a past or missing one becomes today', () => {
  assert.equal(O.startDate({ preferred_start_date: '2026-12-01' }, NOW), '2026-12-01');
  assert.equal(O.startDate({ preferred_start_date: '2026-11-01' }, NOW), '2026-11-23');
  assert.equal(O.startDate({ preferred_start_date: null }, NOW), '2026-11-23');
  // 23:30 SAST on the 23rd is still the 23rd, not the UTC date.
  assert.equal(O.startDate({}, new Date('2026-11-23T21:30:00Z')), '2026-11-23');
});

test('sync: unsigned agreement changes nothing', async () => {
  const f = fakes();
  const app = voApp();
  await O.provision(app, 's@x', f.deps);
  const r = await O.sync(app, f.deps);
  assert.equal(r.changed, false);
  assert.equal(app.status, 'approved');
});

test('sync: signed, invoiced, paid activates and tells the client and the mail desk once', async () => {
  const f = fakes();
  const app = voApp();
  await O.provision(app, 's@x', f.deps);

  const signed = fakes({ contract: { status: 'signed', subscriptionRef: 'sub-1' }, invoices: [{ id: 'inv-1', status: 'issued', subscriptionRef: 'sub-1', createDate: '2026-11-23', totalAmount: 684.25 }] });
  await O.sync(app, signed.deps);
  assert.ok(app.onboarding.steps.contract_signed);
  assert.equal(app.onboarding.steps.invoice.ref, 'inv-1');
  assert.equal(app.status, 'approved');
  assert.equal(signed.sent.length, 0);

  const paid = fakes({ invoices: [
    { id: 'other', status: 'paid', subscriptionRef: 'someone-else', createDate: '2026-11-01' },
    { id: 'inv-1', status: 'paid', subscriptionRef: 'sub-1', createDate: '2026-11-23' },
  ] });
  await O.sync(app, paid.deps);
  assert.equal(app.status, 'activated');
  assert.equal(app.onboarding_state, 'complete');
  assert.deepEqual(paid.sent, [['welcome', 'director@example.co.za'], ['mailDesk', 'Example Trading (Pty) Ltd']]);

  const again = fakes({ invoices: [{ id: 'inv-1', status: 'paid', subscriptionRef: 'sub-1' }] });
  await O.sync(app, again.deps);
  assert.equal(again.sent.length, 0);
});

test('sync: another subscription\'s paid invoice never activates this one', async () => {
  const f = fakes();
  const app = voApp();
  await O.provision(app, 's@x', f.deps);
  const g = fakes({ contract: { status: 'signed', subscriptionRef: 'sub-1' }, invoices: [{ id: 'x', status: 'paid', subscriptionRef: 'different', createDate: '2026-11-01' }] });
  await O.sync(app, g.deps);
  assert.equal(app.status, 'approved');
});

test('sync: a declined agreement asks for a person', async () => {
  const f = fakes();
  const app = voApp();
  await O.provision(app, 's@x', f.deps);
  const g = fakes({ contract: { status: 'declined' } });
  await O.sync(app, g.deps);
  assert.equal(app.onboarding_state, 'needs_attention');
  assert.deepEqual(g.sent, [['attention', 'contract_signed']]);
});

test('progress bar: counts and marks the next stage', () => {
  const fresh = O.stages(voApp({ status: 'submitted', reviewed_at: null }), [{ verified: false }, { verified: true }]);
  assert.equal(fresh.total, 10);
  assert.equal(fresh.done, 1);
  assert.equal(fresh.stages.find(s => s.current).key, 'verified');

  const checked = O.stages(voApp({ status: 'submitted' }), [{ verified: true }, { verified: true }]);
  assert.equal(checked.stages.find(s => s.current).key, 'vetted');
  const vetted = O.stages(voApp({ status: 'submitted', vetting: { cipc_name: 'X', company_active: true, director_listed: true } }), [{ verified: true }]);
  assert.equal(vetted.stages.find(s => s.current).key, 'approved');

  const student = O.stages(voApp({ type: 'student', status: 'activated' }), []);
  assert.equal(student.total, 6);
  assert.equal(student.done, 6);
});

test('every client email is blind-copied to the Hub, and never doubled', () => {
  assert.deepEqual(L.clientBcc('client@example.co.za'), [L.NOTIFY_EMAIL]);
  assert.deepEqual(L.clientBcc([L.NOTIFY_EMAIL.toUpperCase()]), []);
});

test('emails: the right legal-mail instruction reaches the mail desk', () => {
  const app = voApp();
  assert.match(T.mailDesk(app, { registeredAddress: false }).html, /DO NOT sign/);
  assert.match(T.mailDesk(app, { registeredAddress: true }).html, /ACCEPT and sign/);
  assert.match(T.activated(app, { registeredAddress: false }).html, /not your registered CIPC or SARS address/);
  assert.match(T.activated(app, {}).html, /Example Trading \(Pty\) Ltd<br>1st Floor, The Foundry/);
  assert.match(T.approved(app, null, { automated: true, startDate: '2026-11-23' }).html, /agreement, to sign online/);
  assert.doesNotMatch(T.approved(app, null, {}).html, /agreement, to sign online/);
});

test('emails: applicant text cannot inject markup into staff mail', () => {
  const app = voApp({ company_name: '<img src=x onerror=1>' });
  assert.doesNotMatch(T.mailDesk(app, {}).html, /<img src=x/);
  assert.doesNotMatch(T.activated(app, {}).html, /<img src=x/);
});

test('a live run after a test-mode run starts clean and really creates everything', async () => {
  const dry = fakes({ mode: 'dry' });
  const app = voApp();
  await O.provision(app, 's@x', dry.deps);
  assert.equal(app.spacebring_customer_ref, 'dry-run');

  const live = fakes();
  await O.provision(app, 's@x', live.deps);
  assert.deepEqual(live.calls.map(c => c[0]), ['company', 'membership', 'contract', 'issue']);
  assert.equal(app.spacebring_customer_ref, 'co-1');
  assert.equal(app.onboarding.steps.contract.ref, 'con-1');
});

test('vetting: passes only when in business and the applicant is a director', () => {
  assert.equal(O.vettingPassed({}), false);
  assert.equal(O.vettingPassed({ vetting: { cipc_name: 'X', company_active: true, director_listed: false } }), false);
  assert.equal(O.vettingPassed({ vetting: { cipc_name: 'X', company_active: false, director_listed: true } }), false);
  assert.equal(O.vettingPassed({ vetting: { cipc_name: 'X', company_active: true, director_listed: true } }), true);
});

test('vetting: the registered name, not the typed one, goes to Spacebring', async () => {
  const f = fakes();
  const app = voApp({ company_name: 'Exmaple Tradng', vetting: { cipc_name: 'Example Trading (Pty) Ltd', company_active: true, director_listed: true } });
  await O.provision(app, 's@x', f.deps);
  assert.equal(f.calls[0][1].legalName, 'Example Trading (Pty) Ltd (Reg. No. 2020/000000/07)');
});

test('progress bar: test-mode steps never show as done', async () => {
  const f = fakes({ mode: 'dry' });
  const app = voApp({ vetting: { cipc_name: 'X', company_active: true, director_listed: true } });
  await O.provision(app, 's@x', f.deps);
  const p = O.stages(app, [{ verified: true }]);
  assert.equal(p.stages.find(x => x.key === 'account').done, false);
  assert.equal(p.stages.find(x => x.key === 'contract_issued').done, false);
  assert.equal(p.stages.find(x => x.current).key, 'account');
});
