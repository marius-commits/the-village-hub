// Wires the boardroom flow (_boardroom_flow.js) to the real database, the
// real Spacebring client and real email. Kept apart so the flow stays
// testable with fakes.

const L  = require('./_lib');
const SB = require('./_spacebring');
const B  = require('./_boardroom');
const E  = require('./_boardroom_emails');

const TABLE = 'boardroom_bookings';

// The restaurant downstairs. Only emailed when this is set in Netlify.
const VILLAGE_TABLE_EMAILS = (process.env.VILLAGE_TABLE_EMAIL || '')
  .split(',').map(e => e.trim()).filter(Boolean);

function bookUrl() { return `${L.SITE_URL}/book-boardroom`; }

async function logEvent(bookingId, eventType, actor, detail) {
  try {
    await L.insertRow('boardroom_booking_events', {
      booking_id: bookingId, event_type: eventType, actor: actor || 'system', detail: detail || null,
    });
  } catch (err) { console.error('boardroom logEvent failed:', err.message); }
}

function toPerson(b, mail) {
  return L.sendEmail({ to: b.email, subject: mail.subject, html: mail.html, replyTo: L.NOTIFY_EMAIL, client: true });
}
function toStaff(b, mail) {
  return L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html, replyTo: b.email });
}

function deps() {
  return {
    sb: SB,
    now: () => new Date(),
    mode: () => B.mode(),
    autoRelease: () => B.autoRelease(),
    store: {
      save: (id, patch) => L.updateRows(TABLE, `id=eq.${id}`, patch),
      select: (query) => L.selectRows(TABLE, query),
      log: logEvent,
    },
    mail: {
      held: (b, pr) => toPerson(b, E.held(b, pr, {
        invoiceTitle: b.spacebring && b.spacebring.invoice_title,
        invoiceUrl: b.spacebring && b.spacebring.invoice_pdf_url,
      })),
      confirmed: (b, pr) => toPerson(b, E.confirmed(b, pr)),
      staffPaid: (b, pr) => toStaff(b, E.staffPaid(b, pr)),
      reminder: (b, pr, o) => toPerson(b, E.reminder(b, pr, o)),
      released: (b, pr) => toPerson(b, E.released(b, pr, bookUrl())),
      staffLapsed: (b, pr, o) => toStaff(b, E.staffLapsed(b, pr, o)),
      attention: (b, step, message) => toStaff(b, E.attention(b, step, message)),
    },
  };
}

module.exports = { deps, logEvent, toPerson, toStaff, bookUrl, TABLE, VILLAGE_TABLE_EMAILS };
