import * as THREE from 'three';

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, colors: string[], maxR: number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = Math.random() * maxR + 0.4;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
}

export const asphaltTexture = (wear = true) =>
  canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#45474b';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, ['#3a3c40', '#505257', '#5c5e63', '#36383b'], 1.6);
    // faint tyre wear patches
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < (wear ? 6 : 0); i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
      ctx.fillRect(Math.random() * s, 0, 18 + Math.random() * 30, s);
    }
    ctx.globalAlpha = 1;
  });

export const grassTexture = () =>
  canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5d8a3a';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 14000, ['#4f7a30', '#6b9a44', '#557f35', '#7aa64f', '#8a8a4a'], 2.2);
  });

export const concreteTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#b9b3a8';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 3000, ['#aaa498', '#c6c0b5', '#a39d92'], 1.4);
    ctx.fillStyle = '#9a948a';
    ctx.fillRect(0, 0, s, 2);
  });

export function labelTexture(text: string, accent: string) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '700 56px Sora, system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 64;
  c.width = w;
  c.height = 100;
  ctx.font = font;
  ctx.fillStyle = 'rgba(10,16,32,0.82)';
  const r = 22;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 100, r);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 92, w, 8);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 100 };
}

export function billboardTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, '#0a1020');
  g.addColorStop(1, '#1b2a52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#f5c518';
  ctx.font = '800 64px Sora, system-ui, sans-serif';
  ctx.fillText('LEGONRUSH', 36, 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 30px Sora, system-ui, sans-serif';
  ctx.fillText('Ride. Race. Connect.', 38, 170);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '600 18px Sora, system-ui, sans-serif';
  ctx.fillText('YOUR BRAND HERE', 38, 222);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- building surfaces ----------
// Drawn near-white so per-building vertex colours tint them: one texture, many shades.

/**
 * One window bay of one storey (about 3.2 m x 3.4 m), tiled by real metres on the walls:
 * a recessed glass window with louvre bands and a frame, a sill with its shadow, and the
 * floor slab line at the foot of the storey.
 */
export const facadeTexture = () =>
  canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2600, ['#f1eee6', '#ffffff', '#ece8de'], 1.6);
    // rain streaks under the sills, a staple of tropical render
    const winX = 46, winW = 164, winY = 44, winH = 128;
    const streak = ctx.createLinearGradient(0, winY + winH + 10, 0, s - 14);
    streak.addColorStop(0, 'rgba(120,110,95,0.16)');
    streak.addColorStop(1, 'rgba(120,110,95,0)');
    ctx.fillStyle = streak;
    ctx.fillRect(winX + 6, winY + winH + 10, winW - 12, s - winY - winH - 24);
    // floor slab band at the foot of the storey
    ctx.fillStyle = '#e4ded2';
    ctx.fillRect(0, s - 14, s, 14);
    ctx.fillStyle = '#cfc7b8';
    ctx.fillRect(0, s - 14, s, 2);
    // reveal shadow around the opening
    ctx.fillStyle = '#b9b2a4';
    ctx.fillRect(winX - 6, winY - 6, winW + 12, winH + 12);
    // frame
    ctx.fillStyle = '#f4f2ee';
    ctx.fillRect(winX - 3, winY - 3, winW + 6, winH + 6);
    // glass: sky reflection fading down into the dark room
    const glass = ctx.createLinearGradient(0, winY, 0, winY + winH);
    glass.addColorStop(0, '#5f7891');
    glass.addColorStop(0.45, '#2c3c4f');
    glass.addColorStop(1, '#1b2531');
    ctx.fillStyle = glass;
    ctx.fillRect(winX + 4, winY + 4, winW - 8, winH - 8);
    // diagonal glint
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(winX + 30, winY + 4); ctx.lineTo(winX + 70, winY + 4); ctx.lineTo(winX + 20, winY + winH - 4); ctx.lineTo(winX + 4, winY + winH - 4); ctx.lineTo(winX + 4, winY + 60);
    ctx.fill();
    // louvre blades in the lower panes
    ctx.fillStyle = 'rgba(210,220,228,0.28)';
    for (let y = winY + 56; y < winY + winH - 8; y += 9) ctx.fillRect(winX + 4, y, winW - 8, 2);
    // mullions and transom
    ctx.fillStyle = '#eeebe5';
    for (const x of [winX + winW / 3, winX + (2 * winW) / 3]) ctx.fillRect(x - 3, winY, 6, winH);
    ctx.fillRect(winX, winY + 48, winW, 6);
    // recess shadow along the top and left of the glass
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(winX + 4, winY + 4, winW - 8, 6);
    ctx.fillRect(winX + 4, winY + 4, 5, winH - 8);
    // sill: a lit top edge and a shadow below
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(winX - 10, winY + winH + 3, winW + 20, 8);
    ctx.fillStyle = 'rgba(70,60,50,0.35)';
    ctx.fillRect(winX - 10, winY + winH + 11, winW + 20, 4);
  });

