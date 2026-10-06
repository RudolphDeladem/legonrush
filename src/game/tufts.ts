// Grass tufts and wild flowers near the camera: crossed blade cards in one instanced mesh,
// laid out on a fixed grid (the same tuft is always in the same place, so nothing pops as
// you ride) and only where there is grass: never on roads, paths or inside buildings.
import * as THREE from 'three';
import { roadClearance } from './life';
import { buildingAt } from './campusmap';

const CELL = 2.2;

function tuftTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  // two variants side by side: plain blades (left), blades with a few small flowers (right)
  for (let v = 0; v < 2; v++) {
    const ox = v * 64;
    for (let i = 0; i < 46; i++) {
      const x = ox + 6 + Math.random() * 52, h = 22 + Math.random() * 40, lean = (Math.random() - 0.5) * 22;
      const grad = g.createLinearGradient(0, 64, 0, 64 - h);
      grad.addColorStop(0, '#4f6d2e');
      grad.addColorStop(1, ['#9cb862', '#88a653', '#b0bf70', '#7e9c4c'][i % 4]);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - 1.3, 64);
      g.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h);
      g.quadraticCurveTo(x + lean * 0.3 + 0.7, 64 - h * 0.6, x + 1.3, 64);
      g.fill();
    }
    if (v === 1) for (let i = 0; i < 6; i++) {
      g.fillStyle = ['#f4d23c', '#ffffff', '#f0a8c8'][i % 3];
      g.beginPath();
      g.arc(ox + 10 + Math.random() * 44, 18 + Math.random() * 24, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tuftGeometry(variant: number) {
  const parts: number[] = [], uvs: number[] = [], idx: number[] = [];
  const u0 = variant * 0.5, u1 = u0 + 0.5;
  for (let k = 0; k < 2; k++) {
    const a = (k * Math.PI) / 2 + 0.4, cx = Math.cos(a) * 0.32, cz = Math.sin(a) * 0.32;
    const base = parts.length / 3;
    // both faces drawn as front faces, so the back keeps its upward normal and isn't dark
    parts.push(-cx, 0, -cz, cx, 0, cz, cx, 0.42, cz, -cx, 0.42, -cz);
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // blades lit from above, whatever way the card faces
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((parts.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

const hash = (i: number, j: number, k: number) => {
  const h = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

export class Tufts {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private cache = new Map<number, Float32Array | null>();
  private at = new THREE.Vector2(1e9, 1e9);
  private radius: number;

  constructor(lowEnd: boolean) {
    this.radius = lowEnd ? 22 : 34;
    const n = Math.ceil(Math.PI * (34 / CELL + 1) ** 2);
    const mat = new THREE.MeshStandardMaterial({ map: tuftTexture(), alphaTest: 0.5, roughness: 1 });
    this.meshes = [0, 1].map((v) => {
      const m = new THREE.InstancedMesh(tuftGeometry(v), mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      return m;
    });
    this.group.add(...this.meshes);
    this.group.name = 'tufts';
  }

  /** fewer tufts on low graphics */
  setLow(low: boolean) {
    const r = low ? 22 : 34;
    if (r !== this.radius) { this.radius = r; this.at.set(1e9, 1e9); }
  }

  /** a tuft in this cell, or null: x, z, yaw, scale, variant, tint */
  private cell(i: number, j: number) {
    const key = i * 100003 + j;
    let c = this.cache.get(key);
    if (c !== undefined) return c;
    c = null;
    if (hash(i, j, 1) < 0.62) {
      const x = (i + 0.15 + hash(i, j, 2) * 0.7) * CELL, z = (j + 0.15 + hash(i, j, 3) * 0.7) * CELL;
      if (roadClearance(x, z, 5, -1, true) > 1.4 && !buildingAt(x, z, 0.6)) {
        c = Float32Array.of(x, z, hash(i, j, 4) * 6.28, 0.7 + hash(i, j, 5) * 0.8, hash(i, j, 6) < 0.18 ? 1 : 0, 0.75 + hash(i, j, 7) * 0.35);
      }
    }
    if (this.cache.size > 60000) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  /** call each frame with the camera; re-lays the tufts only after moving a few metres */
  update(x: number, z: number) {
    if (Math.hypot(x - this.at.x, z - this.at.y) < 4) return;
    this.at.set(x, z);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const R = this.radius, ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), rc = Math.ceil(R / CELL);
    const count = [0, 0];
    for (let i = ci - rc; i <= ci + rc; i++) for (let j = cj - rc; j <= cj + rc; j++) {
      const c = this.cell(i, j);
      if (!c || (c[0] - x) ** 2 + (c[1] - z) ** 2 > R * R) continue;
      const mesh = this.meshes[c[4]];
      const n = count[c[4]];
      if (n >= mesh.instanceMatrix.count) continue;
      m4.compose(v.set(c[0], 0, c[1]), q.setFromAxisAngle(up, c[2]), s.set(c[3], c[3] * (0.8 + c[5] * 0.4), c[3]));
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, col.setRGB(c[5], c[5] * 0.98, c[5] * 0.85));
      count[c[4]]++;
    }
    this.meshes.forEach((m, k) => {
      m.count = count[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
}
