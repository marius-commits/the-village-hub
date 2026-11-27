const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../netlify/functions/_deskday');
const A = require('../netlify/functions/_deskday_availability');
const F = require('../netlify/functions/_deskday_flow');
const E = require('../netlify/functions/_deskday_emails');
const S = require('../netlify/functions/submit-desk-day');

const NOW = new Date('2026-11-27T08:00:00Z'); // Friday 10:00 SAST
const MON = '2026-11-30';
const root = path.join(__dirname, '..');

function good(over) {
  return {
    product: 'hour', date: MON, start: '09:00', duration_minutes: 120,
    first_name: 'Thandi', last_name: 'Mokoena', email: 'Thandi@Example.co.za', phone: '082 123 4567',
    terms_accepted: true, popia_consent: true, ...over,
  };
}
function seats(n, start, end) { return Array.from({ length: n }, () => ({ start, end, seats: 1 })); }

// ---------- rules ----------------------------------------------------------

test('prices: R60 an hour, R150 a half day, R250 a full day, VAT on top', () => {
  assert.deepEqual(D.price('hour', 90), { exVat: 90, vat: 13.5, inclVat: 103.5, hours: 1.5 });
  assert.equal(D.price('half', 240).exVat, 150);
  assert.equal(D.price('day', 870).exVat, 250);
  assert.equal(D.price('day', 870).inclVat, 287.5);
});

test('an hourly booking is saved with South African times and the right price', () => {
  const r = D.parse(good(), NOW).row;
  assert.equal(r.starts_at, '2026-11-30T07:00:00.000Z'); // 09:00 SAST
  assert.equal(r.ends_at, '2026-11-30T09:00:00.000Z');
  assert.equal(r.amount_ex_vat, 120);
  assert.equal(r.email, 'thandi@example.co.za');
  assert.equal(r.resource_ref, D.PRODUCTS.hour.resourceRef);
  assert.equal(r.seats, 1);
});

test('half days are the morning or the afternoon', () => {
  const m = D.parse(good({ product: 'half', half: 'morning' }), NOW).row;
  assert.equal(D.slotText(m.starts_at, m.ends_at), '08:00 to 12:00');
  const a = D.parse(good({ product: 'half', half: 'afternoon' }), NOW).row;
  assert.equal(D.slotText(a.starts_at, a.ends_at), '13:00 to 17:00');
  assert.match(D.parse(good({ product: 'half', half: 'evening' }), NOW).error, /morning or the afternoon/);
});

test('a full day books the desk the way the member app does, 06:30 to 21:00', () => {
  const r = D.parse(good({ product: 'day' }), NOW).row;
  assert.equal(D.slotText(r.starts_at, r.ends_at), '06:30 to 21:00');
  assert.equal(r.amount_ex_vat, 250);
});

test('a full day for today starts at the next half hour and closes at midday', () => {
  const r = D.parse(good({ product: 'day', date: '2026-11-27' }), new Date('2026-11-27T07:10:00Z')).row; // 09:10
  assert.equal(D.timeText(r.starts_at), '09:30');
  assert.match(D.parse(good({ product: 'day', date: '2026-11-27' }), new Date('2026-11-27T10:00:00Z')).error, /until 12:00/);
});

test('what cannot be booked online is refused with a sentence a person can act on', () => {
  const cases = [
    [{ product: 'desk' }, /hour, a half day or a full day/],
    [{ date: '2026-11-28' }, /Monday to Friday/],            // Saturday
    [{ date: '2026-11-26' }, /already passed/],
    [{ date: '2027-06-01' }, /three months ahead/],
    [{ start: '07:30' }, /between 08:00 and 17:00/],
    [{ start: '15:30', duration_minutes: 120 }, /between 08:00 and 17:00/],
    [{ start: '09:15' }, /hour or half hour/],
    [{ duration_minutes: 30 }, /one and three hours/],
    [{ duration_minutes: 240 }, /half day is cheaper/],
    [{ date: '2026-11-27', start: '10:30' }, /at least an hour/],
    [{ product: 'half', half: 'morning', date: '2026-11-27' }, /too soon/],
    [{ email: 'nope' }, /valid email/],
    [{ phone: '123' }, /mobile number/],
    [{ billing: 'company' }, /company name/],
    [{ terms_accepted: false }, /booking terms/],
    [{ popia_consent: false }, /tick the box/],
  ];
  for (const [over, re] of cases) assert.match(D.parse(good(over), NOW).error || '', re, JSON.stringify(over));
  assert.equal(D.parse(good({ start: '15:00', duration_minutes: 120 }), NOW).error, undefined); // ends 17:00 exactly
});

