import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEAD, type Route } from '../data/campus';
import { OTHER_BUILDINGS, toLocal, type Place, type PlaceKind } from '../data/ugmap';
import type { Track } from './track';
import { asphaltTexture, billboardTexture, concreteTexture, grassTexture, labelTexture, wallTexture } from './textures';

export const LANES = [-2.4, 0, 2.4];
export const ROAD_HALF = 3.8;

const KIND_ACCENT: Record<string, string> = {
  hall: '#f5c518',
  academic: '#5ec8ff',
  landmark: '#ff7a59',
  service: '#9be27a',
};

/** Seeded random so the campus looks the same every ride. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function buildSky(top: string, bottom: string) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), mat);
  sky.renderOrder = -1;
  return sky;
}

/** A flat strip following the road, from lateral a to lateral b (metres, + = right), chunked so UVs stay small. */
function ribbon(track: Track, a: number, ya: number, b: number, yb: number, from: number, to: number, uvScale = 8, step = 2) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const CHUNK = 200;
  for (let c0 = from; c0 < to; c0 += CHUNK) {
    const c1 = Math.min(to, c0 + CHUNK);
    const base = pos.length / 3;
    let rows = 0;
    for (let d = c0; ; d = Math.min(c1, d + step)) {
      const pa = track.pose(d, a), pb = track.pose(d, b);
      pos.push(pa.x, ya, pa.z, pb.x, yb, pb.z);
      const v = (d - c0) / uvScale;
      uv.push(0, v, 1, v);
      rows++;
      if (d >= c1) break;
    }
    for (let r = 0; r < rows - 1; r++) {
      const i = base + r * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const PRIORITY: Record<PlaceKind, number> = { landmark: 0, hall: 1, academic: 2, service: 3 };

export interface PlacedLandmark {
  place: Place;
  d: number;
  side: 1 | -1;
  x: number;
  z: number;
}

/**
 * Puts each real building beside the road nearest to it. Buildings keep their real
 * spot along the route; the gap to the road is clamped so none sits on the road or
 * disappears into the distance, and lower-priority ones give way when two overlap.
 */
export function placeLandmarks(track: Track, places: Place[]): PlacedLandmark[] {
  const out: (PlacedLandmark & { w: number })[] = [];
  const sorted = [...places].sort((p, q) => PRIORITY[p.kind] - PRIORITY[q.kind]);
  for (const place of sorted) {
    const [px, pz] = toLocal(place.lat, place.lng);
    const pr = track.project(px, pz);
    if (pr.dist > 150 || pr.d < 20 || pr.d > track.length - 20) continue;
    const [w, , depth] = place.size;
    const side: 1 | -1 = pr.lateral >= 0 ? 1 : -1;
    const off = THREE.MathUtils.clamp(Math.abs(pr.lateral), ROAD_HALF + 12 + depth / 2, 70);
    if (out.some((o) => o.side === side && Math.abs(o.d - pr.d) < (o.w + w) / 2 + 6)) continue;
    const p = track.pose(pr.d, side * off);
    if (track.distanceToRoad(p.x, p.z) < ROAD_HALF + 8 + depth / 2) continue;
    out.push({ place, d: pr.d, side, x: p.x, z: p.z, w });
  }
  return out.sort((a, b) => a.d - b.d);
}

export function buildWorld(route: Route) {
  const track = route.track!;
  const group = new THREE.Group();
  const rand = rng(7);
  const L = track.length;
  const at = (d: number, lateral: number, y = 0) => {
    const p = track.pose(d, lateral);
    return new THREE.Vector3(p.x, y, p.z);
  };
  const yawAt = (d: number) => track.pose(d).yaw;

  // Ground: one mesh of 200 m tiles, each with its own UV origin, because a single
  // huge texture repeat loses UV precision on some mobile GPUs.
  const b = track.bounds();
  const PAD = 400, TILE = 200;
  const x0 = Math.floor((b.minX - PAD) / TILE) * TILE, z0 = Math.floor((b.minZ - PAD) / TILE) * TILE;
  const nx = Math.ceil((b.maxX + PAD - x0) / TILE), nz = Math.ceil((b.maxZ + PAD - z0) / TILE);
  const tiles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    tiles.push(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2).translate(x0 + i * TILE + TILE / 2, -0.02, z0 + j * TILE + TILE / 2));
  }
  const grassTex = grassTexture();
  grassTex.repeat.set(TILE / 8, TILE / 8);
  const ground = new THREE.Mesh(mergeGeometries(tiles), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.receiveShadow = true;
  group.add(ground);

  // road, edge lines and kerbs follow the centreline
  const roadTex = asphaltTexture();
  roadTex.repeat.set(2, 1);
  const road = new THREE.Mesh(ribbon(track, -ROAD_HALF, 0, ROAD_HALF, 0, 0, L), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }));
  road.receiveShadow = true;
  group.add(road);
  const white = new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.8 });
  for (const s of [-1, 1]) {
    const [a, c] = [s * (ROAD_HALF - 0.27), s * (ROAD_HALF - 0.13)].sort((u, v) => u - v);
    group.add(new THREE.Mesh(ribbon(track, a, 0.005, c, 0.005, 0, L, 8, 4), white));
  }
  const conc = concreteTexture();
  conc.repeat.set(1, 4);
  const walkMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.95 });
  for (const s of [-1, 1]) {
    const a = s * ROAD_HALF, c = s * (ROAD_HALF + 2);
    // order the edges so faces point up on both sides
    const top = s > 0 ? ribbon(track, a, 0.14, c, 0.14, 0, L) : ribbon(track, c, 0.14, a, 0.14, 0, L);
    const curb = s > 0 ? ribbon(track, a, 0, a, 0.14, 0, L) : ribbon(track, a, 0.14, a, 0, 0, L);
    const walk = new THREE.Mesh(top, walkMat);
    walk.receiveShadow = true;
    group.add(walk, new THREE.Mesh(curb, walkMat));
  }
  const dashCount = Math.floor(L / 9);
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 3).rotateX(-Math.PI / 2), white, dashCount * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (const x of [-1.2, 1.2]) {
    for (let k = 0; k < dashCount; k++) {
      const d = k * 9 + 4;
      m.compose(at(d, x, 0.006), q.setFromAxisAngle(up, yawAt(d)), one);
      dashes.setMatrixAt(i++, m);
    }
  }
  group.add(dashes);

  // real buildings beside the road, plus every other building from the map as filler
  const landmarks = placeLandmarks(track, route.places ?? []);
  const blocked: { x: number; z: number; r: number }[] = landmarks.map((l) => ({ x: l.x, z: l.z, r: Math.max(l.place.size[0], l.place.size[2]) / 2 + 3 }));
  const clear = (p: THREE.Vector3, r: number, road = ROAD_HALF + 2.5) =>
    track.distanceToRoad(p.x, p.z) > road + r && !blocked.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + r);

  const wallTex = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#a8482c', roughness: 0.85 });
  for (const l of landmarks) {
    const [w, h, depth] = l.place.size;
    const block = campusBlock(w, h, depth, wallMat, roofMat, l.place.kind === 'landmark' ? '#c8a24a' : undefined);
    block.position.set(l.x, 0, l.z);
    block.rotation.y = yawAt(l.d);
    group.add(block);
    const off = Math.hypot(l.x - track.pose(l.d).x, l.z - track.pose(l.d).z);
    const { tex, aspect } = labelTexture(l.place.name.toUpperCase(), KIND_ACCENT[l.place.kind]);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: true }));
    const lh = 2.6;
    label.scale.set(lh * aspect, lh, 1);
    label.position.copy(at(l.d, l.side * (off - depth / 2 - 1), h + 2.4));
    group.add(label);
  }
  for (const [lat, lng] of OTHER_BUILDINGS) {
    const [x, z] = toLocal(lat, lng);
    const w = 20 + rand() * 20, h = 6 + Math.floor(rand() * 3) * 3.5, depth = 12 + rand() * 10;
    const p = new THREE.Vector3(x, 0, z);
    if (!clear(p, Math.max(w, depth) / 2 + 4, ROAD_HALF + 6)) continue;
    const blk = campusBlock(w, h, depth, wallMat, roofMat);
    blk.position.copy(p);
    blk.rotation.y = yawAt(track.project(x, z).d);
    group.add(blk);
    blocked.push({ x, z, r: Math.max(w, depth) / 2 + 3 });
  }
  // generic blocks fill the gaps along the road
  for (let d = 30; d < L; d += 45 + rand() * 40) {
    for (const s of [-1, 1]) {
      if (rand() < 0.35) continue;
      const w = 18 + rand() * 22, h = 6 + Math.floor(rand() * 3) * 3.5, depth = 10 + rand() * 10;
      const p = at(d, s * (ROAD_HALF + 18 + rand() * 14 + depth / 2));
      if (!clear(p, Math.max(w, depth) / 2 + 2, ROAD_HALF + 12)) continue;
      const blk = campusBlock(w, h, depth, wallMat, roofMat);
      blk.position.copy(p);
      blk.rotation.y = yawAt(d);
      group.add(blk);
      blocked.push({ x: p.x, z: p.z, r: Math.max(w, depth) / 2 + 3 });
    }
  }

  // trees: broadleaf and palms, instanced
  const broad: THREE.Matrix4[] = [];
  const palms: THREE.Matrix4[] = [];
  for (let d = 0; d < L; d += 11) {
    for (const s of [-1, 1]) {
      const p = at(d + (rand() - 0.5) * 6, s * (ROAD_HALF + 4 + rand() * 6));
      const sc = 0.8 + rand() * 0.6;
      const spin = rand() * Math.PI * 2;
      const palm = rand() < 0.35;
      if (!clear(p, 1.5)) continue;
      (palm ? palms : broad).push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, spin), new THREE.Vector3(sc, sc, sc)));
    }
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
  const addInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], colors?: string[]) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, k) => {
      im.setMatrixAt(k, mm);
      if (colors) im.setColorAt(k, new THREE.Color(colors[k % colors.length]).offsetHSL(0, 0, (rand() - 0.5) * 0.08));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  };
  addInstanced(new THREE.CylinderGeometry(0.16, 0.24, 2.6, 7).translate(0, 1.3, 0), trunkMat, broad);
  addInstanced(new THREE.IcosahedronGeometry(1.9, 1).scale(1, 0.8, 1).translate(0, 3.6, 0), leafMat, broad, ['#3f7d2c', '#4a8a33', '#356b25', '#5a9440']);
  addInstanced(new THREE.CylinderGeometry(0.14, 0.2, 7, 7).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: '#8a7a66', roughness: 1 }), palms);
  addInstanced(palmCrown(), leafMat, palms, ['#4f8f2f', '#5c9a36']);

  // street lamps, arm reaching over the road
  const lamps: THREE.Matrix4[] = [];
  for (let d = 0; d < L; d += 36) {
    for (const s of [-1, 1]) {
      const dd = d + (s > 0 ? 18 : 0);
      const p = at(dd, s * (ROAD_HALF + 1.6));
      if (track.distanceToRoad(p.x, p.z) < ROAD_HALF + 1.2) continue;
      lamps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, yawAt(dd) + (s > 0 ? Math.PI : 0)), one));
    }
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', metalness: 0.6, roughness: 0.4 });
  addInstanced(new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), lampMat, lamps);
  addInstanced(new THREE.BoxGeometry(0.9, 0.12, 0.25).translate(0.45, 6, 0), lampMat, lamps);

  // in-world billboards (future ad slots)
  const bbTex = billboardTexture();
  for (let d = LEAD + 600, k = 0; d < L - LEAD - 100; d += 700, k++) {
    const s = k % 2 ? -1 : 1;
    const p = at(d, s * (ROAD_HALF + 8));
    if (!clear(p, 4, ROAD_HALF + 3)) continue;
    group.add(billboard(bbTex, s, p, yawAt(d)));
  }

  // start and finish arches
  group.add(gate('Campus Loop', at(LEAD, 0), yawAt(LEAD)));
  group.add(gate('FINISH', at(L - LEAD, 0), yawAt(L - LEAD), true));

  return { group, landmarks };
}

