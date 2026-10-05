// 2D campus map: drawn once into an offscreen canvas, then used for the heading-up
// mini map during rides and the north-up route preview in Explore.
import { AREAS, BUILDINGS, NODE_XZ, PLACES, ROADS, mapBounds, type PlaceKind } from '../game/campusmap';
import type { Route } from '../game/routes';

const M_PER_PX = 1.5;
let base: { canvas: HTMLCanvasElement; x0: number; z0: number } | null = null;

const WIDTH = [5.5, 4.6, 3.8, 2.8, 1.4]; // px, by road class
// a light street-map look: cream land, green grounds, white streets with grey edges, yellow main roads
const LAND = '#f2efe9';
const ROAD_FILL = ['#fde293', '#fde293', '#ffffff', '#ffffff', '#ffffff'];
const ROAD_EDGE = ['#e8b84a', '#e8b84a', '#c9ccd3', '#d5d8de', '#d5d8de'];

/** The whole campus at 1.5 m per pixel, north up. */
function campusCanvas() {
  if (base) return base;
  const b = mapBounds();
  const pad = 200;
  const x0 = b.minX - pad, z0 = b.minZ - pad;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((b.maxX - b.minX + pad * 2) / M_PER_PX);
  canvas.height = Math.ceil((b.maxZ - b.minZ + pad * 2) / M_PER_PX);
  const ctx = canvas.getContext('2d')!;
  const X = (x: number) => (x - x0) / M_PER_PX, Z = (z: number) => (z - z0) / M_PER_PX;
  ctx.fillStyle = LAND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ring = (pts: Float32Array) => {
    for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(pts[i]), Z(pts[i + 1]));
    ctx.closePath();
  };
  const poly = (pts: Float32Array) => {
    ctx.beginPath();
    ring(pts);
  };
  const AREA: Record<string, string> = { pitch: '#bfe3b4', track: '#e9b8a6', parking: '#e6e6ea', water: '#a9d3f5', wood: '#cde8c4' };
  for (const a of AREAS) { poly(a.pts); ctx.fillStyle = AREA[a.kind]; ctx.fill(); }
  ctx.fillStyle = '#e3ddd3';
  ctx.strokeStyle = '#cfc6b8';
  ctx.lineWidth = 0.8;
  for (const bd of BUILDINGS) { poly(bd.pts); bd.holes.forEach(ring); ctx.fill('evenodd'); ctx.stroke(); }
  ctx.lineCap = ctx.lineJoin = 'round';
  const roads = (cls: number) => {
    ctx.beginPath();
    for (const r of ROADS) {
      if (r.cls !== cls) continue;
      r.nodes.forEach((n, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(NODE_XZ[n * 2]), Z(NODE_XZ[n * 2 + 1])));
    }
  };
  // edges first, then the fill on top, smallest roads underneath
  for (const cls of [4, 3, 2, 1, 0]) {
    roads(cls);
    if (cls === 4) {
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = '#b9b2a4';
      ctx.lineWidth = WIDTH[cls];
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.strokeStyle = ROAD_EDGE[cls];
    ctx.lineWidth = WIDTH[cls] + 1.6;
    ctx.stroke();
    ctx.strokeStyle = ROAD_FILL[cls];
    ctx.lineWidth = WIDTH[cls];
    ctx.stroke();
  }
  base = { canvas, x0, z0 };
  return base;
}

