// Recognisable shapes for a few campus landmarks, placed at their real spots.
// First drafts from descriptions; they get refined once there are photos.
import * as THREE from 'three';
import { placeByName, roadAt } from './campusmap';
import { labelTexture } from './textures';
import { facadeBox, hipRoof } from './facades';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { nightHooks } from './life';

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

/** many small coloured parts merged into one mesh (one draw call) */
const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
function detail(parts: [THREE.BufferGeometry, string][]) {
  const geos = parts.map(([g, c]) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    const col = new THREE.Color(c);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = col.r; arr[i + 1] = col.g; arr[i + 2] = col.b; }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return n;
  });
  const m = new THREE.Mesh(mergeGeometries(geos), detailMat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
const B = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** lamp globes and lit clock faces glow after dark */
const nightGlow = new THREE.MeshStandardMaterial({ color: '#f4efe0', emissive: '#ffd98a', emissiveIntensity: 0, roughness: 0.4 });
nightHooks.push((on) => { nightGlow.emissiveIntensity = on ? 2.2 : 0; });

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
/** a tiled hipped roof with eaves and overhang, covering about w x w, rising h from y */
const tiledHip = (w: number, h: number, y: number) => hipRoof(w - 1.2, w - 1.2, y, '#ad4f2d', 0.6, h / (w / 2));
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
  g.add(facadeBox(14, 9, 12, '#f6f1e6'));
  g.add(tiledHip(17, 3.2, 9));
  g.add(at(facadeBox(8, 3.5, 8, '#f6f1e6', 2.7), 0, 11.5, 0));
  g.add(tiledHip(10, 2.4, 14.6));
  g.add(box(3, 6, 3, white, 19.5));
  clocks(g, 1.15, 1.5, 19.8, tex);
  g.add(hip(4.2, 1.4, 22.5));
  g.add(box(1.6, 1.8, 1.6, white, 24.6));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3, 8), new THREE.MeshStandardMaterial({ color: '#b3262b', roughness: 0.6 }));
  spire.position.y = 27;
  g.add(spire);
  return g;
}

/**
 * Great Hall, from DELA's photo: a very tall, slim white tower with a clock near the top.
 * Detail added without photos: a stepped podium, string courses, an open belfry under
 * the cap, and a finial with the national flag.
 */
function greatHallTower(tex: THREE.Texture) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 38, 16), white);
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
  const parts: [THREE.BufferGeometry, string][] = [
    // stepped podium and a plinth
    [B(9, 0.5, 9, 0, 0.25, 0), '#d8d1c3'],
    [B(7.6, 0.5, 7.6, 0, 0.75, 0), '#e4ddd0'],
    [new THREE.CylinderGeometry(3.15, 3.15, 1.6, 16).translate(0, 1.8, 0), '#cfc6b6'],
    // doorway on the front
    [B(1.6, 2.8, 0.4, 0, 2.4, 2.85), '#3a2a20'],
    [B(2.2, 0.3, 0.5, 0, 3.95, 2.9), '#f6f2ea'],
    // fins flanking the slits
    ...[0, 1, 2, 3].flatMap((k) => {
      const a = (k * Math.PI) / 2;
      return [-0.55, 0.55].map((o) => [B(0.18, 21, 0.3, o, 18, 0).translate(0, 0, 2.78).rotateY(a), '#f7f4ee'] as [THREE.BufferGeometry, string]);
    }),
    // a cornice round the clock stage
    [new THREE.CylinderGeometry(2.95, 2.95, 0.35, 16).translate(0, 31.4, 0), '#f7f4ee'],
  ];
  // string courses up the shaft
  for (const y of [8, 15, 22, 29]) parts.push([new THREE.CylinderGeometry(2.9 - y * 0.007, 2.9 - y * 0.007, 0.22, 16).translate(0, y, 0), '#e2dbcd']);
  // open belfry: a dark core with eight piers round it, under the cap
  parts.push([new THREE.CylinderGeometry(1.9, 1.9, 2.4, 12).translate(0, 39.2, 0), '#1e1a18']);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push([B(0.5, 2.4, 0.5, Math.sin(a) * 2.35, 39.2, Math.cos(a) * 2.35), '#f4f0e8']);
  }
  parts.push([new THREE.CylinderGeometry(2.75, 2.75, 0.3, 16).translate(0, 38.05, 0), '#f7f4ee']);
  // finial and flagpole
  parts.push([new THREE.ConeGeometry(1.2, 2.2, 12).translate(0, 42.6, 0), '#8a3b22']);
  parts.push([new THREE.CylinderGeometry(0.05, 0.06, 5, 6).translate(0, 45.5, 0), '#d8d8d8']);
  for (const [y, c] of [[47.6, '#ce1126'], [47.2, '#fcd116'], [46.8, '#006b3f']] as [number, string][]) parts.push([B(0.02, 0.4, 1.6, 0.03, y, 0.82), c]);
  parts.push([B(0.03, 0.2, 0.2, 0.04, 47.2, 0.82), '#111111']);
  g.add(detail(parts));
  // the old cap sits on the belfry
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 1.2, 16), new THREE.MeshStandardMaterial({ color: '#8a3b22', roughness: 0.7 }));
  cap.position.y = 41;
  g.add(cap);
  return g;
}

