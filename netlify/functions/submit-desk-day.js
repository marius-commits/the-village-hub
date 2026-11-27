// POST /.netlify/functions/submit-desk-day
//
// A hot desk by the hour, half day or full day, from the desk page. By the
// time this returns the booking is saved, the person has an email and the
// team has been told. With DESK_BOOKING=live the seat is also held in
// Spacebring and the invoice has gone out.
//
// The row is saved first and nothing after that can lose it.

const L  = require('./_lib');
const SB = require('./_spacebring');
const D  = require('./_deskday');
const A  = require('./_deskday_availability');
const F  = require('./_deskday_flow');
const E  = require('./_deskday_emails');
const Live = require('./_deskday_live');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const WA = '063 260 3513';

async function sendTwice(send, args, wait) {
  let r = await send(args);
  if (r && r.error) { await (wait || sleep)(700); r = await send(args); }
  return { ok: Boolean(r) && !r.error && !r.skipped, skipped: Boolean(r && r.skipped), error: (r && r.error) || null };
}

async function saveLead(io, b, pr) {
  try {
    const u = b.utm || {};
    await io.insertLead({
      source: u.gclid || /cpc|paid|google_ads/i.test(u.utm_medium || '') ? 'google_ads' : 'website',
      source_detail: 'Hot desk booking form',
      landing_page: b.source_page,
      product: 'hot_desk',
      first_name: b.first_name, last_name: b.last_name, company: b.company_name,
      email: b.email, phone: b.phone,
      preferred_date: D.sastDate(new Date(b.starts_at)),
      message: [`Hot desk booking ${b.reference}`, `${D.PRODUCTS[b.product].title}, ${D.dayText(b.starts_at)}, ${D.describe(b)}`, `${D.rand(pr.exVat)} excl. VAT`].join('\n'),
      utm_source: u.utm_source || null, utm_medium: u.utm_medium || null, utm_campaign: u.utm_campaign || null,
      utm_term: u.utm_term || null, utm_content: u.utm_content || null, gclid: u.gclid || null,
    });
  } catch (err) { console.error('submit-desk-day lead copy failed (non-blocking):', err.message); }
}

