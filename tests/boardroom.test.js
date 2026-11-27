const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const B = require('../netlify/functions/_boardroom');
const A = require('../netlify/functions/_boardroom_availability');
const F = require('../netlify/functions/_boardroom_flow');
const E = require('../netlify/functions/_boardroom_emails');
const S = require('../netlify/functions/submit-boardroom');
const SB = require('../netlify/functions/_spacebring');

const NOW = new Date('2026-11-27T08:00:00Z'); // Friday 10:00 SAST
const root = path.join(__dirname, '..');

function good(over) {
  return {
    date: '2026-12-03', start: '09:00', duration_minutes: 120, guests: 8, room: 'either',
    meeting_type: 'strategy', needs: ['screen'], catering: 'none',
    billing: 'personal', first_name: 'Thandi', last_name: 'Mokoena',
    email: 'Thandi@Example.co.za', phone: '082 123 4567',
    terms_accepted: true, popia_consent: true, ...over,
  };
}

function booking(over) {
  const p = B.parse(good(), NOW).row;
  return {
    id: 'b1', reference: 'BR-2026-0042', created_at: NOW.toISOString(), mode: 'live',
    ...p, room_key: 'chamber', room_title: 'Village Chamber', resource_ref: B.ROOMS.chamber.resourceRef,
    hold_expires_at: B.holdExpiry(NOW, p.starts_at).toISOString(),
    spacebring: {}, steps: {}, ...over,
  };
}

// ---------- rules ----------------------------------------------------------

test('a weekday slot inside hours is an instant booking', () => {
  const r = B.parse(good(), NOW);
  assert.equal(r.route, 'instant');
  assert.equal(r.row.starts_at, '2026-12-03T07:00:00.000Z'); // 09:00 SAST
  assert.equal(r.row.ends_at, '2026-12-03T09:00:00.000Z');
  assert.equal(r.row.email, 'thandi@example.co.za');
  assert.equal(r.row.status, 'received');
});

test('what a person must price goes to the quote route', () => {
  assert.deepEqual(B.parse(good({ guests: 20 }), NOW).reasons, ['more_than_12_guests']);
  assert.deepEqual(B.parse(good({ date: '2026-12-05' }), NOW).reasons, ['saturday']);
  assert.deepEqual(B.parse(good({ date: '2026-12-06' }), NOW).reasons, ['sunday']);
  assert.deepEqual(B.parse(good({ start: '19:30' }), NOW).reasons, ['outside_hours']);
  assert.deepEqual(B.parse(good({ start: '06:30' }), NOW).reasons, ['outside_hours']);
  assert.deepEqual(B.parse(good({ start: '07:00' }), NOW).reasons, []); // online booking opens 07:00
  assert.deepEqual(B.parse(good({ start: '18:00', duration_minutes: 120 }), NOW).reasons, []); // ends 20:00 exactly
  assert.deepEqual(B.parse(good({ start: '18:30', duration_minutes: 120 }), NOW).reasons, ['outside_hours']);
  assert.deepEqual(B.parse(good({ date: '2026-11-27', start: '10:30' }), NOW).reasons, ['short_notice']);
  const q = B.parse(good({ guests: 40, date: '2026-12-05' }), NOW);
  assert.equal(q.route, 'quote');
  assert.equal(q.row.status, 'quote_requested');
  assert.equal(q.row.room_title, 'Open floor');
});

test('bad input is refused with a sentence, never saved', () => {
  for (const over of [
    { date: '2026-02-31' }, { date: '2026-11-01' }, { date: '2027-11-01' }, { start: '09:10' }, { duration_minutes: 30 },
    { duration_minutes: 95 }, { guests: 0 }, { guests: 61 }, { meeting_type: 'party' }, { catering: 'sushi' },
    { email: 'nope' }, { phone: '12' }, { first_name: ' ' }, { billing: 'company' }, { popia_consent: false }, { terms_accepted: false },
  ]) {
    const r = B.parse(good(over), NOW);
    assert.ok(r.error && r.error.length > 10, JSON.stringify(over));
    assert.equal(r.row, undefined);
  }
});