function palmCrown() {
  const fronds: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const f = new THREE.ConeGeometry(0.32, 2.6, 4).rotateX(Math.PI / 2).translate(0, 0, 1.3);
    f.scale(1, 0.25, 1);
    f.rotateX(0.35 + (k % 3) * 0.15);
    f.rotateY((k / 9) * Math.PI * 2);
    fronds.push(f.translate(0, 7, 0));
  }
  return mergeGeometries(fronds);
}

function campusBlock(w: number, h: number, d: number, wallMat: THREE.Material, roofMat: THREE.Material, roofColor?: string) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(d, h, w);
  // scale wall UVs so windows stay a sensible size
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const faceDims = [[w, h], [w, h], [d, w], [d, w], [d, h], [d, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faceDims[f];
    for (let k = 0; k < 4; k++) {
      const idx = f * 4 + k;
      uv.setXY(idx, uv.getX(idx) * (fu / 8), uv.getY(idx) * (fv / 7));
    }
  }
  const body = new THREE.Mesh(geo, wallMat);
  body.position.y = h / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(d + 1.2, 0.6, w + 1.2), roofColor ? new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 }) : roofMat);
  roof.position.y = h + 0.3;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

function gate(text: string, pos: THREE.Vector3, yaw: number, finish = false) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: finish ? '#0a1020' : '#efe7d6', roughness: 0.7 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), postMat);
    post.position.set(s * (ROAD_HALF + 1.4), 3, 0);
    post.castShadow = true;
    g.add(post);
  }
  const { tex, aspect } = labelTexture(text.toUpperCase(), '#f5c518');
  const beamW = ROAD_HALF * 2 + 3.6;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamW, 1.4, 0.6), postMat);
  beam.position.y = 6.2;
  beam.castShadow = true;
  g.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(beamW - 1, 1.3 * aspect), 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  sign.position.set(0, 6.2, 0.31);
  g.add(sign);
  if (finish) {
    // chequered strip on the road
    const c = document.createElement('canvas');
    c.width = 160; c.height = 20;
    const x = c.getContext('2d')!;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      x.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      x.fillRect(i * 10, j * 10, 10, 10);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1), new THREE.MeshStandardMaterial({ map: t }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = 0.01;
    g.add(strip);
  }
  g.position.copy(pos);
  g.rotation.y = yaw;
  return g;
}

function billboard(tex: THREE.Texture, side: number, pos: THREE.Vector3, yaw: number) {
  const g = new THREE.Group();
  const leg = new THREE.MeshStandardMaterial({ color: '#555b63', metalness: 0.5, roughness: 0.5 });
  for (const dx of [-2.5, 2.5]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), leg);
    p.position.set(dx, 2.5, 0);
    p.castShadow = true;
    g.add(p);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 0.3), leg);
  panel.position.y = 6.4;
  panel.castShadow = true;
  g.add(panel);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 }));
  face.position.set(0, 6.4, 0.16);
  g.add(face);
  // face oncoming riders, angled toward the road
  g.rotation.y = yaw + (side > 0 ? -0.5 : 0.5);
  g.position.copy(pos);
  return g;
}
