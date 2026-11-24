// Confirmation of Registered Office and Business Address.
//
// One A4 page in the shape of the Village Hub letter: letterhead, reference,
// the client's legal name and registration number, the Foundry address, the
// three confirmations, and Marius's signature block. pdf-lib is pure
// JavaScript, so the same file runs in tests and in a Netlify Function.
// The mark is images/web/logo.png (a real PNG, not a Git LFS pointer).
//
// Stored as application_documents.doc_type = registered_address_confirmation.
// That is deliberately not registered_address_mandate: the mandate is the
// clause in the agreement, and this letter is what the client lodges.

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const L = require('./_lib');
const O = require('./_onboarding');
const T = require('./_emails');

const DOC_TYPE = 'registered_address_confirmation';
const HUB_PROOF_PATH = 'hub/foundry-proof-of-address.pdf';
const HUB_PROOF_FILENAME = 'Foundry-Proof-of-Address.pdf';

const SAST_OFFSET_MS = 2 * 3600 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Fixed facts from the official Village Hub confirmation letter.
const ENTITY = {
  legalName: 'Brickfield Spaces (Pty) Ltd',
  tradingAs: 'The Village Hub',
  registration: '2025/400833/07',
  vat: '4590325389',
  letterhead: [
    '1st Floor, The Foundry Lifestyle Centre',
    'Nooitgedacht Village, Stellenbosch, 7600',
  ],
  contact: 'hello@villagehub.co.za  ·  villagehub.co.za',
  addressLines: [
    '1st Floor, The Foundry',
    'Sauvignon Street, Nooitgedacht Village',
    'Stellenbosch, 7600',
  ],
  physical: '1st Floor, The Foundry, Sauvignon Street, Nooitgedacht Village, Stellenbosch, 7600',
  signatory: 'Marius van Jaarsveld',
  signatoryLine: 'Director  ·  for and on behalf of Brickfield Spaces (Pty) Ltd t/a The Village Hub',
  footer: 'Brickfield Spaces (Pty) Ltd  ·  Reg. No: 2025/400833/07  ·  VAT No. 4590325389',
  directors: 'Directors: M. van Jaarsveld  ·  F. Heunis  ·  S Swanepoel',
  tagline: 'The Village Hub  ·  Work Rooted in the Winelands',
};

const INK = rgb(0.165, 0.129, 0.094);
const BROWN = rgb(0.420, 0.267, 0.137);
const GOLD = rgb(0.788, 0.635, 0.294);
const CREAM = rgb(254 / 255, 250 / 255, 241 / 255);
const MUTED = rgb(0.435, 0.388, 0.333);
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 54;
const FOOTER_TOP = 78;

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