test('a named room too small for the group is not kept', () => {
  assert.equal(B.parse(good({ guests: 11, room: 'chamber' }), NOW).room_choice, 'either');
  assert.equal(B.parse(good({ guests: 11, room: 'boardroom' }), NOW).room_choice, 'boardroom');
});

test('unknown needs are dropped and company details only kept for a company', () => {
  const r = B.parse(good({ needs: ['screen', 'hot tub', 'screen'], company_name: 'Acme', company_vat: '4123' }), NOW);
  assert.deepEqual(r.row.needs, ['screen']);
  assert.equal(r.row.company_name, null);
  const c = B.parse(good({ billing: 'company', company_name: 'Acme (Pty) Ltd', company_vat: '4123456789' }), NOW);
  assert.equal(c.row.company_name, 'Acme (Pty) Ltd');
  assert.equal(c.row.company_vat, '4123456789');
});

test('prices are hourly, excluding VAT, with VAT shown on top', () => {
  assert.deepEqual(B.price('chamber', 120), { rate: 350, hours: 2, exVat: 700, vat: 105, inclVat: 805 });
  assert.deepEqual(B.price('boardroom', 90), { rate: 390, hours: 1.5, exVat: 585, vat: 87.75, inclVat: 672.75 });
  assert.equal(B.rand(672.75), 'R672.75');
  assert.equal(B.rand(3120), 'R3,120');
});

test('touching bookings do not clash, overlapping ones do', () => {
  const busy = [{ start: '2026-12-03T07:00:00Z', end: '2026-12-03T09:00:00Z' }];
  assert.equal(B.overlaps(busy, '2026-12-03T09:00:00Z', '2026-12-03T10:00:00Z'), false);
  assert.equal(B.overlaps(busy, '2026-12-03T06:00:00Z', '2026-12-03T07:00:00Z'), false);
  assert.equal(B.overlaps(busy, '2026-12-03T08:30:00Z', '2026-12-03T09:30:00Z'), true);
});

test('a hold lasts 24 hours, or to two hours before the meeting, never under 30 minutes', () => {
  assert.equal(B.holdExpiry(NOW, '2026-12-03T07:00:00Z').toISOString(), '2026-11-28T08:00:00.000Z');
  assert.equal(B.holdExpiry(NOW, '2026-11-27T13:00:00Z').toISOString(), '2026-11-27T11:00:00.000Z');
  assert.equal(B.holdExpiry(NOW, '2026-11-27T09:30:00Z').toISOString(), '2026-11-27T08:30:00.000Z');
});

// ---------- availability -----------------------------------------------------

function availIo(opts) {
  const o = opts || {};
  return {
    now: () => NOW,
    spacebringReady: () => o.ready !== false,
    async listBookings({ resourceRef }) {
      if (o.fail) throw new Error('spacebring down');
      return (o.bookings || {})[resourceRef] || [];
    },
    async select() { return o.own || []; },
  };
}

test('availability merges Spacebring bookings with our own unbooked requests', async () => {
  const r = await A.busy('2026-12-03', availIo({
    bookings: { [B.ROOMS.chamber.resourceRef]: [
      { startDate: '2026-12-03T07:00:00Z', endDate: '2026-12-03T08:00:00Z' },
      { startDate: '2026-12-03T08:00:00Z', endDate: '2026-12-03T09:00:00Z' },
      { startDate: '2026-12-03T12:00:00Z', endDate: '2026-12-03T13:00:00Z', deleteDate: '2026-12-01T00:00:00Z' },
    ] },
    own: [
      { room_key: 'boardroom', starts_at: '2026-12-03T10:00:00Z', ends_at: '2026-12-03T11:00:00Z', status: 'received', created_at: NOW.toISOString(), spacebring: {} },
      { room_key: 'chamber', starts_at: '2026-12-03T07:00:00Z', ends_at: '2026-12-03T08:00:00Z', status: 'held', created_at: NOW.toISOString(), spacebring: { booking_id: 'x' } },
      { room_key: 'boardroom', starts_at: '2026-12-03T13:00:00Z', ends_at: '2026-12-03T14:00:00Z', status: 'received', created_at: '2026-11-20T08:00:00Z', spacebring: {} },
    ],
  }));
  assert.equal(r.live, true);
  assert.deepEqual(r.rooms.chamber, [{ start: '2026-12-03T07:00:00.000Z', end: '2026-12-03T09:00:00.000Z' }]);
  assert.deepEqual(r.rooms.boardroom, [{ start: '2026-12-03T10:00:00.000Z', end: '2026-12-03T11:00:00.000Z' }]);
});

