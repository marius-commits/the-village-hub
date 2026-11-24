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
    PLAN_REFS: {
      'Village Address': { id: 'p1', period: 'month' },
      'Village Virtual': { id: 'p2', period: 'month' },
      'Village Virtual Pro': { id: 'p3', period: 'month' },
      'Student 5-Day': { id: 's1', period: 'month' },
    },
    TEMPLATE_VO: 'tpl' in o ? o.tpl : 'tpl-standard',
    TEMPLATE_VO_REGISTERED: 'tplReg' in o ? o.tplReg : 'tpl-registered',
    async createCompany(x) { calls.push(['company', x]); if (o.failAt === 'company') throw new Error('boom'); return { id: 'co-1' }; },
    async createMembership(x) { calls.push(['membership', x]); if (o.failAt === 'membership') throw new Error('email exists'); return { id: 'mem-1' }; },
    async createContract(x) { calls.push(['contract', x]); if (o.failAt === 'contract') throw new Error('bad template'); return { id: 'con-1', title: 'CON-1' }; },
    async issueContract(id) {
      calls.push(['issue', id]);
      if ('issueSub' in o && !o.issueSub) return { id, title: 'CON-1' };
      return { id, title: 'CON-1', subscriptionRef: 'sub-1' };
    },
    async getSubscription(id) {
      calls.push(['getSubscription', id]);
      if (o.subscription) return o.subscription;
      return { id, items: [{ id: 'plan-item', planRef: 'p1', commitmentCycles: o.planCommitment === undefined ? 3 : o.planCommitment }] };
    },
    async updateSubscriptionItem(subId, itemId, item) { calls.push(['updateItem', subId, itemId, item]); return null; },
    async createSubscriptionItem(id, item) {
      calls.push(['subscriptionItem', item]);
      if (o.failAt === 'registered_address') throw new Error('addon refused');
      return { id, items: [{ id: 'item-ra', title: item.title, productRef: item.productRef, price: item.price, commitmentCycles: item.commitmentCycles }] };
    },
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
  assert.deepEqual(f.calls.map(c => c[0]), ['company', 'membership', 'contract', 'issue', 'getSubscription']);
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
  assert.deepEqual(g.calls.map(c => c[0]), ['contract', 'issue', 'getSubscription']);
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
  assert.equal(fresh.total, 9);
  assert.equal(fresh.done, 1);
  assert.equal(fresh.stages.find(s => s.current).key, 'verified');

  const checked = O.stages(voApp({ status: 'submitted' }), [{ verified: true }, { verified: true }]);
  assert.equal(checked.stages.find(s => s.current).key, 'approved');
  const vetted = O.stages(voApp({ status: 'submitted', vetting: { cipc_name: 'X', company_active: true, director_listed: true } }), [{ verified: true }]);
  assert.equal(vetted.stages.find(s => s.current).key, 'approved');
  assert.equal(vetted.total, 10);
  process.env.VETTING_REQUIRED = 'true';
  assert.equal(O.stages(voApp({ status: 'submitted' }), [{ verified: true }]).stages.find(s => s.current).key, 'vetted');
  delete process.env.VETTING_REQUIRED;

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
  assert.deepEqual(live.calls.map(c => c[0]), ['company', 'membership', 'contract', 'issue', 'getSubscription']);
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