test('the hold lasts 24 hours, or until 30 minutes before the desk, never under 30 minutes', () => {
  assert.equal(D.holdExpiry(NOW, '2026-12-03T07:00:00Z').toISOString(), '2026-11-28T08:00:00.000Z');
  assert.equal(D.holdExpiry(NOW, '2026-11-27T12:00:00Z').toISOString(), '2026-11-27T11:30:00.000Z');
  assert.equal(D.holdExpiry(NOW, '2026-11-27T08:30:00Z').toISOString(), '2026-11-27T08:30:00.000Z');
});

// ---------- availability --------------------------------------------------

test('seats: a slot is free while fewer than 8 seats are taken at every moment', () => {
  const list = [...seats(7, '2026-11-30T07:00:00Z', '2026-11-30T09:00:00Z'), { start: '2026-11-30T08:00:00Z', end: '2026-11-30T10:00:00Z', seats: 1 }];
  assert.equal(A.seatsUsed(list, '2026-11-30T06:00:00Z', '2026-11-30T12:00:00Z'), 8);
  assert.equal(A.isFree('hour', list, '2026-11-30T08:00:00Z', '2026-11-30T09:00:00Z'), false);
  assert.equal(A.isFree('hour', list, '2026-11-30T09:00:00Z', '2026-11-30T10:00:00Z'), true); // touching ends do not clash
  assert.equal(A.seatsUsed([{ start: '2026-11-30T07:00:00Z', end: '2026-11-30T09:00:00Z', seats: 3 }], '2026-11-30T07:00:00Z', '2026-11-30T08:00:00Z'), 3);
});

test('the day view lists only what can really be booked', () => {
  const full = seats(8, '2026-11-30T08:00:00Z', '2026-11-30T09:00:00Z'); // 10:00 to 11:00 SAST
  const v = A.dayView(MON, { products: { hour: full, half: seats(8, '2026-11-30T11:00:00Z', '2026-11-30T15:00:00Z'), day: [] }, live: true }, NOW);
  const starts = Object.fromEntries(v.hour.starts.map(s => [s.start, s.max_minutes]));
  assert.equal(starts['08:00'], 120);
  assert.equal(starts['09:00'], 60);
  assert.equal(starts['09:30'], undefined);
  assert.equal(starts['10:30'], undefined);
  assert.equal(starts['11:00'], 180);
  assert.equal(starts['16:00'], 60);
  assert.equal(starts['16:30'], undefined);
  assert.deepEqual(v.half.options.map(o => [o.key, o.free]), [['morning', true], ['afternoon', false]]);
  assert.equal(v.day.free, true);
});

test('today only offers what is far enough ahead, and weekends offer nothing', () => {
  const v = A.dayView('2026-11-27', { products: { hour: [], half: [], day: [] }, live: true }, NOW);
  assert.equal(v.hour.starts[0].start, '11:00');
  assert.equal(v.half.options[0].free, false);
  const sat = A.dayView('2026-11-28', { products: { hour: [], half: [], day: [] }, live: true }, NOW);
  assert.equal(sat.bookable_online, false);
  assert.equal(sat.hour.starts.length, 0);
});