test('if Spacebring cannot be read the page is told, and our own holds still count', async () => {
  const r = await A.busy('2026-12-03', availIo({ fail: true, own: [
    { room_key: 'chamber', starts_at: '2026-12-03T07:00:00Z', ends_at: '2026-12-03T08:00:00Z', status: 'held', created_at: NOW.toISOString(), spacebring: { booking_id: 'x' } },
  ] }));
  assert.equal(r.live, false);
  assert.equal(r.rooms.chamber.length, 1);
});

test('the day view gives wall-clock times and never a name', async () => {
  const r = await A.busy('2026-12-03', availIo({ bookings: { [B.ROOMS.boardroom.resourceRef]: [
    { startDate: '2026-12-03T07:00:00Z', endDate: '2026-12-03T09:30:00Z', title: 'Secret merger', customer: { user: { name: 'Jan' } } },
  ] } }));
  const v = A.dayView('2026-12-03', r, NOW);
  const room = v.rooms.find(x => x.key === 'boardroom');
  assert.deepEqual(room.busy, [{ start: '09:00', end: '11:30', start_min: 540, end_min: 690 }]);
  assert.equal(v.bookable_online, true);
  assert.ok(!/Secret|Jan/.test(JSON.stringify(v)));
  assert.equal(A.dayView('2026-11-27', r, NOW).earliest_minutes, 660); // 10:00 now, 11:00 earliest
});

test('the smallest free room that fits is chosen', () => {
  const free = { rooms: { boardroom: [], chamber: [] } };
  const s = '2026-12-03T07:00:00Z', e = '2026-12-03T09:00:00Z';
  assert.equal(S.chooseRoom('either', 8, free, s, e).key, 'chamber');
  assert.equal(S.chooseRoom('either', 11, free, s, e).key, 'boardroom');
  assert.equal(S.chooseRoom('boardroom', 8, free, s, e).key, 'boardroom');
  const chamberTaken = { rooms: { boardroom: [], chamber: [{ start: s, end: e }] } };
  assert.equal(S.chooseRoom('either', 8, chamberTaken, s, e).key, 'boardroom');
  assert.equal(S.chooseRoom('chamber', 8, chamberTaken, s, e), null);
});

// ---------- submit -------------------------------------------------------------

function io(opts) {
  const o = opts || {};
  const sent = [], events = [], inserted = [], leads = [];
  return {
    sent, events, inserted, leads,
    now: () => NOW, wait: async () => {},
    mode: () => o.mode || 'off',
    spacebringReady: () => o.ready !== false,
    async select(q) { if (/starts_at=eq/.test(q)) return o.duplicate ? [o.duplicate] : []; return o.recent || []; },
    async insert(row) { if (o.insertFails) throw new Error('db down'); const b = { id: 'b1', reference: 'BR-2026-0042', created_at: NOW.toISOString(), spacebring: {}, steps: {}, ...row }; inserted.push(b); return b; },
    async update() {},
    async log(id, type, actor, detail) { events.push({ type, detail }); },
    async busy() { return o.busy || { rooms: { boardroom: [], chamber: [] }, live: true }; },
    async provision(b) {
      if (o.provisionThrows) throw new Error('boom');
      const r = o.provisionResult || { state: 'held' };
      if (r.state === 'held') { b.status = 'held'; b.spacebring = { invoice_title: 'INV-0099', invoice_pdf_url: 'https://example.test/inv.pdf' }; }
      return r;
    },
    async send(args) { if (o.mailFails) return { error: 'nope' }; sent.push(args); return { id: 'm' }; },
    async insertLead(row) { leads.push(row); },
    staffEmails: ['team@example.test'], notifyEmail: 'hello@villagehub.co.za',
    villageTableEmails: o.villageTable || [],
  };
}