// VO-2026-0012 -> VH-RA-0012. Anything without a trailing number still gets
// a stable VH-RA- reference from the application reference or id.
function confirmationReference(app) {
  const ref = clean(app && app.reference);
  const trailing = ref.match(/(\d+)$/);
  if (trailing) return `VH-RA-${trailing[1]}`;
  const slug = ref.replace(/[^A-Za-z0-9]+/g, '').slice(-8);
  if (slug) return `VH-RA-${slug}`;
  const id = clean(app && app.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return id ? `VH-RA-${id}` : 'VH-RA';
}

function legalName(app) {
  const named = O.legalCompanyName(app);
  return clean(named);
}

function registrationNumber(app) {
  const vetting = (app && app.vetting) || {};
  return clean(vetting.enterprise_number) || clean(app && app.company_reg_number) || clean(app && app.cipc_registration_number);
}

function representativeName(app) {
  const named = clean(app && app.applicant_name) || clean(app && app.director_full_name);
  if (named) return named;
  const person = [app && app.first_name, app && app.last_name].map(clean).filter(Boolean).join(' ');
  return person;
}

function representativeCapacity(app) {
  return app && app.vetting && app.vetting.director_listed === true ? 'Director' : 'Authorised Representative';
}

function formatIsoDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function formatSastDate(date) {
  const dt = date instanceof Date ? date : new Date();
  const sast = new Date(dt.getTime() + SAST_OFFSET_MS);
  return formatIsoDate(sast.toISOString().slice(0, 10));
}

// The agreement start when onboarding recorded one, otherwise the same
// rule the membership uses: the preferred date if it is still ahead,
// otherwise today in SAST.
function effectiveDateIso(app, now) {
  const onboarding = (app && app.onboarding) || {};
  const recorded = onboarding.start_date
    || (onboarding.steps && onboarding.steps.contract && onboarding.steps.contract.start_date);
  if (recorded && /^\d{4}-\d{2}-\d{2}/.test(String(recorded))) return String(recorded).slice(0, 10);
  return O.startDate(app || {}, now instanceof Date ? now : new Date());
}

function letterFields(app, now) {
  const when = now instanceof Date ? now : new Date();
  const company = legalName(app);
  if (!company) {
    const err = new Error('This application has no company name to print on the confirmation letter.');
    err.code = 'missing_company';
    throw err;
  }
  const registration = registrationNumber(app);
  const representative = representativeName(app);
  return {
    company,
    registration,
    heading: registration
      ? `${company.toUpperCase()} (Registration number ${registration})`
      : company.toUpperCase(),
    representative: representative || 'the authorised representative',
    capacity: representativeCapacity(app),
    reference: confirmationReference(app),
    letterDate: formatSastDate(when),
    effectiveDate: formatIsoDate(effectiveDateIso(app, when)),
  };
}

function letterFilename(company) {
  const slug = String(company || 'Client')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'Client';
  return `${slug}-Registered-Address-Confirmation-Letter.pdf`;
}

function resolveLogoPath() {
  const candidates = [
    path.join(__dirname, '../../images/web/logo.png'),
    path.join(__dirname, 'images/web/logo.png'),
    path.join(process.cwd(), 'images/web/logo.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 1000) return candidate;
    } catch { /* try the next place the file might have been included */ }
  }
  return null;
}

function loadLogoBytes() {
  const logoPath = resolveLogoPath();
  if (!logoPath) throw new Error('Village Hub logo was not found at images/web/logo.png.');
  return fs.readFileSync(logoPath);
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      line = trial;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawCentered(page, text, y, font, size, color) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - width) / 2, y, size, font, color });
}

function drawTrackedCentered(page, text, y, font, size, tracking, color) {
  const chars = Array.from(text);
  const widths = chars.map(ch => font.widthOfTextAtSize(ch, size));
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * Math.max(0, chars.length - 1);
  let x = (PAGE_W - total) / 2;
  chars.forEach((ch, i) => {
    if (ch !== ' ') page.drawText(ch, { x, y, size, font, color });
    x += widths[i] + tracking;
  });
}

function drawWrapped(page, text, x, y, width, font, size, leading, color) {
  for (const line of wrapText(text, font, size, width)) {
    page.drawText(line, { x, y, size, font, color });
    y -= leading;
  }
  return y;
}

function drawNumbered(page, n, text, x, y, width, font, size, leading, color) {
  const hang = 16;
  const lines = wrapText(text, font, size, width - hang);
  lines.forEach((line, i) => {
    if (i === 0) page.drawText(`${n}.`, { x, y, size, font, color });
    page.drawText(line, { x: x + hang, y, size, font, color });
    y -= leading;
  });
  return y;
}