function drawRoute(ctx: CanvasRenderingContext2D, route: Route, lineWidth: number) {
  const pts = route.track.outline(6);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lineWidth * 1.8;
  ctx.stroke();
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function pin(ctx: CanvasRenderingContext2D, x: number, z: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, z, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = r * 0.4;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

/** Heading-up mini map around the rider; returns a draw(pos, yaw) function. */
export function miniMap(canvas: HTMLCanvasElement, route: Route) {
  const ctx = canvas.getContext('2d')!;
  const { canvas: map, x0, z0 } = campusCanvas();
  const R = canvas.width / 2;
  const k = R / 220; // px per metre: shows about 220 m around the rider
  return (pos: [number, number], yaw: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.fillStyle = LAND;
    ctx.fill();
    ctx.clip();
    ctx.translate(R, R + R * 0.25);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.translate(-pos[0], -pos[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map, x0, z0, map.width * M_PER_PX, map.height * M_PER_PX);
    drawRoute(ctx, route, 6 / k);
    pin(ctx, route.to.x, route.to.z, 8 / k, '#ea4335');
    ctx.restore();
    // rider arrow, always pointing up
    ctx.save();
    ctx.translate(R, R + R * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 4); ctx.lineTo(-10, 10); ctx.closePath();
    ctx.fillStyle = '#ffd21f';
    ctx.strokeStyle = '#0b1530';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

/** North-up overview of a whole route, fitted to the canvas. */
export function routeMap(canvas: HTMLCanvasElement, route: Route) {
  const ctx = canvas.getContext('2d')!;
  const { canvas: map, x0, z0 } = campusCanvas();
  const b = route.track.bounds();
  const pad = 80;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const k = Math.min(canvas.width / w, canvas.height / h);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  ctx.save();
  ctx.fillStyle = LAND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(k, k);
  ctx.translate(-cx, -cz);
  ctx.drawImage(map, x0, z0, map.width * M_PER_PX, map.height * M_PER_PX);
  ctx.restore();
  const toScreen = (x: number, z: number): [number, number] => [canvas.width / 2 + (x - cx) * k, canvas.height / 2 + (z - cz) * k];
  drawLabels(ctx, toScreen, canvas.width, canvas.height, Math.round(canvas.width / 34), 18);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(k, k);
  ctx.translate(-cx, -cz);
  drawRoute(ctx, route, Math.max(4, 3 / k));
  pin(ctx, route.from.x, route.from.z, 7 / k, '#1a73e8');
  pin(ctx, route.to.x, route.to.z, 7 / k, '#ea4335');
  ctx.restore();
  // north marker
  ctx.fillStyle = 'rgba(11,21,48,0.75)';
  ctx.font = '700 20px Sora, system-ui, sans-serif';
  ctx.fillText('N ↑', 12, 28);
}

const LABELLED: PlaceKind[] = ['hall', 'landmark', 'academic', 'food', 'health', 'sport'];
const LABEL_RANK: Partial<Record<PlaceKind, number>> = { hall: 0, landmark: 1, academic: 2, health: 3, food: 4, sport: 5 };
const LABEL_COLOR: Partial<Record<PlaceKind, string>> = { hall: '#8a4b0f', landmark: '#7a4fb3', academic: '#3c6e9e', food: '#c25e12', health: '#c0392b', sport: '#2f7d32' };

/** Place names like a street map: halls first, then landmarks; no overlaps. */
function drawLabels(ctx: CanvasRenderingContext2D, toScreen: (x: number, z: number) => [number, number], w: number, h: number, size: number, max = 40) {
  const boxes: [number, number, number, number][] = [];
  const list = PLACES.filter((p) => LABELLED.includes(p.kind)).sort((a, b) => (LABEL_RANK[a.kind] ?? 9) - (LABEL_RANK[b.kind] ?? 9));
  ctx.font = `600 ${size}px Sora, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  let n = 0;
  for (const p of list) {
    if (n >= max) break;
    const [sx, sy] = toScreen(p.x, p.z);
    if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
    const name = p.name.split(' (')[0];
    const tw = ctx.measureText(name).width;
    const box: [number, number, number, number] = [sx - tw / 2 - 4, sy - size - 2, sx + tw / 2 + 4, sy + size * 0.5];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    ctx.beginPath();
    ctx.arc(sx, sy - size - 6, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = LABEL_COLOR[p.kind] ?? '#555';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(name, sx, sy);
    ctx.fillStyle = LABEL_COLOR[p.kind] ?? '#3c4043';
    ctx.fillText(name, sx, sy);
    n++;
  }
  ctx.textAlign = 'left';
}

export interface Pin { x: number; z: number; color: string; label?: string }

/** North-up view of the whole campus, fitted to the canvas; for tapping on the map. */
export function campusOverview(canvas: HTMLCanvasElement, around: { x: number; z: number }[]) {
  const ctx = canvas.getContext('2d')!;
  const { canvas: map, x0, z0 } = campusCanvas();
  const b = { minX: Math.min(...around.map((p) => p.x)), maxX: Math.max(...around.map((p) => p.x)), minZ: Math.min(...around.map((p) => p.z)), maxZ: Math.max(...around.map((p) => p.z)) };
  const pad = 250;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const k = Math.min(canvas.width / w, canvas.height / h);
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const toScreen = (x: number, z: number): [number, number] => [canvas.width / 2 + (x - cx) * k, canvas.height / 2 + (z - cz) * k];
  /** canvas pixel (in canvas units) to map metres */
  const toWorld = (px: number, py: number): [number, number] => [cx + (px - canvas.width / 2) / k, cz + (py - canvas.height / 2) / k];
  const draw = (pins: Pin[] = [], line?: [Pin, Pin]) => {
    ctx.save();
    ctx.fillStyle = LAND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(k, k);
    ctx.translate(-cx, -cz);
    ctx.drawImage(map, x0, z0, map.width * M_PER_PX, map.height * M_PER_PX);
    ctx.restore();
    drawLabels(ctx, toScreen, canvas.width, canvas.height, Math.round(canvas.width / 40), 30);
    if (line) {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...toScreen(line[0].x, line[0].z));
      ctx.lineTo(...toScreen(line[1].x, line[1].z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.font = '700 22px Sora, system-ui, sans-serif';
    for (const p of pins) {
      const [sx, sy] = toScreen(p.x, p.z);
      pin(ctx, sx, sy, 11, p.color);
      if (p.label) {
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        const left = sx > canvas.width * 0.6;
        ctx.textAlign = left ? 'right' : 'left';
        const lx = left ? sx - 16 : sx + 16;
        ctx.strokeText(p.label, lx, sy + 8);
        ctx.fillStyle = '#0b1530';
        ctx.fillText(p.label, lx, sy + 8);
        ctx.textAlign = 'left';
      }
    }
    ctx.fillStyle = 'rgba(11,21,48,0.75)';
    ctx.font = '700 24px Sora, system-ui, sans-serif';
    ctx.fillText('N ↑', 14, 32);
  };
  return { draw, toWorld, toScreen };
}
