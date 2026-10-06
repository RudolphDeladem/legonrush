// The interactive campus map: a canvas that pans, zooms and rotates like a street map.
// The campus is drawn from vectors into 512 px tiles at the zoom level it is seen at (cached,
// drawn a few per frame), so moving the map only copies bitmaps: smooth on cheap phones.
// Labels, pins and routes are drawn on top every frame in screen space.
import type { PlaceKind, Place } from '../../game/campusmap';
import type { CampusMap } from './campus';
import { shortName } from './campus';

export type MapStyle = 'standard' | 'terrain' | 'night';

interface Palette {
  land: string; wood: string; pitch: string; track: string; parking: string; water: string;
  bldg: string; bldgEdge: string; shadow?: string;
  fill: string[]; edge: string[]; path: string;
  label: string; halo: string; roadLabel: string;
  kind: Partial<Record<PlaceKind, string>>;
}

export const PALETTES: Record<MapStyle, Palette> = {
  standard: {
    land: '#f2efe9', wood: '#cde8c4', pitch: '#bfe3b4', track: '#e9b8a6', parking: '#e6e6ea', water: '#a9d3f5',
    bldg: '#e3ddd3', bldgEdge: '#cfc6b8',
    fill: ['#fde293', '#fde293', '#ffffff', '#ffffff', '#ffffff'], edge: ['#e8b84a', '#e8b84a', '#c9ccd3', '#d5d8de', '#d5d8de'], path: '#b9b2a4',
    label: '#3c4043', halo: 'rgba(255,255,255,0.95)', roadLabel: '#5f6368',
    kind: { hall: '#8a4b0f', landmark: '#7a4fb3', academic: '#3c6e9e', food: '#c25e12', health: '#c0392b', sport: '#2f7d32', bank: '#5f6368', worship: '#5f6368', transport: '#1a73e8', other: '#5f6368' },
  },
  terrain: {
    land: '#e3ead6', wood: '#b4d29e', pitch: '#a6d48f', track: '#d9a58f', parking: '#d9dad3', water: '#8cc3ec',
    bldg: '#f6f2ec', bldgEdge: '#b4ab9c', shadow: 'rgba(58,50,36,0.30)',
    fill: ['#fff1b8', '#fff6d6', '#ffffff', '#ffffff', '#fbfaf6'], edge: ['#d2b25a', '#d6bd78', '#bfc4bb', '#c9cdc2', '#c9cdc2'], path: '#9d957f',
    label: '#2f3a2f', halo: 'rgba(255,255,255,0.92)', roadLabel: '#566152',
    kind: { hall: '#7a3f08', landmark: '#6a3fa3', academic: '#2f5f8e', food: '#ae520c', health: '#b0332a', sport: '#2a6e2d', bank: '#4e5a4e', worship: '#4e5a4e', transport: '#1a63c8', other: '#4e5a4e' },
  },
  night: {
    land: '#1a2131', wood: '#1d3226', pitch: '#21402b', track: '#4a302b', parking: '#252c3b', water: '#1b3556',
    bldg: '#2a3347', bldgEdge: '#3a4560',
    fill: ['#8a6d1f', '#76602a', '#3d4860', '#353f55', '#353f55'], edge: ['#4f3f12', '#45391a', '#232b3c', '#232b3c', '#232b3c'], path: '#4c566b',
    label: '#e3e9f5', halo: 'rgba(13,18,30,0.92)', roadLabel: '#9aa6c4',
    kind: { hall: '#ffb46b', landmark: '#c9a7ff', academic: '#8fc1f2', food: '#ffa565', health: '#ff8a80', sport: '#8ee39a', bank: '#b9c2d6', worship: '#b9c2d6', transport: '#8ab4f8', other: '#b9c2d6' },
  },
};

const TILE = 512;
const MAX_LEVEL = 6;
const mppOf = (l: number) => 8 / 2 ** l;
/** road widths in metres and the narrowest they get on screen (device px), by road class */
const ROAD_M = [13, 10, 7.5, 5, 2.2];
const ROAD_MIN = [3.4, 3, 2.3, 1.6, 1.2];

