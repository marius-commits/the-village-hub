/* The Village Hub command centre. One shell, six sections, phone first. */
(function () {
  'use strict';
  var Auth = window.VHAdminAuth;
  var $ = function (s) { return document.querySelector(s); };
  var DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /(?:\?|&)demo=1(?:&|$)/.test(location.search);

  var TABS = [
    { id: 'today', label: 'Today', path: '/admin' },
    { id: 'leads', label: 'Leads', path: '/admin/leads' },
    { id: 'whatsapp', label: 'WhatsApp', path: '/admin/whatsapp' },
    { id: 'marketing', label: 'Marketing', path: '/admin/marketing' },
    { id: 'numbers', label: 'Numbers', path: '/admin/numbers' },
    { id: 'access', label: 'Access', path: '/admin/access', owner: true }
  ];
  var STATUS = { new: 'New', contacted: 'Contacted', viewing_booked: 'Viewing booked', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
  var STATUS_BTNS = ['contacted', 'viewing_booked', 'quoted', 'won', 'lost'];
  var APP_STATUS = { submitted: 'Submitted', under_review: 'Under review', info_requested: 'Waiting on applicant', approved: 'Approved', activated: 'Activated', declined: 'Declined', withdrawn: 'Withdrawn' };
  var SOURCE = { website: 'Website', google_ads: 'Google Ads', whatsapp: 'WhatsApp', referral: 'Referral', walk_in: 'Walk-in', meta: 'Meta' };

  var state = { staff: null, team: [], tab: 'today', wa: 'queue', leadStatus: '', thread: null };
  var demoData = null;
  var pendingEmail = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function minsLabel(m) {
    if (m === null || m === undefined) return 'No first response recorded yet';
    if (m < 90) return Math.round(m) + ' min';
    return (m / 60).toFixed(1).replace(/\.0$/, '') + ' h';
  }
  function waLink(phone) {
    if (!phone) return '';
    var digits = String(phone).replace(/\D/g, '').replace(/^0/, '27');
    return digits ? 'https://wa.me/' + digits : '';
  }
  function sastInput(iso) {
    if (!iso) return '';
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(iso));
    var g = function (t) { return parts.find(function (p) { return p.type === t; }).value; };
    return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute');
  }
  function fromSast(value) {
    if (!value) return null;
    return new Date(value.length === 16 ? value + ':00+02:00' : value).toISOString();
  }

  function tabFromPath() {
    var path = location.pathname.replace(/\/$/, '') || '/admin';
    if (path.endsWith('/command.html')) return 'today';
    var found = TABS.filter(function (t) { return t.path === path; })[0];
    return found ? found.id : 'today';
  }

  function showLogin(message) {
    $('#app').hidden = true;
    $('#waiting').hidden = true;
    $('#login').hidden = false;
    $('#step-code').hidden = true;
    $('#step-email').hidden = false;
    var msg = $('#loginMsg');
    msg.className = 'small ' + (message ? 'err' : 'muted');
    msg.textContent = message || '';
  }

  function showWaiting(email) {
    $('#login').hidden = true;
    $('#app').hidden = true;
    $('#waiting').hidden = false;
    $('#waitCopy').textContent = (email ? email + ' — ' : '') + "Your access is waiting for Marius's approval.";
  }

  function showApp() {
    $('#login').hidden = true;
    $('#waiting').hidden = true;
    $('#app').hidden = false;
    $('#whoami').textContent = state.staff.full_name || state.staff.email;
    renderTabs();
    render().catch(function (err) { $('#main').innerHTML = '<div class="err">' + esc(err.message || 'Could not load this section.') + '</div>'; });
  }

  function renderTabs() {
    $('#tabs').innerHTML = TABS.filter(function (t) { return !t.owner || state.staff.role === 'owner'; }).map(function (t) {
      return '<button type="button" data-tab="' + t.id + '" class="' + (t.id === state.tab ? 'on' : '') + '">' + t.label + '</button>';
    }).join('');
  }

  function go(tab) {
    if (tab === 'access' && state.staff.role !== 'owner') tab = 'today';
    state.tab = tab;
    var path = (TABS.filter(function (t) { return t.id === tab; })[0] || TABS[0]).path;
    if (location.pathname.replace(/\/$/, '') !== path && !DEMO) history.pushState({ tab: tab }, '', path);
    renderTabs();
    render().catch(function (err) { $('#main').innerHTML = '<div class="err">' + esc(err.message || 'Could not load this section.') + '</div>'; });
  }

  async function api(path, options) {
    if (DEMO) return demoApi(path, options);
    try {
      return await Auth.api(path, options);
    } catch (e) {
      if (e && e.code === 'pending') { showWaiting(state.staff && state.staff.email); return null; }
      if (e && e.authRequired) { showLogin('Your session has ended. Sign in again.'); return null; }
      throw e;
    }
  }

  function demoApi(path, options) {
    var base = path.split('?')[0];
    var q = {};
    (path.split('?')[1] || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var bits = pair.split('=');
      q[decodeURIComponent(bits[0])] = decodeURIComponent(bits[1] || '');
    });
    if (options && options.method === 'POST') return Promise.resolve({ ok: true, sent: false });
    if (base === 'staff-session') return Promise.resolve(demoData.session);
    if (base === 'staff-today') return Promise.resolve(demoData.today);
    if (base === 'staff-leads') return Promise.resolve(demoData.leads);
    if (base === 'staff-numbers') return Promise.resolve(demoData.numbers);
    if (base === 'staff-marketing') return Promise.resolve(demoData.marketing);
    if (base === 'staff-access') return Promise.resolve(demoData.access);
    if (base === 'staff-whatsapp') {
      if (q.section === 'backlog') return Promise.resolve(demoData.backlog);
      if (q.section === 'inbox') return Promise.resolve(demoData.inbox);
      if (q.section === 'thread') return Promise.resolve(demoData.thread);
      return Promise.resolve(demoData.queue);
    }
    return Promise.resolve({});
  }

  async function boot() {
    if (DEMO) {
      var res = await fetch('/__demo.json');
      demoData = await res.json();
      state.staff = demoData.session.staff;
      state.team = demoData.session.team || [];
      state.tab = tabFromPath();
      showApp();
      return;
    }
    var session = await api('staff-session');
    if (!session) return;
    state.staff = session.staff;
    state.team = session.team || [];
    if (session.staff.status === 'pending') { showWaiting(session.staff.email); return; }
    state.tab = tabFromPath();
    if (state.tab === 'access' && state.staff.role !== 'owner') state.tab = 'today';
    showApp();
  }

  async function render() {
    var main = $('#main');
    main.innerHTML = '<p class="muted small">Loading…</p>';
    if (state.tab === 'today') return renderToday(await api('staff-today'));
    if (state.tab === 'leads') return renderLeads(await api('staff-leads' + (state.leadStatus ? '?status=' + state.leadStatus : '')));
    if (state.tab === 'whatsapp') return renderWhatsApp();
    if (state.tab === 'marketing') return renderMarketing(await api('staff-marketing'));
    if (state.tab === 'numbers') return renderNumbers(await api('staff-numbers'));
    if (state.tab === 'access') return renderAccess(await api('staff-access'));
  }

  function renderToday(d) {
    if (!d) return;
    var counts = d.counts || {};
    var leads = d.leads || [];
    var html = '<h2 class="section-title">Today</h2><div class="statgrid">' +
      stat(counts.open || 0, 'Open leads') +
      stat(counts.no_response || 0, 'No first response') +
      stat(counts.over_24h || 0, 'Over 24 hours') +
      stat(counts.due_today || 0, 'Actions due today') +
      '</div>';
    html += '<h3 class="section-title" style="font-size:1.15rem;margin-top:16px">Open leads</h3><div class="stack">';
    if (!leads.length) html += '<div class="card empty">No open leads. A quiet list.</div>';
    leads.forEach(function (l) {
      var cls = l.over_24h ? 'card hot' : (l.no_response ? 'card warn' : 'card');
      var flags = '';
      if (l.over_24h) flags += '<span class="pill bad">Over 24 hours</span> ';
      else if (l.no_response) flags += '<span class="pill warn">No first response</span> ';
      if (l.due_today) flags += '<span class="pill info">Due today</span> ';
      html += '<article class="' + cls + '"><div class="between"><div><h3>' + esc(l.name) + '</h3>' +
        '<p class="small muted" style="margin:4px 0">' + esc(l.product_label || l.product) + ' · ' + esc(l.age || '') +
        (l.owner ? ' · ' + esc(l.owner) : '') + '</p>' + flags + '</div><span class="pill">' + esc(STATUS[l.status] || l.status) + '</span></div>' +
        (l.next_action ? '<p class="small" style="margin:8px 0 0"><strong>Next:</strong> ' + esc(l.next_action) + (l.next_action_at ? ' · ' + esc(fmt(l.next_action_at)) : '') + '</p>' : '') +
        '<div class="row" style="margin-top:10px"><button class="btn btn-bark" type="button" data-go="leads">Work this lead</button></div></article>';
    });
    html += '</div>';

    var apps = d.applications;
    html += '<h3 class="section-title" style="font-size:1.15rem;margin-top:18px">Membership applications</h3>';
    html += '<div class="card"><p style="margin:0"><strong>' + (apps ? apps.pending_review : 0) + '</strong> waiting for a review.</p>' +
      '<p class="small" style="margin:8px 0 0"><a href="/admin/applications">Open applications</a></p></div>';

    if (state.staff.role === 'owner') {
      var reqs = d.access_requests || [];
      html += '<h3 class="section-title" style="font-size:1.15rem;margin-top:18px">Account requests</h3>';
      if (!reqs.length) html += '<div class="card empty">No one is waiting for access.</div>';
      else {
        html += '<div class="stack">';
        reqs.forEach(function (r) {
          html += '<article class="card"><strong>' + esc(r.email) + '</strong><p class="small muted" style="margin:4px 0 0">Asked ' + esc(fmt(r.requested_at) || 'recently') + '</p>' +
            '<button class="btn btn-sage" type="button" data-go="access" style="margin-top:8px">Review in Access</button></article>';
        });
        html += '</div>';
      }
    }

    var wa = d.whatsapp || {};
    html += '<h3 class="section-title" style="font-size:1.15rem;margin-top:18px">WhatsApp</h3><div class="statgrid">' +
      stat(wa.pending_approval || 0, 'To approve') + stat(wa.pending_backlog || 0, 'Backlog decisions') + '</div>';
    html += '<div class="stack" style="margin-top:8px">';
    (wa.queue || []).forEach(function (r) {
      html += '<article class="card"><span class="pill warn">' + esc(r.template_code || r.status) + '</span>' +
        '<p class="small" style="margin:8px 0 0">' + esc((r.rendered_text || '').slice(0, 180)) + '</p></article>';
    });
    (wa.backlog || []).forEach(function (r) {
      html += '<article class="card"><strong>' + esc(r.client_name) + '</strong> <span class="pill">' + esc(r.template_code || '') + '</span>' +
        '<p class="small muted" style="margin:4px 0 0">' + esc(r.trigger_name || '') + (r.company ? ' · ' + esc(r.company) : '') + '</p></article>';
    });
    if (!(wa.queue || []).length && !(wa.backlog || []).length) html += '<div class="card empty">Nothing waiting on WhatsApp.</div>';
    html += '</div><p class="small"><button class="linkish" type="button" data-go="whatsapp">Open WhatsApp</button></p>';

    var m = d.marketing || {};
    html += '<h3 class="section-title" style="font-size:1.15rem">Marketing</h3>';
    if (m.error) html += '<div class="card">' + esc(m.error) + '</div>';
    else if (!(m.edits || []).length) html += '<div class="card">No open edit requests' + (m.range ? ' · ' + esc(m.range) : '') + '.</div>';
    else {
      html += '<div class="stack">';
      m.edits.forEach(function (e) {
        html += '<article class="card warn"><strong>' + esc(e.title || e.post_id) + '</strong>' +
          '<p class="small" style="margin:6px 0 0">' + esc(e.note || 'Edits requested') + '</p>' +
          '<p class="small muted">' + esc(e.reviewer || '') + (e.at ? ' · ' + esc(fmt(e.at)) : '') + '</p></article>';
      });
      html += '</div>';
    }
    html += '<p class="small"><button class="linkish" type="button" data-go="marketing">Open marketing</button></p>';

    html += '<h3 class="section-title" style="font-size:1.15rem">Bookings</h3>';
    if (!d.bookings) html += '<div class="card empty">No booking data yet. Spacebring figures will show here once a snapshot is saved.</div>';
    else html += '<div class="card"><p class="small muted">As at ' + esc(fmt(d.bookings.captured_at)) + '</p><pre class="msg">' + esc(JSON.stringify(d.bookings.data, null, 2)) + '</pre></div>';

    $('#main').innerHTML = html;
    $('#main').onclick = function (ev) {
      var b = ev.target.closest('[data-go]');
      if (b) go(b.getAttribute('data-go'));
    };
  }

  function stat(n, label) {
    return '<div class="stat"><b>' + esc(n) + '</b><span>' + esc(label) + '</span></div>';
  }

  function renderLeads(d) {
    if (!d) return;
    state.team = d.team || state.team;
    var leads = d.leads || [];
    var opts = '<option value="">Open leads</option>' +
      ['new', 'contacted', 'viewing_booked', 'quoted', 'won', 'lost', 'all'].map(function (s) {
        var label = s === 'all' ? 'All' : STATUS[s];
        return '<option value="' + s + '"' + (state.leadStatus === s ? ' selected' : '') + '>' + label + '</option>';
      }).join('');
    var html = '<div class="between"><h2 class="section-title" style="margin:0">Leads</h2><span class="small muted">' + leads.length + '</span></div>';
    if (d.migration === false) html += '<div class="err" style="margin-bottom:10px">Follow-up fields are waiting on the database migration. Status and notes still save.</div>';
    html += '<select class="field" id="leadFilter" style="margin:8px 0 12px">' + opts + '</select><div class="stack" id="leadList">';
    if (!leads.length) html += '<div class="card empty">No leads here.</div>';
    leads.forEach(function (l) { html += leadCard(l); });
    html += '</div>';
    $('#main').innerHTML = html;
    $('#leadFilter').onchange = function () { state.leadStatus = $('#leadFilter').value; render(); };
    $('#leadList').onclick = onLeadClick;
    $('#leadList').onchange = onLeadChange;
  }

  function leadCard(l) {
    var name = [l.first_name, l.last_name].filter(Boolean).join(' ') || l.email || l.phone || 'Lead';
    var age = Math.round((Date.now() - new Date(l.created_at)) / 3600000);
    var ageTxt = age < 1 ? 'under an hour' : (age < 48 ? age + ' h' : Math.round(age / 24) + ' d');
    var silent = !l.first_response_at && ['new', 'contacted', 'viewing_booked', 'quoted'].indexOf(l.status) >= 0;
    var cls = silent && age >= 24 ? 'card hot' : (silent ? 'card warn' : 'card');
    var flags = '';
    if (silent && age >= 24) flags = '<span class="pill bad">Over 24 hours</span>';
    else if (silent) flags = '<span class="pill warn">No first response</span>';
    var wa = waLink(l.phone);
    var owners = '<option value="">Unassigned</option>' + (state.team || []).map(function (p) {
      var label = p.full_name || p.email;
      return '<option value="' + esc(p.email) + '"' + (l.owner === p.email ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    if (l.owner && !(state.team || []).some(function (p) { return p.email === l.owner; })) {
      owners += '<option value="' + esc(l.owner) + '" selected>' + esc(l.owner) + '</option>';
    }
    var channel = { call: 'Called', whatsapp: 'WhatsApped', email: 'Emailed' }[l.last_contact_channel];
    var contactLine = l.last_contacted_at ? '<p class="small muted" style="margin:6px 0 0">' + esc(channel || 'Contacted') + ' · ' + esc(fmt(l.last_contacted_at)) + '</p>' : '';
    var btns = STATUS_BTNS.map(function (s) {
      return '<button class="btn ' + (l.status === s ? 'btn-bark' : 'btn-ghost') + '" type="button" data-status="' + s + '" data-id="' + l.id + '">' + STATUS[s] + '</button>';
    }).join('');
    return '<article class="' + cls + '" id="lead-' + l.id + '">' +
      '<div class="between"><div><h3>' + esc(name) + (l.company ? ' <span class="muted" style="font-weight:500">· ' + esc(l.company) + '</span>' : '') + '</h3>' +
      '<p class="small muted" style="margin:4px 0">' + esc(l.product || '') + ' · ' + esc(ageTxt) + ' · ' + esc(STATUS[l.status] || l.status) + '</p>' + flags + contactLine + '</div></div>' +
      '<div class="row" style="margin-top:8px">' +
        (l.phone ? '<a class="btn btn-ghost" href="tel:' + esc(l.phone) + '">Call</a>' : '') +
        (wa ? '<a class="btn btn-ghost" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
        (l.email ? '<a class="btn btn-ghost" href="mailto:' + esc(l.email) + '">Email</a>' : '') +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
        '<button class="btn btn-sage" type="button" data-contact="call" data-id="' + l.id + '">Called</button>' +
        '<button class="btn btn-sage" type="button" data-contact="whatsapp" data-id="' + l.id + '">WhatsApped</button>' +
        '<button class="btn btn-sage" type="button" data-contact="email" data-id="' + l.id + '">Emailed</button>' +
      '</div>' +
      (l.message ? '<details class="small" style="margin-top:8px"><summary>Message</summary><p class="msg">' + esc(l.message) + '</p></details>' : '') +
      (l.notes ? '<p class="note">' + esc(l.notes) + '</p>' : '') +
      '<label class="small" style="display:block;margin-top:10px;font-weight:700">Owner</label>' +
      '<select class="field" data-owner="' + l.id + '">' + owners + '</select>' +
      '<label class="small" style="display:block;margin-top:10px;font-weight:700">Next action</label>' +
      '<input class="field" data-next="' + l.id + '" placeholder="What happens next" value="' + esc(l.next_action || '') + '">' +
      '<input class="field" style="margin-top:6px" type="datetime-local" data-next-at="' + l.id + '" value="' + esc(sastInput(l.next_action_at)) + '">' +
      '<button class="btn btn-ghost" type="button" data-save-next="' + l.id + '" style="margin-top:6px">Save next action</button>' +
      '<div class="row" style="margin-top:10px">' + btns + '</div>' +
      '<div class="more" id="more-' + l.id + '" hidden></div>' +
      '<div class="row" style="margin-top:8px"><input class="field" style="flex:1" placeholder="Add a note" data-note="' + l.id + '"><button class="btn btn-ghost" type="button" data-save-note="' + l.id + '">Save</button></div>' +
      '</article>';
  }

  async function patchLead(id, payload) {
    var data = await api('staff-leads', { method: 'POST', body: JSON.stringify(Object.assign({ id: id }, payload)) });
    if (data) render();
  }

  function onLeadChange(ev) {
    var sel = ev.target.closest('[data-owner]');
    if (!sel) return;
    patchLead(sel.getAttribute('data-owner'), { owner: sel.value || null }).catch(function (e) { alert(e.message); });
  }

  function onLeadClick(ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var id = b.getAttribute('data-id') || b.getAttribute('data-save-next') || b.getAttribute('data-save-note') || b.getAttribute('data-confirm');
    if (b.hasAttribute('data-contact')) {
      b.disabled = true;
      patchLead(b.getAttribute('data-id'), { contact: b.getAttribute('data-contact') }).catch(function (e) { alert(e.message); b.disabled = false; });
      return;
    }
    if (b.hasAttribute('data-status')) {
      var s = b.getAttribute('data-status');
      var box = document.getElementById('more-' + id);
      if (s === 'won') {
        box.hidden = false;
        box.innerHTML = '<input class="field" data-won placeholder="Monthly or booking value in rand (optional)"><button class="btn btn-bark" type="button" data-confirm="' + id + '" data-kind="won" style="margin-top:6px">Mark won</button>';
        return;
      }
      if (s === 'lost') {
        box.hidden = false;
        box.innerHTML = '<input class="field" data-why placeholder="Why was it lost? (optional)"><button class="btn btn-danger" type="button" data-confirm="' + id + '" data-kind="lost" style="margin-top:6px">Mark lost</button>';
        return;
      }
      b.disabled = true;
      patchLead(id, { status: s }).catch(function (e) { alert(e.message); b.disabled = false; });
      return;
    }
    if (b.hasAttribute('data-confirm')) {
      var kind = b.getAttribute('data-kind');
      var article = document.getElementById('lead-' + id);
      var payload = { status: kind };
      if (kind === 'won') {
        var v = article.querySelector('[data-won]').value.replace(/[^\d.]/g, '');
        if (v) payload.won_value_zar = v;
      } else {
        var why = article.querySelector('[data-why]').value.trim();
        if (why) payload.lost_reason = why;
      }
      b.disabled = true;
      patchLead(id, payload).catch(function (e) { alert(e.message); b.disabled = false; });
      return;
    }
    if (b.hasAttribute('data-save-next')) {
      var article2 = document.getElementById('lead-' + id);
      patchLead(id, {
        next_action: article2.querySelector('[data-next]').value.trim(),
        next_action_at: fromSast(article2.querySelector('[data-next-at]').value)
      }).catch(function (e) { alert(e.message); });
      return;
    }
    if (b.hasAttribute('data-save-note')) {
      var input = document.querySelector('[data-note="' + id + '"]');
      if (!input.value.trim()) return;
      b.disabled = true;
      patchLead(id, { note: input.value.trim() }).catch(function (e) { alert(e.message); b.disabled = false; });
    }
  }

  async function renderWhatsApp() {
    var html = '<h2 class="section-title">WhatsApp</h2><div class="subtabs">' +
      ['queue', 'backlog', 'inbox'].map(function (id) {
        var label = { queue: 'Approve', backlog: 'Backlog', inbox: 'Inbox' }[id];
        return '<button class="btn ' + (state.wa === id ? 'btn-bark' : 'btn-ghost') + '" type="button" data-wa="' + id + '">' + label + '</button>';
      }).join('') + '</div><div id="waBody"><p class="small muted">Loading…</p></div>';
    $('#main').innerHTML = html;
    $('#main').querySelector('.subtabs').onclick = function (ev) {
      var b = ev.target.closest('[data-wa]');
      if (!b) return;
      state.wa = b.getAttribute('data-wa');
      state.thread = null;
      renderWhatsApp();
    };
    try {
      if (state.wa === 'queue') await renderQueue(await api('staff-whatsapp?section=queue'));
      else if (state.wa === 'backlog') await renderBacklog(await api('staff-whatsapp?section=backlog'));
      else await renderInbox();
    } catch (err) {
      $('#waBody').innerHTML = '<div class="err">' + esc(err.message || 'WhatsApp could not be loaded.') + '</div>';
    }
  }

  function renderQueue(d) {
    if (!d) return;
    var rows = d.queue || [];
    var pending = rows.filter(function (r) { return r.status === 'pending_approval' || r.status === 'draft'; });
    var done = rows.filter(function (r) { return pending.indexOf(r) < 0; }).slice(0, 15);
    var counts = d.counts || {};
    var html = '<div class="statgrid">' + stat(counts.pending_approval || 0, 'Pending') + stat(counts.approved || 0, 'Approved, not sent') + stat(counts.skipped || 0, 'Skipped') + '</div>';
    html += '<p class="small muted">Approving records who signed it. It does not send the message.</p><div class="stack" style="margin-top:8px">';
    if (!pending.length) html += '<div class="card empty">Nothing is waiting for approval.</div>';
    pending.forEach(function (r) { html += queueCard(r, true); });
    if (done.length) {
      html += '<h3 class="section-title" style="font-size:1.05rem">Already reviewed</h3>';
      done.forEach(function (r) { html += queueCard(r, false); });
    }
    html += '</div>';
    $('#waBody').innerHTML = html;
    $('#waBody').onclick = onQueueClick;
  }

  function queueCard(r, canAct) {
    var who = r.contact ? [r.contact.first_name, r.contact.phone_e164].filter(Boolean).join(' · ') : 'No contact on this row';
    var statusLabel = { pending_approval: 'Pending', draft: 'Draft', approved: 'Approved', skipped: 'Skipped' }[r.status] || r.status;
    var actions = canAct
      ? '<div class="row" style="margin-top:8px"><button class="btn btn-sage" type="button" data-q="approve" data-id="' + r.id + '">Approve</button>' +
        '<button class="btn btn-bark" type="button" data-q="edit" data-id="' + r.id + '">Edit</button>' +
        '<button class="btn btn-danger" type="button" data-q="skip" data-id="' + r.id + '">Skip</button></div>' +
        '<div id="edit-' + r.id + '" hidden><textarea class="field" id="text-' + r.id + '" rows="5" style="margin-top:8px">' + esc(r.rendered_text) + '</textarea>' +
        '<button class="btn btn-sage" type="button" data-q="save-edit" data-id="' + r.id + '" style="margin-top:6px">Save and approve</button></div>' +
        '<div id="skip-' + r.id + '" hidden><input class="field" id="reason-' + r.id + '" placeholder="Why skip this? (optional)" style="margin-top:8px">' +
        '<button class="btn btn-danger" type="button" data-q="confirm-skip" data-id="' + r.id + '" style="margin-top:6px">Confirm skip</button></div>'
      : '<p class="small muted">' + esc(statusLabel) + (r.approved_by ? ' · ' + esc(r.approved_by) : '') + (r.approved_at ? ' · ' + esc(fmt(r.approved_at)) : '') + '</p>';
    return '<article class="card"><div class="row"><span class="pill">' + esc(r.template_code || r.kind || '') + '</span><span class="pill ' + (canAct ? 'warn' : 'ok') + '">' + esc(statusLabel) + '</span></div>' +
      '<p class="small muted">' + esc(who) + ' · ' + esc(fmt(r.created_at)) + '</p><div class="msg">' + esc(r.rendered_text) + '</div>' + actions + '</article>';
  }

  async function onQueueClick(ev) {
    var b = ev.target.closest('[data-q]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var act = b.getAttribute('data-q');
    if (act === 'edit') { document.getElementById('edit-' + id).hidden = false; return; }
    if (act === 'skip') { document.getElementById('skip-' + id).hidden = false; return; }
    var payload = { section: 'queue', id: id, action: act === 'save-edit' ? 'edit' : act === 'confirm-skip' ? 'skip' : act };
    if (act === 'save-edit') payload.rendered_text = document.getElementById('text-' + id).value;
    if (act === 'confirm-skip') payload.reason = document.getElementById('reason-' + id).value;
    b.disabled = true;
    try { await api('staff-whatsapp', { method: 'POST', body: JSON.stringify(payload) }); renderWhatsApp(); }
    catch (e) { alert(e.message); b.disabled = false; }
  }

  function renderBacklog(d) {
    if (!d) return;
    var rows = (d.rows || []).filter(function (r) { return r.status === 'pending'; });
    var html = '<p class="small muted">Approve queues it for Hub Desk. Nothing is sent from here.</p><div class="stack">';
    if (!rows.length) html += '<div class="card empty">No backlog rows are waiting.</div>';
    rows.forEach(function (r) {
      html += '<article class="card"><h3>' + esc(r.client_name) + '</h3><p class="small muted">#' + esc(r.row_no) + ' · ' + esc(r.template_code || '') + ' · ' + esc(r.priority || '') + '</p>' +
        (r.company ? '<p class="small">' + esc(r.company) + '</p>' : '') +
        '<p class="small"><strong>Why now:</strong> ' + esc(r.why_now || '') + '</p><div class="msg">' + esc(r.proposed_message || '') + '</div>' +
        '<div class="row" style="margin-top:8px"><button class="btn btn-sage" type="button" data-b="approve" data-id="' + r.id + '">Approve</button>' +
        '<button class="btn btn-danger" type="button" data-b="decline" data-id="' + r.id + '">Decline</button>' +
        '<button class="btn btn-bark" type="button" data-b="toggle" data-id="' + r.id + '">Change</button></div>' +
        '<div id="chg-' + r.id + '" hidden><textarea class="field" id="chgtext-' + r.id + '" rows="3" placeholder="What should change?" style="margin-top:8px"></textarea>' +
        '<button class="btn btn-bark" type="button" data-b="change" data-id="' + r.id + '" style="margin-top:6px">Send change request</button></div></article>';
    });
    html += '</div>';
    $('#waBody').innerHTML = html;
    $('#waBody').onclick = async function (ev) {
      var b = ev.target.closest('[data-b]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var act = b.getAttribute('data-b');
      if (act === 'toggle') { document.getElementById('chg-' + id).hidden = false; return; }
      var note = act === 'change' ? document.getElementById('chgtext-' + id).value.trim() : null;
      if (act === 'change' && !note) { alert('Type what should change first.'); return; }
      b.disabled = true;
      try {
        await api('staff-whatsapp', { method: 'POST', body: JSON.stringify({ section: 'backlog', id: id, action: act, note: note }) });
        renderWhatsApp();
      } catch (e) { alert(e.message); b.disabled = false; }
    };
  }

  async function renderInbox() {
    if (state.thread) {
      var t = await api('staff-whatsapp?section=thread&id=' + encodeURIComponent(state.thread));
      if (!t) return;
      var msgs = (t.messages || []).map(function (m) {
        return '<div class="bubble ' + (m.direction === 'out' ? 'out' : 'in') + '">' + esc(m.body || ('[' + (m.msg_type || 'message') + ']')) +
          '<div class="small muted">' + esc(fmt(m.created_at)) + (m.sent_by_email ? ' · ' + esc(m.sent_by_email) : '') + '</div></div>';
      }).join('');
      var name = t.contact ? [t.contact.first_name, t.contact.last_name].filter(Boolean).join(' ') : 'Conversation';
      var box = t.opted_out
        ? '<p class="err">This contact opted out. Nothing can be sent.</p>'
        : (t.window_open
          ? '<textarea class="field" id="reply" rows="3" placeholder="Reply in the 24-hour window"></textarea><button class="btn btn-sage" id="sendReply" type="button" style="margin-top:8px">Send</button>'
          : '<p class="small">The 24-hour window is closed. A free-form reply will not send. Pick an approved template on the old inbox if you need one, or wait for them to message again.</p>');
      $('#waBody').innerHTML = '<button class="linkish" type="button" id="backThreads">All conversations</button><h3>' + esc(name) + '</h3>' +
        '<div class="thread">' + (msgs || '<p class="muted small">No messages yet.</p>') + '</div>' + box;
      var back = $('#backThreads');
      if (back) back.onclick = function () { state.thread = null; renderWhatsApp(); };
      var send = $('#sendReply');
      if (send) send.onclick = async function () {
        var text = $('#reply').value.trim();
        if (!text) return;
        send.disabled = true;
        try {
          await api('staff-whatsapp', { method: 'POST', body: JSON.stringify({
            section: 'send', conversation_id: state.thread, text: text, human_confirmed: true, client_ref: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
          }) });
          renderWhatsApp();
        } catch (e) { alert(e.message); send.disabled = false; }
      };
      return;
    }
    var data = await api('staff-whatsapp?section=inbox');
    if (!data) return;
    var threads = data.threads || [];
    var html = '<div class="stack">';
    if (!threads.length) html += '<div class="card empty">No WhatsApp conversations yet.</div>';
    threads.slice(0, 40).forEach(function (t) {
      var name = t.contact ? [t.contact.first_name, t.contact.last_name].filter(Boolean).join(' ') : (t.profile_name || 'Unknown');
      html += '<button class="card" type="button" data-thread="' + t.id + '" style="text-align:left"><strong>' + esc(name) + '</strong>' +
        (t.unread_count ? ' <span class="pill bad">' + t.unread_count + '</span>' : '') +
        '<p class="small muted" style="margin:4px 0 0">' + esc(t.last_message_preview || '') + '</p>' +
        '<p class="small muted">' + (t.window_open ? 'Window open' : 'Window closed') + ' · ' + esc(fmt(t.last_message_at)) + '</p></button>';
    });
    html += '</div>';
    $('#waBody').innerHTML = html;
    $('#waBody').onclick = function (ev) {
      var b = ev.target.closest('[data-thread]');
      if (!b) return;
      state.thread = b.getAttribute('data-thread');
      renderWhatsApp();
    };
  }

  function renderMarketing(d) {
    if (!d) return;
    if (!d.plan) {
      $('#main').innerHTML = '<h2 class="section-title">Marketing</h2><div class="err">' + esc(d.error || 'No plan yet.') + '</div>';
      return;
    }
    var plan = d.plan;
    var latest = d.latest || {};
    var html = '<h2 class="section-title">This week</h2><p class="small muted" style="margin-top:0">' + esc(plan.range || plan.week || '') + '. A new Monday pack shows up here on its own.</p>';
    html += '<div class="card">';
    (plan.days || []).forEach(function (day) {
      html += '<div class="day"><div><div class="dow">' + esc(day.dow) + '</div><div class="small">' + esc(day.date) + '</div></div><div>' +
        (day.note ? '<div class="small muted">' + esc(day.note) + '</div>' : '') +
        (day.items || []).map(function (item) { return '<p style="margin:4px 0">' + esc(item) + '</p>'; }).join('') +
        (!(day.items || []).length ? '<p class="small muted">Nothing scheduled.</p>' : '') +
        '</div></div>';
    });
    html += '</div><h2 class="section-title">Posts</h2><div class="stack">';
    (plan.posts || []).forEach(function (p) {
      var rev = latest[p.id];
      var pill = !rev ? '<span class="pill">Not reviewed</span>' : (rev.status === 'approved' ? '<span class="pill ok">Approved</span>' : '<span class="pill warn">Edits requested</span>');
      html += '<article class="card" id="post-' + esc(p.id) + '"><div class="between"><h3>' + esc(p.title) + '</h3>' + pill + '</div>';
      if (p.asset) html += '<p class="small muted">' + esc(p.asset) + '</p>';
      if (rev && rev.note) html += '<p class="note">' + esc(rev.reviewer_email || rev.reviewer) + ': ' + esc(rev.note) + '</p>';
      (p.captions || []).forEach(function (c) {
        html += '<div class="cap"><header><span>' + esc(c.label || c.platform) + '</span><button class="btn btn-ghost" type="button" data-copy="' + esc(p.id) + ':' + esc(c.platform) + '">Copy</button></header><pre id="cap-' + esc(p.id) + '-' + esc(c.platform) + '">' + esc(c.text) + '</pre></div>';
      });
      if ((p.mockups || []).length) {
        html += '<div class="mock">';
        p.mockups.forEach(function (m) {
          html += '<div><div class="small" style="font-weight:700;margin-bottom:4px">' + esc(m.label) + '</div>' +
            (m.src ? '<a href="' + esc(m.src) + '" target="_blank" rel="noopener"><img src="' + esc(m.src) + '" alt="' + esc(m.alt || '') + '"></a>' : '') +
            (m.drive ? '<a class="small" href="' + esc(m.drive) + '" target="_blank" rel="noopener">Open in Drive</a>' : '') +
            '</div>';
        });
        html += '</div>';
      }
      html += '<label class="small" style="display:block;margin-top:10px;font-weight:700">Edits or a note</label>' +
        '<textarea class="field" rows="3" data-note="' + esc(p.id) + '" placeholder="What should change, if anything"></textarea>' +
        '<div class="row" style="margin-top:8px"><button class="btn btn-sage" type="button" data-review="approved" data-post="' + esc(p.id) + '" data-week="' + esc(plan.week) + '">Approve</button>' +
        '<button class="btn btn-bark" type="button" data-review="edits_requested" data-post="' + esc(p.id) + '" data-week="' + esc(plan.week) + '">Request edits</button></div></article>';
    });
    html += '</div>';
    $('#main').innerHTML = html;
    $('#main').onclick = async function (ev) {
      var copy = ev.target.closest('[data-copy]');
      if (copy) {
        var bits = copy.getAttribute('data-copy').split(':');
        var pre = document.getElementById('cap-' + bits[0] + '-' + bits[1]);
        try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select the text'; }
        return;
      }
      var b = ev.target.closest('[data-review]');
      if (!b) return;
      var post = b.getAttribute('data-post');
      var note = document.querySelector('[data-note="' + post + '"]').value.trim();
      var status = b.getAttribute('data-review');
      if (status === 'edits_requested' && !note) { alert('Say what should change.'); return; }
      b.disabled = true;
      try {
        await api('staff-marketing', { method: 'POST', body: JSON.stringify({ week_id: b.getAttribute('data-week'), post_id: post, status: status, note: note }) });
        render();
      } catch (e) { alert(e.message); b.disabled = false; }
    };
  }

  function renderNumbers(d) {
    if (!d) return;
    var L = d.leads || {};
    var fr = L.first_response || {};
    var conv = L.conversion || {};
    var html = '<h2 class="section-title">Numbers</h2><p class="small muted" style="margin-top:0">From the database. Nothing on this page is estimated.</p>';
    html += '<div class="statgrid">' +
      stat(L.open || 0, 'Open leads') +
      stat(L.unanswered_over_24h || 0, 'Unanswered over 24h') +
      stat(conv.rate === null || conv.rate === undefined ? '—' : conv.rate + '%', 'Won / total') +
      stat(minsLabel(fr.median_minutes).replace('No first response recorded yet', '—'), 'Median first response') +
      '</div>';
    html += '<div class="card" style="margin-top:10px"><p style="margin:0"><strong>Average first response:</strong> ' + esc(minsLabel(fr.average_minutes)) + '</p>' +
      '<p class="small muted">Median is ' + esc(minsLabel(fr.median_minutes)) + '. ' + (fr.responded || 0) + ' leads have a first response. Conversion is ' +
      (conv.won || 0) + ' won out of ' + (conv.total || 0) + ' leads.</p></div>';
    html += bars('Leads by status', L.by_status, STATUS);
    html += barsList('Leads by source', (L.by_source || []).map(function (r) { return { label: SOURCE[r.key] || r.label || r.key, count: r.count }; }));
    html += barsList('Leads by product', (L.by_product || []).map(function (r) { return { label: r.label || r.key, count: r.count }; }));

    html += '<h3 class="section-title" style="font-size:1.15rem">Applications</h3>';
    if (!d.applications) html += '<div class="card empty">Application numbers could not be loaded.</div>';
    else {
      html += '<div class="card"><p style="margin:0">' + (d.applications.pending_review || 0) + ' pending review · ' + (d.applications.activated || 0) + ' activated · ' +
        (d.applications.last_7_days || 0) + ' in the last 7 days.</p></div>';
      html += bars('Funnel', d.applications.by_status, APP_STATUS);
    }

    var q = (d.whatsapp && d.whatsapp.queue) || {};
    html += '<h3 class="section-title" style="font-size:1.15rem">WhatsApp queue</h3><div class="card">';
    var qKeys = Object.keys(q);
    if (!qKeys.length) html += '<p class="empty" style="margin:0">No queue rows.</p>';
    else qKeys.forEach(function (k) { html += '<p style="margin:4px 0"><strong>' + q[k] + '</strong> ' + esc(k.replace(/_/g, ' ')) + '</p>'; });
    html += '</div>';

    var mk = d.marketing || {};
    html += '<h3 class="section-title" style="font-size:1.15rem">Marketing reviews</h3><div class="statgrid">' +
      stat(mk.approved || 0, 'Approvals') + stat(mk.edits_requested || 0, 'Edit requests') + stat(mk.open_edit_requests || 0, 'Still open') + '</div>';

    html += '<h3 class="section-title" style="font-size:1.15rem">Bookings</h3>';
    if (!d.bookings) html += '<div class="card empty">No booking data yet.</div>';
    else html += '<div class="card"><p class="small muted">As at ' + esc(fmt(d.bookings.captured_at)) + '</p></div>';

    var links = d.links || {};
    html += '<h3 class="section-title" style="font-size:1.15rem">Dashboards</h3><div class="stack">' +
      linkCard(links.ads, 'Google Ads') + linkCard(links.search_console, 'Search Console') + linkCard(links.business_profile, 'Business Profile') +
      '</div>';
    $('#main').innerHTML = html;
  }

  function bars(title, map, labels) {
    map = map || {};
    var keys = Object.keys(labels || map);
    var rows = keys.map(function (k) { return { label: (labels && labels[k]) || k, count: map[k] || 0 }; }).filter(function (r) { return r.count || (labels && labels); });
    return barsList(title, rows.length ? rows : []);
  }
  function barsList(title, rows) {
    var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.count; })));
    var html = '<h3 class="section-title" style="font-size:1.15rem">' + esc(title) + '</h3><div class="card">';
    if (!rows.length) html += '<p class="empty" style="margin:0">No rows yet.</p>';
    rows.forEach(function (r) {
      html += '<div class="between" style="margin-top:8px"><span class="small">' + esc(r.label) + '</span><strong>' + r.count + '</strong></div>' +
        '<div class="bar"><span style="width:' + Math.round(100 * r.count / max) + '%"></span></div>';
    });
    return html + '</div>';
  }
  function linkCard(href, label) {
    if (!href) return '';
    return '<a class="card" href="' + esc(href) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><strong>' + esc(label) + '</strong><div class="small muted">Open</div></a>';
  }

  function renderAccess(d) {
    if (!d) return;
    var people = d.people || [];
    var pending = people.filter(function (p) { return p.status === 'pending'; });
    var approved = people.filter(function (p) { return p.status === 'approved'; });
    var revoked = people.filter(function (p) { return p.status === 'revoked'; });
    var html = '<h2 class="section-title">Access</h2><p class="small muted">You are the only person who can approve. Approving emails them.</p>';
    html += '<h3 class="section-title" style="font-size:1.1rem">Waiting</h3><div class="stack">';
    if (!pending.length) html += '<div class="card empty">No one is waiting.</div>';
    pending.forEach(function (p) { html += personCard(p, 'pending'); });
    html += '</div><h3 class="section-title" style="font-size:1.1rem">Approved</h3><div class="stack">';
    approved.forEach(function (p) { html += personCard(p, 'approved'); });
    html += '</div>';
    if (revoked.length) {
      html += '<h3 class="section-title" style="font-size:1.1rem">Revoked</h3><div class="stack">';
      revoked.forEach(function (p) { html += personCard(p, 'revoked'); });
      html += '</div>';
    }
    $('#main').innerHTML = html;
    $('#main').onclick = async function (ev) {
      var b = ev.target.closest('[data-act]');
      if (!b) return;
      var email = b.getAttribute('data-email');
      var action = b.getAttribute('data-act');
      var roleSel = document.querySelector('[data-role="' + email + '"]');
      b.disabled = true;
      try {
        await api('staff-access', { method: 'POST', body: JSON.stringify({ email: email, action: action, role: roleSel ? roleSel.value : 'admin' }) });
        render();
      } catch (e) { alert(e.message); b.disabled = false; }
    };
  }

  function personCard(p, mode) {
    var role = p.role === 'owner' ? 'Owner' : (p.role === 'reviewer' ? 'Reviewer' : 'Admin');
    var controls = '';
    if (p.email === 'marius@brick-field.co.za') controls = '<p class="small muted">Owner. This account stays approved.</p>';
    else if (mode === 'pending' || mode === 'revoked') {
      var label = mode === 'revoked' ? 'Restore access and email them' : 'Approve and email them';
      controls = '<label class="small">Role</label><select class="field" data-role="' + esc(p.email) + '"><option value="admin"' + (p.role !== 'reviewer' ? ' selected' : '') + '>Admin</option><option value="reviewer"' + (p.role === 'reviewer' ? ' selected' : '') + '>Reviewer</option></select>' +
        '<button class="btn btn-sage" type="button" data-act="approve" data-email="' + esc(p.email) + '" style="margin-top:8px">' + label + '</button>';
    } else if (mode === 'approved') {
      controls = '<button class="btn btn-danger" type="button" data-act="revoke" data-email="' + esc(p.email) + '">Revoke</button>';
    }
    return '<article class="card"><strong>' + esc(p.full_name || p.email) + '</strong><p class="small muted" style="margin:4px 0">' + esc(p.email) + ' · ' + role + ' · ' + esc(p.status) + '</p>' +
      (p.requested_at ? '<p class="small muted">Asked ' + esc(fmt(p.requested_at)) + '</p>' : '') + controls + '</article>';
  }

  $('#sendLink').onclick = async function () {
    var email = $('#loginEmail').value.trim();
    var msg = $('#loginMsg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.className = 'small err'; msg.textContent = 'That email does not look right.'; return; }
    $('#sendLink').disabled = true;
    msg.className = 'small muted'; msg.textContent = 'Sending…';
    try {
      var data = await Auth.requestCode(email);
      pendingEmail = email;
      $('#step-email').hidden = true;
      $('#step-code').hidden = false;
      msg.className = 'small muted';
      msg.textContent = data && data.access === 'pending'
        ? 'Code sent. You can sign in, and you will see a waiting screen until Marius approves you.'
        : 'Code sent to ' + email + '. It is a number.';
      $('#loginCode').focus();
    } catch (e) {
      msg.className = 'small err';
      msg.textContent = e.message || 'Could not send that code.';
    } finally { $('#sendLink').disabled = false; }
  };
  async function verify() {
    var code = ($('#loginCode').value || '').replace(/\s/g, '');
    var msg = $('#loginMsg');
    if (!/^\d{6,8}$/.test(code)) { msg.className = 'small err'; msg.textContent = 'Enter the code from the email.'; return; }
    $('#verifyCode').disabled = true;
    try {
      await Auth.verifyCode(pendingEmail, code);
      msg.textContent = '';
      boot();
    } catch (e) {
      msg.className = 'small err';
      msg.textContent = (e.message || 'That code did not work') + '. Check it, or resend.';
    } finally { $('#verifyCode').disabled = false; }
  }
  $('#verifyCode').onclick = verify;
  $('#loginCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
  $('#resend').onclick = function () { $('#step-code').hidden = true; $('#step-email').hidden = false; $('#loginCode').value = ''; $('#loginMsg').textContent = ''; };
  $('#signout').onclick = function () { Auth.signOut(); location.href = '/admin'; };
  $('#waitOut').onclick = function () { Auth.signOut(); location.href = '/admin'; };
  $('#tabs').onclick = function (ev) {
    var b = ev.target.closest('[data-tab]');
    if (b) go(b.getAttribute('data-tab'));
  };
  window.addEventListener('popstate', function () { state.tab = tabFromPath(); if (state.staff && state.staff.status === 'approved') showApp(); });

  if (DEMO || Auth.hasSession()) boot();
})();
