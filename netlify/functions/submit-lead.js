// Netlify serverless function: submit-lead
// Receives form data from the Village Hub interest form
// and submits it to Zoho CRM via the Web-to-Lead endpoint.
const L = require('./_lib');

// Map the form's plan interest onto the leads.product enum.
function productFor(plan, source) {
  const t = `${plan} ${source}`.toLowerCase();
  if (/boardroom/.test(t)) return 'boardroom';
  if (/meeting/.test(t)) return 'meeting_room';
  if (/event/.test(t)) return 'event';
  if (/student/.test(t)) return 'student';
  if (/virtual|address/.test(t)) return 'virtual_office';
  if (/private|office/.test(t)) return 'private_office';
  if (/desk|cowork|flex|day pass|member/.test(t)) return 'hot_desk';
  if (/stay|accommodation/.test(t)) return 'village_stay';
  return 'other';
}

// Copies the enquiry into Supabase public.leads (lead tracker). Never blocks
// or fails the visitor's submission: Zoho stays the system of record for now.
async function saveLead(params, event, fields) {
  if (!L.configured()) { console.warn('submit-lead: Supabase not configured, lead not tracked'); return; }
  const g = k => L.clean(params.get(k), 300);
  const gclid = g('gclid');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fields.preferredDate) ? fields.preferredDate : null;
  const referer = event.headers.referer || event.headers.Referer || '';
  let landing = g('landing_page');
  if (!landing && referer) { try { landing = new URL(referer).pathname; } catch (e) {} }
  const row = {
    source: gclid || /cpc|paid|google_ads/i.test(g('utm_medium') || '') ? 'google_ads' : 'website',
    source_detail: L.clean(fields.leadSource, 200),
    landing_page: landing,
    product: productFor(fields.planInterest, fields.leadSource),
    first_name: L.clean(fields.firstName, 100), last_name: L.clean(fields.lastName, 100),
    company: L.clean(fields.company, 200),
    email: L.clean(fields.email, 200), phone: L.clean(fields.phone, 50),
    preferred_date: date,
    message: L.clean(fields.description, 4000),
    utm_source: g('utm_source'), utm_medium: g('utm_medium'), utm_campaign: g('utm_campaign'),
    utm_term: g('utm_term'), utm_content: g('utm_content'), gclid,
  };
  if (!row.email && !row.phone) return;
  try { await L.insertRow('leads', row); }
  catch (err) { console.error('submit-lead: leads insert failed:', err.message); }
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
          return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
          // Parse incoming form data
      const params = new URLSearchParams(event.body);
          const firstName     = params.get('first_name') || '';
          const lastName      = params.get('last_name') || '';
          const email         = params.get('email') || '';
          const phone         = params.get('phone') || '';
          const company       = params.get('company') || '';
          const planInterest  = params.get('plan_interest') || '';
          const preferredDate = params.get('preferred_date') || '';
          const description   = params.get('description') || '';
          const website       = params.get('website') || '';
          const leadSource    = params.get('lead_source') || 'Website - Interest Form';

      // Build full description for Zoho.
      // Plan Interest is also posted as its own field below; it stays in the
      // description as a fallback so nothing is lost if the field is renamed.
      const fullDescription = [
              planInterest  ? `Plan Interest: ${planInterest}` : '',
              preferredDate ? `Preferred Visit Date: ${preferredDate}` : '',
              description
            ].filter(Boolean).join('\n\n');

      await saveLead(params, event, { firstName, lastName, email, phone, company, planInterest, preferredDate, description: fullDescription, leadSource });

      const zohoPayload = new URLSearchParams({
              xnQsjsdp: '3bab74f7e8aba6be99b9d1863cff751310a973b2c6f80cb471b7a4eede332658',
              xmIwtLD: 'bdb9fc7c567f2c2566b234583069f587376dc60a5539756d51c3e410227569ad393d23a4d15100a62a79b7c7a7284819',
              actionType: 'TGVhZHM=',
              returnURL: 'https://the-village-hub.netlify.app/success.html',
              'First Name':  firstName,
              'Last Name':   lastName,
              'Email':       email,
              'Phone':       phone,
              'Company':     company,
              'Description': fullDescription,
              'Lead Source': leadSource,
      });

      // Optional fields: only sent when present, so Zoho never gets empty params.
      // 'Plan Interest' is the Leads picklist (API name Membership_Type, relabelled
      // Oct 2026). Web-to-Lead matches on the field LABEL, so this key must stay
      // identical to the label in Zoho, and the values must match its picklist
      // options exactly: see claude/village-hub-virtual-office-build-doc.md.
      if (planInterest) zohoPayload.set('Plan Interest', planInterest);
      if (website)      zohoPayload.set('Website', website);

      const zohoRes = await fetch('https://crm.zoho.com/crm/WebToLeadForm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: zohoPayload.toString(),
              redirect: 'manual',
      });

      if (zohoRes.ok || zohoRes.status === 302 || zohoRes.status === 301 || zohoRes.redirected) {
              return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
      }
          const responseText = await zohoRes.text();
          console.error('Zoho responded with status:', zohoRes.status, responseText.slice(0, 200));
          return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Zoho submission failed' }) };
    } catch (err) {
          console.error('submit-lead error:', err);
          return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: err.message }) };
    }
};
