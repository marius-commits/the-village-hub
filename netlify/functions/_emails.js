// Transactional email templates for the membership application system.
// Table-based layout and inline styles, because Outlook and Gmail still
// ignore most modern CSS.

const O = require('./_onboarding');

const BRAND = {
  brown: '#6B4423',
  sage:  '#8A9A5B',
  gold:  '#C9A24B',
  cream: '#FAF8F6',
  sand:  '#E8D9C5',
  ink:   '#2A2118',
  muted: '#6F6355',
};

function shell(bodyHtml, preheader) {
  return `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader || ''}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${BRAND.sand};border-radius:14px;overflow:hidden;">
    <tr><td style="background:${BRAND.brown};padding:22px 28px;">
      <div style="font:600 17px/1.3 Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.3px;">The Village Hub</div>
      <div style="font:400 12px/1.4 Arial,sans-serif;color:${BRAND.sand};margin-top:3px;">Nooitgedacht Village, Stellenbosch</div>
    </td></tr>
    <tr><td style="padding:30px 28px;font:400 15px/1.62 Arial,sans-serif;color:${BRAND.ink};">
      ${bodyHtml}
    </td></tr>
    <tr><td style="background:${BRAND.cream};padding:18px 28px;border-top:1px solid ${BRAND.sand};font:400 12px/1.6 Arial,sans-serif;color:${BRAND.muted};">
      The Village Hub &middot; 1st Floor, The Foundry, Sauvignon Street, Nooitgedacht Village, Stellenbosch 7600<br>
      <a href="https://www.villagehub.co.za" style="color:${BRAND.brown};">villagehub.co.za</a>
      &middot; <a href="mailto:hello@villagehub.co.za" style="color:${BRAND.brown};">hello@villagehub.co.za</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
    <tr><td style="background:${BRAND.brown};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:12px 24px;font:600 14px/1 Arial,sans-serif;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr></table>`;
}

function refBox(app) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;margin:20px 0;">
    <tr><td style="padding:14px 16px;font:400 14px/1.6 Arial,sans-serif;color:${BRAND.ink};">
      <strong>Reference</strong> ${app.reference}<br>
      <strong>Package</strong> ${app.plan}
    </td></tr></table>`;
}

const DOC_LABELS = {
  cipc_certificate: 'CIPC registration certificate',
  cipc_bizprofile: 'CIPC BizPortal BizProfile',
  director_id: 'Director ID document',
  proof_of_address: 'Proof of address',
  registered_address_mandate: 'Signed registered-address mandate',
  student_card: 'Student card',
  proof_of_registration: 'Proof of registration',
  other: 'Supporting document',
};

// 1. Applicant confirmation, sent the moment the application is complete.
function applicantReceived(app) {
  const isVO = app.type === 'virtual_office';
  const checks = isVO
    ? 'your CIPC registration, director ID and proof of address'
    : 'your student card and proof of registration';

  return {
    subject: `We have your application — ${app.reference}`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${app.first_name},</p>
      <p style="margin:0 0 14px;">Thank you. Your application for <strong>${app.plan}</strong> is in, and your documents came through.</p>
      ${refBox(app)}
      <p style="margin:0 0 14px;"><strong>What happens next.</strong> We check ${checks}, and come back to you <strong>within one business day</strong>. If anything is missing or unclear we will email you rather than leave you waiting.</p>
      <p style="margin:0 0 14px;">Once you are approved we set your membership up and send the invoice. <strong>Nothing is payable until then</strong>, and nothing starts until you have paid.</p>
      <p style="margin:0 0 6px;">Quote <strong>${app.reference}</strong> if you need to reach us about this.</p>
      <p style="margin:18px 0 0;">The Village Hub team</p>
    `, `Application ${app.reference} received. We reply within one business day.`),
  };
}

