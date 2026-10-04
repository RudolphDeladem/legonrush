// A smooth road centreline built from map waypoints, sampled every metre so any
// distance along the route maps straight to a position and heading.

export interface Pose {
  x: number;
  z: number;
  /** unit tangent (direction of travel) */
  tx: number;
  tz: number;
  /** unit normal pointing to the rider's right */
  nx: number;
  nz: number;
  /** rotation about +y that turns a model facing -z to face along the road */
  yaw: number;
}

export class Track {
  /** samples every STEP metres: x, z */
  private xs: Float32Array;
  private zs: Float32Array;
  readonly length: number;
  static readonly STEP = 1;
  /** spatial hash of samples for distance-to-road queries */
  private grid = new Map<string, number[]>();
  private static readonly CELL = 24;

  constructor(waypoints: [number, number][], smoothing = 4) {
    // Chaikin corner cutting rounds every corner, then resample at even spacing
    let pts = waypoints.map(([x, z]) => [x, z] as [number, number]);
    for (let k = 0; k < smoothing; k++) {
      const out: [number, number][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const n = Math.floor(total / Track.STEP) + 1;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = i * Track.STEP;
      while (j < cum.length - 2 && cum[j + 1] < d) j++;
      const t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
      this.xs[i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;
      this.zs[i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
    }
    this.length = (n - 1) * Track.STEP;
    for (let i = 0; i < n; i += 2) {
      const key = this.cellKey(this.xs[i], this.zs[i]);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
  }

  private cellKey(x: number, z: number) {
    return `${Math.floor(x / Track.CELL)},${Math.floor(z / Track.CELL)}`;
  }

  /** Position and frame at distance d (extrapolates straight past either end). */
  pose(d: number, lateral = 0): Pose {
    const last = this.xs.length - 1;
    const i = Math.max(0, Math.min(last - 1, Math.floor(d / Track.STEP)));
    // tangent from a few metres either side keeps the frame smooth
    const a = Math.max(0, i - 2), b = Math.min(last, i + 3);
    let tx = this.xs[b] - this.xs[a], tz = this.zs[b] - this.zs[a];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const t = d / Track.STEP - i;
    const bx = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    const bz = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    const nx = -tz, nz = tx;
    return { x: bx + nx * lateral, z: bz + nz * lateral, tx, tz, nx, nz, yaw: Math.atan2(-tx, -tz) };
  }

  /** Distance along the route of the closest point, and the signed lateral offset (+ = right). */
  project(x: number, z: number): { d: number; lateral: number; dist: number } {
    let best = -1, bestD2 = Infinity;
    for (let i = 0; i < this.xs.length; i += 2) {
      const d2 = (this.xs[i] - x) ** 2 + (this.zs[i] - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    const p = this.pose(best * Track.STEP);
    const lateral = (x - p.x) * p.nx + (z - p.z) * p.nz;
    return { d: best * Track.STEP, lateral, dist: Math.sqrt(bestD2) };
  }

  /** Distance from (x, z) to the nearest point of the road centreline (accurate within ~48 m; farther reads as Infinity). */
  distanceToRoad(x: number, z: number) {
    const cx = Math.floor(x / Track.CELL), cz = Math.floor(z / Track.CELL);
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const list = this.grid.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const i of list) best = Math.min(best, Math.hypot(this.xs[i] - x, this.zs[i] - z));
    }
    return best;
  }

  /** Bounding box of the centreline. */
  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      minX = Math.min(minX, this.xs[i]); maxX = Math.max(maxX, this.xs[i]);
      minZ = Math.min(minZ, this.zs[i]); maxZ = Math.max(maxZ, this.zs[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Centreline sampled every `every` metres, for drawing the mini map. */
  outline(every = 10): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.xs.length; i += every) out.push([this.xs[i], this.zs[i]]);
    out.push([this.xs[this.xs.length - 1], this.zs[this.zs.length - 1]]);
    return out;
  }
}