function bodyCopy(fields) {
  return {
    intro: `We confirm that ${fields.company} ("the Company") is a virtual office client of The Village Hub, operated by Brickfield Spaces (Pty) Ltd, under a signed membership agreement that took effect on ${fields.effectiveDate}.`,
    entitled: 'For as long as that agreement is in force, the Company is entitled to use the following address as its registered office and business address, including for its records with the Companies and Intellectual Property Commission (CIPC) and the South African Revenue Service (SARS):',
    items: [
      'we receive ordinary post, registered mail and courier deliveries for the Company at this address;',
      'the Company has signed a mandate authorising us to accept service of notices and legal process on its behalf at this address, and we notify the Company on the same business day that anything is received; and',
      `the Company's authorised representative for this arrangement is ${fields.representative}, in the capacity of ${fields.capacity}.`,
    ],
    closing: 'The Company uses this address on a virtual office basis. If the agreement ends, the Company must change its registered address with CIPC and SARS within 30 days. To verify that this confirmation is still current, contact us at hello@villagehub.co.za.',
  };
}

async function drawLetter(fields, logoBytes) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Confirmation of Registered Office and Business Address');
  pdf.setAuthor(`${ENTITY.legalName} t/a ${ENTITY.tradingAs}`);
  pdf.setSubject(fields.reference);
  pdf.setCreator('The Village Hub');
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await pdf.embedPng(logoBytes);
  const contentW = PAGE_W - MARGIN * 2;
  const copy = bodyCopy(fields);

  // The logo file is an opaque cream square. The band is that same cream,
  // so the square disappears and the tree reads as the letterhead mark.
  const bandBottom = PAGE_H - 168;
  page.drawRectangle({ x: 0, y: bandBottom, width: PAGE_W, height: PAGE_H - bandBottom, color: CREAM });
  const logoSize = 48;
  page.drawImage(logo, {
    x: (PAGE_W - logoSize) / 2,
    y: PAGE_H - 18 - logoSize,
    width: logoSize,
    height: logoSize,
  });
  drawTrackedCentered(page, 'BRICKFIELD SPACES (PTY) LTD', PAGE_H - 82, bold, 8.5, 1.35, BROWN);
  drawCentered(page, 'trading as The Village Hub', PAGE_H - 96, italic, 11, BROWN);
  drawCentered(page, ENTITY.letterhead[0], PAGE_H - 112, font, 8.5, MUTED);
  drawCentered(page, ENTITY.letterhead[1], PAGE_H - 124, font, 8.5, MUTED);
  drawCentered(page, ENTITY.contact, PAGE_H - 138, font, 8.5, BROWN);
  page.drawRectangle({ x: MARGIN, y: bandBottom, width: contentW, height: 2, color: GOLD });

  let y = bandBottom - 26;
  const guard = (next) => {
    if (next < FOOTER_TOP) {
      throw new Error('The confirmation letter does not fit on one page.');
    }
    return next;
  };

  page.drawText(fields.letterDate, { x: MARGIN, y, size: 10.5, font, color: INK });
  y = guard(y - 15);
  page.drawText('Our ref: ', { x: MARGIN, y, size: 10.5, font, color: INK });
  const refLabelW = font.widthOfTextAtSize('Our ref: ', 10.5);
  page.drawText(fields.reference, { x: MARGIN + refLabelW, y, size: 10.5, font: bold, color: INK });
  y = guard(y - 24);

  drawTrackedCentered(page, 'TO WHOM IT MAY CONCERN', y, bold, 10.5, 0.85, BROWN);
  y = guard(y - 18);
  drawCentered(page, 'CONFIRMATION OF REGISTERED OFFICE AND BUSINESS ADDRESS', y, bold, 10, BROWN);
  y = guard(y - 18);
  y = guard(drawWrapped(page, fields.heading, MARGIN, y, contentW, bold, 10, 13, INK) - 6);

  y = guard(drawWrapped(page, copy.intro, MARGIN, y, contentW, font, 10, 13.2, INK) - 4);
  y = guard(drawWrapped(page, copy.entitled, MARGIN, y, contentW, font, 10, 13.2, INK) - 8);

  const boxLines = ['REGISTERED OFFICE AND BUSINESS ADDRESS', ...ENTITY.addressLines];
  const boxH = 18 + boxLines.length * 13 + 8;
  y = guard(y - boxH);
  const boxTop = y + boxH;
  page.drawRectangle({ x: MARGIN, y, width: contentW, height: boxH, color: rgb(0.980, 0.973, 0.965) });
  page.drawRectangle({ x: MARGIN, y, width: 3, height: boxH, color: GOLD });
  let by = boxTop - 16;
  drawTrackedCentered(page, boxLines[0], by, bold, 8, 0.7, BROWN);
  by -= 16;
  for (const line of ENTITY.addressLines) {
    drawCentered(page, line, by, font, 11, INK);
    by -= 14;
  }
  y = guard(y - 16);

  y = guard(drawWrapped(page, 'We further confirm that:', MARGIN, y, contentW, font, 10, 13.2, INK) - 2);
  copy.items.forEach((item, i) => {
    y = guard(drawNumbered(page, i + 1, item, MARGIN, y, contentW, font, 10, 13.2, INK) - 2);
  });
  y = guard(y - 4);
  y = guard(drawWrapped(page, copy.closing, MARGIN, y, contentW, font, 10, 13.2, INK) - 14);

  y = guard(drawWrapped(page, 'Yours faithfully', MARGIN, y, contentW, font, 10.5, 13, INK) - 22);
  page.drawText(ENTITY.signatory, { x: MARGIN, y, size: 11, font: bold, color: INK });
  y = guard(y - 14);
  page.drawText(ENTITY.signatoryLine, { x: MARGIN, y, size: 8.5, font, color: MUTED });

  page.drawRectangle({ x: MARGIN, y: 64, width: contentW, height: 1, color: GOLD });
  drawCentered(page, ENTITY.footer, 48, font, 7.5, MUTED);
  drawCentered(page, ENTITY.directors, 36, font, 7.5, MUTED);
  drawCentered(page, ENTITY.tagline, 22, italic, 8, BROWN);

  return pdf.save({ useObjectStreams: false });
}

