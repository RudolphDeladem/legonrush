// Legon-style buildings from footprints: cream rendered walls with window bays tiled by
// real metres, a darker plinth, and terracotta tile roofs with an overhang. Rectangular
// blocks get a true hipped roof; any other footprint gets a sloped tile band round its
// edge with a flat top, which reads as a hipped roof from the road.
//
// Everything is merged per 400 m cell into two meshes (walls+trim, roofs) so the whole
// campus costs a handful of draw calls, and the shadow pass only touches nearby cells.
import * as THREE from 'three';
import { groundShade, weathering } from './shading';
import type { Building } from './campusmap';
import { facadeTexture, roofTileTexture, windowLightTexture } from './textures';

type V = [number, number];

/** roof pitch, overhang, plinth height, and storey height in metres */
const PITCH = 0.42; // tan of about 23 degrees
const COS_PITCH = Math.cos(Math.atan(PITCH));
const OVERHANG = 0.55;
const PLINTH = 0.5;
const STOREY = 3.4;
const CELL = 500;
/** v range of the plain slab band at the foot of the facade texture, used for trim */
const TRIM_V = 0.03;

const WALL_COLORS = ['#fbf3df', '#f8eccf', '#fdf9ee', '#f4e6c6', '#faefd6', '#f2e2bd', '#fcf6ea', '#f6eedc'];
const ROOF_COLORS = ['#b4532e', '#a94a2b', '#bf5f36', '#9c4429', '#b65a3a', '#a65335'];
const PLINTH_COLORS = ['#8b8072', '#7f7466', '#93877a', '#7a6253'];

let shared: { wall: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial; facade: THREE.Texture; tiles: THREE.Texture } | null = null;
/** how many bays and storeys the lit-window pattern spans before it repeats */
const LIT_BAYS = 8, LIT_STOREYS = 4;

/** Shared building materials and textures (made once, reused by landmarks). */
export function buildingMaterials() {
  if (shared) return shared;
  const facade = facadeTexture();
  const tiles = roofTileTexture();
  shared = {
    facade,
    tiles,
    // after dark some windows glow: an emissive pattern spanning several bays and
    // storeys, so neighbouring windows differ; dark by day (intensity 0)
    // walls darken toward the ground (rain splash, dirt and the shade at the foot of a wall)
    wall: weathering(groundShade(new THREE.MeshStandardMaterial({ map: facade, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: litWindows(), emissiveIntensity: 0 }), 2.2, 0.3, 'wall'), 'wall', 16, 0.3),
    roof: new THREE.MeshStandardMaterial({ map: tiles, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }),
  };
  return shared;
}

function litWindows() {
  const t = windowLightTexture(LIT_BAYS, LIT_STOREYS);
  t.repeat.set(1 / LIT_BAYS, 1 / LIT_STOREYS);
  return t;
}

/** Turns the lit windows up (1) or off (0); walls are tinted, so this is a gentle glow. */
export function setWindowLights(k: number) {
  const { wall } = buildingMaterials();
  wall.emissiveIntensity = k * 1.1;
}

