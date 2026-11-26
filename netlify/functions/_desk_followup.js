// Desk sign-ups that have not gone live two days on.
//
// One reminder to the person and one alert to the team, once each, recorded
// on the application so neither is ever sent twice. Runs from the scheduled
// onboarding-sync function whether or not the Spacebring automation is on:
// the manual path is the one most likely to stall.

const T = require('./_emails');
const D = require('./_desk');

const AFTER_HOURS = 48;
const GIVE_UP_DAYS = 14;

// 08:00 to 17:59 South African time. A reminder at 03:00 helps nobody.
function inOfficeHours(now) {
  const hour = new Date(now.getTime() + 2 * 3600_000).getUTCHours();
  return hour >= 8 && hour < 18;
}

function due(app, now) {
  if (!app || app.type !== 'desk' || app.status !== 'approved') return false;
  const steps = (app.onboarding && app.onboarding.steps) || {};
  if (steps.desk_followup) return false;
  const age = now.getTime() - new Date(app.created_at).getTime();
  return age >= AFTER_HOURS * 3600_000 && age <= GIVE_UP_DAYS * 86400_000;
}

// io: { now, select, save, log, send, staffEmails, notifyEmail, siteUrl }
async function run(io) {
  const now = io.now();
  if (!inOfficeHours(now)) return { checked: 0, sent: 0, skipped: 'outside office hours' };

  const before = new Date(now.getTime() - AFTER_HOURS * 3600_000).toISOString();
  const after  = new Date(now.getTime() - GIVE_UP_DAYS * 86400_000).toISOString();
  const apps = await io.select('applications',
    `type=eq.desk&status=eq.approved&created_at=lte.${before}&created_at=gte.${after}&select=*&order=created_at.asc&limit=25`);

  let sent = 0;
  for (const app of apps || []) {
    if (!due(app, now)) continue;
    try {
      const o = D.offer(app.plan, new Date(app.created_at)) || D.offer(app.plan, now);
      const hours = Math.floor((now.getTime() - new Date(app.created_at).getTime()) / 3600_000);
      const reviewUrl = `${io.siteUrl}/admin/applications?ref=${encodeURIComponent(app.reference)}`;

      // Recorded BEFORE sending. If the function dies half way the worst case
      // is one missed reminder, never the same reminder every 15 minutes.
      const onboarding = {
        ...(app.onboarding || {}),
        steps: { ...((app.onboarding && app.onboarding.steps) || {}), desk_followup: { at: now.toISOString(), hours } },
      };
      await io.save(app.id, { onboarding });

      const toPerson = T.deskReminder(app, o);
      const toStaff  = T.deskStalled(app, o, reviewUrl, hours);
      const [person, staff] = await Promise.all([
        io.send({ to: app.email, subject: toPerson.subject, html: toPerson.html, replyTo: io.notifyEmail, client: true }),
        io.send({ to: io.staffEmails, subject: toStaff.subject, html: toStaff.html, replyTo: app.email }),
      ]);
      await io.log(app.id, 'desk_followup', 'system', {
        hours,
        applicant: Boolean(person) && !person.error && !person.skipped,
        staff: Boolean(staff) && !staff.error && !staff.skipped,
      });
      sent++;
    } catch (err) {
      console.error('desk follow-up failed for', app.reference, err.message);
    }
  }
  return { checked: (apps || []).length, sent };
}

module.exports = { run, due, inOfficeHours, AFTER_HOURS, GIVE_UP_DAYS };
