// Campus life: street trees of several species, kerbs and drains, street lamps, UG
// shuttle stops, street-name signs, hall boards, hedges and flower beds, parked cars,
// okadas, kiosks and umbrellas, food sellers and students in groups.
//
// Everything here is static and baked into one vertex-coloured mesh per 400 m cell,
// all sharing one material whose small texture atlas carries the sign lettering
// (every other vertex samples a white corner of it). A second, additive mesh per cell
// holds the lamp and kiosk glows and is only drawn after dark. Cells past the fog
// are skipped each frame, so a ride only pays for the few cells around the rider.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AREAS, BUILDINGS, NODE_XZ, PLACES, ROADS, buildingAt, nodeDegree, placeByName, type Place } from './campusmap';
import { HALLS, HALL_PLACE } from '../data/campus';
import { buildingMaterials, setWindowLights } from './facades';

/** real road widths by class: main, through, residential, service lane, footpath */
export const ROAD_WIDTH = [9, 7.4, 6.2, 4.6, 2.6];
/** the ridden route's road and walkway reach this far from its centre line (see world.ts) */
const ROUTE_EDGE = 3.9;
const CELL = 400;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const hash = (x: number, z: number) => {
  let h = (Math.floor(x) * 73856093) ^ (Math.floor(z) * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

// ---------- where the roads are ----------
interface Seg { ax: number; az: number; bx: number; bz: number; half: number; road: number; cls: number }
const SG = 24;
const segGrid = new Map<number, Seg[]>();
const gkey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
ROADS.forEach((r, ri) => {
  const half = ROAD_WIDTH[r.cls] / 2;
  for (let k = 0; k < r.nodes.length - 1; k++) {
    const a = r.nodes[k], b = r.nodes[k + 1];
    const s: Seg = { ax: NODE_XZ[a * 2], az: NODE_XZ[a * 2 + 1], bx: NODE_XZ[b * 2], bz: NODE_XZ[b * 2 + 1], half, road: ri, cls: r.cls };
    const x0 = Math.floor((Math.min(s.ax, s.bx) - half) / SG), x1 = Math.floor((Math.max(s.ax, s.bx) + half) / SG);
    const z0 = Math.floor((Math.min(s.az, s.bz) - half) / SG), z1 = Math.floor((Math.max(s.az, s.bz) + half) / SG);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const key = gkey(i, j);
      let l = segGrid.get(key);
      if (!l) segGrid.set(key, (l = []));
      l.push(s);
    }
  }
});
function segDist(s: Seg, x: number, z: number) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
  return Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
}
/**
 * Distance from (x, z) to the nearest road edge (negative on the road), looking
 * `reach` metres round; footpaths count only when `paths` is set.
 */
export function roadClearance(x: number, z: number, reach = 12, skipRoad = -1, paths = false) {
  let best = reach;
  const r = Math.ceil(reach / SG);
  const cx = Math.floor(x / SG), cz = Math.floor(z / SG);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    for (const s of segGrid.get(gkey(cx + i, cz + j)) ?? []) {
      if (s.road === skipRoad || (!paths && s.cls === 4)) continue;
      const d = segDist(s, x, z) - Math.max(s.half, s.cls < 3 ? ROUTE_EDGE : 0);
      if (d < best) best = d;
    }
  }
  return best;
}
/** Nearest point on a road of class <= maxCls, with its direction and half width. */
function nearestRoad(x: number, z: number, maxCls = 2, reach = 90) {
  let best: { x: number; z: number; ux: number; uz: number; half: number; d: number; road: number } | null = null;
  const r = Math.ceil(reach / SG);
  const cx = Math.floor(x / SG), cz = Math.floor(z / SG);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    for (const s of segGrid.get(gkey(cx + i, cz + j)) ?? []) {
      if (s.cls > maxCls) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (l * l)));
      const px = s.ax + dx * t, pz = s.az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < reach && (!best || d < best.d)) best = { x: px, z: pz, ux: dx / l, uz: dz / l, half: Math.max(s.half, ROUTE_EDGE), d, road: s.road };
    }
  }
  return best;
}

/** Places a landmark model covers, kept clear of props: [x, z, half x, half z]. */
const keepOut: [number, number, number, number][] = [];
for (const [name, hx, hz, dz] of [['Night Market', 22, 22, -6], ['Great Hall', 8, 8, 0], ['The Balme Library', 12, 12, 0]] as const) {
  const p = placeByName(name);
  if (p) keepOut.push([p.x, p.z + dz, hx, hz]);
}
const inKeepOut = (x: number, z: number, pad = 0) => keepOut.some(([kx, kz, hx, hz]) => Math.abs(x - kx) < hx + pad && Math.abs(z - kz) < hz + pad);
/** inside a landmark model's footprint (Night Market roofs, Great Hall, Balme Library) */
export const inLandmark = (x: number, z: number, pad = 0) => inKeepOut(x, z, pad);
const freeSpot = (x: number, z: number, r: number) => roadClearance(x, z, r + 6) > r && !buildingAt(x, z, r) && !inKeepOut(x, z, r);

// ---------- the sign atlas ----------
const ATLAS = 1024, SLOT_W = 512, SLOT_H = 32, ROWS = 23; // rows above the white block
const WHITE_UV: [number, number] = [0.5, 0.1];
class Atlas {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  slots = new Map<string, { uv: [number, number, number, number]; aspect: number }>();
  tex: THREE.CanvasTexture;
  constructor() {
    this.canvas.width = this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, ATLAS, ATLAS);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
  }
  get full() {
    return this.slots.size >= ROWS * 2;
  }
  /** A text strip; the UV rect is (u0, v0, u1, v1) and aspect is width over height. */
  text(text: string, bg = '#1d4f91', fg = '#ffffff') {
    const key = `${text}|${bg}|${fg}`;
    const got = this.slots.get(key);
    if (got) return got;
    if (this.full) return null;
    const n = this.slots.size;
    const x0 = (n % 2) * SLOT_W, y0 = Math.floor(n / 2) * SLOT_H;
    const g = this.ctx;
    let size = 22;
    g.font = `700 ${size}px Sora, system-ui, sans-serif`;
    let w = g.measureText(text).width;
    if (w > SLOT_W - 24) {
      size = Math.floor((size * (SLOT_W - 24)) / w);
      g.font = `700 ${size}px Sora, system-ui, sans-serif`;
      w = g.measureText(text).width;
    }
    const used = Math.min(SLOT_W, Math.ceil(w + 24));
    g.fillStyle = bg;
    g.fillRect(x0, y0, used, SLOT_H);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(x0 + 3, y0 + 3, used - 6, 1.5);
    g.fillRect(x0 + 3, y0 + SLOT_H - 4.5, used - 6, 1.5);
    g.fillStyle = fg;
    g.textBaseline = 'middle';
    g.fillText(text, x0 + 12, y0 + SLOT_H / 2 + 1);
    const slot = { uv: [(x0 + 1) / ATLAS, 1 - (y0 + SLOT_H - 1) / ATLAS, (x0 + used - 1) / ATLAS, 1 - (y0 + 1) / ATLAS] as [number, number, number, number], aspect: used / SLOT_H };
    this.slots.set(key, slot);
    this.tex.needsUpdate = true;
    return slot;
  }
}

// ---------- models: parts with fixed colours or colour slots ----------
type Part = [THREE.BufferGeometry, string | number];
interface Model { pos: Float32Array; nrm: Float32Array; col: Float32Array; slot: Int8Array; idx: Uint32Array }
function model(parts: Part[]): Model {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], slot: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (const [src, color] of parts) {
    // shared corners on rounded parts (crowns, wheels) are stored once
    src.deleteAttribute('uv');
    const geo = mergeVertices(src);
    if (geo !== src) src.dispose();
    const base = pos.length / 3;
    const p = geo.attributes.position, n = geo.attributes.normal;
    if (typeof color === 'string') c.set(color);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
      slot.push(typeof color === 'number' ? color : -1);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    geo.dispose();
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), slot: Int8Array.from(slot), idx: Uint32Array.from(idx) };
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** cylinder standing on y (base), open ended unless capped */
const cyl = (rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0, capped = false) =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, !capped).translate(x, y + h / 2, z);
/** a rounded lump (tree crowns, heads), smooth-shaded so its corners can be shared */
const blob = (r: number, x: number, y: number, z: number, sy = 0.8, detail = 0) => {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.setAttribute('normal', g.attributes.position.clone());
  g.normalizeNormals();
  return g.scale(1, sy, 1).translate(x, y, z);
};

