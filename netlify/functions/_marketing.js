// Reads the published Monday marketing pack and turns it into plain data.
// The content-strategy site is regenerated every Monday morning. Fetching the
// live page means a new week shows up here without a second copy of the plan.

const DEFAULT_URL = 'https://marius-commits.github.io/village-hub-content-strategy/';

function decode(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function textOf(html) {
  return decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// The diary line wraps tags in extra spans, so a non-greedy </span> stops too early.
function spanInner(html, className) {
  const marker = `class="${className}"`;
  const start = html.indexOf(marker);
  if (start < 0) return '';
  const gt = html.indexOf('>', start);
  if (gt < 0) return '';
  let i = gt + 1;
  let depth = 1;
  while (i < html.length && depth) {
    const nextOpen = html.indexOf('<span', i);
    const nextClose = html.indexOf('</span>', i);
    if (nextClose < 0) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 5;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(gt + 1, nextClose);
      i = nextClose + 7;
    }
  }
  return '';
}

function sliceBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) return '';
  const from = start;
  const end = endMarker ? html.indexOf(endMarker, start + startMarker.length) : -1;
  return html.slice(from, end < 0 ? undefined : end);
}

function parseMarketingHtml(html, pageUrl) {
  const origin = new URL(pageUrl || DEFAULT_URL).origin + new URL(pageUrl || DEFAULT_URL).pathname.replace(/[^/]*$/, '');
  const cfgMatch = html.match(/window\.VH_REVIEW\s*=\s*(\{[\s\S]*?\});/);
  let week = null;
  if (cfgMatch) {
    try { week = JSON.parse(cfgMatch[1]).week || null; } catch (e) { week = null; }
  }
  if (week && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(week)) week = null;

  const planHtml = sliceBetween(html, 'id="plan"', 'id="captions"');
  const span = (planHtml.match(/class="dspan">([^<]+)/) || [])[1];
  const days = [];
  const dayRe = /<article class="dpage[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let dayMatch;
  while ((dayMatch = dayRe.exec(planHtml))) {
    const block = dayMatch[1];
    const dow = textOf((block.match(/class="dow">([^<]*)/) || [])[1] || '');
    const dn = textOf((block.match(/class="dn">([^<]*)/) || [])[1] || '');
    const dmon = textOf((block.match(/class="dmon">([^<]*)/) || [])[1] || '');
    const dsub = textOf((block.match(/class="dsub">([^<]*)/) || [])[1] || '');
    const items = [];
    const chunks = block.split('class="ditem"').slice(1);
    for (const chunk of chunks) {
      const raw = spanInner(chunk, 'dtxt').replace(/<span class="tags">[\s\S]*?<\/span>\s*<\/span>/, '');
      const line = textOf(raw);
      if (line) items.push(line);
    }
    if (dow || items.length) days.push({ dow, date: [dn, dmon].filter(Boolean).join(' '), note: dsub, items });
  }

  const captionHtml = sliceBetween(html, 'id="captions"', 'id="assets"') || sliceBetween(html, 'id="captions"', '<section');
  const posts = [];
  const postRe = /<article class="pcard[\s\S]*?<\/article>/g;
  let postMatch;
  const source = captionHtml || html;
  while ((postMatch = postRe.exec(source))) {
    const card = postMatch[0];
    const id = (card.match(/data-post="([^"]+)"/) || [])[1];
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(id)) continue;
    const title = textOf((card.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || id);
    const asset = textOf((card.match(/Assets:\s*(?:<b>)?([\s\S]*?)(?:<\/b>)?<\/p>/) || [])[1] || '');
    const captions = [];
    const capRe = /<div class="pv" data-plat="([^"]+)">[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/g;
    let cap;
    while ((cap = capRe.exec(card))) {
      captions.push({ platform: cap[1], label: textOf(cap[2]), text: decode(cap[3]).trim() });
    }
    const mockups = [];
    const mockBlocks = card.match(/<div class="pmockup">[\s\S]*?(?=<div class="pmockup">|<\/div>\s*<\/article>)/g) || [];
    for (const block of mockBlocks) {
      const label = textOf((block.match(/class="pmockup-label">([^<]*)/) || [])[1] || '');
      const src = (block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
      const alt = textOf((block.match(/<img[^>]+alt="([^"]*)"/) || [])[1] || '');
      const drive = (block.match(/class="mockup-drive"[^>]+href="([^"]+)"/) || [])[1] || '';
      if (!src && !drive) continue;
      mockups.push({
        label,
        alt,
        src: src ? new URL(src, origin).href : '',
        drive,
      });
    }
    const photo = (card.match(/background-image:\s*url\('([^']+)'\)/) || [])[1] || '';
    posts.push({
      id,
      title,
      asset,
      photo: photo ? new URL(photo, origin).href : '',
      captions,
      mockups,
    });
  }

  return {
    week,
    range: span ? textOf(span) : '',
    source: pageUrl || DEFAULT_URL,
    days,
    posts,
  };
}

let cache = null;

async function loadPublishedPlan(pageUrl) {
  const url = pageUrl || process.env.CONTENT_STRATEGY_URL || DEFAULT_URL;
  if (cache && cache.url === url && Date.now() - cache.at < 5 * 60 * 1000) return cache.plan;
  const res = await fetch(url, { headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`Could not read the weekly plan (${res.status})`);
  const html = await res.text();
  const plan = parseMarketingHtml(html, url);
  cache = { url, at: Date.now(), plan };
  return plan;
}

module.exports = { parseMarketingHtml, loadPublishedPlan, DEFAULT_URL, textOf };
