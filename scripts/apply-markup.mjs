/**
 * One-time markup pass (idempotent):
 * - swap the Tailwind browser CDN for the compiled stylesheet on public pages
 * - wrap local photos in <picture> with AVIF/WebP srcset
 * - bust the shared CSS/JS cache
 *
 * Does not touch /admin or Netlify Functions.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'assets/image-variants.json'), 'utf8'));

function attr(tag, name) {
  var m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("|\')([\\s\\S]*?)\\1', 'i'));
  return m ? m[2] : '';
}

function sizesFor(tag, src) {
  var cls = attr(tag, 'class');
  var width = parseInt(attr(tag, 'width'), 10);
  if (/logo|mark\.png/.test(src)) return (width && width < 80 ? width : 46) + 'px';
  if (/\bkenburns\b/.test(cls) || /absolute inset-0/.test(cls) || attr(tag, 'fetchpriority') === 'high') return '100vw';
  var sm = cls.match(/sm:w-\[([^\]]+)\]/);
  var base = cls.match(/(?:^|\s)w-\[([^\]]+)\]/);
  if (sm && base) return '(min-width: 640px) ' + sm[1] + ', ' + base[1];
  if (/aspect-square/.test(cls)) return '(min-width: 1024px) 40vw, (min-width: 640px) 50vw, 92vw';
  return '(min-width: 1280px) 840px, (min-width: 768px) 70vw, 100vw';
}

function srcset(src, ext, widths) {
  var base = src.replace(/\.(jpe?g|png)$/i, '');
  return widths.map(function (w) { return base + '-' + w + 'w.' + ext + ' ' + w + 'w'; }).join(', ');
}

function wrapImgs(html) {
  return html.replace(/<img\b[^>]*>/gi, function (tag, offset) {
    var src = attr(tag, 'src');
    if (!src || !manifest[src] || !manifest[src].variants || !manifest[src].variants.length) return tag;
    var before = html.slice(Math.max(0, offset - 6000), offset);
    if (/<picture\b[^>]*>[^]*$/i.test(before) && !/<\/picture>[^]*$/i.test(before)) return tag;
    var widths = manifest[src].variants;
    var sizes = sizesFor(tag, src);
    var full = src.replace(/\.(jpe?g|png)$/i, '') + '-' + widths[widths.length - 1] + 'w.avif';
    var img = tag;
    if (!/data-full=/.test(img)) img = img.replace(/<img\b/i, '<img data-full="' + full + '"');
    if (!/\bsizes=/.test(img)) img = img.replace(/<img\b/i, '<img sizes="' + sizes + '"');
    if (!/\bdecoding=/.test(img)) img = img.replace(/<img\b/i, '<img decoding="async"');
    return '<picture class="vh-pic">' +
      '<source type="image/avif" srcset="' + srcset(src, 'avif', widths) + '" sizes="' + sizes + '">' +
      '<source type="image/webp" srcset="' + srcset(src, 'webp', widths) + '" sizes="' + sizes + '">' +
      img + '</picture>';
  });
}

function preloadHero(html) {
  return html.replace(
    /<link rel="preload" as="image" href="\/images\/web\/hotdesks-4\.jpg"([^>]*)>/,
    '<link rel="preload" as="image" type="image/avif" href="/images/web/hotdesks-4-960w.avif" imagesrcset="/images/web/hotdesks-4-640w.avif 640w, /images/web/hotdesks-4-960w.avif 960w, /images/web/hotdesks-4-1280w.avif 1280w, /images/web/hotdesks-4-1600w.avif 1600w" imagesizes="100vw" fetchpriority="high">'
  );
}

const files = (await readdir(root)).filter(function (name) { return name.endsWith('.html'); });
let pictures = 0;
let tailwind = 0;
for (const name of files) {
  const file = path.join(root, name);
  let html = await readFile(file, 'utf8');
  const orig = html;
  html = html.replace(/<script>\s*tailwind\.config\s*=[\s\S]*?<\/script>\s*/g, '');
  if (html.includes('https://cdn.tailwindcss.com')) {
    html = html.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/g, '<link rel="stylesheet" href="/assets/tailwind.css?v=1">\n');
    tailwind++;
  }
  html = html.replace(/\/assets\/vh\.css\?v=\d+/g, '/assets/vh.css?v=5');
  html = html.replace(/\/assets\/vh\.js\?v=\d+/g, '/assets/vh.js?v=5');
  const beforePics = (html.match(/<picture\b/g) || []).length;
  html = wrapImgs(html);
  html = preloadHero(html);
  pictures += (html.match(/<picture\b/g) || []).length - beforePics;
  if (html !== orig) await writeFile(file, html);
}
console.log('pages', files.length, 'tailwind swaps', tailwind, 'new pictures', pictures);
