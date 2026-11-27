// What is already taken in each room on one day.
//
// Two sources, merged:
//   Spacebring   every tentative or confirmed booking of the room. This is
//                the calendar of record: members, staff and the Google
//                Calendar sync all write to it.
//   our table    requests saved through the website that are not yet a
//                Spacebring booking (automation off, or the seconds before
//                the hold is made). Without these two people could be shown
//                the same free slot.
//
// Only times ever leave this module. Never who booked or why.

const B = require('./_boardroom');

// A saved request with no Spacebring booking yet blocks its slot online for
// this long. After that the team has either booked it or let it go.
const SOFT_HOLD_HOURS = 48;

function merge(intervals) {
  const sorted = intervals
    .map(i => ({ start: new Date(i.start).getTime(), end: new Date(i.end).getTime() }))
    .filter(i => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out.map(i => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() }));
}

// io: { now, select(query), listBookings({resourceRef, from, to}), spacebringReady() }
// Returns { rooms: { boardroom: [{start,end}], chamber: [...] }, live }
async function busy(date, io) {
  const from = B.instant(date, 0).toISOString();
  const to   = B.instant(date, 24 * 60).toISOString();
  const rooms = {}; for (const k of B.ROOM_KEYS) rooms[k] = [];

  let live = false;
  if (io.spacebringReady()) {
    try {
      const lists = await Promise.all(B.ROOM_KEYS.map(k => io.listBookings({ resourceRef: B.ROOMS[k].resourceRef, from, to })));
      B.ROOM_KEYS.forEach((k, i) => {
        for (const b of lists[i] || []) {
          if (b && b.startDate && b.endDate && !b.deleteDate) rooms[k].push({ start: b.startDate, end: b.endDate });
        }
      });
      live = true;
    } catch (err) {
      console.error('boardroom availability: Spacebring read failed:', err.message);
    }
  }

  try {
    const softFrom = new Date(io.now().getTime() - SOFT_HOLD_HOURS * 3600_000).toISOString();
    const own = await io.select(
      `route=eq.instant&starts_at=lt.${to}&ends_at=gt.${from}&status=in.(received,held,confirmed,needs_attention)` +
      '&select=room_key,starts_at,ends_at,status,created_at,spacebring');
    for (const r of own || []) {
      if (!rooms[r.room_key]) continue;
      const inSpacebring = live && r.spacebring && r.spacebring.booking_id && !String(r.spacebring.booking_id).startsWith('dry-');
      if (inSpacebring) continue; // already counted above
      const soft = r.status === 'received' || r.status === 'needs_attention';
      if (soft && r.created_at < softFrom) continue;
      rooms[r.room_key].push({ start: r.starts_at, end: r.ends_at });
    }
  } catch (err) {
    console.error('boardroom availability: own holds read failed:', err.message);
  }

  for (const k of B.ROOM_KEYS) rooms[k] = merge(rooms[k]);
  return { rooms, live };
}

// What the page needs for one day, in South African wall-clock times.
function dayView(date, result, now) {
  const day = B.weekday(date);
  const dayStart = B.instant(date, 0).getTime();
  const clip = (iso) => Math.max(0, Math.min(24 * 60, Math.round((new Date(iso).getTime() - dayStart) / 60000)));
  return {
    date,
    weekday: day,
    bookable_online: day >= 1 && day <= 5,
    open: B.hhmm(B.OPEN_MIN),
    close: B.hhmm(B.CLOSE_MIN),
    step_minutes: B.STEP_MIN,
    min_minutes: B.MIN_DURATION,
    // The earliest start that can still be held online today, as minutes.
    earliest_minutes: B.sastDate(now) === date
      ? Math.ceil((now.getTime() + B.MIN_LEAD_MIN * 60_000 - dayStart) / 60000 / B.STEP_MIN) * B.STEP_MIN
      : 0,
    live: result.live,
    rooms: B.ROOM_KEYS.map(k => ({
      key: k,
      title: B.ROOMS[k].title,
      capacity: B.ROOMS[k].capacity,
      rate: B.ROOMS[k].rate,
      busy: result.rooms[k].map(i => ({ start: B.hhmm(clip(i.start)), end: B.hhmm(clip(i.end)), start_min: clip(i.start), end_min: clip(i.end) })),
    })),
  };
}

module.exports = { busy, dayView, merge, SOFT_HOLD_HOURS };
