// What happens to a boardroom booking after it is saved.
//
//   provision   customer -> availability re-check -> room held -> invoice
//               drafted -> total checked -> invoice issued        => held
//   sync        invoice paid     -> booking retitled, person and team told
//                                                                 => confirmed
//               half the hold gone, unpaid -> one reminder
//               hold lapsed, unpaid -> room released, invoice voided
//                                                                 => released
//
// Rules, the same as the membership onboarding (_onboarding.js):
//  - Every step is recorded on the booking the moment it succeeds, so a
//    failure half way never repeats a step that already created something
//    in Spacebring. Retrying picks up at the step that failed.
//  - A failure stops the run, marks the booking "needs_attention" and tells
//    the team. It never guesses.
//  - Spacebring, the database and email are passed in (deps), so the whole
//    flow is tested without touching any of them.

const B = require('./_boardroom');

function sb(b) { return (b.spacebring && typeof b.spacebring === 'object') ? b.spacebring : {}; }
function steps(b) { return (b.steps && typeof b.steps === 'object') ? b.steps : {}; }

function customerName(b) {
  return b.billing === 'company' && b.company_name ? b.company_name : `${b.first_name} ${b.last_name}`;
}

function holdTitle(b) { return `HOLD unpaid: ${customerName(b)} (${b.reference})`; }
function paidTitle(b) { return `${customerName(b)} (${b.reference})`; }

function memo(b) {
  const needs = (b.needs || []).map(n => B.NEEDS[n]).filter(Boolean);
  return [
    `Website booking ${b.reference}`,
    `${b.guests} guests. ${B.MEETING_TYPES[b.meeting_type] || b.meeting_type}`,
    `Needs: ${needs.length ? needs.join('; ') : 'nothing extra'}`,
    `Catering: ${B.CATERING[b.catering] || b.catering}${b.catering_notes ? ` (${b.catering_notes})` : ''}`,
    `Contact: ${b.first_name} ${b.last_name}, ${b.phone}, ${b.email}`,
    b.notes ? `Notes: ${b.notes}` : '',
  ].filter(Boolean).join('\n').slice(0, 1900);
}

function invoiceLine(b) {
  return `${b.room_title} hire, ${B.dayText(b.starts_at)}, ${B.slotText(b.starts_at, b.ends_at)} (${b.reference})`;
}

function priceOf(b) {
  const minutes = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000);
  return B.price(b.room_key, minutes);
}

// Saves a patch and keeps the in-memory booking in step with it.
async function save(b, patch, d) {
  await d.store.save(b.id, patch);
  Object.assign(b, patch);
}

async function record(b, step, value, d) {
  const next = { ...steps(b), [step]: { at: d.now().toISOString(), ...(value || {}) } };
  await save(b, { steps: next }, d);
}

async function stop(b, step, err, d) {
  const message = (err && err.message) || String(err);
  await save(b, { status: 'needs_attention', attention: { step, message: message.slice(0, 500), at: d.now().toISOString() } }, d);
  await d.store.log(b.id, 'needs_attention', 'system', { step, message: message.slice(0, 500) });
  try { await d.mail.attention(b, step, message); } catch (e) { console.error('attention mail failed:', e.message); }
  return { state: 'attention', step, message };
}

