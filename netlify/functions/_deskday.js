// Hot desk bookings by the hour, the half day or the full day, taken on
// villagehub.co.za/hot-desk-stellenbosch. The same principle as the
// boardroom (_boardroom.js): live availability from Spacebring, the desk is
// held, an invoice goes out, payment confirms it.
//
// The three products are three hot desk resources in Spacebring, each with
// its own seats. Ids, seat counts and prices were read from Spacebring on
// 27 Nov 2026. Prices exclude 15% VAT, like every other Village Hub price.
//
// Online bookings follow the front desk: Monday to Friday, 08:00 to 17:00.

const VAT = 0.15;
const SAST_OFFSET_MS = 2 * 3600_000; // UTC+2, no daylight saving

const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 17 * 60;
const STEP_MIN = 30;
// An hour or half-day booking has to start at least this far ahead, so the
// hold, the invoice and the Wi-Fi code have time to happen.
const MIN_LEAD_MIN = 60;
// A full day for today can be booked until midday.
const FULL_DAY_TODAY_UNTIL = 12 * 60;
const BOOK_AHEAD_DAYS = 90;

// The full day is booked the way Spacebring books a day pass from the member
// app: the whole of the desk's schedule, 06:30 to 21:00.
const DAY_FROM = 6 * 60 + 30;
const DAY_TO = 21 * 60;

const PRODUCTS = {
  hour: {
    key: 'hour', title: 'By the hour', spacebring: 'Village Moment',
    rate: 60, unit: 'hour', min: 60, max: 180,
    seats: Number(process.env.DESK_SEATS_HOUR || 8),
    resourceRef: process.env.SPACEBRING_DESK_HOUR || '5ae584ff-79e5-4755-a1ed-9dcf5fcccf10',
  },
  half: {
    key: 'half', title: 'Half day', spacebring: 'Village Drifter',
    price: 150, unit: 'fixed', minutes: 240,
    seats: Number(process.env.DESK_SEATS_HALF || 8),
    resourceRef: process.env.SPACEBRING_DESK_HALF || 'cc998e49-2242-4042-a998-e0dc1ac34fd8',
  },
  day: {
    key: 'day', title: 'Full day', spacebring: 'Village Nomad',
    price: 250, unit: 'fixed',
    seats: Number(process.env.DESK_SEATS_DAY || 8),
    resourceRef: process.env.SPACEBRING_DESK_DAY || '47b9f33c-9545-41bf-a9f1-dd7b25c71232',
  },
};
const PRODUCT_KEYS = Object.keys(PRODUCTS);

const HALVES = {
  morning:   { key: 'morning',   label: 'Morning',   start: 8 * 60,  end: 12 * 60 },
  afternoon: { key: 'afternoon', label: 'Afternoon', start: 13 * 60, end: 17 * 60 },
};

function round2(n) { return Math.round(n * 100) / 100; }

function rand(n) {
  const fixed = Number(n).toFixed(2);
  const [whole, cents] = fixed.split('.');
  return 'R' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (cents === '00' ? '' : '.' + cents);
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max || 500) : null;
}

function validEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()); }
function validPhone(v) {
  if (typeof v !== 'string') return false;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function sastDate(d) { return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10); }
function sastMinutes(d) {
  const t = new Date(d.getTime() + SAST_OFFSET_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}
function weekday(dateStr) { return new Date(dateStr + 'T12:00:00Z').getUTCDay(); }
function minutesOf(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3));
  return h > 23 || m > 59 ? null : h * 60 + m;
}
function hhmm(mins) { return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); }
function instant(dateStr, mins) { return new Date(Date.parse(dateStr + 'T00:00:00Z') + mins * 60_000 - SAST_OFFSET_MS); }

function dayText(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
}
function timeText(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
}
function slotText(start, end) { return `${timeText(start)} to ${timeText(end)}`; }

// What a booking costs. minutes only matters by the hour.
function price(productKey, minutes) {
  const p = PRODUCTS[productKey];
  if (!p) return null;
  const exVat = p.unit === 'hour' ? round2(p.rate * minutes / 60) : p.price;
  return { exVat, vat: round2(exVat * VAT), inclVat: round2(exVat * (1 + VAT)), hours: round2(minutes / 60) };
}

// How the booking reads to a person: "2 hours, 09:00 to 11:00".
function describe(b) {
  if (b.product === 'day') return 'Full day';
  if (b.product === 'half') return `Half day, ${slotText(b.starts_at, b.ends_at)}`;
  const h = round2((new Date(b.ends_at) - new Date(b.starts_at)) / 3600_000);
  return `${h} ${h === 1 ? 'hour' : 'hours'}, ${slotText(b.starts_at, b.ends_at)}`;
}

function isOpenDay(dateStr) { const d = weekday(dateStr); return d >= 1 && d <= 5; }