interface Index { cell: number; buildings: Map<number, number[]>; roads: Map<number, number[]>; areas: Map<number, number[]> }
const key = (i: number, j: number) => i * 100003 + j;

function buildIndex(map: CampusMap): Index {
  const cell = 250;
  const idx: Index = { cell, buildings: new Map(), roads: new Map(), areas: new Map() };
  const add = (m: Map<number, number[]>, i: number, minX: number, maxX: number, minZ: number, maxZ: number) => {
    for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++)
      for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
        const k = key(x, z);
        let l = m.get(k);
        if (!l) m.set(k, (l = []));
        l.push(i);
      }
  };
  map.buildings.forEach((b, i) => add(idx.buildings, i, b.minX, b.maxX, b.minZ, b.maxZ));
  const bbox = (pts: ArrayLike<number>) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { a = Math.min(a, pts[i]); b = Math.max(b, pts[i]); c = Math.min(c, pts[i + 1]); d = Math.max(d, pts[i + 1]); }
    return [a, b, c, d] as const;
  };
  map.areas.forEach((a, i) => add(idx.areas, i, ...bbox(a.pts)));
  map.roads.forEach((r, i) => {
    const pts = r.nodes.flatMap((n) => [map.nodes[n * 2], map.nodes[n * 2 + 1]]);
    // long roads go in every cell their segments touch, not their whole bounding box
    for (let k = 0; k < pts.length - 2; k += 2) add(idx.roads, i, ...bbox(pts.slice(k, k + 4)));
  });
  return idx;
}

function query(m: Map<number, number[]>, cell: number, minX: number, maxX: number, minZ: number, maxZ: number, seen: Set<number>) {
  seen.clear();
  for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++)
    for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++)
      for (const i of m.get(key(x, z)) ?? []) seen.add(i);
  return [...seen].sort((a, b) => a - b);
}

/** draws one tile of the campus (vectors) into a canvas */
function renderTile(map: CampusMap, idx: Index, style: MapStyle, level: number, tx: number, tz: number, dpr: number, out: HTMLCanvasElement) {
  const P = PALETTES[style];
  const mpp = mppOf(level);
  const ox = tx * TILE * mpp, oz = tz * TILE * mpp, size = TILE * mpp;
  const ctx = out.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.land;
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.setTransform(1 / mpp, 0, 0, 1 / mpp, -ox / mpp, -oz / mpp);
  const m = 30; // margin for shadows and wide roads crossing the edge
  const seen = new Set<number>();
  const poly = (pts: Float32Array, dx = 0, dz = 0) => {
    for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i] + dx, pts[i + 1] + dz);
    ctx.closePath();
  };
  // grounds
  const AREA: Record<string, string> = { pitch: P.pitch, track: P.track, parking: P.parking, water: P.water, wood: P.wood };
  for (const i of query(idx.areas, idx.cell, ox - m, ox + size + m, oz - m, oz + size + m, seen)) {
    const a = map.areas[i];
    ctx.beginPath();
    poly(a.pts);
    ctx.fillStyle = AREA[a.kind] ?? P.wood;
    ctx.fill();
  }
  // buildings (terrain mode casts a soft shadow to the south-east by height)
  const bl = query(idx.buildings, idx.cell, ox - m, ox + size + m, oz - m, oz + size + m, seen);
  if (P.shadow && level >= 2) {
    ctx.fillStyle = P.shadow;
    for (const i of bl) {
      const b = map.buildings[i];
      const h = Math.min(30, (b.height ?? 9) * 0.45);
      ctx.beginPath();
      poly(b.pts, h * 0.7, h);
      ctx.fill();
    }
  }
  ctx.fillStyle = P.bldg;
  ctx.strokeStyle = P.bldgEdge;
  ctx.lineWidth = Math.max(0.6 * dpr * mpp, 0.15);
  ctx.beginPath();
  for (const i of bl) {
    const b = map.buildings[i];
    poly(b.pts);
    b.holes.forEach((h) => poly(h));
  }
  ctx.fill('evenodd');
  if (level >= 2) ctx.stroke();
  // roads: small classes hidden when zoomed out, edges under fills, big roads on top
  ctx.lineCap = ctx.lineJoin = 'round';
  const rl = query(idx.roads, idx.cell, ox - m, ox + size + m, oz - m, oz + size + m, seen);
  const maxCls = level <= 0 ? 2 : level === 1 ? 3 : 4;
  const width = (cls: number) => Math.max(ROAD_M[cls], ROAD_MIN[cls] * dpr * mpp * (level >= 4 ? 1 : 0.9));
  const trace = (cls: number) => {
    ctx.beginPath();
    for (const i of rl) {
      const r = map.roads[i];
      if (r.cls !== cls) continue;
      r.nodes.forEach((n, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, map.nodes[n * 2], map.nodes[n * 2 + 1]));
    }
  };
  for (const cls of [4, 3, 2, 1, 0]) {
    if (cls > maxCls) continue;
    trace(cls);
    if (cls === 4) {
      ctx.setLineDash([3 * dpr * mpp, 2.2 * dpr * mpp]);
      ctx.strokeStyle = P.path;
      ctx.lineWidth = Math.max(1.1 * dpr * mpp, 1.2);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.strokeStyle = P.edge[cls];
    ctx.lineWidth = width(cls) + 1.4 * dpr * mpp;
    ctx.stroke();
    ctx.strokeStyle = P.fill[cls];
    ctx.lineWidth = width(cls);
    ctx.stroke();
  }
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, boxes: Box[]) => boxes.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);

