// What happens to an hour, half-day or full-day desk booking after it is
// saved. The same steps and rules as the boardroom (_boardroom_flow.js):
//
//   provision   customer -> seat re-check -> desk held -> invoice drafted
//               -> total checked -> invoice issued                 => held
//   sync        invoice paid -> booking retitled, person and team told
//                                                                  => confirmed
//               half the hold gone, unpaid -> one reminder
//               hold lapsed, unpaid -> desk released, invoice voided
//                                                                  => released
//
//  - Every step is recorded the moment it succeeds, so a retry never
//    creates anything in Spacebring twice.
//  - A failure stops the run, marks the booking needs_attention and tells
//    the team. It never guesses.

const D = require('./_deskday');

function sb(b) { return (b.spacebring && typeof b.spacebring === 'object') ? b.spacebring : {}; }
function steps(b) { return (b.steps && typeof b.steps === 'object') ? b.steps : {}; }

function customerName(b) {
  return b.billing === 'company' && b.company_name ? b.company_name : `${b.first_name} ${b.last_name}`;
}
function holdTitle(b) { return `HOLD unpaid: ${customerName(b)} (${b.reference})`; }
function paidTitle(b) { return `${customerName(b)} (${b.reference})`; }

function memo(b) {
  return [
    `Website desk booking ${b.reference}`,
    `${D.PRODUCTS[b.product].title}: ${D.describe(b)}`,
    `Contact: ${b.first_name} ${b.last_name}, ${b.phone}, ${b.email}`,
    b.notes ? `Notes: ${b.notes}` : '',
  ].filter(Boolean).join('\n').slice(0, 1900);
}

function invoiceLine(b) {
  return `Hot desk, ${D.PRODUCTS[b.product].title.toLowerCase()}, ${D.dayText(b.starts_at)}${b.product === 'day' ? '' : `, ${D.slotText(b.starts_at, b.ends_at)}`} (${b.reference})`;
}

function priceOf(b) {
  return D.price(b.product, Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000));
}

async function save(b, patch, d) { await d.store.save(b.id, patch); Object.assign(b, patch); }
async function record(b, step, value, d) {
  await save(b, { steps: { ...steps(b), [step]: { at: d.now().toISOString(), ...(value || {}) } } }, d);
}
async function stop(b, step, err, d) {
  const message = ((err && err.message) || String(err)).slice(0, 500);
  await save(b, { status: 'needs_attention', attention: { step, message, at: d.now().toISOString() } }, d);
  await d.store.log(b.id, 'needs_attention', 'system', { step, message });
  try { await d.mail.attention(b, step, message); } catch (e) { console.error('desk attention mail failed:', e.message); }
  return { state: 'attention', step, message };
}

