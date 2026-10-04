// The real campus: road network, building footprints and named places from
// OpenStreetMap (see scripts/osm-campus.mjs), plus route finding and turn-by-turn
// directions over the road network.
import raw from '../data/legon-map.json';

export type RoadClass = 0 | 1 | 2 | 3 | 4; // main, through, residential, service lane, footpath
export type PlaceKind = 'hall' | 'academic' | 'landmark' | 'food' | 'bank' | 'transport' | 'worship' | 'sport' | 'health' | 'other';

export interface Place {
  name: string;
  kind: PlaceKind;
  x: number;
  z: number;
}
export interface Road {
  name?: string;
  cls: RoadClass;
  nodes: number[];
}
export interface Building {
  name?: string;
  height?: number;
  /** footprint, flat x,z pairs in metres */
  pts: Float32Array;
  minX: number; maxX: number; minZ: number; maxZ: number;
}
export interface Area {
  kind: 'pitch' | 'track' | 'parking' | 'water' | 'wood';
  pts: Float32Array;
}

interface RawData {
  attribution: string;
  nodes: number[];
  roads: { c: number; w: number[]; n?: string }[];
  buildings: { p: number[]; h?: number; n?: string }[];
  areas: { k: string; p: number[] }[];
  places: { n: string; k: string; x: number; z: number }[];
}
const data = raw as RawData;

export const ATTRIBUTION = data.attribution;
/** road graph node positions: x, z pairs in metres */
export const NODE_XZ = Float32Array.from(data.nodes, (v) => v / 10);
export const ROADS: Road[] = data.roads.map((r) => ({ name: r.n, cls: r.c as RoadClass, nodes: r.w }));
export const BUILDINGS: Building[] = data.buildings.map((b) => {
  const pts = Float32Array.from(b.p, (v) => v / 10);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]);
  }
  return { name: b.n, height: b.h, pts, minX, maxX, minZ, maxZ };
});
export const AREAS: Area[] = data.areas.map((a) => ({ kind: a.k as Area['kind'], pts: Float32Array.from(a.p, (v) => v / 10) }));
export const PLACES: Place[] = data.places.map((p) => ({ name: p.n, kind: p.k as PlaceKind, x: p.x / 10, z: p.z / 10 }));

export const placeByName = (name: string) => PLACES.find((p) => p.name === name);

// ---------- buildings lookup ----------
const BCELL = 50;
const bgrid = new Map<string, number[]>();
BUILDINGS.forEach((b, i) => {
  for (let x = Math.floor(b.minX / BCELL); x <= Math.floor(b.maxX / BCELL); x++)
    for (let z = Math.floor(b.minZ / BCELL); z <= Math.floor(b.maxZ / BCELL); z++) {
      const k = `${x},${z}`;
      let l = bgrid.get(k);
      if (!l) bgrid.set(k, (l = []));
      l.push(i);
    }
});
function inside(pts: Float32Array, x: number, z: number) {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
/** The building whose footprint contains (x, z), padded by `pad` metres on its bounding box. */
export function buildingAt(x: number, z: number, pad = 0): Building | undefined {
  for (const i of bgrid.get(`${Math.floor(x / BCELL)},${Math.floor(z / BCELL)}`) ?? []) {
    const b = BUILDINGS[i];
    if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) continue;
    if (pad > 0 || inside(b.pts, x, z)) return b;
  }
  return undefined;
}

// ---------- road graph ----------
const COST: Record<RoadClass, number> = { 0: 1.05, 1: 1, 2: 1, 3: 1.1, 4: 1.35 };
interface Edge { to: number; len: number; road: number }
const adj: Edge[][] = Array.from({ length: NODE_XZ.length / 2 }, () => []);
const nx = (i: number) => NODE_XZ[i * 2];
const nz = (i: number) => NODE_XZ[i * 2 + 1];
ROADS.forEach((r, ri) => {
  for (let k = 0; k < r.nodes.length - 1; k++) {
    const a = r.nodes[k], b = r.nodes[k + 1];
    const len = Math.hypot(nx(a) - nx(b), nz(a) - nz(b));
    adj[a].push({ to: b, len, road: ri });
    adj[b].push({ to: a, len, road: ri });
  }
});
export const nodeDegree = (i: number) => adj[i].length;

