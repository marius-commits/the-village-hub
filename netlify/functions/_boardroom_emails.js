// Emails for boardroom bookings. Same shell and palette as every other
// Village Hub email (see _emails.js).

const T = require('./_emails');
const B = require('./_boardroom');

const { shell, button, esc, BRAND, HUB_WHATSAPP } = T;
const MAPS = 'https://maps.app.goo.gl/im2Y2uyJzdBsV9gh7';

function roomName(b) {
  return b.room_title || 'Boardroom';
}

function whoPays(b) {
  return b.billing === 'company' && b.company_name ? b.company_name : `${b.first_name} ${b.last_name}`;
}

// The gold-edged box that states the booking in every email.
function bookingBox(b, pr) {
  const lines = [
    `<strong>Reference</strong> ${esc(b.reference)}`,
    `<strong>Room</strong> ${esc(roomName(b))}`,
    `<strong>Date</strong> ${esc(B.dayText(b.starts_at))}`,
    `<strong>Time</strong> ${esc(B.slotText(b.starts_at, b.ends_at))}`,
    `<strong>Guests</strong> ${esc(b.guests)}`,
  ];
  if (pr) lines.push(`<strong>Price</strong> ${B.rand(pr.exVat)} excl. VAT (${B.rand(pr.inclVat)} incl. VAT), ${pr.hours} ${pr.hours === 1 ? 'hour' : 'hours'} at ${B.rand(pr.rate)} an hour`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;margin:20px 0;">
    <tr><td style="padding:14px 16px;font:400 14px/1.7 Arial,sans-serif;color:${BRAND.ink};">${lines.join('<br>')}</td></tr></table>`;
}

function cateringLine(b) {
  if (b.catering === 'village_table') {
    return `<p style="margin:0 0 14px;"><strong>Catering:</strong> we'll put you in touch with The Village Table, the restaurant downstairs. They'll send you a quote and bill you directly.</p>`;
  }
  if (b.catering === 'own') {
    return `<p style="margin:0 0 14px;"><strong>Catering:</strong> you're welcome to bring your own. Coffee, tea and water are on us.</p>`;
  }
  return '';
}

function briefRows(b) {
  const needs = (b.needs || []).map(n => B.NEEDS[n]).filter(Boolean);
  const rows = [
    ['Type', B.MEETING_TYPES[b.meeting_type] || b.meeting_type],
    ['Needs', needs.length ? needs.join('; ') : 'Nothing extra'],
    ['Catering', (B.CATERING[b.catering] || b.catering) + (b.catering_notes ? `. ${b.catering_notes}` : '')],
    ['Invoice to', whoPays(b) + (b.company_vat ? ` (VAT no. ${b.company_vat})` : '')],
    ['Notes', b.notes || 'None'],
  ];
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">${rows.map(r =>
    `<tr><td style="padding:3px 12px 3px 0;vertical-align:top;font:600 13px/1.6 Arial,sans-serif;color:${BRAND.muted};white-space:nowrap;">${esc(r[0])}</td><td style="padding:3px 0;font:400 14px/1.6 Arial,sans-serif;color:${BRAND.ink};">${esc(r[1])}</td></tr>`
  ).join('')}</table>`;
}

function sign() {
  return `<p style="margin:18px 0 0;">Kind regards,<br>The Village Hub team<br>WhatsApp ${HUB_WHATSAPP}</p>`;
}

function holdText(b) {
  return `${B.timeText(b.hold_expires_at)} on ${B.dayText(b.hold_expires_at)}`;
}

// B1. To the person: the room is held and the invoice is on its way.
function held(b, pr, opts) {
  const o = opts || {};
  return {
    subject: `Your ${roomName(b)} is reserved: please pay to confirm (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Good news: we've reserved the ${esc(roomName(b))} for you. Once the invoice is paid, your booking is confirmed.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">Your invoice${o.invoiceTitle ? ` (<strong>${esc(o.invoiceTitle)}</strong>)` : ''} is in the name of ${esc(whoPays(b))}. It comes in a separate email from Spacebring, our booking system, and shows how to pay.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'View your invoice') : ''}
      <p style="margin:0 0 14px;"><strong>Please pay by ${esc(holdText(b))}.</strong> After that, we release the room so others can book it.</p>
      ${cateringLine(b)}
      <p style="margin:0 0 14px;">As soon as your payment comes through, we'll email your confirmation. On the day, we'll WhatsApp your Wi-Fi code to ${esc(b.phone)}.</p>
      <p style="margin:0 0 6px;">Need to change anything? Just reply to this email or WhatsApp us on ${HUB_WHATSAPP}, quoting <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `The ${roomName(b)} is reserved for ${B.dayText(b.starts_at)}. Pay the invoice to confirm.`),
  };
}

