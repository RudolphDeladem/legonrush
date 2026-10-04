// Draws the landing-page illustrations as flat SVG scenes into public/art.
// Every scene is built from the same small kit (sky, palms, halls, gate, riders)
// so the set stays consistent and each file stays a few KB.
// Usage: node scripts/landing-art.mjs [sceneName]
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/art';
const only = process.argv[2];

// palette, matched to the logo and landing page
const C = {
  navy: '#0b1530', navy2: '#16244d', gold: '#ffd21f', goldDeep: '#f5b800',
  wall: '#f6f1e7', wallShade: '#ddd5c6', roof: '#c4532f', roofDark: '#9e3f22',
  glass: '#3b5578', road: '#596273', roadDark: '#465061', line: '#f4f4f4',
  grass: '#79c25f', grass2: '#5aa64a', hedge: '#3f8f45', leaf: '#2f8a3f', leaf2: '#46a84f', leaf3: '#226b32',
  trunk: '#8a6a4a', skin: ['#7a4a2e', '#5c3a24', '#8d5a3b', '#6b4029'], hair: '#1b1410', shorts: '#1f2937',
};
const JERSEYS = ['#ffd21f', '#2563eb', '#e04848', '#16a34a', '#7c3aed', '#f97316', '#ffffff', '#0b1530'];