async function provision(b, d) {
  const dry = d.mode() === 'dry';
  const fake = (name) => `dry-${name}-${b.reference}`;
  let step = 'customer';
  try {
    // 1. The customer. An existing person in Spacebring is reused.
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
              title: b.company_name, legalName: b.company_name, taxId: b.company_vat || undefined,
              notes: `Created by the website desk booking ${b.reference}.`,
            }));
          companyRef = company && company.id;
          if (!companyRef) throw new Error('Spacebring returned no company id');
        }
        if (!membership) {
          membership = await d.sb.createMembership({
            type: 'nonmember',
            email: b.email, name: b.first_name, surname: b.last_name, phoneNumber: b.phone,
            ...(companyRef ? { companyRef } : {}),
            notes: `Hot desk guest. First booking ${b.reference}.`,
          });
        }
        if (!membership || !membership.id) throw new Error('Spacebring returned no membership id');
      }
      await save(b, { spacebring: { ...sb(b), membership_ref: membership.id, company_ref: companyRef, existing_member: existingMember } }, d);
      await record(b, 'customer', { existing_member: existingMember, dry }, d);
    }

    // 2. Is a seat still free? Spacebring answers with its own booking rules.
    step = 'availability';
    if (!steps(b).booking && !dry) {
      const a = await d.sb.checkAvailability({ resourceRef: b.resource_ref, startDate: b.starts_at, endDate: b.ends_at, quantity: b.seats || 1 });
      if (!a.available) {
        await save(b, { status: 'clash', attention: { step, message: (a.reason && a.reason.message) || 'no seat free', at: d.now().toISOString() } }, d);
        await d.store.log(b.id, 'clash', 'system', { reason: a.reason });
        return { state: 'clash', reason: a.reason };
      }
    }

    // 3. Hold the seat.
    step = 'booking';
    if (!steps(b).booking) {
      const booking = dry ? { id: fake('booking') } : await d.sb.createBooking({
        resourceRef: b.resource_ref, startDate: b.starts_at, endDate: b.ends_at, seats: b.seats || 1,
        membershipRefOwner: sb(b).membership_ref,
        title: holdTitle(b), memo: memo(b),
        metadata: { vh_reference: b.reference, vh_hold: 'true' },
      });
      if (!booking || !booking.id) throw new Error('Spacebring returned no booking id');
      await save(b, { spacebring: { ...sb(b), booking_id: booking.id } }, d);
      await record(b, 'booking', { dry }, d);
    }

    // 4. Draft the invoice and check Spacebring's total before it is issued.
    step = 'invoice';
    const pr = priceOf(b);
    if (!steps(b).invoice) {
      const invoice = dry ? { id: fake('invoice'), totalAmount: pr.inclVat } : await d.sb.createInvoice({
        ...(sb(b).company_ref ? { companyRef: sb(b).company_ref } : { membershipRef: sb(b).membership_ref }),
        dueDate: b.hold_expires_at,
        internalNote: `Website desk booking ${b.reference}. Booking ${sb(b).booking_id}.`,
        items: [{ title: invoiceLine(b), quantity: 1, unitAmount: pr.exVat }],
      });
      if (!invoice || !invoice.id) throw new Error('Spacebring returned no invoice id');
      await save(b, { spacebring: { ...sb(b), invoice_id: invoice.id } }, d);
      // Spacebring answers the create call before it has added up the lines
      // (the response says 0), so the total is read back from the invoice.
      let total = Number(invoice.totalAmount);
      if (!dry) {
        const fresh = await d.sb.getInvoice(invoice.id);
        if (fresh && fresh.totalAmount !== undefined && fresh.totalAmount !== null) total = Number(fresh.totalAmount);
      }
      if (Number.isFinite(total) && Math.abs(total - pr.inclVat) > 0.01) {
        await record(b, 'invoice', { dry, total, expected: pr.inclVat, mismatch: true }, d);
        throw new Error(`Draft invoice total is ${D.rand(total)} but the booking is ${D.rand(pr.inclVat)} incl. VAT. The draft was left unissued. Fix it and issue it by hand.`);
      }
      await record(b, 'invoice', { dry, total: Number.isFinite(total) ? total : null }, d);
    } else if (steps(b).invoice.mismatch) {
      throw new Error('The draft invoice total did not match and was left unissued. Fix and issue it in Spacebring.');
    }

    // 5. Issue it. Spacebring numbers it and emails it.
    step = 'invoice_issued';
    if (!steps(b).invoice_issued) {
      const issued = dry ? { id: sb(b).invoice_id, title: 'DRY-RUN', pdfUrl: null } : await d.sb.issueInvoice(sb(b).invoice_id);
      await save(b, {
        status: dry ? 'received' : 'held',
        spacebring: { ...sb(b), invoice_title: (issued && issued.title) || null, invoice_pdf_url: (issued && (issued.hostedInvoiceUrl || issued.pdfUrl)) || null },
      }, d);
      await record(b, 'invoice_issued', { dry }, d);
      await d.store.log(b.id, dry ? 'dry_run_complete' : 'held', 'system', { invoice: (issued && issued.title) || null });
    }
    return { state: dry ? 'dry' : 'held', price: pr };
  } catch (err) {
    console.error('desk provision failed at', step, 'for', b.reference, err.message);
    return stop(b, step, err, d);
  }
}

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
        console.error('desk retitle failed:', err.message);
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

  if (status === 'voided') {
    try { await d.sb.cancelBooking(refs.booking_id); } catch (err) { console.error('desk cancel after void failed:', err.message); }
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
    await save(b, { status: 'released' }, d);
    let invoiceVoided = false;
    try { await d.sb.cancelBooking(refs.booking_id); }
    catch (err) { return stop(b, 'release_booking', err, d); }
    try { await d.sb.voidInvoice(refs.invoice_id); invoiceVoided = true; }
    catch (err) { console.error('desk void failed:', err.message); }
    await d.store.log(b.id, 'released', 'system', { invoice_voided: invoiceVoided });
    await d.mail.released(b, pr);
    await d.mail.staffLapsed(b, pr, { released: true, invoiceVoided });
    return { changed: true, state: 'released' };
  }

  // One reminder, once half the hold has gone, and only if the hold is long
  // enough for a reminder to help (more than an hour).
  if (!steps(b).reminder && expires - created > 3600_000 && now.getTime() >= created + (expires - created) / 2) {
    await record(b, 'reminder', null, d);
    await d.mail.reminder(b, pr, { invoiceUrl: (invoice && (invoice.hostedInvoiceUrl || invoice.pdfUrl)) || refs.invoice_pdf_url || null });
    await d.store.log(b.id, 'reminder_sent', 'system', null);
    return { changed: true, state: 'held' };
  }
  return { changed: false };
}

async function run(d) {
  if (d.mode() !== 'live') return { skipped: true };
  const out = { checked: 0, resumed: 0, moved: 0 };

  const stalledBefore = new Date(d.now().getTime() - 3 * 60_000).toISOString();
  const stalled = await d.store.select(`status=eq.received&mode=eq.live&updated_at=lte.${stalledBefore}&select=*&order=created_at.asc&limit=20`);
  for (const b of stalled || []) {
    try { await provision(b, d); out.resumed++; if (b.status === 'held') await d.mail.held(b, priceOf(b)); }
    catch (err) { console.error('desk resume failed for', b.reference, err.message); }
  }

  const held = await d.store.select('status=eq.held&select=*&order=hold_expires_at.asc&limit=50');
  for (const b of held || []) {
    out.checked++;
    try { const r = await sync(b, d); if (r.changed) out.moved++; }
    catch (err) { console.error('desk sync failed for', b.reference, err.message); }
  }
  return out;
}

module.exports = { provision, sync, run, priceOf, holdTitle, paidTitle, memo, invoiceLine, customerName };
