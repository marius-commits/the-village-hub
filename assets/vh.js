/* ==========================================================================
   The Village Hub - shared interaction layer
   Loads after the DOM. Progressive: every feature is optional and no-JS safe.
   ========================================================================== */
(function () {
  'use strict';
  var d = document, w = window;
  var reduced = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = w.matchMedia && w.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var WA = 'https://wa.me/27725310904';
  var SB = 'https://members.villagehub.co.za/suite/organizations/e54f9f0c-df10-4943-aadc-fd378c74bd11';
  var path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';

  function $(s, c) { return (c || d).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); }
  function el(tag, cls, html) { var e = d.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function wa(text) { return WA + '?text=' + encodeURIComponent(text); }
  function R(n) { return 'R' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  /* ---------- NAV + FOOTER ---------- */
  var NAV_LINKS = [
    ['/#spaces', 'Spaces', '/'],
    ['/virtual-office-stellenbosch', 'Virtual Office', '/virtual-office-stellenbosch'],
    ['/student-study-space-stellenbosch', 'Students', '/student-study-space-stellenbosch'],
    ['/pricing', 'Pricing', '/pricing'],
    ['/accommodation', 'Stay', '/accommodation'],
    ['/#reviews', 'Reviews', null],
    ['/#contact', 'Contact', null]
  ];
  function navHTML() {
    var links = NAV_LINKS.map(function (l) {
      var cur = l[2] && l[2] === path ? ' aria-current="page"' : '';
      return '<a class="vh-nav__link" href="' + l[0] + '"' + cur + '>' + l[1] + '</a>';
    }).join('');
    var mobile = [
      ['/#spaces', 'Spaces'], ['/virtual-office-stellenbosch', 'Virtual Office <span class="vh-tag vh-tag--sage">New</span>'],
      ['/student-study-space-stellenbosch', 'Students <span class="vh-tag vh-tag--gold">Exam Pass</span>'], ['/pricing', 'All pricing'],
      ['/accommodation', 'Village Stay'], ['/#reviews', 'Reviews'], ['/#faq', 'FAQ'], ['/#contact', 'Contact']
    ].map(function (l) { return '<a href="' + l[0] + '">' + l[1] + '</a>'; }).join('');
    return '<header class="vh-nav" id="vh-nav"><nav class="vh-nav__in" aria-label="Main">' +
      '<a class="vh-nav__brand" href="/" aria-label="The Village Hub home"><img src="/images/web/logo.png" alt="The Village Hub logo" width="46" height="46"><span>The Village Hub</span></a>' +
      '<div class="vh-nav__links">' + links + '<a class="btn btn-sage btn-sm" href="' + wa("Hi Village Hub, I'd like to book a tour of the coworking space") + '">Book a Free Tour</a></div>' +
      '<button type="button" class="vh-nav__burger" aria-controls="vh-mobile" aria-expanded="false" aria-label="Menu">' +
      '<svg class="ic-open" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      '<svg class="ic-close" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg></button></nav>' +
      '<div class="vh-nav__mobile" id="vh-mobile">' + mobile + '<div class="vh-nav__mobile-cta"><a class="btn btn-wa btn-sm" href="' + wa("Hi Village Hub, I'd like to book a tour") + '">WhatsApp</a><a class="btn btn-bark btn-sm" href="/pricing#enquire">Enquire</a></div></div></header>';
  }
  function footerHTML() {
    return '<footer class="vh-footer"><div class="vh-footer__in"><div class="vh-footer__grid"><div>' +
      '<a class="vh-footer__brand" href="/"><img src="/images/web/logo-white.png" alt="The Village Hub logo" width="46" height="46" onerror="this.src=\'/images/web/logo.png\'"><span>The Village Hub</span></a>' +
      '<p>Stellenbosch’s premium coworking space at Nooitgedacht Village. Hot desks, private offices, boardrooms, virtual office, student study passes, event space and boutique stays. A Brickfield Spaces location.</p>' +
      '<address>1st Floor, The Foundry, Sauvignon Street<br>Nooitgedacht Village, Stellenbosch 7600<br><a href="tel:+27725310904">+27 72 531 0904</a> · <a href="' + WA + '">WhatsApp</a><br><a href="mailto:info@villagehub.co.za">info@villagehub.co.za</a></address>' +
      '<div class="vh-footer__social"><a href="https://www.facebook.com/profile.php?id=61559197625598" target="_blank" rel="noopener" aria-label="Facebook"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0022 12z"/></svg></a>' +
      '<a href="https://www.instagram.com/thevillagehub_/" target="_blank" rel="noopener" aria-label="Instagram"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg></a>' +
      '<a href="https://www.linkedin.com/company/villagehub-co-working" target="_blank" rel="noopener" aria-label="LinkedIn"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M20.4 2H3.6A1.6 1.6 0 002 3.6v16.8A1.6 1.6 0 003.6 22h16.8a1.6 1.6 0 001.6-1.6V3.6A1.6 1.6 0 0020.4 2zM8 19H5V9h3v10zM6.5 7.7a1.7 1.7 0 110-3.4 1.7 1.7 0 010 3.4zM19 19h-3v-4.9c0-1.2 0-2.7-1.6-2.7s-1.9 1.3-1.9 2.6V19h-3V9h2.9v1.4h.1a3.2 3.2 0 012.8-1.6c3 0 3.6 2 3.6 4.6V19z"/></svg></a></div></div>' +
      '<div class="vh-footer__cols"><div><h3>Workspaces</h3><ul><li><a href="/hot-desk-stellenbosch">Hot desks</a></li><li><a href="/private-offices-stellenbosch">Private offices</a></li><li><a href="/boardroom-hire-stellenbosch">Boardroom hire</a></li><li><a href="/meeting-rooms-stellenbosch">Meeting rooms</a></li><li><a href="/event-space-stellenbosch">Event space</a></li><li><a href="/workshop-training-venue-stellenbosch">Workshop venue</a></li><li><a href="/pricing">All pricing</a></li></ul></div>' +
      '<div><h3>New</h3><ul><li><a href="/virtual-office-stellenbosch">Virtual office</a></li><li><a href="/registered-business-address-stellenbosch">Registered business address</a></li><li><a href="/virtual-office-vs-home-address-stellenbosch">Virtual office vs home address</a></li><li><a href="/student-study-space-stellenbosch">Student study space</a></li><li><a href="/student-study-space-stellenbosch#exam-pass">Exam Pass 2026</a></li><li><a href="/accommodation">The Village Stay</a></li><li><a href="/work-and-stay-stellenbosch">Work and stay</a></li></ul></div>' +
      '<div><h3>Guides</h3><ul><li><a href="/coworking-stellenbosch-guide">Coworking in Stellenbosch</a></li><li><a href="/stellenbosch-coworking-compared">Coworking compared</a></li><li><a href="/coworking-vs-traditional-2">Coworking vs traditional office</a></li><li><a href="/office-space-to-rent-stellenbosch">Office space to rent</a></li><li><a href="/hot-desk-cost-stellenbosch">What a hot desk costs</a></li><li><a href="/boardroom-hire-stellenbosch-guide">Boardroom hire guide</a></li><li><a href="/coworking-with-parking-stellenbosch">Coworking with parking</a></li><li><a href="/nooitgedacht-village-stellenbosch">Nooitgedacht Village</a></li><li><a href="/stellenbosch-tech-hub-2026">Stellenbosch tech hub 2026</a></li></ul></div>' +
      '<div><h3>Visit</h3><ul><li><a href="/#about">About</a></li><li><a href="/#floor">Explore the floor</a></li><li><a href="/#gallery">Gallery</a></li><li><a href="/#reviews">Reviews (5.0 ★)</a></li><li><a href="/#faq">FAQ</a></li><li><a href="/#contact">Contact</a></li><li><a href="https://members.villagehub.co.za/">Member app</a></li></ul><h3>Hours</h3><ul><li>Mon – Fri 06:30 – 18:00</li><li>Sat 08:00 – 14:00</li><li>24/7 for tag-access plans</li></ul></div></div></div>' +
      '<div class="vh-footer__bottom"><p>© <span data-year>2026</span> The Village Hub · Brickfield Spaces (Pty) Ltd · Coworking in Stellenbosch. Hub prices exclude VAT; student prices include VAT.</p><p class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></p></div></div></footer>';
  }
  function mountChrome() {
    var n = $('[data-vh-nav]'); if (n) { n.outerHTML = navHTML(); }
    var f = $('[data-vh-footer]'); if (f) { f.outerHTML = footerHTML(); }
    var nav = $('#vh-nav');
    if (nav) {
      var b = $('.vh-nav__burger', nav);
      b.addEventListener('click', function () { var open = nav.classList.toggle('is-open'); b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      $$('.vh-nav__mobile a', nav).forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('is-open'); b.setAttribute('aria-expanded', 'false'); }); });
      var onS = function () { nav.classList.toggle('is-scrolled', w.scrollY > 20); };
      w.addEventListener('scroll', onS, { passive: true }); onS();
    }
    $$('[data-year]').forEach(function (y) { y.textContent = new Date().getFullYear(); });
    if (!$('.vh-wa') && !d.body.hasAttribute('data-no-wa')) {
      var box = el('div', 'vh-wa');
      box.innerHTML = '<div class="vh-wa__nudge"><button class="vh-wa__close" aria-label="Dismiss">×</button><b>Need help choosing?</b><br>Christel usually replies within the hour on weekdays.</div>' +
        '<a class="vh-wa__btn" href="' + wa("Hi Village Hub, I'd like to book a tour of the coworking space") + '" aria-label="WhatsApp The Village Hub"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg></a>';
      d.body.appendChild(box);
      var dismissed = false; try { dismissed = sessionStorage.getItem('vh-nudge') === '1'; } catch (e) {}
      if (!dismissed) setTimeout(function () { box.classList.add('is-nudging'); }, 14000);
      $('.vh-wa__close', box).addEventListener('click', function () { box.classList.remove('is-nudging'); try { sessionStorage.setItem('vh-nudge', '1'); } catch (e) {} });
    }
    mountPromo();
  }

  /* ---------- founding rate promo banner ----------
     Runs until the sign-up window closes. Remove this block, the CSS in
     vh.css and the PROMO_* constants once the campaign is over. */
  function mountPromo() {
    var PROMO_END  = '2026-12-31T23:59:59+02:00';
    var PROMO_PATH = '/founding-rate';
    var PROMO_KEY  = 'vh-promo-founding';

    if (new Date() > new Date(PROMO_END)) return;
    if (location.pathname.indexOf(PROMO_PATH) === 0) return;
    if (d.body.hasAttribute('data-no-promo')) return;
    if ($('.vh-promo')) return;
    try { if (localStorage.getItem(PROMO_KEY) === '1') return; } catch (e) {}

    var bar = el('div', 'vh-promo');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Founding Rate offer');
    bar.innerHTML =
      '<div class="vh-promo__in">' +
        '<span class="vh-promo__tag">Founding Rate</span>' +
        '<span class="vh-promo__txt"><b>Half price for six months.</b> Your own desk from <i>R1&nbsp;750</i> a month. Fifteen memberships, closing 31 December.</span>' +
        '<a class="vh-promo__cta" href="' + PROMO_PATH + '">See the rates</a>' +
      '</div>' +
      '<button class="vh-promo__x" aria-label="Dismiss this offer">&times;</button>';
    d.body.appendChild(bar);
    d.body.classList.add('vh-promo-on');

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bar.classList.add('is-in'); });
    });

    $('.vh-promo__x', bar).addEventListener('click', function () {
      bar.classList.remove('is-in');
      d.body.classList.remove('vh-promo-on');
      try { localStorage.setItem(PROMO_KEY, '1'); } catch (e) {}
      setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 500);
    });
  }

  /* ---------- page transitions ---------- */
  function transitions() {
    d.body.classList.add('vh-page');
    requestAnimationFrame(function () { requestAnimationFrame(function () { d.body.classList.add('vh-ready'); }); });
    w.addEventListener('pageshow', function (e) { if (e.persisted) d.body.classList.remove('vh-leaving'); });
    if (reduced) return;
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || a.target === '_blank' || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var u; try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (u.origin !== location.origin) return;
      if (u.pathname === location.pathname && u.hash) return;
      e.preventDefault(); d.body.classList.add('vh-leaving');
      setTimeout(function () { location.href = a.href; }, 240);
    });
  }

  /* ---------- scroll progress + glow ---------- */
  function progress() {
    var bar = el('div', 'vh-progress'); d.body.appendChild(bar);
    var upd = function () { var h = d.documentElement.scrollHeight - w.innerHeight; bar.style.width = (h > 0 ? (w.scrollY / h) * 100 : 0) + '%'; };
    w.addEventListener('scroll', upd, { passive: true }); upd();
  }
  function glow() {
    if (!fine || reduced) return;
    var g = el('div', 'vh-glow'); d.body.appendChild(g);
    var x = w.innerWidth / 2, y = w.innerHeight / 2, tx = x, ty = y, on = false;
    d.addEventListener('mousemove', function (e) { tx = e.clientX; ty = e.clientY; if (!on) { on = true; d.body.classList.add('vh-glow-on'); } }, { passive: true });
    d.addEventListener('mouseleave', function () { on = false; d.body.classList.remove('vh-glow-on'); });
    (function loop() { x += (tx - x) * .12; y += (ty - y) * .12; g.style.transform = 'translate(' + x + 'px,' + y + 'px)'; requestAnimationFrame(loop); })();
  }

  /* ---------- anchors with header offset ---------- */
  function anchors() {
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"], a[href^="/#"]'); if (!a) return;
      var href = a.getAttribute('href'); var hash = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : '';
      if (href.charAt(0) === '/' && path !== '/') return;
      if (!hash || hash === '#') return;
      var t = $(hash); if (!t) return;
      e.preventDefault();
      var off = (d.body.getAttribute('data-anchor-offset') | 0) || 96;
      w.scrollTo({ top: t.getBoundingClientRect().top + w.scrollY - off, behavior: reduced ? 'auto' : 'smooth' });
      var nav = $('#vh-nav'); if (nav) nav.classList.remove('is-open');
    });
  }

  /* ---------- reveal / words / counters ---------- */
  function reveal() {
    var els = $$('.reveal, .reveal-stagger, .mask-reveal, .vh-words');
    var cnt = $$('[data-count]');
    if (!('IntersectionObserver' in w) || reduced) { els.forEach(function (e) { e.classList.add('in'); }); cnt.forEach(function (c) { c.textContent = c.getAttribute('data-count'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(function () { els.forEach(function (e) { e.classList.add('in'); }); }, 8000);
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return; io2.unobserve(en.target);
        var c = en.target, end = parseFloat(c.getAttribute('data-count')), dec = (c.getAttribute('data-decimals') | 0), suf = c.getAttribute('data-suffix') || '', pre = c.getAttribute('data-prefix') || '';
        var t0 = null, dur = 1600;
        (function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); p = 1 - Math.pow(1 - p, 3); c.textContent = pre + (end * p).toFixed(dec) + suf; if (p < 1) requestAnimationFrame(step); })(performance.now());
      });
    }, { threshold: 0.5 });
    cnt.forEach(function (c) { io2.observe(c); });
  }
  function words() {
    $$('.vh-words').forEach(function (h) {
      if (h.getAttribute('data-split') === '1') return; h.setAttribute('data-split', '1');
      var html = '';
      Array.prototype.forEach.call(h.childNodes, function (n) {
        if (n.nodeType === 3) { html += n.textContent.split(/(\s+)/).map(function (t) { return /^\s+$/.test(t) ? ' ' : (t ? '<span class="w"><span>' + t + '</span></span>' : ''); }).join(''); }
        else if (n.nodeName === 'BR') html += '<br>';
        else { var inner = n.textContent.split(/(\s+)/).map(function (t) { return /^\s+$/.test(t) ? ' ' : (t ? '<span class="w"><span>' + t + '</span></span>' : ''); }).join(''); var c = n.cloneNode(false); c.innerHTML = inner; html += c.outerHTML; }
      });
      h.innerHTML = html;
      var i = 0; $$('.w > span', h).forEach(function (s) { s.style.transitionDelay = (i++ * 70) + 'ms'; });
    });
  }

  /* ---------- magnetic buttons + tilt + parallax ---------- */
  function magnetic() {
    if (!fine || reduced) return;
    $$('.btn').forEach(function (b) {
      b.addEventListener('mousemove', function (e) {
        var r = b.getBoundingClientRect(); var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%'); b.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
        b.style.transform = 'translate(' + dx * .18 + 'px,' + (dy * .18 - 2) + 'px)';
      });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
    });
  }
  function tilt() {
    if (!fine || reduced) return;
    $$('[data-tilt]').forEach(function (c) {
      if (getComputedStyle(c).position === 'static') c.style.position = 'relative';
      if (!$('.tilt-shine', c)) c.appendChild(el('span', 'tilt-shine'));
      var max = parseFloat(c.getAttribute('data-tilt')) || 6;
      c.addEventListener('mousemove', function (e) {
        var r = c.getBoundingClientRect(); var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        c.classList.add('is-tilting');
        c.style.transform = 'perspective(900px) rotateX(' + ((.5 - py) * max) + 'deg) rotateY(' + ((px - .5) * max) + 'deg) translateY(-4px)';
        c.style.setProperty('--sx', (px * 100) + '%'); c.style.setProperty('--sy', (py * 100) + '%');
      });
      c.addEventListener('mouseleave', function () { c.classList.remove('is-tilting'); c.style.transform = ''; });
    });
  }
  function parallax() {
    var items = $$('[data-parallax]'); if (!items.length || reduced) return;
    var tick = false;
    function upd() {
      tick = false; var vh = w.innerHeight;
      items.forEach(function (it) {
        var r = it.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) return;
        var sp = parseFloat(it.getAttribute('data-parallax')) || .15; var c = (r.top + r.height / 2) - vh / 2;
        it.style.transform = 'translate3d(0,' + (-c * sp) + 'px,0)';
      });
    }
    w.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true }); upd();
  }

  /* ---------- drag scroll ---------- */
  function drag() {
    $$('.vh-drag').forEach(function (s) {
      var down = false, sx = 0, sl = 0, moved = false;
      s.addEventListener('mousedown', function (e) { down = true; moved = false; sx = e.pageX; sl = s.scrollLeft; });
      w.addEventListener('mouseup', function () { down = false; s.classList.remove('is-dragging'); });
      s.addEventListener('mouseleave', function () { down = false; s.classList.remove('is-dragging'); });
      s.addEventListener('mousemove', function (e) { if (!down) return; var dx = e.pageX - sx; if (Math.abs(dx) > 4) { moved = true; s.classList.add('is-dragging'); } s.scrollLeft = sl - dx; });
      s.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
      var prev = $('[data-drag-prev="' + s.id + '"]'), next = $('[data-drag-next="' + s.id + '"]');
      if (prev) prev.addEventListener('click', function () { s.scrollBy({ left: -s.clientWidth * .8, behavior: 'smooth' }); });
      if (next) next.addEventListener('click', function () { s.scrollBy({ left: s.clientWidth * .8, behavior: 'smooth' }); });
    });
  }

  /* ---------- lightbox ---------- */
  function lightbox() {
    var items = $$('[data-lightbox]'); if (!items.length) return;
    var lb = el('div', 'vh-lightbox'); lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = '<button class="vh-lightbox__close" aria-label="Close">&times;</button><button class="vh-lightbox__nav vh-lightbox__prev" aria-label="Previous">&#8249;</button><img alt=""><button class="vh-lightbox__nav vh-lightbox__next" aria-label="Next">&#8250;</button><div class="vh-lightbox__cap"></div>';
    d.body.appendChild(lb);
    var img = $('img', lb), cap = $('.vh-lightbox__cap', lb), i = 0;
    function show(n) { i = (n + items.length) % items.length; var it = items[i]; var im = it.tagName === 'IMG' ? it : $('img', it); img.src = it.getAttribute('data-lightbox') || im.currentSrc || im.src; img.alt = im.alt; cap.textContent = im.alt; }
    function open(n) { show(n); lb.classList.add('is-open'); d.body.style.overflow = 'hidden'; }
    function close() { lb.classList.remove('is-open'); d.body.style.overflow = ''; }
    items.forEach(function (it, n) { it.style.cursor = 'zoom-in'; it.addEventListener('click', function (e) { e.preventDefault(); open(n); }); });
    $('.vh-lightbox__close', lb).addEventListener('click', close);
    $('.vh-lightbox__prev', lb).addEventListener('click', function () { show(i - 1); });
    $('.vh-lightbox__next', lb).addEventListener('click', function () { show(i + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    d.addEventListener('keydown', function (e) { if (!lb.classList.contains('is-open')) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  }

  /* ---------- countdown ---------- */
  function countdown() {
    $$('[data-countdown]').forEach(function (c) {
      var t = new Date(c.getAttribute('data-countdown')).getTime(); if (isNaN(t)) return;
      c.innerHTML = '<div><b data-d>0</b><small>days</small></div><div><b data-h>0</b><small>hrs</small></div><div><b data-m>0</b><small>min</small></div><div><b data-s>0</b><small>sec</small></div>';
      function tick() { var diff = Math.max(0, t - Date.now()); var s = Math.floor(diff / 1000); $('[data-d]', c).textContent = Math.floor(s / 86400); $('[data-h]', c).textContent = Math.floor(s % 86400 / 3600); $('[data-m]', c).textContent = Math.floor(s % 3600 / 60); $('[data-s]', c).textContent = s % 60; }
      tick(); setInterval(tick, 1000);
    });
  }

  /* ---------- billing toggle (monthly / annual) ---------- */
  function toggles() {
    $$('[data-toggle-group]').forEach(function (g) {
      var btns = $$('button', g), scope = g.getAttribute('data-toggle-group');
      btns.forEach(function (b) { b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on');
        var mode = b.getAttribute('data-mode');
        $$('[data-price][data-scope="' + scope + '"]').forEach(function (p) {
          var base = parseFloat(p.getAttribute('data-price')); var v = mode === 'annual' ? Math.round(base * .9) : base;
          p.textContent = R(v);
        });
        $$('[data-mode-text][data-scope="' + scope + '"]').forEach(function (t) { t.textContent = t.getAttribute('data-' + mode); });
      }); });
    });
  }

  /* ---------- live status chip ---------- */
  function status() {
    $$('[data-open-status]').forEach(function (s) {
      var now = new Date(); var day = now.getDay(), h = now.getHours() + now.getMinutes() / 60;
      var open = (day >= 1 && day <= 5 && h >= 6.5 && h < 18) || (day === 6 && h >= 8 && h < 14);
      s.innerHTML = '<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (open ? '#8A9A5B' : '#C9A24B') + ';box-shadow:0 0 0 4px ' + (open ? 'rgba(138,154,91,.25)' : 'rgba(201,162,75,.25)') + ';margin-right:.5rem"></span>' + (open ? 'Front desk open now' : 'Front desk closed · members 24/7');
    });
  }

  /* ---------- PLAN FINDER ---------- */
  var PLANS = {
    moment: { n: 'Village Moment', p: 'R60', u: '/ hour', f: ['Any hot desk, pay as you need', 'Power and fast Wi-Fi', 'Coffee included'], cta: ['Book an hour', SB + '/desks'] },
    drifter: { n: 'Village Drifter', p: 'R150', u: '/ half day', f: ['4 hours at any hot desk', 'Power and fast Wi-Fi', 'Coffee included'], cta: ['Book a half day', SB + '/desks'] },
    nomad: { n: 'Village Nomad', p: 'R250', u: '/ day', f: ['Any hot desk, business hours', 'Fast Wi-Fi, printing at member rates', 'Coffee included, Village Table discounts'], cta: ['Book a day', SB + '/desks'] },
    wanderer: { n: 'Village Wanderer', p: 'R1 000', u: '/ month · 5 days', f: ['5 day-pass credits a month (R200 a day)', 'Any hot desk, priority booking', 'Member rates on boardrooms'], cta: ['Activate Wanderer', SB + '/desks'] },
    visitor: { n: 'Village Visitor', p: 'R1 600', u: '/ month · 10 days', f: ['10 day-pass credits a month (R160 a day)', 'Pick your favourite seat', 'Member rates on boardrooms'], cta: ['Activate Visitor', SB + '/desks'] },
    local: { n: 'Village Local', p: 'R3 000', u: '/ month · unlimited', f: ['Unlimited weekdays, any hot desk', 'Printing credits, community perks', 'Member rates on boardrooms'], cta: ['Join as a Local', SB + '/desks'] },
    resident: { n: 'Village Resident', p: 'R3 500', u: '/ month · dedicated desk', f: ['A desk that is yours, leave your setup', '24/7 tag access', 'Printing credits, member rates on boardrooms'], cta: ['Reserve a desk', SB + '/desks'] },
    o12: { n: 'Village Personal Office', p: 'R6 950', u: '/ month · 1–2 seats', f: ['Furnished, move-in ready', '24/7 secure access, dedicated Wi-Fi', 'Cleaning, printing credits, reception'], cta: ['Enquire about this office', wa("I'm interested in the Village Personal Office (1-2 seater)")] },
    o3: { n: 'Village Private Office', p: 'R10 450', u: '/ month · 3 seats', f: ['Furnished, move-in ready', '24/7 secure access, business address', 'Daily cleaning, community networking'], cta: ['Enquire about this office', wa("I'm interested in the Village Private Office (3 seater)")] },
    o4: { n: 'Village Team Office', p: 'R13 950', u: '/ month · 4 seats', f: ['Dedicated high-speed Wi-Fi', 'Lounge access, meeting room credits', 'Premium coffee service'], cta: ['Enquire about this office', wa("I'm interested in the Village Team Office (4 seater)")] },
    o6: { n: 'Village Executive Office', p: 'R20 950', u: '/ month · 6 seats', f: ['Spacious private suite', 'All utilities and amenities included', 'Dedicated team concierge'], cta: ['Enquire about this office', wa("I'm interested in the Village Executive Office (6 seater)")] },
    big: { n: 'Combined offices', p: 'On quote', u: 'for 7+ people', f: ['Two adjoining offices or an office plus dedicated desks', 'Volume pricing for teams of 3+', 'We map it on the floorplan with you'], cta: ['Talk to Christel', wa('Hi Christel, we are a team of 7+ looking at offices at The Village Hub')] },
    va: { n: 'Village Address', p: 'R595', u: '/ month excl. VAT', f: ['Nooitgedacht Village business address', 'Mail and parcels, same-day WhatsApp photo', '1 hot desk day a month, directory listing'], cta: ['Apply for Village Address', '/virtual-office-stellenbosch#apply'] },
    vv: { n: 'Village Virtual', p: 'R1 095', u: '/ month excl. VAT', f: ['Everything in Village Address', 'Local phone number forwarded to your mobile', '2 desk days, 1 boardroom hour, mail forwarding'], cta: ['Apply for Village Virtual', '/virtual-office-stellenbosch#apply'] },
    vp: { n: 'Village Virtual Pro', p: 'R1 695', u: '/ month excl. VAT', f: ['Everything in Village Virtual', 'Registered CIPC / SARS address included', '3 desk days, 2 boardroom hours, 10% off offices and events'], cta: ['Apply for Virtual Pro', '/virtual-office-stellenbosch#apply'] },
    exam: { n: 'Exam Pass 2026', p: 'R795', u: 'once-off · 26 Oct to 5 Dec', f: ['Unlimited 24/7 study access, whole season', 'R19,39 a day, coffee included', 'Only 20 passes. Student card required'], cta: ['WhatsApp to grab yours', wa("Hi Christel, I'd like the Exam Pass at The Village Hub")] },
    owl: { n: 'Night Owl', p: 'R495', u: '/ month incl. VAT', f: ['Unlimited weekdays 17:00 to 08:00', 'All day weekends and public holidays', 'Wi-Fi, power, coffee, quiet zone'], cta: ['Apply for Night Owl', '/student-study-space-stellenbosch#plans'] },
    s5: { n: 'Student 5-Day', p: 'R350', u: '/ month incl. VAT', f: ['5 study days a month, any day', '24 hours from check-in', 'R70 a day, coffee included'], cta: ['Apply for 5-Day', '/student-study-space-stellenbosch#plans'] },
    sall: { n: 'Student All-Access', p: 'R895', u: '/ month incl. VAT', f: ['Unlimited 24/7 access incl. weekends', 'Business directory, monthly Branch Out invite', 'Work next to 180+ businesses'], cta: ['Apply for All-Access', '/student-study-space-stellenbosch#plans'] },
    chamber: { n: 'Village Chamber', p: 'R350', u: '/ hour · 10 seats', f: ['Presentation screen, whiteboard, fast Wi-Fi', 'Catering from The Village Table on request', 'Half-day and full-day rates available'], cta: ['Book the Chamber', SB + '/rooms'] },
    board: { n: 'Village Boardroom', p: 'R390', u: '/ hour · 12 seats', f: ['Executive seating, acoustic treatment', 'Large screen, video-call ready', 'Catering from The Village Table on request'], cta: ['Book the Boardroom', SB + '/rooms'] },
    event: { n: 'Event space', p: 'On quote', u: 'workshops, conferences, evenings', f: ['Classroom, U-shape or pods', 'Full A/V, catering, free parking', 'Village Gathering (2h min) or Assembly (4h min)'], cta: ['Request a quote', wa('Event space enquiry')] },
    stay: { n: 'The Village Stay', p: 'Nightly', u: 'boutique studio suites', f: ['Two singles convertible to a king, kitchenette', 'Walk-in shower, Smart TV, fibre', '20% off Village Hub coworking while you stay'], cta: ['See suites and rates', '/accommodation'] }
  };
  function planFinder() {
    $$('[data-plan-finder]').forEach(function (root) {
      root.className += ' pf';
      var state = { step: 0, who: null, days: 8, team: 2, vo: null, stu: null, ppl: 8, own: null };
      function render() {
        var steps = state.who === 'stay' ? 1 : (state.who === 'solo' ? 3 : 2);
        var done = state.step >= steps;
        var html = '<div class="pf__steps">' + Array.apply(null, Array(Math.max(steps, 2))).map(function (_, i) { return '<span class="' + (i <= state.step ? 'on' : '') + '"></span>'; }).join('') + '</div>';
        if (state.step === 0) {
          html += '<p class="eyebrow" style="color:var(--vh-gold)">Plan finder · 20 seconds</p><h3 class="pf__q">What brings you to the Hub?</h3><div class="pf__opts">' +
            [['solo', 'A desk for me', 'Freelancer, remote worker, founder'], ['team', 'An office for my team', '1 to 8 people'], ['vo', 'A business address', 'Virtual office, mail, phone'], ['stu', "I'm a student", 'Exam Pass and student plans'], ['room', 'A boardroom or event', 'Meetings, workshops, conferences'], ['stay', 'A place to stay', 'Village Stay suites']]
              .map(function (o) { return '<button class="pf__opt' + (state.who === o[0] ? ' on' : '') + '" data-who="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>'; }).join('') + '</div>';
        } else if (!done) {
          if (state.who === 'solo' && state.step === 1) html += '<h3 class="pf__q">How many days a month will you come in?</h3><p class="pf__val">' + state.days + ' <span style="font-size:1rem;color:rgba(248,241,229,.6)">days</span></p><input class="pf__range" type="range" min="1" max="22" value="' + state.days + '" data-days aria-label="Days per month">';
          if (state.who === 'solo' && state.step === 2) html += '<h3 class="pf__q">Any seat, or your own desk?</h3><div class="pf__opts">' + [['any', 'Any seat is fine', 'I travel light'], ['own', 'My own desk, 24/7', 'Two screens, my chair, my coffee mug']].map(function (o) { return '<button class="pf__opt" data-own="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>'; }).join('') + '</div>';
          if (state.who === 'team') html += '<h3 class="pf__q">How many people?</h3><p class="pf__val">' + state.team + (state.team >= 8 ? '+' : '') + '</p><input class="pf__range" type="range" min="1" max="8" value="' + state.team + '" data-team aria-label="Team size">';
          if (state.who === 'vo') html += '<h3 class="pf__q">What does your business need?</h3><div class="pf__opts">' + [['va', 'An address and my mail handled', 'Website, invoices, Google profile'], ['vv', 'Address plus a local phone number', 'And a desk when I come to town'], ['vp', 'Registered CIPC / SARS address', 'The full virtual presence']].map(function (o) { return '<button class="pf__opt" data-vo="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>'; }).join('') + '</div>';
          if (state.who === 'stu') html += '<h3 class="pf__q">When do you want to study here?</h3><div class="pf__opts">' + [['exam', 'This exam season', 'Unlimited, 26 Oct to 5 Dec'], ['owl', 'Evenings and weekends', 'Lectures by day'], ['s5', 'A few days a month', 'When the room is too loud'], ['sall', 'Every day', 'Postgrad, honours, thesis']].map(function (o) { return '<button class="pf__opt" data-stu="' + o[0] + '"><b>' + o[1] + '</b><small>' + o[2] + '</small></button>'; }).join('') + '</div>';
          if (state.who === 'room') html += '<h3 class="pf__q">How many people are you hosting?</h3><p class="pf__val">' + state.ppl + (state.ppl >= 40 ? '+' : '') + '</p><input class="pf__range" type="range" min="2" max="40" value="' + state.ppl + '" data-ppl aria-label="People">';
          html += '<div class="pf__nav"><button class="pf__back" data-back>← Back</button>' + ((state.who === 'solo' && state.step === 1) || state.who === 'team' || state.who === 'room' ? '<button class="btn btn-gold btn-sm" data-next>Show my plan →</button>' : '') + '</div>';
        } else {
          var rec = recommend();
          var p = PLANS[rec[0]], a = PLANS[rec[1]];
          html += '<p class="eyebrow" style="color:var(--vh-gold)">Our recommendation</p><div class="pf__result"><div class="pf__card"><span class="eyebrow" style="color:var(--vh-sage-deep)">Best fit</span><h4>' + p.n + '</h4><p class="pf__price">' + p.p + ' <span style="font-size:.9rem;font-family:Inter,sans-serif;font-weight:500;color:rgba(31,29,26,.6)">' + p.u + '</span></p><ul>' + p.f.map(function (f) { return '<li>' + f + '</li>'; }).join('') + '</ul><a class="btn btn-bark" style="margin-top:1.25rem;width:100%" href="' + p.cta[1] + '">' + p.cta[0] + '</a></div>' +
            '<div><div class="pf__alt"><h5>Why this one</h5><p>' + rec[2] + '</p></div>' + (a ? '<div class="pf__alt" style="margin-top:.75rem"><h5>Also consider</h5><p><b style="color:#fff">' + a.n + '</b> · ' + a.p + ' ' + a.u + '. <a href="' + a.cta[1] + '" style="color:var(--vh-gold);text-decoration:underline">' + a.cta[0] + '</a></p></div>' : '') +
            '<div class="pf__nav"><button class="pf__back" data-restart>↺ Start again</button><a class="btn btn-ghost btn-sm" href="' + wa('Hi Christel, the plan finder suggested ' + p.n + ' for me. Can we chat?') + '">Ask Christel</a></div></div></div>';
        }
        root.innerHTML = html;
        $$('[data-who]', root).forEach(function (b) { b.addEventListener('click', function () { state.who = b.getAttribute('data-who'); state.step = 1; render(); }); });
        $$('[data-own]', root).forEach(function (b) { b.addEventListener('click', function () { state.own = b.getAttribute('data-own'); state.step = 3; render(); }); });
        $$('[data-vo]', root).forEach(function (b) { b.addEventListener('click', function () { state.vo = b.getAttribute('data-vo'); state.step = 2; render(); }); });
        $$('[data-stu]', root).forEach(function (b) { b.addEventListener('click', function () { state.stu = b.getAttribute('data-stu'); state.step = 2; render(); }); });
        var r = $('input[type=range]', root); if (r) r.addEventListener('input', function () { var v = parseInt(r.value, 10); if (r.hasAttribute('data-days')) state.days = v; if (r.hasAttribute('data-team')) state.team = v; if (r.hasAttribute('data-ppl')) state.ppl = v; var val = $('.pf__val', root); if (val) val.innerHTML = v + (r.hasAttribute('data-days') ? ' <span style="font-size:1rem;color:rgba(248,241,229,.6)">days</span>' : ((r.hasAttribute('data-team') && v >= 8) || (r.hasAttribute('data-ppl') && v >= 40) ? '+' : '')); });
        var nx = $('[data-next]', root); if (nx) nx.addEventListener('click', function () { state.step += 1; render(); });
        var bk = $('[data-back]', root); if (bk) bk.addEventListener('click', function () { state.step = Math.max(0, state.step - 1); render(); });
        var rs = $('[data-restart]', root); if (rs) rs.addEventListener('click', function () { state.step = 0; state.who = null; render(); });
        if (fine && !reduced) magnetic();
      }
      function recommend() {
        if (state.who === 'solo') {
          if (state.own === 'own') return ['resident', 'local', 'You want to leave your setup and walk in at 06:00 or 22:00. Only the dedicated desk gives you both, and it is R500 more than unlimited any-desk.'];
          var dd = state.days;
          if (dd <= 2) return ['nomad', 'drifter', dd + ' day' + (dd > 1 ? 's' : '') + ' a month is cheapest as day passes: ' + R(dd * 250) + ' versus R1 000 for the 5-day plan.'];
          if (dd <= 5) return ['wanderer', 'nomad', 'At ' + dd + ' days the 5-day plan works out to R200 a day, below the R250 day pass, and you keep priority booking.'];
          if (dd <= 10) return ['visitor', 'wanderer', dd + ' days a month costs ' + R(dd * 250) + ' in day passes. Visitor gives you 10 days for R1 600, so R160 a day.'];
          if (dd <= 15) return ['local', 'visitor', 'Above 10 days, unlimited is cheaper than stacking day passes (' + R(dd * 250) + '), and you stop counting.'];
          return ['resident', 'local', 'At ' + dd + ' days you are here most of the month. For R500 more than unlimited, a dedicated desk means you never pack up.'];
        }
        if (state.who === 'team') {
          var t = state.team;
          if (t <= 2) return ['o12', 'resident', 'A 1–2 seater at R6 950 gives you a door, 24/7 access and a business address. Two dedicated desks would be R7 000 without the door.'];
          if (t === 3) return ['o3', 'o4', 'Three people fit the Village Private Office exactly. Take the 4-seater if you expect a hire this year.'];
          if (t === 4) return ['o4', 'o6', 'Four seats, dedicated Wi-Fi and meeting room credits. The 6-seater buys growing room.'];
          if (t <= 6) return ['o6', 'o4', 'The Village Executive Office seats six comfortably with a team concierge.'];
          return ['big', 'o6', 'Above six we combine adjoining offices or add dedicated desks next door. Christel will map it on the floorplan with you.'];
        }
        if (state.who === 'vo') {
          if (state.vo === 'va') return ['va', 'vv', 'Address, mail handling with same-day WhatsApp photos and one desk day. Everything a home-based business needs to look established.'];
          if (state.vo === 'vv') return ['vv', 'vp', 'The local number forwarded to your mobile plus two desk days and a boardroom hour is where most clients land.'];
          return ['vp', 'vv', 'Pro includes the registered CIPC and SARS address (R250 pm on its own) plus three desk days and two boardroom hours.'];
        }
        if (state.who === 'stu') {
          var m = { exam: ['exam', 'sall', 'R795 for the whole season is R19,39 a day. Twenty passes, student card and proof of registration required.'], owl: ['owl', 's5', 'Night Owl never competes with daytime members, so it is the cheapest unlimited plan we offer.'], s5: ['s5', 'owl', 'Five days for R350 is R70 a day, any day of the week, 24 hours from check-in.'], sall: ['sall', 'owl', 'Unlimited 24/7 with the business directory and a monthly Branch Out invite: a postgrad’s desk two minutes from home.'] };
          return m[state.stu];
        }
        if (state.who === 'room') {
          var n = state.ppl;
          if (n <= 10) return ['chamber', 'board', n + ' people fit the 10-seat Village Chamber at R350 an hour. Members get discounted rates.'];
          if (n <= 12) return ['board', 'event', 'Twelve seats, acoustic treatment and a large screen: the Village Boardroom at R390 an hour.'];
          return ['event', 'board', 'Above 12 you are into event space: classroom, U-shape or pods with full A/V and catering. Quoted per session.'];
        }
        return ['stay', null, 'Five boutique suites steps from your desk, with 20% off coworking while you stay.'];
      }
      render();
    });
  }

  /* ---------- FLOOR EXPLORER ---------- */
  var SPOTS = [
    { id: 'board', t: 'Village Boardroom', x: 1.27, y: 73.7, w: 14.04, h: 24.5, img: '/images/web/village-boardroom.jpg', meta: ['12 seats', 'R390 / hour', 'Video-call ready'], d: 'Executive seating for twelve under acoustic treatment, a large screen and whiteboard. Catering from The Village Table on request. Members get discounted rates.', link: ['Book the Boardroom', SB + '/rooms'] },
    { id: 'chamber', t: 'Village Chamber', x: 1.27, y: 46.5, w: 14.04, h: 20.6, img: '/images/web/village-chamber.jpg', meta: ['10 seats', 'R350 / hour', 'Presentation screen'], d: 'The ten-seat meeting room where strategy meets synergy. Screen, whiteboard, fast Wi-Fi, and the lawn outside the window.', link: ['Book the Chamber', SB + '/rooms'] },
    { id: 'hot', t: 'Hot desk hall', x: 15.9, y: 26.6, w: 18.1, h: 40.5, img: '/images/web/hotdesks-1.jpg', meta: ['24 desks', 'From R60 / hour', 'Power at every seat'], d: 'The main hall under the timber trusses: twenty-four desks in pods of four, natural light from the arches, and the quiet hum of people getting things done.', link: ['Hot desk plans', '/hot-desk-stellenbosch'] },
    { id: 'focus', t: 'Focus desks', x: 40.9, y: 26.6, w: 8.4, h: 40.5, img: '/images/web/hotdesks-3.jpg', meta: ['12 desks', 'Quiet zone', 'Dedicated desks'], d: 'A quieter run of desks beside the atrium. Village Residents keep their setups here; it is also where students on the Exam Pass settle in for the day.', link: ['Dedicated desk R3 500', '/pricing#desks'] },
    { id: 'bar', t: 'Atrium bar seating', x: 61.6, y: 21.3, w: 5.6, h: 51.1, img: '/images/web/hotdesks-4.jpg', meta: ['10 seats', 'Day passes', 'Overlooks the atrium'], d: 'Bar-height seating along the atrium void, looking down into The Foundry. The favourite spot for a half-day pass and a laptop.', link: ['Day pass R250', SB + '/desks'] },
    { id: 'pods', t: 'Private office pods', x: 70, y: 18.6, w: 15.3, h: 49.8, img: '/images/web/office-2.jpg', meta: ['Six offices', '2 to 4 seats', '24/7 access'], d: 'Six glass-fronted offices in the centre of the floor, two to four seats each, with the arched windows behind them. Furnished, cleaned and connected.', link: ['Private offices from R6 950', '/private-offices-stellenbosch'] },
    { id: 'offices', t: 'Private offices, east wing', x: 88.1, y: 2, w: 10.9, h: 96.3, img: '/images/web/offices.jpg', meta: ['Six offices', '2 to 6 seats', 'Business address'], d: 'The east wing: a run of private offices from a quiet two-seater to the six-seat Village Executive Office, each with its own door and tag access.', link: ['See the offices', '/private-offices-stellenbosch'] },
    { id: 'office1', t: 'Village Private Office', x: 25.6, y: 2, w: 14.4, h: 17.9, img: '/images/web/office.jpg', meta: ['3 seats', 'R10 450 / month', 'Corner office'], d: 'The corner office by the main stair: three desks, a door, and first pick of the morning light.', link: ['Enquire', wa("I'm interested in the Village Private Office (3 seater)")] },
    { id: 'lounge1', t: 'Members’ lounge', x: 1.27, y: 25.9, w: 14.04, h: 19.9, img: '/images/web/foundry.jpg', meta: ['Soft seating', 'Calls welcome', 'Coffee'], d: 'Sofas, a couple of desks and a round table for the conversations that do not need a boardroom.', link: ['Book a tour', wa("Hi Village Hub, I'd like to book a tour of the coworking space")] },
    { id: 'reception', t: 'Reception', x: 1.27, y: 2, w: 14.04, h: 22.5, img: '/images/web/reception-hub.jpg', meta: ['Front desk', 'Mail desk', 'Printing'], d: 'Where Don signs you in, your virtual office mail lands, and the printer lives. Day passes and tags are issued here.', link: ['Virtual office mail desk', '/virtual-office-stellenbosch'] },
    { id: 'kitchen', t: 'Coffee bar & kitchen', x: 70, y: 2, w: 15.3, h: 11.3, img: '/images/web/kitchen.jpg', meta: ['Filter coffee', 'Fridge, microwave', 'Round tables'], d: 'Bottomless filter coffee, tea, a fridge and microwave, and two round tables that turn into the lunch spot at one o’clock.', link: ['What is included', '/pricing'] },
    { id: 'lounge2', t: 'Atrium lounge', x: 67.2, y: 77, w: 18.1, h: 19.9, img: '/images/web/open-area.jpg', meta: ['Soft seating', 'Events', 'Branch Out'], d: 'The open lounge at the foot of the atrium stair. This is where Branch Out networking evenings and workshops spill out.', link: ['Host an event', '/event-space-stellenbosch'] },
    { id: 'lounge3', t: 'Reading corner', x: 38.4, y: 77, w: 9.7, h: 19.9, img: '/images/web/lobby-stair.jpg', meta: ['Armchairs', 'Quiet', 'Phone calls'], d: 'Two armchairs and a sofa in the corner for a call, a book, or ten minutes away from the screen.', link: ['Explore the gallery', '/#gallery'] }
  ];
  function floor() {
    $$('[data-floor]').forEach(function (root) {
      root.className += ' floor';
      var map = el('div', 'floor__map'); map.innerHTML = '<img src="/the-village-hub-1st-floor.svg" alt="Floorplan of The Village Hub, first floor of The Foundry" width="2528" height="1190" loading="lazy">';
      SPOTS.forEach(function (s) { var b = el('button', 'floor__spot'); b.type = 'button'; b.setAttribute('data-spot', s.id); b.setAttribute('aria-label', s.t); b.style.cssText = 'left:' + s.x + '%;top:' + s.y + '%;width:' + s.w + '%;height:' + s.h + '%'; b.innerHTML = '<span class="floor__pin"></span><span class="floor__label">' + s.t + '</span>'; map.appendChild(b); });
      var panel = el('div', 'floor__panel'); var legend = el('div', 'floor__legend');
      SPOTS.forEach(function (s) { var b = el('button', '', s.t); b.type = 'button'; b.setAttribute('data-spot', s.id); legend.appendChild(b); });
      var side = el('div'); side.appendChild(panel); side.appendChild(legend);
      root.innerHTML = ''; root.appendChild(map); root.appendChild(side);
      function pick(id, scroll) {
        var s = SPOTS.filter(function (x) { return x.id === id; })[0]; if (!s) return;
        $$('[data-spot]', root).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-spot') === id); });
        panel.innerHTML = '<div class="fade"><img src="' + s.img + '" alt="' + s.t + '" loading="lazy"><div class="floor__panel-body"><h4>' + s.t + '</h4><p>' + s.d + '</p><div class="floor__meta">' + s.meta.map(function (m) { return '<span>' + m + '</span>'; }).join('') + '</div><a class="btn btn-bark btn-sm" style="margin-top:1.1rem" href="' + s.link[1] + '">' + s.link[0] + ' →</a></div></div>';
        if (scroll && w.innerWidth < 1024) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (fine && !reduced) magnetic();
      }
      $$('[data-spot]', root).forEach(function (b) { b.addEventListener('click', function () { pick(b.getAttribute('data-spot'), true); }); });
      pick('hot', false);
    });
  }

  /* ---------- WhatsApp conversion tracking (once) ---------- */
  function tracking() {
    if (w.__vhWaTracked) return; w.__vhWaTracked = true;
    d.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="wa.me"]') : null; if (!a) return;
      try { gtag('event', 'conversion', { 'send_to': 'AW-18265049370/n8xeCNDIuNMcEJqSuoVE', 'value': 1.0, 'currency': 'ZAR' }); } catch (err) {}
    }, true);
  }

  function boot() {
    mountChrome(); transitions(); progress(); glow(); anchors(); words(); reveal(); magnetic(); tilt(); parallax(); drag(); lightbox(); countdown(); toggles(); status(); planFinder(); floor(); tracking();
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
  w.VH = { wa: wa, plans: PLANS };
})();