// keep only the largest connected network, so every pair of places has a route
const comp = new Int32Array(adj.length).fill(-1);
let best = 0, bestSize = 0;
for (let s = 0, c = 0; s < adj.length; s++) {
  if (comp[s] >= 0 || !adj[s].length) continue;
  let size = 0;
  const stack = [s];
  comp[s] = c;
  while (stack.length) {
    const v = stack.pop()!;
    size++;
    for (const e of adj[v]) if (comp[e.to] < 0) { comp[e.to] = c; stack.push(e.to); }
  }
  if (size > bestSize) { bestSize = size; best = c; }
  c++;
}
const NCELL = 40;
const ngrid = new Map<string, number[]>();
for (let i = 0; i < adj.length; i++) {
  if (comp[i] !== best) continue;
  const k = `${Math.floor(nx(i) / NCELL)},${Math.floor(nz(i) / NCELL)}`;
  let l = ngrid.get(k);
  if (!l) ngrid.set(k, (l = []));
  l.push(i);
}
const bestClass = (i: number) => Math.min(...adj[i].map((e) => ROADS[e.road].cls));

/** Closest node on the connected network; rideable roads win over footpaths unless much farther. */
export function nearestNode(x: number, z: number) {
  let found = -1, score = Infinity;
  for (let r = 1; r <= 8 && found < 0; r *= 2) {
    const cx = Math.floor(x / NCELL), cz = Math.floor(z / NCELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      for (const i of ngrid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const d = Math.hypot(nx(i) - x, nz(i) - z) + (bestClass(i) === 4 ? 25 : 0);
        if (d < score) { score = d; found = i; }
      }
    }
  }
  return found;
}

export interface PathResult {
  /** node indices from start to end */
  nodes: number[];
  /** road index of each segment (nodes[k] -> nodes[k+1]) */
  roads: number[];
  length: number;
}

