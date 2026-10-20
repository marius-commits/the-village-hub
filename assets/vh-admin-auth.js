/* The Village Hub — staff admin session.
 * Shared by /admin/applications and /admin/dashboard.
 *
 * What changed and why
 * --------------------
 * Before, only the one-hour access token was kept, and it was kept in
 * sessionStorage. That meant a new sign-in code for every tab, every browser
 * restart, and every hour of work. The original reason was sound — this tool
 * displays identity documents — but it put the cost on the wrong thing: a
 * token in memory is not what protects those documents.
 *
 * What actually protects them is unchanged and server side: every request is
 * re-checked against staff_access, so removing somebody there cuts them off
 * at once whatever their browser is holding, and documents are never bundled
 * into the page — each one is signed at the moment it is clicked.
 *
 * So the refresh token now persists in localStorage and is rotated on every
 * use, with a 30-day idle cap. Use the tool once a month and you never sign
 * in again; leave it untouched for 30 days and it asks for a code.
 */
window.VHAdminAuth = (function () {
  'use strict';

  var SUPABASE_URL = 'https://lcrjcdlydlfrohtppmky.supabase.co';
  // Publishable key. Safe in client code: it grants no data access on its
  // own. Every table is behind RLS and every document behind a signed URL.
  var SUPABASE_KEY = 'sb_publishable_o99egQoMPiyVoqxYGwhLEw_vzzX1fVo';

  var STORE_KEY    = 'vh_admin_session';
  var LEGACY_KEY   = 'vh_admin_token';
  var MAX_IDLE_MS  = 30 * 24 * 60 * 60 * 1000;  // 30 days untouched, then re-auth
  var RENEW_MARGIN = 120;                       // seconds of headroom on the access token

  var session = null;        // { access_token, refresh_token, expires_at, last_used }
  var refreshing = null;     // in-flight refresh, so parallel calls share one

  // --- storage ------------------------------------------------------------
  // Every read and write is guarded: private windows and blocked site data
  // make these throw, and the tool must still work for that tab.

  function load() {
    if (session) return session;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.refresh_token) return null;
      if (s.last_used && Date.now() - s.last_used > MAX_IDLE_MS) { clear(); return null; }
      session = s;
      return session;
    } catch (e) { return null; }
  }

  function save(s) {
    session = {
      access_token:  s.access_token,
      refresh_token: s.refresh_token,
      // expires_at comes back in seconds; fall back to expires_in if absent.
      expires_at:    s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)),
      last_used:     Date.now(),
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }

  function touch() {
    if (!session) return;
    session.last_used = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(session)); } catch (e) {}
  }

  function clear() {
    session = null;
    refreshing = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    try { sessionStorage.removeItem(LEGACY_KEY); } catch (e) {}
  }

  // --- sign-in ------------------------------------------------------------

  // Step one. Goes through our own function, which checks the staff list and
  // makes sure an auth account exists before Supabase sends anything — that
  // is what guarantees a CODE arrives rather than a confirmation link.
  function requestCode(email) {
    return fetch('/.netlify/functions/staff-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Could not send that code.');
        return data;
      });
    });
  }

  // Step two. Exchanges the code for a full session, refresh token included.
  function verifyCode(email, code) {
    return fetch(SUPABASE_URL + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, token: code, type: 'email' }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.access_token) {
          throw new Error(data.error_description || data.msg || data.error || 'That code did not work');
        }
        return save(data);
      });
    });
  }

  // --- token upkeep -------------------------------------------------------

  function refresh() {
    var s = load();
    if (!s || !s.refresh_token) return Promise.reject(new Error('no session'));
    if (refreshing) return refreshing;

    refreshing = fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data.access_token) throw new Error('refresh failed');
        return save(data);   // the refresh token rotates — keep the new one
      });
    }).catch(function (err) {
      clear();
      throw err;
    }).then(function (out) { refreshing = null; return out; },
            function (err) { refreshing = null; throw err; });

    return refreshing;
  }

  function accessToken() {
    var s = load();
    if (!s) return Promise.reject(new Error('no session'));
    var now = Math.floor(Date.now() / 1000);
    if (s.access_token && s.expires_at && s.expires_at - now > RENEW_MARGIN) {
      touch();
      return Promise.resolve(s.access_token);
    }
    return refresh().then(function (fresh) { return fresh.access_token; });
  }

  // --- calling our functions ---------------------------------------------

  // Adds the bearer token, and on a 401 refreshes once and retries before
  // giving up. A stale access token should never show the sign-in screen.
  function api(path, options) {
    options = options || {};
    return accessToken().then(function (tok) {
      return call(path, options, tok).then(function (res) {
        if (res.status !== 401) return res;
        return refresh().then(function (fresh) { return call(path, options, fresh.access_token); });
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 || res.status === 403) {
          clear();
          var e = new Error(data.error || 'Your session has ended. Sign in again.');
          e.authRequired = true;
          throw e;
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    }, function (err) {
      if (!err.authRequired) { err = err || new Error('Request failed'); err.authRequired = true; }
      throw err;
    });
  }

  function call(path, options, tok) {
    var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
    if (options.headers) for (var k in options.headers) headers[k] = options.headers[k];
    return fetch('/.netlify/functions/' + path, {
      method: options.method || 'GET',
      body: options.body,
      headers: headers,
    });
  }

  function hasSession() { return Boolean(load()); }

  return {
    requestCode: requestCode,
    verifyCode:  verifyCode,
    accessToken: accessToken,
    api:         api,
    hasSession:  hasSession,
    signOut:     clear,
    SUPABASE_URL: SUPABASE_URL,
  };
})();