// B2. To the person when the hold and invoice are done by hand (automation
// off, or a step stopped). Honest about what has and has not happened.
function received(b, pr) {
  return {
    subject: `We've received your booking request (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thanks for booking with The Village Hub. The ${esc(roomName(b))} was free at the time you chose, and we've received your request.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>What happens next</strong></p>
      <p style="margin:0 0 6px;">1. We'll reserve the room for you and email an invoice in the name of ${esc(whoPays(b))}, usually within an hour during office hours.</p>
      <p style="margin:0 0 6px;">2. Once the invoice is paid, your booking is confirmed.</p>
      <p style="margin:0 0 14px;">3. On the day, we'll WhatsApp your Wi-Fi code to ${esc(b.phone)}.</p>
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">Any questions? Just reply to this email or WhatsApp us on ${HUB_WHATSAPP}, quoting <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Booking request ${b.reference} received. Your invoice will follow shortly.`),
  };
}

// B3. To the person on the quote route.
function quote(b) {
  const why = (b.quote_reasons || []).map(r => B.REASON_TEXT[r]).filter(Boolean);
  return {
    subject: `We're preparing your quote (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thanks for your request. We have everything we need, and we'll send you a quote <strong>within one business day</strong>.</p>
      ${bookingBox(b, null)}
      ${why.length ? `<p style="margin:0 0 14px;">We quote this one personally rather than online because of the following: ${esc(why.join('; '))}.</p>` : ''}
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">In a hurry? WhatsApp us on ${HUB_WHATSAPP}, quoting <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Quote request ${b.reference} received. We'll reply within one business day.`),
  };
}

// B4. To the team, the moment a request is saved.
function staffNew(b, pr, opts) {
  const o = opts || {};
  const name = `${b.first_name} ${b.last_name}`;
  let todo;
  if (b.route === 'quote') {
    const why = (b.quote_reasons || []).map(r => B.REASON_TEXT[r]).filter(Boolean);
    todo = `<p style="margin:0 0 6px;"><strong>Needs a quote.</strong> ${esc(why.join('; ') || 'Outside the online rules')}.</p>
      <p style="margin:0 0 14px;">They have been told to expect a reply within one business day. Reply to this email to answer them directly.</p>`;
  } else if (o.state === 'held') {
    todo = `<p style="margin:0 0 14px;"><strong>Nothing to do yet.</strong> The room is held in Spacebring and invoice ${esc(o.invoiceTitle || '')} has gone out. You will be told when it is paid. The hold lapses at ${esc(holdText(b))}.</p>`;
  } else if (o.state === 'dry') {
    todo = `<p style="margin:0 0 14px;"><strong>Dry run.</strong> The steps were worked out and recorded but nothing was created in Spacebring. Do the hold and the invoice by hand for this one.</p>`;
  } else if (o.state === 'attention') {
    todo = `<p style="margin:0 0 14px;"><strong>Needs attention.</strong> The automatic set-up stopped: ${esc(o.message || 'unknown reason')}. Finish the hold and the invoice in Spacebring by hand. The person has been told their request is in and an invoice follows.</p>`;
  } else {
    todo = `<p style="margin:0 0 6px;"><strong>To do in Spacebring</strong></p>
      <p style="margin:0 0 6px;">1. Book ${esc(roomName(b))} for ${esc(B.dayText(b.starts_at))}, ${esc(B.slotText(b.starts_at, b.ends_at))}, in the name of ${esc(whoPays(b))}.</p>
      <p style="margin:0 0 6px;">2. Issue the invoice: ${B.rand(pr.exVat)} excl. VAT.</p>
      <p style="margin:0 0 14px;">3. They have been told the invoice follows, usually within the hour.</p>`;
  }
  const catering = b.catering === 'village_table'
    ? `<p style="margin:0 0 14px;"><strong>Catering:</strong> wants a quote from The Village Table. ${o.villageTableTold ? 'The Village Table has been emailed the details.' : 'Please introduce them to The Village Table.'}</p>`
    : '';
  const member = o.existingMember
    ? `<p style="margin:0 0 14px;"><strong>Note:</strong> this email address already belongs to a Spacebring member. Check whether member rates or credits should apply before the invoice is paid.</p>`
    : '';
  return {
    subject: `${b.route === 'quote' ? 'Quote request' : 'Boardroom booking'}: ${roomName(b)}, ${B.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">${b.route === 'quote' ? 'New quote request' : 'New boardroom booking'}</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">
        <strong>Name</strong> ${esc(name)}<br>
        <strong>Email</strong> <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a><br>
        <strong>Phone</strong> ${esc(b.phone)}
      </p>
      ${briefRows(b)}
      ${todo}
      ${catering}
      ${member}
    `, `${esc(name)}: ${esc(roomName(b))} on ${B.dayText(b.starts_at)}.`),
  };
}