// 2. Internal alert to the team.
function staffAlert(app, documents, reviewUrl) {
  const rows = (documents || []).map(d =>
    `<tr><td style="padding:3px 0;font:400 13px/1.5 Arial,sans-serif;color:${BRAND.ink};">${DOC_LABELS[d.doc_type] || d.doc_type}</td></tr>`
  ).join('');

  const detail = app.type === 'virtual_office'
    ? `<strong>Company</strong> ${app.company_name || '—'}<br>
       <strong>CIPC no.</strong> ${app.cipc_registration_number || 'not supplied'}<br>
       <strong>Start date</strong> ${app.preferred_start_date || 'approval date if blank or already past'}<br>
       <strong>Commitment</strong> ${Number(app.commitment_months) || 3} months<br>
       <strong>Registered address requested</strong> ${app.wants_registered_address
         ? (app.plan === 'Village Virtual Pro'
           ? 'YES — included with Village Virtual Pro'
           : 'YES — R250/month excl. VAT add-on, 3-month minimum. Check the head lease first.')
         : 'No'}`
    : `<strong>Institution</strong> ${app.institution || '—'}<br>
       <strong>Student number</strong> ${app.student_number || '—'}<br>
       <strong>Lives at Nooitgedacht</strong> ${app.is_nooitgedacht_resident ? 'Yes' : 'No'}`;

  return {
    subject: `New application: ${app.plan} — ${app.first_name} ${app.last_name} (${app.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">New ${app.type === 'virtual_office' ? 'virtual office' : 'student'} application</p>
      ${refBox(app)}
      <p style="margin:0 0 14px;">
        <strong>Name</strong> ${app.first_name} ${app.last_name}<br>
        <strong>Email</strong> <a href="mailto:${app.email}" style="color:${BRAND.brown};">${app.email}</a><br>
        <strong>Phone</strong> ${app.phone}<br>
        <strong>Preferred start</strong> ${app.preferred_start_date || 'not specified'}
      </p>
      <p style="margin:0 0 14px;">${detail}</p>
      <p style="margin:0 0 6px;font:600 13px/1.5 Arial,sans-serif;">Documents uploaded</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">${rows}</table>
      ${button(reviewUrl, 'Review this application')}
      <p style="margin:0;font:400 13px/1.6 Arial,sans-serif;color:${BRAND.muted};">The applicant has been told we reply within one business day.</p>
    `, `${app.first_name} ${app.last_name} applied for ${app.plan}.`),
  };
}