/**
 * Main entrance: two big rendered pillars with recessed panels and lamps, a beam
 * with the university's name and motto, a crest disc, guard booths and boom barriers.
 */
function mainGate(span: number) {
  const g = new THREE.Group();
  const px = span / 2 + 1.1;
  const parts: [THREE.BufferGeometry, string][] = [];
  for (const s of [-1, 1]) {
    const x = s * px;
    parts.push(
      [B(2.2, 9, 2.2, x, 4.5, 0), '#f3eee4'],
      [B(2.7, 0.9, 2.7, x, 0.45, 0), '#8f8476'],
      [B(2.5, 0.25, 2.5, x, 1.0, 0), '#d9d0c0'],
      [B(2.8, 0.6, 2.8, x, 9.3, 0), '#a24b2e'],
      [B(2.5, 0.25, 2.5, x, 8.85, 0), '#e6dfd2'],
      // recessed panels on the faces
      [B(1.3, 5.2, 0.06, x, 4.6, 1.11), '#ded6c8'], [B(1.3, 5.2, 0.06, x, 4.6, -1.11), '#ded6c8'],
      [B(0.06, 5.2, 1.3, x + 1.11 * s, 4.6, 0), '#ded6c8'],
      // planter at the foot with flowers
      [B(1.0, 0.6, 3.2, x + 1.9 * s, 0.3, 0), '#e8e2d4'],
      [B(0.8, 0.12, 3.0, x + 1.9 * s, 0.62, 0), '#4b3527'],
      ...[-1.1, -0.4, 0.3, 1.0].map((z, i) => [B(0.5, 0.35, 0.5, x + 1.9 * s, 0.8, z), ['#d81b60', '#f5c518', '#e53935', '#ff7043'][i]] as [THREE.BufferGeometry, string]),
      // lamp posts on top of the pillars
      [new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6).translate(x, 10.2, 0), '#2b2f3a'],
    );
    // guard booth outside each pillar, and a boom barrier across each lane
    const bx = x + 5 * s;
    parts.push(
      [B(2.4, 2.6, 2.4, bx, 1.3, 2.5), '#f1ece2'],
      [B(1.8, 0.9, 0.04, bx, 1.7, 3.71), '#22303c'], [B(1.8, 0.9, 0.04, bx, 1.7, 1.29), '#22303c'],
      [B(3.0, 0.2, 3.0, bx, 2.7, 2.5), '#a24b2e'],
      [B(0.4, 1.0, 0.4, x - 1.6 * s, 0.5, 2.2), '#c8c8c8'],
    );
    const arm = span / 2 - 1.8;
    for (let i = 0; i < 8; i++) {
      const len = arm / 8;
      parts.push([B(len, 0.12, 0.12, x - 1.6 * s - s * (i + 0.5) * len, 1.05, 2.2), i % 2 ? '#ffffff' : '#d32f2f']);
    }
  }
  // the beam, its cornice and a pediment with the crest
  parts.push(
    [B(span + 4.4, 1.8, 1.2, 0, 8.1, 0), '#f3eee4'],
    [B(span + 4.8, 0.25, 1.5, 0, 9.1, 0), '#e6dfd2'],
    [B(span + 4.6, 0.2, 1.4, 0, 7.15, 0), '#e6dfd2'],
    [B(4.4, 1.3, 1.0, 0, 9.85, 0), '#f3eee4'],
    [B(4.8, 0.2, 1.2, 0, 10.55, 0), '#a24b2e'],
  );
  for (const z of [0.51, -0.51]) {
    parts.push(
      [new THREE.CylinderGeometry(0.62, 0.62, 0.06, 20).rotateX(Math.PI / 2).translate(0, 9.85, z), '#c9a227'],
      [new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20).rotateX(Math.PI / 2).translate(0, 9.85, z), '#1f3a93'],
      [B(0.36, 0.42, 0.1, 0, 9.88, z), '#f5f0e0'],
    );
  }
  g.add(detail(parts));
  for (const s of [-1, 1]) {
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), nightGlow);
    globe.position.set(s * px, 11.1, 0);
    g.add(globe);
  }
  const { tex, aspect } = labelTexture('UNIVERSITY OF GHANA', '#f5c518');
  const signH = 1.4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(span + 2, signH * aspect), signH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  sign.position.set(0, 8.1, 0.62);
  g.add(sign);
  const back = sign.clone();
  back.position.z = -0.62;
  back.rotation.y = Math.PI;
  g.add(back);
  const motto = labelTexture('INTEGRI PROCEDAMUS', '#1f3a93');
  const mh = 0.5;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(mh * motto.aspect, mh), new THREE.MeshBasicMaterial({ map: motto.tex, transparent: true, side: THREE.DoubleSide }));
  plate.position.set(0, 6.75, 0.5);
  g.add(plate);
  return g;
}