class Batch {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, c: THREE.Color) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.col.push(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Uint8BufferAttribute(this.col, 3, true));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const area = (r: V[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};

/** Drops repeated and closing points. */
function clean(src: Float32Array): V[] {
  const out: V[] = [];
  for (let i = 0; i < src.length; i += 2) {
    const p: V = [src[i], src[i + 1]];
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

/** Moves every edge of a ring to its left by d (into the building for our orientation), mitred. */
function offset(r: V[], d: number): V[] {
  const n = r.length;
  return r.map((p, i) => {
    const a = r[(i + n - 1) % n], b = r[(i + 1) % n];
    let e1x = p[0] - a[0], e1z = p[1] - a[1];
    let l = Math.hypot(e1x, e1z) || 1;
    e1x /= l; e1z /= l;
    let e2x = b[0] - p[0], e2z = b[1] - p[1];
    l = Math.hypot(e2x, e2z) || 1;
    e2x /= l; e2z /= l;
    const n1x = -e1z, n1z = e1x, n2x = -e2z, n2z = e2x;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) return [p[0] + n1x * d, p[1] + n1z * d] as V;
    mx /= ml; mz /= ml;
    const k = 1 / Math.max(0.35, mx * n1x + mz * n1z);
    return [p[0] + mx * d * k, p[1] + mz * d * k] as V;
  });
}

/** An inset ring is usable when no edge flipped round and it kept its orientation. */
function validInset(r: V[], ins: V[]) {
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if ((ins[j][0] - ins[i][0]) * (r[j][0] - r[i][0]) + (ins[j][1] - ins[i][1]) * (r[j][1] - r[i][1]) <= 0) return false;
  }
  return Math.sign(area(r)) === Math.sign(area(ins));
}

function inside(r: V[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}

/** Inset outer and courtyard rings must not run into each other. */
function ringsApart(ins: V[][]) {
  const [o, ...hs] = ins;
  return hs.every((h) => h.every(([x, z]) => inside(o, x, z)) && o.every(([x, z]) => !inside(h, x, z)));
}

/** Douglas-Peucker on a closed ring: drops jogs smaller than tol so roofs can slope further in. */
function simplify(r: V[], tol: number): V[] {
  if (r.length <= 4) return r;
  let far = 0, best = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(r.length);
  keep[0] = keep[far] = 1;
  const dp = (a: number, b: number) => {
    // indices a..b along the ring (b may wrap to r.length = index 0)
    const pa = r[a], pb = r[b % r.length];
    const dx = pb[0] - pa[0], dz = pb[1] - pa[1], len = Math.hypot(dx, dz) || 1;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((r[i][0] - pa[0]) * dz - (r[i][1] - pa[1]) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      dp(a, at);
      dp(at, b);
    }
  };
  dp(0, far);
  dp(far, r.length);
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 3 && Math.sign(area(out)) === Math.sign(area(r)) ? out : r;
}

/** Smallest-area box around a ring, aligned with one of its edges. */
function orientedBox(r: V[]) {
  let best = { c: 1, s: 0, u0: 0, u1: 0, w0: 0, w1: 0, area: Infinity };
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    const ang = Math.atan2(r[j][1] - r[i][1], r[j][0] - r[i][0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const [x, z] of r) {
      const u = x * c + z * s, w = -x * s + z * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
    }
    const a = (u1 - u0) * (w1 - w0);
    if (a < best.area) best = { c, s, u0, u1, w0, w1, area: a };
  }
  return best;
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const tint = (hex: string, rand: () => number, amt = 0.035) => new THREE.Color(hex).offsetHSL((rand() - 0.5) * 0.01, 0, (rand() - 0.5) * amt * 2);

/** Walls (window bays), plinth, fascia and soffit of one ring, into the wall batch. */
function ringWalls(wb: Batch, ring: V[], h: number, bay: number, storeys: number, wallC: THREE.Color, plinthC: THREE.Color) {
  const n = ring.length;
  const base = offset(ring, -0.05); // the plinth stands a little proud of the render
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    const len = Math.hypot(bx - ax, bz - az);
    // whole bays per wall so windows never get cut at the corners
    const bays = Math.max(1, Math.round(len / bay));
    const f0 = wb.vert(ax, PLINTH, az, 0, 0, wallC);
    const f1 = wb.vert(bx, PLINTH, bz, bays, 0, wallC);
    const f2 = wb.vert(bx, h, bz, bays, storeys, wallC);
    const f3 = wb.vert(ax, h, az, 0, storeys, wallC);
    wb.quad(f0, f1, f2, f3);
    const [px, pz] = base[i], [qx, qz] = base[j];
    const p0 = wb.vert(px, 0, pz, 0, 0.005, plinthC);
    const p1 = wb.vert(qx, 0, qz, len / 3, 0.005, plinthC);
    const p2 = wb.vert(qx, PLINTH, qz, len / 3, TRIM_V, plinthC);
    const p3 = wb.vert(px, PLINTH, pz, 0, TRIM_V, plinthC);
    wb.quad(p0, p1, p2, p3);
    // a little ledge on top of the plinth
    const l0 = wb.vert(ax, PLINTH, az, 0, 0.01, plinthC);
    const l1 = wb.vert(bx, PLINTH, bz, len / 3, 0.01, plinthC);
    const l2 = wb.vert(qx, PLINTH, qz, len / 3, TRIM_V, plinthC);
    const l3 = wb.vert(px, PLINTH, pz, 0, TRIM_V, plinthC);
    wb.quad(l0, l1, l2, l3);
  }
}

/** Soffit under the overhang and the white fascia board along the eaves. */
function eaves(wb: Batch, inner: V[], outer: V[], eave: number, trimC: THREE.Color, soffitC: THREE.Color) {
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const s0 = wb.vert(inner[i][0], eave, inner[i][1], 0, 0.01, soffitC);
    const s1 = wb.vert(inner[j][0], eave, inner[j][1], 1, 0.01, soffitC);
    const s2 = wb.vert(outer[j][0], eave, outer[j][1], 1, TRIM_V, soffitC);
    const s3 = wb.vert(outer[i][0], eave, outer[i][1], 0, TRIM_V, soffitC);
    wb.quad(s0, s1, s2, s3);
    const f0 = wb.vert(outer[i][0], eave - 0.24, outer[i][1], 0, 0.01, trimC);
    const f1 = wb.vert(outer[j][0], eave - 0.24, outer[j][1], 1, 0.01, trimC);
    const f2 = wb.vert(outer[j][0], eave + 0.02, outer[j][1], 1, TRIM_V, trimC);
    const f3 = wb.vert(outer[i][0], eave + 0.02, outer[i][1], 0, TRIM_V, trimC);
    wb.quad(f0, f1, f2, f3);
    // close the gap under the fascia
    const u0 = wb.vert(outer[i][0], eave - 0.24, outer[i][1], 0, 0.01, soffitC);
    const u1 = wb.vert(outer[j][0], eave - 0.24, outer[j][1], 1, 0.01, soffitC);
    wb.quad(s3, s2, u1, u0);
  }
}

/** Sloped tile faces from the eaves ring up to the inset ring. */
function slopes(rb: Batch, outer: V[], inner: V[], eave: number, top: number, c: THREE.Color) {
  const n = outer.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, az] = outer[i], [bx, bz] = outer[j];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const ex = (bx - ax) / len, ez = (bz - az) / len;
    const nx = -ez, nz = ex;
    const uv = (p: V) => {
      const dx = p[0] - ax, dz = p[1] - az;
      return [(acc + dx * ex + dz * ez) / 2, (dx * nx + dz * nz) / COS_PITCH / 2];
    };
    const pts: [V, number][] = [[outer[i], eave], [outer[j], eave], [inner[j], top], [inner[i], top]];
    const ids = pts.map(([p, y]) => {
      const [u, v] = uv(p);
      return rb.vert(p[0], y, p[1], u, v, c);
    });
    rb.quad(ids[0], ids[1], ids[2], ids[3]);
    acc += len;
  }
}

