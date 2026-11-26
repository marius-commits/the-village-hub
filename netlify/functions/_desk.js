// Desk sign-ups: the four desk plans, what each costs on the current offer,
// and the checks on a sign-up before it is saved.
//
// A desk needs no compliance check, so there are no documents and no review
// step. A sign-up is accepted the moment it is saved. What still has to happen
// is the Spacebring subscription, the invoice and the payment, and those are
// tracked on the same application record as every other membership.
//
// Titles must match Spacebring exactly. Prices exclude 15% VAT.

const VAT = 0.15;

// Sign-ups on the offer close at the end of this day, South African time.
const OFFER_ENDS = '2026-12-31';
const OFFER_MONTHS = 12;

// kind: 'pass'    a set number of desk days a month, booked day by day
//       'monthly' a desk every working day
const PLANS = {
  'Village Wanderer': { label: '5 desk days a month',  kind: 'pass',    days: 5,  list: 1000, percentOff: 30, code: 'PASS30' },
  'Village Visitor':  { label: '10 desk days a month', kind: 'pass',    days: 10, list: 1600, percentOff: 30, code: 'PASS30' },
  'Village Local':    { label: 'Any desk, every day',  kind: 'monthly', days: null, list: 3000, percentOff: 50, code: 'DESK50' },
  'Village Resident': { label: 'Your own dedicated desk', kind: 'monthly', days: null, list: 3500, percentOff: 50, code: 'DESK50' },
};

const PLAN_TITLES = Object.keys(PLANS);

// Coupons created in Spacebring on 26 Nov 2026. The automatic set-up grants
// the coupon on the subscription item, so the member never types a code.
const COUPON_REFS = {
  DESK50: process.env.SPACEBRING_COUPON_DESK50 || '502adc5a-97d2-411d-bda0-42ede6b627ad',
  PASS30: process.env.SPACEBRING_COUPON_PASS30 || 'f59d0f6a-02bc-487e-80e7-abc0835aa3db',
};

function round2(n) { return Math.round(n * 100) / 100; }

// South African date (UTC+2, no daylight saving) as YYYY-MM-DD.
function sastDate(d) {
  return new Date(d.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

function offerOpen(now) {
  return sastDate(now || new Date()) <= OFFER_ENDS;
}

// Everything an email or a page needs to state the price of one plan.
function offer(planTitle, now) {
  const p = PLANS[planTitle];
  if (!p) return null;
  const open = offerOpen(now);
  const price = open ? round2(p.list * (100 - p.percentOff) / 100) : p.list;
  return {
    plan: planTitle,
    label: p.label,
    kind: p.kind,
    days: p.days,
    list: p.list,
    price,
    priceInclVat: round2(price * (1 + VAT)),
    percentOff: open ? p.percentOff : 0,
    months: open ? OFFER_MONTHS : 0,
    code: open ? p.code : null,
    couponRef: open ? (COUPON_REFS[p.code] || null) : null,
    discounted: open,
  };
}

// R1,750 or R2,012.50: thousands comma, cents only when there are any.
function rand(n) {
  const fixed = Number(n).toFixed(2);
  const [whole, cents] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return 'R' + grouped + (cents === '00' ? '' : '.' + cents);
}

function validEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

// South African numbers arrive as 082 123 4567, +27 82 123 4567 or 27821234567.
// Anything with 9 to 15 digits is accepted so a foreign number is not refused.
function validPhone(v) {
  if (typeof v !== 'string') return false;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

// A start date is optional. A date in the past, or more than six months out,
// is treated as "as soon as possible" and stored as null, never refused.
function startDate(value, now) {
  if (!value || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(value + 'T00:00:00Z');
  if (Number.isNaN(t)) return null;
  // Reject impossible dates such as 2026-02-31, which Date.parse rolls over.
  if (new Date(t).toISOString().slice(0, 10) !== value) return null;
  const today = sastDate(now || new Date());
  if (value < today) return null;
  const limit = sastDate(new Date((now || new Date()).getTime() + 183 * 86400_000));
  if (value > limit) return null;
  return value;
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max || 500);
}

// Returns { row } ready to insert, or { error } with a sentence for the person.
function parse(payload, now) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const plan = clean(p.plan, 80);
  if (!PLANS[plan]) return { error: 'Please choose one of the four desk plans.' };

  const firstName = clean(p.first_name, 80);
  const lastName  = clean(p.last_name, 80);
  const email     = clean(p.email, 160);
  const phone     = clean(p.phone, 40);

  if (!firstName || !lastName) return { error: 'Please give your first and last name.' };
  if (!validEmail(email || '')) return { error: 'Please give a valid email address.' };
  if (!validPhone(phone || '')) return { error: 'Please give a contact number we can reach you on.' };
  if (p.popia_consent !== true) return { error: 'Please tick the box to let us use your details to set up your membership.' };
  if (p.terms_accepted !== true) return { error: 'Please accept the membership terms to sign up.' };

  return {
    row: {
      type: 'desk',
      plan,
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      phone,
      company_name: clean(p.company_name, 160),
      preferred_start_date: startDate(p.preferred_start_date, now),
      popia_consent_at: (now || new Date()).toISOString(),
      popia_consent_version: '2026-11-desk',
      source_page: clean(p.source_page, 200),
      utm: p.utm && typeof p.utm === 'object' && !Array.isArray(p.utm) ? p.utm : null,
    },
  };
}

// The hidden field a person never sees. A script that fills every input
// fills this one too.
function looksAutomated(payload) {
  return Boolean(payload && typeof payload.website_url === 'string' && payload.website_url.trim());
}

module.exports = {
  PLANS, PLAN_TITLES, COUPON_REFS, OFFER_ENDS, OFFER_MONTHS, VAT,
  offer, offerOpen, rand, round2, sastDate,
  validEmail, validPhone, startDate, clean, parse, looksAutomated,
};
