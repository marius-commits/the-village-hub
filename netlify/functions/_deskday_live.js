// Wires the desk booking flow (_deskday_flow.js) to the real database,
// Spacebring and email. Kept apart so the flow stays testable with fakes.

const L  = require('./_lib');
const SB = require('./_spacebring');
const D  = require('./_deskday');
const E  = require('./_deskday_emails');

const TABLE = 'desk_day_bookings';

function bookUrl() { return `${L.SITE_URL}/hot-desk-stellenbosch#book`; }

async function logEvent(bookingId, eventType, actor, detail) {
  try {
    await L.insertRow('desk_day_booking_events', { booking_id: bookingId, event_type: eventType, actor: actor || 'system', detail: detail || null });
  } catch (err) { console.error('desk logEvent failed:', err.message); }
}

function toPerson(b, mail) { return L.sendEmail({ to: b.email, subject: mail.subject, html: mail.html, replyTo: L.NOTIFY_EMAIL, client: true }); }
function toStaff(b, mail) { return L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html, replyTo: b.email }); }

function deps() {
  return {
    sb: SB,
    now: () => new Date(),
    mode: () => D.mode(),
    autoRelease: () => D.autoRelease(),
    store: {
      save: (id, patch) => L.updateRows(TABLE, `id=eq.${id}`, patch),
      select: (query) => L.selectRows(TABLE, query),
      log: logEvent,
    },
    mail: {
      held: (b, pr) => toPerson(b, E.held(b, pr, { invoiceTitle: b.spacebring && b.spacebring.invoice_title, invoiceUrl: b.spacebring && b.spacebring.invoice_pdf_url })),
      confirmed: (b, pr) => toPerson(b, E.confirmed(b, pr)),
      staffPaid: (b, pr) => toStaff(b, E.staffPaid(b, pr)),
      reminder: (b, pr, o) => toPerson(b, E.reminder(b, pr, o)),
      released: (b, pr) => toPerson(b, E.released(b, pr, bookUrl())),
      staffLapsed: (b, pr, o) => toStaff(b, E.staffLapsed(b, pr, o)),
      attention: (b, step, message) => toStaff(b, E.attention(b, step, message)),
    },
  };
}

module.exports = { deps, logEvent, bookUrl, TABLE };