async function renderConfirmationPdf(app, opts) {
  const options = opts || {};
  const fields = letterFields(app, options.now);
  const logoBytes = options.logoBytes || loadLogoBytes();
  return drawLetter(fields, logoBytes);
}

function attachmentContent(content) {
  if (Buffer.isBuffer(content)) return content.toString('base64');
  if (content instanceof Uint8Array) return Buffer.from(content).toString('base64');
  return String(content);
}

async function persistConfirmation(app, bytes, filename, meta) {
  const m = meta || {};
  const rand = Math.random().toString(36).slice(2, 10);
  const storagePath = `applications/${app.id}/registered_address_confirmation-${rand}.pdf`;
  const body = Buffer.from(bytes);
  await L.uploadObject(storagePath, body, 'application/pdf');
  try {
    const doc = await L.insertRow('application_documents', {
      application_id: app.id,
      doc_type: DOC_TYPE,
      storage_path: storagePath,
      original_filename: filename,
      mime_type: 'application/pdf',
      size_bytes: body.length,
      verified: true,
      verified_by: m.verifiedBy || null,
      verified_at: new Date().toISOString(),
    });
    await L.logEvent(app.id, 'registered_address_confirmation_generated', m.actor || 'system', {
      document_id: doc && doc.id, storage_path: storagePath, reference: confirmationReference(app),
    });
    return {
      id: doc && doc.id,
      doc_type: DOC_TYPE,
      storage_path: storagePath,
      original_filename: filename,
      verified: true,
    };
  } catch (err) {
    try { await L.deleteObject(storagePath); } catch (cleanup) {
      console.error('confirmation letter cleanup failed:', cleanup.message);
    }
    throw err;
  }
}

