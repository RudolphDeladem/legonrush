// Cuts the photos out of the landing-page mockup (732x2149) into public/photos.
// Coordinates are in the mockup's pixel space. Swap these files for full-resolution
// originals when available; keep the same names.
// Usage: node scripts/mockup-photos.mjs path/to/mockup.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const k = 732 / 681; // crops were measured on a 681px-wide preview
const R = (x1, y1, x2, y2) => [x1 * k, y1 * k, (x2 - x1) * k, (y2 - y1) * k].map(Math.round);
const crops = {
  hero: R(262, 40, 681, 356),
  about: R(273, 379, 653, 528),
  ride: R(92, 563, 225, 724),
  race: R(318, 563, 446, 724),
  connect: R(540, 563, 666, 724),
  world: R(266, 740, 681, 918),
  'lm-gate': R(213, 921, 294, 961),
  'lm-balme': R(304, 921, 385, 961),
  'lm-engineering': R(396, 921, 477, 961),
  'lm-akuafo': R(488, 921, 569, 961),
  'lm-stadium': R(581, 921, 664, 961),
  'ev-sunset': R(19, 1041, 165, 1104),
  'ev-night': R(174, 1041, 313, 1104),
  'ev-hall': R(323, 1041, 462, 1104),
  halls: R(250, 1262, 378, 1440),
  garage: R(560, 1240, 681, 1440),
  together: R(482, 1452, 665, 1542),
  avatars: R(28, 1500, 158, 1532),
  brands: R(250, 1555, 681, 1696),
  ready: R(330, 1698, 681, 1836),
};

const src = readFileSync(process.argv[2]).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async ({ b64, crops }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const res = {};
  for (const [name, [x, y, w, h]] of Object.entries(crops)) {
    const c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2; // 2x with smoothing reads better than browser upscaling
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    res[name] = c.toDataURL('image/webp', 0.86).split(',')[1];
  }
  return res;
}, { b64: src, crops });
for (const [n, v] of Object.entries(out)) writeFileSync(`public/photos/${n}.webp`, Buffer.from(v, 'base64'));
await browser.close();
console.log(Object.keys(out).length, 'photos written');
