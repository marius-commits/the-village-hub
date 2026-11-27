// POST /.netlify/functions/submit-boardroom
//
// One call from the booking page. By the time it returns the request is
// saved, the person has an email and the team has been told. With
// BOARDROOM_BOOKING=live the room is also held in Spacebring and the invoice
// has gone out.
//
// Order matters. The row is saved first and nothing after that can lose it.
// Every later step records its own failure and never turns a saved request
// into an error for the person.

const L  = require('./_lib');
const SB = require('./_spacebring');
const B  = require('./_boardroom');
const A  = require('./_boardroom_availability');
const F  = require('./_boardroom_flow');
const E  = require('./_boardroom_emails');
const Live = require('./_boardroom_live');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One retry. A booking nobody hears about is the failure this exists to
// prevent, and most email failures are a blip.
async function sendTwice(send, args, wait) {
  let r = await send(args);
  if (r && r.error) {
    await (wait || sleep)(700);
    r = await send(args);
  }
  return { ok: Boolean(r) && !r.error && !r.skipped, skipped: Boolean(r && r.skipped), error: (r && r.error) || null };
}
const WA = '063 260 3513';

// The first room that seats the group and is free for the whole slot.
// A named room is tried first; "either" walks the rooms smallest first.
function chooseRoom(choice, guests, busy, start, end) {
  const order = B.ROOMS[choice]
    ? [B.ROOMS[choice]]
    : B.roomsFor(guests);
  for (const room of order) {
    if (room.capacity < guests) continue;
    if (!B.overlaps(busy.rooms[room.key], start, end)) return room;
  }
  return null;
}

async function saveLead(io, b, pr) {
  try {
    await io.insertLead({
      source: b.utm && (b.utm.gclid || /cpc|paid|google_ads/i.test(b.utm.utm_medium || '')) ? 'google_ads' : 'website',
      source_detail: 'Boardroom booking form',
      landing_page: b.source_page,
      product: b.route === 'quote' && b.guests > B.MAX_ROOM_GUESTS ? 'event' : 'boardroom',
      first_name: b.first_name, last_name: b.last_name, company: b.company_name,
      email: b.email, phone: b.phone,
      preferred_date: B.sastDate(new Date(b.starts_at)),
      message: [
        `Boardroom ${b.route === 'quote' ? 'quote request' : 'booking'} ${b.reference}`,
        `${b.room_title || 'Room to be confirmed'}, ${B.dayText(b.starts_at)}, ${B.slotText(b.starts_at, b.ends_at)}, ${b.guests} guests`,
        pr ? `${B.rand(pr.exVat)} excl. VAT` : 'Price on quote',
        `Catering: ${B.CATERING[b.catering]}`,
      ].join('\n'),
      utm_source: (b.utm && b.utm.utm_source) || null, utm_medium: (b.utm && b.utm.utm_medium) || null,
      utm_campaign: (b.utm && b.utm.utm_campaign) || null, utm_term: (b.utm && b.utm.utm_term) || null,
      utm_content: (b.utm && b.utm.utm_content) || null, gclid: (b.utm && b.utm.gclid) || null,
    });
  } catch (err) { console.error('submit-boardroom lead copy failed (non-blocking):', err.message); }
}

