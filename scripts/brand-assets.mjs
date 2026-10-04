// Cuts the brand logo into the web and app-icon assets the site uses.
// Usage: node scripts/brand-assets.mjs path/to/logo.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(process.argv[2]).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas></canvas>');
const out = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const probe = document.createElement('canvas');
  probe.width = img.width; probe.height = img.height;
  const pctx = probe.getContext('2d');
  pctx.drawImage(img, 0, 0);
  const [r, g, bl] = pctx.getImageData(8, 8, 1, 1).data;
  const bg = `rgb(${r},${g},${bl})`;
  const cut = (sx, sy, sw, sh, w, h, type = 'image/webp', q = 0.9, square = false, pad = 0) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    if (square) {
      const inner = w * (1 - pad * 2);
      const scale = Math.min(inner / sw, inner / sh);
      const dw = sw * scale, dh = sh * scale;
      x.drawImage(img, sx, sy, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return c.toDataURL(type, q).split(',')[1];
  };
  // emblem: the "1", road, rider and campus skyline
  const E = [370, 140, 900, 470];
  return {
    bg,
    'brand/logo.webp': cut(0, 0, img.width, img.height, 1200, 800),
    'brand/wordmark.webp': cut(110, 614, 1330, 156, 665, 78, 'image/webp', 0.92),
    'brand/emblem.webp': cut(...E, 900, 470),
    'icons/icon-512.png': cut(...E, 512, 512, 'image/png', 1, true, 0.06),
    'icons/icon-192.png': cut(...E, 192, 192, 'image/png', 1, true, 0.06),
    'icons/icon-maskable-512.png': cut(...E, 512, 512, 'image/png', 1, true, 0.16),
    'icons/apple-touch-icon.png': cut(...E, 180, 180, 'image/png', 1, true, 0.1),
    'icons/favicon.png': cut(...E, 64, 64, 'image/png', 1, true, 0.02),
    'brand/og.jpg': cut(0, 112, img.width, 800, 1200, 630, 'image/jpeg', 0.86),
  };
}, src);
for (const [k, v] of Object.entries(out)) if (k !== 'bg') writeFileSync(`public/${k}`, Buffer.from(v, 'base64'));
console.log('logo background', out.bg);
await browser.close();
