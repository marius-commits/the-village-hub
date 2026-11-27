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
    return `<p style="margin:0 0 14px;"><strong>Catering.</strong> You asked for a quote from The Village Table, the restaurant downstairs. We are putting you in touch with them, and they quote and bill you directly.</p>`;
  }
  if (b.catering === 'own') {
    return `<p style="margin:0 0 14px;"><strong>Catering.</strong> You are bringing your own. That is fine. Coffee, tea and water are on us.</p>`;
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
  return `<p style="margin:18px 0 0;">The Village Hub team<br>WhatsApp ${HUB_WHATSAPP}</p>`;
}

function holdText(b) {
  return `${B.timeText(b.hold_expires_at)} on ${B.dayText(b.hold_expires_at)}`;
}

// B1. To the person: the room is held and the invoice is on its way.
function held(b, pr, opts) {
  const o = opts || {};
  return {
    subject: `Your boardroom is held: pay to confirm (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">The room is held for you. One step left: pay the invoice and the booking is confirmed.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;"><strong>Your invoice</strong> is made out to ${esc(whoPays(b))} and comes in a separate email from Spacebring, our booking system${o.invoiceTitle ? `, number <strong>${esc(o.invoiceTitle)}</strong>` : ''}. It shows how to pay.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'Open the invoice (PDF)') : ''}
      <p style="margin:0 0 14px;"><strong>We hold the room until ${esc(holdText(b))}.</strong> If the invoice is not paid by then the slot opens up again for someone else.</p>
      ${cateringLine(b)}
      <p style="margin:0 0 14px;">Once you have paid we email your confirmation, and on the day your Wi-Fi code comes by WhatsApp to ${esc(b.phone)}.</p>
      <p style="margin:0 0 6px;">Need to change something? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}, and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `${roomName(b)} held for ${B.dayText(b.starts_at)}. Pay the invoice to confirm.`),
  };
}

// B2. To the person when the hold and invoice are done by hand (automation
// off, or a step stopped). Honest about what has and has not happened.
function received(b, pr) {
  return {
    subject: `We have your boardroom request (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thank you. The slot you chose was open when you sent this, and your request is with the team now.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>What happens next</strong></p>
      <p style="margin:0 0 6px;">1. We put the room on hold for you and email your invoice, made out to ${esc(whoPays(b))}. During office hours that is usually within the hour.</p>
      <p style="margin:0 0 6px;">2. You pay the invoice. That confirms the booking.</p>
      <p style="margin:0 0 14px;">3. On the day your Wi-Fi code comes by WhatsApp to ${esc(b.phone)}.</p>
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">Questions? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}, and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Boardroom request ${b.reference} received. Your invoice follows.`),
  };
}

// B3. To the person on the quote route.
function quote(b) {
  const why = (b.quote_reasons || []).map(r => B.REASON_TEXT[r]).filter(Boolean);
  return {
    subject: `We are preparing your quote (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thank you. We have everything we need to quote you, and you will hear from us <strong>within one business day</strong>.</p>
      ${bookingBox(b, null)}
      ${why.length ? `<p style="margin:0 0 14px;">This one is quoted by a person, not booked online, because: ${esc(why.join('; '))}.</p>` : ''}
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">In a hurry? WhatsApp us on ${HUB_WHATSAPP} and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Quote request ${b.reference} received. We reply within one business day.`),
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
    subject: `Confirmed: ${roomName(b)} on ${B.dayText(b.starts_at)} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Payment received, thank you. Your booking is confirmed.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>On the day</strong></p>
      <p style="margin:0 0 6px;">We are on the 1st Floor of The Foundry, Sauvignon Street, Nooitgedacht Village, Stellenbosch, with parking at the door. <a href="${MAPS}" style="color:${BRAND.brown};">Get directions</a>.</p>
      <p style="margin:0 0 6px;">Your Wi-Fi code comes by WhatsApp to ${esc(b.phone)} before you arrive. Share it with your guests.</p>
      <p style="margin:0 0 14px;">Coffee, tea and water are included.${needs.length ? ` We will have this ready for you: ${esc(needs.join('; ').toLowerCase())}.` : ''}</p>
      ${cateringLine(b)}
      <p style="margin:0 0 6px;">Plans changed? Reply to this email or WhatsApp us on ${HUB_WHATSAPP} as early as you can, and quote <strong>${esc(b.reference)}</strong>.</p>
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
    subject: `Your boardroom hold lapses soon (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">A quick reminder. We are still holding the room for you, and the invoice has not been paid yet.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;"><strong>The hold lapses at ${esc(holdText(b))}.</strong> Pay the invoice before then and the room is yours.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'Open the invoice (PDF)') : ''}
      <p style="margin:0 0 6px;">Paid already, or need a little longer? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}.</p>
      ${sign()}
    `, `Pay by ${holdText(b)} to keep the room.`),
  };
}

// B8. To the person, when the hold lapsed and the room was released.
function released(b, pr, bookUrl) {
  return {
    subject: `Your boardroom hold has lapsed (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">We held the room for you, but the invoice was not paid in time, so the slot is open again. The invoice has been cancelled and nothing is owed.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">Still want it? If the slot is free you can book it again in two minutes.</p>
      ${button(bookUrl, 'Book the boardroom')}
      <p style="margin:0 0 6px;">If you did pay, reply to this email with your proof of payment and we will sort it out straight away.</p>
      ${sign()}
    `, `The hold on ${roomName(b)} has lapsed.`),
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
    subject: `Catering quote wanted: ${b.guests} guests at The Village Hub, ${B.dayText(b.starts_at)}`,
    html: shell(`
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;">A boardroom client at The Village Hub upstairs has asked for a catering quote from you. Please contact them directly. You quote and bill them yourselves.</p>
      <p style="margin:0 0 14px;">
        <strong>Contact</strong> ${esc(b.first_name)} ${esc(b.last_name)}${b.company_name ? `, ${esc(b.company_name)}` : ''}<br>
        <strong>Phone</strong> ${esc(b.phone)}<br>
        <strong>Email</strong> <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a><br>
        <strong>Date</strong> ${esc(B.dayText(b.starts_at))}<br>
        <strong>Time</strong> ${esc(B.slotText(b.starts_at, b.ends_at))}<br>
        <strong>Guests</strong> ${esc(b.guests)}<br>
        <strong>Room</strong> ${esc(roomName(b))}
      </p>
      ${b.catering_notes ? `<p style="margin:0 0 14px;"><strong>What they asked for</strong> ${esc(b.catering_notes)}</p>` : ''}
      <p style="margin:0 0 14px;">Their booking with us is ${b.status === 'confirmed' ? 'confirmed' : 'not yet confirmed'}, reference ${esc(b.reference)}.</p>
      ${sign()}
    `, `Catering quote wanted for ${b.guests} guests.`),
  };
}

// B12. The first gate. Sent to anyone who enquires about a boardroom through
// a website form without having given the details a booking needs.
function enquiryReply(lead, bookUrl) {
  const first = String(lead.first_name || '').trim().split(' ')[0];
  return {
    subject: 'Your boardroom enquiry: check availability and book in two minutes',
    html: shell(`
      <p style="margin:0 0 14px;">Hi${first ? ` ${esc(first)}` : ''},</p>
      <p style="margin:0 0 14px;">Thank you for your boardroom enquiry at The Village Hub. You do not have to wait for us: you can see what is free and book it yourself right now.</p>
      ${button(bookUrl, 'Check availability and book')}
      <p style="margin:0 0 8px;"><strong>It asks four things</strong></p>
      <p style="margin:0 0 6px;">1. The date, the time and how many people.</p>
      <p style="margin:0 0 6px;">2. The type of meeting, and what you need in the room.</p>
      <p style="margin:0 0 6px;">3. Catering: none, your own, or a quote from The Village Table downstairs.</p>
      <p style="margin:0 0 14px;">4. Whether the invoice is for you or for a company.</p>
      <p style="margin:0 0 14px;">You see both rooms live: the Village Boardroom (12 seats, R390 an hour) and the Village Chamber (10 seats, R350 an hour), both excl. VAT. Pick a free slot and we hold it and email your invoice. Payment confirms it.</p>
      <p style="margin:0 0 14px;">More than 12 people, a Saturday or after hours? Use the same form and we come back with a quote within one business day.</p>
      <p style="margin:0 0 6px;">Rather talk to someone? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}.</p>
      ${sign()}
    `, 'See what is free and book the boardroom online in two minutes.'),
  };
}

module.exports = {
  held, received, quote, staffNew, confirmed, staffPaid, reminder, released,
  staffLapsed, attention, villageTable, enquiryReply, bookingBox, whoPays, roomName,
};
