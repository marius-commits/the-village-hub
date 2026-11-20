const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../netlify/functions/_digest');
const M = require('../netlify/functions/_marketing');

test('digest skips a day with no open leads', () => {
  const out = D.buildDigest([
    { status: 'won', created_at: '2026-11-01T08:00:00Z', company: 'Closed' },
    { status: 'lost', created_at: '2026-11-02T08:00:00Z', company: 'Gone' },
  ]);
  assert.equal(out.skip, true);
  assert.equal(out.openCount, 0);
});

test('digest names the oldest unanswered lead and today\'s actions', () => {
  const now = new Date('2026-11-20T14:00:00Z'); // 16:00 SAST
  const out = D.buildDigest([
    {
      status: 'new', company: 'Older Co', product: 'boardroom',
      created_at: '2026-11-18T08:00:00Z', first_response_at: null,
      next_action: 'Call the director', next_action_at: '2026-11-20T12:00:00Z',
    },
    {
      status: 'contacted', company: 'Newer Co', product: 'hot_desk',
      created_at: '2026-11-20T06:00:00Z', first_response_at: '2026-11-20T07:00:00Z',
    },
    {
      status: 'won', company: 'Done Co', product: 'event',
      created_at: '2026-11-01T08:00:00Z', first_response_at: '2026-11-01T09:00:00Z',
    },
  ], now);
  assert.equal(out.skip, false);
  assert.equal(out.openCount, 2);
  assert.equal(out.noResponseCount, 1);
  assert.equal(out.oldest.company, 'Older Co');
  assert.equal(out.oldest.product, 'Boardroom');
  assert.equal(out.actions.length, 1);
  assert.match(out.actions[0], /Older Co: Call the director/);
  assert.match(D.summaryText(out), /Open leads: 2/);
});

test('weekday check uses Johannesburg', () => {
  assert.equal(D.isWeekdaySAST(new Date('2026-11-20T14:00:00Z')), true); // Friday
  assert.equal(D.isWeekdaySAST(new Date('2026-11-21T14:00:00Z')), false); // Saturday
});

test('T33 variables stay inside the approved staff-alert placeholders', () => {
  const digest = D.buildDigest([
    { status: 'new', company: 'Acme', product: 'boardroom', created_at: '2026-11-19T08:00:00Z' },
  ], new Date('2026-11-20T14:00:00Z'));
  const vars = D.whatsappVariables(digest, 'vh_staff_alert');
  assert.equal(vars.alert_type, 'open-leads digest');
  assert.match(vars.summary, /Acme/);
  assert.match(vars.admin_link, /\/admin\/leads$/);
  const body = 'Village Hub staff alert: there is a new {{alert_type}} that needs a follow-up today. {{summary}} Please open the approval page for the full details and take it from there: {{admin_link}} Thank you.';
  const filled = D.fillTemplate(body, vars);
  assert.equal(filled.includes('{{'), false);
  assert.match(filled, /admin\/leads/);
});

test('marketing html yields the week, a diary line and a caption', () => {
  const html = `
    <script>window.VH_REVIEW={"week": "2026-11-16", "url": "https://example.test", "key": "k", "reviewers": ["Marius"]};</script>
    <section id="plan"><div class="dspan">This week · 16–22 November 2026</div>
      <article class="dpage today"><div class="ddate"><span class="dow">Mon</span><span class="dn">16</span><span class="dmon">Nov</span></div>
      <div class="dentries"><label class="ditem"><span class="dtxt"><span class="tags"><span class="dtag">Lead</span></span>Answer the boardroom lead.</span></label></div>
      </article>
    </section>
    <section id="captions"><article class="pcard" data-post="W1">
      <h3>Tue 17 Nov · Tuesday on the floor</h3>
      <p class="muted small">Assets: <b>Kitchen photo</b></p>
      <div class="pv" data-plat="instagram"><div class="pvh"><span>Instagram feed</span></div><pre id="cap-W1-0">Coffee is on.</pre></div>
      <div class="pmockup"><p class="pmockup-label">How it will look on Instagram</p><img src="assets/mockups/w1.png" alt="Preview"></div>
    </article></section>
    <section id="assets"></section>`;
  const plan = M.parseMarketingHtml(html, 'https://marius-commits.github.io/village-hub-content-strategy/index.html');
  assert.equal(plan.week, '2026-11-16');
  assert.equal(plan.days.length, 1);
  assert.match(plan.days[0].items[0], /Answer the boardroom lead/);
  assert.equal(plan.posts.length, 1);
  assert.equal(plan.posts[0].captions[0].text, 'Coffee is on.');
  assert.match(plan.posts[0].mockups[0].src, /village-hub-content-strategy\/assets\/mockups\/w1\.png$/);
});

test('dedicated template text is ready to submit to Meta', () => {
  const body = D.DEDICATED_TEMPLATE.body;
  assert.match(body, /\{\{open_count\}\}/);
  assert.match(body, /\{\{oldest_lead\}\}/);
  assert.match(body, /\{\{admin_link\}\}/);
  assert.equal(D.DEDICATED_TEMPLATE.name, 'vh_open_leads_digest');
  assert.equal(D.DEDICATED_TEMPLATE.category, 'UTILITY');
});