test('automation off: saved, person told an invoice follows, team told what to do', async () => {
  const x = io();
  const r = await S.run(good(), x);
  assert.equal(r.status, 200);
  assert.equal(r.body.reference, 'BR-2026-0042');
  assert.equal(r.body.state, 'received');
  assert.equal(r.body.room, 'Village Chamber');
  assert.equal(r.body.price_incl_vat, 805);
  assert.equal(x.inserted[0].amount_ex_vat, 700);
  assert.equal(x.inserted[0].mode, 'off');
  assert.equal(x.sent.length, 2);
  assert.match(x.sent[0].subject, /received your booking request/);
  assert.equal(x.sent[0].client, true);
  assert.match(x.sent[1].html, /To do in Spacebring/);
  assert.equal(x.leads[0].product, 'boardroom');
});

test('automation live: room held, person gets the pay-to-confirm email', async () => {
  const x = io({ mode: 'live' });
  const r = await S.run(good(), x);
  assert.equal(r.body.state, 'held');
  assert.ok(r.body.hold_expires_at);
  assert.match(x.sent[0].subject, /reserved: please pay to confirm/);
  assert.match(x.sent[0].html, /INV-0099/);
  assert.match(x.sent[1].html, /Nothing to do yet/);
});

test('live but a step stops: the request is still saved and honest emails go out', async () => {
  const x = io({ mode: 'live', provisionResult: { state: 'attention', message: 'Spacebring 500' } });
  const r = await S.run(good(), x);
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'attention');
  assert.match(x.sent[0].subject, /received your booking request/);
  assert.match(x.sent[1].html, /Needs attention/);
  const y = io({ mode: 'live', provisionThrows: true });
  assert.equal((await S.run(good(), y)).body.state, 'attention');
});

test('a taken slot is refused before anything is saved', async () => {
  const s = '2026-12-03T07:00:00Z', e = '2026-12-03T09:00:00Z';
  const x = io({ busy: { rooms: { boardroom: [{ start: s, end: e }], chamber: [{ start: s, end: e }] }, live: true } });
  const r = await S.run(good(), x);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'taken');
  assert.equal(x.inserted.length, 0);
  assert.equal(x.sent.length, 0);
});

test('a slot lost between the form and the hold is reported as taken', async () => {
  const x = io({ mode: 'live', provisionResult: { state: 'clash' } });
  const r = await S.run(good(), x);
  assert.equal(r.status, 409);
  assert.equal(x.sent.length, 0);
});

test('quote route: no price, no hold, one business day promised', async () => {
  const x = io({ mode: 'live' });
  const r = await S.run(good({ guests: 30, date: '2026-12-05' }), x);
  assert.equal(r.body.route, 'quote');
  assert.equal(r.body.price_ex_vat, null);
  assert.match(x.sent[0].subject, /preparing your quote/);
  assert.match(x.sent[1].subject, /Quote request/);
  assert.equal(x.leads[0].product, 'event');
});

test('honeypot, duplicates and floods', async () => {
  const bot = io();
  const r = await S.run(good({ website_url: 'http://spam' }), bot);
  assert.equal(r.status, 200); assert.equal(bot.inserted.length, 0); assert.equal(bot.sent.length, 0);
  const dup = io({ duplicate: { reference: 'BR-2026-0001', route: 'instant', status: 'held', room_title: 'Village Chamber' } });
  const d = await S.run(good(), dup);
  assert.equal(d.body.reference, 'BR-2026-0001'); assert.equal(dup.inserted.length, 0);
  const flood = io({ recent: [1, 2, 3, 4] });
  assert.equal((await S.run(good(), flood)).status, 429);
});

test('The Village Table is only emailed when an address is set', async () => {
  const none = io();
  await S.run(good({ catering: 'village_table', catering_notes: 'Lunch for 8' }), none);
  assert.equal(none.sent.length, 2);
  assert.match(none.sent[1].html, /Please introduce them to The Village Table/);
  const set = io({ villageTable: ['table@example.test'] });
  await S.run(good({ catering: 'village_table', catering_notes: 'Lunch for 8' }), set);
  assert.equal(set.sent.length, 3);
  assert.deepEqual(set.sent[0].to, ['table@example.test']);
  assert.match(set.sent[0].html, /Lunch for 8/);
  assert.match(set.sent[2].html, /has been emailed the details/);
});