/** Shortest way between two points along the road network (A*). */
export function findPath(from: [number, number], to: [number, number]): PathResult | null {
  const s = nearestNode(from[0], from[1]), t = nearestNode(to[0], to[1]);
  if (s < 0 || t < 0) return null;
  const n = adj.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevRoad = new Int32Array(n).fill(-1);
  const h = (i: number) => Math.hypot(nx(i) - nx(t), nz(i) - nz(t));
  // binary heap of [f, node]
  const heap: [number, number][] = [];
  const push = (f: number, v: number) => {
    heap.push([f, v]);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  g[s] = 0;
  push(h(s), s);
  const done = new Uint8Array(n);
  while (heap.length) {
    const [, v] = pop();
    if (done[v]) continue;
    done[v] = 1;
    if (v === t) break;
    for (const e of adj[v]) {
      const c = g[v] + e.len * COST[ROADS[e.road].cls];
      if (c < g[e.to]) {
        g[e.to] = c;
        prev[e.to] = v;
        prevRoad[e.to] = e.road;
        push(c + h(e.to), e.to);
      }
    }
  }
  if (s !== t && prev[t] < 0) return null;
  const nodes = [t], roads: number[] = [];
  for (let v = t; v !== s; v = prev[v]) { nodes.push(prev[v]); roads.push(prevRoad[v]); }
  nodes.reverse(); roads.reverse();
  let length = 0;
  for (let k = 0; k < nodes.length - 1; k++) length += Math.hypot(nx(nodes[k]) - nx(nodes[k + 1]), nz(nodes[k]) - nz(nodes[k + 1]));
  return { nodes, roads, length };
}

export const nodeXZ = (i: number): [number, number] => [nx(i), nz(i)];

// ---------- directions ----------
export type Turn = 'start' | 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'arrive';
export interface Step {
  turn: Turn;
  text: string;
  /** distance along the path where the step happens (metres) */
  at: number;
  /** road the step leads onto */
  road?: string;
  /** where the step happens on the map */
  x: number;
  z: number;
}

const roadLabel = (ri: number) => ROADS[ri].name ?? (ROADS[ri].cls === 4 ? 'the footpath' : ROADS[ri].cls === 3 ? 'the lane' : 'the road');
const CARDINAL = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Turn-by-turn steps for a path, in plain words a fresher can follow on foot too. */
export function directions(path: PathResult, destination: string): Step[] {
  const { nodes, roads } = path;
  const P = nodes.map(nodeXZ);
  const cum = [0];
  for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
  // heading over ~12 m either side of node k, so tiny kinks don't count as turns
  const headingAt = (k: number, dir: 1 | -1) => {
    let j = k;
    while (j + dir >= 0 && j + dir < P.length && Math.abs(cum[j] - cum[k]) < 12) j += dir;
    const [ax, az] = dir > 0 ? P[k] : P[j], [bx, bz] = dir > 0 ? P[j] : P[k];
    return Math.atan2(bx - ax, -(bz - az)); // 0 = north, clockwise
  };
  const steps: Step[] = [];
  if (P.length > 1) {
    const h0 = headingAt(0, 1);
    const card = CARDINAL[((Math.round((h0 / (Math.PI * 2)) * 8) % 8) + 8) % 8];
    steps.push({ turn: 'start', text: `Head ${card} on ${roadLabel(roads[0])}`, at: 0, road: ROADS[roads[0]].name, x: P[0][0], z: P[0][1] });
  }
  let groupName = ROADS[roads[0]]?.name ?? `#${roads[0]}`;
  for (let k = 1; k < P.length - 1; k++) {
    const nextName = ROADS[roads[k]].name ?? `#${roads[k]}`;
    let a = headingAt(k, 1) - headingAt(k, -1);
    a = Math.atan2(Math.sin(a), Math.cos(a));
    const deg = (a * 180) / Math.PI;
    const changed = nextName !== groupName;
    const junction = nodeDegree(nodes[k]) >= 3;
    if (!changed && !(junction && Math.abs(deg) > 50)) continue;
    const label = roadLabel(roads[k]);
    let turn: Turn, verb: string;
    if (Math.abs(deg) < 25) { turn = 'straight'; verb = 'Continue onto'; }
    else if (Math.abs(deg) < 60) { turn = deg < 0 ? 'slight-left' : 'slight-right'; verb = `Keep ${deg < 0 ? 'left' : 'right'} onto`; }
    else if (Math.abs(deg) < 145) { turn = deg < 0 ? 'left' : 'right'; verb = `Turn ${deg < 0 ? 'left' : 'right'} onto`; }
    else { turn = deg < 0 ? 'sharp-left' : 'sharp-right'; verb = `Turn sharp ${deg < 0 ? 'left' : 'right'} onto`; }
    // unnamed road straight on is not worth a step
    if (turn === 'straight' && !ROADS[roads[k]].name) continue;
    groupName = nextName;
    // merge steps closer than 15 m: keep the later one
    if (steps.length > 1 && cum[k] - steps[steps.length - 1].at < 15) steps.pop();
    steps.push({ turn, text: `${verb} ${label}`, at: cum[k], road: ROADS[roads[k]].name, x: P[k][0], z: P[k][1] });
  }
  // a short dog-leg off a named road and back onto it reads as "carry on"
  for (let i = 1; i < steps.length - 1; i++) {
    const before = steps[i - 1].road, after = steps[i + 1].road;
    if (!steps[i].road && before && after === before && steps[i + 1].at - steps[i].at < 80) {
      steps.splice(i, 2);
      i--;
    }
  }
  const [ex, ez] = P[P.length - 1];
  steps.push({ turn: 'arrive', text: `Arrive at ${destination}`, at: cum[cum.length - 1], x: ex, z: ez });
  return steps;
}

/** Bounds of the whole map, for the ground and the mini map. */
export function mapBounds() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < NODE_XZ.length; i += 2) {
    minX = Math.min(minX, NODE_XZ[i]); maxX = Math.max(maxX, NODE_XZ[i]);
    minZ = Math.min(minZ, NODE_XZ[i + 1]); maxZ = Math.max(maxZ, NODE_XZ[i + 1]);
  }
  return { minX, maxX, minZ, maxZ };
}