test('website bookings not yet in Spacebring still take a seat; old abandoned ones do not', async () => {
  const io = {
    now: () => NOW,
    spacebringReady: () => true,
    listBookings: async ({ resourceRef }) => resourceRef === D.PRODUCTS.hour.resourceRef
      ? seats(6, '2026-11-30T07:00:00Z', '2026-11-30T09:00:00Z').map(x => ({ startDate: x.start, endDate: x.end, seats: 1 }))
      : [],
    select: async () => [
      { product: 'hour', starts_at: '2026-11-30T07:00:00Z', ends_at: '2026-11-30T08:00:00Z', seats: 1, status: 'received', created_at: NOW.toISOString(), spacebring: {} },
      { product: 'hour', starts_at: '2026-11-30T07:00:00Z', ends_at: '2026-11-30T08:00:00Z', seats: 1, status: 'held', created_at: NOW.toISOString(), spacebring: { booking_id: 'sb-1' } },
      { product: 'hour', starts_at: '2026-11-30T07:00:00Z', ends_at: '2026-11-30T08:00:00Z', seats: 1, status: 'received', created_at: '2026-11-20T08:00:00Z', spacebring: {} },
    ],
  };
  const r = await A.busy(MON, io);
  assert.equal(r.products.hour.length, 7);
  assert.equal(A.isFree('hour', r.products.hour, '2026-11-30T07:00:00Z', '2026-11-30T08:00:00Z'), true);
});

// ---------- submit ---------------------------------------------------------

function submitIo(opts) {
  const o = opts || {};
  const rows = [], sent = [], events = [], leads = [];
  let n = 0;
  return {
    rows, sent, events, leads,
    now: () => NOW, wait: async () => {},
    mode: () => o.mode || 'off',
    spacebringReady: () => true,
    select: async (q) => (/starts_at=eq/.test(q) ? (o.dupe ? [o.dupe] : []) : (o.recent || [])),
    insert: async (row) => { if (o.insertFails) throw new Error('db'); const b = { id: 'id' + (++n), reference: 'HD-2026-00' + (50 + n), created_at: NOW.toISOString(), spacebring: {}, steps: {}, ...row }; rows.push(b); return b; },
    update: async (id, patch) => Object.assign(rows.find(r => r.id === id) || {}, patch),
    log: async (id, type, actor, detail) => events.push([type, detail]),
    busy: async () => ({ products: { hour: o.full ? seats(8, '2026-11-30T07:00:00Z', '2026-11-30T09:00:00Z') : [], half: [], day: [] }, live: true }),
    provision: async (b) => {
      if (o.provision) return o.provision(b);
      b.spacebring = { invoice_title: 'INV-77' }; b.status = 'held'; return { state: 'held' };
    },
    send: async (args) => { sent.push(args); return o.failMail ? { error: 'resend down' } : { id: 'm' + sent.length }; },
    insertLead: async (row) => leads.push(row),
    staffEmails: ['marius@brick-field.co.za', 'christel@villagehub.co.za', 'francois@brick-field.co.za', 'schalk@villagehub.co.za'],
    notifyEmail: 'hello@villagehub.co.za',
  };
}

test('automation off: saved, person and team emailed, lead recorded, nothing sent to Spacebring', async () => {
  const io = submitIo();
  let provisioned = false; io.provision = async () => { provisioned = true; };
  const r = await S.run(good(), io);
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'received');
  assert.equal(r.body.price_ex_vat, 120);
  assert.equal(provisioned, false);
  assert.equal(io.sent.length, 2);
  assert.match(io.sent[0].subject, /We have your desk booking/);
  assert.equal(io.sent[1].to.length, 4);
  assert.match(io.sent[1].html, /To do in Spacebring/);
  assert.equal(io.leads[0].product, 'hot_desk');
  assert.ok(io.rows[0].notified_at);
});

test('automation live: the desk is held and the person is told to pay to confirm', async () => {
  const io = submitIo({ mode: 'live' });
  const r = await S.run(good({ product: 'day' }), io);
  assert.equal(r.body.state, 'held');
  assert.match(io.sent[0].subject, /Your desk is held: pay to confirm/);
  assert.match(io.sent[1].html, /Nothing to do yet/);
  assert.ok(r.body.hold_expires_at);
});

test('a full slot is refused before anything is saved', async () => {
  const io = submitIo({ full: true });
  const r = await S.run(good(), io);
  assert.equal(r.status, 409);
  assert.equal(io.rows.length, 0);
  assert.equal(io.sent.length, 0);
});