test('a failed team alert falls back to the shared inbox', async () => {
  const x = io(); let n = 0;
  x.send = async (args) => { n++; if (Array.isArray(args.to) && args.to[0] === 'team@example.test') return { error: 'bounce' }; x.sent.push(args); return { id: 'm' }; };
  await S.run(good(), x);
  assert.ok(x.sent.some(m => Array.isArray(m.to) && m.to[0] === 'hello@villagehub.co.za'));
});

// ---------- flow -----------------------------------------------------------------

function deps(opts) {
  const o = opts || {};
  const calls = [], mails = [], saved = [], logs = [];
  const sb = {
    async findMembershipByEmail() { calls.push('findMembership'); return o.membership || null; },
    async findCompanyByTitle() { calls.push('findCompany'); return o.company || null; },
    async createCompany(a) { calls.push('createCompany'); return { id: 'co1', ...a }; },
    async createMembership(a) { calls.push(['createMembership', a]); return { id: 'm1' }; },
    async checkAvailability() { calls.push('checkAvailability'); return o.unavailable ? { available: false, reason: { code: 'bookingConflict', message: 'taken' } } : { available: true }; },
    async createBooking(a) { calls.push(['createBooking', a]); if (o.bookingFails) throw new Error('Spacebring 500'); return { id: 'bk1' }; },
    async createInvoice(a) { calls.push(['createInvoice', a]); return { id: 'inv1', totalAmount: o.total === undefined ? 805 : o.total }; },
    async issueInvoice() { calls.push('issueInvoice'); return { id: 'inv1', title: 'INV-0099', pdfUrl: 'https://example.test/inv.pdf' }; },
    async getInvoice() { calls.push('getInvoice'); return { id: 'inv1', title: 'INV-0099', status: o.invoiceStatus || 'issued', pdfUrl: 'https://example.test/inv.pdf' }; },
    async updateBooking(id, a) { calls.push(['updateBooking', a]); },
    async cancelBooking() { calls.push('cancelBooking'); if (o.cancelFails) throw new Error('nope'); },
    async voidInvoice() { calls.push('voidInvoice'); if (o.voidFails) throw new Error('nope'); },
  };
  const mail = {};
  for (const k of ['held', 'confirmed', 'staffPaid', 'reminder', 'released', 'staffLapsed', 'attention']) mail[k] = async (...a) => { mails.push([k, ...a.slice(1)]); };
  return {
    calls, mails, saved, logs, sb, mail,
    now: () => o.now || NOW, mode: () => o.mode || 'live', autoRelease: () => o.autoRelease !== false,
    store: { async save(id, patch) { saved.push(patch); }, async select() { return []; }, async log(id, type, actor, detail) { logs.push(type); } },
  };
}
const names = (d) => d.calls.map(c => Array.isArray(c) ? c[0] : c);

test('provision: guest created without an app invite, room held, invoice checked then issued', async () => {
  const d = deps(); const b = booking();
  const r = await F.provision(b, d);
  assert.equal(r.state, 'held');
  assert.deepEqual(names(d), ['findMembership', 'createMembership', 'checkAvailability', 'createBooking', 'createInvoice', 'issueInvoice']);
  const member = d.calls.find(c => c[0] === 'createMembership')[1];
  assert.equal(member.type, 'nonmember');
  const bk = d.calls.find(c => c[0] === 'createBooking')[1];
  assert.equal(bk.resourceRef, B.ROOMS.chamber.resourceRef);
  assert.match(bk.title, /^HOLD unpaid: Thandi Mokoena \(BR-2026-0042\)$/);
  assert.equal(bk.metadata.vh_hold, 'true');
  const inv = d.calls.find(c => c[0] === 'createInvoice')[1];
  assert.equal(inv.membershipRef, 'm1');
  assert.equal(inv.items[0].unitAmount, 700);
  assert.equal(inv.items[0].quantity, 1);
  assert.match(inv.items[0].title, /Village Chamber hire, Thursday,? 3 December 2026, 09:00 to 11:00 \(BR-2026-0042\)/);
  assert.equal(b.status, 'held');
  assert.equal(b.spacebring.invoice_title, 'INV-0099');
});