function palmFronds(y: number, n: number, len: number) {
  const out: Part[] = [];
  for (let k = 0; k < n; k++) {
    const f = new THREE.ConeGeometry(0.42, len, 3, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2).scale(1, 0.22, 1);
    f.rotateX(0.25 + (k % 3) * 0.22);
    f.rotateY((k / n) * Math.PI * 2 + (k % 2) * 0.2);
    out.push([f.translate(0, y, 0), 0]);
  }
  return out;
}

export const TREES = {
  /** neem: short trunk, dense round dark crown */
  neem: () => model([
    [cyl(0.15, 0.24, 2.7, 5), '#5b4636'],
    [blob(1.9, 0, 3.7, 0, 0.8, 1), 0], [blob(1.3, 1.0, 3.2, 0.5), 0],
  ]),
  /** mahogany / cedrela: tall straight trunk and a high broad crown */
  mahogany: () => model([
    [cyl(0.22, 0.36, 6, 6), '#6a5442'],
    [cyl(0.08, 0.12, 2.2, 4).rotateZ(0.7).translate(0.2, 4.2, 0), '#6a5442'],
    [blob(2.7, 0, 7.0, 0, 0.62, 1), 0], [blob(1.8, 1.4, 6.3, -0.9, 0.7), 0],
  ]),
  /** flame tree: low split trunk and a wide, flat umbrella crown, red in flower */
  flame: () => model([
    [cyl(0.17, 0.28, 2.6, 5), '#6b5a4a'],
    [blob(3.0, 0, 3.9, 0, 0.36, 1), 0], [blob(1.9, 1.5, 3.5, 0.9, 0.42), 1],
  ]),
  /** royal palm: tall smooth grey trunk, green crownshaft, drooping fronds */
  palm: () => model([
    [cyl(0.19, 0.27, 8.6, 5), '#b8b2a5'],
    [cyl(0.2, 0.21, 1.4, 5, 0, 8.6), '#6a8f3c'],
    ...palmFronds(9.9, 7, 3.3),
  ]),
};
type Species = keyof typeof TREES;
const LEAF: Record<Species, string[][]> = {
  neem: [['#3a6b28'], ['#447a2e'], ['#355f24']],
  mahogany: [['#2f5e22'], ['#386b27'], ['#2b5420']],
  flame: [['#d8431c', '#4f7f2a'], ['#e0582a', '#56862e'], ['#c93a1a', '#4a7a29'], ['#4f7f2a', '#4a7a29']],
  palm: [['#4f8a2f'], ['#5a9435'], ['#467d2a']],
};

