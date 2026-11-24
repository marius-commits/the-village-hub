/**
 * Build responsive AVIF/WebP variants, a smaller logo, an optimised floor SVG,
 * and local Village Stay photos (downloaded from the old hotlinks).
 *
 * Run: node scripts/optimize-images.mjs
 * Outputs are committed. Netlify only recompiles Tailwind.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { optimize } from 'svgo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [640, 960, 1280, 1600];
const manifest = {};

const STAY = [
  ['bedroom.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/WhatsApp%20Image%202025-12-15%20at%2010.06.40%20(2).jpeg', 'Suite bedroom with modern design'],
  ['bathroom.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/WhatsApp%20Image%202025-12-15%20at%2010.06.40%20(13).jpeg', 'Suite bathroom with rain shower'],
  ['living.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/WhatsApp%20Image%202025-12-15%20at%2010.06.40.jpeg', 'Suite living area with comfortable seating'],
  ['kitchenette.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/Gemini_Generated_Image_b0twc4b0twc4b0tw.png', 'Suite kitchenette with modern appliances'],
  ['workspace.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/imgi_192_189_16682f7a493449b68932b9a91d6a6809_t_w_1440_h_900.jpg', 'Suite workspace with desk and chair'],
  ['lounge.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/imgi_202_c912ec8b-37e7-467a-cc2f-0274811ae719.jpg', 'Suite relaxation area with comfortable seating'],
  ['exterior.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/imgi_177_189_7ed786941702477d8f00a9713f621af0_t_w_1440_h_900.jpg', 'Suite exterior with natural lighting'],
  ['detail.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/WhatsApp%20Image%202025-12-15%20at%2009.59.06%20(1).jpeg', 'Suite additional view'],
  ['detail-2.jpg', 'https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/WhatsApp%20Image%202025-12-15%20at%2010.06.40%20(15).jpeg', 'Suite additional view'],
  ['mark.png', 'https://lh3.googleusercontent.com/d/1amXTsXrB4pl9zJDfU3wUdAo7PQ9FNg6i', 'The Village Stay'],
];

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('too small ' + buf.length + ' ' + url);
  await writeFile(dest, buf);
  return buf.length;
}

async function variantsFor(file, { maxFallback = 1600, fallbackQuality = 74 } = {}) {
  const rel = '/' + path.relative(root, file).split(path.sep).join('/');
  const img = sharp(file, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width) return;
  const made = [];
  for (const w of WIDTHS) {
    if (w > width) continue;
    const base = file.replace(/\.(jpe?g|png)$/i, '') + '-' + w + 'w';
    const pipeline = () => sharp(file, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true });
    await pipeline().avif({ quality: 48, effort: 4 }).toFile(base + '.avif');
    await pipeline().webp({ quality: 68, effort: 4 }).toFile(base + '.webp');
    made.push(w);
  }
  if (width > maxFallback && /\.(jpe?g|png)$/i.test(file) && file.includes(`${path.sep}stay${path.sep}`)) {
    const jpg = file.replace(/\.png$/i, '.jpg');
    await sharp(file, { failOn: 'none' }).rotate().resize({ width: maxFallback, withoutEnlargement: true }).jpeg({ quality: fallbackQuality, mozjpeg: true }).toFile(jpg + '.tmp');
  }
  manifest[rel] = { width, height, variants: made };
  const before = (await stat(file)).size;
  console.log(rel, width + 'x' + height, 'variants', made.join(','), 'src', Math.round(before / 1024) + 'KB');
}

async function compressLogo(file, outSize) {
  const before = (await stat(file)).size;
  const meta = await sharp(file).metadata();
  const target = Math.min(outSize, meta.width || outSize);
  const buf = await sharp(file)
    .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 80, effort: 9 })
    .toBuffer();
  if (buf.length < before) {
    await writeFile(file, buf);
    console.log('logo', path.basename(file), meta.width + 'x' + meta.height, Math.round(before / 1024) + 'KB ->', Math.round(buf.length / 1024) + 'KB at', target + 'px');
  } else {
    console.log('logo', path.basename(file), 'kept original', Math.round(before / 1024) + 'KB');
  }
  for (const w of [96, 192]) {
    const base = file.replace(/\.png$/i, '') + '-' + w + 'w';
    await sharp(file).resize({ width: w, withoutEnlargement: true }).avif({ quality: 50 }).toFile(base + '.avif');
    await sharp(file).resize({ width: w, withoutEnlargement: true }).webp({ quality: 74 }).toFile(base + '.webp');
  }
  const meta2 = await sharp(file).metadata();
  const rel = '/' + path.relative(root, file).split(path.sep).join('/');
  manifest[rel] = { width: meta2.width, height: meta2.height, variants: [96, 192], logo: true };
}

async function stayPhotos() {
  await mkdir(path.join(root, 'images/stay'), { recursive: true });
  for (const [name, url] of STAY) {
    const dest = path.join(root, 'images/stay', name);
    try {
      const n = await download(url, dest);
      console.log('downloaded', name, Math.round(n / 1024) + 'KB');
    } catch (err) {
      console.warn('SKIP', name, err.message);
    }
  }
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(path.join(root, 'images/stay'));
  for (const name of names) {
    if (!/\.(jpe?g|png)$/i.test(name)) continue;
    if (/-(\d+)w\.(avif|webp|jpe?g|png)$/i.test(name)) continue;
    const file = path.join(root, 'images/stay', name);
    if (name === 'mark.png') {
      await compressLogo(file, 512);
      continue;
    }
    const meta = await sharp(file).metadata();
    const bytes = (await stat(file)).size;
    const fallback = path.join(root, 'images/stay', name.replace(/\.png$/i, '.jpg'));
    if ((meta.width || 0) > 1600 || name.endsWith('.png') || bytes > 220 * 1024) {
      const out = name.endsWith('.png') ? fallback : file;
      const buf = await sharp(file).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 74, mozjpeg: true }).toBuffer();
      await writeFile(out, buf);
      if (out !== file) {
        const { unlink } = await import('node:fs/promises');
        await unlink(file).catch(() => {});
      }
      console.log('stay fallback', path.basename(out), Math.round(bytes / 1024) + 'KB ->', Math.round(buf.length / 1024) + 'KB');
      await variantsFor(out);
    } else {
      await variantsFor(file);
    }
  }
}

async function webPhotos() {
  const { readdir } = await import('node:fs/promises');
  const dir = path.join(root, 'images/web');
  const names = await readdir(dir);
  for (const name of names) {
    if (!/\.jpe?g$/i.test(name)) continue;
    if (/-(\d+)w\.jpe?g$/i.test(name)) continue;
    const file = path.join(dir, name);
    const size = (await stat(file)).size;
    if (size > 900 * 1024) {
      console.log('skip large unreferenced-style', name, Math.round(size / 1024) + 'KB');
      continue;
    }
    await variantsFor(file);
  }
  await compressLogo(path.join(dir, 'logo.png'), 512);
  await compressLogo(path.join(dir, 'logo-white.png'), 256);
}

function renderSvg(svgPath, pngPath, width) {
  const r = spawnSync('google-chrome', [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--window-size=' + width + ',800',
    '--screenshot=' + pngPath,
    svgPath,
  ], { stdio: 'ignore' });
  return r.status === 0;
}

async function floorSvg() {
  const file = path.join(root, 'the-village-hub-1st-floor.svg');
  const before = await readFile(file, 'utf8');
  const result = optimize(before, {
    multipass: true,
    floatPrecision: 1,
    plugins: [
      { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
      { name: 'convertPathData', params: { floatPrecision: 1, transformPrecision: 1 } },
      'cleanupIds',
      'removeUselessDefs',
      'collapseGroups',
    ],
  });
  if (result.error) throw new Error(result.error);
  const out = result.data;
  console.log('svg', Math.round(before.length / 1024) + 'KB ->', Math.round(out.length / 1024) + 'KB');
  if (out.length < before.length * 0.98 && out.includes('viewBox')) {
    await writeFile(file, out);
  } else {
    console.log('svg kept original');
  }
}

async function writeManifest() {
  const dest = path.join(root, 'assets/image-variants.json');
  await writeFile(dest, JSON.stringify(manifest));
  const js = path.join(root, 'assets/vh.js');
  let src = await readFile(js, 'utf8');
  const block = '/* vh-img-variants:start */\nvar VH_IMG = ' + JSON.stringify(manifest) + ';\n/* vh-img-variants:end */';
  if (src.includes('/* vh-img-variants:start */')) {
    src = src.replace(/\/\* vh-img-variants:start \*\/[\s\S]*?\/\* vh-img-variants:end \*\//, block);
  } else {
    src = block + '\n' + src;
  }
  await writeFile(js, src);
  console.log('manifest keys', Object.keys(manifest).length);
}

await stayPhotos();
await webPhotos();
await floorSvg();
await writeManifest();
