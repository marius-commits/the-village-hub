// Boardroom bookings: the two rooms, what they cost, when they can be booked
// online, and the checks on a request before it is saved.
//
// Two routes come out of the same form:
//   instant  a weekday slot in one of the two rooms, inside opening hours.
//            The slot is held, an invoice goes out, payment confirms it.
//   quote    anything a person has to price or arrange: more than 12 guests,
//            a Saturday (the open floor is price on application), after
//            hours, or a start time too close to hold online.
//
// Room ids and hourly rates were read from Spacebring on 27 Nov 2026.
// Prices exclude 15% VAT, like every other Village Hub price.

const VAT = 0.15;
const SAST_OFFSET_MS = 2 * 3600_000; // UTC+2, no daylight saving

const ROOMS = {
  boardroom: {
    key: 'boardroom', title: 'Village Boardroom', capacity: 12, rate: 390,
    resourceRef: process.env.SPACEBRING_ROOM_BOARDROOM || '4df41e21-761b-4d05-88e8-6b698a980a0a',
  },
  chamber: {
    key: 'chamber', title: 'Village Chamber', capacity: 10, rate: 350,
    resourceRef: process.env.SPACEBRING_ROOM_CHAMBER || '5fe3771b-ee30-4c7d-853a-a7c846f23b6e',
  },
};
const ROOM_KEYS = Object.keys(ROOMS);
const MAX_ROOM_GUESTS = 12;
const MAX_EVENT_GUESTS = 60;

// Online booking hours, South African time, Monday to Friday.
const OPEN_MIN  = 8 * 60;
const CLOSE_MIN = 17 * 60;
const STEP_MIN = 30;
const MIN_DURATION = 60;
// A slot that starts sooner than this cannot wait for an invoice to be paid.
const MIN_LEAD_MIN = 60;
const BOOK_AHEAD_DAYS = 183;

const MEETING_TYPES = {
  board_meeting:  'Board or management meeting',
  client_meeting: 'Client meeting or pitch',
  strategy:       'Strategy or planning session',
  workshop:       'Training or workshop',
  interviews:     'Interviews',
  video_call:     'Video conference',
  corporate_event:'Corporate event',
  other:          'Something else',
};

// Only what the rooms actually have. Coffee, tea, water, Wi-Fi and parking
// are included with every booking, so they are not choices.
const NEEDS = {
  screen:     'Screen to present on (HDMI or USB-C)',
  video_call: 'Video call set-up (camera and room audio)',
  setup_help: 'Someone to help us set up on arrival',
};

const CATERING = {
  none:          'No catering',
  own:           'We bring our own',
  village_table: 'Quote from The Village Table, the restaurant downstairs',
};

function round2(n) { return Math.round(n * 100) / 100; }

function rand(n) {
  const fixed = Number(n).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return 'R' + grouped + (cents === '00' ? '' : '.' + cents);
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max || 500);
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function validPhone(v) {
  if (typeof v !== 'string') return false;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function sastDate(d) {
  return new Date(d.getTime() + SAST_OFFSET_MS).toISOString().slice(0, 10);
}

// A real calendar date, YYYY-MM-DD. 2026-02-31 is refused.
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

// 0 Sunday to 6 Saturday, for a calendar date.
function weekday(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

function minutesOf(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3));
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function hhmm(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

// The UTC instant of a South African wall-clock time.
function instant(dateStr, mins) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + mins * 60_000 - SAST_OFFSET_MS);
}

// "Thursday 3 December 2026" and "09:00 to 11:30", in South African time.
function dayText(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
}
function timeText(d) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
}
function slotText(start, end) { return `${timeText(start)} to ${timeText(end)}`; }

function price(roomKey, minutes) {
  const room = ROOMS[roomKey];
  if (!room) return null;
  const hours = round2(minutes / 60);
  const exVat = round2(room.rate * minutes / 60);
  return { rate: room.rate, hours, exVat, vat: round2(exVat * VAT), inclVat: round2(exVat * (1 + VAT)) };
}

// busy: [{ start, end }] as ISO strings or Dates. Touching ends do not clash.
function overlaps(busy, start, end) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  return (busy || []).some(b => new Date(b.start).getTime() < e && new Date(b.end).getTime() > s);
}

// Rooms that seat the group, smallest first, so ten people are offered the
// Chamber before the Boardroom.
function roomsFor(guests) {
  return ROOM_KEYS.map(k => ROOMS[k]).filter(r => r.capacity >= guests).sort((a, b) => a.capacity - b.capacity);
}

// Why a request cannot be held online. Empty means it can.
function quoteReasons({ date, startMin, duration, guests, now }) {
  const reasons = [];
  const day = weekday(date);
  if (guests > MAX_ROOM_GUESTS) reasons.push('more_than_12_guests');
  if (day === 6) reasons.push('saturday');
  if (day === 0) reasons.push('sunday');
  if (startMin < OPEN_MIN || startMin + duration > CLOSE_MIN) reasons.push('outside_hours');
  const start = instant(date, startMin);
  if (start.getTime() - now.getTime() < MIN_LEAD_MIN * 60_000) reasons.push('short_notice');
  return reasons;
}

// An unpaid hold lasts 24 hours, or until two hours before the meeting if
// that is sooner, and never less than 30 minutes.
function holdExpiry(now, start) {
  const hours = Number(process.env.BOARDROOM_HOLD_HOURS || 24);
  const byAge = now.getTime() + hours * 3600_000;
  const byStart = new Date(start).getTime() - 2 * 3600_000;
  return new Date(Math.max(Math.min(byAge, byStart), now.getTime() + 30 * 60_000));
}