const r1 = (n) => Math.round(n * 10) / 10;
const P = (...pts) => pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ');
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Scene {
  constructor(w, h, seed = 7) { this.w = w; this.h = h; this.parts = []; this.defs = []; this.ids = 0; this.rand = rng(seed); }
  add(...s) { this.parts.push(...s); return this; }
  grad(stops, x2 = 0, y2 = 1) {
    const id = `g${this.ids++}`;
    this.defs.push(`<linearGradient id="${id}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`);
    return `url(#${id})`;
  }
  rgrad(stops) {
    const id = `g${this.ids++}`;
    this.defs.push(`<radialGradient id="${id}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
    return `url(#${id})`;
  }
  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" preserveAspectRatio="xMidYMid slice">` +
      (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '') + this.parts.join('') + '</svg>';
  }
}

// ---------- backgrounds ----------
const SKIES = {
  day: [[0, '#4aa8ea'], [0.6, '#a9dcfb'], [1, '#e6f6ff']],
  sunset: [[0, '#2c2a5e'], [0.45, '#b6527a'], [0.75, '#f08a4b'], [1, '#ffd27a']],
  night: [[0, '#070d24'], [0.6, '#1c1e55'], [1, '#3b2a74']],
};
function sky(s, tod, horizon) {
  s.add(`<rect width="${s.w}" height="${horizon + 2}" fill="${s.grad(SKIES[tod])}"/>`);
  if (tod === 'night') {
    for (let i = 0; i < 40; i++) s.add(`<circle cx="${r1(s.rand() * s.w)}" cy="${r1(s.rand() * horizon * 0.7)}" r="${r1(0.6 + s.rand() * 1.1)}" fill="#fff" opacity="${r1(0.4 + s.rand() * 0.6)}"/>`);
  }
}
function cloud(s, x, y, k = 1, o = 0.95) {
  s.add(`<g fill="#fff" opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${r1(46 * k)}" ry="${r1(14 * k)}"/><circle cx="${r1(x - 16 * k)}" cy="${r1(y - 10 * k)}" r="${r1(16 * k)}"/><circle cx="${r1(x + 10 * k)}" cy="${r1(y - 16 * k)}" r="${r1(21 * k)}"/></g>`);
}
function sun(s, x, y, r, color = '#fff3c4', glow = '#ffd27a') {
  s.add(`<circle cx="${x}" cy="${y}" r="${r * 3}" fill="${s.rgrad([[0, glow, 0.7], [1, glow, 0]])}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`);
}
function ground(s, horizon, color = C.grass) {
  s.add(`<rect y="${horizon}" width="${s.w}" height="${s.h - horizon}" fill="${s.grad([[0, C.grass2], [1, color]])}"/>`);
}
// bumpy line of distant trees sitting on the horizon
function treeline(s, horizon, color = '#4f9a55', height = 22, step = 26) {
  let d = `M0,${horizon}`;
  for (let x = 0; x <= s.w + step; x += step) d += ` Q${r1(x + step / 2)},${r1(horizon - height - s.rand() * height)} ${r1(x + step)},${horizon}`;
  s.add(`<path d="${d} V${horizon + 4} H0Z" fill="${color}"/>`);
}
// tint the whole scene for sunset or night, before lights are added on top
function tint(s, tod) {
  if (tod === 'sunset') s.add(`<rect width="${s.w}" height="${s.h}" fill="${s.grad([[0, '#5b2b6e', 0.15], [1, '#e0703a', 0.35]])}"/>`);
  if (tod === 'night') s.add(`<rect width="${s.w}" height="${s.h}" fill="#0a1033" opacity="0.62"/>`);
}

// ---------- campus kit ----------
function palm(s, x, y, h, lean = 0.15, k = 1, dark = false) {
  const tx = x + h * lean, ty = y - h;
  const g = dark ? ['#1d3b2a', '#16301f', '#22462f'] : [C.leaf, C.leaf2, C.leaf3];
  let out = `<path d="M${r1(x - 4 * k)},${y} Q${r1(x + h * lean * 0.2)},${r1(y - h * 0.5)} ${r1(tx - 1.5 * k)},${r1(ty)} L${r1(tx + 1.5 * k)},${r1(ty)} Q${r1(x + h * lean * 0.2 + 5 * k)},${r1(y - h * 0.5)} ${r1(x + 4 * k)},${y}Z" fill="${dark ? '#2a2420' : C.trunk}"/>`;
  const leaf = `M0,0 C${r1(18 * k)},${r1(-16 * k)} ${r1(46 * k)},${r1(-14 * k)} ${r1(64 * k)},${r1(10 * k)} C${r1(44 * k)},${r1(-2 * k)} ${r1(20 * k)},${r1(-1 * k)} 0,0Z`;
  const angles = [-70, -38, -8, 22, 48];
  for (const [i, a] of angles.entries()) {
    out += `<path d="${leaf}" fill="${g[i % 3]}" transform="translate(${r1(tx)},${r1(ty)}) rotate(${a})"/>`;
    out += `<path d="${leaf}" fill="${g[(i + 1) % 3]}" transform="translate(${r1(tx)},${r1(ty)}) scale(-1,1) rotate(${a + 6})"/>`;
  }
  s.add(out + `<circle cx="${r1(tx)}" cy="${r1(ty + 2 * k)}" r="${r1(4 * k)}" fill="${dark ? '#2a2420' : '#6b4f33'}"/>`);
}
function tree(s, x, y, r, dark = false) {
  const g = dark ? ['#16301f', '#1d3b2a'] : [C.leaf3, C.leaf];
  s.add(`<rect x="${r1(x - r * 0.08)}" y="${r1(y - r * 0.9)}" width="${r1(r * 0.16)}" height="${r1(r * 0.9)}" fill="${dark ? '#2a2420' : C.trunk}"/>` +
    `<g fill="${g[0]}"><circle cx="${r1(x - r * 0.5)}" cy="${r1(y - r * 1.1)}" r="${r1(r * 0.6)}"/><circle cx="${r1(x + r * 0.5)}" cy="${r1(y - r * 1.15)}" r="${r1(r * 0.62)}"/></g>` +
    `<circle cx="${x}" cy="${r1(y - r * 1.5)}" r="${r1(r * 0.7)}" fill="${g[1]}"/>`);
}
function hedge(s, x, y, w, h = 10) {
  s.add(`<rect x="${x}" y="${r1(y - h)}" width="${w}" height="${h}" rx="${r1(h / 2)}" fill="${C.hedge}"/>`);
}
// whitewashed UG block with a terracotta roof and rows of windows or arches
function building(s, x, y, w, h, { floors = 2, arches = false, roof = C.roof, wall = C.wall, lit = false } = {}) {
  let out = `<rect x="${x}" y="${r1(y - h)}" width="${w}" height="${h}" fill="${wall}"/>`;
  out += `<rect x="${x}" y="${r1(y - h)}" width="${w}" height="${r1(h * 0.08)}" fill="${C.wallShade}"/>`;
  const rh = Math.max(6, h * 0.22);
  out += `<polygon points="${P([x - 5, y - h], [x + w + 5, y - h], [x + w - rh * 0.6, y - h - rh], [x + rh * 0.6, y - h - rh])}" fill="${roof}"/>`;
  out += `<rect x="${r1(x - 5)}" y="${r1(y - h - 2)}" width="${r1(w + 10)}" height="3" fill="${C.roofDark}"/>`;
  const fh = (h * 0.86) / floors, cols = Math.max(2, Math.floor(w / 15)), cw = w / cols;
  const win = lit ? '#ffd76a' : C.glass;
  for (let f = 0; f < floors; f++) {
    const wy = y - h * 0.9 + f * fh + fh * 0.25;
    for (let c = 0; c < cols; c++) {
      const wx = x + c * cw + cw * 0.28, ww = cw * 0.44, wh = fh * 0.55;
      if (arches && f === floors - 1) out += `<path d="M${r1(wx)},${r1(wy + wh)} V${r1(wy + ww / 2)} a${r1(ww / 2)},${r1(ww / 2)} 0 0 1 ${r1(ww)},0 V${r1(wy + wh)}Z" fill="${C.wallShade}"/>`;
      else if (!lit || (c * 7 + f * 3) % 4) out += `<rect x="${r1(wx)}" y="${r1(wy)}" width="${r1(ww)}" height="${r1(wh)}" fill="${win}"/>`;
    }
  }
  s.add(out);
}
// Balme-style clock tower: white shaft, clock face, red pyramid cap
function tower(s, x, y, w, h, { roof = C.roof, wall = C.wall, mural = false } = {}) {
  let out = `<rect x="${r1(x - w / 2)}" y="${r1(y - h)}" width="${w}" height="${h}" fill="${wall}"/><rect x="${r1(x + w * 0.2)}" y="${r1(y - h)}" width="${r1(w * 0.3)}" height="${h}" fill="${C.wallShade}"/>`;
  if (mural) {
    const cols = ['#2563eb', '#ffd21f', '#e04848', '#16a34a'];
    for (let i = 0; i < 6; i++) out += `<rect x="${r1(x - w * 0.32)}" y="${r1(y - h * 0.85 + i * h * 0.12)}" width="${r1(w * 0.64)}" height="${r1(h * 0.1)}" fill="${cols[i % 4]}"/>`;
  } else {
    for (let i = 0; i < 3; i++) out += `<rect x="${r1(x - w * 0.12)}" y="${r1(y - h * 0.7 + i * h * 0.2)}" width="${r1(w * 0.24)}" height="${r1(h * 0.1)}" rx="${r1(w * 0.1)}" fill="${C.glass}"/>`;
  }
  const cw = w * 1.25;
  out += `<rect x="${r1(x - cw / 2)}" y="${r1(y - h - cw * 0.9)}" width="${r1(cw)}" height="${r1(cw * 0.9)}" fill="${wall}"/>`;
  out += `<circle cx="${x}" cy="${r1(y - h - cw * 0.45)}" r="${r1(cw * 0.3)}" fill="#fff" stroke="${C.navy}" stroke-width="${r1(cw * 0.05)}"/>`;
  out += `<path d="M${x},${r1(y - h - cw * 0.45)} v${r1(-cw * 0.2)} M${x},${r1(y - h - cw * 0.45)} h${r1(cw * 0.14)}" stroke="${C.navy}" stroke-width="${r1(cw * 0.04)}" stroke-linecap="round"/>`;
  out += `<polygon points="${P([x - cw / 2 - 3, y - h - cw * 0.9], [x + cw / 2 + 3, y - h - cw * 0.9], [x, y - h - cw * 2])}" fill="${roof}"/>`;
  s.add(out);
}
// the main gate: pillars, a lettered beam and a central clock tower
function gate(s, x, y, w, { lit = false } = {}) {
  const ph = w * 0.32, pw = w * 0.06, bh = w * 0.075;
  tower(s, x, y - ph - bh + 2, w * 0.1, w * 0.22);
  let out = '';
  for (const px of [x - w / 2, x - w * 0.18, x + w * 0.18 - pw, x + w / 2 - pw]) out += `<rect x="${r1(px)}" y="${r1(y - ph)}" width="${r1(pw)}" height="${r1(ph)}" fill="${C.wall}"/><rect x="${r1(px + pw * 0.6)}" y="${r1(y - ph)}" width="${r1(pw * 0.4)}" height="${r1(ph)}" fill="${C.wallShade}"/>`;
  out += `<rect x="${r1(x - w / 2 - 6)}" y="${r1(y - ph - bh)}" width="${r1(w + 12)}" height="${r1(bh)}" fill="${C.wall}"/>`;
  out += `<rect x="${r1(x - w / 2 - 8)}" y="${r1(y - ph - bh - 4)}" width="${r1(w + 16)}" height="5" fill="${C.roof}"/>`;
  out += `<text x="${x}" y="${r1(y - ph - bh * 0.28)}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${r1(bh * 0.6)}" letter-spacing="${r1(bh * 0.12)}" text-anchor="middle" fill="${lit ? '#ffd76a' : C.navy}">UNIVERSITY OF GHANA</text>`;
  s.add(out);
}
// perspective road from the bottom edge to a vanishing point
function road(s, vx, vy, x0, x1, { dash = true, color = C.road, neon } = {}) {
  s.add(`<polygon points="${P([x0, s.h], [x1, s.h], [vx + 6, vy], [vx - 6, vy])}" fill="${s.grad([[0, C.roadDark], [1, color]])}"/>`);
  const edge = neon ?? C.line;
  s.add(`<path d="M${r1(x0 + (x1 - x0) * 0.04)},${s.h} L${r1(vx - 5)},${vy} M${r1(x1 - (x1 - x0) * 0.04)},${s.h} L${r1(vx + 5)},${vy}" stroke="${edge}" stroke-width="2.5" fill="none" opacity="0.9"/>`);
  if (!dash) return;
  const cx = (x0 + x1) / 2;
  for (let t = 0.05; t < 0.95; t += 0.16) {
    const a = t, b = t + 0.07;
    const pa = [cx + (vx - cx) * a, s.h + (vy - s.h) * a], pb = [cx + (vx - cx) * b, s.h + (vy - s.h) * b];
    const wa = (1 - a) * 5 + 0.6, wb = (1 - b) * 5 + 0.6;
    s.add(`<polygon points="${P([pa[0] - wa, pa[1]], [pa[0] + wa, pa[1]], [pb[0] + wb, pb[1]], [pb[0] - wb, pb[1]])}" fill="${neon ?? C.line}"/>`);
  }
}
function shadow(s, x, y, rx, ry = rx * 0.12) {
  s.add(`<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="#000" opacity="0.18"/>`);
}

// ---------- people ----------
// side-on rider (facing right), origin at the rear wheel's ground contact
function rider(s, x, y, k, { jersey = C.gold, bike = C.navy, skin = C.skin[0], pack = C.navy, flip = false, noRider = false, wheel = '#15171c', glow } = {}) {
  shadow(s, x + 50 * k * (flip ? -1 : 1), y, 62 * k);
  const L = (pts, c, w) => `<polyline points="${P(...pts)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let g = '';
  for (const cx of [0, 100]) g += `<circle cx="${cx}" cy="-28" r="26" fill="none" stroke="${wheel}" stroke-width="5"/><circle cx="${cx}" cy="-28" r="20" fill="none" stroke="#9aa3b2" stroke-width="0.8" stroke-dasharray="2 6"/><circle cx="${cx}" cy="-28" r="3" fill="#9aa3b2"/>`;
  if (glow) g += `<circle cx="0" cy="-28" r="26" fill="none" stroke="${glow}" stroke-width="1.5"/><circle cx="100" cy="-28" r="26" fill="none" stroke="${glow}" stroke-width="1.5"/>`;
  // far leg behind the frame
  if (!noRider) g += L([[36, -88], [56, -66], [40, -24]], C.shorts, 10) + L([[40, -24], [50, -22]], '#111', 6);
  g += L([[0, -28], [42, -26], [86, -70], [100, -28]], bike, 5) + L([[0, -28], [32, -80], [42, -26]], bike, 5) + L([[32, -80], [86, -76]], bike, 5);
  g += L([[86, -76], [90, -88], [98, -88]], '#2b2f38', 4) + L([[24, -84], [40, -84]], '#111', 5) + `<circle cx="42" cy="-26" r="7" fill="none" stroke="#2b2f38" stroke-width="3"/>`;
  if (!noRider) {
    g += L([[34, -92], [62, -68], [52, -36]], C.shorts, 12) + L([[62, -68], [52, -36]], skin, 9) + L([[50, -34], [62, -32]], '#fff', 7);
    g += L([[34, -92], [62, -128]], jersey, 26);
    if (pack) g += `<rect x="20" y="-140" width="24" height="34" rx="7" fill="${pack}" transform="rotate(38 32 -123)"/>`;
    g += L([[66, -124], [80, -104], [94, -90]], skin, 8);
    g += `<circle cx="78" cy="-143" r="11" fill="${skin}"/><path d="M67,-145 a11,11 0 0 1 22,-2 l-6,-1 -9,4 -7,2Z" fill="${C.hair}"/>`;
    g += `<rect x="80" y="-147" width="10" height="4" rx="2" fill="#111"/>`;
  }
  s.add(`<g transform="translate(${r1(x)},${r1(y)}) scale(${flip ? -k : k},${k})">${g}</g>`);
}
// rider seen head-on (or from behind), origin at the wheel's ground contact
function riderFront(s, x, y, k, { jersey = C.gold, skin = C.skin[1], back = false, glow } = {}) {
  shadow(s, x, y, 18 * k, 4 * k);
  const L = (pts, c, w) => `<polyline points="${P(...pts)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let g = `<rect x="-3.5" y="-56" width="7" height="56" rx="3.5" fill="${glow ?? '#15171c'}"/>`;
  g += L([[-7, -70], [-7, -42], [-4, -20]], C.shorts, 9) + L([[7, -70], [7, -46], [4, -30]], C.shorts, 9) + L([[-4, -36], [-4, -20]], skin, 6);
  g += L([[-20, -80], [20, -80]], '#2b2f38', 4);
  g += `<path d="M-17,-108 L17,-108 L12,-68 L-12,-68Z" fill="${jersey}"/>`;
  g += L([[-16, -105], [-21, -80]], skin, 7) + L([[16, -105], [21, -80]], skin, 7);
  g += `<circle cx="0" cy="-120" r="10" fill="${skin}"/><path d="M-10,-122 a10,10 0 0 1 20,0 l-4,-2 -12,0Z" fill="${C.hair}"/>`;
  if (!back) g += `<rect x="-7" y="-124" width="14" height="4" rx="2" fill="#111"/>`;
  else g += `<rect x="-10" y="-106" width="20" height="26" rx="5" fill="${C.navy}"/>`;
  s.add(`<g transform="translate(${r1(x)},${r1(y)}) scale(${k})">${g}</g>`);
}
// standing student; pose: 'down' | 'up' | 'wave' | 'talk'
function person(s, x, y, k, { shirt = C.gold, pants = C.shorts, skin = C.skin[0], pose = 'down', hoodie = false, back = false, mark = false } = {}) {
  const L = (pts, c, w) => `<polyline points="${P(...pts)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let g = L([[-7, -4], [-8, -52]], pants, 12) + L([[7, -4], [8, -52]], pants, 12) + `<rect x="-14" y="-6" width="12" height="6" rx="3" fill="#fff"/><rect x="2" y="-6" width="12" height="6" rx="3" fill="#fff"/>`;
  const arms = {
    down: [[[-17, -96], [-22, -70], [-20, -52]], [[17, -96], [22, -70], [20, -52]]],
    up: [[[-17, -96], [-30, -118], [-34, -142]], [[17, -96], [30, -118], [34, -142]]],
    wave: [[[-17, -96], [-22, -70], [-20, -52]], [[17, -96], [32, -112], [36, -136]]],
    talk: [[[-17, -96], [-22, -72], [-10, -62]], [[17, -96], [26, -76], [34, -82]]],
  }[pose];
  for (const a of arms) g += L(a, hoodie ? shirt : skin, hoodie ? 10 : 8);
  g += `<path d="M-18,-100 Q0,-106 18,-100 L15,-48 L-15,-48Z" fill="${shirt}"/>`;
  if (mark) g += `<path d="M-6,-86 L0,-74 L6,-86 M-3,-86 L3,-86" stroke="${C.gold}" stroke-width="3" fill="none"/>`;
  g += `<rect x="-5" y="-108" width="10" height="8" fill="${skin}"/><circle cx="0" cy="-118" r="12" fill="${skin}"/>`;
  g += back ? `<path d="M-12,-118 a12,12 0 0 1 24,0 q0,6 -2,8 h-20 q-2,-2 -2,-8Z" fill="${C.hair}"/>` : `<path d="M-12,-120 a12,12 0 0 1 24,0 l-5,-3 -14,0Z" fill="${C.hair}"/>`;
  if (hoodie) g += `<path d="M-14,-102 Q0,-94 14,-102" stroke="${C.navy2}" stroke-width="4" fill="none"/>`;
  s.add(`<g transform="translate(${r1(x)},${r1(y)}) scale(${k})">${g}</g>`);
}
function car(s, x, y, k, color = '#e04848') {
  shadow(s, x + 60 * k, y, 70 * k);
  s.add(`<g transform="translate(${r1(x)},${r1(y)}) scale(${k})"><path d="M0,-14 V-36 Q2,-44 14,-46 L34,-48 L50,-68 Q54,-72 62,-72 H96 Q104,-72 108,-66 L120,-48 L134,-46 Q142,-44 142,-36 V-14Z" fill="${color}"/><path d="M40,-50 L54,-66 H76 V-50Z M82,-50 V-66 H100 L112,-50Z" fill="#cfe3f5"/><rect x="134" y="-38" width="8" height="6" fill="#ffe08a"/><circle cx="32" cy="-14" r="13" fill="#15171c"/><circle cx="112" cy="-14" r="13" fill="#15171c"/><circle cx="32" cy="-14" r="5" fill="#9aa3b2"/><circle cx="112" cy="-14" r="5" fill="#9aa3b2"/></g>`);
}
function lamp(s, x, y, h, lit = false) {
  s.add(`<rect x="${r1(x - 1.5)}" y="${r1(y - h)}" width="3" height="${h}" fill="#3b4252"/><rect x="${r1(x - 7)}" y="${r1(y - h - 3)}" width="14" height="4" rx="2" fill="#3b4252"/>`);
  if (lit) s.add(`<circle cx="${x}" cy="${r1(y - h)}" r="${r1(h * 0.35)}" fill="${s.rgrad([[0, '#ffe08a', 0.8], [1, '#ffe08a', 0]])}"/>`);
}
function flag(s, x, y, h, color) {
  s.add(`<rect x="${x}" y="${r1(y - h)}" width="2.5" height="${h}" fill="#4b5563"/><path d="M${r1(x + 2.5)},${r1(y - h)} h${r1(h * 0.45)} l-6,${r1(h * 0.12)} 6,${r1(h * 0.12)} h${r1(-h * 0.45)}Z" fill="${color}"/>`);
}

// ---------- scenes ----------
const scenes = {
  hero() {
    const s = new Scene(840, 634, 3), hz = 352;
    sky(s, 'day', hz); cloud(s, 380, 80, 1.2); cloud(s, 700, 60, 1.5); cloud(s, 560, 150, 0.8, 0.8);
    treeline(s, hz, '#5ea35c', 26);
    building(s, 300, hz + 6, 120, 70, { arches: true }); building(s, 700, hz + 6, 140, 80, { floors: 3 });
    ground(s, hz);
    gate(s, 540, hz + 14, 400);
    road(s, 540, hz + 14, 120, 1000);
    for (const [x, h, l] of [[300, 130, 0.08], [790, 140, -0.1], [330, 80, 0.05]]) palm(s, x, hz + 30, h, l, 0.9);
    for (const [x, y, k, j] of [[510, 400, 0.32, 3], [575, 404, 0.3, 1], [545, 392, 0.26, 4], [480, 410, 0.36, 2], [610, 418, 0.38, 6]]) riderFront(s, x, y, k, { jersey: JERSEYS[j], skin: C.skin[x % 4] });
    palm(s, 860, 640, 500, -0.1, 2.2);
    palm(s, 175, 610, 430, 0.14, 2.1);
    riderFront(s, 700, 560, 1.05, { jersey: C.goldDeep, skin: C.skin[2] });
    rider(s, 270, 612, 2.2, { jersey: '#ffffff', bike: '#111827', pack: C.navy, skin: C.skin[1] });
    return s;
  },
  about() {
    // the campus from above: the Balme tower over the quad, roundabout in front
    const s = new Scene(760, 298, 11), hz = 70;
    sky(s, 'day', hz); cloud(s, 120, 40, 0.6); cloud(s, 640, 30, 0.7);
    treeline(s, hz, '#5ea35c', 12, 18);
    ground(s, hz);
    for (let i = 0; i < 9; i++) building(s, 20 + i * 82, hz + 22, 64, 24, { floors: 2 });
    tower(s, 380, hz + 60, 26, 70);
    building(s, 250, hz + 62, 104, 34, { arches: true }); building(s, 406, hz + 62, 104, 34, { arches: true });
    building(s, 30, hz + 90, 150, 44, { floors: 2 }); building(s, 580, hz + 90, 150, 44, { floors: 2 });
    s.add(`<ellipse cx="380" cy="250" rx="300" ry="64" fill="${C.road}"/><ellipse cx="380" cy="250" rx="230" ry="44" fill="${C.grass}"/><ellipse cx="380" cy="250" rx="230" ry="44" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="14 12" transform="scale(1.14 1.2) translate(-47 -42)"/><ellipse cx="380" cy="250" rx="90" ry="18" fill="${C.leaf2}"/><circle cx="380" cy="246" r="9" fill="#fff"/>`);
    for (const [x, y] of [[180, 236], [580, 236], [300, 266], [460, 266]]) palm(s, x, y, 60, 0.05, 0.6);
    for (const [x, y] of [[40, 200], [720, 200], [90, 296], [680, 296]]) tree(s, x, y, 26);
    for (const [x, y, k, j] of [[120, 286, 0.3, 0], [600, 290, 0.3, 1], [250, 232, 0.2, 2]]) rider(s, x, y, k, { jersey: JERSEYS[j] });
    return s;
  },
  ride() {
    const s = new Scene(400, 480, 5), hz = 250;
    sky(s, 'day', hz); cloud(s, 300, 70, 0.9);
    treeline(s, hz); building(s, 160, hz + 4, 150, 60, { arches: true });
    ground(s, hz);
    s.add(`<polygon points="${P([0, 400], [400, 380], [400, 480], [0, 480])}" fill="${C.road}"/><path d="M0,438 L400,428" stroke="#fff" stroke-width="3" stroke-dasharray="26 18"/>`);
    palm(s, 360, 390, 320, -0.1, 1.5); palm(s, 220, 380, 200, 0.05, 1.1);
    hedge(s, 100, 384, 300, 14);
    rider(s, 120, 466, 1.75, { jersey: '#ffffff', bike: C.goldDeep, pack: C.navy, skin: C.skin[1] });
    return s;
  },
  race() {
    const s = new Scene(400, 480, 9), hz = 220;
    sky(s, 'day', hz); cloud(s, 290, 60, 0.8);
    treeline(s, hz, '#4f9a55', 30); ground(s, hz);
    building(s, 300, hz + 4, 100, 50);
    road(s, 270, hz + 8, -40, 560);
    for (const [x, h, l] of [[140, 200, 0.08], [380, 260, -0.1], [200, 120, 0.04]]) palm(s, x, hz + 40 + h * 0.4, h, l, h / 200);
    const pack = [[275, 270, 0.4, 5], [245, 285, 0.48, 2], [305, 300, 0.55, 1], [230, 330, 0.75, 4], [300, 360, 0.9, 7], [250, 420, 1.2, 0], [330, 470, 1.45, 1]];
    for (const [x, y, k, j] of pack) riderFront(s, x, y, k, { jersey: JERSEYS[j], skin: C.skin[(x >> 2) % 4] });
    return s;
  },
  connect() {
    const s = new Scene(400, 480, 13), hz = 290;
    sky(s, 'sunset', hz); sun(s, 120, 250, 26);
    treeline(s, hz, '#3d6b45', 20); tower(s, 300, hz + 6, 30, 150); building(s, 200, hz + 6, 80, 40, { arches: true });
    ground(s, hz);
    s.add(`<polygon points="${P([0, 410], [400, 400], [400, 480], [0, 480])}" fill="${C.road}"/>`);
    palm(s, 380, 420, 300, -0.12, 1.4); palm(s, 60, 410, 220, 0.1, 1.1);
    tint(s, 'sunset');
    rider(s, 40, 462, 1.25, { jersey: C.navy2, bike: C.goldDeep, pack: null, skin: C.skin[2] });
    rider(s, 190, 476, 1.35, { jersey: C.gold, bike: '#111827', pack: null, skin: C.skin[0] });
    return s;
  },
  world() {
    const s = new Scene(830, 356, 17), hz = 190;
    sky(s, 'day', hz); cloud(s, 420, 60, 1); cloud(s, 700, 40, 1.2);
    treeline(s, hz, '#5ea35c', 24);
    building(s, 330, hz + 6, 200, 70, { floors: 3, arches: true }); building(s, 540, hz + 6, 130, 56, { floors: 2 });
    tower(s, 730, hz + 30, 40, 120, { mural: true });
    ground(s, hz);
    s.add(`<path d="M260,356 C380,300 520,250 600,${hz + 20} L640,${hz + 20} C600,260 640,310 830,330 V356Z" fill="${C.road}"/><path d="M420,356 C470,300 560,260 620,${hz + 22}" stroke="#fff" stroke-width="3" stroke-dasharray="20 14" fill="none"/>`);
    for (const [x, y, h, l] of [[420, 250, 150, 0.05], [520, 230, 120, -0.04], [600, 215, 90, 0.04], [800, 300, 220, -0.1], [330, 270, 160, 0.08]]) palm(s, x, y, h, l, h / 150);
    hedge(s, 640, 262, 160, 12);
    rider(s, 380, 336, 0.85, { jersey: C.gold, bike: '#111827' });
    rider(s, 560, 300, 0.62, { jersey: '#2563eb', bike: C.navy, flip: true });
    rider(s, 660, 350, 0.9, { jersey: '#e04848', bike: '#111827', skin: C.skin[2] });
    return s;
  },
  'lm-gate'() {
    const s = new Scene(400, 200, 19), hz = 120;
    sky(s, 'day', hz); cloud(s, 90, 40, 0.6); treeline(s, hz); ground(s, hz);
    gate(s, 200, 192, 210);
    palm(s, 40, 200, 150, 0.08, 0.9); palm(s, 360, 200, 150, -0.08, 0.9);
    return s;
  },
  'lm-balme'() {
    const s = new Scene(400, 200, 23), hz = 140;
    sky(s, 'day', hz); cloud(s, 320, 40, 0.6); treeline(s, hz); ground(s, hz);
    building(s, 70, hz + 10, 110, 50, { arches: true }); building(s, 220, hz + 10, 110, 50, { arches: true });
    tower(s, 200, hz + 10, 28, 80);
    s.add(`<ellipse cx="200" cy="180" rx="120" ry="12" fill="#7fc8e8"/>`);
    palm(s, 30, 200, 120, 0.06, 0.7); palm(s, 370, 200, 120, -0.06, 0.7);
    return s;
  },
  'lm-engineering'() {
    const s = new Scene(400, 200, 29), hz = 150;
    sky(s, 'day', hz); cloud(s, 90, 30, 0.6); treeline(s, hz); ground(s, hz);
    s.add(`<rect x="90" y="40" width="220" height="${hz - 30}" fill="#e9edf3"/><rect x="250" y="40" width="60" height="${hz - 30}" fill="#cfd6e2"/>`);
    for (let r = 0; r < 5; r++) s.add(`<rect x="100" y="${52 + r * 21}" width="200" height="12" fill="${C.glass}"/>`);
    s.add(`<rect x="86" y="34" width="228" height="8" fill="${C.navy}"/><rect x="170" y="${hz - 22}" width="60" height="32" fill="${C.navy2}"/>`);
    tree(s, 50, 196, 34); tree(s, 360, 196, 34); hedge(s, 80, 190, 240, 12);
    return s;
  },
  'lm-akuafo'() {
    const s = new Scene(400, 200, 31), hz = 130;
    sky(s, 'day', hz); cloud(s, 300, 30, 0.7); treeline(s, hz); ground(s, hz);
    building(s, 30, hz + 34, 340, 84, { floors: 3, arches: true });
    s.add(`<rect x="170" y="${hz - 74}" width="60" height="30" fill="${C.wall}"/><polygon points="${P([164, hz - 74], [236, hz - 74], [200, hz - 98])}" fill="${C.roof}"/>`);
    hedge(s, 30, 190, 340, 14); palm(s, 20, 200, 130, 0.08, 0.8); palm(s, 380, 200, 130, -0.08, 0.8);
    return s;
  },
  'lm-stadium'() {
    const s = new Scene(400, 200, 37), hz = 50;
    sky(s, 'day', hz); treeline(s, hz, '#5ea35c', 10, 14); ground(s, hz);
    s.add(`<ellipse cx="200" cy="130" rx="196" ry="70" fill="#c9ccd4"/><ellipse cx="200" cy="130" rx="170" ry="56" fill="#b4533a"/><ellipse cx="200" cy="130" rx="140" ry="42" fill="${C.grass}"/><path d="M200,88 V172" stroke="#fff" stroke-width="2"/><ellipse cx="200" cy="130" rx="18" ry="8" fill="none" stroke="#fff" stroke-width="2"/>`);
    s.add(`<path d="M10,120 Q200,30 390,120 L370,112 Q200,46 30,112Z" fill="${C.navy2}"/>`);
    for (const x of [30, 370]) s.add(`<rect x="${x - 2}" y="20" width="4" height="70" fill="#4b5563"/><rect x="${x - 10}" y="14" width="20" height="10" fill="#ffe08a"/>`);
    return s;
  },
  'ev-sunset'() {
    const s = new Scene(460, 200, 41), hz = 140;
    sky(s, 'sunset', hz); sun(s, 230, 128, 30, '#fff1c1', '#ffb35a');
    treeline(s, hz, '#2a2a3e', 16); ground(s, hz, '#3a3550');
    s.add(`<rect y="${hz + 20}" width="460" height="40" fill="#2e2a40"/>`);
    for (const [x, h, l] of [[40, 170, 0.08], [420, 180, -0.08], [130, 110, 0.04], [330, 120, -0.05]]) palm(s, x, 200, h, l, h / 160, true);
    tint(s, 'sunset');
    rider(s, 120, 196, 0.6, { jersey: '#2a2240', bike: '#111', skin: '#2a1d16', pack: null, wheel: '#111' });
    rider(s, 250, 192, 0.55, { jersey: '#2a2240', bike: '#111', skin: '#2a1d16', pack: null, wheel: '#111' });
    return s;
  },
  'ev-night'() {
    const s = new Scene(460, 200, 43), hz = 110;
    sky(s, 'night', hz); s.add(`<circle cx="380" cy="40" r="16" fill="#e8ecff"/><circle cx="388" cy="36" r="14" fill="#2a2468"/>`);
    treeline(s, hz, '#141a3a', 14); ground(s, hz, '#141a3a');
    building(s, 40, hz + 4, 130, 50, { floors: 2, lit: true }); building(s, 290, hz + 4, 130, 50, { floors: 2, lit: true });
    tint(s, 'night');
    road(s, 230, hz + 6, -60, 520, { color: '#232a4a', neon: '#a855f7' });
    for (const x of [40, 140, 320, 420]) lamp(s, x, 200, 80, true);
    for (const [x, h, l] of [[10, 160, 0.08], [450, 160, -0.08]]) palm(s, x, 200, h, l, 0.9, true);
    riderFront(s, 210, 160, 0.42, { jersey: '#22d3ee', glow: '#22d3ee' });
    riderFront(s, 255, 175, 0.5, { jersey: '#f472b6', glow: '#f472b6' });
    riderFront(s, 230, 200, 0.62, { jersey: C.gold, glow: C.gold });
    return s;
  },
  'ev-hall'() {
    const s = new Scene(460, 200, 47), hz = 120;
    sky(s, 'day', hz); cloud(s, 380, 30, 0.6); treeline(s, hz); ground(s, hz);
    building(s, 60, hz + 20, 340, 70, { floors: 3, arches: true });
    for (const [x, c] of [[40, '#e04848'], [140, '#2563eb'], [300, '#16a34a'], [410, C.gold]]) flag(s, x, hz + 30, 60, c);
    s.add(`<rect y="${hz + 30}" width="460" height="${200 - hz - 30}" fill="${C.road}"/>`);
    rider(s, 20, 196, 0.55, { jersey: '#e04848', bike: '#111827' });
    rider(s, 150, 190, 0.5, { jersey: '#2563eb', bike: '#111827' });
    rider(s, 290, 198, 0.58, { jersey: '#e04848', bike: '#111827', skin: C.skin[2] });
    return s;
  },
  halls() {
    const s = new Scene(400, 556, 53), hz = 300;
    sky(s, 'day', hz); cloud(s, 260, 90, 1);
    treeline(s, hz); building(s, 80, hz + 4, 280, 90, { floors: 3, arches: true }); ground(s, hz);
    palm(s, 380, 420, 330, -0.1, 1.5);
    person(s, 130, 470, 1.45, { shirt: '#2563eb', pose: 'up', skin: C.skin[1] });
    person(s, 330, 480, 1.5, { shirt: '#e04848', pose: 'wave', skin: C.skin[3] });
    person(s, 230, 520, 1.75, { shirt: C.gold, pose: 'up', skin: C.skin[0] });
    rider(s, 40, 560, 1.4, { noRider: true, bike: C.goldDeep });
    rider(s, 230, 566, 1.2, { noRider: true, bike: '#111827' });
    return s;
  },
  garage() {
    const s = new Scene(360, 600, 59), hz = 330;
    s.add(`<rect width="360" height="${hz}" fill="${s.grad([[0, '#e9eef8'], [1, '#d7deec']])}"/><rect y="${hz}" width="360" height="${600 - hz}" fill="${s.grad([[0, '#c7cfdd'], [1, '#e9eef8']])}"/>`);
    s.add(`<circle cx="230" cy="220" r="150" fill="${s.rgrad([[0, '#fff', 0.9], [1, '#fff', 0]])}"/>`);
    palm(s, 330, 420, 340, -0.08, 1.3);
    person(s, 220, 520, 2.9, { shirt: C.navy, pants: '#111827', pose: 'down', hoodie: true, mark: true, skin: C.skin[0] });
    rider(s, 40, 590, 2.1, { noRider: true, bike: C.goldDeep });
    return s;
  },
  together() {
    const s = new Scene(460, 226, 61), hz = 120;
    sky(s, 'day', hz); cloud(s, 120, 40, 0.7);
    treeline(s, hz); building(s, 40, hz + 10, 200, 60, { arches: true }); tower(s, 330, hz + 10, 22, 60);
    ground(s, hz); palm(s, 430, 230, 200, -0.08, 1);
    rider(s, 10, 222, 0.75, { noRider: true, bike: C.goldDeep });
    person(s, 190, 224, 0.95, { shirt: '#ffffff', pose: 'talk', skin: C.skin[1] });
    person(s, 260, 226, 1, { shirt: '#e04848', pose: 'talk', skin: C.skin[0] });
    person(s, 330, 224, 0.95, { shirt: '#2563eb', pose: 'down', skin: C.skin[3] });
    return s;
  },
  avatars() {
    const s = new Scene(520, 128, 67);
    const looks = [['#2563eb', C.skin[1]], [C.gold, C.skin[0]], ['#e04848', C.skin[3]], ['#16a34a', C.skin[2]]];
    looks.forEach(([shirt, skin], i) => {
      const x = 64 + i * 128;
      s.add(`<clipPath id="c${i}"><circle cx="${x}" cy="64" r="58"/></clipPath><g clip-path="url(#c${i})"><rect x="${x - 60}" y="0" width="120" height="128" fill="#dfe7f5"/><path d="M${x - 50},128 Q${x - 46},92 ${x},90 Q${x + 46},92 ${x + 50},128Z" fill="${shirt}"/><rect x="${x - 8}" y="76" width="16" height="18" fill="${skin}"/><circle cx="${x}" cy="58" r="26" fill="${skin}"/><path d="M${x - 26},56 a26,26 0 0 1 52,0 l-8,-6 -36,0Z" fill="${C.hair}"/><path d="M${x - 9},66 q9,7 18,0" stroke="#3a2418" stroke-width="2.5" fill="none" stroke-linecap="round"/></g><circle cx="${x}" cy="64" r="58" fill="none" stroke="#fff" stroke-width="6"/>`);
    });
    return s;
  },
  brands() {
    const s = new Scene(860, 282, 71), hz = 170;
    sky(s, 'day', hz); cloud(s, 340, 50, 0.9); cloud(s, 760, 40, 1);
    treeline(s, hz); building(s, 300, hz + 4, 160, 50, { arches: true }); ground(s, hz);
    s.add(`<rect y="${hz + 60}" width="860" height="${282 - hz - 60}" fill="${C.road}"/><path d="M0,256 H860" stroke="#fff" stroke-width="3" stroke-dasharray="26 18"/>`);
    // billboard
    s.add(`<rect x="536" y="150" width="8" height="90" fill="#4b5563"/><rect x="616" y="150" width="8" height="90" fill="#4b5563"/><rect x="460" y="44" width="240" height="116" rx="6" fill="${C.navy}"/><rect x="468" y="52" width="224" height="100" rx="3" fill="${C.gold}"/>`);
    s.add(`<text x="580" y="94" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="26" text-anchor="middle" fill="${C.navy}">YOUR BRAND</text><text x="580" y="122" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="26" text-anchor="middle" fill="${C.navy}">HERE</text><text x="580" y="142" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="10" letter-spacing="2" text-anchor="middle" fill="${C.navy}">PARTNER WITH LEGONRUSH</text>`);
    palm(s, 410, 240, 190, 0.06, 1.1); palm(s, 830, 236, 220, -0.08, 1.2);
    hedge(s, 380, 232, 480, 12);
    car(s, 380, 262, 0.7, '#e04848');
    rider(s, 640, 272, 0.75, { jersey: C.gold, bike: '#111827' });
    rider(s, 250, 270, 0.6, { jersey: '#2563eb', bike: C.navy, flip: true });
    return s;
  },
  ready() {
    const s = new Scene(700, 276, 79), hz = 190;
    sky(s, 'sunset', hz); sun(s, 470, 180, 24, '#fff1c1', '#ffb35a'); cloud(s, 600, 60, 0.9, 0.35);
    treeline(s, hz, '#2d3350', 18);
    for (let i = 0; i < 7; i++) building(s, 260 + i * 66, hz + 4, 50, 22 + (i % 3) * 8, { floors: 1, wall: '#5d5a72', roof: '#4a3550' });
    tower(s, 560, hz + 4, 20, 90, { wall: '#6d6880', roof: '#4a3550' });
    ground(s, hz, '#2a2a3e'); s.add(`<rect y="${hz}" width="700" height="86" fill="#2a2a3e"/>`);
    palm(s, 660, 276, 170, -0.08, 1, true); palm(s, 290, 276, 150, 0.08, 0.9, true);
    tint(s, 'sunset');
    person(s, 420, 300, 2.1, { shirt: C.navy, pants: '#111827', back: true, hoodie: true, skin: C.skin[1] });
    s.add(`<path d="M406,128 L420,150 L434,128" stroke="${C.gold}" stroke-width="5" fill="none"/>`);
    return s;
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, build] of Object.entries(scenes)) {
  if (only && name !== only) continue;
  const svg = build().toString();
  writeFileSync(`${OUT}/${name}.svg`, svg);
  console.log(name.padEnd(16), (svg.length / 1024).toFixed(1), 'KB');
}
