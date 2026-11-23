// Spacebring public API client for the onboarding automation.
//
// Auth is HTTP Basic: the network's Client ID is the username and the Client
// Secret is the password (Spacebring > Network settings > Developers; needs
// the API & webhooks add-on). Both live only in Netlify env.
//
// SPACEBRING_PROVISIONING decides what Approve does:
//   off   (default) nothing automatic; the old by-hand process applies
//   dry   every step is worked out and recorded, nothing is sent to Spacebring
//   live  the calls are made
// Shipping dark and switching on per environment means a deploy can never
// start creating customers and invoices by surprise.

const BASE = 'https://api.spacebring.com';
const CLIENT_ID     = process.env.SPACEBRING_CLIENT_ID;
const CLIENT_SECRET = process.env.SPACEBRING_CLIENT_SECRET;
const LOCATION_REF  = process.env.SPACEBRING_LOCATION_REF || 'e54f9f0c-df10-4943-aadc-fd378c74bd11';

// Contract templates (Spacebring > Location settings > Billing > Contracts).
// Until these are set, virtual office approvals stop at "needs attention"
// after the customer is created, rather than billing without an agreement.
const TEMPLATE_VO            = process.env.SPACEBRING_TEMPLATE_VIRTUAL_OFFICE || null;
const TEMPLATE_VO_REGISTERED = process.env.SPACEBRING_TEMPLATE_VIRTUAL_OFFICE_REGISTERED || null;

// Plan ids, read from Spacebring on 23 Nov 2026. Titles must match
// _lib.PLANS exactly. Prices are not sent: the plan's own price applies, so a
// price change in Spacebring needs no change here.
const PLAN_REFS = {
  'Village Address':          { id: 'f696cdce-8b60-479d-9049-8f11e76b2e95', period: 'month' },
  'Village Virtual':          { id: '09645101-976d-45da-ace6-798d731f8bbc', period: 'month' },
  'Village Virtual Pro':      { id: '87b90989-1b5c-47bf-a168-0480a9196cab', period: 'month' },
  'Student 5-Day':            { id: '8378ebe1-9227-48cf-bc95-4afe03354dfc', period: 'month' },
  'Student All-Access':       { id: 'b108988a-e265-485a-ac20-f63d60de6939', period: 'month' },
  'Night Owl (Student)':      { id: '002e61fa-3889-4ec5-b361-2d5edb8708e7', period: 'month' },
  'Exam Pass 2026 (Student)': { id: 'ed4077b8-b086-45f2-9148-1969d4c281b7', period: 'threeMonths' },
};

function mode() {
  const m = String(process.env.SPACEBRING_PROVISIONING || 'off').toLowerCase();
  return m === 'live' || m === 'dry' ? m : 'off';
}

function credentialsSet() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

class SpacebringError extends Error {
  constructor(status, body, path) {
    const detail = body && typeof body === 'object' ? (body.message || JSON.stringify(body)) : String(body || '');
    super(`Spacebring ${status} on ${path}: ${detail.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, body) {
  if (!credentialsSet()) throw new Error('Spacebring credentials are not set in Netlify');
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new SpacebringError(res.status, data, path);
  return data;
}

// The API wraps some responses twice ({contract:{contract:{...}}}).
function unwrap(data, key) {
  let v = data && data[key];
  if (v && v[key] && typeof v[key] === 'object') v = v[key];
  return v || null;
}

function createCompany({ title, legalName, taxId, notes, metadata }) {
  return call('POST', '/community/companies/v1', {
    company: {
      title, locationRef: LOCATION_REF,
      ...(legalName ? { legalName } : {}),
      ...(taxId ? { taxId } : {}),
      ...(notes ? { notes } : {}),
      ...(metadata ? { metadata } : {}),
    },
  }).then(d => unwrap(d, 'company'));
}

// Sends the member their Spacebring invitation.
function createMembership({ email, name, surname, phoneNumber, companyRef, notes, metadata }) {
  return call('POST', '/community/memberships/v1', {
    membership: {
      locationRef: LOCATION_REF,
      type: 'member',
      user: { email, name, ...(surname ? { surname } : {}), ...(phoneNumber ? { phoneNumber } : {}) },
      ...(companyRef ? { companyRef, companyRole: 'manager' } : {}),
      ...(notes ? { notes } : {}),
      ...(metadata ? { metadata } : {}),
    },
  }).then(d => unwrap(d, 'membership'));
}

// A contract whose signature creates the subscription (actionable). The
// client is the only signatory, so nothing waits on a Hub signature.
function createContract({ customerRef, templateRef, planTitle, startDate, expirationDate, signer }) {
  const plan = PLAN_REFS[planTitle];
  return call('POST', '/contracts/v1', {
    contract: {
      actionable: true,
      customerRef,
      templateRef,
      startDate,
      expirationDate,
      items: [{ type: 'plan', planRef: plan.id, title: planTitle, quantity: 1 }],
      signers: [{ type: 'customer', email: signer.email, name: signer.name, surname: signer.surname || '', ...(signer.phoneNumber ? { phoneNumber: signer.phoneNumber } : {}) }],
    },
  }).then(d => unwrap(d, 'contract'));
}

function issueContract(contractId) {
  return call('POST', `/contracts/v1/${contractId}/issue`, { signatureMethod: 'eSignature' })
    .then(d => unwrap(d, 'contract'));
}

function getContract(contractId) {
  return call('GET', `/contracts/v1/${contractId}`).then(d => unwrap(d, 'contract'));
}

// Used for plans with no agreement to sign (student plans).
function createSubscription({ membershipRef, companyRef, planTitle, startDate }) {
  const plan = PLAN_REFS[planTitle];
  return call('POST', '/subscriptions/v1', {
    issueFirstInvoice: 'auto',
    subscription: {
      ...(companyRef ? { companyRef } : { membershipRef }),
      period: plan.period,
      startDate,
      items: [{ planRef: plan.id }],
    },
  }).then(d => unwrap(d, 'subscription'));
}

// Newest invoices for one customer. The caller picks the one that belongs to
// the subscription.
function listInvoices(customerRef) {
  return call('GET', `/billing/invoices/v1?customerRef=${encodeURIComponent(customerRef)}&limit=25`)
    .then(d => (d && d.invoices) || []);
}

module.exports = {
  mode, credentialsSet, SpacebringError, PLAN_REFS, LOCATION_REF,
  TEMPLATE_VO, TEMPLATE_VO_REGISTERED,
  createCompany, createMembership, createContract, issueContract, getContract,
  createSubscription, listInvoices,
};
