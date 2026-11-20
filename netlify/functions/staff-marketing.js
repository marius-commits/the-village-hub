// GET  /.netlify/functions/staff-marketing
//   This week's plan, posts, captions and mockups from the published
//   content-strategy site, joined with marketing_caption_reviews.
// POST { week_id, post_id, status: 'approved'|'edits_requested', note? }
//   Writes the signed-in email as the reviewer. Nothing is posted.

const L = require('./_lib');
const M = require('./_marketing');

const STATUSES = ['approved', 'edits_requested'];

function latestByPost(rows) {
  const by = {};
  for (const row of rows || []) {
    const prev = by[row.post_id];
    if (!prev || new Date(row.created_at) >= new Date(prev.created_at)) by[row.post_id] = row;
  }
  return by;
}

async function reviewsFor(week) {
  if (!week) return [];
  return L.selectRows(
    'marketing_caption_reviews',
    `week_id=eq.${encodeURIComponent(week)}&select=id,week_id,post_id,reviewer,reviewer_email,status,note,created_at&order=created_at.asc&limit=500`
  ).catch(async (err) => {
    if (!/reviewer_email|column|schema cache/i.test(err.message)) throw err;
    return L.selectRows(
      'marketing_caption_reviews',
      `week_id=eq.${encodeURIComponent(week)}&select=id,week_id,post_id,reviewer,status,note,created_at&order=created_at.asc&limit=500`
    );
  });
}

exports.handler = async function (event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return L.bad('Method Not Allowed', 405);
  if (!L.configured()) return L.bad('Not configured', 503);

  const gate = await L.guard(event);
  if (gate.response) return gate.response;
  const staff = gate.staff;

  try {
    if (event.httpMethod === 'GET') {
      let plan;
      try {
        plan = await M.loadPublishedPlan();
      } catch (err) {
        console.error('plan fetch failed:', err.message);
        return L.ok({
          plan: null,
          error: 'The weekly plan could not be loaded. The content site may be briefly unreachable.',
          reviews: [],
          staff: { email: staff.email, role: staff.role },
        });
      }
      const reviews = await reviewsFor(plan.week);
      return L.ok({
        plan,
        reviews,
        latest: latestByPost(reviews),
        staff: { email: staff.email, role: staff.role, full_name: staff.full_name },
      });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return L.bad('Bad JSON'); }
    const week = L.clean(body.week_id, 20);
    const post = L.clean(body.post_id, 40);
    const status = L.clean(body.status, 30);
    const note = L.clean(body.note, 2000);
    if (!week || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(week)) return L.bad('Missing week');
    if (!post || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(post)) return L.bad('Missing post');
    if (!STATUSES.includes(status)) return L.bad('Unknown review');
    if (status === 'edits_requested' && !note) return L.bad('Say what should change.');

    const row = {
      week_id: week,
      post_id: post,
      reviewer: staff.email,
      reviewer_email: staff.email,
      status,
      note: note || '',
    };

    try {
      const saved = await L.insertRow('marketing_caption_reviews', row);
      return L.ok({ review: saved });
    } catch (err) {
      if (!/reviewer|column|schema cache|check constraint/i.test(err.message)) throw err;
      // Migration not applied yet: the three original names still fit the old check.
      const names = {
        'marius@brick-field.co.za': 'Marius',
        'christel@villagehub.co.za': 'Christel',
        'francois@brick-field.co.za': 'Francois',
      };
      const name = names[staff.email];
      if (!name) return L.bad('The marketing migration has not been applied yet, so only Marius, Christel and Francois can review.', 503, 'migration');
      const saved = await L.insertRow('marketing_caption_reviews', {
        week_id: week,
        post_id: post,
        reviewer: name,
        status,
        note: note || '',
      });
      return L.ok({ review: saved, identity: 'name' });
    }
  } catch (err) {
    console.error('staff-marketing failed:', err.message);
    return L.bad('Could not save that review', 500);
  }
};

exports.latestByPost = latestByPost;
exports.reviewsFor = reviewsFor;