/** Instanced trees for the ridden route layer: one draw call per species. */
const treeGeoCache = new Map<Species, THREE.BufferGeometry>();
function treeGeometry(s: Species) {
  let g = treeGeoCache.get(s);
  if (g) return g;
  const m = TREES[s]();
  const col = new Float32Array(m.col);
  const leaf = new THREE.Color(LEAF[s][0][0]), leaf2 = new THREE.Color(LEAF[s][0][1] ?? LEAF[s][0][0]);
  for (let i = 0; i < m.slot.length; i++) {
    if (m.slot[i] < 0) continue;
    const c = m.slot[i] === 1 ? leaf2 : leaf;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  treeGeoCache.set(s, g);
  return g;
}
const treeInstMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
/** Adds route-side trees: a mix of species, as instanced meshes marked shared. */
export function addRouteTrees(group: THREE.Group, spots: THREE.Matrix4[], rand: () => number) {
  const by: Record<Species, THREE.Matrix4[]> = { neem: [], mahogany: [], flame: [], palm: [] };
  const kinds: Species[] = ['neem', 'mahogany', 'flame', 'palm', 'palm', 'neem'];
  for (const m of spots) by[kinds[(rand() * kinds.length) | 0]].push(m);
  for (const s of Object.keys(by) as Species[]) {
    const list = by[s];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(treeGeometry(s), treeInstMat, list.length);
    const c = new THREE.Color();
    list.forEach((mm, k) => {
      im.setMatrixAt(k, mm);
      im.setColorAt(k, c.setScalar(0.88 + rand() * 0.2));
    });
    im.castShadow = im.receiveShadow = true;
    im.userData.shared = true;
    group.add(im);
  }
}

const S = {
  lampPole: () => model([
    [cyl(0.07, 0.11, 7, 5), '#5c6168'],
    [box(1.3, 0.1, 0.12, 0.6, 7, 0), '#5c6168'],
    [box(0.55, 0.12, 0.3, 1.2, 6.92, 0), '#d6d2c6'],
  ]),
  car: () => model([
    [box(1.76, 0.62, 4.2, 0, 0.62, 0), 0],
    [box(1.56, 0.52, 2.1, 0, 1.18, -0.15), '#1f2a35'],
    // wheels: one block per axle, showing on both sides
    [box(1.82, 0.58, 0.62, 0, 0.29, 1.32), '#161616'], [box(1.82, 0.58, 0.62, 0, 0.29, -1.32), '#161616'],
    [box(1.5, 0.14, 0.04, 0, 0.74, 2.11), '#f2efe2'],
    [box(1.5, 0.14, 0.04, 0, 0.74, -2.11), '#b3261e'],
  ]),
  okada: () => model([
    [cyl(0.3, 0.3, 0.1, 7).rotateZ(Math.PI / 2).translate(0.05, 0.3, 0.62), '#141414'],
    [cyl(0.3, 0.3, 0.1, 7).rotateZ(Math.PI / 2).translate(0.05, 0.3, -0.62), '#141414'],
    [box(0.28, 0.32, 1.0, 0, 0.55, 0), 0],
    [box(0.3, 0.12, 0.62, 0, 0.82, -0.2), '#1b1b1b'],
    [box(0.3, 0.2, 0.32, 0, 0.82, 0.28), 0],
    [box(0.62, 0.04, 0.04, 0, 1.08, 0.58), '#2a2a2a'],
    [box(0.05, 0.5, 0.05, 0, 0.82, 0.58), '#555'],
    [box(0.2, 0.14, 0.08, 0, 0.98, 0.66), '#e8e4d0'],
  ]),
  kiosk: () => model([
    [box(2.6, 2.3, 2.0, 0, 1.15 + 0.15, 0), 0],
    [box(2.2, 0.9, 0.06, 0, 1.75, 1.02), '#2a2622'],
    [box(2.4, 0.12, 0.5, 0, 1.25, 1.15), '#d9cdb5'],
    [box(2.9, 0.08, 1.0, 0, 2.62, 1.3).rotateX(0), 1],
    [box(2.8, 0.15, 2.2, 0, 2.55, 0), '#d8d4cc'],
    [box(2.7, 0.15, 2.1, 0, 0.075, 0), '#77706a'],
  ]),
  umbrella: () => model([
    [cyl(0.03, 0.03, 2.3, 4), '#d8d8d8'],
    [new THREE.ConeGeometry(1.5, 0.55, 8, 1, true).translate(0, 2.45, 0), 0],
    [new THREE.ConeGeometry(1.5, 0.55, 8, 1, true).rotateX(Math.PI).translate(0, 2.44, 0), 0],
    [box(0.8, 0.05, 0.8, 0, 0.74, 0), '#f1efe8'],
    [cyl(0.05, 0.05, 0.72, 4), '#e6e3dc'],
    [box(0.42, 0.42, 0.42, 0.75, 0.21, 0), 1], [box(0.42, 0.42, 0.42, -0.75, 0.21, 0.1), 1], [box(0.42, 0.42, 0.42, 0, 0.21, -0.78), 1],
    [box(0.42, 0.45, 0.06, 0.95, 0.62, 0), 1], [box(0.42, 0.45, 0.06, -0.95, 0.62, 0.1), 1],
  ]),
  seller: () => model([
    [box(1.4, 0.06, 0.8, 0, 0.8, 0.5), '#9b7a55'],
    [box(0.06, 0.8, 0.06, 0.62, 0.4, 0.82), '#6d5235'], [box(0.06, 0.8, 0.06, -0.62, 0.4, 0.82), '#6d5235'],
    [box(0.06, 0.8, 0.06, 0.62, 0.4, 0.18), '#6d5235'], [box(0.06, 0.8, 0.06, -0.62, 0.4, 0.18), '#6d5235'],
    [cyl(0.32, 0.22, 0.22, 8, -0.3, 0.83, 0.5), '#c9c9cf'],
    [cyl(0.28, 0.2, 0.2, 8, 0.35, 0.83, 0.5), 2],
    [box(0.4, 0.4, 0.4, 0, 0.2, -0.35), '#2c62b4'],
  ]),
  /** a student standing: 0 shirt, 1 trousers or skirt, 2 skin, 3 hair */
  standing: () => model([
    [box(0.32, 0.82, 0.18, 0, 0.41, 0), 1],
    [box(0.42, 0.62, 0.24, 0, 1.13, 0), 0],
    [box(0.1, 0.6, 0.12, 0.27, 1.12, 0), 2], [box(0.1, 0.6, 0.12, -0.27, 1.12, 0), 2],
    [blob(0.14, 0, 1.6, 0, 1.2), 2],
    [box(0.24, 0.08, 0.25, 0, 1.74, -0.01), 3],
  ]),
  /** a student sitting on something 0.45 m high, facing +z */
  sitting: () => model([
    [box(0.32, 0.16, 0.48, 0, 0.5, 0.2), 1],
    [box(0.3, 0.45, 0.15, 0, 0.225, 0.42), 1],
    [box(0.42, 0.58, 0.24, 0, 0.86, -0.02), 0],
    [box(0.1, 0.48, 0.12, 0.27, 0.84, 0.06).rotateX(-0.4), 2], [box(0.1, 0.48, 0.12, -0.27, 0.84, 0.06).rotateX(-0.4), 2],
    [blob(0.14, 0, 1.32, 0, 1.2), 2],
    [box(0.24, 0.08, 0.25, 0, 1.46, -0.01), 3],
  ]),
  bench: () => model([
    [box(1.8, 0.07, 0.42, 0, 0.45, 0), '#a77b4f'],
    [box(1.8, 0.32, 0.05, 0, 0.72, -0.2), '#a77b4f'],
    [box(0.08, 0.45, 0.4, 0.8, 0.225, 0), '#4a4d52'], [box(0.08, 0.45, 0.4, -0.8, 0.225, 0), '#4a4d52'],
  ]),
  shelter: () => model([
    [box(4.2, 0.14, 2.0, 0, 2.62, 0.1), 0],
    [box(4.2, 0.3, 0.06, 0, 2.48, 1.1), 0],
    [box(0.1, 2.6, 0.1, 2.0, 1.3, -0.7), '#d9dde2'], [box(0.1, 2.6, 0.1, -2.0, 1.3, -0.7), '#d9dde2'],
    [box(0.1, 2.6, 0.1, 2.0, 1.3, 0.8), '#d9dde2'], [box(0.1, 2.6, 0.1, -2.0, 1.3, 0.8), '#d9dde2'],
    [box(3.9, 1.6, 0.04, 0, 1.55, -0.72), '#9fb6c4'],
    [box(0.04, 1.6, 1.2, 2.0, 1.55, -0.1), '#9fb6c4'],
    [box(3.4, 0.07, 0.42, 0, 0.48, -0.45), '#c7ccd2'],
    [box(0.08, 0.48, 0.38, 1.5, 0.24, -0.45), '#555a60'], [box(0.08, 0.48, 0.38, -1.5, 0.24, -0.45), '#555a60'],
    [box(4.4, 0.12, 2.3, 0, 0.06, 0.1), '#b9b3a8'],
    [cyl(0.04, 0.04, 2.9, 4, 2.6, 0, 1.0), '#6a6f76'],
    [box(0.06, 0.6, 0.6, 2.6, 2.6, 1.0), 0],
  ]),
  signPost: () => model([[cyl(0.045, 0.05, 3.1, 4), '#6a6f76']]),
  blade: () => model([[box(1, 0.26, 0.035, 0, 0, 0), '#1d4f91']]),
  board: () => model([
    [box(0.12, 2.2, 0.12, 1.6, 1.1, 0), '#3d4046'], [box(0.12, 2.2, 0.12, -1.6, 1.1, 0), '#3d4046'],
    [box(3.5, 1.0, 0.12, 0, 1.8, 0), 0],
    [box(3.7, 0.1, 0.3, 0, 2.35, 0), '#f6f2e8'],
    [box(1.2, 0.35, 0.8, 1.6, 0.17, 0.4), '#e8e2d4'], [box(1.2, 0.35, 0.8, -1.6, 0.17, 0.4), '#e8e2d4'],
  ]),
  hedge: () => model([[box(1, 0.95, 0.85, 0, 0.475, 0), 0], [box(0.96, 0.18, 0.75, 0, 1.0, 0), 1]]),
  bed: () => {
    const parts: Part[] = [
      [box(2.4, 0.22, 0.1, 0, 0.11, 0.6), '#efe9dc'], [box(2.4, 0.22, 0.1, 0, 0.11, -0.6), '#efe9dc'],
      [box(0.1, 0.22, 1.3, 1.2, 0.11, 0), '#efe9dc'], [box(0.1, 0.22, 1.3, -1.2, 0.11, 0), '#efe9dc'],
      [box(2.3, 0.16, 1.1, 0, 0.08, 0), '#4b3527'],
    ];
    for (let i = 0; i < 3; i++) parts.push([box(0.62, 0.22, 0.9, -0.75 + i * 0.75, 0.27, 0), i]);
    for (let i = 0; i < 2; i++) parts.push([blob(0.3, -0.38 + i * 0.75, 0.34, 0, 0.8), '#3f7a2c']);
    return model(parts);
  },
  gateBooth: () => model([
    [box(2.2, 2.4, 2.2, 0, 1.2, 0), '#f1ece2'],
    [box(1.6, 0.8, 0.04, 0, 1.6, 1.11), '#22303c'],
    [box(2.8, 0.18, 2.8, 0, 2.5, 0), '#a24b2e'],
  ]),
};

// ---------- the per-cell batch ----------
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
/** a growable typed array */
class Grow<T extends Float32Array | Uint8Array | Int8Array | Uint16Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  need(k: number) {
    if (this.n + k <= this.a.length) return;
    const b = new (this.a.constructor as new (n: number) => T)(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a);
    this.a = b;
  }
  get view() {
    return this.a.slice(0, this.n) as T;
  }
}
class Batch {
  pos = new Grow(new Float32Array(3072));
  nrm = new Grow(new Int8Array(3072));
  col = new Grow(new Uint8Array(3072));
  uv = new Grow(new Uint16Array(2048));
  idx = new Grow(new Uint32Array(4096));
  get verts() {
    return this.pos.n / 3;
  }
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, u: number, v: number) {
    const P = this.pos, N = this.nrm, C = this.col, U = this.uv;
    P.a[P.n++] = x; P.a[P.n++] = y; P.a[P.n++] = z;
    N.a[N.n++] = nx * 127; N.a[N.n++] = ny * 127; N.a[N.n++] = nz * 127;
    C.a[C.n++] = Math.min(255, r * 255 + 0.5); C.a[C.n++] = Math.min(255, g * 255 + 0.5); C.a[C.n++] = Math.min(255, b * 255 + 0.5);
    U.a[U.n++] = u * 65535; U.a[U.n++] = v * 65535;
  }
  private reserve(v: number, i: number) {
    this.pos.need(v * 3); this.nrm.need(v * 3); this.col.need(v * 3); this.uv.need(v * 2); this.idx.need(i);
  }
  add(m: Model, mat: THREE.Matrix4, slots: THREE.Color[] = [], shade = 1) {
    const nv = m.slot.length;
    this.reserve(nv, m.idx.length);
    const base = this.verts;
    const e = mat.elements;
    for (let i = 0; i < nv; i++) {
      const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
      const a = m.nrm[i * 3], b = m.nrm[i * 3 + 1], c = m.nrm[i * 3 + 2];
      let nx = e[0] * a + e[4] * b + e[8] * c, ny = e[1] * a + e[5] * b + e[9] * c, nz = e[2] * a + e[6] * b + e[10] * c;
      const l = 1 / (Math.hypot(nx, ny, nz) || 1);
      nx *= l; ny *= l; nz *= l;
      const s = m.slot[i];
      const col = s >= 0 ? slots[s] ?? slots[0] : null;
      const r = col ? col.r : m.col[i * 3], g = col ? col.g : m.col[i * 3 + 1], bb = col ? col.b : m.col[i * 3 + 2];
      this.vert(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx, ny, nz, r * shade, g * shade, bb * shade, WHITE_UV[0], WHITE_UV[1]);
    }
    const I = this.idx;
    for (let i = 0; i < m.idx.length; i++) I.a[I.n++] = base + m.idx[i];
  }
  /** a quad from four corners (counter-clockwise seen from the front), coloured, with UVs */
  quad(p: THREE.Vector3[], c: THREE.Color, uv?: [number, number, number, number]) {
    this.reserve(4, 6);
    const base = this.verts;
    _n.subVectors(p[1], p[0]).cross(_v.subVectors(p[2], p[0])).normalize();
    const uvs = uv ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] : [WHITE_UV, WHITE_UV, WHITE_UV, WHITE_UV];
    p.forEach((q, k) => this.vert(q.x, q.y, q.z, _n.x, _n.y, _n.z, c.r, c.g, c.b, uvs[k][0], uvs[k][1]));
    const I = this.idx;
    for (const k of [0, 1, 2, 0, 2, 3]) I.a[I.n++] = base + k;
  }
  get empty() {
    return this.idx.n === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.view, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.view, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view, 2, true));
    g.setIndex(new THREE.BufferAttribute(this.verts > 65535 ? this.idx.view : Uint16Array.from(this.idx.view), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Additive glow quads: lamp halos, light pools on the ground, kiosk bulbs. */
class GlowBatch {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private q(p: number[][], c: THREE.Color) {
    const base = this.pos.length / 3;
    for (const v of p) this.pos.push(v[0], v[1], v[2]);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) this.col.push(c.r, c.g, c.b);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** a halo seen from any side: two crossed vertical quads and a flat one */
  halo(x: number, y: number, z: number, r: number, c: THREE.Color) {
    this.q([[x - r, y - r, z], [x + r, y - r, z], [x + r, y + r, z], [x - r, y + r, z]], c);
    this.q([[x, y - r, z - r], [x, y - r, z + r], [x, y + r, z + r], [x, y + r, z - r]], c);
    this.q([[x - r, y, z - r], [x + r, y, z - r], [x + r, y, z + r], [x - r, y, z + r]], c);
  }
  pool(x: number, z: number, r: number, c: THREE.Color) {
    const y = 0.06;
    this.q([[x - r, y, z + r], [x + r, y, z + r], [x + r, y, z - r], [x - r, y, z - r]], c);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const atlas = new Atlas();
const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas.tex, roughness: 0.82 });
const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, visible: false });

