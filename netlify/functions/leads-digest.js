// Weekdays at 16:00 SAST (14:00 UTC). See netlify.toml.
//
// Stays quiet unless LEADS_DIGEST_ENABLED=true, so a deploy does not start
// sending before Marius turns it on.
//
// Skips any day with zero open leads.
// Emails Marius, Christel and Francois from hello@villagehub.co.za.
// Also queues one WhatsApp row per teammate who has a number on
// wa_team_members, using the approved vh_open_leads_digest template when it
// exists, otherwise the approved T33 staff alert. wa-sender does not deliver
// those rows while AUTO_SEND is hardcoded off, so the email is the copy
// that arrives.

const L = require('./_lib');
const T = require('./_emails');
const D = require('./_digest');

// WhatsApp copies of the digest go to these people's phones (wa_team_members).
// The email copy goes to the shared team list (L.STAFF_EMAILS).
const RECIPIENTS = [
  'marius@brick-field.co.za',
  'christel@villagehub.co.za',
  'francois@brick-field.co.za',
];

async function queueWhatsApp(digest) {
  const templates = await L.selectRows(
    'wa_templates',
    'language=eq.en&meta_status=eq.APPROVED&select=code,name,body,language'
  );
  const dedicated = (templates || []).find(t => t.name === D.DEDICATED_TEMPLATE.name);
  const t33 = (templates || []).find(t => t.code === 'T33' && t.name === 'vh_staff_alert');
  const tpl = dedicated || t33;
  if (!tpl) return { queued: [], skipped: 'no approved template' };

  const members = await L.selectRows('wa_team_members', 'active=is.true&select=email,phone_e164,name').catch(() => []);
  const queued = [];
  const missing = [];

  for (const email of RECIPIENTS) {
    const member = (members || []).find(m => (m.email || '').toLowerCase() === email && m.phone_e164);
    if (!member) { missing.push(email); continue; }
    let contactId = null;
    try {
      const contacts = await L.selectRows(
        'wa_contacts',
        `phone_e164=eq.${encodeURIComponent(member.phone_e164)}&select=id&limit=1`
      );
      contactId = contacts && contacts[0] ? contacts[0].id : null;
    } catch (err) { /* contact link is optional */ }

    const variables = D.whatsappVariables(digest, tpl.name);
    const row = {
      dedupe_key: `leads-digest:${digest.dateLabel}:${email}`,
      channel: 'whatsapp',
      kind: 'internal',
      trigger_id: 'leads_digest',
      template_name: tpl.name,
      template_code: tpl.code,
      template_lang: 'en',
      variables,
      rendered_text: D.fillTemplate(tpl.body, variables),
      status: 'approved',
      is_test: false,
      contact_id: contactId,
      approved_by: 'leads-digest',
      approved_at: new Date().toISOString(),
      approval_via: 'schedule',
      blocked_reason: 'Queued on the Hub number. wa-sender will not deliver this while AUTO_SEND is off. The same digest was emailed.',
    };
    try {
      await L.insertRow('wa_message_queue', row);
      queued.push(email);
    } catch (err) {
      if (/duplicate|23505|already exists/i.test(err.message)) queued.push(email + ':already');
      else {
        console.error('queue failed for', email, err.message);
        missing.push(email);
      }
    }
  }
  return { queued, missing, template: tpl.name };
}

exports.handler = async function (event) {
  if (event.httpMethod && event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return L.bad('Method Not Allowed', 405);
  }
  if (process.env.LEADS_DIGEST_ENABLED !== 'true') {
    return L.ok({ skipped: true, reason: 'LEADS_DIGEST_ENABLED is not true' });
  }
  if (!L.configured()) return L.bad('Not configured', 503);

  const now = new Date();
  if (process.env.LEADS_DIGEST_FORCE !== 'true' && !D.isWeekdaySAST(now)) {
    return L.ok({ skipped: true, reason: 'weekend in Johannesburg' });
  }

  try {
    let leads;
    try {
      leads = await L.selectRows(
        'leads',
        'status=in.(new,contacted,viewing_booked,quoted)&select=id,status,product,company,first_name,last_name,created_at,first_response_at,next_action,next_action_at&limit=500'
      );
    } catch (err) {
      if (!/next_action|column|schema cache/i.test(err.message)) throw err;
      leads = await L.selectRows(
        'leads',
        'status=in.(new,contacted,viewing_booked,quoted)&select=id,status,product,company,first_name,last_name,created_at,first_response_at&limit=500'
      );
    }

    const digest = D.buildDigest(leads, now, `${L.SITE_URL}/admin/leads`);
    if (digest.skip) return L.ok({ skipped: true, reason: digest.reason });

    const mail = T.leadsDigest(digest);
    const emailed = await L.sendEmail({ to: L.STAFF_EMAILS, subject: mail.subject, html: mail.html });
    let whatsapp = { queued: [], skipped: 'not attempted' };
    try { whatsapp = await queueWhatsApp(digest); }
    catch (err) { console.error('whatsapp queue failed:', err.message); whatsapp = { error: err.message }; }

    return L.ok({
      sent: true,
      open: digest.openCount,
      no_response: digest.noResponseCount,
      email: emailed && emailed.skipped ? 'skipped' : 'sent',
      whatsapp,
    });
  } catch (err) {
    console.error('leads-digest failed:', err.message);
    return L.bad('Could not send the open-leads reminder', 500);
  }
};