test('provision: a returning person is reused, a company is invoiced as a company', async () => {
  const d = deps({ membership: { id: 'old', type: 'member' } });
  const b = booking({ billing: 'company', company_name: 'Acme (Pty) Ltd', company_vat: '4123' });
  await F.provision(b, d);
  assert.deepEqual(names(d), ['findMembership', 'findCompany', 'createCompany', 'checkAvailability', 'createBooking', 'createInvoice', 'issueInvoice']);
  assert.equal(b.spacebring.existing_member, true);
  assert.equal(d.calls.find(c => c[0] === 'createInvoice')[1].companyRef, 'co1');
  assert.match(d.calls.find(c => c[0] === 'createBooking')[1].title, /Acme \(Pty\) Ltd/);
});

test('provision: a slot that has gone is a clash, nothing is created', async () => {
  const d = deps({ unavailable: true }); const b = booking();
  const r = await F.provision(b, d);
  assert.equal(r.state, 'clash'); assert.equal(b.status, 'clash');
  assert.ok(!names(d).includes('createBooking'));
});

test('provision: a draft total that does not match is never issued', async () => {
  const d = deps({ total: 700 }); const b = booking();
  const r = await F.provision(b, d);
  assert.equal(r.state, 'attention');
  assert.ok(!names(d).includes('issueInvoice'));
  assert.equal(b.status, 'needs_attention');
  assert.equal(d.mails[0][0], 'attention');
  // A second run does not create a second invoice.
  const again = await F.provision(b, d);
  assert.equal(again.state, 'attention');
  assert.equal(names(d).filter(n => n === 'createInvoice').length, 1);
});

test('provision: a failure half way resumes at the failed step, never repeating one', async () => {
  const d = deps({ bookingFails: true }); const b = booking();
  assert.equal((await F.provision(b, d)).state, 'attention');
  const d2 = deps(); b.status = 'received';
  assert.equal((await F.provision(b, d2)).state, 'held');
  assert.deepEqual(names(d2), ['checkAvailability', 'createBooking', 'createInvoice', 'issueInvoice']);
});

test('provision: dry mode touches nothing in Spacebring', async () => {
  const d = deps({ mode: 'dry' }); const b = booking({ mode: 'dry' });
  const r = await F.provision(b, d);
  assert.equal(r.state, 'dry'); assert.equal(d.calls.length, 0); assert.equal(b.status, 'received');
});

function held(over) {
  return booking({ status: 'held', spacebring: { membership_ref: 'm1', booking_id: 'bk1', invoice_id: 'inv1' }, ...over });
}

test('sync: paid confirms the booking, retitles it and tells person and team once', async () => {
  const d = deps({ invoiceStatus: 'paid' }); const b = held();
  const r = await F.sync(b, d);
  assert.equal(r.state, 'confirmed'); assert.equal(b.status, 'confirmed'); assert.ok(b.paid_at);
  const up = d.calls.find(c => c[0] === 'updateBooking')[1];
  assert.equal(up.title, 'Thandi Mokoena (BR-2026-0042)'); assert.equal(up.metadata.vh_hold, 'false');
  assert.deepEqual(d.mails.map(m => m[0]), ['confirmed', 'staffPaid']);
  assert.equal((await F.sync(b, d)).changed, false);
});

test('sync: one reminder at half way, then nothing until it lapses', async () => {
  const early = deps({ now: new Date(NOW.getTime() + 3600_000) }); const b = held();
  assert.equal((await F.sync(b, early)).changed, false);
  const half = deps({ now: new Date(NOW.getTime() + 13 * 3600_000) });
  await F.sync(b, half);
  assert.deepEqual(half.mails.map(m => m[0]), ['reminder']);
  const later = deps({ now: new Date(NOW.getTime() + 14 * 3600_000) });
  assert.equal((await F.sync(b, later)).changed, false);
});