let nightOn = false;
/** Lit windows, street lamps and kiosk lights after dark. Call from Game.setTimeOfDay. */
export function setNightLights(on: boolean) {
  nightOn = on;
  glowMat.visible = on;
  setWindowLights(on ? 1 : 0);
  for (const fn of nightHooks) fn(on);
}
/** other night lights (landmarks) register here */
export const nightHooks: ((on: boolean) => void)[] = [];

// ---------- cells and culling ----------
class Cells {
  props = new Map<string, Batch>();
  glow = new Map<string, GlowBatch>();
  key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  p(x: number, z: number) {
    const k = this.key(x, z);
    let b = this.props.get(k);
    if (!b) this.props.set(k, (b = new Batch()));
    return b;
  }
  g(x: number, z: number) {
    const k = this.key(x, z);
    let b = this.glow.get(k);
    if (!b) this.glow.set(k, (b = new GlowBatch()));
    return b;
  }
}

/**
 * Skips meshes wholly beyond the fog (they would draw as plain fog colour anyway).
 * Hooks the scene's onBeforeRender once `root` is added to a scene.
 */
export function cullBeyondFog(root: THREE.Object3D, meshes: THREE.Mesh[]) {
  const spheres = meshes.map((m) => {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
  });
  const cam = new THREE.Vector3();
  root.addEventListener('added', () => {
    const scene = root.parent as THREE.Scene | null;
    if (!scene || !(scene as THREE.Scene).isScene || scene.userData.lifeCull?.includes(root)) return;
    (scene.userData.lifeCull ??= []).push(root);
    const prev = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args) => {
      prev(...args);
      const camera = args[2], s = args[1];
      if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
      const fog = s.fog as THREE.Fog | null;
      const far = fog && 'far' in fog ? fog.far + 20 : Infinity;
      cam.setFromMatrixPosition(camera.matrixWorld);
      for (let i = 0; i < meshes.length; i++) meshes[i].visible = cam.distanceTo(spheres[i].center) - spheres[i].radius < far;
    };
  });
}

// ---------- building it all ----------
const C = (hex: string) => new THREE.Color(hex);
const pick = <T,>(rand: () => number, a: T[]) => a[(rand() * a.length) | 0];
const yawM = (x: number, y: number, z: number, yaw: number, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));

const SKIN = ['#5a3a26', '#6b4430', '#4a2f20', '#7a4e34', '#3f281b'].map(C);
const HAIR = ['#141110', '#1d1713', '#2a1f18'].map(C);
const SHIRTS = ['#f2f2f2', '#2b2f3a', '#c8102e', '#1f3a93', '#f5c518', '#2e8b3a', '#e08a1e', '#8e24aa', '#16a3a3', '#d9c7a3', '#6d7b8a', '#e4572e'].map(C);
const BOTTOMS = ['#1e2633', '#2b3a55', '#3a3a3a', '#6b5b45', '#14161b', '#4a5a7a'].map(C);
const CAR_COLORS = ['#e9e9ea', '#e9e9ea', '#c8ccd0', '#9aa1a8', '#1b1d22', '#2b3b5a', '#7a1e1e', '#e9e9ea', '#5d6168', '#2f5a3a', '#d6a520'].map(C);
const BIKE_COLORS = ['#b3261e', '#1b1b1b', '#1f3a93', '#c8c8c8', '#b3261e'].map(C);
const KIOSK = [['#1f6fb8', '#f5c518'], ['#f5c518', '#1f6fb8'], ['#c8102e', '#f2f2f2'], ['#2e8b3a', '#f5c518'], ['#e08a1e', '#2b2f3a'], ['#f2f2f2', '#c8102e']].map((p) => p.map(C));
const UMBRELLA = ['#c8102e', '#f5c518', '#1f6fb8', '#2e8b3a', '#e4572e', '#f2f2f2'].map(C);
const CHAIRS = ['#f2f2f2', '#c8102e', '#1f6fb8', '#2e8b3a'].map(C);
const FLOWERS = [['#d81b60', '#f5c518', '#ff7043'], ['#e53935', '#fdd835', '#ffffff'], ['#ab47bc', '#ff8a65', '#fdd835']].map((p) => p.map(C));
const KIOSK_SIGNS = ['PROVISIONS', 'MOBILE MONEY', 'PHOTOCOPY & PRINTING', 'CHOP BAR', 'WAAKYE', 'KENKEY & FISH', 'FRIED RICE', 'SACHET WATER', 'BOOKSHOP', 'BARBERING SALON', 'PHONE REPAIRS'];

const hallColor = new Map<string, THREE.Color>();
for (const h of HALLS) if (HALL_PLACE[h.id]) hallColor.set(HALL_PLACE[h.id], C(h.color));
/** colour of the hall a place belongs to (by name), if any */
function hallOf(p: Place) {
  for (const [place, c] of hallColor) {
    const base = place.replace(/ Main$/, '').replace(/^Dr\. /, '');
    if (p.name.startsWith(base) || p.name === place) return c;
  }
  return null;
}

