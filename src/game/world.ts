import * as THREE from 'three';
import { weathering } from './shading';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AREAS, BUILDINGS, NODE_XZ, ROADS, buildingAt, mapBounds, type Place, type PlaceKind } from './campusmap';
import type { Track } from './track';
import { asphaltTexture, billboardTexture, concreteTexture, grassMacroTexture, grassTexture, labelTexture, pitchTexture } from './textures';
import { buildBuildings } from './facades';
import { addRouteTrees, buildCampusLife, buildRoadEdges, cullBeyondFog, ROAD_WIDTH } from './life';

export const LANES = [-2.4, 0, 2.4];

/** Street-lamp heads and the light they throw on the road; the game turns them up after dark. */
export const lampGlow = {
  head: new THREE.MeshStandardMaterial({ color: '#d9d4c4', emissive: '#ffd98a', emissiveIntensity: 0, roughness: 0.5 }),
  pool: new THREE.MeshBasicMaterial({ color: '#ffcf7a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, visible: false, map: (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })() }),
};
export const ROAD_HALF = 3.8;

export const KIND_ACCENT: Record<PlaceKind, string> = {
  hall: '#f5c518',
  academic: '#5ec8ff',
  landmark: '#ff7a59',
  food: '#ff9f43',
  bank: '#2ecc71',
  transport: '#a29bfe',
  worship: '#dfe6e9',
  sport: '#55efc4',
  health: '#ff6b81',
  other: '#b2bec3',
};

/**
 * Road surfaces that darken and turn glossy in the rain (see weatherfx.ts).
 * The route layer adds its own and removes them when it is disposed.
 */
const wetMats = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; rough: number }>();
function wettable<T extends THREE.MeshStandardMaterial>(m: T) {
  wetMats.set(m, { color: m.color.clone(), rough: m.roughness });
  m.color.multiplyScalar(1 - wetness * 0.45);
  m.roughness = m.roughness - (m.roughness - 0.28) * wetness;
  return m;
}
let wetness = 0;
/** 0 = dry, 1 = soaked: darker roads and paths with a sheen. */
export function setWet(k: number) {
  wetness = k;
  for (const [m, base] of wetMats) {
    m.color.copy(base.color).multiplyScalar(1 - k * 0.45);
    m.roughness = base.rough - (base.rough - 0.28) * k;
  }
}

/** Seeded random so the campus looks the same every ride. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/**
 * The sky dome: a gradient from the zenith to a hazy horizon, a soft sun glow, and slow drifting
 * clouds from a few octaves of value noise. All in one fragment shader, no textures.
 * `detail` is the number of noise octaves (2 on cheap phones, 4 otherwise).
 */
export function buildSky(top: string, bottom: string, detail = 4) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(top) },
      bottom: { value: new THREE.Color(bottom) },
      sunDir: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
      sunCol: { value: new THREE.Color('#fff1d6') },
      cloud: { value: 0.45 },
      cloudCol: { value: new THREE.Color('#ffffff') },
      treeCol: { value: new THREE.Color('#2f4a2a') },
      time: { value: 0 },
    },
    defines: { OCTAVES: detail },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float cloud; uniform vec3 cloudCol; uniform vec3 treeCol; uniform float time; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 2.2, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.7));
        // haze: the band just above the horizon is paler
        col = mix(col, bottom * 1.04, (1.0 - smoothstep(0.0, 0.18, d.y)) * 0.35);
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunCol * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.45 + smoothstep(0.9993, 0.9997, s) * 1.4);
        // a far tree line and low hills all round, faded into the haze
        float az = atan(d.z, d.x);
        float ridge = 0.012 + 0.03 * noise(vec2(az * 3.0, 1.7)) + 0.012 * noise(vec2(az * 19.0, 4.1)) + 0.006 * noise(vec2(az * 61.0, 8.3));
        float tl = (1.0 - smoothstep(ridge - 0.002, ridge + 0.002, d.y)) * step(-0.02, d.y);
        col = mix(col, mix(bottom, treeCol, 0.42 - 0.18 * smoothstep(0.0, 0.05, ridge - d.y)), tl);
        if (d.y > 0.0 && cloud > 0.01) {
          // project onto a cloud layer, so clouds flatten toward the horizon
          vec2 uv = d.xz / (d.y + 0.12) * 1.3 + vec2(time * 0.004, time * 0.0015);
          float n = 0.0, a = 0.5;
          for (int i = 0; i < OCTAVES; i++) { n += noise(uv) * a; uv = uv * 2.03 + 17.0; a *= 0.5; }
          float c = smoothstep(1.0 - cloud, 1.05 - cloud * 0.5, n) * smoothstep(0.0, 0.12, d.y);
          vec3 cc = cloudCol * (0.82 + 0.25 * n) + sunCol * pow(s, 8.0) * 0.25;
          col = mix(col, cc, c * 0.9);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
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

/** Flat strip along a polyline with mitred joints, appended to pos/idx. */
function polyStrip(pts: [number, number][], half: number, pos: number[], idx: number[]) {
  const n = pts.length;
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    let tx = 0, tz = 0;
    if (i > 0) { const dx = x - pts[i - 1][0], dz = z - pts[i - 1][1], l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; }
    if (i < n - 1) { const dx = pts[i + 1][0] - x, dz = pts[i + 1][1] - z, l = Math.hypot(dx, dz) || 1; tx += dx / l; tz += dz / l; }
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    // stretch the joint so the strip keeps its width round bends
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = x - pts[i - 1][0], dz = z - pts[i - 1][1], sl = Math.hypot(dx, dz) || 1;
      k = Math.min(2.5, 1 / Math.max(0.4, (tx * dx + tz * dz) / sl));
    }
    const nx = -tz * half * k, nz = tx * half * k;
    pos.push(x - nx, 0, z - nz, x + nx, 0, z + nz);
  }
  for (let i = 0; i < n - 1; i++) {
    const v = base + i * 2;
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
}