async function run(payload, io) {
  const now = io.now();
  if (D.looksAutomated(payload)) return { status: 200, body: { reference: 'HD-0000', state: 'received' } };

  const parsed = D.parse(payload, now);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const row = parsed.row;
  const mode = io.mode();
  row.mode = mode;

  try {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const dupes = await io.select(
      `email=eq.${encodeURIComponent(row.email)}&starts_at=eq.${encodeURIComponent(row.starts_at)}&product=eq.${row.product}&created_at=gte.${tenMinutesAgo}` +
      '&select=id,reference,status&order=created_at.desc&limit=1');
    if (dupes && dupes.length) return { status: 200, body: { reference: dupes[0].reference, state: dupes[0].status, already_received: true } };
    const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
    const recent = await io.select(`email=eq.${encodeURIComponent(row.email)}&created_at=gte.${hourAgo}&select=id`);
    if (recent && recent.length >= 4) return { status: 429, body: { error: `You have made a few bookings just now. WhatsApp us on ${WA} and we will sort it out.` } };
  } catch (err) { console.error('submit-desk-day duplicate check failed, allowing through:', err.message); }

  // A seat has to be free right now.
  const date = D.sastDate(new Date(row.starts_at));
  const busy = await io.busy(date);
  if (!A.isFree(row.product, busy.products[row.product], row.starts_at, row.ends_at, row.seats)) {
    return { status: 409, body: { code: 'taken', error: 'That slot has just filled up. Please choose another time.' } };
  }
  const pr = D.price(row.product, Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000));

  let b;
  try { b = await io.insert(row); }
  catch (err) {
    console.error('submit-desk-day insert failed:', err.message);
    return { status: 500, body: { error: `We could not save your booking. Please try again, or WhatsApp us on ${WA}.` } };
  }
  await io.log(b.id, 'submitted', 'person', { product: b.product, mode });

  let state = 'received', attention = null;
  if (mode !== 'off' && (mode === 'dry' || io.spacebringReady())) {
    try {
      const r = await io.provision(b);
      if (r.state === 'held') state = 'held';
      else if (r.state === 'dry') state = 'dry';
      else if (r.state === 'clash') return { status: 409, body: { code: 'taken', error: 'That slot filled up a moment ago. Please choose another time.' } };
      else if (r.state === 'attention') { state = 'attention'; attention = r.message; }
    } catch (err) {
      console.error('submit-desk-day provision failed:', err.message);
      state = 'attention'; attention = err.message;
    }
  }

  const refs = b.spacebring || {};
  const toPerson = state === 'held' ? E.held(b, pr, { invoiceTitle: refs.invoice_title, invoiceUrl: refs.invoice_pdf_url }) : E.received(b, pr);
  const toStaff = E.staffNew(b, pr, { state, message: attention, invoiceTitle: refs.invoice_title, existingMember: Boolean(refs.existing_member) });
  const [person, staff] = await Promise.all([
    sendTwice(io.send, { to: b.email, subject: toPerson.subject, html: toPerson.html, replyTo: io.notifyEmail, client: true }, io.wait),
    sendTwice(io.send, { to: io.staffEmails, subject: toStaff.subject, html: toStaff.html, replyTo: b.email }, io.wait),
  ]);
  let staffTold = staff.ok;
  if (!staffTold && !staff.skipped) {
    const last = await sendTwice(io.send, { to: [io.notifyEmail], subject: toStaff.subject, html: toStaff.html, replyTo: b.email }, io.wait);
    staffTold = last.ok;
  }
  try { if (person.ok) await io.update(b.id, { notified_at: now.toISOString() }); }
  catch (err) { console.error('submit-desk-day notified_at failed:', err.message); }
  await io.log(b.id, 'emails_sent', 'system', { person: person.ok, staff: staffTold });

  await saveLead(io, b, pr);

  return {
    status: 200,
    body: {
      reference: b.reference, state, product: b.product,
      starts_at: b.starts_at, ends_at: b.ends_at,
      price_ex_vat: pr.exVat, price_incl_vat: pr.inclVat,
      hold_expires_at: state === 'held' ? b.hold_expires_at : null,
      email_sent: person.ok,
    },
  };
}

function liveIo() {
  const availabilityIo = {
    now: () => new Date(),
    select: (query) => L.selectRows(Live.TABLE, query),
    listBookings: (args) => SB.listBookings(args),
    spacebringReady: () => SB.credentialsSet(),
  };
  return {
    now: () => new Date(),
    wait: sleep,
    mode: () => D.mode(),
    spacebringReady: () => SB.credentialsSet(),
    select: (query) => L.selectRows(Live.TABLE, query),
    insert: (row) => L.insertRow(Live.TABLE, row),
    update: (id, patch) => L.updateRows(Live.TABLE, `id=eq.${id}`, patch),
    log: Live.logEvent,
    busy: (date) => A.busy(date, availabilityIo),
    provision: (b) => F.provision(b, Live.deps()),
    send: (args) => L.sendEmail(args),
    insertLead: (row) => L.insertRow('leads', row),
    staffEmails: L.STAFF_EMAILS,
    notifyEmail: L.NOTIFY_EMAIL,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad(`Online booking is temporarily unavailable. Please WhatsApp us on ${WA}.`, 503);
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return L.bad('Invalid request body'); }
  try {
    const result = await run(payload, liveIo());
    return { statusCode: result.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.body) };
  } catch (err) {
    console.error('submit-desk-day failed:', err.message);
    return L.bad(`Something went wrong on our side. Please WhatsApp us on ${WA}.`, 500);
  }
};

exports.run = run;
