// Crops DELA's full-size landing photos (photos.zip) into public/photos/*.webp.
// Each slot has the aspect ratio of its spot on the page, a max width (about 2x its
// largest on-screen size) and a focus point (0..1) that decides what the crop keeps.
// The MTN MoMo ad in the billboard shot is painted over with our own "your brand here"
// panel: we have no deal with MTN, so the page must not show their ad.
// Usage: node scripts/landing-photos.mjs path/to/unzipped/photos
// Only the slots whose source file is in that folder are redone.
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const slots = {
  hero: ['Cyclists Approaching University of Ghana Gate.png', 419 / 316, 1200, 0.52],
  about: ['Sunny Mediterranean Campus Clock Tower Plaza.png', 380 / 149, 1100, 0.5],
  ride: ['Campus Avenue Cycling Race.png', 0.9, 640, 0.56],
  race: ['Campus Cycling Race at the Finish Line.png', 0.9, 640, 0.5],
  connect: ['Cycling Toward the Campus Clocktower.png', 0.9, 640, 0.62],
  world: ['Sunny Palm-Lined Campus Boulevard.png', 415 / 178, 1400, 0.55],
  'lm-gate': ['University of Ghana Campus Gateway.png', 2, 360, 0.5],
  'lm-balme': ['University of Ghana Balme Library Campus.png', 2, 360, 0.5],
  'lm-tower': ['university-of-ghana-legon.jpg', 2, 360, 0.5, 0.3],
  'lm-hall': ['images (1).jfif', 2, 360, 0.5, 0.6],
  'lm-aerial': ['images.jfif', 2, 360, 0.5, 0.45],
  'ev-sunset': ['Golden Hour Campus Bike Ride.png', 146 / 63, 640, 0.5],
  'ev-night': ['Moonlit Campus Cycling Parade.png', 146 / 63, 640, 0.5],
  'ev-hall': ['Golden Hour Campus Bike Fest.png', 146 / 63, 640, 0.5],
  halls: ['Golden Campus Sunset Bike Ride.png', 0.72, 560, 0.8],
  garage: ['Cyclists Ride Toward the Campus Clocktower.png', 0.6, 520, 0.3],
  together: ['Cyclists Rally at the Campus Clock Tower.png', 183 / 90, 800, 0.5],
  brands: ['Sunny Campus Street with MTN MoMo Billboard.png', 431 / 141, 1400, 0.5],
  ready: ['Sunset Ride Over Campus.png', 351 / 138, 1200, 0.5],
  // the game's menus: home background, mode cards and the sign-up screens
  'app-bg': ['Cycling Toward the Campus Clocktower.png', 16 / 9, 1600, 0.5, 0.55],
  // mode cards and the Quick Ride banner show DELA's wide photos whole (no crop)
  'mode-explore': ['Sunny Mediterranean Campus Clock Tower Plaza.png', 1933 / 813, 760, 0.5],
  'mode-match': ['Campus Cycling Race at the Finish Line.png', 1933 / 813, 760, 0.5],
  'mode-challenge': ['Cyclists Ride Toward the Campus Clocktower.png', 1933 / 813, 760, 0.5],
  'mode-vibe': ['Cycling Through Campus Life.png', 1933 / 813, 760, 0.5],
  'qr-ride': ['Cyclists Approaching University of Ghana Gate.png', 1932 / 814, 1400, 0.5],
  'ob-splash': ['Cyclists Approaching University of Ghana Gate.png', 0.6, 720, 0.33],
  'ob-account': ['Cyclists Rally at the Campus Clock Tower.png', 0.78, 640, 0.4],
  'ob-about': ['Cycling Toward the Campus Clocktower.png', 0.78, 640, 0.5],
  'ob-uni': ['University of Ghana Campus Gateway.png', 0.78, 640, 0.5],
  'ob-social': ['Cycling Through Campus Life.png', 0.78, 640, 0.72],
  'ob-ride': ['Campus Avenue Cycling Race.png', 0.78, 640, 0.5],
  'ob-welcome': ['Golden Hour Campus Bike Ride.png', 0.6, 720, 0.62],
  'hall-tile': ['images (1).jfif', 1.3, 360, 0.5, 0.6],
  'type-racer': ['Campus Avenue Cycling Race.png', 1.3, 300, 0.55],
  'type-explorer': ['Sunny Palm-Lined Campus Boulevard.png', 1.3, 300, 0.3],
  'type-social': ['Cyclists Rally at the Campus Clock Tower.png', 1.3, 300, 0.4],
  'type-speedster': ['Campus Cycling Race at the Finish Line.png', 1.3, 300, 0.3],
  'type-chill': ['Golden Hour Campus Bike Ride.png', 1.3, 300, 0.62],
};
// billboard face in the source image (pixels): TL, TR, BR, BL
const BILLBOARD = [[941, 136], [1693, 4], [1693, 441], [941, 464]];

const mime = (f) => (f.endsWith('.png') ? 'image/png' : 'image/jpeg');
// slots whose source isn't in the folder are left as they are
const jobs = Object.entries(slots).filter(([, [file]]) => existsSync(join(dir, file))).map(([name, [file, aspect, maxW, fx, fy = 0.5]]) => ({
  name, aspect, maxW, fx, fy, brand: name === 'brands',
  src: `data:${mime(file)};base64,${readFileSync(join(dir, file)).toString('base64')}`,
}));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<body></body>');
await page.evaluate(() => document.fonts.ready);
mkdirSync('public/photos', { recursive: true });
for (const job of jobs) {
  const b64 = await page.evaluate(async ({ job, BILLBOARD }) => {
    const img = new Image();
    img.src = job.src;
    await img.decode();
    let W = img.naturalWidth, H = img.naturalHeight;
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const s = src.getContext('2d');
    s.drawImage(img, 0, 0);
    if (job.brand) {
      const q = BILLBOARD;
      s.beginPath(); q.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath();
      s.fillStyle = '#ffd21f'; s.fill();
      // follow the board's slant: skew by the slope of its top edge
      const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[3][1] + q[1][1] + q[2][1]) / 4;
      const slope = (q[1][1] - q[0][1]) / (q[1][0] - q[0][0]);
      s.save(); s.translate(cx, cy); s.transform(1, slope, 0, 1, 0, 0);
      s.fillStyle = '#0b1530'; s.textAlign = 'center'; s.textBaseline = 'middle';
      s.font = '900 92px Arial, Helvetica, sans-serif'; s.fillText('YOUR BRAND', 0, -70);
      s.fillText('HERE', 0, 30);
      s.font = '700 30px Arial, Helvetica, sans-serif'; s.fillText('P A R T N E R   W I T H   L E G O N R U S H', 0, 110);
      s.restore();
    }
    // crop to the slot's aspect around the focus point
    let cw = W, ch = W / job.aspect;
    if (ch > H) { ch = H; cw = H * job.aspect; }
    const x = Math.min(W - cw, Math.max(0, W * job.fx - cw / 2));
    const y = Math.min(H - ch, Math.max(0, H * job.fy - ch / 2));
    const ow = Math.round(Math.min(job.maxW, cw)), oh = Math.round(ow / job.aspect);
    const c = document.createElement('canvas');
    c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, cw, ch, 0, 0, ow, oh);
    return c.toDataURL('image/webp', 0.72).split(',')[1];
  }, { job, BILLBOARD });
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(`public/photos/${job.name}.webp`, buf);
  console.log(job.name.padEnd(12), (buf.length / 1024).toFixed(0), 'KB');
}
await browser.close();