/** Night Market, after the 2024 refurbishment: about 80 shops in rows under long roofs, and an eating area. */
function nightMarket() {
  const g = new THREE.Group();
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.6, side: THREE.DoubleSide });
  const shopColors = ['#e53935', '#f5c518', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  // four rows of ten shops, back to back in pairs, with a walkway between the pairs
  for (let row = 0; row < 4; row++) {
    const z = (row - 1.5) * 7 + (row % 2 ? -1.6 : 1.6);
    for (let i = 0; i < 10; i++) {
      const shop = box(3.6, 3, 3, cream);
      shop.position.set((i - 4.5) * 3.8, 1.5, z);
      g.add(shop);
      const front = box(3.2, 0.5, 0.1, shopColors[(i + row) % shopColors.length], 2.6);
      front.position.set((i - 4.5) * 3.8, 2.6, z + (row % 2 ? -1.55 : 1.55));
      g.add(front);
    }
    if (row % 2) {
      // one long roof over each back-to-back pair
      const roof = new THREE.Mesh(new THREE.BoxGeometry(40, 0.25, 9.5), roofMat);
      roof.position.set(0, 3.4, z + 1.6);
      roof.castShadow = true;
      g.add(roof);
    }
  }
  // eating area: tables and benches under a canopy
  const area = new THREE.Group();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      area.add(at(box(1.8, 0.75, 0.9, dark), (i - 1.5) * 3.2, 0.375, (j - 1) * 2.6));
      for (const s of [-1, 1]) area.add(at(box(1.8, 0.45, 0.35, cream), (i - 1.5) * 3.2, 0.225, (j - 1) * 2.6 + s * 0.8));
    }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(14, 0.2, 9), roofMat);
  canopy.position.y = 3.6;
  area.add(canopy);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) area.add(at(box(0.2, 3.6, 0.2, dark), sx * 6.8, 1.8, sz * 4.3));
  area.position.set(0, 0, -21);
  g.add(area);
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