// 3. More information needed.
function infoRequested(app, message) {
  return {
    subject: `We need one more thing — ${app.reference}`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${app.first_name},</p>
      <p style="margin:0 0 14px;">We have started on your <strong>${app.plan}</strong> application and need something before we can finish.</p>
      ${refBox(app)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.sage};border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:14px 16px;font:400 15px/1.6 Arial,sans-serif;color:${BRAND.ink};">${message}</td></tr>
      </table>
      <p style="margin:0 0 14px;">Reply to this email with what we have asked for and we will pick it straight back up. Your application stays open in the meantime.</p>
      <p style="margin:18px 0 0;">The Village Hub team</p>
    `, `One item outstanding on application ${app.reference}.`),
  };
}

// 4. Approved. This is the handover to billing.
function approved(app, message, opts) {
  const o = opts || {};
  const isVO = app.type === 'virtual_office';
  const start = o.startDate || app.preferred_start_date;

  // Three versions of "what happens now", because telling a client to expect
  // an invoice when an agreement arrives first is how trust gets lost.
  let next;
  if (o.automated && isVO) {
    next = `
      <p style="margin:0 0 10px;"><strong>What happens now.</strong> Three emails follow from our member system, Spacebring:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;font:600 14px/1.6 Arial,sans-serif;color:${BRAND.brown};">1</td><td style="padding:3px 0;font:400 14px/1.6 Arial,sans-serif;">Your invitation to the Village Hub member app.</td></tr>
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;font:600 14px/1.6 Arial,sans-serif;color:${BRAND.brown};">2</td><td style="padding:3px 0;font:400 14px/1.6 Arial,sans-serif;">Your virtual office agreement, to sign online. It takes a minute.</td></tr>
        <tr><td style="padding:3px 10px 3px 0;vertical-align:top;font:600 14px/1.6 Arial,sans-serif;color:${BRAND.brown};">3</td><td style="padding:3px 0;font:400 14px/1.6 Arial,sans-serif;">Your first invoice, issued once the agreement is signed.</td></tr>
      </table>
      <p style="margin:0 0 14px;">Your address goes live as soon as that invoice is paid${start ? `, with the membership running from <strong>${start}</strong>` : ''}. We will email you the exact address wording to use the moment it is live. Please do not use the address before then.</p>`;
  } else if (o.automated) {
    next = `
      <p style="margin:0 0 14px;"><strong>What happens now.</strong> You will get two emails from our member system, Spacebring: your invitation to the Village Hub member app, and your first invoice. Your membership starts once that invoice is paid${start ? `, from <strong>${start}</strong>` : ''}.</p>`;
  } else {
    next = `
      <p style="margin:0 0 14px;"><strong>What happens now.</strong> We are setting your membership up. You will get an invoice from our member system, Spacebring, within the next business day. Your membership starts once that invoice is paid${app.preferred_start_date ? `, from <strong>${app.preferred_start_date}</strong>` : ''}.</p>
      <p style="margin:0 0 14px;">That invoice email also carries your login for the member app, where you book the boardroom, see your day passes and get your access.</p>`;
  }

  return {
    subject: `Approved — ${app.plan} at The Village Hub (${app.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${app.first_name},</p>
      <p style="margin:0 0 14px;">Good news. Your application for <strong>${app.plan}</strong> has been approved and your documents check out.</p>
      ${refBox(app)}
      ${message ? `<p style="margin:0 0 14px;">${message}</p>` : ''}
      ${next}
      <p style="margin:18px 0 0;">Welcome to the Village.<br>The Village Hub team</p>
    `, `Your ${app.plan} application is approved.`),
  };
}

// 5. Declined. Kept short and human, with a real reason.
function declined(app, message) {
  return {
    subject: `Your application — ${app.reference}`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${app.first_name},</p>
      <p style="margin:0 0 14px;">Thank you for applying for <strong>${app.plan}</strong>. We are not able to go ahead on this one.</p>
      ${refBox(app)}
      ${message ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.sand};border-radius:6px;margin:0 0 20px;">
        <tr><td style="padding:14px 16px;font:400 15px/1.6 Arial,sans-serif;color:${BRAND.ink};">${message}</td></tr></table>` : ''}
      <p style="margin:0 0 14px;">If circumstances change, or you think we have this wrong, reply to this email and we will take another look.</p>
      <p style="margin:18px 0 0;">The Village Hub team</p>
    `, `About your application ${app.reference}.`),
  };
}


// Staff alert for a website enquiry (submit-lead). Goes to STAFF_EMAILS.
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const PRODUCT_LABELS = {
  boardroom: 'Boardroom', meeting_room: 'Meeting room', event: 'Event',
  corporate_event: 'Saturday corporate event', student: 'Student',
  virtual_office: 'Virtual office', private_office: 'Private office',
  hot_desk: 'Hot desk / coworking', village_stay: 'Village Stay', other: 'General',
};
function leadAlert(lead) {
  const label = PRODUCT_LABELS[lead.kind] || PRODUCT_LABELS.other;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '(no name)';
  const phoneDigits = String(lead.phone || '').replace(/[^\d+]/g, '').replace(/^0/, '27').replace(/^\+/, '');
  const rows = [
    ['Name', name],
    ['Company', lead.company],
    ['Email', lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:${BRAND.brown};">${esc(lead.email)}</a>` : null, true],
    ['Phone', lead.phone ? `${esc(lead.phone)}${phoneDigits ? ` &middot; <a href="https://wa.me/${phoneDigits}" style="color:${BRAND.brown};">WhatsApp</a>` : ''}` : null, true],
    ['Interested in', lead.plan_interest],
    ['Preferred date', lead.preferred_date],
    ['Source', lead.source_label],
    ['Landing page', lead.landing_page],
  ].filter(r => r[1]);
  const table = rows.map(([k, v, raw]) => `<tr><td style="padding:6px 12px 6px 0;color:${BRAND.muted};white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;">${raw ? v : esc(v)}</td></tr>`).join('');
  const msg = lead.message ? `<p style="margin:18px 0 6px 0;font-weight:600;">Message</p><div style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};padding:12px 14px;white-space:pre-wrap;">${esc(lead.message)}</div>` : '';
  const paid = lead.paid ? `<p style="margin:0 0 14px 0;"><span style="background:${BRAND.gold};color:#fff;font:600 11px Arial,sans-serif;padding:3px 8px;border-radius:4px;">GOOGLE ADS</span></p>` : '';
  const body = `${paid}<p style="margin:0 0 14px 0;font:600 18px/1.3 Georgia,serif;color:${BRAND.brown};">New lead &middot; ${esc(label)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font:400 14px/1.5 Arial,sans-serif;color:${BRAND.ink};">${table}</table>${msg}
    ${button(`${lead.site_url}/admin/leads`, 'Open the lead tracker')}
    <p style="margin:0;font-size:13px;color:${BRAND.muted};">Reply to this email to answer ${esc(lead.first_name || 'the lead')} directly. Saved in the lead tracker and Zoho.</p>`;
  return { subject: `New lead – ${label}: ${name}${lead.company ? ` (${lead.company})` : ''}`, html: shell(body, `${label} enquiry from ${name}`) };
}