/** how far in (px per metre) a place needs the map zoomed before its name shows */
function labelScale(p: Place, major: Set<string>) {
  if (major.has(p.name)) return p.kind === 'landmark' ? 0.1 : 0.13;
  switch (p.kind) {
    case 'landmark': return 0.25;
    case 'hall': return 0.75;
    case 'academic': return 1.05;
    case 'food': case 'health': case 'sport': return 1.1;
    case 'bank': case 'worship': return 1.8;
    default: return 2.4;
  }
}
const LABEL_RANK: Record<PlaceKind, number> = { landmark: 0, hall: 1, academic: 2, health: 3, food: 3, sport: 3, worship: 4, bank: 5, transport: 6, other: 6 };

export interface View { cx: number; cz: number; scale: number; rot: number }

export class MapView {
  readonly ctx: CanvasRenderingContext2D;
  cx = 0; cz = 0; scale = 0.3; rot = 0;
  w = 1; h = 1; dpr = 1;
  minScale = 0.08; maxScale = 7;
  style: MapStyle = 'standard';
  labels = true;
  /** called after the campus and labels are drawn: pins, routes, the You marker */
  onDraw: ((ctx: CanvasRenderingContext2D, now: number) => void) | null = null;
  /** screen boxes the overlay wants kept clear of labels (set by onDrawBefore) */
  reserved: Box[] = [];
  onBeforeLabels: (() => void) | null = null;
  onTap: ((sx: number, sy: number) => void) | null = null;
  onLongPress: ((sx: number, sy: number) => void) | null = null;
  /** any camera change (for the compass and following) */
  onView: (() => void) | null = null;
  /** places whose names are drawn, with their screen boxes, for tapping */
  labelHits: { box: Box; place: Place }[] = [];
  /** keep redrawing (live pulses) */
  animate = false;
  /** places drawn with a badge by the overlay: their names sit beside the badge */
  badged = new Set<string>();
  /** places whose names are not drawn (hidden spots not yet found) */
  unnamed = new Set<string>();

  private map: CampusMap;
  private idx: Index;
  private tiles = new Map<string, HTMLCanvasElement>();
  private spare: HTMLCanvasElement[] = [];
  private raf = 0;
  private dirty = true;
  private anim: { from: View; to: View; t0: number; ms: number } | null = null;
  private inertia: { vx: number; vy: number; t: number } | null = null;
  private major: Set<string>;
  private roadLabels: { name: string; x: number; z: number; a: number; len: number }[] = [];
  private textW = new Map<string, number>();
  private ro: ResizeObserver;
  private off: (() => void)[] = [];
  private lastFrame = 0;