/**
 * Which windows are lit at night, laid out exactly like facadeTexture's window
 * (one 32 px cell per bay and storey): warm, cool or off, some with a curtain.
 */
export function windowLightTexture(bays: number, storeys: number) {
  const W = 32;
  const c = document.createElement('canvas');
  c.width = bays * W;
  c.height = storeys * W;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  const k = W / 256;
  const winX = 46 * k, winW = 164 * k, winY = 44 * k, winH = 128 * k;
  let seed = 4242;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < bays; i++) for (let j = 0; j < storeys; j++) {
    const u = r();
    if (u < 0.42) continue;
    const warm = ['#ffcf7d', '#ffd99a', '#ffc46a', '#ffe7b8'];
    ctx.fillStyle = u < 0.86 ? warm[(r() * warm.length) | 0] : '#cfe4ff';
    const x = i * W + winX, y = j * W + winY;
    ctx.globalAlpha = 0.65 + r() * 0.35;
    ctx.fillRect(x + 0.8, y + 0.8, winW - 1.6, winH - 1.6);
    // a drawn curtain over part of the glass
    if (r() < 0.4) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#000';
      ctx.fillRect(x + (r() < 0.5 ? 0 : winW / 2), y, winW / 2, winH);
    }
    ctx.globalAlpha = 1;
    // mullions stay dark
    ctx.fillStyle = '#000';
    for (const m of [winX + winW / 3, winX + (2 * winW) / 3]) ctx.fillRect(i * W + m - 0.4, y, 0.8, winH);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Clay roof tiles in rows (one tile = 2 m x 2 m of roof), near-white so roofs can be tinted. */
export const roofTileTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 0, s, s);
    const rows = 8, cols = 6, rh = s / rows, cw = s / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (cw / 2);
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + off;
        // each tile is a barrel: lit in the middle, darker at the sides
        const g = ctx.createLinearGradient(x, 0, x + cw, 0);
        const tone = 0.86 + Math.random() * 0.14;
        const mid = Math.round(255 * tone), edge = Math.round(190 * tone);
        g.addColorStop(0, `rgb(${edge},${edge},${edge})`);
        g.addColorStop(0.45, `rgb(${mid},${mid},${mid})`);
        g.addColorStop(1, `rgb(${edge - 20},${edge - 20},${edge - 20})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, r * rh, cw - 2, rh);
      }
      // shadow cast by the row above
      ctx.fillStyle = 'rgba(40,20,10,0.35)';
      ctx.fillRect(0, r * rh, s, 2.5);
    }
    // weathering
    ctx.globalAlpha = 0.12;
    speckle(ctx, s, 500, ['#555', '#fff', '#777'], 2);
    ctx.globalAlpha = 1;
  });

/** Low-frequency light and dry patches spread over hundreds of metres of grass. */
export const grassMacroTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 6 + Math.random() * 26;
      const v = Math.random() < 0.5 ? 90 : 175;
      // red channel: brightness, green channel: dryness
      const dry = Math.random() < 0.35 ? 200 : 110;
      for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${v},${dry},128,0.5)`);
        g.addColorStop(1, `rgba(${v},${dry},128,0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  });

/** Helmet shell: white with long vent slots, tinted by the helmet colour. */
export const helmetTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    // sphere UVs: u runs round the head, v from the crown (top of canvas) down
    ctx.fillStyle = '#16181d';
    // u = 0.75 faces forward and 0.25 backward, so slots there run front to back over the crown
    for (const u of [0.66, 0.72, 0.78, 0.84, 0.19, 0.25, 0.31]) {
      ctx.beginPath();
      ctx.roundRect(u * s - 3.5, s * 0.16, 7, s * 0.46, 3.5);
      ctx.fill();
    }
    // a contrasting band round the rim
    ctx.fillStyle = '#c9cdd3';
    ctx.fillRect(0, s * 0.86, s, s * 0.14);
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(0, s * 0.93, s, s * 0.07);
  });

/** Mown stripes for football pitches, 2 light and 2 dark bands per tile. */
export const pitchTexture = () =>
  canvasTexture(64, (ctx, s) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#d8f0c8' : '#ffffff';
      ctx.fillRect((i * s) / 4, 0, s / 4, s);
    }
    ctx.globalAlpha = 0.25;
    speckle(ctx, s, 500, ['#9fbf8a', '#ffffff'], 1.2);
    ctx.globalAlpha = 1;
  });