/** Builds every static prop of campus life, culled per cell. */
export function buildCampusLife() {
  const group = new THREE.Group();
  group.name = 'campus-life';
  const rand = rng(97);
  const cells = new Cells();
  const M = Object.fromEntries(Object.entries(S).map(([k, f]) => [k, f()])) as Record<keyof typeof S, Model>;
  const T = Object.fromEntries((Object.keys(TREES) as Species[]).map((k) => [k, TREES[k]()])) as Record<Species, Model>;

  const tree = (x: number, z: number, sp: Species, sc = 1) => {
    const leaf = pick(rand, LEAF[sp]).map(C);
    cells.p(x, z).add(T[sp], yawM(x, 0, z, rand() * 6.28, sc), leaf, 0.9 + rand() * 0.18);
  };
  const person = (b: Batch, x: number, z: number, yaw: number, sitting: boolean, shirt?: THREE.Color | null) => {
    const s = shirt ?? pick(rand, SHIRTS);
    b.add(sitting ? M.sitting : M.standing, yawM(x, 0, z, yaw, 0.92 + rand() * 0.14), [s, pick(rand, BOTTOMS), pick(rand, SKIN), pick(rand, HAIR)]);
  };
  const group3 = (x: number, z: number, n: number, shirt?: THREE.Color | null) => {
    const b = cells.p(x, z);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.5, r = 0.55 + rand() * 0.25;
      const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      // face the middle of the group
      person(b, px, pz, Math.atan2(x - px, z - pz), false, rand() < 0.55 ? shirt : null);
    }
  };
  const benchGroup = (x: number, z: number, yaw: number, shirt?: THREE.Color | null) => {
    const b = cells.p(x, z);
    b.add(M.bench, yawM(x, 0, z, yaw));
    const n = 1 + ((rand() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const off = -0.6 + i * 0.6;
      person(b, x + Math.cos(yaw) * off - Math.sin(yaw) * 0.05, z - Math.sin(yaw) * off - Math.cos(yaw) * 0.05, yaw, true, rand() < 0.5 ? shirt : null);
    }
  };
  /** a spot near (x, z) within r, off roads and buildings, near enough to a road to be busy */
  const spotNear = (x: number, z: number, r: number, need = 1.6, tries = 14, roadside = false) => {
    for (let t = 0; t < tries; t++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      // roadside: kiosks and okadas line the kerb
      if (freeSpot(px, pz, need) && (!roadside || roadClearance(px, pz, 12) < need + 3)) return [px, pz] as [number, number];
    }
    return null;
  };
  const faceRoad = (x: number, z: number) => {
    const r = nearestRoad(x, z, 3, 40);
    return r ? Math.atan2(r.x - x, r.z - z) : rand() * 6.28;
  };

  // --- street trees, kerbs, drains, lamps along the campus roads ---
  const lampC = C('#ffd28a');
  ROADS.forEach((r, ri) => {
    if (r.cls > 2) return;
    const half = ROAD_WIDTH[r.cls] / 2;
    const style = hash(ri, 7);
    // palm-lined avenues, mahogany avenues, or a mix
    const pickSpecies = (): Species => {
      if (r.cls <= 1 && style < 0.35) return rand() < 0.85 ? 'palm' : 'flame';
      if (style < 0.55) return rand() < 0.8 ? 'mahogany' : 'neem';
      const u = rand();
      return u < 0.36 ? 'neem' : u < 0.58 ? 'flame' : u < 0.78 ? 'mahogany' : 'palm';
    };
    const kerbAt = Math.max(half, ROUTE_EDGE);
    let carry = rand() * 20, lampCarry = rand() * 40, lampSide = 1;
    for (let k = 0; k < r.nodes.length - 1; k++) {
      const a = r.nodes[k], c = r.nodes[k + 1];
      const ax = NODE_XZ[a * 2], az = NODE_XZ[a * 2 + 1], cx = NODE_XZ[c * 2], cz = NODE_XZ[c * 2 + 1];
      const len = Math.hypot(cx - ax, cz - az);
      if (len < 0.5) continue;
      const ux = (cx - ax) / len, uz = (cz - az) / len, nx = -uz, nz = ux;
      let t = carry;
      for (; t < len; t += 22 + rand() * 12) {
        for (const s of [-1, 1]) {
          // thinner beyond the main campus, to keep memory down on phones
          if (rand() < (Math.hypot(ax, az - 400) > 1600 ? 0.8 : 0.2)) continue;
          const off = kerbAt + 2.8 + rand() * 4;
          const x = ax + ux * t + nx * s * off, z = az + uz * t + nz * s * off;
          if (!freeSpot(x, z, 1.4)) continue;
          tree(x, z, pickSpecies(), 0.8 + rand() * 0.5);
          // shade invites a bench now and then
          if (rand() < 0.05) {
            const bx = x - nx * s * 1.6, bz = z - nz * s * 1.6;
            if (freeSpot(bx, bz, 0.9)) benchGroup(bx, bz, Math.atan2(-nx * s, -nz * s));
          }
        }
      }
      carry = t - len;
      if (r.cls <= 1 || Math.hypot(ax, az - 400) < 1400) {
        let lt = lampCarry;
        for (; lt < len; lt += 40) {
          lampSide = -lampSide;
          const off = kerbAt + 1.7;
          const x = ax + ux * lt + nx * lampSide * off, z = az + uz * lt + nz * lampSide * off;
          if (roadClearance(x, z, 8, ri) < 0.5 || buildingAt(x, z, 0.5)) continue;
          // the arm reaches out over the road
          const yaw = Math.atan2(-nx * lampSide, -nz * lampSide) - Math.PI / 2;
          cells.p(x, z).add(M.lampPole, yawM(x, 0, z, yaw));
          const hx = x - nx * lampSide * 1.2, hz = z - nz * lampSide * 1.2;
          const g = cells.g(x, z);
          g.halo(hx, 6.8, hz, 0.9, lampC);
          g.pool(hx - nx * lampSide * 0.5, hz - nz * lampSide * 0.5, 4.5, C('#7a5a2c'));
        }
        lampCarry = lt - len;
      }
    }
    // raised kerbs on the main campus only; beyond it the verge and drain do the job
    const [x0, z0] = [NODE_XZ[r.nodes[0] * 2], NODE_XZ[r.nodes[0] * 2 + 1]];
    if (Math.hypot(x0, z0 - 400) < 1700) kerbs(cells, r, ri, kerbAt);
  });

  // --- woods and open ground near buildings get scattered trees ---
  for (const a of AREAS) {
    if (a.kind !== 'wood') continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < a.pts.length; i += 2) { minX = Math.min(minX, a.pts[i]); maxX = Math.max(maxX, a.pts[i]); minZ = Math.min(minZ, a.pts[i + 1]); maxZ = Math.max(maxZ, a.pts[i + 1]); }
    const n = Math.min(220, ((maxX - minX) * (maxZ - minZ)) / 260);
    for (let i = 0; i < n; i++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (inPoly(a.pts, x, z) && freeSpot(x, z, 1.5)) tree(x, z, rand() < 0.6 ? 'mahogany' : 'neem', 0.8 + rand() * 0.6);
    }
  }
  for (const p of PLACES) {
    if (p.kind !== 'academic' && p.kind !== 'hall' && p.kind !== 'worship') continue;
    for (let i = 0; i < 4; i++) {
      const s = spotNear(p.x, p.z, 55, 2.5, 6);
      if (s) tree(s[0], s[1], pick(rand, ['neem', 'mahogany', 'flame', 'palm'] as Species[]), 0.8 + rand() * 0.5);
    }
    if (p.kind === 'academic' && rand() < 0.35) {
      const s = spotNear(p.x, p.z, 40, 2);
      if (s) rand() < 0.5 ? group3(s[0], s[1], 2 + ((rand() * 3) | 0)) : benchGroup(s[0], s[1], rand() * 6.28);
    }
  }

  // --- halls: hedges along the blocks, flower beds, a name board, students in hall colours ---
  const hallPlaces = PLACES.filter((p) => p.kind === 'hall');
  const hedged = new Set<number>();
  for (const p of hallPlaces) {
    const shirt = hallOf(p);
    BUILDINGS.forEach((b, bi) => {
      if (hedged.has(bi)) return;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if (Math.hypot(cx - p.x, cz - p.z) > 70) return;
      hedged.add(bi);
      hedges(cells, M.hedge, b.pts, cx, cz, rand);
    });
    for (let i = 0; i < 2; i++) {
      const s = spotNear(p.x, p.z, 35, 2);
      if (s) cells.p(s[0], s[1]).add(M.bed, yawM(s[0], 0, s[1], faceRoad(s[0], s[1])), pick(rand, FLOWERS));
    }
    const groups = shirt ? 4 : 2;
    for (let i = 0; i < groups; i++) {
      const s = spotNear(p.x, p.z, 45, 1.4);
      if (!s) continue;
      if (rand() < 0.35) benchGroup(s[0], s[1], faceRoad(s[0], s[1]), shirt);
      else group3(s[0], s[1], 2 + ((rand() * 4) | 0), shirt);
    }
  }
  for (const [place, color] of hallColor) {
    const p = placeByName(place);
    if (!p) continue;
    const r = nearestRoad(p.x, p.z, 2, 120);
    if (!r) continue;
    const side = Math.sign((p.x - r.x) * -r.uz + (p.z - r.z) * r.ux) || 1;
    const nx = -r.uz * side, nz = r.ux * side;
    let x = r.x + nx * (r.half + 4.5), z = r.z + nz * (r.half + 4.5);
    for (let t = 0; t < 6 && !freeSpot(x, z, 1.8); t++) { x += r.ux * 4; z += r.uz * 4; }
    if (!freeSpot(x, z, 1.8)) continue;
    const yaw = Math.atan2(-nx, -nz);
    const b = cells.p(x, z);
    b.add(M.board, yawM(x, 0, z, yaw), [color]);
    const name = p.name.replace(/^Dr\. /, '').replace(/ Main$/, '').toUpperCase();
    signFaces(b, atlas.text(name, '#' + color.getHexString(), '#ffffff'), x, 1.8, z, yaw, 3.3, 0.85, 0.07, true);
    const bed = (dx: number) => b.add(M.bed, yawM(x + Math.cos(yaw) * dx + nx * 1.6, 0, z - Math.sin(yaw) * dx + nz * 1.6, yaw), pick(rand, FLOWERS));
    bed(-1.3); bed(1.3);
  }

  // --- UG shuttle stops, with people waiting ---
  const fasciaText = atlas.text('UG SHUTTLE  ·  BUS STOP', '#1f4e9b', '#ffffff');
  for (const p of PLACES) {
    if (p.kind !== 'transport' || Math.hypot(p.x, p.z) > 2200) continue;
    const r = nearestRoad(p.x, p.z, 2, 60);
    if (!r) continue;
    const side = Math.sign((p.x - r.x) * -r.uz + (p.z - r.z) * r.ux) || 1;
    const nx = -r.uz * side, nz = r.ux * side;
    const x = r.x + nx * (r.half + 3.4), z = r.z + nz * (r.half + 3.4);
    if (roadClearance(x, z, 10) < 1.2 || buildingAt(x, z, 2.2)) continue;
    const yaw = Math.atan2(-nx, -nz);
    const b = cells.p(x, z);
    b.add(M.shelter, yawM(x, 0, z, yaw), [C('#1f4e9b')]);
    signFaces(b, fasciaText, x + nx * 1.14 * -1 * 0 + Math.sin(yaw) * 1.14, 2.48, z + Math.cos(yaw) * 1.14, yaw, 3.9, 0.26, 0, false);
    const sx = x + Math.cos(yaw) * 2.6 + Math.sin(yaw) * 1.0, sz = z - Math.sin(yaw) * 2.6 + Math.cos(yaw) * 1.0;
    signFaces(b, atlas.text('UG SHUTTLE', '#1f4e9b', '#ffffff'), sx, 2.6, sz, yaw + Math.PI / 2, 0.58, 0.18, 0.035, true);
    const n = (rand() * 4) | 0;
    for (let i = 0; i < n; i++) {
      const off = -1.4 + i * 0.95;
      if (rand() < 0.5) person(b, x + Math.cos(yaw) * off - Math.sin(yaw) * 0.45, z - Math.sin(yaw) * off - Math.cos(yaw) * 0.45, yaw, true);
      else person(b, x + Math.cos(yaw) * off + Math.sin(yaw) * 0.6, z - Math.sin(yaw) * off + Math.cos(yaw) * 0.6, yaw + (rand() - 0.5), false);
    }
    cells.g(x, z).halo(x, 2.45, z, 0.6, C('#cfe0ff'));
  }

  // --- street-name signs at junctions of named roads ---
  const named = new Map<number, { road: number; ux: number; uz: number }[]>();
  ROADS.forEach((r, ri) => {
    if (r.cls > 2 || !r.name) return;
    for (let k = 0; k < r.nodes.length; k++) {
      const i = r.nodes[k];
      if (nodeDegree(i) < 3) continue;
      const j = r.nodes[k + 1] ?? r.nodes[k - 1];
      const dx = NODE_XZ[j * 2] - NODE_XZ[i * 2], dz = NODE_XZ[j * 2 + 1] - NODE_XZ[i * 2 + 1], l = Math.hypot(dx, dz) || 1;
      let l2 = named.get(i);
      if (!l2) named.set(i, (l2 = []));
      if (!l2.some((e) => ROADS[e.road].name === r.name)) l2.push({ road: ri, ux: dx / l, uz: dz / l });
    }
  });
  const nameCount = new Map<string, number>();
  for (const l of named.values()) for (const e of l) nameCount.set(ROADS[e.road].name!, (nameCount.get(ROADS[e.road].name!) ?? 0) + 1);
  const topNames = new Set([...nameCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map((e) => e[0]));
  for (const [i, l] of named) {
    const roads = l.filter((e) => topNames.has(ROADS[e.road].name!));
    if (!roads.length) continue;
    const x0 = NODE_XZ[i * 2], z0 = NODE_XZ[i * 2 + 1];
    const a = roads[0], b2 = roads[1] ?? l.find((e) => e !== a) ?? a;
    // the corner between the two roads
    let bx = a.ux + b2.ux, bz = a.uz + b2.uz;
    if (Math.hypot(bx, bz) < 0.2) { bx = -a.uz; bz = a.ux; }
    const bl = Math.hypot(bx, bz);
    const x = x0 + (bx / bl) * 9, z = z0 + (bz / bl) * 9;
    if (!freeSpot(x, z, 0.6)) continue;
    const bt = cells.p(x, z);
    bt.add(M.signPost, yawM(x, 0, z, 0));
    roads.slice(0, 2).forEach((e, k) => {
      const slot = atlas.text(ROADS[e.road].name!.toUpperCase(), '#1d4f91', '#ffffff');
      if (!slot) return;
      const yaw = Math.atan2(e.ux, e.uz) + Math.PI / 2;
      const w = Math.min(2.2, 0.24 * slot.aspect);
      const y = 2.85 - k * 0.3;
      bt.add(M.blade, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w + 0.06, 1, 1)));
      signFaces(bt, slot, x, y, z, yaw, w, 0.22, 0.02, true);
    });
  }

  // --- parked cars in the car parks ---
  let cars = 0;
  for (const a of AREAS) {
    if (a.kind !== 'parking' || cars > 700) continue;
    cars += parkCars(cells, M.car, a.pts, rand);
  }

  // --- busy spots: the Night Market, food joints, halls and taxi ranks ---
  const busy: [Place, number][] = [];
  const market = placeByName('Night Market');
  if (market) busy.push([market, 1]);
  for (const p of PLACES) {
    if (p === market || Math.hypot(p.x, p.z) > 2200) continue;
    if (p.kind === 'food') busy.push([p, 0.35]);
    else if (hallColor.has(p.name)) busy.push([p, 0.45]);
    else if (p.kind === 'transport' && /Taxi|Station|Rank/.test(p.name)) busy.push([p, 0.3]);
  }
  for (const [p, w] of busy) {
    const shirt = hallOf(p);
    const R = p === market ? 40 : 30;
    const n = (k: number) => Math.max(rand() < k * w - Math.floor(k * w) ? 1 : 0, Math.floor(k * w));
    for (let i = 0; i < n(9); i++) {
      const s = spotNear(p.x, p.z, R, 2.2, 24, true);
      if (!s) continue;
      const yaw = faceRoad(s[0], s[1]);
      const [c0, c1] = pick(rand, KIOSK);
      const b = cells.p(s[0], s[1]);
      b.add(M.kiosk, yawM(s[0], 0, s[1], yaw), [c0, c1]);
      const slot = atlas.text(pick(rand, KIOSK_SIGNS), '#' + c1.getHexString(), c1.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? '#1b1b1b' : '#ffffff');
      if (slot) signFaces(b, slot, s[0] + Math.sin(yaw) * 1.81, 2.68, s[1] + Math.cos(yaw) * 1.81, yaw, Math.min(2.7, 0.22 * slot.aspect), 0.2, 0, false);
      if (rand() < 0.7) person(b, s[0] + Math.sin(yaw) * 1.6, s[1] + Math.cos(yaw) * 1.6, yaw + Math.PI, false);
      cells.g(s[0], s[1]).halo(s[0] + Math.sin(yaw) * 1.15, 2.2, s[1] + Math.cos(yaw) * 1.15, 0.8, C('#ffe2a8'));
    }
    for (let i = 0; i < n(12); i++) {
      const s = spotNear(p.x, p.z, R, 1.8);
      if (!s) continue;
      const b = cells.p(s[0], s[1]);
      b.add(M.umbrella, yawM(s[0], 0, s[1], rand() * 6.28), [pick(rand, UMBRELLA), pick(rand, CHAIRS)]);
      const m = (rand() * 3) | 0;
      for (let k = 0; k < m; k++) {
        const ang = [Math.PI / 2, -Math.PI / 2, Math.PI][k];
        person(b, s[0] + Math.sin(ang) * 0.75, s[1] + Math.cos(ang) * 0.75, ang + Math.PI, true, rand() < 0.5 ? shirt : null);
      }
      if (p === market) cells.g(s[0], s[1]).halo(s[0], 2.2, s[1], 0.5, C('#ffc879'));
    }
    for (let i = 0; i < n(4); i++) {
      const s = spotNear(p.x, p.z, R, 1.5);
      if (!s) continue;
      const yaw = faceRoad(s[0], s[1]);
      const b = cells.p(s[0], s[1]);
      b.add(M.seller, yawM(s[0], 0, s[1], yaw), [C('#f5c518'), C('#f5c518'), pick(rand, [C('#e8d6b0'), C('#d8a24a'), C('#f2f2f2')])]);
      // the seller sits behind her table on a stool
      b.add(M.sitting, yawM(s[0] - Math.sin(yaw) * 0.35, -0.05, s[1] - Math.cos(yaw) * 0.35, yaw, 0.95), [pick(rand, [C('#c8102e'), C('#f5c518'), C('#2e8b3a'), C('#8e24aa')]), C('#e4572e'), pick(rand, SKIN), C('#2b2f3a')]);
      if (rand() < 0.6) person(b, s[0] + Math.sin(yaw) * 1.4, s[1] + Math.cos(yaw) * 1.4, yaw + Math.PI, false, shirt);
      cells.g(s[0], s[1]).halo(s[0], 1.4, s[1], 0.55, C('#ffcf80'));
    }
    for (let i = 0; i < n(3); i++) {
      const s = spotNear(p.x, p.z, R, 2.4, 24, true);
      if (!s) continue;
      const yaw = faceRoad(s[0], s[1]);
      const b = cells.p(s[0], s[1]);
      const k = 2 + ((rand() * 4) | 0);
      for (let j = 0; j < k; j++) {
        const off = (j - (k - 1) / 2) * 0.95;
        b.add(M.okada, yawM(s[0] + Math.cos(yaw) * off, 0, s[1] - Math.sin(yaw) * off, yaw + (rand() - 0.5) * 0.3), [pick(rand, BIKE_COLORS)]);
      }
      // riders waiting for a fare
      if (rand() < 0.7) person(b, s[0] + Math.sin(yaw) * 1.4, s[1] + Math.cos(yaw) * 1.4, yaw + Math.PI * 0.8, false, pick(rand, [C('#f5c518'), C('#e4572e'), C('#2b2f3a')]));
    }
    for (let i = 0; i < n(8); i++) {
      const s = spotNear(p.x, p.z, R, 1.2);
      if (s) group3(s[0], s[1], 2 + ((rand() * 4) | 0), shirt);
    }
  }
  if (market) marketLights(cells, market);

  // --- meshes, one per cell ---
  const meshes: THREE.Mesh[] = [];
  for (const b of cells.props.values()) {
    if (b.empty) continue;
    const m = new THREE.Mesh(b.geometry(), propMat);
    m.castShadow = m.receiveShadow = true;
    m.userData.shared = true;
    meshes.push(m);
    group.add(m);
  }
  for (const g of cells.glow.values()) {
    if (!g.idx.length) continue;
    const m = new THREE.Mesh(g.geometry(), glowMat);
    m.renderOrder = 2;
    m.userData.shared = true;
    meshes.push(m);
    group.add(m);
  }
  group.userData.cullMeshes = meshes;
  return group;
}