test('Spacebring saying the seat went at the last moment is a clash, not a booking', async () => {
  const io = submitIo({ mode: 'live', provision: async () => ({ state: 'clash' }) });
  const r = await S.run(good(), io);
  assert.equal(r.status, 409);
  assert.equal(io.sent.length, 0);
});

test('a stopped set-up still tells both sides honestly', async () => {
  const io = submitIo({ mode: 'live', provision: async () => ({ state: 'attention', message: 'Spacebring 500' }) });
  const r = await S.run(good(), io);
  assert.equal(r.body.state, 'attention');
  assert.match(io.sent[0].subject, /We have your desk booking/);
  assert.match(io.sent[1].html, /Needs attention/);
});

test('double click returns the first reference; spam and bots go nowhere', async () => {
  const dup = submitIo({ dupe: { reference: 'HD-2026-0009', status: 'held' } });
  const r = await S.run(good(), dup);
  assert.equal(r.body.reference, 'HD-2026-0009');
  assert.equal(dup.rows.length, 0);
  const bot = submitIo();
  await S.run(good({ website_url: 'spam' }), bot);
  assert.equal(bot.rows.length, 0);
  const many = submitIo({ recent: [1, 2, 3, 4] });
  assert.equal((await S.run(good(), many)).status, 429);
});

test('failed emails retry, then the team alert falls back to the shared inbox', async () => {
  const io = submitIo({ failMail: true });
  const r = await S.run(good(), io);
  assert.equal(r.status, 200);
  assert.equal(r.body.email_sent, false);
  assert.deepEqual(io.sent[io.sent.length - 1].to, ['hello@villagehub.co.za']);
  assert.equal(io.rows[0].notified_at, undefined);
});

test('a failed save is an error to the person, and nobody is emailed', async () => {
  const io = submitIo({ insertFails: true });
  const r = await S.run(good(), io);
  assert.equal(r.status, 500);
  assert.equal(io.sent.length, 0);
});

// ---------- hold, invoice, payment ----------------------------------------

function booking(over) {
  const row = D.parse(good(), NOW).row;
  return { id: 'b1', reference: 'HD-2026-0051', created_at: NOW.toISOString(), mode: 'live', spacebring: {}, steps: {}, ...row, ...over };
}

function deps(opts) {
  const o = opts || {};
  const calls = [], mails = [], logs = [];
  const sb = {
    findMembershipByEmail: async () => o.member || null,
    findCompanyByTitle: async () => null,
    createCompany: async (x) => { calls.push(['createCompany', x]); return { id: 'co-1' }; },
    createMembership: async (x) => { calls.push(['createMembership', x]); return { id: 'mem-1' }; },
    checkAvailability: async (x) => { calls.push(['checkAvailability', x]); return { available: o.available !== false, reason: o.available === false ? { message: 'no seats' } : null }; },
    createBooking: async (x) => { calls.push(['createBooking', x]); return { id: 'bk-1' }; },
    createInvoice: async (x) => { calls.push(['createInvoice', x]); return { id: 'inv-1', totalAmount: o.total !== undefined ? o.total : 138 }; },
    issueInvoice: async (id) => { calls.push(['issueInvoice', id]); return { id, title: 'INV-77', pdfUrl: 'https://x/inv.pdf' }; },
    getInvoice: async () => ({ id: 'inv-1', status: o.invoiceStatus || 'issued', title: 'INV-77' }),
    updateBooking: async (id, x) => { calls.push(['updateBooking', id, x]); return {}; },
    cancelBooking: async (id) => { calls.push(['cancelBooking', id]); },
    voidInvoice: async (id) => { calls.push(['voidInvoice', id]); },
  };
  const mail = new Proxy({}, { get: (_, k) => async (...a) => { mails.push(k); return { id: 'm' }; } });
  return {
    calls, mails, logs,
    d: {
      sb, mail,
      now: () => o.now || NOW,
      mode: () => o.mode || 'live',
      autoRelease: () => o.autoRelease !== false,
      store: { save: async () => {}, select: async () => o.rows || [], log: async (id, t) => logs.push(t) },
    },
  };
}

