// Pure helpers for the weekday open-leads reminder.
// No network, no secrets. The scheduled function and the tests both use this.

const OPEN = ['new', 'contacted', 'viewing_booked', 'quoted'];

const PRODUCT_LABELS = {
  boardroom: 'Boardroom',
  meeting_room: 'Meeting room',
  hot_desk: 'Hot desk',
  private_office: 'Private office',
  virtual_office: 'Virtual office',
  student: 'Student',
  desk: 'Desk',
  village_stay: 'Village stay',
  event: 'Event',
  corporate_event: 'Event',
  other: 'Other',
};

// Submit this in Meta Business Manager as a utility template if you want a
// dedicated digest instead of folding the text into the approved T33 staff
// alert. Until its meta_status is APPROVED, the job uses T33 when that row
// is approved, and always emails the same words.
const DEDICATED_TEMPLATE = {
  name: 'vh_open_leads_digest',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Village Hub open leads for {{digest_date}}.',
    '',
    'Open leads: {{open_count}}.',
    'No first response yet: {{no_response_count}}.',
    'Oldest unanswered: {{oldest_lead}}.',
    '',
    'Next actions due today: {{next_actions}}.',
    '',
    'Open the list: {{admin_link}}',
  ].join('\n'),
};

function productLabel(code) {
  return PRODUCT_LABELS[code] || code || 'Enquiry';
}

function johannesburgParts(now) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const bag = {};
  for (const p of fmt.formatToParts(now)) bag[p.type] = p.value;
  return bag;
}

function johannesburgDateKey(now) {
  const p = johannesburgParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function isWeekdaySAST(now) {
  const day = johannesburgParts(now).weekday;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day);
}

function dayBoundsSAST(now) {
  const key = johannesburgDateKey(now);
  const start = new Date(`${key}T00:00:00+02:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), key };
}

function ageLabel(created, now) {
  const ms = now.getTime() - new Date(created).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function leadName(lead) {
  return lead.company
    || [lead.first_name, lead.last_name].filter(Boolean).join(' ')
    || lead.email
    || 'Unknown';
}

function buildDigest(leads, now = new Date(), link = 'https://www.villagehub.co.za/admin/leads') {
  const open = (leads || []).filter(l => OPEN.includes(l.status));
  if (!open.length) {
    return { skip: true, reason: 'no open leads', openCount: 0, noResponseCount: 0, actions: [], link };
  }
  const silent = open.filter(l => !l.first_response_at);
  const oldest = silent.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] || null;
  const { start, end } = dayBoundsSAST(now);
  const actions = open
    .filter(l => l.next_action_at && new Date(l.next_action_at) >= start && new Date(l.next_action_at) < end)
    .map(l => `${leadName(l)}: ${l.next_action || 'Follow up'}`);

  return {
    skip: false,
    openCount: open.length,
    noResponseCount: silent.length,
    oldest: oldest ? {
      company: leadName(oldest),
      product: productLabel(oldest.product),
      age: ageLabel(oldest.created_at, now),
    } : null,
    actions,
    link,
    dateLabel: johannesburgDateKey(now),
  };
}

function summaryText(digest) {
  const oldest = digest.oldest
    ? `${digest.oldest.company}, ${digest.oldest.product}, ${digest.oldest.age}`
    : 'none';
  const actions = digest.actions.length ? digest.actions.join('; ') : 'none due today';
  return [
    `Open leads: ${digest.openCount}.`,
    `No first response: ${digest.noResponseCount}.`,
    `Oldest unanswered: ${oldest}.`,
    `Next actions due today: ${actions}.`,
  ].join(' ');
}

function fillTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function whatsappVariables(digest, templateName) {
  if (templateName === DEDICATED_TEMPLATE.name) {
    return {
      digest_date: digest.dateLabel,
      open_count: String(digest.openCount),
      no_response_count: String(digest.noResponseCount),
      oldest_lead: digest.oldest
        ? `${digest.oldest.company}, ${digest.oldest.product}, ${digest.oldest.age}`
        : 'none',
      next_actions: digest.actions.length ? digest.actions.join('; ') : 'none due today',
      admin_link: digest.link,
    };
  }
  return {
    alert_type: 'open-leads digest',
    summary: summaryText(digest),
    admin_link: digest.link,
  };
}

module.exports = {
  OPEN,
  PRODUCT_LABELS,
  DEDICATED_TEMPLATE,
  productLabel,
  johannesburgDateKey,
  isWeekdaySAST,
  dayBoundsSAST,
  buildDigest,
  summaryText,
  fillTemplate,
  whatsappVariables,
  leadName,
  ageLabel,
};
