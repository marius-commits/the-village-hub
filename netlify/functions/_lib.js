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
// Publishable key, the same one the admin pages carry. Used only for the
// /auth/v1/otp call, so that request is made with exactly the privileges a
// browser would have. It grants no data access: every table is behind RLS.
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_o99egQoMPiyVoqxYGwhLEw_vzzX1fVo';

const FROM_EMAIL   = process.env.APPLICATIONS_FROM_EMAIL   || 'The Village Hub <hello@villagehub.co.za>';
const NOTIFY_EMAIL = process.env.APPLICATIONS_NOTIFY_EMAIL || 'hello@villagehub.co.za';
const SITE_URL     = process.env.SITE_URL                  || 'https://www.villagehub.co.za';
// Everyone who must hear about every new lead and every completed application.
// Override with LEAD_NOTIFY_EMAILS (comma-separated) in Netlify env if the team changes.
const STAFF_EMAILS = (process.env.LEAD_NOTIFY_EMAILS ||
  'marius@brick-field.co.za,christel@villagehub.co.za,francois@brick-field.co.za')
  .split(',').map(e => e.trim()).filter(Boolean);

// Whoever runs the mail desk. Told when a virtual office client goes live.
// Falls back to the staff list so the notice is never lost if this is unset.
const MAIL_DESK_EMAILS = (process.env.MAIL_DESK_EMAILS || '')
  .split(',').map(e => e.trim()).filter(Boolean);

// Marius is the gate. New access requests are emailed here.
const OWNER_EMAIL = (process.env.ADMIN_OWNER_EMAIL || 'marius@brick-field.co.za').toLowerCase();

const BUCKET = 'kyc-documents';

// Plan titles must match Spacebring exactly. If a plan is renamed there, it
// must be renamed here in the same change, or applications will be approved
// against a plan that no longer exists.
const PLANS = {
  virtual_office: ['Village Address', 'Village Virtual', 'Village Virtual Pro'],
  student: ['Student 5-Day', 'Student All-Access', 'Night Owl (Student)', 'Exam Pass 2026 (Student)'],
  // Desk plans. Prices and the current offer live in _desk.js.
  desk: ['Village Wanderer', 'Village Visitor', 'Village Local', 'Village Resident'],
};

// Which documents each application type requires before it can be reviewed.
const REQUIRED_DOCS = {
  virtual_office: ['cipc_certificate', 'director_id', 'proof_of_address'],
  student: ['student_card', 'proof_of_registration'],
  // A desk needs no compliance check, so there is nothing to upload.
  desk: [],
};

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function ok(body)            { return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) }; }
function bad(msg, code = 400, errorCode) {
  const body = { error: msg };
  if (errorCode) body.code = errorCode;
  return { statusCode: code, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

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
  // Body must be valid JSON ("{}"), not empty: the storage server sets
  // Content-Type application/json and rejects an empty body with 400.
  const data = await sb(`/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', body: '{}' });
  return { path, token: data.token, url: `${SUPABASE_URL}/storage/v1${data.url}` };
}

// Writes one object with the service role. Staff BizProfile PDFs are small
// enough to come through the function; applicant KYC still uses signed URLs
// because phone photos blow the function body limit.
async function uploadObject(path, bytes, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage upload ${res.status}: ${text.slice(0, 300)}`);
  }
  return true;
}

// Reads one private object. A missing object is null, not an error, so an
// optional file (the Hub proof of address) can be skipped cleanly.
async function downloadObject(objectPath) {
  const safe = String(objectPath || '').replace(/^\/+/, '');
  if (!safe || !SUPABASE_URL || !SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${safe}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /not_found|object not found/i.test(text)) return null;
    throw new Error(`Storage download ${res.status}: ${text.slice(0, 200)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length ? bytes : null;
}

async function deleteObject(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Storage delete ${res.status}: ${text.slice(0, 200)}`);
  }
  return true;
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

