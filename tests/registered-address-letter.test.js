const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');

const L = require('../netlify/functions/_lib');
const T = require('../netlify/functions/_emails');
const Letter = require('../netlify/functions/_registered_address_letter');

const NOW = new Date('2026-11-23T22:30:00.000Z'); // 00:30 SAST on 24 November 2026

function app(over) {
  return {
    id: 'app-1',
    reference: 'VO-2026-0012',
    type: 'virtual_office',
    plan: 'Village Address',
    status: 'approved',
    first_name: 'Philippus',
    last_name: 'Taljaard',
    applicant_name: 'Philippus (Philip) Taljaard',
    email: 'philip@example.co.za',
    company_name: 'Typed Name (Pty) Ltd',
    company_reg_number: '1999/000000/07',
    cipc_registration_number: '1999/000000/07',
    wants_registered_address: true,
    preferred_start_date: '2026-10-19',
    onboarding: { start_date: '2026-10-19' },
    vetting: {
      cipc_name: 'Taljaards Advisory Inc',
      enterprise_number: '2012/129002/21',
      director_listed: true,
    },
    ...over,
  };
}

function pdfPlain(bytes) {
  const raw = Buffer.from(bytes);
  const latin = raw.toString('latin1');
  const chunks = [];
  const streams = /\/Length\s+(\d+)\s*>>\s*stream\r?\n/g;
  let match;
  while ((match = streams.exec(latin))) {
    const start = match.index + match[0].length;
    const data = raw.subarray(start, start + Number(match[1]));
    try { chunks.push(zlib.inflateSync(data).toString('latin1')); } catch { /* image or plain */ }
  }
  const source = chunks.join('\n');
  const parts = [];
  const tokens = /<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)/g;
  let text;
  while ((text = tokens.exec(source))) {
    if (text[1]) {
      let decoded = '';
      for (let i = 0; i < text[1].length; i += 2) {
        decoded += String.fromCharCode(parseInt(text[1].slice(i, i + 2), 16));
      }
      parts.push(decoded);
    } else {
      parts.push(text[0].slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\([()\\])/g, '$1'));
    }
  }
  return parts.join('');
}

function hasText(bytes, text) {
  const plain = pdfPlain(bytes);
  if (plain.includes(text)) return true;
  return plain.replace(/\s+/g, '').includes(String(text).replace(/\s+/g, ''));
}

test('reference keeps the application number, and falls back when there is none', () => {
  assert.equal(Letter.confirmationReference({ reference: 'VO-2026-0012' }), 'VH-RA-0012');
  assert.equal(Letter.confirmationReference({ reference: 'VO-2026-001' }), 'VH-RA-001');
  assert.equal(Letter.confirmationReference({ reference: 'WALKIN' }), 'VH-RA-WALKIN');
  assert.equal(Letter.confirmationReference({ id: 'abc-1234' }), 'VH-RA-abc1234');
  assert.equal(Letter.confirmationReference({}), 'VH-RA');
});

test('letter fields prefer the vetting record and format dates in SAST', () => {
  const fields = Letter.letterFields(app(), NOW);
  assert.equal(fields.company, 'Taljaards Advisory Inc');
  assert.equal(fields.registration, '2012/129002/21');
  assert.equal(fields.representative, 'Philippus (Philip) Taljaard');
  assert.equal(fields.capacity, 'Director');
  assert.equal(fields.reference, 'VH-RA-0012');
  assert.equal(fields.letterDate, '24 November 2026');
  assert.equal(fields.effectiveDate, '19 October 2026');

  const earlier = Letter.letterFields(app(), new Date('2026-11-23T21:00:00.000Z'));
  assert.equal(earlier.letterDate, '23 November 2026');

  const fallback = Letter.letterFields(app({
    applicant_name: null,
    director_full_name: 'A Director',
    vetting: { cipc_name: '', director_listed: false },
    company_reg_number: '2024/111111/07',
    onboarding: null,
    preferred_start_date: null,
  }), NOW);
  assert.equal(fallback.company, 'Typed Name (Pty) Ltd');
  assert.equal(fallback.registration, '2024/111111/07');
  assert.equal(fallback.representative, 'A Director');
  assert.equal(fallback.capacity, 'Authorised Representative');
  assert.equal(fallback.effectiveDate, '24 November 2026');
});

