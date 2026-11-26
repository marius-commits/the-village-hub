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

// Shop product "Registered Address (CIPC / SARS)", read 24 Nov 2026.
// The Monthly option is R250 ZAR. Contract line items cannot be type
// "recurring" (only plan, resource or oneOff), so the monthly charge is
// added with createSubscriptionItem once the signature has created the
// subscription. SPACEBRING_REGISTERED_ADDRESS_PRODUCT_REF overrides the
// product; set it to "none" for a custom line with no product link.
const REGISTERED_ADDRESS_PRODUCT_REF = 'a3ec6ad3-05cd-486a-98b1-104157dbfb36';
const REGISTERED_ADDRESS_OPTION_REF  = 'c7336c09-8f78-4ed5-904d-2ee89ce3397f';

function registeredAddressSpec(commitmentCycles) {
  const raw = process.env.SPACEBRING_REGISTERED_ADDRESS_PRODUCT_REF;
  const productRef = raw === undefined || raw === ''
    ? REGISTERED_ADDRESS_PRODUCT_REF
    : (String(raw).toLowerCase() === 'none' ? null : raw);
  const price = Number(process.env.SPACEBRING_REGISTERED_ADDRESS_PRICE || 250);
  const title = process.env.SPACEBRING_REGISTERED_ADDRESS_TITLE || 'Registered Address (CIPC / SARS)';
  const cycles = Number(commitmentCycles) || Number(process.env.SPACEBRING_REGISTERED_ADDRESS_COMMITMENT_CYCLES || 3);
  return {
    title,
    price,
    productRef,
    optionRef: process.env.SPACEBRING_REGISTERED_ADDRESS_OPTION_REF || REGISTERED_ADDRESS_OPTION_REF,
    commitmentCycles: cycles,
    item() {
      return {
        type: 'recurring',
        title,
        price,
        quantity: 1,
        commitmentCycles: cycles,
        ...(productRef ? { productRef } : {}),
      };
    },
  };
}

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
  // Desk passes, read from Spacebring on 26 Nov 2026. Village Local and
  // Village Resident are NOT here on purpose: in Spacebring they are pricing
  // tiers of a desk resource, not plans, and a subscription to one cannot be
  // created with a planRef. Those two are set up by hand until that call has
  // been proven against the live API.
  'Village Wanderer':         { id: '1a11906e-8de4-4671-9f13-23f5421d0f1f', period: 'month' },
  'Village Visitor':          { id: '554d225a-e51b-49ea-80eb-a9625be9f4f6', period: 'month' },
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
//
// startDate is when membership and billing begin. endDate is the end of the
// commitment term on the agreement (start plus 3, 6 or 12 months). It is not
// a cancellation date for the subscription: after the commitment the plan
// carries on month to month. Contract items have no commitmentCycles field
// (types are plan, resource, oneOff), so the billing commitment is written
// onto the subscription item once the signature has created it.
function createContract({ customerRef, templateRef, planTitle, startDate, endDate, expirationDate, signer }) {
  const plan = PLAN_REFS[planTitle];
  return call('POST', '/contracts/v1', {
    contract: {
      actionable: true,
      customerRef,
      templateRef,
      startDate,
      ...(endDate ? { endDate } : {}),
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
// commitmentCycles is the minimum number of billing periods. endDate is left
// unset so the subscription does not stop when the minimum is reached.
// couponRef grants a coupon on the plan item, so the discount is on the first
// invoice without the member typing a promo code.
function createSubscription({ membershipRef, companyRef, planTitle, startDate, commitmentCycles, couponRef }) {
  const plan = PLAN_REFS[planTitle];
  return call('POST', '/subscriptions/v1', {
    issueFirstInvoice: 'auto',
    subscription: {
      ...(companyRef ? { companyRef } : { membershipRef }),
      period: plan.period,
      startDate,
      items: [{
        planRef: plan.id,
        ...(commitmentCycles ? { commitmentCycles } : {}),
        ...(couponRef ? { grantedDiscounts: [{ coupon: { id: couponRef } }] } : {}),
      }],
    },
  }).then(d => unwrap(d, 'subscription'));
}

function getSubscription(subscriptionId) {
  return call('GET', `/subscriptions/v1/${subscriptionId}`).then(d => unwrap(d, 'subscription'));
}

// Recurring add-on, billed with the subscription from the next invoice on.
function createSubscriptionItem(subscriptionId, item) {
  return call('POST', `/subscriptions/v1/${subscriptionId}/items`, { item })
    .then(d => unwrap(d, 'subscription'));
}

// 204 with an empty body. Omitted fields keep their current values.
function updateSubscriptionItem(subscriptionId, itemId, item) {
  return call('PATCH', `/subscriptions/v1/${subscriptionId}/items/${itemId}`, { item });
}

// Newest invoices for one customer. The caller picks the one that belongs to
// the subscription.
function listInvoices(customerRef) {
  return call('GET', `/billing/invoices/v1?customerRef=${encodeURIComponent(customerRef)}&limit=25`)
    .then(d => (d && d.invoices) || []);
}

module.exports = {
  mode, credentialsSet, SpacebringError, PLAN_REFS, LOCATION_REF,
  TEMPLATE_VO, TEMPLATE_VO_REGISTERED, registeredAddressSpec,
  REGISTERED_ADDRESS_PRODUCT_REF, REGISTERED_ADDRESS_OPTION_REF,
  createCompany, createMembership, createContract, issueContract, getContract,
  createSubscription, getSubscription, createSubscriptionItem, updateSubscriptionItem,
  listInvoices,
};
