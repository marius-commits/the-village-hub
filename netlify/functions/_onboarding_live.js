// Wires the onboarding flow (_onboarding.js) to the real database, the real
// Spacebring client and real email. Kept apart so the flow itself stays
// testable with fakes.

const L  = require('./_lib');
const T  = require('./_emails');
const SB = require('./_spacebring');
const O  = require('./_onboarding');
const Letter = require('./_registered_address_letter');
const D = require('./_desk');

function reviewUrl(app) {
  return `${L.SITE_URL}/admin/applications?ref=${encodeURIComponent(app.reference)}`;
}

function deps() {
  return {
    sb: SB,
    now: () => new Date(),
    // The offer a desk member signed up on is fixed at the moment they signed
    // up, so a sign-up on 31 December still gets its discount on 2 January.
    couponRef: (app) => {
      if (app.type !== 'desk') return null;
      const o = D.offer(app.plan, new Date(app.created_at || Date.now()));
      return (o && o.couponRef) || null;
    },
    store: {
      save: (id, patch) => L.updateRows('applications', `id=eq.${id}`, patch),
      log: (id, type, actor, detail) => L.logEvent(id, type, actor, detail),
    },
    mail: {
      // To the client, blind-copied to the Hub inbox like every client email.
      async welcome(app) {
        // Registered-address clients get the confirmation letter on this
        // email, plus the Hub proof of address when that file is in Storage.
        return Letter.deliverWelcome(app, Letter.liveIo(), (mail) => L.sendEmail({
          to: app.email,
          subject: mail.subject,
          html: mail.html,
          attachments: mail.attachments,
          replyTo: L.NOTIFY_EMAIL,
          client: true,
        }));
      },
      // To whoever runs the mail desk, copied to the team.
      async mailDesk(app) {
        const to = L.MAIL_DESK_EMAILS.length ? L.MAIL_DESK_EMAILS : L.STAFF_EMAILS;
        const cc = L.MAIL_DESK_EMAILS.length ? L.STAFF_EMAILS.filter(e => !to.includes(e)) : [];
        const mail = T.mailDesk(app, { registeredAddress: O.needsRegisteredAddress(app) });
        const r = await L.sendEmail({ to, cc, subject: mail.subject, html: mail.html, replyTo: L.NOTIFY_EMAIL });
        return !r.error && !r.skipped ? to : null;
      },
      // Desk members only. To the whole team, when the first invoice is paid.
      async paidAlert(app) {
        const o = D.offer(app.plan, new Date(app.created_at || Date.now())) || D.offer(app.plan);
        const mail = T.deskPaid(app, o, reviewUrl(app));
        const r = await L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html, replyTo: app.email });
        return !r.error && !r.skipped ? L.STAFF_EMAILS : null;
      },
      async attention(app, step, message) {
        const mail = T.onboardingAttention(app, step, message, reviewUrl(app));
        await L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html });
      },
    },
  };
}

module.exports = { deps, reviewUrl };