test('the confirmation PDF is one valid page and carries the letter facts', async () => {
  const bytes = await Letter.renderConfirmationPdf(app(), { now: NOW });
  assert.equal(Buffer.from(bytes).slice(0, 5).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);

  const expect = [
    'Taljaards Advisory Inc',
    '2012/129002/21',
    'VH-RA-0012',
    '24 November 2026',
    '19 October 2026',
    'Philippus (Philip) Taljaard',
    'Director',
    'Brickfield Spaces (Pty) Ltd',
    '2025/400833/07',
    '4590325389',
    '1st Floor, The Foundry',
    'Sauvignon Street, Nooitgedacht Village',
    'Stellenbosch, 7600',
    'Marius van Jaarsveld',
    'M. van Jaarsveld',
    'F. Heunis',
    'S Swanepoel',
    'Work Rooted in the Winelands',
    'CONFIRMATION OF REGISTERED OFFICE AND BUSINESS ADDRESS',
    'TO WHOM IT MAY CONCERN',
  ];
  for (const text of expect) assert.ok(hasText(bytes, text), `missing: ${text}`);

  const plain = Letter.letterFields(app({
    vetting: { director_listed: false, cipc_name: 'Plain Co (Pty) Ltd' },
    applicant_name: 'Sam Representative',
  }), NOW);
  assert.equal(plain.capacity, 'Authorised Representative');
  const other = await Letter.renderConfirmationPdf(app({
    vetting: { director_listed: false, cipc_name: 'Plain Co (Pty) Ltd', enterprise_number: '2021/000111/07' },
    applicant_name: 'Sam Representative',
  }), { now: NOW });
  assert.ok(hasText(other, 'Authorised Representative'));
  assert.ok(hasText(other, 'Sam Representative'));
  assert.ok(hasText(other, 'Plain Co (Pty) Ltd'));
});

test('a long legal name still fits on the single page', async () => {
  const bytes = await Letter.renderConfirmationPdf(app({
    vetting: {
      cipc_name: 'Taljaards Advisory Incorporated International Holdings (Pty) Ltd',
      enterprise_number: '2012/129002/21',
      director_listed: true,
    },
  }), { now: NOW });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.ok(hasText(bytes, 'Taljaards Advisory Incorporated International Holdings (Pty) Ltd'));
});

test('sendEmail forwards attachments to Resend and omits them when absent', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), authorization: opts.headers.Authorization });
    return { ok: true, json: async () => ({ id: 'email-1' }), text: async () => '' };
  };
  try {
    const sent = await L.sendEmail({
      to: 'client@example.co.za',
      subject: 'Your address is live',
      html: '<p>Live</p>',
      attachments: [{ filename: 'letter.pdf', content: 'QQ==', contentType: 'application/pdf' }],
    });
    assert.equal(sent.id, 'email-1');
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].authorization, 'Bearer test-key');
    assert.deepEqual(calls[0].body.attachments, [
      { filename: 'letter.pdf', content: 'QQ==', content_type: 'application/pdf' },
    ]);

    await L.sendEmail({ to: 'client@example.co.za', subject: 'Plain', html: '<p>Hi</p>' });
    assert.equal(calls[1].body.attachments, undefined);
  } finally {
    global.fetch = original;
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
});

function welcomeIo(opts) {
  const o = opts || {};
  const calls = { letters: 0, proofs: 0 };
  return {
    calls,
    now: () => NOW,
    async confirmationPdf() {
      calls.letters += 1;
      if (o.letterError) throw new Error(o.letterError);
      return { filename: 'Taljaards-Advisory-Inc-Registered-Address-Confirmation-Letter.pdf', content: Buffer.from('%PDF-letter') };
    },
    async hubProof() {
      calls.proofs += 1;
      if (o.proofError) throw new Error(o.proofError);
      if (!o.proof) return null;
      return { filename: 'Foundry-Proof-of-Address.pdf', content: Buffer.from('%PDF-proof') };
    },
  };
}

test('welcome attaches the letter for Pro and for Address or Virtual with a registered address', async () => {
  const cases = [
    app({ plan: 'Village Virtual Pro', wants_registered_address: false }),
    app({ plan: 'Village Address', wants_registered_address: true }),
    app({ plan: 'Village Virtual', wants_registered_address: true }),
  ];
  for (const client of cases) {
    const io = welcomeIo();
    const sent = [];
    const ok = await Letter.deliverWelcome(client, io, async (mail) => { sent.push(mail); return { id: '1' }; });
    assert.equal(ok, true);
    assert.equal(io.calls.letters, 1, client.plan);
    assert.equal(sent[0].attachments.length, 1, client.plan);
    assert.equal(sent[0].attachments[0].filename, 'Taljaards-Advisory-Inc-Registered-Address-Confirmation-Letter.pdf');
    assert.equal(sent[0].attachments[0].content, Buffer.from('%PDF-letter').toString('base64'));
    assert.equal(sent[0].attachments[0].contentType, 'application/pdf');
    assert.match(sent[0].html, /Confirmation of Registered Office and Business Address/);
    assert.match(sent[0].html, /CoR21\.1/);
    assert.doesNotMatch(sent[0].html, /reply to this email and we will send it/);
  }
});

