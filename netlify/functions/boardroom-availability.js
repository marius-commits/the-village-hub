// GET /.netlify/functions/boardroom-availability?date=YYYY-MM-DD
//
// Public. Returns the taken times in each boardroom for one day, so the
// booking page can show what is free. Times only: never names or titles.

const L  = require('./_lib');
const SB = require('./_spacebring');
const B  = require('./_boardroom');
const A  = require('./_boardroom_availability');

// A warm function instance answers repeat questions about the same day from
// memory for a few seconds, so a busy page cannot hammer Spacebring.
const CACHE_MS = 20_000;
const cache = new Map();

function io() {
  return {
    now: () => new Date(),
    select: (query) => L.selectRows('boardroom_bookings', query),
    listBookings: (args) => SB.listBookings(args),
    spacebringReady: () => SB.credentialsSet(),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  const date = (event.queryStringParameters || {}).date;
  if (!B.validDate(date)) return L.bad('Give a date as YYYY-MM-DD.');
  const now = new Date();
  if (date < B.sastDate(now)) return L.bad('That date has passed.');
  if (date > B.sastDate(new Date(now.getTime() + B.BOOK_AHEAD_DAYS * 86400_000))) return L.bad('We take bookings up to six months ahead.');

  const hit = cache.get(date);
  let result = hit && now.getTime() - hit.at < CACHE_MS ? hit.result : null;
  if (!result) {
    result = L.configured() || SB.credentialsSet() ? await A.busy(date, io()) : { rooms: { boardroom: [], chamber: [] }, live: false };
    cache.set(date, { at: now.getTime(), result });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' },
    body: JSON.stringify(A.dayView(date, result, now)),
  };
};