// Writes the PDF and the application_documents row. A storage failure is
// logged and swallowed here so the welcome email can still carry the file.
async function createAndStore(app, now) {
  const bytes = await renderConfirmationPdf(app, { now });
  const filename = letterFilename(letterFields(app, now).company);
  try {
    await persistConfirmation(app, bytes, filename, { actor: 'system' });
  } catch (err) {
    console.error('confirmation letter storage:', err.message);
  }
  return { filename, content: bytes };
}

async function readHubProof() {
  if (!L.configured()) return null;
  try {
    const bytes = await L.downloadObject(HUB_PROOF_PATH);
    if (!bytes || !bytes.length) return null;
    if (bytes.slice(0, 4).toString() !== '%PDF') return null;
    return { filename: HUB_PROOF_FILENAME, content: bytes };
  } catch (err) {
    console.error('hub proof of address skipped:', err.message);
    return null;
  }
}

function liveIo() {
  return {
    now: () => new Date(),
    confirmationPdf: (app, now) => createAndStore(app, now),
    hubProof: () => readHubProof(),
  };
}

// The welcome email, with the letter attached only for a registered address.
// io.confirmationPdf and io.hubProof are injected so this can be tested
// without Storage. A missing hub proof, or a proof lookup that fails, leaves
// the letter attachment in place.
async function prepareWelcome(app, io) {
  const registered = O.needsRegisteredAddress(app);
  const now = io && io.now ? io.now() : new Date();
  let letter = null;
  let proof = null;
  if (registered && io && io.confirmationPdf) {
    try {
      letter = await io.confirmationPdf(app, now);
    } catch (err) {
      console.error('confirmation letter:', err.message);
      letter = null;
    }
  }
  if (letter && letter.content && io && io.hubProof) {
    try {
      proof = await io.hubProof();
    } catch (err) {
      console.error('hub proof of address skipped:', err.message);
      proof = null;
    }
  }
  const mail = T.activated(app, {
    registeredAddress: registered,
    confirmationAttached: Boolean(letter && letter.content),
    proofAttached: Boolean(proof && proof.content),
  });
  const attachments = [];
  if (letter && letter.content) {
    attachments.push({
      filename: letter.filename || letterFilename(legalName(app)),
      content: attachmentContent(letter.content),
      contentType: 'application/pdf',
    });
  }
  if (proof && proof.content) {
    attachments.push({
      filename: proof.filename || HUB_PROOF_FILENAME,
      content: attachmentContent(proof.content),
      contentType: 'application/pdf',
    });
  }
  return { subject: mail.subject, html: mail.html, attachments };
}

async function deliverWelcome(app, io, send) {
  let mail;
  try {
    mail = await prepareWelcome(app, io);
  } catch (err) {
    console.error('welcome prepare failed:', err.message);
    const fallback = T.activated(app, { registeredAddress: O.needsRegisteredAddress(app), confirmationAttached: false });
    mail = { subject: fallback.subject, html: fallback.html, attachments: [] };
  }
  const result = await send({ subject: mail.subject, html: mail.html, attachments: mail.attachments });
  return !result.error && !result.skipped;
}

async function generateForStaff(app, staff) {
  if (!O.needsRegisteredAddress(app)) {
    const err = new Error('This application does not include a registered address.');
    err.code = 'not_registered_address';
    throw err;
  }
  const who = staff && typeof staff === 'object' ? staff : { email: staff || 'staff' };
  const now = new Date();
  const bytes = await renderConfirmationPdf(app, { now });
  const filename = letterFilename(letterFields(app, now).company);
  return persistConfirmation(app, bytes, filename, {
    actor: who.email || 'staff',
    verifiedBy: who.user_id || null,
  });
}

module.exports = {
  DOC_TYPE, HUB_PROOF_PATH, HUB_PROOF_FILENAME, ENTITY,
  confirmationReference, letterFields, letterFilename,
  renderConfirmationPdf, prepareWelcome, deliverWelcome,
  createAndStore, readHubProof, liveIo, generateForStaff,
  resolveLogoPath,
};