  constructor(readonly canvas: HTMLCanvasElement, map: CampusMap, major: string[] = []) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.map = map;
    this.idx = buildIndex(map);
    this.major = new Set(major);
    this.prepRoadLabels();
    const b = map.bounds;
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bindInput();
    const vis = () => { if (!document.hidden) this.draw(); };
    document.addEventListener('visibilitychange', vis);
    this.off.push(() => document.removeEventListener('visibilitychange', vis));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.off.forEach((f) => f());
    this.tiles.clear();
    this.spare = [];
  }

  // ---------- camera ----------

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const b = this.map.bounds;
    this.minScale = Math.min(this.w / (b.maxX - b.minX + 400), this.h / (b.maxZ - b.minZ + 400)) * 0.9;
    this.scale = Math.max(this.minScale, this.scale);
    this.draw();
  }

  toScreen(x: number, z: number): [number, number] {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = (x - this.cx) * this.scale, dz = (z - this.cz) * this.scale;
    return [this.w / 2 + dx * c - dz * s, this.h / 2 + dx * s + dz * c];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = (sx - this.w / 2) / this.scale, dy = (sy - this.h / 2) / this.scale;
    return [this.cx + dx * c + dy * s, this.cz - dx * s + dy * c];
  }

  /** puts world point (x, z) under screen point (sx, sy) */
  private anchor(x: number, z: number, sx: number, sy: number) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = (sx - this.w / 2) / this.scale, dy = (sy - this.h / 2) / this.scale;
    this.cx = x - (dx * c + dy * s);
    this.cz = z - (-dx * s + dy * c);
  }

  private clamp() {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const b = this.map.bounds, pad = 300;
    this.cx = Math.min(b.maxX + pad, Math.max(b.minX - pad, this.cx));
    this.cz = Math.min(b.maxZ + pad, Math.max(b.minZ - pad, this.cz));
  }

  view(): View { return { cx: this.cx, cz: this.cz, scale: this.scale, rot: this.rot }; }

  set(v: Partial<View>) {
    Object.assign(this, v);
    this.clamp();
    this.changed();
  }

  /** zoom by a factor around a screen point */
  zoomAt(f: number, sx = this.w / 2, sy = this.h / 2) {
    const [x, z] = this.toWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * f));
    this.anchor(x, z, sx, sy);
    this.clamp();
    this.changed();
  }

  /** smooth move to a view */
  flyTo(to: Partial<View>, ms = 380) {
    this.inertia = null;
    const from = this.view();
    const target = { ...from, ...to };
    target.scale = Math.min(this.maxScale, Math.max(this.minScale, target.scale));
    // rotate the short way round
    let dr = target.rot - from.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    target.rot = from.rot + dr;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
    this.anim = { from, to: target, t0: performance.now(), ms };
    this.draw();
  }

  /** fits a box of world points in the free part of the screen (padding in px: top, right, bottom, left) */
  fit(pts: { x: number; z: number }[], pad: [number, number, number, number] = [80, 60, 80, 60], maxScale = 2.2) {
    if (!pts.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const [t, r, b, l] = pad;
    const aw = Math.max(60, this.w - l - r), ah = Math.max(60, this.h - t - b);
    const scale = Math.min(maxScale, aw / Math.max(40, maxX - minX), ah / Math.max(40, maxZ - minZ));
    // centre of the free area, in screen space, shifted from the canvas centre
    const ox = (l - r) / 2, oy = (t - b) / 2;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const c = Math.cos(0), s = Math.sin(0);
    this.flyTo({ cx: cx - (ox * c + oy * s) / scale, cz: cz - (-ox * s + oy * c) / scale, scale, rot: 0 });
  }

  /** centre on a point, leaving room for a sheet covering the bottom (or left) of the screen */
  focus(x: number, z: number, scale = Math.max(this.scale, 1.4), offset: [number, number] = [0, 0]) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const [ox, oy] = offset;
    this.flyTo({ cx: x - (ox * c + oy * s) / scale, cz: z - (-ox * s + oy * c) / scale, scale: Math.min(this.maxScale, scale) });
  }

  private changed() {
    this.onView?.();
    this.draw();
  }

  // ---------- drawing ----------

  setStyle(style: MapStyle) {
    if (style === this.style) return;
    this.style = style;
    this.spare.push(...this.tiles.values());
    this.tiles.clear();
    this.draw();
  }

  /** asks for a frame */
  draw() {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    // the tab was replaced by another screen: stop for good
    if (!this.canvas.isConnected) return this.destroy();
    if (document.hidden) return;
    let more = false;
    if (this.anim) {
      const { from, to, t0, ms } = this.anim;
      const k = ms ? Math.min(1, (now - t0) / ms) : 1;
      const e = 1 - (1 - k) ** 3;
      this.scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e);
      this.rot = from.rot + (to.rot - from.rot) * e;
      this.cx = from.cx + (to.cx - from.cx) * e;
      this.cz = from.cz + (to.cz - from.cz) * e;
      if (k >= 1) { this.anim = null; this.rot = Math.atan2(Math.sin(this.rot), Math.cos(this.rot)); }
      this.onView?.();
      more = true;
    }
    if (this.inertia) {
      const dt = Math.min(40, now - this.inertia.t);
      this.inertia.t = now;
      const { vx, vy } = this.inertia;
      const [x, z] = this.toWorld(this.w / 2 - vx * dt, this.h / 2 - vy * dt);
      this.cx = x; this.cz = z;
      this.clamp();
      const decay = Math.pow(0.992, dt);
      this.inertia.vx *= decay; this.inertia.vy *= decay;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.02) this.inertia = null;
      this.onView?.();
      more = true;
    }
    // with only a pulse to animate, ~30 fps is plenty
    if (!more && !this.dirty && this.animate && now - this.lastFrame < 32) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    this.lastFrame = now;
    this.dirty = false;
    const pending = this.paint(now);
    if (more || pending || this.animate) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private level() {
    return Math.max(0, Math.min(MAX_LEVEL, Math.round(Math.log2(8 * this.scale * this.dpr))));
  }

  private visibleBox(margin = 0) {
    const corners = [this.toWorld(-margin, -margin), this.toWorld(this.w + margin, -margin), this.toWorld(-margin, this.h + margin), this.toWorld(this.w + margin, this.h + margin)];
    return {
      minX: Math.min(...corners.map((c) => c[0])), maxX: Math.max(...corners.map((c) => c[0])),
      minZ: Math.min(...corners.map((c) => c[1])), maxZ: Math.max(...corners.map((c) => c[1])),
    };
  }

  private tile(level: number, tx: number, tz: number, make: boolean) {
    const k = `${level}/${tx}/${tz}`;
    let t = this.tiles.get(k);
    if (t) {
      // most recently used goes to the back
      this.tiles.delete(k);
      this.tiles.set(k, t);
      return t;
    }
    if (!make) return undefined;
    t = this.spare.pop() ?? document.createElement('canvas');
    t.width = t.height = TILE;
    renderTile(this.map, this.idx, this.style, level, tx, tz, this.dpr, t);
    this.tiles.set(k, t);
    while (this.tiles.size > 40) {
      const [old, c] = this.tiles.entries().next().value!;
      this.tiles.delete(old);
      this.spare.push(c);
    }
    return t;
  }

  /** draws a frame; returns true while tiles are still being made */
  private paint(now: number): boolean {
    const { ctx, dpr } = this;
    const P = PALETTES[this.style];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.land;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.rotate(this.rot);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cx, -this.cz);
    const level = this.level();
    const mpp = mppOf(level), span = TILE * mpp;
    const vb = this.visibleBox(4);
    const b = this.map.bounds, pad = 600;
    const x0 = Math.floor(Math.max(vb.minX, b.minX - pad) / span), x1 = Math.floor(Math.min(vb.maxX, b.maxX + pad) / span);
    const z0 = Math.floor(Math.max(vb.minZ, b.minZ - pad) / span), z1 = Math.floor(Math.min(vb.maxZ, b.maxZ + pad) / span);
    // nearest the centre first
    const want: [number, number, number][] = [];
    const ccx = this.cx / span, ccz = this.cz / span;
    for (let tx = x0; tx <= x1; tx++) for (let tz = z0; tz <= z1; tz++) want.push([tx, tz, Math.hypot(tx + 0.5 - ccx, tz + 0.5 - ccz)]);
    want.sort((a, b2) => a[2] - b2[2]);
    const t0 = performance.now();
    let pending = false;
    const seam = mpp * 0.6;
    ctx.imageSmoothingEnabled = true;
    for (const [tx, tz] of want) {
      const budget = performance.now() - t0 < 14;
      const t = this.tile(level, tx, tz, budget);
      if (t) {
        ctx.drawImage(t, tx * span, tz * span, span + seam, span + seam);
        continue;
      }
      pending = true;
      // meanwhile, a blurry piece of a coarser tile if one is cached
      for (let l = level - 1; l >= 0; l--) {
        const m2 = mppOf(l), s2 = TILE * m2;
        const px = Math.floor((tx * span) / s2), pz = Math.floor((tz * span) / s2);
        const parent = this.tile(l, px, pz, false);
        if (!parent) continue;
        const sx = ((tx * span - px * s2) / m2), sz = ((tz * span - pz * s2) / m2), sw = span / m2;
        ctx.drawImage(parent, sx, sz, sw, sw, tx * span, tz * span, span + seam, span + seam);
        break;
      }
    }
    ctx.restore();
    this.reserved = [];
    this.onBeforeLabels?.();
    this.labelHits = [];
    if (this.labels) this.drawLabels();
    this.onDraw?.(ctx, now);
    return pending;
  }

  private measure(font: string, text: string) {
    const k = font + '|' + text;
    let w = this.textW.get(k);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.textW.set(k, w);
    }
    return w;
  }

  private prepRoadLabels() {
    const seen = new Map<string, number>();
    this.map.roads.forEach((r) => {
      if (!r.name || r.cls > 3) return;
      let best = 0, bx = 0, bz = 0, ba = 0;
      for (let k = 0; k < r.nodes.length - 1; k++) {
        const a = r.nodes[k], b = r.nodes[k + 1];
        const ax = this.map.nodes[a * 2], az = this.map.nodes[a * 2 + 1], bx2 = this.map.nodes[b * 2], bz2 = this.map.nodes[b * 2 + 1];
        const len = Math.hypot(bx2 - ax, bz2 - az);
        if (len > best) { best = len; bx = (ax + bx2) / 2; bz = (az + bz2) / 2; ba = Math.atan2(bz2 - az, bx2 - ax); }
      }
      // one label per road name, on its longest straight piece
      const prev = seen.get(r.name);
      if (best < 45 || (prev !== undefined && this.roadLabels[prev].len >= best)) return;
      const entry = { name: r.name, x: bx, z: bz, a: ba, len: best };
      if (prev !== undefined) this.roadLabels[prev] = entry;
      else { seen.set(r.name, this.roadLabels.length); this.roadLabels.push(entry); }
    });
  }

  private drawLabels() {
    const { ctx } = this;
    const P = PALETTES[this.style];
    const boxes: Box[] = [...this.reserved];
    const s = this.scale;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'middle';
    // place names, most important first
    const list = this.map.places
      .filter((p) => s >= labelScale(p, this.major) && !this.unnamed.has(p.name))
      .sort((a, b) => (this.major.has(b.name) ? 1 : 0) - (this.major.has(a.name) ? 1 : 0) || LABEL_RANK[a.kind] - LABEL_RANK[b.kind]);
    let n = 0;
    const max = this.w < 600 ? 34 : 60;
    for (const p of list) {
      if (n >= max) break;
      const [sx, sy] = this.toScreen(p.x, p.z);
      if (sx < -40 || sy < -20 || sx > this.w + 40 || sy > this.h + 20) continue;
      const big = this.major.has(p.name);
      const font = `${big ? 700 : 600} ${big ? 12.5 : 11.5}px Sora, system-ui, sans-serif`;
      const name = shortName(p.name);
      const tw = this.measure(font, name);
      const badge = this.badged.has(p.name);
      const gap = badge ? 14 : 7;
      // right of the spot, or left of it if that is taken
      let tx = sx + gap;
      let box = { x0: badge ? tx - 2 : sx - 6, y0: sy - 8, x1: tx + 2 + tw, y1: sy + 8 };
      if (overlaps(box, boxes)) {
        tx = sx - gap - tw;
        box = { x0: tx - 2, y0: sy - 8, x1: badge ? sx - gap + 2 : sx + 6, y1: sy + 8 };
        if (overlaps(box, boxes)) continue;
      }
      boxes.push(box);
      const color = P.kind[p.kind] ?? P.label;
      if (!badge) {
        ctx.beginPath();
        ctx.arc(sx, sy, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = P.halo;
        ctx.stroke();
      }
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = P.halo;
      ctx.strokeText(name, tx, sy);
      ctx.fillStyle = color;
      ctx.fillText(name, tx, sy);
      this.labelHits.push({ box, place: p });
      n++;
    }
    // street names along the road, kept upright
    if (s >= 1.1) {
      const font = '500 10.5px Sora, system-ui, sans-serif';
      ctx.font = font;
      ctx.textAlign = 'center';
      for (const r of this.roadLabels) {
        const [sx, sy] = this.toScreen(r.x, r.z);
        if (sx < 0 || sy < 0 || sx > this.w || sy > this.h) continue;
        const tw = this.measure(font, r.name);
        if (tw > r.len * s * 0.95) continue;
        let a = r.a + this.rot;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (a > Math.PI / 2) a -= Math.PI;
        if (a < -Math.PI / 2) a += Math.PI;
        const hw = (Math.abs(Math.cos(a)) * tw) / 2 + 4, hh = (Math.abs(Math.sin(a)) * tw) / 2 + 7;
        const box = { x0: sx - hw, y0: sy - hh, x1: sx + hw, y1: sy + hh };
        if (overlaps(box, boxes)) continue;
        boxes.push(box);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(a);
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.halo;
        ctx.strokeText(r.name, 0, 0);
        ctx.fillStyle = P.roadLabel;
        ctx.fillText(r.name, 0, 0);
        ctx.restore();
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- input ----------

  private bindInput() {
    const c = this.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; t: number } | null = null;
    let moved = false;
    let two: { d: number; a: number; mx: number; my: number; turn: number; rotating: boolean } | null = null;
    let rotDrag: { x: number } | null = null;
    let press = 0;
    let lastTap = 0;
    let samples: { x: number; y: number; t: number }[] = [];
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pair = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      try { c.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      this.anim = null;
      this.inertia = null;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (e.button === 2 || (e.pointerType === 'mouse' && e.shiftKey)) {
        rotDrag = { x: p.x };
        return;
      }
      if (pts.size === 1) {
        start = { ...p, t: performance.now() };
        moved = false;
        samples = [{ ...p, t: performance.now() }];
        clearTimeout(press);
        press = window.setTimeout(() => {
          if (!moved && pts.size === 1 && start) { moved = true; this.onLongPress?.(start.x, start.y); }
        }, 560);
      } else if (pts.size === 2) {
        clearTimeout(press);
        moved = true;
        two = { ...pair(), turn: 0, rotating: false };
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      const prev = pts.get(e.pointerId)!;
      pts.set(e.pointerId, p);
      if (rotDrag) {
        const [x, z] = this.toWorld(this.w / 2, this.h / 2);
        this.rot += (p.x - rotDrag.x) * 0.008;
        rotDrag.x = p.x;
        this.anchor(x, z, this.w / 2, this.h / 2);
        this.changed();
        return;
      }
      if (pts.size === 1 && start) {
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 6) { moved = true; clearTimeout(press); }
        if (!moved) return;
        const [x, z] = this.toWorld(prev.x, prev.y);
        this.anchor(x, z, p.x, p.y);
        this.clamp();
        samples.push({ ...p, t: performance.now() });
        if (samples.length > 5) samples.shift();
        this.changed();
      } else if (pts.size === 2 && two) {
        const now = pair();
        const [x, z] = this.toWorld(two.mx, two.my);
        this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * (now.d / Math.max(1, two.d))));
        let da = now.a - two.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        two.turn += da;
        // a twist has to be deliberate before the map starts turning
        if (!two.rotating && Math.abs(two.turn) > 0.26) two.rotating = true;
        if (two.rotating) this.rot += da;
        this.anchor(x, z, now.mx, now.my);
        this.clamp();
        Object.assign(two, now);
        this.changed();
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      clearTimeout(press);
      if (rotDrag) { if (!pts.size) rotDrag = null; return; }
      if (pts.size === 1) {
        // one finger left after a pinch: carry on panning from where it is
        two = null;
        const [q] = [...pts.values()];
        start = { ...q, t: performance.now() };
        samples = [];
        return;
      }
      if (pts.size) return;
      two = null;
      const p = local(e);
      if (start && !moved && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 300 && e.pointerType !== 'mouse') {
          lastTap = 0;
          const [x, z] = this.toWorld(p.x, p.y);
          const s = this.scale;
          this.scale = Math.min(this.maxScale, s * 2);
          const target = (() => { this.anchor(x, z, p.x, p.y); this.clamp(); return this.view(); })();
          this.scale = s;
          this.anchor(x, z, p.x, p.y);
          this.flyTo(target, 260);
        } else {
          lastTap = now;
          this.onTap?.(p.x, p.y);
        }
      } else if (moved && samples.length >= 2) {
        const a = samples[0], b = samples[samples.length - 1];
        const dt = b.t - a.t;
        if (dt > 0 && performance.now() - b.t < 80) {
          const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
          if (Math.hypot(vx, vy) > 0.25 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.inertia = { vx, vy, t: performance.now() };
            this.draw();
          }
        }
      }
      start = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.anim = null;
      this.inertia = null;
      const p = local(e);
      const k = e.ctrlKey ? 0.012 : 0.0016;
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.zoomAt(Math.exp(-dy * k), p.x, p.y);
    };
    const dbl = (e: MouseEvent) => {
      const p = local(e);
      const [x, z] = this.toWorld(p.x, p.y);
      const s = this.scale;
      this.scale = Math.min(this.maxScale, s * (e.shiftKey ? 0.5 : 2));
      this.anchor(x, z, p.x, p.y);
      this.clamp();
      const target = this.view();
      this.scale = s;
      this.anchor(x, z, p.x, p.y);
      this.flyTo(target, 260);
    };
    const key = (e: KeyboardEvent) => {
      const step = 80;
      if (e.key === '+' || e.key === '=') this.flyTo({ scale: this.scale * 1.8 }, 220);
      else if (e.key === '-' || e.key === '_') this.flyTo({ scale: this.scale / 1.8 }, 220);
      else if (e.key.startsWith('Arrow')) {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const [x, z] = this.toWorld(this.w / 2 + dx, this.h / 2 + dy);
        this.flyTo({ cx: x, cz: z }, 180);
      } else return;
      e.preventDefault();
    };
    const ctxMenu = (e: Event) => e.preventDefault();
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('dblclick', dbl);
    c.addEventListener('keydown', key);
    c.addEventListener('contextmenu', ctxMenu);
    this.off.push(() => clearTimeout(press));
  }
}

// ---------- marker drawing helpers for the overlay ----------

const imgCache = new Map<string, HTMLImageElement>();
/** a line icon (ui/icons.ts svg) as an image in one colour */
export function iconImage(svg: string, color: string, onload: () => void) {
  const k = svg + color;
  let img = imgCache.get(k);
  if (!img) {
    img = new Image();
    const src = svg.replace(/class="[^"]*"/, 'xmlns="http://www.w3.org/2000/svg" width="48" height="48"').replace(/currentColor/g, color);
    img.onload = onload;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    imgCache.set(k, img);
  }
  return img;
}

/** a round badge with an icon: the look of every pin on the map */
export function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, icon: HTMLImageElement | null, ring = '#ffffff', tail = false) {
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,0.28)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  if (tail) {
    // teardrop pin pointing at (x, y + r * 1.6)
    ctx.moveTo(x, y + r * 1.7);
    ctx.arc(x, y, r, Math.PI * 0.72, Math.PI * 2.28);
    ctx.closePath();
  } else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
  if (icon?.complete && icon.naturalWidth) {
    const s = r * 1.15;
    ctx.drawImage(icon, x - s / 2, y - s / 2, s, s);
  }
}