// dry mode: nothing is sent to Spacebring. Each step records what it would do.
async function provision(b, d) {
  const dry = d.mode() === 'dry';
  const fake = (name) => `dry-${name}-${b.reference}`;

  // 1. The customer. An existing membership for this email is reused, so a
  //    returning booker is never duplicated.
  let step = 'customer';
  try {
    if (!steps(b).customer) {
      let membership = null, companyRef = null, existingMember = false;
      if (dry) {
        membership = { id: fake('membership') };
        if (b.billing === 'company') companyRef = fake('company');
      } else {
        membership = await d.sb.findMembershipByEmail(b.email);
        existingMember = Boolean(membership && membership.type === 'member');
        if (b.billing === 'company') {
          const company = (await d.sb.findCompanyByTitle(b.company_name))
            || (await d.sb.createCompany({
              title: b.company_name, legalName: b.company_name,
              taxId: b.company_vat || undefined,
              notes: `Created by the website boardroom booking ${b.reference}.`,
            }));
          companyRef = company && company.id;
          if (!companyRef) throw new Error('Spacebring returned no company id');
        }
        if (!membership) {
          membership = await d.sb.createMembership({
            type: 'nonmember',
            email: b.email, name: b.first_name, surname: b.last_name, phoneNumber: b.phone,
            // Only a brand-new person is attached to the company. Someone who
            // already exists keeps the company they have.
            ...(companyRef ? { companyRef } : {}),
            notes: `Boardroom guest. First booking ${b.reference}.`,
          });
        }
        if (!membership || !membership.id) throw new Error('Spacebring returned no membership id');
      }
      await save(b, { spacebring: { ...sb(b), membership_ref: membership.id, company_ref: companyRef, existing_member: existingMember } }, d);
      await record(b, 'customer', { existing_member: existingMember, dry }, d);
    }

    // 2. Is the slot still free? Spacebring answers with the same rules it
    //    applies when the booking is created.
    step = 'availability';
    if (!steps(b).booking && !dry) {
      const a = await d.sb.checkAvailability({ resourceRef: b.resource_ref, startDate: b.starts_at, endDate: b.ends_at });
      if (!a.available) {
        await save(b, { status: 'clash', attention: { step, message: (a.reason && a.reason.message) || 'slot no longer free', at: d.now().toISOString() } }, d);
        await d.store.log(b.id, 'clash', 'system', { reason: a.reason });
        return { state: 'clash', reason: a.reason };
      }
    }

    // 3. Hold the room.
    step = 'booking';
    if (!steps(b).booking) {
      const booking = dry ? { id: fake('booking') } : await d.sb.createBooking({
        resourceRef: b.resource_ref, startDate: b.starts_at, endDate: b.ends_at,
        membershipRefOwner: sb(b).membership_ref,
        title: holdTitle(b), memo: memo(b),
        metadata: { vh_reference: b.reference, vh_hold: 'true', vh_guests: String(b.guests) },
      });
      if (!booking || !booking.id) throw new Error('Spacebring returned no booking id');
      await save(b, { spacebring: { ...sb(b), booking_id: booking.id } }, d);
      await record(b, 'booking', { dry }, d);
    }

    // 4. Draft the invoice, and check Spacebring's total against ours before
    //    it is issued. An issued invoice cannot be edited, so a VAT setting
    //    that is not what this code expects is caught here, not by a client.
    step = 'invoice';
    const pr = priceOf(b);
    if (!steps(b).invoice) {
      const invoice = dry ? { id: fake('invoice'), totalAmount: pr.inclVat } : await d.sb.createInvoice({
        ...(sb(b).company_ref ? { companyRef: sb(b).company_ref } : { membershipRef: sb(b).membership_ref }),
        dueDate: b.hold_expires_at,
        internalNote: `Website boardroom booking ${b.reference}. Booking ${sb(b).booking_id}.`,
        items: [{ title: invoiceLine(b), quantity: 1, unitAmount: pr.exVat }],
      });
      if (!invoice || !invoice.id) throw new Error('Spacebring returned no invoice id');
      await save(b, { spacebring: { ...sb(b), invoice_id: invoice.id } }, d);
      const total = Number(invoice.totalAmount);
      if (Number.isFinite(total) && Math.abs(total - pr.inclVat) > 0.01) {
        await record(b, 'invoice', { dry, total, expected: pr.inclVat, mismatch: true }, d);
        throw new Error(`Draft invoice total is ${B.rand(total)} but the booking is ${B.rand(pr.inclVat)} incl. VAT. The draft was left unissued. Check the VAT setting, fix the draft and issue it by hand.`);
      }
      await record(b, 'invoice', { dry, total: Number.isFinite(total) ? total : null }, d);
    } else if (steps(b).invoice.mismatch) {
      throw new Error('The draft invoice total did not match and was left unissued. Fix and issue it in Spacebring.');
    }

    // 5. Issue it. Spacebring numbers it and emails it to the customer.
    step = 'invoice_issued';
    if (!steps(b).invoice_issued) {
      const issued = dry ? { id: sb(b).invoice_id, title: 'DRY-RUN', pdfUrl: null } : await d.sb.issueInvoice(sb(b).invoice_id);
      await save(b, {
        status: dry ? 'received' : 'held',
        spacebring: { ...sb(b), invoice_title: (issued && issued.title) || null, invoice_pdf_url: (issued && issued.pdfUrl) || null },
      }, d);
      await record(b, 'invoice_issued', { dry }, d);
      await d.store.log(b.id, dry ? 'dry_run_complete' : 'held', 'system', { invoice: (issued && issued.title) || null });
    }
    return { state: dry ? 'dry' : 'held', price: pr };
  } catch (err) {
    console.error('boardroom provision failed at', step, 'for', b.reference, err.message);
    return stop(b, step, err, d);
  }
}