// The slot a choice books, as South African minutes, or { error }.
// p: { product, date, start, duration_minutes, half }
function slotFor(p, now) {
  const at = now || new Date();
  const today = sastDate(at);
  const nowMin = sastMinutes(at);
  if (!PRODUCTS[p.product]) return { error: 'Please choose an hour, a half day or a full day.' };
  if (!validDate(p.date)) return { error: 'Please choose a date.' };
  if (p.date < today) return { error: 'That date has already passed. Please choose another.' };
  if (p.date > sastDate(new Date(at.getTime() + BOOK_AHEAD_DAYS * 86400_000))) {
    return { error: 'We take desk bookings up to three months ahead. Please choose an earlier date.' };
  }
  if (!isOpenDay(p.date)) return { error: 'Online desk bookings are for Monday to Friday. For a weekend, WhatsApp us on 063 260 3513.' };

  if (p.product === 'day') {
    if (p.date === today && nowMin >= FULL_DAY_TODAY_UNTIL) {
      return { error: 'A full day for today can be booked until 12:00. Book a few hours instead, or choose another day.' };
    }
    // Today: from the next half hour. Never before the desk opens.
    const from = p.date === today ? Math.max(DAY_FROM, Math.ceil((nowMin + 1) / STEP_MIN) * STEP_MIN) : DAY_FROM;
    return { startMin: from, endMin: DAY_TO };
  }

  if (p.product === 'half') {
    const h = HALVES[p.half];
    if (!h) return { error: 'Please choose the morning or the afternoon.' };
    if (p.date === today && h.start < nowMin + MIN_LEAD_MIN) {
      return { error: 'That half day starts too soon to book online. Choose the afternoon, another day, or WhatsApp us.' };
    }
    return { startMin: h.start, endMin: h.end, half: h.key };
  }

  const startMin = minutesOf(p.start);
  if (startMin === null || startMin % STEP_MIN !== 0) return { error: 'Please choose a start time on the hour or half hour.' };
  const duration = Number(p.duration_minutes);
  const P = PRODUCTS.hour;
  if (!Number.isInteger(duration) || duration < P.min || duration > P.max || duration % STEP_MIN !== 0) {
    return { error: 'Please choose between one and three hours. For longer, the half day is cheaper.' };
  }
  if (startMin < OPEN_MIN || startMin + duration > CLOSE_MIN) {
    return { error: 'Hourly bookings are between 08:00 and 17:00.' };
  }
  if (p.date === today && startMin < nowMin + MIN_LEAD_MIN) {
    return { error: 'That time is too soon to book online. Choose a start at least an hour from now.' };
  }
  return { startMin, endMin: startMin + duration };
}

// An unpaid hold lasts 24 hours, or until 30 minutes before the booking if
// that is sooner, and never less than 30 minutes from now.
function holdExpiry(now, start) {
  const hours = Number(process.env.DESK_HOLD_HOURS || 24);
  const byAge = now.getTime() + hours * 3600_000;
  const byStart = new Date(start).getTime() - 30 * 60_000;
  return new Date(Math.max(Math.min(byAge, byStart), now.getTime() + 30 * 60_000));
}

// Returns { row } ready to save, or { error } for the person.
function parse(payload, now) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const at = now || new Date();

  const slot = slotFor({
    product: clean(p.product, 10), date: p.date, start: p.start,
    duration_minutes: p.duration_minutes, half: clean(p.half, 12),
  }, at);
  if (slot.error) return { error: slot.error };

  const firstName = clean(p.first_name, 80), lastName = clean(p.last_name, 80);
  const email = clean(p.email, 160), phone = clean(p.phone, 40);
  if (!firstName || !lastName) return { error: 'Please give your first and last name.' };
  if (!validEmail(email || '')) return { error: 'Please give a valid email address. Your invoice goes there.' };
  if (!validPhone(phone || '')) return { error: 'Please give a mobile number. Your Wi-Fi code comes by WhatsApp on the day.' };

  const billing = p.billing === 'company' ? 'company' : 'personal';
  const companyName = clean(p.company_name, 160);
  if (billing === 'company' && !companyName) return { error: 'Please give the company name for the invoice.' };

  if (p.popia_consent !== true) return { error: 'Please tick the box to let us use your details for this booking.' };
  if (p.terms_accepted !== true) return { error: 'Please accept the booking terms.' };

  const product = PRODUCTS[p.product];
  const start = instant(p.date, slot.startMin), end = instant(p.date, slot.endMin);
  const pr = price(product.key, slot.endMin - slot.startMin);
  return {
    row: {
      product: product.key,
      product_title: product.title,
      resource_ref: product.resourceRef,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      seats: 1,
      status: 'received',
      billing,
      company_name: billing === 'company' ? companyName : null,
      company_vat: billing === 'company' ? clean(p.company_vat, 40) : null,
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      phone,
      notes: clean(p.notes, 1000),
      amount_ex_vat: pr.exVat,
      amount_incl_vat: pr.inclVat,
      hold_expires_at: holdExpiry(at, start).toISOString(),
      popia_consent_at: at.toISOString(),
      popia_consent_version: '2026-11-desk-day',
      source_page: clean(p.source_page, 200),
      utm: p.utm && typeof p.utm === 'object' && !Array.isArray(p.utm) ? p.utm : null,
    },
  };
}

function looksAutomated(payload) {
  return Boolean(payload && typeof payload.website_url === 'string' && payload.website_url.trim());
}

// off: saved, the team books and invoices by hand.
// dry: every Spacebring step is worked out and recorded, nothing is sent.
// live: hold, invoice and confirmation happen on their own.
function mode() {
  const m = String(process.env.DESK_BOOKING || 'off').toLowerCase();
  return m === 'live' || m === 'dry' ? m : 'off';
}
function autoRelease() { return String(process.env.DESK_AUTO_RELEASE || 'true').toLowerCase() !== 'false'; }

module.exports = {
  VAT, OPEN_MIN, CLOSE_MIN, STEP_MIN, MIN_LEAD_MIN, FULL_DAY_TODAY_UNTIL, BOOK_AHEAD_DAYS,
  DAY_FROM, DAY_TO, PRODUCTS, PRODUCT_KEYS, HALVES,
  round2, rand, clean, validEmail, validPhone, sastDate, sastMinutes, validDate, weekday,
  minutesOf, hhmm, instant, dayText, timeText, slotText, price, describe, isOpenDay,
  slotFor, holdExpiry, parse, looksAutomated, mode, autoRelease,
};