/** Builds every building footprint into merged, per-cell meshes. */
export function buildBuildings(buildings: Building[]) {
  const group = new THREE.Group();
  const { wall, roof } = buildingMaterials();
  const rand = seeded(23);
  const cells = new Map<string, { wb: Batch; rb: Batch }>();
  const trimBase = new THREE.Color('#fbf8f1');
  const soffitBase = new THREE.Color('#d9d0bf');

  for (const bd of buildings) {
    let outer = clean(bd.pts);
    if (outer.length < 3) continue;
    if (area(outer) < 0) outer.reverse();
    const holes = bd.holes.map(clean).filter((h) => h.length >= 3).map((h) => (area(h) > 0 ? h.reverse() : h));
    const footprint = Math.abs(area(outer));
    const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
    const h = bd.height ?? (footprint < 60 ? 3.6 : footprint < 350 ? 7 : r1 < 0.5 ? 7 : 10.5);
    const storeys = Math.max(1, Math.round((h - PLINTH) / STOREY));
    const bay = 2.9 + r2 * 0.8;
    const wallC = tint(WALL_COLORS[(r3 * WALL_COLORS.length) | 0], rand);
    const roofC = tint(ROOF_COLORS[(r4 * ROOF_COLORS.length) | 0], rand, 0.05);
    const plinthC = tint(PLINTH_COLORS[(rand() * PLINTH_COLORS.length) | 0], rand);
    const trimC = trimBase.clone().multiplyScalar(0.97 + rand() * 0.03);
    const soffitC = soffitBase.clone().multiplyScalar(0.95 + rand() * 0.05);

    let cx = 0, cz = 0;
    for (const [x, z] of outer) { cx += x; cz += z; }
    cx /= outer.length; cz /= outer.length;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cz / CELL)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { wb: new Batch(), rb: new Batch() }));
    const { wb, rb } = cell;

    const eave = h - OVERHANG * PITCH;
    for (const ring of [outer, ...holes]) ringWalls(wb, ring, h, bay, storeys, wallC, plinthC);

    const box = orientedBox(outer);
    const bw = box.u1 - box.u0, bdp = box.w1 - box.w0;
    const rect = !holes.length && footprint / box.area > 0.86 && Math.min(bw, bdp) <= 28;
    if (rect) {
      // a true hipped roof over the footprint's box
      const corner = (u: number, w: number): V => [u * box.c - w * box.s, u * box.s + w * box.c];
      const inner: V[] = [corner(box.u0, box.w0), corner(box.u1, box.w0), corner(box.u1, box.w1), corner(box.u0, box.w1)];
      const o = OVERHANG;
      const out: V[] = [corner(box.u0 - o, box.w0 - o), corner(box.u1 + o, box.w0 - o), corner(box.u1 + o, box.w1 + o), corner(box.u0 - o, box.w1 + o)];
      const half = (Math.min(bw, bdp) + 2 * o) / 2;
      const ridge = offset(out, half * 0.999);
      slopes(rb, out, ridge, eave, eave + half * PITCH, roofC);
      eaves(wb, inner, out, eave, trimC, soffitC);
    } else {
      const rings = [outer, ...holes].map((r) => simplify(r, 0.6));
      const outs = rings.map((r) => offset(r, -OVERHANG));
      let d = 0, ins: V[][] = outs;
      for (const tryD of [7, 6, 5, 4, 3, 2.2, 1.4, 0.8]) {
        const cand = outs.map((r) => offset(r, tryD));
        if (cand.every((c, k) => validInset(outs[k], c)) && ringsApart(cand)) { d = tryD; ins = cand; break; }
      }
      const top = eave + d * PITCH;
      if (d > 0) rings.forEach((_, k) => slopes(rb, outs[k], ins[k], eave, top, roofC));
      rings.forEach((r, k) => eaves(wb, r, outs[k], eave, trimC, soffitC));
      // flat top of the roof, tiled in world space
      const vec = (r: V[]) => r.map(([x, z]) => new THREE.Vector2(x, z));
      const contour = vec(ins[0]);
      const holeVs = ins.slice(1).map(vec);
      const all = contour.concat(...holeVs);
      const flat = roofC.clone().multiplyScalar(0.92);
      const baseIdx = all.map((p) => rb.vert(p.x, top, p.y, p.x / 2, p.y / 2, flat));
      for (const t of THREE.ShapeUtils.triangulateShape(contour, holeVs)) rb.tri(baseIdx[t[0]], baseIdx[t[1]], baseIdx[t[2]]);
    }
  }

  for (const { wb, rb } of cells.values()) {
    const walls = new THREE.Mesh(wb.geometry(), wall);
    walls.castShadow = walls.receiveShadow = true;
    const roofs = new THREE.Mesh(rb.geometry(), roof);
    roofs.castShadow = roofs.receiveShadow = true;
    walls.userData.shared = roofs.userData.shared = true;
    group.add(walls, roofs);
  }
  return group;
}

