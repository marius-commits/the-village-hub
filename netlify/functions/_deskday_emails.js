// Emails for hot desk bookings by the hour, half day or full day. Same shell
// and palette as every other Village Hub email (see _emails.js).

const T = require('./_emails');
const D = require('./_deskday');

const { shell, button, esc, BRAND, HUB_WHATSAPP } = T;
const MAPS = 'https://maps.app.goo.gl/im2Y2uyJzdBsV9gh7';

function whoPays(b) { return b.billing === 'company' && b.company_name ? b.company_name : `${b.first_name} ${b.last_name}`; }
function what(b) { return D.PRODUCTS[b.product] ? D.PRODUCTS[b.product].title : 'Hot desk'; }

function bookingBox(b, pr) {
  const lines = [
    `<strong>Reference</strong> ${esc(b.reference)}`,
    `<strong>Desk</strong> Hot desk, ${esc(what(b).toLowerCase())}`,
    `<strong>Date</strong> ${esc(D.dayText(b.starts_at))}`,
    `<strong>Time</strong> ${b.product === 'day' ? 'Full day. Front desk open 08:00 to 17:00' : esc(D.slotText(b.starts_at, b.ends_at))}`,
  ];
  if (pr) lines.push(`<strong>Price</strong> ${D.rand(pr.exVat)} excl. VAT (${D.rand(pr.inclVat)} incl. VAT)`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};border-left:3px solid ${BRAND.gold};border-radius:6px;margin:20px 0;">
    <tr><td style="padding:14px 16px;font:400 14px/1.7 Arial,sans-serif;color:${BRAND.ink};">${lines.join('<br>')}</td></tr></table>`;
}

function sign() { return `<p style="margin:18px 0 0;">The Village Hub team<br>WhatsApp ${HUB_WHATSAPP}</p>`; }
function holdText(b) { return `${D.timeText(b.hold_expires_at)} on ${D.dayText(b.hold_expires_at)}`; }
function contact(b) {
  return `<p style="margin:0 0 14px;"><strong>Contact</strong> ${esc(b.first_name)} ${esc(b.last_name)}, ${esc(b.phone)}, <a href="mailto:${esc(b.email)}" style="color:${BRAND.brown};">${esc(b.email)}</a>${b.company_name ? `<br><strong>Invoice to</strong> ${esc(b.company_name)}${b.company_vat ? ` (VAT no. ${esc(b.company_vat)})` : ''}` : ''}</p>`;
}

// To the person: the desk is held and the invoice is on its way.
function held(b, pr, opts) {
  const o = opts || {};
  return {
    subject: `Your desk is held: pay to confirm (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Your desk is held. One step left: pay the invoice and the booking is confirmed.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;"><strong>Your invoice</strong> is made out to ${esc(whoPays(b))} and comes in a separate email from Spacebring, our booking system${o.invoiceTitle ? `, number <strong>${esc(o.invoiceTitle)}</strong>` : ''}. It shows how to pay.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'Open the invoice (PDF)') : ''}
      <p style="margin:0 0 14px;"><strong>We hold the desk until ${esc(holdText(b))}.</strong> If the invoice is not paid by then the desk opens up again.</p>
      <p style="margin:0 0 14px;">Once you have paid we email your confirmation, and on the day your Wi-Fi code comes by WhatsApp to ${esc(b.phone)}.</p>
      <p style="margin:0 0 6px;">Need to change something? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}, and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Desk held for ${D.dayText(b.starts_at)}. Pay the invoice to confirm.`),
  };
}

// To the person when the hold and invoice are done by hand.
function received(b, pr) {
  return {
    subject: `We have your desk booking (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Thank you. A desk was free when you booked, and your booking is with the team now.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>What happens next</strong></p>
      <p style="margin:0 0 6px;">1. We hold the desk and email your invoice, made out to ${esc(whoPays(b))}. During office hours that is usually within the hour.</p>
      <p style="margin:0 0 6px;">2. You pay the invoice. That confirms the booking.</p>
      <p style="margin:0 0 14px;">3. On the day your Wi-Fi code comes by WhatsApp to ${esc(b.phone)}.</p>
      <p style="margin:0 0 6px;">Questions? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}, and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Desk booking ${b.reference} received. Your invoice follows.`),
  };
}

// To the team, the moment a booking is saved.
function staffNew(b, pr, opts) {
  const o = opts || {};
  const name = `${b.first_name} ${b.last_name}`;
  let todo;
  if (o.state === 'held') {
    todo = `<p style="margin:0 0 14px;"><strong>Nothing to do yet.</strong> The desk is held in Spacebring and invoice ${esc(o.invoiceTitle || '')} has gone out. You will be told when it is paid. The hold lapses at ${esc(holdText(b))}.</p>`;
  } else if (o.state === 'dry') {
    todo = `<p style="margin:0 0 14px;"><strong>Dry run.</strong> The steps were recorded but nothing was created in Spacebring. Book the desk and send the invoice by hand for this one.</p>`;
  } else if (o.state === 'attention') {
    todo = `<p style="margin:0 0 14px;"><strong>Needs attention.</strong> The automatic set-up stopped: ${esc(o.message || 'unknown reason')}. Finish the booking and the invoice in Spacebring by hand. The person has been told an invoice follows.</p>`;
  } else {
    todo = `<p style="margin:0 0 6px;"><strong>To do in Spacebring</strong></p>
      <p style="margin:0 0 6px;">1. Book ${esc(D.PRODUCTS[b.product].spacebring)} for ${esc(D.dayText(b.starts_at))}${b.product === 'day' ? '' : `, ${esc(D.slotText(b.starts_at, b.ends_at))}`}, in the name of ${esc(whoPays(b))}.</p>
      <p style="margin:0 0 6px;">2. Issue the invoice: ${D.rand(pr.exVat)} excl. VAT.</p>
      <p style="margin:0 0 14px;">3. They have been told the invoice follows, usually within the hour.</p>`;
  }
  const member = o.existingMember
    ? `<p style="margin:0 0 14px;"><strong>Note:</strong> this email already belongs to a Spacebring member. Check whether their plan or day passes should cover this before the invoice is paid.</p>`
    : '';
  return {
    subject: `Desk booking: ${what(b)}, ${D.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">New hot desk booking</p>
      ${bookingBox(b, pr)}
      ${contact(b)}
      ${b.notes ? `<p style="margin:0 0 14px;"><strong>Their notes</strong> ${esc(b.notes)}</p>` : ''}
      ${todo}
      ${member}
    `, `${esc(name)}: hot desk on ${D.dayText(b.starts_at)}.`),
  };
}

// To the person, when the invoice is paid.
function confirmed(b, pr) {
  return {
    subject: `Confirmed: your desk on ${D.dayText(b.starts_at)} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">Payment received, thank you. Your desk is booked.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 8px;"><strong>On the day</strong></p>
      <p style="margin:0 0 6px;">We are on the 1st Floor of The Foundry, Sauvignon Street, Nooitgedacht Village, Stellenbosch, with parking at the door. <a href="${MAPS}" style="color:${BRAND.brown};">Get directions</a>.</p>
      <p style="margin:0 0 6px;">Come up to the front desk, open Monday to Friday 08:00 to 17:00, and we show you to a desk.</p>
      <p style="margin:0 0 6px;">Your Wi-Fi code comes by WhatsApp to ${esc(b.phone)} on the day. The network is "The Village Hub Guest".</p>
      <p style="margin:0 0 14px;">Coffee and tea are on us.</p>
      <p style="margin:0 0 6px;">Plans changed? Reply to this email or WhatsApp us on ${HUB_WHATSAPP} as early as you can, and quote <strong>${esc(b.reference)}</strong>.</p>
      ${sign()}
    `, `Your desk on ${D.dayText(b.starts_at)} is confirmed.`),
  };
}

function staffPaid(b, pr) {
  const name = `${b.first_name} ${b.last_name}`;
  return {
    subject: `Paid: hot desk ${what(b).toLowerCase()}, ${D.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Hot desk booking paid</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 6px;"><strong>On the day</strong></p>
      <p style="margin:0 0 6px;">1. Welcome them at the front desk and show them to a desk.</p>
      <p style="margin:0 0 14px;">2. Wi-Fi: nothing to do. The code goes out by WhatsApp from the booking in Spacebring.</p>
      ${contact(b)}
    `, `${esc(name)} paid for a desk.`),
  };
}

function reminder(b, pr, opts) {
  const o = opts || {};
  return {
    subject: `Your desk hold lapses soon (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">A quick reminder. We are holding your desk, and the invoice has not been paid yet.</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;"><strong>The hold lapses at ${esc(holdText(b))}.</strong> Pay before then and the desk is yours.</p>
      ${o.invoiceUrl ? button(o.invoiceUrl, 'Open the invoice (PDF)') : ''}
      <p style="margin:0 0 6px;">Paid already? Reply to this email or WhatsApp us on ${HUB_WHATSAPP}.</p>
      ${sign()}
    `, `Pay by ${holdText(b)} to keep your desk.`),
  };
}

function released(b, pr, bookUrl) {
  return {
    subject: `Your desk hold has lapsed (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;">Hi ${esc(b.first_name)},</p>
      <p style="margin:0 0 14px;">We held a desk for you, but the invoice was not paid in time, so it is open again. The invoice has been cancelled and nothing is owed.</p>
      ${bookingBox(b, pr)}
      ${button(bookUrl, 'Book a desk again')}
      <p style="margin:0 0 6px;">If you did pay, reply with your proof of payment and we will sort it out straight away.</p>
      ${sign()}
    `, 'Your desk hold has lapsed.'),
  };
}

function staffLapsed(b, pr, opts) {
  const o = opts || {};
  const name = `${b.first_name} ${b.last_name}`;
  const text = o.released
    ? `The desk has been released in Spacebring${o.invoiceVoided ? ' and the invoice voided' : '. <strong>The invoice could not be voided automatically: please void it in Spacebring</strong>'}. The person has been told.`
    : 'Automatic release is off, so the seat is still blocked. Chase the payment, or cancel the booking and void the invoice in Spacebring.';
  return {
    subject: `Unpaid desk hold lapsed: ${D.dayText(b.starts_at)}, ${name} (${b.reference})`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Unpaid desk hold lapsed</p>
      ${bookingBox(b, pr)}
      <p style="margin:0 0 14px;">${text}</p>
      ${contact(b)}
    `, `${esc(name)} did not pay in time.`),
  };
}

function attention(b, step, message) {
  return {
    subject: `Needs attention: desk booking ${b.reference} stopped at "${step}"`,
    html: shell(`
      <p style="margin:0 0 14px;font:600 16px/1.4 Arial,sans-serif;">Desk booking needs attention</p>
      ${bookingBox(b, null)}
      <p style="margin:0 0 14px;"><strong>Stopped at</strong> ${esc(step)}<br><strong>Reason</strong> ${esc(message)}</p>
      <p style="margin:0 0 14px;">Steps already done are recorded, so nothing was created twice. Finish this one by hand in Spacebring.</p>
      ${contact(b)}
    `, `Desk booking ${b.reference} stopped at ${step}.`),
  };
}

module.exports = { held, received, staffNew, confirmed, staffPaid, reminder, released, staffLapsed, attention, bookingBox, whoPays };