function bearerToken(event) {
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// pending | approved | revoked | none
// Before the status column exists, active=true is treated as approved so a
// deploy ahead of the migration does not lock the current team out.
function accessStatus(row) {
  if (!row) return 'none';
  if (row.status === 'pending' || row.status === 'approved' || row.status === 'revoked') return row.status;
  return row.active ? 'approved' : 'revoked';
}

function staffView(row, userId) {
  return {
    email: row.email,
    role: row.role || 'reviewer',
    full_name: row.full_name || null,
    user_id: userId || null,
    status: accessStatus(row),
    active: row.active === true,
  };
}

// Verifies the caller's Supabase session JWT. Returns the auth user or null.
async function readUser(event) {
  const token = bearerToken(event);
  if (!token || !SUPABASE_URL || !SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id || !user.email) return null;
  return user;
}

async function staffByEmail(email) {
  const rows = await selectRows('staff_access', `email=eq.${encodeURIComponent(email)}&select=*`);
  return rows && rows[0] ? rows[0] : null;
}

// Approved staff only. Same shape as before, so existing callers keep working.
// Pending and revoked callers get null here; use gate() when the page needs
// to tell those two apart.
async function requireStaff(event) {
  const user = await readUser(event);
  if (!user) return null;
  const email = user.email.toLowerCase();
  const row = await staffByEmail(email);
  if (!row || accessStatus(row) !== 'approved' || row.active === false) return null;
  return staffView(row, user.id);
}

// { ok:true, staff } or { ok:false, status, error, code }
async function gate(event) {
  const user = await readUser(event);
  if (!user) return { ok: false, status: 401, error: 'Not authorised', code: 'auth' };
  const email = user.email.toLowerCase();
  const row = await staffByEmail(email);
  const status = accessStatus(row);
  if (status === 'pending') {
    return {
      ok: false,
      status: 403,
      error: "Your access is waiting for Marius's approval.",
      code: 'pending',
      staff: staffView(row, user.id),
    };
  }
  if (status !== 'approved' || !row.active) {
    return { ok: false, status: 403, error: 'This address does not have access.', code: 'revoked' };
  }
  return { ok: true, staff: staffView(row, user.id) };
}

// For handlers: returns { staff } or { response } ready to return.
async function guard(event) {
  try {
    const result = await gate(event);
    if (!result.ok) return { response: bad(result.error, result.status, result.code), staff: result.staff || null };
    return { staff: result.staff };
  } catch (err) {
    console.error('staff check failed:', err.message);
    return { response: bad('Could not verify your access', 500) };
  }
}

// --- Staff sign-in -------------------------------------------------------

// Makes sure an auth account exists for this email BEFORE a one-time code is
// requested. This is the difference between a code and a link:
//
//   no auth user yet  -> Supabase treats /auth/v1/otp as a sign-up and sends
//                        the "Confirm signup" template, which carries only a
//                        confirmation LINK. That is what new staff were
//                        getting, and the link is useless on the login page.
//   auth user exists  -> Supabase sends the "Magic link or OTP" template,
//                        which this project has edited to render {{ .Token }}.
//
// Creating the user first therefore guarantees the code path every time.
// email_confirm:true is correct here: the address is on the staff list, and
// the one-time code is itself the proof that they control the inbox.
async function ensureAuthUser(email) {
  try {
    await sb('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true }),
    });
    return 'created';
  } catch (err) {
    // Already registered is the normal case for everyone after the first login.
    if (/already (been )?registered|already exists|email_exists/i.test(err.message)) return 'existing';
    throw err;
  }
}

// Asks Supabase to email a one-time sign-in code. create_user is false: by
// this point the account is guaranteed to exist, and leaving it false means a
// bug here can never silently create an account.
async function sendStaffOtp(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: false, should_create_user: false }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`otp ${res.status}: ${body.slice(0, 300)}`);
  }
  return true;
}

// --- Email ---------------------------------------------------------------

// client:true marks a message that goes to an applicant or member. Every one
// of those is blind-copied to the Hub inbox, so the team can see exactly what
// a client was sent and when without anyone having to forward it.
function clientBcc(to) {
  const list = (Array.isArray(to) ? to : [to]).map(e => String(e).toLowerCase());
  return list.includes(NOTIFY_EMAIL.toLowerCase()) ? [] : [NOTIFY_EMAIL];
}

// Resend attachments are { filename, content } with content base64.
// contentType is optional and sent as content_type when the caller has one.
function resendAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return undefined;
  const files = [];
  for (const file of attachments) {
    if (!file || !file.filename || file.content == null || file.content === '') continue;
    const item = { filename: String(file.filename), content: String(file.content) };
    const type = file.content_type || file.contentType;
    if (type) item.content_type = String(type);
    files.push(item);
  }
  return files.length ? files : undefined;
}

async function sendEmail({ to, subject, html, replyTo, client, cc, attachments }) {
  const bcc = client ? clientBcc(to) : [];
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('RESEND_API_KEY not set, skipping email:', subject);
    return { skipped: true };
  }
  const files = resendAttachments(attachments);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(cc && cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      ...(files ? { attachments: files } : {}),
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
  NOTIFY_EMAIL, STAFF_EMAILS, MAIL_DESK_EMAILS, OWNER_EMAIL, SITE_URL, PUBLISHABLE_KEY,
  ok, bad, configured,
  sb, insertRow, updateRows, selectRows, logEvent,
  createSignedUploadUrl, createSignedViewUrl, uploadObject, downloadObject, deleteObject,
  bearerToken, accessStatus, staffView, staffByEmail,
  requireStaff, gate, guard, readUser,
  ensureAuthUser, sendStaffOtp, sendEmail, clientBcc,
  clean, validEmail, safeExtension,
};
