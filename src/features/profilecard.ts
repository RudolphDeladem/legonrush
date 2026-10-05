// Shareable profile card: an image drawn on a canvas, shared with the phone's share sheet or downloaded.
import { hallById } from '../data/campus';
import { CAMPUS_LOOP, RACES } from '../game/routes';
import { levelFor, type Profile } from '../state';
import { fx } from './icons';
import { BADGES } from './achievements';
import { H, esc, on, screen } from './host';

const W = 1080, HH = 1350;

/** the rider's best race time, with the route name */
function bestTime(p: Profile): { name: string; time: number } | null {
  const routes = [{ id: CAMPUS_LOOP.id, name: CAMPUS_LOOP.name }, ...RACES.map((r) => ({ id: r.id, name: r.name }))];
  const loop = p.bestTimes[CAMPUS_LOOP.id];
  if (loop !== undefined) return { name: CAMPUS_LOOP.name, time: loop };
  for (const r of routes) if (p.bestTimes[r.id] !== undefined) return { name: r.name, time: p.bestTimes[r.id] };
  return null;
}
const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;

/** Draws the card. Returns the canvas (1080 x 1350, a portrait post). */
export function drawProfileCard(p: Profile, canvas = document.createElement('canvas')) {
  canvas.width = W;
  canvas.height = HH;
  const c = canvas.getContext('2d')!;
  const hall = hallById(p.hall);
  const level = levelFor(p.xp);
  const best = bestTime(p);
  const badges = BADGES.filter((b) => p.badges?.includes(b.id)).length;

  // background: navy with a soft hall-colour glow and gold stripe
  const bg = c.createLinearGradient(0, 0, 0, HH);
  bg.addColorStop(0, '#0b1530');
  bg.addColorStop(1, '#16244d');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, HH);
  const glow = c.createRadialGradient(W * 0.8, 260, 40, W * 0.8, 260, 700);
  glow.addColorStop(0, hall.color + 'aa');
  glow.addColorStop(1, 'rgba(11,21,48,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, HH);
  c.fillStyle = '#ffd21f';
  c.fillRect(0, 0, W, 14);
  // road lines
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  c.lineWidth = 60;
  c.beginPath();
  c.moveTo(-100, HH - 120);
  c.bezierCurveTo(300, HH - 420, 700, HH - 80, W + 100, HH - 380);
  c.stroke();

  // wordmark
  c.textBaseline = 'alphabetic';
  c.font = 'italic 800 64px "Barlow Condensed", Sora, sans-serif';
  c.fillStyle = '#ffffff';
  c.fillText('LEGON', 80, 130);
  const lw = c.measureText('LEGON').width;
  c.fillStyle = '#ffd21f';
  c.fillText('RUSH', 80 + lw, 130);
  c.font = '600 28px Sora, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fillText('University of Ghana, Legon', 80, 176);

  // avatar
  const ax = 80 + 110, ay = 380;
  c.fillStyle = hall.color;
  c.beginPath();
  c.arc(ax, ay, 110, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 10;
  c.strokeStyle = '#ffd21f';
  c.stroke();
  c.fillStyle = '#ffffff';
  c.font = '800 120px Sora, sans-serif';
  c.textAlign = 'center';
  c.fillText((p.name[0] ?? '?').toUpperCase(), ax, ay + 42);
  c.textAlign = 'left';

  // name
  const nx = 340;
  c.fillStyle = '#ffffff';
  let size = 84;
  c.font = `800 ${size}px "Barlow Condensed", Sora, sans-serif`;
  while (c.measureText(p.name).width > W - nx - 70 && size > 44) c.font = `800 ${(size -= 4)}px "Barlow Condensed", Sora, sans-serif`;
  c.fillText(p.name, nx, 370);
  c.font = '600 32px Sora, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText(p.username ? '@' + p.username : 'Campus rider', nx, 420);
  // hall pill
  c.font = '700 30px Sora, sans-serif';
  const hallText = hall.id === 'none' ? 'Non-resident' : hall.name;
  const hw = c.measureText(hallText).width + 56;
  c.fillStyle = hall.color;
  roundRect(c, nx, 448, hw, 56, 28);
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillText(hallText, nx + 28, 487);

  // stat tiles
  const tiles: [string, string][] = [
    ['LEVEL', String(level)],
    ['KM RIDDEN', (p.totalDistance / 1000).toFixed(1)],
    ['RACES WON', String(p.wins)],
    ['BADGES', `${badges}/${BADGES.length}`],
  ];
  const tw = (W - 160 - 40) / 2, th = 210;
  tiles.forEach(([label, value], i) => {
    const x = 80 + (i % 2) * (tw + 40), y = 600 + Math.floor(i / 2) * (th + 36);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(c, x, y, tw, th, 28);
    c.fill();
    c.fillStyle = '#ffd21f';
    c.font = '800 96px "Barlow Condensed", Sora, sans-serif';
    c.fillText(value, x + 36, y + 120);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = '700 28px Sora, sans-serif';
    c.fillText(label, x + 36, y + 170);
  });

  // best time
  const by = 600 + 2 * (th + 36) + 10;
  c.fillStyle = '#ffd21f';
  roundRect(c, 80, by, W - 160, 150, 28);
  c.fill();
  c.fillStyle = '#0b1530';
  c.font = '700 28px Sora, sans-serif';
  c.fillText(best ? `BEST TIME · ${best.name.toUpperCase()}` : 'BEST TIME', 116, by + 52);
  c.font = '800 72px "Barlow Condensed", Sora, sans-serif';
  c.fillText(best ? time(best.time) : 'Not raced yet', 116, by + 122);

  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.font = '600 30px Sora, sans-serif';
  c.textAlign = 'center';
  c.fillText('Ride the real campus. Race me on LEGONRUSH.', W / 2, HH - 60);
  c.textAlign = 'left';
  return canvas;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function profileCardScreen(back: () => void = () => H().home('you')) {
  const h = H();
  const p = h.profile();
  screen(`
    <p class="kicker">${fx.card} Profile card</p>
    <h1 class="title">Show your ride</h1>
    <p class="muted">Share your card on WhatsApp, Snapchat or Instagram.</p>
    <canvas class="fx-cardimg" id="fxCard" width="${W}" height="${HH}" aria-label="Your LEGONRUSH profile card"></canvas>
    <div class="two">
      <button class="btn btn-primary" id="fxShare">${fx.share} Share</button>
      <a class="btn btn-ghost" id="fxSave" download="legonrush-${esc((p.username || p.name).replace(/[^A-Za-z0-9_-]/g, '') || 'rider')}.png">${fx.download} Download</a>
    </div>
    <p class="muted small" id="fxNote" hidden></p>
  `, back);
  const canvas = h.app.querySelector<HTMLCanvasElement>('#fxCard')!;
  const draw = () => {
    drawProfileCard(p, canvas);
    h.app.querySelector<HTMLAnchorElement>('#fxSave')!.href = canvas.toDataURL('image/png');
  };
  draw();
  // the fonts may still be loading the first time: draw again once they are in
  void document.fonts?.ready.then(draw);
  on('#fxShare', 'click', async () => {
    const note = h.app.querySelector<HTMLElement>('#fxNote')!;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    const file = blob && new File([blob], 'legonrush-card.png', { type: 'image/png' });
    const text = `I'm level ${levelFor(p.xp)} on LEGONRUSH with ${(p.totalDistance / 1000).toFixed(1)} km ridden. Ride with me:`;
    const url = `${location.origin}${import.meta.env.BASE_URL}play/`;
    try {
      if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text, title: 'LEGONRUSH' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    // no image sharing here: share the link, and the card can be downloaded
    h.share(text, url, note);
  });
}