/**
 * A box with walls textured by real metres (window bays and storeys), for landmarks.
 * Returns the walls only (no top or bottom); pair it with a roof.
 */
export function facadeBox(w: number, h: number, d: number, color: THREE.ColorRepresentation = '#f1ece2', bay = 3.2) {
  const { wall } = buildingMaterials();
  const wb = new Batch();
  const ring: V[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const storeys = Math.max(1, Math.round((h - PLINTH) / STOREY));
  ringWalls(wb, ring, h, bay, storeys, new THREE.Color(color), new THREE.Color('#857a6c'));
  const m = new THREE.Mesh(wb.geometry(), wall);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** A hipped tile roof over a w x d box, with overhang, eaves at y. */
export function hipRoof(w: number, d: number, y: number, color: THREE.ColorRepresentation = '#a24b2e', overhang = 0.6, pitch = PITCH) {
  const { wall, roof } = buildingMaterials();
  const rb = new Batch(), wb = new Batch();
  const c = new THREE.Color(color);
  const o = overhang;
  const inner: V[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const out: V[] = [[-w / 2 - o, -d / 2 - o], [w / 2 + o, -d / 2 - o], [w / 2 + o, d / 2 + o], [-w / 2 - o, d / 2 + o]];
  const half = (Math.min(w, d) + 2 * o) / 2;
  slopes(rb, out, offset(out, half * 0.999), y, y + half * pitch, c);
  eaves(wb, inner, out, y, new THREE.Color('#fbf8f1'), new THREE.Color('#d9d0bf'));
  const g = new THREE.Group();
  const r = new THREE.Mesh(rb.geometry(), roof);
  const e = new THREE.Mesh(wb.geometry(), wall);
  r.castShadow = e.castShadow = true;
  r.receiveShadow = true;
  g.add(r, e);
  return g;
}