// B5. To the person, when the invoice is paid.
function confirmed(b, pr) {
  const needs = (b.needs || []).map(n => B.NEEDS[n]).filter(Boolean);
  return {
    subject: `Booking confirmed: ${roomName(b)} on ${B.dayText(b.starts_at)} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thank you, we've received your payment. Your booking is confirmed and we look forward to welcoming you.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>On the day</strong></p>
      <p style="margin:0 0 6px;">You'll find us on the 1st Floor of The Foundry, Sauvignon Street, Nooitgedacht Village, Stellenbosch. There's parking right outside. <a href="${MAPS}" style="color:${BRAND.brown};">Get directions</a>.</p>
      <p style="margin:0 0 6px;">We'll WhatsApp your Wi-Fi code to ${esc(b.phone)} before you arrive, so you can share it with your guests.</p>
      <p style="margin:0 0 14px;">Coffee, tea and water are included.${needs.length ? ` We'll also have the following ready for you: ${esc(needs.join('; ').toLowerCase())}.` : ''}</p>
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">If your plans change, please let us know as early as possible. Just reply to this email or WhatsApp us on ${HUB_WHATSAPP}, quoting <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Your ${roomName(b)} booking is confirmed.`),
  };
}

// B6. To the team, when the invoice is paid.
function staffPaid(b, pr) {
  const name = `${b.first_name} ${b.last_name}`;
  const needs = (b.needs || []).map(n => B.NEEDS[n]).filter(Boolean);
  return {
    subject: `Paid and confirmed: ${roomName(b)}, ${B.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Boardroom booking paid</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 6px;"><strong>To do before they arrive</strong></p>
      <p style="margin:0 0 6px;">1. Room ready 15 minutes before ${esc(B.timeText(b.starts_at))}: ${esc(needs.length ? needs.join('; ') : 'standard set-up')}.</p>
      <p style="margin:0 0 6px;">2. Catering: ${esc(B.CATERING[b.catering] || b.catering)}${b.catering_notes ? `. ${esc(b.catering_notes)}` : ''}.</p>
      <p style="margin:0 0 14px;">3. Wi-Fi: nothing to do. The code goes out by WhatsApp from the booking in Spacebring.</p>
      <p style="margin:0 0 14px;"><strong>Contact</strong> ${esc(name)}, ${esc(b.phone)}, <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a></p>
      ${b.notes ? `<p style="margin:0 0 14px;"><strong>Their notes</strong> ${esc(b.notes)}</p>` : ''}
    `, `${esc(name)} paid. ${esc(roomName(b))} confirmed.`),
  };
}

// B7. To the person, once, when half the hold has gone and nothing is paid.
function reminder(b, pr, opts) {
  const o = opts || {};
  return {
    subject: `Reminder: please pay to keep your booking (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Just a friendly reminder: we're still holding the ${esc(roomName(b))} for you, but we haven't received payment yet.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;"><strong>Please pay by ${esc(holdText(b))}</strong> to keep the room. After that, we release it so others can book it.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'View your invoice') : ''}
      <p style="margin:0 0 6px;">Already paid, or need a little more time? Just reply to this email or WhatsApp us on ${HUB_WHATSAPP}.</p>
      ${sign()}
    `, `Please pay by ${holdText(b)} to keep the room.`),
  };
}

// B8. To the person, when the hold lapsed and the room was released.
function released(b, pr, bookUrl) {
  return {
    subject: `Your room reservation has expired (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">We held the ${esc(roomName(b))} for you, but we didn't receive payment in time, so we've released it. We've cancelled the invoice, so you don't owe anything.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">Still need a room? If the time is still free, you can book again in a couple of minutes.</p>
      ${button(bookUrl, 'Book again')}
      <p style="margin:0 0 6px;">If you did pay, just reply with your proof of payment and we'll sort it out right away.</p>
      ${sign()}
    `, `Your reservation for the ${roomName(b)} has expired.`),
  };
}

// B9. To the team: a hold lapsed.
function staffLapsed(b, pr, opts) {
  const o = opts || {};
  const name = `${b.first_name} ${b.last_name}`;
  const what = o.released
    ? `The room has been released in Spacebring${o.invoiceVoided ? ' and the invoice voided' : '. <strong>The invoice could not be voided automatically: please void it in Spacebring</strong>'}. The person has been told.`
    : 'Automatic release is switched off, so the room is still blocked. Chase the payment, or cancel the booking and void the invoice in Spacebring.';
  return {
    subject: `Unpaid boardroom hold lapsed: ${roomName(b)}, ${B.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Unpaid hold lapsed</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">${what}</p>
      <p style="margin:0 0 14px;"><strong>Contact</strong> ${esc(name)}, ${esc(b.phone)}, <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a></p>
    `, `${esc(name)} did not pay in time.`),
  };
}