/** Text on a sign, on its front (and back when twoSided), centred at (x, y, z), facing yaw. */
function signFaces(b: Batch, slot: { uv: [number, number, number, number]; aspect: number } | null, x: number, y: number, z: number, yaw: number, w: number, h: number, depth: number, twoSided: boolean) {
  if (!slot) return;
  const white = new THREE.Color(1, 1, 1);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const face = (s: number) => {
    const d = depth / 2 + 0.006;
    const cx = x + fx * d * s, cz = z + fz * d * s;
    const hx = rx * (w / 2) * s, hz = rz * (w / 2) * s;
    b.quad([
      new THREE.Vector3(cx - hx, y - h / 2, cz - hz),
      new THREE.Vector3(cx + hx, y - h / 2, cz + hz),
      new THREE.Vector3(cx + hx, y + h / 2, cz + hz),
      new THREE.Vector3(cx - hx, y + h / 2, cz - hz),
    ], white, slot.uv);
  };
  face(1);
  if (twoSided) face(-1);
}

function inPoly(pts: Float32Array, x: number, z: number) {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    if ((pts[i + 1] > z) !== (pts[j + 1] > z) && x < ((pts[j] - pts[i]) * (z - pts[i + 1])) / (pts[j + 1] - pts[i + 1]) + pts[i]) c = !c;
  }
  return c;
}

