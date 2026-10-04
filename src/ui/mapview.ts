// 2D campus map: drawn once into an offscreen canvas, then used for the heading-up
// mini map during rides and the north-up route preview in Explore.
import { AREAS, BUILDINGS, NODE_XZ, ROADS, mapBounds } from '../game/campusmap';
import type { Route } from '../game/routes';

const M_PER_PX = 1.5;
let base: { canvas: HTMLCanvasElement; x0: number; z0: number } | null = null;

const WIDTH = [5, 4.2, 3.6, 2.6, 1.6]; // px, by road class

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
  ctx.fillStyle = '#16233f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const poly = (pts: Float32Array) => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(pts[i]), Z(pts[i + 1]));
    ctx.closePath();
  };
  const AREA: Record<string, string> = { pitch: '#1f4a3a', track: '#5a2f2f', parking: '#2a3550', water: '#1f4f7a', wood: '#1a3a2c' };
  for (const a of AREAS) { poly(a.pts); ctx.fillStyle = AREA[a.kind]; ctx.fill(); }
  ctx.fillStyle = '#33456e';
  for (const bd of BUILDINGS) { poly(bd.pts); ctx.fill(); }
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const cls of [4, 3, 2, 1, 0]) {
    ctx.strokeStyle = cls === 4 ? 'rgba(200, 190, 160, 0.55)' : 'rgba(225, 232, 245, 0.9)';
    ctx.lineWidth = WIDTH[cls];
    ctx.beginPath();
    for (const r of ROADS) {
      if (r.cls !== cls) continue;
      r.nodes.forEach((n, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(NODE_XZ[n * 2]), Z(NODE_XZ[n * 2 + 1])));
    }
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
  ctx.strokeStyle = '#0b1530';
  ctx.lineWidth = lineWidth * 1.8;
  ctx.stroke();
  ctx.strokeStyle = '#ffd21f';
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
    ctx.fillStyle = '#16233f';
    ctx.fill();
    ctx.clip();
    ctx.translate(R, R + R * 0.25);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.translate(-pos[0], -pos[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map, x0, z0, map.width * M_PER_PX, map.height * M_PER_PX);
    drawRoute(ctx, route, 6 / k);
    pin(ctx, route.to.x, route.to.z, 8 / k, '#22c55e');
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
  ctx.fillStyle = '#16233f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(k, k);
  ctx.translate(-cx, -cz);
  ctx.drawImage(map, x0, z0, map.width * M_PER_PX, map.height * M_PER_PX);
  drawRoute(ctx, route, Math.max(4, 3 / k));
  pin(ctx, route.from.x, route.from.z, 7 / k, '#5ec8ff');
  pin(ctx, route.to.x, route.to.z, 7 / k, '#22c55e');
  ctx.restore();
  // north marker
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '700 20px Sora, system-ui, sans-serif';
  ctx.fillText('N ↑', 12, 28);
}
