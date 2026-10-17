// Shared helpers for the membership application system.
//
// Design notes:
//  - No npm dependencies. Netlify's Node runtime has global fetch, and the
//    Supabase REST/Storage/Auth APIs are plain HTTP. Keeping this dependency
//    free means there is no build step and nothing to keep patched.
//  - The service role key NEVER leaves these functions. The browser only ever
//    receives short-lived signed URLs scoped to one object path.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;

const FROM_EMAIL   = process.env.APPLICATIONS_FROM_EMAIL   || 'The Village Hub <hello@villagehub.co.za>';
const NOTIFY_EMAIL = process.env.APPLICATIONS_NOTIFY_EMAIL || 'hello@villagehub.co.za';
const SITE_URL     = process.env.SITE_URL                  || 'https://www.villagehub.co.za';

const BUCKET = 'kyc-documents';

// Plan titles must match Spacebring exactly. If a plan is renamed there, it
// must be renamed here in the same change, or applications will be approved
// against a plan that no longer exists.
const PLANS = {
  virtual_office: ['Village Address', 'Village Virtual', 'Village Virtual Pro'],
  student: ['Student 5-Day', 'Student All-Access', 'Night Owl (Student)', 'Exam Pass 2026 (Student)'],
};

// Which documents each application type requires before it can be reviewed.
const REQUIRED_DOCS = {
  virtual_office: ['cipc_certificate', 'director_id', 'proof_of_address'],
  student: ['student_card', 'proof_of_registration'],
};

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function ok(body)            { return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) }; }
function bad(msg, code = 400){ return { statusCode: code, headers: JSON_HEADERS, body: JSON.stringify({ error: msg }) }; }

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

// --- Supabase REST -------------------------------------------------------

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 400)}`);
  }
  return data;
}

async function insertRow(table, row) {
  const rows = await sb(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateRows(table, filter, patch) {
  return sb(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
}

async function selectRows(table, query) {
  return sb(`/rest/v1/${table}?${query}`, { method: 'GET' });
}

async function logEvent(applicationId, eventType, actor, detail) {
  try {
    await insertRow('application_events', {
      application_id: applicationId,
      event_type: eventType,
      actor: actor || 'system',
      detail: detail || null,
    });
  } catch (err) {
    // The audit trail must never break the user-facing flow.
    console.error('logEvent failed:', err.message);
  }
}

// --- Storage -------------------------------------------------------------

// Returns a one-time signed URL the browser can PUT a single file to.
async function createSignedUploadUrl(path) {
  const data = await sb(`/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST' });
  return { path, token: data.token, url: `${SUPABASE_URL}/storage/v1${data.url}` };
}

// Returns a short-lived read URL so staff can view a document in the browser.
async function createSignedViewUrl(path, expiresIn = 900) {
  const data = await sb(`/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn }),
  });
  return `${SUPABASE_URL}/storage/v1${data.signedURL || data.signedUrl}`;
}

// --- Staff authentication ------------------------------------------------

// Verifies the caller's Supabase session JWT and confirms they are active
// staff. Returns the staff record, or null if they are neither.
async function requireStaff(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;

  const rows = await selectRows('staff', `user_id=eq.${user.id}&active=is.true&select=*`);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// --- Email ---------------------------------------------------------------

async function sendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_KEY) {
    console.warn('RESEND_API_KEY not set, skipping email:', subject);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('Resend failed:', res.status, body.slice(0, 300));
    return { error: body };
  }
  return res.json();
}

// --- Validation ----------------------------------------------------------

function clean(value, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function validEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function safeExtension(filename, mime) {
  const byMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/heic': 'heic',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  if (byMime[mime]) return byMime[mime];
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename || '');
  return m ? m[1].toLowerCase() : 'bin';
}

module.exports = {
  SUPABASE_URL, BUCKET, PLANS, REQUIRED_DOCS, ALLOWED_MIME, MAX_FILE_BYTES,
  NOTIFY_EMAIL, SITE_URL,
  ok, bad, configured,
  sb, insertRow, updateRows, selectRows, logEvent,
  createSignedUploadUrl, createSignedViewUrl,
  requireStaff, sendEmail,
  clean, validEmail, safeExtension,
};