test('sync: an unpaid hold that lapses is released and the invoice voided', async () => {
  const d = deps({ now: new Date(NOW.getTime() + 25 * 3600_000) }); const b = held();
  const r = await F.sync(b, d);
  assert.equal(r.state, 'released'); assert.equal(b.status, 'released');
  assert.deepEqual(names(d), ['getInvoice', 'cancelBooking', 'voidInvoice']);
  assert.deepEqual(d.mails.map(m => m[0]), ['released', 'staffLapsed']);
  assert.equal(d.mails[1][2].invoiceVoided, true);
});

test('sync: with automatic release off the team is alerted once and the room stays', async () => {
  const d = deps({ now: new Date(NOW.getTime() + 25 * 3600_000), autoRelease: false }); const b = held();
  await F.sync(b, d);
  assert.ok(!names(d).includes('cancelBooking')); assert.equal(b.status, 'held');
  assert.deepEqual(d.mails.map(m => m[0]), ['staffLapsed']);
  assert.equal((await F.sync(b, d)).changed, false);
});

test('sync: an invoice voided by hand cancels the booking', async () => {
  const d = deps({ invoiceStatus: 'voided' }); const b = held();
  assert.equal((await F.sync(b, d)).state, 'cancelled');
  assert.ok(names(d).includes('cancelBooking'));
});

// ---------- emails and pages ---------------------------------------------------

