// Renders in-game shots used on the landing page into public/shots.
// Needs the dev server running (npm run dev -- --port 5173) and Playwright.
// Usage: node scripts/marketing-shots.mjs [shotName]
import { chromium } from 'playwright';

const OUT = 'public/shots';
const only = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
await page.addInitScript(() => localStorage.setItem('legonrush.profile.v1', JSON.stringify({ name: 'Rider', hall: 'commonwealth', bike: 'city', guest: false, tutorialDone: true })));
// the dev server may reload the page right after a file change, so retry once
for (let attempt = 0; ; attempt++) {
  try {
    await page.goto('http://localhost:5173/play/');
    await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: '#app{display:none!important}' });
    break;
  } catch (e) {
    if (attempt > 1) throw e;
  }
}

// cam and look are offsets from the rider: x right, y up, z behind (+) / ahead (-)
const shots = {
  hero: { tod: 'day', d: 196, lane: 1, cam: [2.4, 1.5, -5], look: [-0.4, 1.2, 1.5], jersey: '#f5c518', stage: [{ kind: 'car', lane: 2, ahead: -16 }, { kind: 'pedestrian', lane: 0, ahead: -10 }] },
  aerial: { tod: 'day', d: 650, lane: 1, cam: [26, 46, 30], look: [-4, 0, -90] },
  ride: { tod: 'day', d: 420, lane: 1, cam: [0, 3.1, 6.2], look: [0, 1.1, -12], stage: [{ kind: 'coin', lane: 1, ahead: 8 }, { kind: 'coin', lane: 1, ahead: 11 }, { kind: 'coin', lane: 1, ahead: 14 }, { kind: 'coin', lane: 1, ahead: 17 }, { kind: 'car', lane: 0, ahead: 22 }, { kind: 'barrier', lane: 2, ahead: 26 }] },
  race: { tod: 'day', d: 1100, lane: 1, cam: [3.4, 1.4, -6], look: [-0.6, 1.2, 3], stage: [{ kind: 'trotro', lane: 0, ahead: -9 }, { kind: 'car', lane: 2, ahead: -15 }] },
  connect: { tod: 'sunset', d: 1880, lane: 1, cam: [2.6, 1.3, 4.5], look: [0, 1.2, -6] },
  'lm-gate': { tod: 'day', d: -8, lane: 1, cam: [0, 3.5, 8], look: [0, 3, -40] },
  'lm-great-hall': { tod: 'day', d: 300, lane: 1, cam: [3, 5, 6], look: [-60, 8, -40] },
  'lm-balme': { tod: 'day', d: 720, lane: 1, cam: [3, 4, 6], look: [-25, 7, -40] },
  'lm-akuafo': { tod: 'day', d: 940, lane: 1, cam: [-3, 4, 6], look: [30, 6, -40] },
  'lm-jqb': { tod: 'day', d: 1180, lane: 1, cam: [3, 4, 6], look: [-28, 7, -40] },
  'ev-sunset': { tod: 'sunset', d: 900, lane: 1, cam: [0, 3.1, 6.5], look: [0, 1.4, -14] },
  'ev-night': { tod: 'night', d: 1500, lane: 1, cam: [0, 3.1, 6.5], look: [0, 1.4, -14], stage: [{ kind: 'coin', lane: 1, ahead: 8 }, { kind: 'coin', lane: 1, ahead: 11 }, { kind: 'coin', lane: 1, ahead: 14 }, { kind: 'car', lane: 2, ahead: 20 }] },
  'ev-hall': { tod: 'day', d: 470, lane: 2, cam: [-3, 3, 7], look: [12, 4, -30], jersey: '#d64545' },
  garage: { tod: 'sunset', d: 20, lane: 1, cam: [3.4, 1.1, 0.3], look: [0, 0.8, 0], bike: '#f5c518' },
  brands: { tod: 'day', d: 560, lane: 1, cam: [-1.5, 3.5, 6], look: [10, 5, -40] },
  ready: { tod: 'sunset', d: 2380, lane: 1, cam: [-3.5, 1.6, -6.5], look: [0.5, 1.4, 2] },
};

for (const [name, s] of Object.entries(shots)) {
  if (only && name !== only) continue;
  await page.evaluate((s) => {
    const g = window.__game;
    g.setTimeOfDay(s.tod);
    g.setLook(s.jersey ?? '#7a3db8', s.bike ?? '#e04848');
    g.cinematic(s.d, s.lane, s.cam, s.look);
    if (s.stage) g.stage(s.stage);
  }, s);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 78 });
  console.log('shot', name);
}
await browser.close();