test('provision: customer, seat check with quantity, seat booked, invoice checked and issued', async () => {
  const b = booking();
  const { d, calls } = deps();
  const r = await F.provision(b, d);
  assert.equal(r.state, 'held');
  assert.deepEqual(calls.map(c => c[0]), ['createMembership', 'checkAvailability', 'createBooking', 'createInvoice', 'issueInvoice']);
  assert.equal(calls[0][1].type, 'nonmember');
  assert.equal(calls[1][1].quantity, 1);
  assert.equal(calls[2][1].seats, 1);
  assert.match(calls[2][1].title, /^HOLD unpaid: Thandi Mokoena \(HD-2026-0051\)/);
  assert.equal(calls[3][1].items[0].unitAmount, 120);
  assert.equal(calls[3][1].items[0].title, `Hot desk, by the hour, ${D.dayText('2026-11-30T07:00:00Z')}, 09:00 to 11:00 (HD-2026-0051)`);
  assert.equal(b.status, 'held');
  assert.equal(b.spacebring.invoice_title, 'INV-77');
});

test('provision: a company invoice goes to the company', async () => {
  const b = booking({ billing: 'company', company_name: 'Mokoena Design', company_vat: '4123456789' });
  const { d, calls } = deps();
  await F.provision(b, d);
  assert.equal(calls.find(c => c[0] === 'createInvoice')[1].companyRef, 'co-1');
});

test('provision: no seat left means a clash and nothing booked', async () => {
  const b = booking();
  const { d, calls } = deps({ available: false });
  const r = await F.provision(b, d);
  assert.equal(r.state, 'clash');
  assert.ok(!calls.some(c => c[0] === 'createBooking'));
});

test('provision: a wrong invoice total stops before the invoice is issued', async () => {
  const b = booking();
  const { d, calls, mails } = deps({ total: 120 });
  const r = await F.provision(b, d);
  assert.equal(r.state, 'attention');
  assert.ok(!calls.some(c => c[0] === 'issueInvoice'));
  assert.deepEqual(mails, ['attention']);
});

test('provision: a retry never creates the booking twice', async () => {
  const b = booking({ steps: { customer: {}, booking: {} }, spacebring: { membership_ref: 'mem-1', booking_id: 'bk-1' } });
  const { d, calls } = deps();
  await F.provision(b, d);
  assert.deepEqual(calls.map(c => c[0]), ['createInvoice', 'issueInvoice']);
});

test('dry mode records every step and sends nothing to Spacebring', async () => {
  const b = booking();
  const { d, calls } = deps({ mode: 'dry' });
  const r = await F.provision(b, d);
  assert.equal(r.state, 'dry');
  assert.equal(calls.length, 0);
});

test('sync: paid confirms, retitles and tells both sides once', async () => {
  const b = booking({ status: 'held', spacebring: { booking_id: 'bk-1', invoice_id: 'inv-1' }, hold_expires_at: '2026-11-28T08:00:00Z' });
  const { d, calls, mails } = deps({ invoiceStatus: 'paid' });
  const r = await F.sync(b, d);
  assert.equal(r.state, 'confirmed');
  assert.equal(calls[0][0], 'updateBooking');
  assert.deepEqual(mails, ['confirmed', 'staffPaid']);
});

test('sync: one reminder at half time, then release at expiry with the invoice voided', async () => {
  const held = () => booking({ status: 'held', spacebring: { booking_id: 'bk-1', invoice_id: 'inv-1' }, hold_expires_at: '2026-11-28T08:00:00Z' });
  const half = deps({ now: new Date('2026-11-27T20:30:00Z') });
  const b = held();
  assert.equal((await F.sync(b, half.d)).state, 'held');
  assert.deepEqual(half.mails, ['reminder']);
  assert.equal((await F.sync(b, half.d)).changed, false);

  const late = deps({ now: new Date('2026-11-28T08:01:00Z') });
  const r = await F.sync(held(), late.d);
  assert.equal(r.state, 'released');
  assert.deepEqual(late.calls.map(c => c[0]), ['cancelBooking', 'voidInvoice']);
  assert.deepEqual(late.mails, ['released', 'staffLapsed']);
});

