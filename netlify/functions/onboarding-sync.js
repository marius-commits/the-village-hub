// Scheduled. Moves approved applications along as things happen in
// Spacebring: agreement signed, invoice issued, invoice paid. On payment it
// activates the application, emails the client their welcome and tells the
// mail desk.
//
// Polling rather than webhooks on purpose: Spacebring's webhook payloads are
// thinly documented and a missed delivery would leave a paid client sitting
// unactivated. Reading the state every 15 minutes cannot miss anything.
//
// Does nothing unless SPACEBRING_PROVISIONING=live.

const L  = require('./_lib');
const SB = require('./_spacebring');
const O  = require('./_onboarding');
const Live = require('./_onboarding_live');

const STALL_MS = 3 * 60 * 1000;

function setupUnfinished(app) {
  const s = (app.onboarding && app.onboarding.steps) || {};
  return O.isVO(app) ? !s.contract_issued : !s.subscription;
}

exports.handler = async function () {
  if (SB.mode() !== 'live' || !L.configured()) return L.ok({ skipped: true });

  const apps = await L.selectRows(
    'applications',
    'status=eq.approved&onboarding_state=eq.in_progress&select=*&order=reviewed_at.asc&limit=50'
  );

  const d = Live.deps();
  let moved = 0, resumed = 0;
  for (const app of apps || []) {
    try {
      // Approve ran out of time half way through set-up: carry on from the
      // step it reached. Steps already recorded are never repeated.
      if (setupUnfinished(app)) {
        const idle = Date.now() - new Date(app.updated_at || app.reviewed_at || 0).getTime();
        if (idle > STALL_MS) {
          await O.provision(app, (app.onboarding && app.onboarding.approved_by) || 'system', d);
          resumed++;
        }
        continue;
      }
      const r = await O.sync(app, d);
      if (r.changed) moved++;
    } catch (err) {
      console.error('onboarding-sync failed for', app.reference, err.message);
    }
  }
  return L.ok({ checked: (apps || []).length, moved, resumed });
};