function accessRequested(email) {
  return {
    subject: 'New Village Hub admin request',
    html: shell(`
      <p style="margin:0 0 14px;">Someone has asked to use the Village Hub command centre.</p>
      <p style="margin:0 0 14px;"><strong>${esc(email)}</strong> can already sign in, but they only see a waiting screen until you approve them.</p>
      ${button('https://www.villagehub.co.za/admin/access', 'Open the access queue')}
      <p style="margin:0;">You are the only person who can approve this.</p>
    `, `New admin request from ${email}`),
  };
}

function accessApproved() {
  return {
    subject: 'You can sign in to the Village Hub command centre',
    html: shell(`
      <p style="margin:0 0 14px;">Marius has approved your access.</p>
      <p style="margin:0 0 14px;">Sign in with this same email. We will send a one-time code. Nothing else is required.</p>
      ${button('https://www.villagehub.co.za/admin', 'Open the command centre')}
    `, 'Your Village Hub admin access is approved.'),
  };
}

function leadsDigest(d) {
  const oldest = d.oldest
    ? `${esc(d.oldest.company || d.oldest.name || 'Unknown')} · ${esc(d.oldest.product || 'enquiry')} · ${esc(d.oldest.age)}`
    : 'None';
  const actions = (d.actions || []).length
    ? `<ul style="margin:8px 0 16px;padding-left:18px;">${d.actions.map(a => `<li style="margin:4px 0;">${esc(a)}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 16px;">None due today.</p>';
  return {
    subject: `Open leads today: ${d.openCount}`,
    html: shell(`
      <p style="margin:0 0 14px;">Weekday check, 16:00 SAST.</p>
      <p style="margin:0 0 8px;"><strong>${d.openCount}</strong> open lead${d.openCount === 1 ? '' : 's'}.</p>
      <p style="margin:0 0 8px;"><strong>${d.noResponseCount}</strong> with no first response.</p>
      <p style="margin:0 0 8px;"><strong>Oldest unanswered:</strong> ${oldest}</p>
      <p style="margin:14px 0 0;"><strong>Next actions due today</strong></p>
      ${actions}
      ${button(d.link, 'Open the leads')}
      <p style="margin:0;font-size:13px;color:${BRAND.muted};">Sent because there is at least one open lead. Days with none are skipped. WhatsApp auto-send is still off, so this email is the copy that arrives.</p>
    `, `${d.openCount} open leads, ${d.noResponseCount} with no first response.`),
  };
}

// --- Onboarding automation ------------------------------------------------

const HUB_ADDRESS_LINES = ['1st Floor, The Foundry', 'Sauvignon Street, Nooitgedacht Village', 'Stellenbosch, 7600'];