test('sync: a short same-day hold gets no reminder, only release', async () => {
  const b = booking({ status: 'held', spacebring: { booking_id: 'bk-1', invoice_id: 'inv-1' }, hold_expires_at: '2026-11-27T08:40:00Z' });
  const { d, mails } = deps({ now: new Date('2026-11-27T08:25:00Z') });
  assert.equal((await F.sync(b, d)).changed, false);
  assert.deepEqual(mails, []);
});

test('the scheduled run does nothing unless DESK_BOOKING is live', async () => {
  const { d } = deps({ mode: 'off' });
  assert.deepEqual(await F.run(d), { skipped: true });
});

// ---------- emails and the page -------------------------------------------

test('emails: plain about the hold, the invoice, the hours and the Wi-Fi; no em dashes; no injected markup', () => {
  const b = booking({ first_name: '<b>x</b>', status: 'held', hold_expires_at: '2026-11-28T08:00:00Z' });
  const pr = D.price('hour', 120);
  const all = [E.held(b, pr, {}), E.received(b, pr), E.staffNew(b, pr, {}), E.confirmed(b, pr), E.staffPaid(b, pr), E.reminder(b, pr, {}), E.released(b, pr, 'https://x'), E.staffLapsed(b, pr, { released: true }), E.attention(b, 'booking', 'x')];
  for (const m of all) {
    assert.doesNotMatch(m.subject + m.html, /—/);
    assert.doesNotMatch(m.html, /<b>x<\/b>/);
  }
  assert.ok(E.held(b, pr, {}).html.includes(`We hold the desk until 10:00 on ${D.dayText('2026-11-28T08:00:00Z')}`));
  assert.match(E.confirmed(b, pr).html, /08:00 to 17:00/);
  assert.match(E.confirmed(b, pr).html, /The Village Hub Guest/);
  assert.ok(E.staffNew(b, pr, {}).html.includes(`Book Village Moment for ${D.dayText('2026-11-30T07:00:00Z')}, 09:00 to 11:00`));
});

test('the page sells the same prices the server charges, books through the website and never through the member portal', () => {
  const html = fs.readFileSync(path.join(root, 'hot-desk-stellenbosch.html'), 'utf8');
  assert.match(html, /var DAY = \{ hour: \{ title: 'By the hour', rate: 60 \}, half: \{ title: 'Half day', price: 150 \}, day: \{ title: 'Full day', price: 250 \} \}/);
  assert.equal(D.PRODUCTS.hour.rate, 60);
  assert.equal(D.PRODUCTS.half.price, 150);
  assert.equal(D.PRODUCTS.day.price, 250);
  assert.ok(html.includes("'/.netlify/functions/submit-desk-day'"));
  assert.ok(html.includes("'/.netlify/functions/submit-desk'"));
  assert.ok(html.includes('/.netlify/functions/desk-availability?date='));
  assert.doesNotMatch(html, /members\.villagehub\.co\.za\/suite/);
  assert.doesNotMatch(html, /—/);
  for (const b of html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    JSON.parse(b.replace(/<\/?script[^>]*>/g, ''));
  }
});

test('old sign-up links land on the combined page, and the boardroom still books as before', () => {
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/apply-desk"\s+to = "\/hot-desk-stellenbosch"\s+status = 301/);
  assert.ok(!fs.existsSync(path.join(root, 'apply-desk.html')));
  for (const f of ['pricing.html', 'your-desk-2027.html']) {
    const h = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(h, /apply-desk/, f);
    assert.doesNotMatch(h, /members\.villagehub\.co\.za\/suite\/organizations\/[^"]+\/desks"/, f);
  }
});

test('the Spacebring client only adds seat fields when asked, so boardroom calls are unchanged', () => {
  const src = fs.readFileSync(path.join(root, 'netlify/functions/_spacebring.js'), 'utf8');
  assert.match(src, /\.\.\.\(quantity \? \{ quantity \} : \{\}\)/);
  assert.match(src, /\.\.\.\(seats \? \{ seats \} : \{\}\)/);
});