// Returns { row, route, reasons } ready to save, or { error } for the person.
function parse(payload, now) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const at = now || new Date();

  if (!validDate(p.date)) return { error: 'Please choose the date of your meeting.' };
  const today = sastDate(at);
  if (p.date < today) return { error: 'That date has already passed. Please choose another.' };
  if (p.date > sastDate(new Date(at.getTime() + BOOK_AHEAD_DAYS * 86400_000))) {
    return { error: 'We take bookings up to six months ahead. Please choose an earlier date.' };
  }

  const startMin = minutesOf(p.start);
  if (startMin === null || startMin % STEP_MIN !== 0) return { error: 'Please choose a start time on the hour or half hour.' };
  const duration = Number(p.duration_minutes);
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > 24 * 60 || duration % STEP_MIN !== 0) {
    return { error: 'Please choose how long you need the room. The minimum is one hour.' };
  }
  if (startMin + duration > 24 * 60) return { error: 'A booking has to end on the same day it starts.' };

  const guests = Number(p.guests);
  if (!Number.isInteger(guests) || guests < 1) return { error: 'Please tell us how many people are coming.' };
  if (guests > MAX_EVENT_GUESTS) return { error: 'We can host up to 60 guests. WhatsApp us on 063 260 3513 for anything larger.' };

  const meetingType = clean(p.meeting_type, 40);
  if (!MEETING_TYPES[meetingType]) return { error: 'Please choose the type of meeting or event.' };

  const catering = clean(p.catering, 20) || 'none';
  if (!CATERING[catering]) return { error: 'Please choose a catering option.' };

  const needs = Array.isArray(p.needs) ? p.needs.filter(n => NEEDS[n]).filter((n, i, a) => a.indexOf(n) === i) : [];

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

  const reasons = quoteReasons({ date: p.date, startMin, duration, guests, now: at });
  const route = reasons.length ? 'quote' : 'instant';

  // The room. On the quote route a room is only kept if it can seat the group.
  let roomKey = ROOMS[p.room] ? p.room : null;
  if (roomKey && ROOMS[roomKey].capacity < guests) roomKey = null;
  if (route === 'instant' && !roomKey) {
    const fits = roomsFor(guests);
    if (!fits.length) return { error: 'Neither room seats that many people.' };
    roomKey = null; // "either": the first free room that fits is chosen at save time
  }

  const start = instant(p.date, startMin), end = instant(p.date, startMin + duration);
  return {
    route,
    reasons,
    room_choice: roomKey || 'either',
    row: {
      route,
      status: route === 'quote' ? 'quote_requested' : 'received',
      room_key: roomKey,
      room_title: roomKey ? ROOMS[roomKey].title : (route === 'quote' && guests > MAX_ROOM_GUESTS ? 'Open floor' : null),
      resource_ref: roomKey ? ROOMS[roomKey].resourceRef : null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      guests,
      meeting_type: meetingType,
      needs,
      catering,
      catering_notes: clean(p.catering_notes, 600),
      notes: clean(p.notes, 1500),
      billing,
      company_name: billing === 'company' ? companyName : null,
      company_vat: billing === 'company' ? clean(p.company_vat, 40) : null,
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      phone,
      quote_reasons: reasons.length ? reasons : null,
      popia_consent_at: at.toISOString(),
      popia_consent_version: '2026-11-boardroom',
      source_page: clean(p.source_page, 200),
      utm: p.utm && typeof p.utm === 'object' && !Array.isArray(p.utm) ? p.utm : null,
    },
  };
}

function looksAutomated(payload) {
  return Boolean(payload && typeof payload.website_url === 'string' && payload.website_url.trim());
}

// off (default): requests are saved and the team books by hand.
// dry: every Spacebring step is worked out and recorded, nothing is sent.
// live: the hold, the invoice and the confirmation happen on their own.
function mode() {
  const m = String(process.env.BOARDROOM_BOOKING || 'off').toLowerCase();
  return m === 'live' || m === 'dry' ? m : 'off';
}

function autoRelease() {
  return String(process.env.BOARDROOM_AUTO_RELEASE || 'true').toLowerCase() !== 'false';
}

const REASON_TEXT = {
  more_than_12_guests: 'More than 12 guests, so this needs the open floor (Saturdays) or a tailored set-up',
  saturday: 'A Saturday. Saturday hire is quoted, not booked online',
  sunday: 'A Sunday. Sunday hire is by arrangement',
  outside_hours: 'Outside 08:00 to 17:00. After-hours hire is by arrangement',
  short_notice: 'Starts within the hour, too soon to hold online',
};

module.exports = {
  VAT, ROOMS, ROOM_KEYS, MAX_ROOM_GUESTS, MAX_EVENT_GUESTS,
  OPEN_MIN, CLOSE_MIN, STEP_MIN, MIN_DURATION, MIN_LEAD_MIN, BOOK_AHEAD_DAYS,
  MEETING_TYPES, NEEDS, CATERING, REASON_TEXT,
  round2, rand, clean, validEmail, validPhone, sastDate, validDate, weekday,
  minutesOf, hhmm, instant, dayText, timeText, slotText,
  price, overlaps, roomsFor, quoteReasons, holdExpiry, parse, looksAutomated,
  mode, autoRelease,
};