// One pass over a held booking. Returns { changed, state }.
async function sync(b, d) {
  if (b.status !== 'held') return { changed: false };
  const now = d.now();
  const pr = priceOf(b);
  const refs = sb(b);

  const invoice = await d.sb.getInvoice(refs.invoice_id);
  const status = invoice && invoice.status;

  if (status === 'paid') {
    if (!steps(b).retitled) {
      try {
        await d.sb.updateBooking(refs.booking_id, { title: paidTitle(b), metadata: { vh_hold: 'false' } });
        await record(b, 'retitled', null, d);
      } catch (err) {
        // The money is in. A cosmetic title must not hold up the confirmation.
        console.error('boardroom retitle failed:', err.message);
        await d.store.log(b.id, 'retitle_failed', 'system', { message: err.message.slice(0, 300) });
      }
    }
    await save(b, { status: 'confirmed', paid_at: now.toISOString() }, d);
    await d.store.log(b.id, 'paid', 'system', { invoice: invoice.title || null });
    if (!steps(b).confirmed_mail) {
      await record(b, 'confirmed_mail', null, d);
      await d.mail.confirmed(b, pr);
      await d.mail.staffPaid(b, pr);
    }
    return { changed: true, state: 'confirmed' };
  }

  // Somebody voided the invoice by hand: the booking goes with it.
  if (status === 'voided') {
    try { await d.sb.cancelBooking(refs.booking_id); } catch (err) { console.error('cancel after void failed:', err.message); }
    await save(b, { status: 'cancelled' }, d);
    await d.store.log(b.id, 'cancelled', 'system', { reason: 'invoice voided in Spacebring' });
    return { changed: true, state: 'cancelled' };
  }

  const expires = new Date(b.hold_expires_at).getTime();
  const created = new Date(b.created_at).getTime();

  if (now.getTime() >= expires) {
    if (!d.autoRelease()) {
      if (steps(b).lapse_alert) return { changed: false };
      await record(b, 'lapse_alert', null, d);
      await d.mail.staffLapsed(b, pr, { released: false });
      return { changed: true, state: 'held' };
    }
    // Recorded before the calls, so a crash half way cannot release twice.
    await save(b, { status: 'released' }, d);
    let invoiceVoided = false;
    try { await d.sb.cancelBooking(refs.booking_id); }
    catch (err) { return stop(b, 'release_booking', err, d); }
    try { await d.sb.voidInvoice(refs.invoice_id); invoiceVoided = true; }
    catch (err) { console.error('void failed:', err.message); }
    await d.store.log(b.id, 'released', 'system', { invoice_voided: invoiceVoided });
    await d.mail.released(b, pr);
    await d.mail.staffLapsed(b, pr, { released: true, invoiceVoided });
    return { changed: true, state: 'released' };
  }

  // One reminder, once half the hold has gone.
  if (!steps(b).reminder && now.getTime() >= created + (expires - created) / 2) {
    await record(b, 'reminder', null, d);
    await d.mail.reminder(b, pr, { invoiceUrl: (invoice && invoice.pdfUrl) || refs.invoice_pdf_url || null });
    await d.store.log(b.id, 'reminder_sent', 'system', null);
    return { changed: true, state: 'held' };
  }
  return { changed: false };
}

// Scheduled entry point. Resumes bookings whose set-up was cut short, then
// follows every held booking.
async function run(d) {
  if (d.mode() !== 'live') return { skipped: true };
  const out = { checked: 0, resumed: 0, moved: 0 };

  const stalledBefore = new Date(d.now().getTime() - 3 * 60_000).toISOString();
  const stalled = await d.store.select(`status=eq.received&route=eq.instant&mode=eq.live&updated_at=lte.${stalledBefore}&select=*&order=created_at.asc&limit=20`);
  for (const b of stalled || []) {
    try { await provision(b, d); out.resumed++; if (b.status === 'held') await d.mail.held(b, priceOf(b)); }
    catch (err) { console.error('boardroom resume failed for', b.reference, err.message); }
  }

  const held = await d.store.select('status=eq.held&select=*&order=hold_expires_at.asc&limit=50');
  for (const b of held || []) {
    out.checked++;
    try { const r = await sync(b, d); if (r.changed) out.moved++; }
    catch (err) { console.error('boardroom sync failed for', b.reference, err.message); }
  }
  return out;
}

module.exports = { provision, sync, run, priceOf, holdTitle, paidTitle, memo, invoiceLine, customerName };
