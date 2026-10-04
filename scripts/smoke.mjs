// Smoke test: opens the built game, starts a guest ride and checks the rider moves
// with no errors. Run after `npm run build`: `node scripts/smoke.mjs`.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const fail = (msg) => { console.error(`smoke: ${msg}`); server.kill(); process.exit(1); };

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/play/`)).ok) break; } catch { /* not up yet */ }
    if (i > 60) fail('preview server did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/play/`);
  await page.click('#guest', { timeout: 90000 });
  await page.waitForSelector('#dist', { timeout: 30000 });
  // the tutorial ride starts straight away; wait until the rider has covered some road
  await page.waitForFunction(() => Number(document.querySelector('#dist')?.textContent) >= 0.03, null, { timeout: 120000 });
  console.log(`smoke: rode ${await page.textContent('#dist')} km`);
  await browser.close();
  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
  console.log('smoke: ok');
  server.kill();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