test('commitment: contract ends after the chosen months, subscription commitment matches, billing does not stop', async () => {
  assert.equal(O.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(O.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(O.commitmentMonths({ type: 'virtual_office' }), 3);
  assert.equal(O.commitmentMonths({ type: 'virtual_office', commitment_months: 12 }), 12);
  assert.equal(O.commitmentMonths({ type: 'virtual_office', commitment_months: 9 }), 3);

  const f = fakes({ planCommitment: 0 });
  const app = voApp({ commitment_months: 6, preferred_start_date: '2026-12-01' });
  await O.provision(app, 's@x', f.deps);
  const contract = f.calls.find(c => c[0] === 'contract')[1];
  assert.equal(contract.startDate, '2026-11-30T22:00:00.000Z'); // 1 Dec 00:00 SAST
  assert.equal(contract.endDate, '2027-05-31T22:00:00.000Z'); // 1 Jun 00:00 SAST
  const update = f.calls.find(c => c[0] === 'updateItem');
  assert.equal(update[3].commitmentCycles, 6);
  assert.equal(app.onboarding.steps.commitment.months, 6);
  assert.equal(app.onboarding.commitment_months, 6);
});

test('registered address add-on is R250 for the chosen commitment, and Pro does not get one', async () => {
  const address = fakes();
  await O.provision(voApp({ wants_registered_address: true, commitment_months: 6, plan: 'Village Virtual' }), 's@x', address.deps);
  const item = address.calls.find(c => c[0] === 'subscriptionItem')[1];
  assert.equal(item.type, 'recurring');
  assert.equal(item.price, 250);
  assert.equal(item.commitmentCycles, 6);
  assert.equal(item.title, 'Registered Address (CIPC / SARS)');
  assert.equal(item.productRef, 'a3ec6ad3-05cd-486a-98b1-104157dbfb36');
  assert.equal(address.calls.find(c => c[0] === 'contract')[1].templateRef, 'tpl-registered');

  const pro = fakes();
  await O.provision(voApp({ plan: 'Village Virtual Pro' }), 's@x', pro.deps);
  assert.equal(pro.calls.some(c => c[0] === 'subscriptionItem'), false);
  assert.equal(pro.calls.find(c => c[0] === 'contract')[1].templateRef, 'tpl-registered');
});

test('add-on and commitment wait for the subscription, then run once', async () => {
  const f = fakes({ issueSub: null });
  const app = voApp({ wants_registered_address: true });
  await O.provision(app, 's@x', f.deps);
  assert.equal(f.calls.some(c => c[0] === 'getSubscription'), false);
  assert.equal(f.calls.some(c => c[0] === 'subscriptionItem'), false);
  assert.equal(app.onboarding.steps.contract.end_date, '2027-02-22T22:00:00.000Z');

  const g = fakes({ contract: { status: 'signed', subscriptionRef: 'sub-9', title: 'CON-1' } });
  await O.sync(app, g.deps);
  assert.equal(app.onboarding.steps.commitment.months, 3);
  assert.equal(g.calls.filter(c => c[0] === 'subscriptionItem').length, 1);
  assert.equal(g.calls.find(c => c[0] === 'subscriptionItem')[1].commitmentCycles, 3);

  const again = fakes({ contract: { status: 'signed', subscriptionRef: 'sub-9' }, invoices: [] });
  await O.sync(app, again.deps);
  assert.equal(again.calls.some(c => c[0] === 'subscriptionItem'), false);
  assert.equal(again.calls.some(c => c[0] === 'updateItem'), false);
});

test('an add-on already on the subscription is not added again', async () => {
  const f = fakes({
    subscription: {
      id: 'sub-1',
      items: [
        { id: 'plan-item', planRef: 'p1', commitmentCycles: 3 },
        { id: 'existing', title: 'Registered Address (CIPC / SARS)', productRef: 'a3ec6ad3-05cd-486a-98b1-104157dbfb36' },
      ],
    },
  });
  const app = voApp({ wants_registered_address: true });
  await O.provision(app, 's@x', f.deps);
  assert.equal(f.calls.some(c => c[0] === 'subscriptionItem'), false);
  assert.equal(app.onboarding.steps.registered_address.already_present, true);
  assert.equal(app.onboarding.steps.registered_address.ref, 'existing');
});

test('dry mode records the add-on and the commitment without calling Spacebring', async () => {
  const f = fakes({ mode: 'dry' });
  const app = voApp({ wants_registered_address: true, commitment_months: 12 });
  await O.provision(app, 's@x', f.deps);
  assert.equal(f.calls.length, 0);
  assert.equal(app.onboarding.steps.registered_address.price, 250);
  assert.equal(app.onboarding.steps.registered_address.commitment_cycles, 12);
  assert.equal(app.onboarding.steps.commitment.months, 12);
});

test('vetting record keeps the BizProfile fields and the attached PDF', () => {
  const v = O.vettingRecord({
    cipc_name: 'Example Trading (Pty) Ltd',
    company_active: true,
    director_listed: false,
    directors: 'A Director\nB Director',
    enterprise_number: '2020/000000/07',
    enterprise_status: 'In Business',
    registered_address: '1 Main Road',
    annual_returns_note: 'Up to date',
    notes: 'Checked',
  }, 'staff@x', { document_id: 'doc-1', storage_path: 'applications/a/cipc_bizprofile-x.pdf' }, '2026-11-24T00:00:00.000Z');
  assert.equal(v.source, O.VETTING_SOURCE);
  assert.deepEqual(v.directors, ['A Director', 'B Director']);
  assert.equal(v.document_id, 'doc-1');
  assert.equal(v.storage_path, 'applications/a/cipc_bizprofile-x.pdf');
  assert.equal(v.enterprise_status, 'In Business');
  assert.equal(O.vettingPassed({ vetting: v }), false);
  v.director_listed = true;
  assert.equal(O.vettingPassed({ vetting: v }), true);
});

test('vetting: without a trading name the registered name is the Spacebring title', async () => {
  const f = fakes();
  const app = voApp({
    company_name: 'Exmaple Tradng',
    company_trading_name: null,
    vetting: { cipc_name: 'Example Trading (Pty) Ltd', company_active: true, director_listed: true },
  });
  await O.provision(app, 's@x', f.deps);
  assert.equal(f.calls[0][1].title, 'Example Trading (Pty) Ltd');
  assert.equal(f.calls[0][1].legalName, 'Example Trading (Pty) Ltd (Reg. No. 2020/000000/07)');
  assert.equal(f.calls[0][1].metadata.legal_name, 'Example Trading (Pty) Ltd');
  assert.match(T.activated(app, {}).html, /Example Trading \(Pty\) Ltd<br>1st Floor, The Foundry/);
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