// B10. To the team: a step stopped and a person has to finish it.
function attention(b, step, message) {
  return {
    subject: `Needs attention: boardroom booking ${b.reference} stopped at "${step}"`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Boardroom booking needs attention</p>
      ${bookingBox(b, null)}
      <p style="margin:0 0 14px;"><strong>Stopped at</strong> ${esc(step)}<br><strong>Reason</strong> ${esc(message)}</p>
      <p style="margin:0 0 14px;">Steps already done are recorded, so nothing was created twice. Finish this one by hand in Spacebring. It will not retry on its own.</p>
      <p style="margin:0 0 14px;"><strong>Contact</strong> ${esc(b.first_name)} ${esc(b.last_name)}, ${esc(b.phone)}, <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a></p>
    `, `Booking ${b.reference} stopped at ${step}.`),
  };
}

// B11. To The Village Table, only when VILLAGE_TABLE_EMAIL is set.
function villageTable(b) {
  return {
    subject: `Catering quote request: ${b.guests} guests at The Village Hub, ${B.dayText(b.starts_at)}`,
    html: shell(`
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;">One of our boardroom clients upstairs would like a catering quote from you. Please contact them directly. You'll quote and bill them yourselves.</p>
      <p style="margin:0 0 14px;">
        <strong>Contact</strong> ${esc(b.first_name)} ${esc(b.last_name)}${b.company_name ? `, ${esc(b.company_name)}` : ''}<br>
        <strong>Phone</strong> ${esc(b.phone)}<br>
        <strong>Email</strong> <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a><br>
        <strong>Date</strong> ${esc(B.dayText(b.starts_at))}<br>
        <strong>Time</strong> ${esc(B.slotText(b.starts_at, b.ends_at))}<br>
        <strong>Guests</strong> ${esc(b.guests)}<br>
        <strong>Room</strong> ${esc(roomName(b))}
      </p>
      ${b.catering_notes ? `<p style="margin:0 0 14px;"><strong>What they'd like</strong> ${esc(b.catering_notes)}</p>` : ''}
      <p style="margin:0 0 14px;">Their booking with us (reference ${esc(b.reference)}) is ${b.status === 'confirmed' ? 'confirmed' : 'not confirmed yet'}.</p>
      ${sign()}
    `, `Catering quote request for ${b.guests} guests.`),
  };
}

// B12. The first gate. Sent to anyone who enquires about a boardroom through
// a website form without having given the details a booking needs.
function enquiryReply(lead, bookUrl) {
  const first = String(lead.first_name || '').trim().split(' ')[0];
  return {
    subject: 'Your boardroom enquiry: check availability and book online',
    html: shell(`
      <p style="margin:0 0 14px;">Hi${first ? ` ${esc(first)}` : ''},</p>
      <p style="margin:0 0 14px;">Thanks for your boardroom enquiry. You don't need to wait for us: you can check availability and book online right now. It takes about two minutes.</p>
      ${button(bookUrl, 'Check availability and book')}
      <p style="margin:0 0 8px;"><strong>The booking form asks for</strong></p>
      <p style="margin:0 0 6px;">1. The date, time and number of people.</p>
      <p style="margin:0 0 6px;">2. The type of meeting and what you need in the room.</p>
      <p style="margin:0 0 6px;">3. Catering: none, your own, or a quote from The Village Table downstairs.</p>
      <p style="margin:0 0 14px;">4. Whether the invoice is in your name or a company's.</p>
      <p style="margin:0 0 14px;">You'll see live availability for both rooms: the Village Boardroom (12 seats, R390 an hour) and the Village Chamber (10 seats, R350 an hour), both excl. VAT. Choose a free slot and we'll reserve it and email your invoice. Once it's paid, your booking is confirmed.</p>
      <p style="margin:0 0 14px;">More than 12 people, a Saturday or outside normal hours? Use the same form and we'll send you a quote within one business day.</p>
      <p style="margin:0 0 6px;">Prefer to speak to someone? Just reply to this email or WhatsApp us on ${HUB_WHATSAPP}.</p>
      ${sign()}
    `, 'Check availability and book the boardroom online in about two minutes.'),
  };
}

module.exports = {
  held, received, quote, staffNew, confirmed, staffPaid, reminder, released,
  staffLapsed, attention, villageTable, enquiryReply, bookingBox, whoPays, roomName,
};
