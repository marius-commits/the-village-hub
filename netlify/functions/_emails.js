// Transactional email templates for the membership application system.
// Table-based layout and inline styles, because Outlook and Gmail still
// ignore most modern CSS.

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
       <strong>Registered address requested</strong> ${app.wants_registered_address ? 'YES — check the Sureship lease position first' : 'No'}`
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
function approved(app, message) {
  return {
    subject: `Approved — ${app.plan} at The Village Hub (${app.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${app.first_name},</p>
      <p style="margin:0 0 14px;">Good news. Your application for <strong>${app.plan}</strong> has been approved and your documents check out.</p>
      ${refBox(app)}
      ${message ? `<p style="margin:0 0 14px;">${message}</p>` : ''}
      <p style="margin:0 0 14px;"><strong>What happens now.</strong> We are setting your membership up. You will get an invoice from our member system, Spacebring, within the next business day. Your membership starts once that invoice is paid${app.preferred_start_date ? `, from <strong>${app.preferred_start_date}</strong>` : ''}.</p>
      <p style="margin:0 0 14px;">That invoice email also carries your login for the member app, where you book the boardroom, see your day passes and get your access.</p>
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

module.exports = { applicantReceived, staffAlert, infoRequested, approved, declined, DOC_LABELS };