function flatGeometry(pos: number[], idx: number[]) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat material drawn over the ground without z-fighting. */
const groundMat = (color: string, layer: number, map?: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ color, ...(map && { map }), roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 2 });

/**
 * Grass with large light, dark and dry patches laid over the fine 8 m texture,
 * so the open fields do not show an obvious repeat. One extra texture lookup.
 */
function grassMaterial(map: THREE.Texture) {
  const macro = grassMacroTexture();
  macro.colorSpace = THREE.NoColorSpace;
  // a touch less saturated than the texture: sun-bleached Legon grass, not a football pitch
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, color: '#e4e0cc' });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.grassMacro = { value: macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrassW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrassW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrassW;\nuniform sampler2D grassMacro;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 gm = texture2D(grassMacro, vGrassW / 260.0).rg + texture2D(grassMacro, vGrassW / 71.0 + 0.37).rg - 1.0;
        diffuseColor.rgb *= 1.0 + gm.r * 0.8;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.05, 0.62), clamp(gm.g * 2.2, 0.0, 0.5));`,
      );
  };
  mat.customProgramCacheKey = () => 'legon-grass';
  return mat;
}

/**
 * The real campus, built once: ground, ground areas (pitches, parking, water),
 * every road and footpath at its real width, and every building footprint.
 */
export function buildCampus() {
  const group = new THREE.Group();

  // ground: 200 m tiles merged into one mesh, each with its own UV origin, because
  // one huge texture repeat loses UV precision on some mobile GPUs
  const b = mapBounds();
  const PAD = 300, TILE = 200;
  const x0 = Math.floor((b.minX - PAD) / TILE) * TILE, z0 = Math.floor((b.minZ - PAD) / TILE) * TILE;
  const tx = Math.ceil((b.maxX + PAD - x0) / TILE), tz = Math.ceil((b.maxZ + PAD - z0) / TILE);
  const tiles: THREE.BufferGeometry[] = [];
  for (let i = 0; i < tx; i++) for (let j = 0; j < tz; j++) tiles.push(new THREE.PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2).translate(x0 + i * TILE + TILE / 2, 0, z0 + j * TILE + TILE / 2));
  const grassTex = grassTexture();
  grassTex.repeat.set(TILE / 8, TILE / 8);
  const ground = new THREE.Mesh(mergeGeometries(tiles), grassMaterial(grassTex));
  ground.receiveShadow = true;
  group.add(ground);

  // pitches, tracks, car parks, water and woods
  const AREA_COLOR: Record<string, string> = { pitch: '#4f9a3a', track: '#b4533a', parking: '#8d9096', water: '#4f8fbf', wood: '#2f6b2a' };
  const areaBuf = new Map<string, { pos: number[]; idx: number[] }>();
  for (const a of AREAS) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < a.pts.length; i += 2) contour.push(new THREE.Vector2(a.pts[i], a.pts[i + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    let buf = areaBuf.get(a.kind);
    if (!buf) areaBuf.set(a.kind, (buf = { pos: [], idx: [] }));
    const base = buf.pos.length / 3;
    for (const v of contour) buf.pos.push(v.x, 0, v.y);
    for (const t of tris) buf.idx.push(base + t[0], base + t[1], base + t[2]);
  }
  // car parks get asphalt and pitches mown stripes, laid in world space
  const AREA_MAP: Record<string, [() => THREE.Texture, number, string]> = {
    parking: [concreteTexture, 5, '#b9bbbf'],
    pitch: [pitchTexture, 12, '#4c8a3b'],
  };
  for (const [kind, buf] of areaBuf) {
    const geo = flatGeometry(buf.pos, buf.idx);
    const tex = AREA_MAP[kind];
    if (tex) {
      const uv: number[] = [];
      for (let k = 0; k < buf.pos.length; k += 3) uv.push(buf.pos[k] / tex[1], buf.pos[k + 2] / tex[1]);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    const m = new THREE.Mesh(geo, tex ? groundMat(tex[2], 1, tex[0]()) : groundMat(AREA_COLOR[kind], 1));
    m.receiveShadow = true;
    group.add(m);
  }

  // every road and footpath, with round caps where roads meet
  const roadBuf = { pos: [] as number[], idx: [] as number[] };
  const pathBuf = { pos: [] as number[], idx: [] as number[] };
  const caps: THREE.BufferGeometry[] = [];
  const pathCaps: THREE.BufferGeometry[] = [];
  for (const r of ROADS) {
    const pts = r.nodes.map((i) => [NODE_XZ[i * 2], NODE_XZ[i * 2 + 1]] as [number, number]);
    const half = ROAD_WIDTH[r.cls] / 2;
    const footpath = r.cls === 4;
    const buf = footpath ? pathBuf : roadBuf;
    polyStrip(pts, half, buf.pos, buf.idx);
    for (const [x, z] of [pts[0], pts[pts.length - 1]]) (footpath ? pathCaps : caps).push(new THREE.CircleGeometry(half, 10).rotateX(-Math.PI / 2).translate(x, 0, z));
  }
  const campusAsphalt = asphaltTexture(false);
  const asphalt = weathering(wettable(groundMat('#f2f2f2', 3, campusAsphalt)), 'ground', 34, 0.35);
  const pathTex = concreteTexture();
  const path = wettable(groundMat('#efe2c2', 2, pathTex));
  const merged = (main: THREE.BufferGeometry, extra: THREE.BufferGeometry[]) => {
    const parts = [main, ...extra].map((g) => {
      const flat = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(flat.attributes)) if (k !== 'position') flat.deleteAttribute(k);
      return flat;
    });
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();
    // world-space UVs: the surface texture repeats every 6 m wherever the road runs
    const p = geo.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let k = 0; k < p.count; k++) { uv[k * 2] = p.getX(k) / 6; uv[k * 2 + 1] = p.getZ(k) / 6; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  };
  const roads = new THREE.Mesh(merged(flatGeometry(roadBuf.pos, roadBuf.idx), caps), asphalt);
  roads.receiveShadow = true;
  const paths = new THREE.Mesh(merged(flatGeometry(pathBuf.pos, pathBuf.idx), pathCaps), path);
  paths.receiveShadow = true;
  group.add(paths, roads);

  // painted centre dashes on the main and through roads, all in one mesh
  const dashPos: number[] = [], dashIdx: number[] = [];
  for (const r of ROADS) {
    if (r.cls > 1) continue;
    let carry = 2;
    for (let k = 0; k < r.nodes.length - 1; k++) {
      const a = r.nodes[k], c = r.nodes[k + 1];
      const ax = NODE_XZ[a * 2], az = NODE_XZ[a * 2 + 1], cx = NODE_XZ[c * 2], cz = NODE_XZ[c * 2 + 1];
      const len = Math.hypot(cx - ax, cz - az);
      if (len < 1e-3) continue;
      const dx = (cx - ax) / len, dz = (cz - az) / len, nx = -dz * 0.07, nz = dx * 0.07;
      let t = carry;
      for (; t + 3 <= len; t += 9) {
        const x0 = ax + dx * t, z0 = az + dz * t, x1 = x0 + dx * 3, z1 = z0 + dz * 3;
        const base = dashPos.length / 3;
        dashPos.push(x0 - nx, 0, z0 - nz, x0 + nx, 0, z0 + nz, x1 + nx, 0, z1 + nz, x1 - nx, 0, z1 - nz);
        dashIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      carry = Math.max(0, t - len);
    }
  }
  if (dashPos.length) group.add(new THREE.Mesh(flatGeometry(dashPos, dashIdx), groundMat('#e9e6dc', 4)));

  // every building: cream walls with window bays, a plinth, and terracotta tile roofs
  const buildings = buildBuildings(BUILDINGS);
  group.add(buildings);

  // trees, kerbs, lamps, stops, signs, cars, kiosks and people (see life.ts)
  const life = buildCampusLife();
  group.add(life);
  // skip whatever lies past the fog: building and life cells far from the camera
  // concrete verges and open drains along the roads
  const edges = buildRoadEdges(concreteTexture());
  wettable(edges.material);
  group.add(edges.group);
  cullBeyondFog(group, [...(buildings.children as THREE.Mesh[]), ...(life.userData.cullMeshes as THREE.Mesh[]), ...edges.meshes]);
  return group;
}

export interface RouteLabel {
  place: Place;
  /** distance along the track */
  d: number;
}

export interface RouteLayerOptions {
  /** track distance of the start line and the finish line */
  start: number;
  finish: number;
  startText: string;
  finishText: string;
  labels: RouteLabel[];
  destination?: Place;
}

/**
 * The ridden route on top of the campus: a three-lane road with kerbs and lane
 * markings along the real road line, street trees and lamps, labels for the
 * places it passes, start and finish arches, and a beacon over the destination.
 */
export function buildRouteLayer(track: Track, o: RouteLayerOptions) {
  const group = new THREE.Group();
  const rand = rng(7);
  const L = track.length;
  const at = (d: number, lateral: number, y = 0) => {
    const p = track.pose(d, lateral);
    return new THREE.Vector3(p.x, y, p.z);
  };
  const yawAt = (d: number) => track.pose(d).yaw;

  const roadTex = asphaltTexture();
  roadTex.repeat.set(2, 1);
  const road = new THREE.Mesh(ribbon(track, -ROAD_HALF, 0, ROAD_HALF, 0, 0, L), weathering(wettable(groundMat('#ffffff', 5, roadTex)), 'ground', 34, 0.35));
  road.receiveShadow = true;
  group.add(road);
  const white = groundMat('#e9e6dc', 6);
  for (const s of [-1, 1]) {
    const [a, c] = [s * (ROAD_HALF - 0.27), s * (ROAD_HALF - 0.13)].sort((u, v) => u - v);
    group.add(new THREE.Mesh(ribbon(track, a, 0, c, 0, 0, L, 8, 4), white));
  }
  const conc = concreteTexture();
  conc.repeat.set(1, 4);
  const walkMat = wettable(new THREE.MeshStandardMaterial({ map: conc, roughness: 0.95, side: THREE.DoubleSide }));
  for (const s of [-1, 1]) {
    const a = s * ROAD_HALF, c = s * (ROAD_HALF + 1.6);
    const top = s > 0 ? ribbon(track, a, 0.12, c, 0.12, 0, L) : ribbon(track, c, 0.12, a, 0.12, 0, L);
    const curb = s > 0 ? ribbon(track, a, 0, a, 0.12, 0, L) : ribbon(track, a, 0.12, a, 0, 0, L);
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
      m.compose(at(d, x, 0.01), q.setFromAxisAngle(up, yawAt(d)), one);
      dashes.setMatrixAt(i++, m);
    }
  }
  group.add(dashes);

  // trees and lamps along the route, kept off buildings and off the road on tight bends
  const clear = (p: THREE.Vector3, r: number) => track.distanceToRoad(p.x, p.z) > ROAD_HALF + 1.8 + r && !buildingAt(p.x, p.z, r + 0.5);
  const spots: THREE.Matrix4[] = [];
  for (let d = 0; d < L; d += 13) {
    for (const s of [-1, 1]) {
      const p = at(d + (rand() - 0.5) * 6, s * (ROAD_HALF + 4 + rand() * 5));
      const sc = 0.8 + rand() * 0.6, spin = rand() * 6.28;
      if (!clear(p, 1.2)) continue;
      spots.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, spin), new THREE.Vector3(sc, sc, sc)));
    }
  }
  addRouteTrees(group, spots, rand);
  const lamps: THREE.Matrix4[] = [];
  for (let d = 0; d < L; d += 36) {
    for (const s of [-1, 1]) {
      const dd = d + (s > 0 ? 18 : 0);
      const p = at(dd, s * (ROAD_HALF + 1.2));
      if (track.distanceToRoad(p.x, p.z) < ROAD_HALF + 1 || buildingAt(p.x, p.z, 0.5)) continue;
      lamps.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, yawAt(dd) + (s > 0 ? Math.PI : 0)), one));
    }
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', metalness: 0.6, roughness: 0.4 });
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), lampMat, Math.max(1, lamps.length));
  const lampArm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.25).translate(0.45, 6, 0), lampMat, Math.max(1, lamps.length));
  lamps.forEach((mm, k) => { lampPole.setMatrixAt(k, mm); lampArm.setMatrixAt(k, mm); });
  const lampHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.1, 0.3).translate(0.75, 5.9, 0), lampGlow.head, Math.max(1, lamps.length));
  const lampPool = new THREE.InstancedMesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2).translate(1.4, 0.04, 0), lampGlow.pool, Math.max(1, lamps.length));
  lamps.forEach((mm, k) => { lampHead.setMatrixAt(k, mm); lampPool.setMatrixAt(k, mm); });
  lampPole.count = lampArm.count = lampHead.count = lampPool.count = lamps.length;
  lampPole.castShadow = true;
  lampPool.renderOrder = 1;
  group.add(lampPole, lampArm, lampHead, lampPool);

  // labels over the places the route passes
  for (const l of o.labels) {
    const { tex, aspect } = labelTexture(l.place.name.toUpperCase(), KIND_ACCENT[l.place.kind]);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: true }));
    const lh = 2.6;
    label.scale.set(lh * aspect, lh, 1);
    const bd = buildingAt(l.place.x, l.place.z);
    label.position.set(l.place.x, (bd?.height ?? (bd ? 8 : 4)) + 3, l.place.z);
    group.add(label);
  }

  // beacon over the destination
  if (o.destination) {
    const { x, z } = o.destination;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true).translate(0, 35, 0), new THREE.MeshBasicMaterial({ color: '#ffd21f', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(x, 0, z);
    group.add(beam);
    const { tex, aspect } = labelTexture(o.destination.name.toUpperCase(), '#ffd21f');
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, fog: false }));
    sign.scale.set(4.5 * aspect, 4.5, 1);
    sign.position.set(x, 26, z);
    sign.renderOrder = 10;
    group.add(sign);
  }

  // in-world billboards (future ad slots)
  const bbTex = billboardTexture();
  for (let d = o.start + 600, k = 0; d < o.finish - 100; d += 700, k++) {
    const s = k % 2 ? -1 : 1;
    const p = at(d, s * (ROAD_HALF + 8));
    if (!clear(p, 4)) continue;
    group.add(billboard(bbTex, s, p, yawAt(d)));
  }

  // a little way past the start line, so it does not sit over the rider and the HUD at the countdown
  group.add(gate(o.startText, at(o.start + 16, 0), yawAt(o.start + 16)));
  group.add(gate(o.finishText, at(o.finish, 0), yawAt(o.finish), true));
  return group;
}

/** Frees a route layer's GPU memory (shared tree meshes are kept). */
export function disposeLayer(group: THREE.Object3D) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.userData.shared) return;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const mat of mats) {
      wetMats.delete(mat as THREE.MeshStandardMaterial);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
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
