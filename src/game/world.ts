import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Route } from '../data/campus';
import { asphaltTexture, billboardTexture, concreteTexture, grassTexture, labelTexture, wallTexture } from './textures';

export const LANES = [-2.4, 0, 2.4];
export const ROAD_HALF = 3.8;
const MARGIN = 120; // scenery before the start and after the finish

const KIND_ACCENT: Record<string, string> = {
  hall: '#f5c518',
  academic: '#5ec8ff',
  landmark: '#ff7a59',
  gate: '#f5c518',
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

export function buildWorld(route: Route) {
  const group = new THREE.Group();
  const total = route.length + MARGIN * 2;
    const rand = rng(7);

  // Ground, road and kerbs are laid in 200 m tiles: one huge plane with a
  // very large texture repeat loses UV precision on some mobile GPUs.
  const TILE = 200;
  const tiles = Math.ceil(total / TILE);
  const tileZ = (k: number) => MARGIN - TILE / 2 - k * TILE;

  const grassTex = grassTexture();
  grassTex.repeat.set(60, TILE / 8);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 });
  const grassGeo = new THREE.PlaneGeometry(480, TILE).rotateX(-Math.PI / 2);

  const roadTex = asphaltTexture();
  roadTex.repeat.set(2, TILE / 8);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 });
  const roadGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, TILE).rotateX(-Math.PI / 2);

  for (let k = 0; k < tiles; k++) {
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.set(0, -0.02, tileZ(k));
    grass.receiveShadow = true;
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.position.set(0, 0, tileZ(k));
    road.receiveShadow = true;
    group.add(grass, road);
  }

  // edge lines and lane dashes
  const white = new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.8 });
  for (const x of [-ROAD_HALF + 0.2, ROAD_HALF - 0.2]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.14, total), white);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.005, MARGIN - total / 2);
    group.add(line);
  }
  const dashCount = Math.floor(total / 9);
  const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 3).rotateX(-Math.PI / 2), white, dashCount * 2);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const x of [-1.2, 1.2]) {
    for (let k = 0; k < dashCount; k++) {
      m.makeTranslation(x, 0.005, MARGIN - k * 9);
      dashes.setMatrixAt(i++, m);
    }
  }
  group.add(dashes);

  // kerbs / sidewalks
  const conc = concreteTexture();
  conc.repeat.set(1, TILE / 2);
  const walkMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.95 });
  const walkGeo = new THREE.BoxGeometry(2, 0.14, TILE);
  for (let k = 0; k < tiles; k++) {
    for (const s of [-1, 1]) {
      const walk = new THREE.Mesh(walkGeo, walkMat);
      walk.position.set(s * (ROAD_HALF + 1), 0.07, tileZ(k));
      walk.receiveShadow = true;
      group.add(walk);
    }
  }

  // keep trees and filler buildings out of landmark plots
  const occupied = (side: number, z: number, pad = 6) =>
    route.landmarks.some((l) => l.side === side && l.kind !== 'gate' && Math.abs(-l.at - z) < l.size[0] / 2 + pad);

  // trees: broadleaf and palms, instanced
  const broad: THREE.Matrix4[] = [];
  const palms: THREE.Matrix4[] = [];
  for (let z = MARGIN; z > -route.length - MARGIN; z -= 11) {
    for (const s of [-1, 1]) {
      const zz = z + (rand() - 0.5) * 6;
      if (occupied(s, zz)) continue;
      const x = s * (ROAD_HALF + 4 + rand() * 6);
      const sc = 0.8 + rand() * 0.6;
      const mtx = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, zz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
        new THREE.Vector3(sc, sc, sc),
      );
      (rand() < 0.35 ? palms : broad).push(mtx);
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

  // street lamps
  const lamps: THREE.Matrix4[] = [];
  for (let z = MARGIN; z > -route.length - MARGIN; z -= 36) {
    for (const s of [-1, 1]) {
      lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(s * (ROAD_HALF + 1.6), 0, z + (s > 0 ? 18 : 0)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? Math.PI : 0), new THREE.Vector3(1, 1, 1)));
    }
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#4a4f57', metalness: 0.6, roughness: 0.4 });
  addInstanced(new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), lampMat, lamps);
  addInstanced(new THREE.BoxGeometry(0.9, 0.12, 0.25).translate(0.45, 6, 0), lampMat, lamps);

  // filler campus buildings: white walls, terracotta roofs
  const wallTex = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#a8482c', roughness: 0.85 });
  for (let z = MARGIN - 30; z > -route.length - MARGIN; z -= 45 + rand() * 40) {
    for (const s of [-1, 1]) {
      if (rand() < 0.35) continue;
      const w = 18 + rand() * 22;
      const h = 6 + Math.floor(rand() * 3) * 3.5;
      const d = 10 + rand() * 10;
      if (occupied(s, z, w / 2 + 4)) continue;
      const b = campusBlock(w, h, d, wallMat, roofMat);
      b.position.set(s * (ROAD_HALF + 18 + rand() * 14 + d / 2), 0, z);
      group.add(b);
    }
  }

  // landmarks: boxes with labels until real models exist
  for (const l of route.landmarks) {
    if (l.kind === 'gate') {
      group.add(gate(l.name, -l.at));
      continue;
    }
    const [w, h, d] = l.size;
    const block = campusBlock(w, h, d, wallMat, roofMat, l.kind === 'landmark' ? '#c8a24a' : undefined);
    const setback = l.setback ?? ROAD_HALF + 14;
    block.position.set(l.side * (setback + d / 2), 0, -l.at);
    group.add(block);
    const { tex, aspect } = labelTexture(l.name.toUpperCase(), KIND_ACCENT[l.kind]);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: true }));
    const lh = 2.6;
    label.scale.set(lh * aspect, lh, 1);
    label.position.set(l.side * (setback - 1), h + 2.4, -l.at);
    group.add(label);
  }

  // in-world billboards (future ad slots)
  const bbTex = billboardTexture();
  for (let at = 600; at < route.length - 100; at += 700) {
    const s = at % 1400 === 600 ? 1 : -1;
    group.add(billboard(bbTex, s, -at));
  }

  // finish arch
  group.add(gate('FINISH', -route.length, true));

  return group;
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

function gate(text: string, z: number, finish = false) {
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
  g.position.z = z;
  return g;
}

function billboard(tex: THREE.Texture, side: number, z: number) {
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
  g.rotation.y = side > 0 ? -0.5 : 0.5;
  g.position.set(side * (ROAD_HALF + 8), 0, z);
  return g;
}
