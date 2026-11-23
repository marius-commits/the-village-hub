// Wires the onboarding flow (_onboarding.js) to the real database, the real
// Spacebring client and real email. Kept apart so the flow itself stays
// testable with fakes.

const L  = require('./_lib');
const T  = require('./_emails');
const SB = require('./_spacebring');
const O  = require('./_onboarding');

function reviewUrl(app) {
  return `${L.SITE_URL}/admin/applications?ref=${encodeURIComponent(app.reference)}`;
}

function deps() {
  return {
    sb: SB,
    now: () => new Date(),
    store: {
      save: (id, patch) => L.updateRows('applications', `id=eq.${id}`, patch),
      log: (id, type, actor, detail) => L.logEvent(id, type, actor, detail),
    },
    mail: {
      // To the client, blind-copied to the Hub inbox like every client email.
      async welcome(app) {
        const mail = T.activated(app, { registeredAddress: O.needsRegisteredAddress(app) });
        const r = await L.sendEmail({ to: app.email, subject: mail.subject, html: mail.html, replyTo: L.NOTIFY_EMAIL, client: true });
        return !r.error && !r.skipped;
      },
      // To whoever runs the mail desk, copied to the team.
      async mailDesk(app) {
        const to = L.MAIL_DESK_EMAILS.length ? L.MAIL_DESK_EMAILS : L.STAFF_EMAILS;
        const cc = L.MAIL_DESK_EMAILS.length ? L.STAFF_EMAILS.filter(e => !to.includes(e)) : [];
        const mail = T.mailDesk(app, { registeredAddress: O.needsRegisteredAddress(app) });
        const r = await L.sendEmail({ to, cc, subject: mail.subject, html: mail.html, replyTo: L.NOTIFY_EMAIL });
        return !r.error && !r.skipped ? to : null;
      },
      async attention(app, step, message) {
        const mail = T.onboardingAttention(app, step, message, reviewUrl(app));
        await L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html });
      },
    },
  };
}

module.exports = { deps, reviewUrl };
