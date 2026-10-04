// Recognisable shapes for a few campus landmarks, placed at their real spots.
// First drafts from descriptions; they get refined once there are photos.
import * as THREE from 'three';
import { placeByName, roadAt } from './campusmap';
import { labelTexture } from './textures';

const white = new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.85 });
const cream = new THREE.MeshStandardMaterial({ color: '#e3d6bd', roughness: 0.9 });
const tile = new THREE.MeshStandardMaterial({ color: '#9c4a2c', roughness: 0.8 });
const dark = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.7 });

function clockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f7f3e8';
  x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#1d2333'; x.lineWidth = 6; x.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    x.fillStyle = '#1d2333';
    x.fillRect(64 + Math.sin(a) * 46 - 3, 64 - Math.cos(a) * 46 - 3, 6, 6);
  }
  x.lineCap = 'round';
  x.lineWidth = 7; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + 24, 64 - 14); x.stroke();
  x.lineWidth = 5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 - 4, 64 - 42); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, y = h / 2) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = y;
  m.castShadow = m.receiveShadow = true;
  return m;
};
const at = (m: THREE.Object3D, x: number, y: number, z: number) => {
  m.position.set(x, y, z);
  return m;
};
/** a four-sided hipped roof */
const hip = (w: number, h: number, y: number) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(w * 0.72, h, 4), tile);
  m.rotation.y = Math.PI / 4;
  m.position.y = y + h / 2;
  m.castShadow = true;
  return m;
};
const clocks = (g: THREE.Group, size: number, half: number, y: number, tex: THREE.Texture) => {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(size, 24), mat);
    const a = (k * Math.PI) / 2;
    f.position.set(Math.sin(a) * (half + 0.03), y, Math.cos(a) * (half + 0.03));
    f.rotation.y = a;
    g.add(f);
  }
};

/** Balme Library, from DELA's photos: stepped hip roofs rising to a slim clock tower and a red spire. */
function balmeTower(tex: THREE.Texture) {
  const g = new THREE.Group();
  g.add(box(14, 9, 12, white));
  g.add(hip(17, 3.2, 9));
  g.add(box(8, 3.5, 8, white, 12 + 1.75 - 0.5));
  g.add(hip(10, 2.4, 14.6));
  g.add(box(3, 6, 3, white, 19.5));
  clocks(g, 1.15, 1.5, 19.8, tex);
  g.add(hip(4.2, 1.4, 22.5));
  g.add(box(1.6, 1.8, 1.6, white, 24.6));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3, 8), new THREE.MeshStandardMaterial({ color: '#b3262b', roughness: 0.6 }));
  spire.position.y = 27;
  g.add(spire);
  return g;
}

/** Great Hall, from DELA's photo: a very tall, slim white tower with a clock near the top. */
function greatHallTower(tex: THREE.Texture) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 38, 12), white);
  shaft.position.y = 19;
  shaft.castShadow = true;
  g.add(shaft);
  // vertical window slits
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const slit = at(box(0.5, 20, 0.2, dark), Math.sin(a) * 2.75, 18, Math.cos(a) * 2.75);
    slit.rotation.y = a;
    g.add(slit);
  }
  clocks(g, 1.6, 2.65, 34, tex);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 2.4, 12), new THREE.MeshStandardMaterial({ color: '#8a3b22', roughness: 0.7 }));
  cap.position.y = 39.2;
  g.add(cap);
  return g;
}

/** Main entrance: two pillars and a sign across the road. */
function mainGate(span: number) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const pillar = box(2.2, 9, 2.2, white);
    pillar.position.x = s * (span / 2 + 1.1);
    g.add(pillar);
    const cap = box(2.8, 0.6, 2.8, tile, 9.3);
    cap.position.x = s * (span / 2 + 1.1);
    g.add(cap);
  }
  const beam = box(span + 4.4, 1.8, 1.2, white, 8.1);
  g.add(beam);
  const { tex, aspect } = labelTexture('UNIVERSITY OF GHANA', '#f5c518');
  const signH = 1.5;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(span + 2, signH * aspect), signH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  sign.position.set(0, 8.1, 0.62);
  g.add(sign);
  const back = sign.clone();
  back.position.z = -0.62;
  back.rotation.y = Math.PI;
  g.add(back);
  return g;
}

/** Night Market: rows of stalls under bright canopies. */
function nightMarket() {
  const g = new THREE.Group();
  const colors = ['#e53935', '#f5c518', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];
  const canopy = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide }));
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 6; i++) {
      const stall = new THREE.Group();
      stall.add(box(3, 1.1, 1.6, cream));
      const top = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), canopy[(i + row * 3) % canopy.length]);
      top.rotation.x = -Math.PI / 2 + 0.25;
      top.position.y = 2.7;
      stall.add(top);
      for (const s of [-1, 1]) stall.add(at(box(0.12, 2.7, 0.12, dark), s * 1.6, 1.35, 1));
      stall.position.set((i - 2.5) * 4.2, 0, row * 7 - 3.5);
      stall.rotation.y = row ? Math.PI : 0;
      g.add(stall);
    }
  return g;
}

export function buildLandmarks() {
  const group = new THREE.Group();
  const tex = clockTexture();
  const put = (name: string, obj: THREE.Object3D, onRoad = false, dx = 0, dz = 0) => {
    const p = placeByName(name);
    if (!p) return;
    if (onRoad) {
      const r = roadAt(p.x, p.z);
      if (!r) return;
      obj.position.set(r.x, 0, r.z);
      obj.rotation.y = r.angle;
    } else obj.position.set(p.x + dx, 0, p.z + dz);
    group.add(obj);
  };
  put('The Balme Library', balmeTower(tex));
  put('Great Hall', greatHallTower(tex));
  put('Legon Main Entrance', mainGate(16), true);
  put('Night Market', nightMarket());
  return group;
}