test('every email is complete: no blanks, no em dashes, escaped input', () => {
  const b = held({ first_name: '<b>Thandi</b>', catering: 'village_table', catering_notes: 'Lunch', notes: 'Door code?', quote_reasons: ['saturday'] });
  const pr = F.priceOf(b);
  const all = [
    E.held(b, pr, { invoiceTitle: 'INV-1', invoiceUrl: 'https://example.test/i.pdf' }), E.received(b, pr), E.quote(b),
    E.staffNew(b, pr, { state: 'held' }), E.staffNew(b, pr, {}), E.staffNew({ ...b, route: 'quote' }, null, {}),
    E.confirmed(b, pr), E.staffPaid(b, pr), E.reminder(b, pr, {}), E.released(b, pr, 'https://x.test/book-boardroom'),
    E.staffLapsed(b, pr, { released: true, invoiceVoided: false }), E.attention(b, 'booking', 'Spacebring 500'),
    E.villageTable(b), E.enquiryReply({ first_name: 'Jan' }, 'https://x.test/book-boardroom'),
  ];
  for (const m of all) {
    assert.ok(m.subject && m.html);
    const own = m.html.split('<td style="padding:30px 28px')[1].split('<td style="background:#FAF8F6;padding:18px 28px')[0] + m.subject;
    assert.ok(!/undefined|null|NaN|\[object/.test(own), m.subject);
    assert.ok(!/—|&mdash;/.test(own), m.subject);
    assert.ok(!/<b>Thandi<\/b>/.test(m.html), m.subject);
  }
  assert.match(all[0].html, /R700 excl\. VAT \(R805 incl\. VAT\)/);
});

test('the booking page and the server agree on rooms, rates and hours', () => {
  const html = fs.readFileSync(path.join(root, 'book-boardroom.html'), 'utf8');
  for (const k of B.ROOM_KEYS) {
    const r = B.ROOMS[k];
    assert.ok(new RegExp(`${k}:\\s*\\{ title: '${r.title}',\\s*capacity: ${r.capacity}, rate: ${r.rate} \\}`).test(html), k);
  }
  assert.ok(html.includes(`OPEN = ${B.OPEN_MIN}, CLOSE = ${B.CLOSE_MIN}, STEP = ${B.STEP_MIN}, MAX_ROOM = ${B.MAX_ROOM_GUESTS}`));
  for (const k of Object.keys(B.MEETING_TYPES)) assert.ok(html.includes(`<option value="${k}">`), k);
  for (const k of Object.keys(B.NEEDS)) assert.ok(html.includes(`name="needs" value="${k}"`), k);
  for (const k of Object.keys(B.CATERING)) assert.ok(html.includes(`name="catering" value="${k}"`), k);
  assert.ok(html.includes('/.netlify/functions/submit-boardroom'));
});

test('the ads landing page leads into the booking page and keeps its enquiry form', () => {
  const html = fs.readFileSync(path.join(root, 'boardroom-hire-stellenbosch.html'), 'utf8');
  assert.ok(html.includes('id="vh-book-start" action="/book-boardroom"'));
  assert.ok(html.includes('href="/book-boardroom?room=boardroom"'));
  assert.ok(html.includes('href="/book-boardroom?room=chamber"'));
  assert.ok(html.includes('form action="https://crm.zoho.com/crm/WebToLeadForm"'));
  assert.ok(html.includes('id="saturday-quote"') || html.includes('#saturday-quote'));
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.ok(toml.includes('from = "/book-boardroom.html"'));
});

test('the enquiry auto-reply goes to boardroom enquiries only', async () => {
  const { boardroomAutoReply } = require('../netlify/functions/submit-lead');
  delete process.env.RESEND_API_KEY; // sendEmail then skips: nothing leaves the test
  assert.equal(await boardroomAutoReply({ email: 'a@b.co.za', planInterest: 'Hot Desk', leadSource: 'Website' }), false);
  assert.equal(await boardroomAutoReply({ email: 'a@b.co.za', planInterest: 'Corporate Event - Saturday', leadSource: 'Website - Corporate Event' }), false);
  assert.equal(await boardroomAutoReply({ email: 'bad', planInterest: 'Boardroom', leadSource: 'Website - Boardroom' }), false);
  process.env.BOARDROOM_AUTOREPLY = 'false';
  assert.equal(await boardroomAutoReply({ email: 'a@b.co.za', planInterest: 'Boardroom', leadSource: 'Website - Boardroom' }), false);
  delete process.env.BOARDROOM_AUTOREPLY;
});

test('the Spacebring client exposes what the flow calls', () => {
  for (const fn of ['findMembershipByEmail', 'findCompanyByTitle', 'listBookings', 'checkAvailability', 'createBooking', 'updateBooking', 'cancelBooking', 'createInvoice', 'issueInvoice', 'getInvoice', 'voidInvoice']) {
    assert.equal(typeof SB[fn], 'function', fn);
  }
});

test('every time sent to Spacebring ends in Z, even when the database gives +00:00', async () => {
  assert.equal(SB.iso('2026-12-04T12:00:00+00:00'), '2026-12-04T12:00:00.000Z');
  assert.equal(SB.iso('2026-12-04T14:00:00+02:00'), '2026-12-04T12:00:00.000Z');
  assert.throws(() => SB.iso('not a date'));
  const saved = { id: process.env.SPACEBRING_CLIENT_ID, secret: process.env.SPACEBRING_CLIENT_SECRET };
  const realFetch = global.fetch; const bodies = [];
  global.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body || '{}')); return { ok: true, text: async () => '{"available":true,"booking":{"id":"b"},"invoice":{"id":"i"}}' }; };
  try {
    delete require.cache[require.resolve('../netlify/functions/_spacebring')];
    process.env.SPACEBRING_CLIENT_ID = 'x'; process.env.SPACEBRING_CLIENT_SECRET = 'y';
    const S2 = require('../netlify/functions/_spacebring');
    const s = '2026-12-04T12:00:00+00:00', e = '2026-12-04T13:00:00+00:00';
    await S2.checkAvailability({ resourceRef: 'r', startDate: s, endDate: e });
    await S2.createBooking({ resourceRef: 'r', startDate: s, endDate: e, membershipRefOwner: 'm' });
    await S2.createInvoice({ membershipRef: 'm', dueDate: s, items: [{ title: 't', unitAmount: 1 }] });
    assert.equal(bodies[0].startDate, '2026-12-04T12:00:00.000Z');
    assert.equal(bodies[0].endDate, '2026-12-04T13:00:00.000Z');
    assert.equal(bodies[1].booking.startDate, '2026-12-04T12:00:00.000Z');
    assert.equal(bodies[2].invoice.dueDate, '2026-12-04T12:00:00.000Z');
  } finally {
    global.fetch = realFetch;
    if (saved.id === undefined) delete process.env.SPACEBRING_CLIENT_ID; else process.env.SPACEBRING_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.SPACEBRING_CLIENT_SECRET; else process.env.SPACEBRING_CLIENT_SECRET = saved.secret;
    delete require.cache[require.resolve('../netlify/functions/_spacebring')];
  }
});
