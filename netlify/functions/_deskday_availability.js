// Which hot desk seats are taken on one day, per product.
//
// A hot desk resource in Spacebring has seats (8 each). A slot is free while
// fewer seats are booked at every moment of it than the resource has.
//
// Two sources, merged:
//   Spacebring   every tentative or confirmed booking of the resource,
//                with its seat count. The calendar of record.
//   our table    website bookings not yet in Spacebring (automation off,
//                or the seconds before the hold is made).
//
// Only times and counts leave this module. Never who booked.

const D = require('./_deskday');

const SOFT_HOLD_HOURS = 48;

// Most seats in use at any moment between start and end.
function seatsUsed(list, start, end) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  const points = [];
  for (const b of list || []) {
    const bs = Math.max(new Date(b.start).getTime(), s);
    const be = Math.min(new Date(b.end).getTime(), e);
    if (!(be > bs)) continue;
    const n = Number(b.seats) > 0 ? Number(b.seats) : 1;
    points.push([bs, n], [be, -n]);
  }
  // Ends before starts at the same instant: touching bookings do not overlap.
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, most = 0;
  for (const [, n] of points) { now += n; if (now > most) most = now; }
  return most;
}

function isFree(productKey, list, start, end, seats) {
  return seatsUsed(list, start, end) + (seats || 1) <= D.PRODUCTS[productKey].seats;
}

// io: { now, select(query), listBookings({resourceRef, from, to}), spacebringReady() }
async function busy(date, io) {
  const from = D.instant(date, 0).toISOString();
  const to = D.instant(date, 24 * 60).toISOString();
  const products = {}; for (const k of D.PRODUCT_KEYS) products[k] = [];

  let live = false;
  if (io.spacebringReady()) {
    try {
      const lists = await Promise.all(D.PRODUCT_KEYS.map(k => io.listBookings({ resourceRef: D.PRODUCTS[k].resourceRef, from, to })));
      D.PRODUCT_KEYS.forEach((k, i) => {
        for (const b of lists[i] || []) {
          if (b && b.startDate && b.endDate && !b.deleteDate) products[k].push({ start: b.startDate, end: b.endDate, seats: b.seats || 1 });
        }
      });
      live = true;
    } catch (err) {
      console.error('desk availability: Spacebring read failed:', err.message);
    }
  }

  try {
    const softFrom = new Date(io.now().getTime() - SOFT_HOLD_HOURS * 3600_000).toISOString();
    const own = await io.select(
      `starts_at=lt.${to}&ends_at=gt.${from}&status=in.(received,held,confirmed,needs_attention)` +
      '&select=product,starts_at,ends_at,seats,status,created_at,spacebring');
    for (const r of own || []) {
      if (!products[r.product]) continue;
      const inSpacebring = live && r.spacebring && r.spacebring.booking_id && !String(r.spacebring.booking_id).startsWith('dry-');
      if (inSpacebring) continue;
      const soft = r.status === 'received' || r.status === 'needs_attention';
      if (soft && r.created_at < softFrom) continue;
      products[r.product].push({ start: r.starts_at, end: r.ends_at, seats: r.seats || 1 });
    }
  } catch (err) {
    console.error('desk availability: own bookings read failed:', err.message);
  }
  return { products, live };
}

// What the page needs for one day. Every option listed can be booked.
function dayView(date, result, now) {
  const open = D.isOpenDay(date);
  const view = {
    date, weekday: D.weekday(date), bookable_online: open, live: result.live,
    open: D.hhmm(D.OPEN_MIN), close: D.hhmm(D.CLOSE_MIN),
    hour: { rate: D.PRODUCTS.hour.rate, starts: [] },
    half: { price: D.PRODUCTS.half.price, options: [] },
    day: { price: D.PRODUCTS.day.price, free: false },
  };
  if (!open) return view;
  const P = result.products;

  for (let s = D.OPEN_MIN; s + D.PRODUCTS.hour.min <= D.CLOSE_MIN; s += D.STEP_MIN) {
    const ok = D.slotFor({ product: 'hour', date, start: D.hhmm(s), duration_minutes: D.PRODUCTS.hour.min }, now);
    if (ok.error) continue;
    let max = 0;
    for (let d = D.PRODUCTS.hour.min; d <= D.PRODUCTS.hour.max && s + d <= D.CLOSE_MIN; d += D.STEP_MIN) {
      if (!isFree('hour', P.hour, D.instant(date, s), D.instant(date, s + d))) break;
      max = d;
    }
    if (max) view.hour.starts.push({ start: D.hhmm(s), max_minutes: max });
  }

  for (const h of Object.values(D.HALVES)) {
    const ok = D.slotFor({ product: 'half', date, half: h.key }, now);
    const free = !ok.error && isFree('half', P.half, D.instant(date, h.start), D.instant(date, h.end));
    view.half.options.push({ key: h.key, label: h.label, start: D.hhmm(h.start), end: D.hhmm(h.end), free });
  }

  const day = D.slotFor({ product: 'day', date }, now);
  view.day.free = !day.error && isFree('day', P.day, D.instant(date, day.startMin), D.instant(date, day.endMin));
  return view;
}

module.exports = { busy, dayView, seatsUsed, isFree, SOFT_HOLD_HOURS };