/**
 * Raised kerbs along both edges of a road, broken at side roads and driveways,
 * painted black and white near junctions. The flat verge and drain beside them are
 * in roadEdgeStrips (drawn with the footpaths).
 */
function kerbs(cells: Cells, r: (typeof ROADS)[number], ri: number, at: number) {
  const STEP = 3;
  const grey = C('#c9c4b8'), black = C('#26272a'), white = C('#efeee8');
  const pts: [number, number][] = r.nodes.map((i) => [NODE_XZ[i * 2], NODE_XZ[i * 2 + 1]]);
  const junction = r.nodes.map((i) => nodeDegree(i) >= 3);
  for (const s of [-1, 1]) {
    let run: { x: number; z: number; nx: number; nz: number; paint: boolean }[] = [];
    const flush = () => {
      if (run.length >= 2) {
        for (let k = 0; k < run.length - 1; k++) {
          const p = run[k], q = run[k + 1];
          const c = p.paint ? (k % 2 ? black : white) : grey;
          const H = 0.1, W = 0.2;
          const v = (o: { x: number; z: number; nx: number; nz: number }, w: number, y: number) => new THREE.Vector3(o.x + o.nx * w, y, o.z + o.nz * w);
          const b = cells.p(p.x, p.z);
          // top, road face and back face; winding faces outward on either side
          const quad = (a: THREE.Vector3, bb: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3) => (s < 0 ? b.quad([a, bb, cc, d], c) : b.quad([d, cc, bb, a], c));
          quad(v(p, 0, H), v(q, 0, H), v(q, W, H).setY(H), v(p, W, H));
          quad(v(p, 0, 0), v(q, 0, 0), v(q, 0, H), v(p, 0, H));
          quad(v(q, W, 0), v(p, W, 0), v(p, W, H), v(q, W, H));
        }
      }
      run = [];
    };
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz * s, nz = ux * s;
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let j = k === 0 ? 0 : 1; j <= n; j++) {
        const t = (j / n) * len;
        const x = ax + ux * t + nx * at, z = az + uz * t + nz * at;
        const nearJ = (junction[k] && t < 10) || (junction[k + 1] && len - t < 10);
        const clear = roadClearance(x + nx * 0.1, z + nz * 0.1, 8, ri) > 0.3 && !buildingAt(x, z);
        if (!clear) { flush(); continue; }
        // straight runs away from junctions need only their ends
        const last = run[run.length - 1];
        if (last && !nearJ && !last.paint && run.length >= 2 && j < n) {
          const prev = run[run.length - 2];
          const turn = Math.abs((last.x - prev.x) * (z - last.z) - (last.z - prev.z) * (x - last.x));
          if (turn < 0.05) { last.x = x; last.z = z; continue; }
        }
        run.push({ x, z, nx, nz, paint: nearJ });
      }
    }
    flush();
  }
}