function addressBox(companyName) {
  const lines = [companyName, ...HUB_ADDRESS_LINES].filter(Boolean).map(l => esc(l)).join('<br>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;margin:16px 0 20px;">
    <tr><td style="padding:14px 16px;font:400 15px/1.7 Arial,sans-serif;color:${BRAND.ink};">${lines}</td></tr></table>`;
}

// 6. Paid and live. The client's working instructions.
function activated(app, opts) {
  const o = opts || {};
  if (app.type !== 'virtual_office') {
    return {
      subject: `You are live at The Village Hub (${app.reference})`,
      html: shell(`
        <p style="margin:0 0 14px;">Hi ${esc(app.first_name)},</p>
        <p style="margin:0 0 14px;">Payment received, thank you. Your <strong>${esc(app.plan)}</strong> membership is live.</p>
        ${refBox(app)}
        <p style="margin:0 0 14px;">Use the Village Hub member app (the invitation came from Spacebring) to check in, book the boardroom and see what is included in your plan. Bring your student card the first time you come in.</p>
        <p style="margin:18px 0 0;">See you at the Hub.<br>The Village Hub team</p>
      `, `Your ${app.plan} membership is live.`),
    };
  }
  const company = O.legalCompanyName(app) || '';
  const registered = o.registeredAddress === true;
  return {
    subject: `Your address is live: ${company} at The Village Hub (${app.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(app.first_name)},</p>
      <p style="margin:0 0 14px;">Payment received, thank you. <strong>${esc(company)}</strong> is live on <strong>${esc(app.plan)}</strong>. This is the address to use, exactly as written:</p>
      ${addressBox(company)}
      <p style="margin:0 0 8px;"><strong>How your post works</strong></p>
      <p style="margin:0 0 14px;">Have senders put the company name on the first line. When something arrives we photograph it and message you on WhatsApp the same day. Collect on weekdays between 08:00 and 17:00, or tell us to forward it. We hold items for 30 days.</p>
      <p style="margin:0 0 8px;"><strong>What the address is for</strong></p>
      ${registered
        ? `<p style="margin:0 0 14px;">You may use it as your business, postal and registered address. Please update your registered address with CIPC (form CoR21.1) and SARS within 30 days and send us proof of both. If you need a letter confirming the address for CIPC, SARS or your bank, reply to this email and we will send it.</p>`
        : `<p style="margin:0 0 14px;">You may use it as your business and postal address: website, invoices, cards and Google Business Profile. It is not your registered CIPC or SARS address on this plan, and we cannot accept registered mail or legal documents for you. If you need that, reply and we will add it: R250/month excl. VAT, 3-month minimum.</p>`}
      <p style="margin:0 0 14px;">Your hot desk days${app.plan === 'Village Address' ? '' : ' and boardroom hours'} are in the Village Hub member app. Book there before you come in.</p>
      <p style="margin:18px 0 0;">Welcome to the Village.<br>The Village Hub team</p>
    `, `${esc(company)} is live at The Village Hub.`),
  };
}

// 7. To the mail desk when a virtual office client goes live.
function mailDesk(app, opts) {
  const o = opts || {};
  const registered = o.registeredAddress === true;
  const names = [O.legalCompanyName(app), app.company_trading_name, app.company_name]
    .filter((n, i, a) => n && a.indexOf(n) === i).map(n => esc(n)).join('<br>');
  return {
    subject: `New virtual office client: ${O.legalCompanyName(app) || app.last_name} (${app.plan})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">New virtual office client is live</p>
      <p style="margin:0 0 14px;">Accept post from today for:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;margin:0 0 18px;">
        <tr><td style="padding:14px 16px;font:600 15px/1.7 Arial,sans-serif;color:${BRAND.ink};">${names}</td></tr></table>
      <p style="margin:0 0 14px;">
        <strong>Contact</strong> ${esc(app.first_name)} ${esc(app.last_name)}<br>
        <strong>WhatsApp</strong> ${esc(app.phone || 'not given')}<br>
        <strong>Email</strong> ${esc(app.email)}<br>
        <strong>Plan</strong> ${esc(app.plan)}<br>
        <strong>Expected post</strong> ${esc(app.expected_mail_volume || 'not stated')}<br>
        <strong>Reference</strong> ${esc(app.reference)}
      </p>
      <p style="margin:0 0 6px;"><strong>To do now</strong></p>
      <p style="margin:0 0 14px;">1. Label a pigeon-hole with the company name.<br>2. Add the client to the Virtual Office Mail Log.</p>
      <p style="margin:0 0 6px;"><strong>When post arrives</strong></p>
      <p style="margin:0 0 14px;">Photograph it, log it, and WhatsApp the photo to the client before 16:00 the same day. Hand post only to the client or someone they have named in writing.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${registered ? '#e6f4ea' : '#fdecea'};border-radius:6px;margin:0 0 6px;">
        <tr><td style="padding:12px 16px;font:400 14px/1.6 Arial,sans-serif;color:${BRAND.ink};">
          <strong>Registered mail and legal documents:</strong>
          ${registered
            ? 'ACCEPT and sign. This client has the registered address service and a signed mandate. Tell them the same day and tell Christel.'
            : 'DO NOT sign. This client does not have the registered address service. Ask the courier or sheriff to return it to the sender, and tell Christel.'}
        </td></tr></table>
    `, `${esc(app.company_name || '')} is live. Start accepting their post.`),
  };
}

// 8. To staff when the automation stops and a person is needed.
function onboardingAttention(app, step, message, reviewUrl) {
  return {
    subject: `Needs attention: onboarding stopped for ${app.company_name || (app.first_name + ' ' + app.last_name)} (${app.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Automatic set-up stopped</p>
      ${refBox(app)}
      <p style="margin:0 0 14px;"><strong>Stopped at</strong> ${esc(step)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdecea;border-radius:6px;margin:0 0 18px;">
        <tr><td style="padding:12px 16px;font:400 14px/1.6 Arial,sans-serif;color:${BRAND.ink};">${esc(message)}</td></tr></table>
      <p style="margin:0 0 14px;">Everything before this step is done and will not be repeated. Fix the cause, then press Retry on the application. The client has not been told anything went wrong.</p>
      ${button(reviewUrl, 'Open the application')}
    `, `Onboarding for ${app.reference} needs a person.`),
  };
}

module.exports = {
  applicantReceived, staffAlert, infoRequested, approved, declined, leadAlert, DOC_LABELS,
  accessRequested, accessApproved, leadsDigest,
  activated, mailDesk, onboardingAttention,
};