test('welcome does not attach a letter for Address or Virtual without a registered address', async () => {
  for (const plan of ['Village Address', 'Village Virtual']) {
    const io = welcomeIo({ proof: true });
    const sent = [];
    await Letter.deliverWelcome(app({ plan, wants_registered_address: false }), io, async (mail) => {
      sent.push(mail);
      return { id: '1' };
    });
    assert.equal(io.calls.letters, 0, plan);
    assert.equal(io.calls.proofs, 0, plan);
    assert.equal(sent[0].attachments.length, 0, plan);
    assert.match(sent[0].html, /not your registered CIPC or SARS address/);
    assert.doesNotMatch(sent[0].html, /is attached/);
  }
});

test('a hub proof of address is attached beside the letter, and a missing proof is skipped', async () => {
  const withProof = welcomeIo({ proof: true });
  const sent = [];
  await Letter.deliverWelcome(app({ plan: 'Village Virtual Pro' }), withProof, async (mail) => {
    sent.push(mail);
    return { id: '1' };
  });
  assert.deepEqual(sent[0].attachments.map(a => a.filename), [
    'Taljaards-Advisory-Inc-Registered-Address-Confirmation-Letter.pdf',
    'Foundry-Proof-of-Address.pdf',
  ]);
  assert.match(sent[0].html, /proof of address for The Foundry is attached/);

  const missing = welcomeIo({ proof: false });
  const plain = [];
  await Letter.deliverWelcome(app(), missing, async (mail) => { plain.push(mail); return { id: '1' }; });
  assert.equal(plain[0].attachments.length, 1);
  assert.doesNotMatch(plain[0].html, /proof of address for The Foundry/);

  const broken = welcomeIo({ proofError: 'storage down' });
  const still = [];
  await Letter.deliverWelcome(app({ plan: 'Village Virtual Pro' }), broken, async (mail) => {
    still.push(mail);
    return { id: '1' };
  });
  assert.equal(still[0].attachments.length, 1);
  assert.match(still[0].html, /Confirmation of Registered Office and Business Address/);
});

test('a letter that cannot be written does not claim one is attached', async () => {
  const io = welcomeIo({ letterError: 'storage refused' });
  const sent = [];
  const ok = await Letter.deliverWelcome(app({ plan: 'Village Virtual Pro' }), io, async (mail) => {
    sent.push(mail);
    return { id: '1' };
  });
  assert.equal(ok, true);
  assert.equal(sent[0].attachments.length, 0);
  assert.match(sent[0].html, /reply to this email and we will send it/);
  assert.match(T.activated(app(), { registeredAddress: true }).html, /reply to this email and we will send it/);
});

test('the apply form no longer says the client signs a mandate before the Hub lodges anything', () => {
  const html = fs.readFileSync(path.join(__dirname, '../apply-virtual-office.html'), 'utf8');
  assert.doesNotMatch(html, /You will sign a short mandate before we lodge anything/);
  const sentence = 'The Registered Address Mandate is included in your agreement. Once your membership is active, we email you the official Village Hub confirmation letter. You lodge your CIPC update (form CoR21.1) and your SARS address update yourself, using that letter.';
  const found = html.split(sentence).length - 1;
  assert.equal(found, 3);
  assert.match(html, /id="regAddrNote"/);
});

test('staff can ask for the confirmation letter from the application page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../admin/applications.html'), 'utf8');
  const action = fs.readFileSync(path.join(__dirname, '../netlify/functions/application-action.js'), 'utf8');
  assert.match(html, /Generate confirmation letter/);
  assert.match(html, /Regenerate confirmation letter/);
  assert.match(html, /registered_address_letter/);
  assert.match(action, /action === 'registered_address_letter'/);
  assert.match(action, /Letter\.generateForStaff/);
});

test('the logo used by the letter is the web PNG, not a Git LFS pointer', () => {
  const logo = Letter.resolveLogoPath();
  assert.ok(logo.endsWith(`${path.sep}images${path.sep}web${path.sep}logo.png`));
  const bytes = fs.readFileSync(logo);
  assert.ok(bytes.length > 1000);
  assert.equal(bytes.slice(0, 4).toString('hex'), '89504e47');
});
