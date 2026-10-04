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

export const asphaltTexture = () =>
  canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#45474b';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, ['#3a3c40', '#505257', '#5c5e63', '#36383b'], 1.6);
    // faint tyre wear patches
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 6; i++) {
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

export const wallTexture = () =>
  canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 1500, ['#e6dcc7', '#f5efe2'], 1.2);
    // window grid: two storeys x four bays per tile
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 8 + col * 30;
        const y = 14 + row * 60;
        ctx.fillStyle = '#3c4a57';
        ctx.fillRect(x, y, 18, 30);
        ctx.fillStyle = '#6d8296';
        ctx.fillRect(x + 2, y + 2, 14, 12);
      }
    }
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