async function run(payload, io) {
  const now = io.now();

  if (B.looksAutomated(payload)) return { status: 200, body: { reference: 'BR-0000', route: 'instant', state: 'received' } };

  const parsed = B.parse(payload, now);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const row = parsed.row;
  const mode = io.mode();
  row.mode = mode;

  // The same person pressing the button twice gets the reference they have.
  try {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const dupes = await io.select(
      `email=eq.${encodeURIComponent(row.email)}&starts_at=eq.${encodeURIComponent(row.starts_at)}&created_at=gte.${tenMinutesAgo}` +
      '&select=id,reference,route,status,room_title&order=created_at.desc&limit=1');
    if (dupes && dupes.length) {
      return { status: 200, body: { reference: dupes[0].reference, route: dupes[0].route, state: dupes[0].status, room: dupes[0].room_title, already_received: true } };
    }
    const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
    const recent = await io.select(`email=eq.${encodeURIComponent(row.email)}&created_at=gte.${hourAgo}&select=id`);
    if (recent && recent.length >= 4) {
      return { status: 429, body: { error: `You have sent a few requests just now. WhatsApp us on ${WA} and we will sort it out.` } };
    }
  } catch (err) { console.error('submit-boardroom duplicate check failed, allowing through:', err.message); }

  // Instant route: the slot has to be free right now, in a room that fits.
  let pr = null;
  if (row.route === 'instant') {
    const date = B.sastDate(new Date(row.starts_at));
    const busy = await io.busy(date);
    const room = chooseRoom(parsed.room_choice, row.guests, busy, row.starts_at, row.ends_at);
    if (!room) {
      return { status: 409, body: { code: 'taken', error: 'That slot has just been taken. Please choose another time, or the other room.' } };
    }
    row.room_key = room.key; row.room_title = room.title; row.resource_ref = room.resourceRef;
    pr = B.price(room.key, Math.round((new Date(row.ends_at) - new Date(row.starts_at)) / 60000));
    row.rate = pr.rate; row.amount_ex_vat = pr.exVat; row.amount_incl_vat = pr.inclVat;
    row.hold_expires_at = B.holdExpiry(now, row.starts_at).toISOString();
  }

  // 1. Save.
  let b;
  try { b = await io.insert(row); }
  catch (err) {
    console.error('submit-boardroom insert failed:', err.message);
    return { status: 500, body: { error: `We could not save your booking. Please try again, or WhatsApp us on ${WA}.` } };
  }
  await io.log(b.id, 'submitted', 'person', { route: b.route, room: b.room_key, mode });

  // 2. Hold the room and issue the invoice, when the automation is on.
  let state = b.route === 'quote' ? 'quote' : 'received';
  let attention = null;
  if (b.route === 'instant' && mode !== 'off' && (mode === 'dry' || io.spacebringReady())) {
    try {
      const r = await io.provision(b);
      if (r.state === 'held') state = 'held';
      else if (r.state === 'dry') state = 'dry';
      else if (r.state === 'clash') {
        return { status: 409, body: { code: 'taken', error: 'That slot was taken a moment ago. Please choose another time, or the other room.' } };
      } else if (r.state === 'attention') { state = 'attention'; attention = r.message; }
    } catch (err) {
      console.error('submit-boardroom provision failed:', err.message);
      state = 'attention'; attention = err.message;
    }
  }

  // 3. The Village Table, when they asked for a quote and an address is set.
  let villageTableTold = false;
  if (b.catering === 'village_table' && io.villageTableEmails.length) {
    const vt = E.villageTable(b);
    const r = await sendTwice(io.send, { to: io.villageTableEmails, cc: [io.notifyEmail], subject: vt.subject, html: vt.html, replyTo: b.email }, io.wait);
    villageTableTold = r.ok;
    await io.log(b.id, 'village_table_intro', 'system', { sent: r.ok });
  }

  // 4. Tell the person and tell the team. Independent of each other.
  const sbRefs = b.spacebring || {};
  const toPerson = b.route === 'quote' ? E.quote(b)
    : state === 'held' ? E.held(b, pr, { invoiceTitle: sbRefs.invoice_title, invoiceUrl: sbRefs.invoice_pdf_url })
    : E.received(b, pr);
  const toStaff = E.staffNew(b, pr, {
    state, message: attention, invoiceTitle: sbRefs.invoice_title,
    existingMember: Boolean(sbRefs.existing_member), villageTableTold,
  });
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
  catch (err) { console.error('submit-boardroom notified_at failed:', err.message); }
  await io.log(b.id, 'emails_sent', 'system', { person: person.ok, staff: staffTold });

  // 5. Into the lead list, so the command centre and the daily digest see it.
  await saveLead(io, b, pr);

  return {
    status: 200,
    body: {
      reference: b.reference,
      route: b.route,
      state,
      room: b.room_title,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      price_ex_vat: pr ? pr.exVat : null,
      price_incl_vat: pr ? pr.inclVat : null,
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
    mode: () => B.mode(),
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
    villageTableEmails: Live.VILLAGE_TABLE_EMAILS,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return L.bad('Method Not Allowed', 405);
  if (!L.configured()) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return L.bad(`Online booking is temporarily unavailable. Please WhatsApp us on ${WA}.`, 503);
  }
  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return L.bad('Invalid request body'); }
  try {
    const result = await run(payload, liveIo());
    return { statusCode: result.status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result.body) };
  } catch (err) {
    console.error('submit-boardroom failed:', err.message);
    return L.bad(`Something went wrong on our side. Please WhatsApp us on ${WA}.`, 500);
  }
};

exports.run = run;
exports.chooseRoom = chooseRoom;
