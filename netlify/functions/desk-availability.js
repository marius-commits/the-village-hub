// GET /.netlify/functions/desk-availability?date=YYYY-MM-DD
//
// Public. What can be booked at a hot desk on one day: start times by the
// hour, the two half days, the full day. Times only, never who booked.

const L  = require('./_lib');
const SB = require('./_spacebring');
const D  = require('./_deskday');
const A  = require('./_deskday_availability');
const Live = require('./_deskday_live');

const CACHE_MS = 20_000;
const cache = new Map();

function io() {
  return {
    now: () => new Date(),
    select: (query) => L.selectRows(Live.TABLE, query),
    listBookings: (args) => SB.listBookings(args),
    spacebringReady: () => SB.credentialsSet(),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return L.bad('Method Not Allowed', 405);
  const date = (event.queryStringParameters || {}).date;
  if (!D.validDate(date)) return L.bad('Give a date as YYYY-MM-DD.');
  const now = new Date();
  if (date < D.sastDate(now)) return L.bad('That date has passed.');
  if (date > D.sastDate(new Date(now.getTime() + D.BOOK_AHEAD_DAYS * 86400_000))) return L.bad('We take desk bookings up to three months ahead.');

  const hit = cache.get(date);
  let result = hit && now.getTime() - hit.at < CACHE_MS ? hit.result : null;
  if (!result) {
    result = L.configured() || SB.credentialsSet() ? await A.busy(date, io()) : { products: { hour: [], half: [], day: [] }, live: false };
    cache.set(date, { at: now.getTime(), result });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' },
    body: JSON.stringify(A.dayView(date, result, now)),
  };
};