/**
 * Flat concrete verges and open drains along the campus roads, one mesh per cell
 * (culled like the props). They sit under the ridden route's road and walkway, so on
 * the route they are hidden and elsewhere they edge the campus asphalt.
 */
export function buildRoadEdges(map: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2.5, polygonOffsetUnits: -5 });
  const cells = new Map<string, { pos: number[]; col: number[]; uv: number[]; idx: number[] }>();
  const verge = C('#c4c6c9'), drain = C('#34332f'), lip = C('#b9b4a8');
  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, a: number, b: number, c: THREE.Color) => {
    const key = `${Math.floor(ax / CELL)},${Math.floor(az / CELL)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { pos: [], col: [], uv: [], idx: [] }));
    const base = cell.pos.length / 3;
    for (const [x, z, w] of [[ax, az, a], [ax, az, b], [bx, bz, a], [bx, bz, b]]) {
      const px = x + nx * w, pz = z + nz * w;
      cell.pos.push(px, 0, pz);
      cell.uv.push(px / 6, pz / 6);
      cell.col.push(c.r, c.g, c.b);
    }
    // wound to face up on either side of the road
    if (nx * (bz - az) - nz * (bx - ax) < 0) cell.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else cell.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  ROADS.forEach((r, ri) => {
    if (r.cls > 2) return;
    const half = ROAD_WIDTH[r.cls] / 2;
    const at = Math.max(half, ROUTE_EDGE);
    for (let k = 0; k < r.nodes.length - 1; k++) {
      const a = r.nodes[k], b = r.nodes[k + 1];
      const ax = NODE_XZ[a * 2], az = NODE_XZ[a * 2 + 1], bx = NODE_XZ[b * 2], bz = NODE_XZ[b * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const n = Math.max(1, Math.ceil(len / 3));
      for (const s of [-1, 1]) {
        const nx = -uz * s, nz = ux * s;
        // runs of samples clear of side roads and buildings, each drawn as one quad per strip
        let start = -1;
        for (let j = 0; j <= n + 1; j++) {
          const t = (Math.min(j, n) / n) * len;
          const x = ax + ux * t, z = az + uz * t;
          const ok = j <= n && roadClearance(x + nx * (at + 0.8), z + nz * (at + 0.8), 8, ri) > 0.3 && !buildingAt(x + nx * (at + 1), z + nz * (at + 1));
          if (ok && start < 0) start = j;
          if (!ok && start >= 0) {
            const t0 = (start / n) * len, t1 = (Math.min(j - 1, n) / n) * len;
            if (t1 - t0 > 0.5) {
              const x0 = ax + ux * t0, z0 = az + uz * t0, x1 = ax + ux * t1, z1 = az + uz * t1;
              if (at > half) quad(x0, z0, x1, z1, nx, nz, half - 0.05, at, verge);
              quad(x0, z0, x1, z1, nx, nz, at + 0.2, at + 0.32, lip);
              quad(x0, z0, x1, z1, nx, nz, at + 0.32, at + 0.82, drain);
              quad(x0, z0, x1, z1, nx, nz, at + 0.82, at + 0.95, lip);
            }
            start = -1;
          }
        }
      }
    }
  });
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (const c of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(c.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
    g.setIndex(c.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.userData.shared = true;
    meshes.push(m);
    group.add(m);
  }
  return { group, meshes, material: mat };
}

/** Low hedges along the longer walls of a hall block, a little out from the plinth. */
function hedges(cells: Cells, hedge: Model, pts: Float32Array, cx: number, cz: number, rand: () => number) {
  const n = pts.length / 2;
  let made = 0;
  const green = [C('#3c6e2b'), C('#2f5d22'), C('#467a30')];
  for (let i = 0; i < n && made < 8; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[j * 2], bz = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 7) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    let nx = -uz, nz = ux;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    // leave gaps for doors: hedge pieces of 3-6 m
    for (let t = 1.5; t < len - 2; ) {
      const piece = Math.min(len - 1.5 - t, 3 + rand() * 3);
      const x = ax + ux * (t + piece / 2) + nx * 1.7, z = az + uz * (t + piece / 2) + nz * 1.7;
      if (roadClearance(x, z, 8, -1, true) > 0.7 && !buildingAt(x, z, 0.3) && !inKeepOut(x, z)) {
        const c = green[(rand() * 3) | 0];
        cells.p(x, z).add(hedge, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(uz, ux) * -1), new THREE.Vector3(piece, 0.9 + rand() * 0.2, 1)), [c, c.clone().multiplyScalar(1.15)]);
        made++;
      }
      t += piece + 1.2 + rand() * 2;
    }
  }
}

/** Rows of parked cars across a car park, aligned with its longest side. */
function parkCars(cells: Cells, car: Model, pts: Float32Array, rand: () => number) {
  const n = pts.length / 2;
  let best = 0, ang = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l = Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
    if (l > best) { best = l; ang = Math.atan2(pts[j * 2 + 1] - pts[i * 2 + 1], pts[j * 2] - pts[i * 2]); }
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const u = x * c + z * s, w = -x * s + z * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
  }
  if ((u1 - u0) * (w1 - w0) > 40000) return 0;
  const fill = 0.35 + rand() * 0.4;
  let count = 0;
  // rows of 5 m bays facing each other across 6 m aisles
  for (let w = w0 + 3; w < w1 - 2.5 && count < 60; w += 8) {
    const facing = (Math.round((w - w0) / 8) % 2) ? 1 : -1;
    for (let u = u0 + 2; u < u1 - 1.5; u += 2.6) {
      if (rand() > fill) continue;
      const x = u * c - w * s, z = u * s + w * c;
      if (!inPoly(pts, x, z) || !inPoly(pts, x + s * 2.2, z - c * 2.2) || !inPoly(pts, x - s * 2.2, z + c * 2.2)) continue;
      if (roadClearance(x, z, 8, -1) < 2.4 || buildingAt(x, z, 2) || inKeepOut(x, z)) continue;
      const yaw = -ang + (facing > 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.08;
      const col = CAR_COLORS[(rand() * CAR_COLORS.length) | 0];
      cells.p(x, z).add(car, yawM(x, 0, z, yaw), [col], 0.92 + rand() * 0.12);
      count++;
    }
  }
  return count;
}

/** String lights along the Night Market roofs and canopy (matches landmarks.ts). */
function marketLights(cells: Cells, p: Place) {
  const warm = [C('#ffcf7a'), C('#ff9f6a'), C('#fff1b8')];
  for (let row = 0; row < 4; row++) {
    if (!(row % 2)) continue;
    const z = (row - 1.5) * 7 + (row % 2 ? -1.6 : 1.6) + 1.6;
    for (const dz of [-4.8, 4.8]) {
      for (let x = -19.5; x <= 19.5; x += 1.5) cells.g(p.x + x, p.z + z + dz).halo(p.x + x, 3.25, p.z + z + dz, 0.32, warm[Math.abs(Math.round(x / 1.5)) % 3]);
    }
  }
  for (let x = -6.6; x <= 6.6; x += 1.2) for (const dz of [-4.4, 4.4]) cells.g(p.x + x, p.z - 21 + dz).halo(p.x + x, 3.45, p.z - 21 + dz, 0.3, warm[Math.abs(Math.round(x / 1.2)) % 3]);
  const g = cells.g(p.x, p.z);
  g.pool(p.x, p.z - 21, 9, C('#5a3c18'));
  g.pool(p.x, p.z, 16, C('#3a2810'));
}

/** How close (x, z) is to the Night Market or a food joint, 0..1, for the ambient music. */
export function marketProximity(x: number, z: number) {
  let best = 0;
  for (const p of PLACES) {
    if (p.kind !== 'food' && p.name !== 'Night Market') continue;
    const r = p.name === 'Night Market' ? 140 : 45;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < r) best = Math.max(best, (1 - d / r) * (p.name === 'Night Market' ? 1 : 0.4));
  }
  return best;
}

export const isNight = () => nightOn;
export { buildingMaterials };
