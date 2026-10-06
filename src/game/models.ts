import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { helmetTexture } from './textures';

const std = (color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = true;
  });
  return o;
}

export interface RiderRig {
  root: THREE.Group;
  /** leans and tumbles; child of root */
  body: THREE.Group;
  wheels: THREE.Object3D[];
  crank: THREE.Object3D;
  legs: [THREE.Object3D, THREE.Object3D];
  setJersey(color: string): void;
  /** paints the whole frame one colour */
  setBikeColor(color: string): void;
  setLook(look: RiderLook): void;
  /** the garage's customisation: colours, finish, frame, wheels, bars, decal, lights and accessories */
  setBikeStyle(style: BikeStyle): void;
  /** hide the rider to show the bike on its own */
  showRider(on: boolean): void;
}

export type BikeFinish = 'gloss' | 'matte' | 'metallic' | 'carbon' | 'chrome' | 'neon';
/** How a bike looks (see the Garage's Customize screen). Colours are hex. */
export interface BikeStyle {
  primary: string;
  secondary: string;
  accent: string;
  finish: BikeFinish;
  frame: 'diamond' | 'step' | 'mtb';
  wheel: 'spoke' | 'deep' | 'disc' | 'fat';
  tyre: string;
  bars: 'flat' | 'drop' | 'riser';
  grips: 'dark' | 'accent';
  seat: 'race' | 'comfy';
  pedals: 'dark' | 'accent';
  /** a printed pattern on the frame tubes; colour defaults to the accent */
  decal: { pattern: string; color?: string; text?: string } | null;
  /** lamp colour, '' for none; glow adds a light strip under the frame */
  light: string;
  glow: boolean;
  basket: boolean;
  rack: boolean;
  bottle: boolean;
}

/** paint finishes: how shiny, how metallic, carbon weave or a neon glow */
let carbonTex: THREE.CanvasTexture | null = null;
function finishMaterial(m: THREE.MeshStandardMaterial, f: BikeFinish) {
  const set: Record<BikeFinish, [number, number]> = { gloss: [0.32, 0.55], matte: [0.85, 0.08], metallic: [0.22, 0.9], carbon: [0.38, 0.35], chrome: [0.06, 1], neon: [0.4, 0.1] };
  const [rough, metal] = set[f] ?? set.gloss;
  m.roughness = rough;
  m.metalness = metal;
  m.emissive.set(f === 'neon' ? m.color : '#000000');
  m.emissiveIntensity = f === 'neon' ? 0.55 : 1;
  const map = f === 'carbon' ? (carbonTex ??= weave()) : null;
  if (m.map !== map) {
    m.map = map;
    m.needsUpdate = true;
  }
}
function weave() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#5a5a5a';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 8, y * 8, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 12);
  return t;
}

/** A decal printed round a tube: the canvas runs across (u) and along (v) the tube. */
function decalTexture(pattern: string, color: string, base: string, text?: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  const along = (fn: () => void) => {
    // draw in "along the tube" space: x runs down the tube, y round it
    g.save();
    g.translate(128, 0);
    g.rotate(Math.PI / 2);
    fn();
    g.restore();
  };
  const word = (t: string, size = 54) => along(() => {
    g.font = `800 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(t, 256, 64, 480);
  });
  g.fillStyle = color;
  if (pattern === 'stripe') { g.fillRect(0, 0, 128, 512); g.fillStyle = base; g.fillRect(0, 60, 128, 120); g.fillRect(0, 330, 128, 120); }
  else if (pattern === 'speed') for (let i = -4; i < 16; i++) { g.beginPath(); g.moveTo(0, i * 40); g.lineTo(128, i * 40 + 90); g.lineTo(128, i * 40 + 104); g.lineTo(0, i * 40 + 14); g.fill(); }
  else if (pattern === 'checker') for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { if ((x + y) % 2) g.fillRect(x * 32, y * 32, 32, 32); }
  else if (pattern === 'kente') {
    const bands = ['#f2b705', '#0f7b3a', '#c8102e', '#111111'];
    for (let i = 0; i < 16; i++) { g.fillStyle = bands[i % 4]; g.fillRect(0, i * 32, 128, 32); g.fillStyle = i % 2 ? '#f2b705' : '#111111'; g.fillRect(16 + (i % 2) * 48, i * 32 + 8, 32, 16); }
  } else if (pattern === 'flames') for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, 512 - i * 60); g.quadraticCurveTo(64, 420 - i * 60, 128, 512 - i * 60 - 140); g.lineTo(128, 512); g.lineTo(0, 512); g.globalAlpha = 0.35 + i * 0.1; g.fill(); }
  else if (pattern === 'sunset') { const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#ffcf4a'); gr.addColorStop(0.5, '#ff7a3d'); gr.addColorStop(1, '#c2366b'); g.fillStyle = gr; g.fillRect(0, 0, 128, 512); }
  else if (pattern === 'dots') for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, 7, 0, Math.PI * 2); g.fill(); }
  else if (pattern === 'map') { g.lineWidth = 6; g.strokeStyle = color; g.setLineDash([18, 14]); g.beginPath(); g.moveTo(64, 0); for (let y = 0; y <= 512; y += 64) g.lineTo(y % 128 ? 20 : 108, y); g.stroke(); g.setLineDash([]); g.lineWidth = 10; g.beginPath(); g.moveTo(40, 420); g.lineTo(88, 470); g.moveTo(88, 420); g.lineTo(40, 470); g.stroke(); }
  else if (pattern === 'hall') { g.fillRect(0, 0, 128, 70); g.fillRect(0, 442, 128, 70); word(text ?? '', 64); }
  else word(text ?? 'LEGONRUSH');
  if (text && pattern !== 'hall' && pattern !== 'word') { g.clearRect(0, 196, 128, 120); word(text, 46); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // printed twice round the tube, so it reads from either side
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

const Y = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A cylinder (or capsule) geometry stretched between two points. */
function tubeGeo(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, capsule = false, r2 = r) {
  const len = a.distanceTo(b);
  const g = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, seg) : new THREE.CylinderGeometry(r2, r, len, seg);
  const m = new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}
/** Geometry moved, turned (Euler xyz) and scaled. */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return g.applyMatrix4(new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v3(sx, sy, sz)));
}
/** Merges geometries (all made indexed first so built-ins mix). */
function merge(parts: THREE.BufferGeometry[]) {
  const ready = parts.map((g) => {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(ready)!;
}
/** A mesh from a capsule between two points, as its own object so it can be scaled for body types. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, extra?: (len: number) => THREE.BufferGeometry[]) {
  const len = a.distanceTo(b);
  let g: THREE.BufferGeometry = new THREE.CapsuleGeometry(r, len, 4, 10);
  if (extra) g = merge([g, ...extra(len)]);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
  return m;
}

let ventTex: THREE.Texture | null = null;

export function buildRider(jersey: string, bikeColor: string): RiderRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---------- bike (faces -z) ----------
  // primary paints the main triangle, secondary the fork and rear stays, accent the rims, grips and chain
  const frameMat = std(bikeColor, { metalness: 0.55, roughness: 0.32 });
  const stayMat = std(bikeColor, { metalness: 0.55, roughness: 0.32 });
  const accentMat = std('#c9ccd2', { metalness: 0.85, roughness: 0.28 });
  const dark = std('#17191d', { roughness: 0.55 });
  const rubber = std('#141518', { roughness: 0.92 });
  const metal = std('#c9ccd2', { metalness: 0.85, roughness: 0.28 });
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(g, mat);
    parent.add(m);
    return m;
  };

  const wheelR = 0.34;
  const hubY = wheelR + 0.03;
  // one wheel geometry shared by both: tyre, rim and hub in the accent colour, spokes in metal
  const tyreGeo = new THREE.TorusGeometry(wheelR, 0.03, 8, 36).rotateY(Math.PI / 2);
  const rimRingGeo = merge([
    new THREE.TorusGeometry(wheelR - 0.032, 0.013, 5, 36).rotateY(Math.PI / 2),
    new THREE.CylinderGeometry(0.028, 0.028, 0.11, 10).rotateZ(Math.PI / 2),
  ]);
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const side = i % 2 ? 0.035 : -0.035;
    spokes.push(tubeGeo(v3(side, 0, 0), v3(0, Math.sin(a) * (wheelR - 0.04), Math.cos(a) * (wheelR - 0.04)), 0.0035, 3));
  }
  const spokeGeo = merge(spokes);
  const wheels: THREE.Object3D[] = [];
  const tyres: THREE.Mesh[] = [];
  const spokeMeshes: THREE.Mesh[] = [];
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Group();
    tyres.push(add(tyreGeo, rubber, w));
    add(rimRingGeo, accentMat, w);
    spokeMeshes.push(add(spokeGeo, metal, w));
    w.position.set(0, hubY, z);
    body.add(w);
    wheels.push(w);
  }

  const bb = v3(0, 0.36, 0.05); // bottom bracket
  const seatTop = v3(0, 0.84, 0.2);
  const headTop = v3(0, 0.89, -0.41);
  const headLow = v3(0, 0.71, -0.45);
  const rearHub = (s: number) => v3(s * 0.065, hubY, 0.55);
  const frontHub = (s: number) => v3(s * 0.055, hubY, -0.55);
  // the main triangle in three styles: diamond (road), step-through (cruiser) and a chunkier sloping MTB frame
  const frameGeos = new Map<string, THREE.BufferGeometry>();
  const frameGeo = (kind: string) => {
    let g = frameGeos.get(kind);
    if (g) return g;
    const t = kind === 'mtb' ? 1.35 : 1;
    const top = kind === 'step'
      ? [tubeGeo(headTop.clone().add(v3(0, -0.06, 0.01)), v3(0, 0.5, 0.02), 0.026, 10), tubeGeo(v3(0, 0.5, 0.02), v3(0, 0.56, 0.13), 0.022, 8)]
      : kind === 'mtb'
      ? [tubeGeo(seatTop.clone().add(v3(0, -0.1, -0.03)), headTop.clone().add(v3(0, -0.03, 0)), 0.026 * t, 10)]
      : [tubeGeo(seatTop, headTop.clone().add(v3(0, -0.03, 0)), 0.024, 10)];
    g = merge([
      ...top,
      tubeGeo(bb, headLow.clone().add(v3(0, 0.03, 0)), 0.032 * t, 10),
      tubeGeo(bb.clone().add(v3(0, -0.02, 0)), seatTop.clone().add(v3(0, 0.03, 0)), 0.024 * t, 10),
      tubeGeo(headLow.clone().add(v3(0, -0.03, -0.01)), headTop.clone().add(v3(0, 0.03, 0.01)), 0.034 * t, 12),
      new THREE.CylinderGeometry(0.04, 0.04, 0.085, 12).rotateZ(Math.PI / 2).translate(bb.x, bb.y, bb.z),
    ]);
    frameGeos.set(kind, g);
    return g;
  };
  const frameMesh = add(frameGeo('diamond'), frameMat);
  const stayGeos = new Map<string, THREE.BufferGeometry>();
  const stayGeo = (kind: string) => {
    let g = stayGeos.get(kind);
    if (g) return g;
    const t = kind === 'mtb' ? 1.5 : 1;
    g = merge([-1, 1].flatMap((s) => [
      tubeGeo(bb, rearHub(s), 0.013 * t, 6),
      tubeGeo(seatTop.clone().add(v3(s * 0.015, -0.02, 0)), rearHub(s), 0.011 * t, 6),
      // fork blades with a little rake (fat suspension legs on the MTB)
      tubeGeo(headLow.clone().add(v3(s * 0.035, -0.02, 0)), v3(s * 0.05, 0.47, -0.5), 0.016 * t, 6),
      tubeGeo(v3(s * 0.05, 0.47, -0.5), frontHub(s), 0.013 * (kind === 'mtb' ? 1.2 : 1), 6),
    ]));
    stayGeos.set(kind, g);
    return g;
  };
  const stayMesh = add(stayGeo('diamond'), stayMat);
  // seatpost, stem and cassette
  const stemTop = v3(0, 0.99, -0.44);
  add(
    merge([
      tubeGeo(seatTop, v3(0, 0.92, 0.215), 0.014, 8),
      tubeGeo(headTop, stemTop, 0.02, 8),
      tubeGeo(stemTop, v3(0, 0.995, -0.47), 0.018, 8),
      new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14).rotateZ(Math.PI / 2).translate(0.07, hubY, 0.55),
    ]),
    metal,
  );
  // handlebars in three shapes; grips (or bar tape) can take the accent colour
  const barY = 0.995, barZ = -0.47;
  const barShapes: Record<string, () => [THREE.BufferGeometry, THREE.BufferGeometry]> = {
    flat: () => [
      merge([
        new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8).rotateZ(Math.PI / 2).translate(0, barY, barZ),
        ...[-1, 1].map((s) => tubeGeo(v3(s * 0.17, barY, barZ - 0.01), v3(s * 0.22, barY - 0.01, barZ - 0.08), 0.006, 4)),
      ]),
      merge([-1, 1].map((s) => new THREE.CylinderGeometry(0.019, 0.019, 0.12, 10).rotateZ(Math.PI / 2).translate(s * 0.24, barY, barZ))),
    ],
    drop: () => {
      const p = (s: number) => [v3(s * 0.2, barY, barZ), v3(s * 0.21, barY - 0.01, barZ - 0.09), v3(s * 0.21, barY - 0.1, barZ - 0.1), v3(s * 0.21, barY - 0.12, barZ - 0.01)];
      return [
        merge([new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8).rotateZ(Math.PI / 2).translate(0, barY, barZ), ...[-1, 1].flatMap((s) => { const q = p(s); return [tubeGeo(q[0], q[1], 0.012, 6), tubeGeo(q[1], q[2], 0.012, 6), tubeGeo(q[2], q[3], 0.012, 6)]; })]),
        merge([-1, 1].flatMap((s) => { const q = p(s); return [tubeGeo(q[0].clone().lerp(q[1], 0.3), q[1], 0.017, 8), tubeGeo(q[2], q[3], 0.016, 8), new THREE.BoxGeometry(0.03, 0.05, 0.035).translate(s * 0.21, barY + 0.015, barZ - 0.09)]; })),
      ];
    },
    riser: () => {
      const end = (s: number) => v3(s * 0.33, barY + 0.06, barZ + 0.04);
      return [
        merge([-1, 1].flatMap((s) => [tubeGeo(v3(0, barY, barZ), v3(s * 0.1, barY, barZ), 0.013, 8), tubeGeo(v3(s * 0.1, barY, barZ), v3(s * 0.2, barY + 0.05, barZ + 0.02), 0.013, 8), tubeGeo(v3(s * 0.2, barY + 0.05, barZ + 0.02), end(s), 0.013, 8)])),
        merge([-1, 1].map((s) => tubeGeo(v3(s * 0.25, barY + 0.057, barZ + 0.028), end(s).add(v3(s * 0.03, 0, 0.003)), 0.02, 10))),
      ];
    },
  };
  const barGeos = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  const barGeo = (k: string) => {
    if (!barGeos.has(k)) barGeos.set(k, (barShapes[k] ?? barShapes.flat)());
    return barGeos.get(k)!;
  };
  const barMesh = add(barGeo('flat')[0], dark);
  const gripMesh = add(barGeo('flat')[1], dark);
  // saddle: a race saddle tapering to the nose, or a wide leather comfort saddle on springs
  const seatGeos = new Map<string, THREE.BufferGeometry>();
  const seatGeo = (k: string) => {
    let g = seatGeos.get(k);
    if (g) return g;
    g = k === 'comfy'
      ? merge([
          place(new THREE.SphereGeometry(1, 14, 8), 0, 0.94, 0.24, 0, 0, 0, 0.12, 0.04, 0.1),
          place(new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), 0, 0.945, 0.15, Math.PI / 2 + 0.06, 0, 0, 1.1, 1, 0.8),
          ...[-1, 1].map((s) => new THREE.TorusGeometry(0.012, 0.004, 4, 8).rotateY(Math.PI / 2).scale(1, 1.6, 1).translate(s * 0.05, 0.905, 0.29)),
        ])
      : merge([
          place(new THREE.SphereGeometry(1, 14, 8), 0, 0.93, 0.25, 0, 0, 0, 0.085, 0.028, 0.08),
          place(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), 0, 0.935, 0.17, Math.PI / 2 + 0.06, 0, 0, 1, 1, 0.75),
        ]);
    seatGeos.set(k, g);
    return g;
  };
  const seatMesh = add(seatGeo('race'), dark);
  const leather = std('#6b4428', { roughness: 0.6 });
  // chain runs, in a dark shade of the accent once styled
  const chainMat = std('#17191d', { roughness: 0.5, metalness: 0.4 });
  add(
    merge([
      tubeGeo(v3(0.07, bb.y + 0.1, bb.z), v3(0.07, hubY + 0.05, 0.55), 0.006, 4),
      tubeGeo(v3(0.07, bb.y - 0.1, bb.z), v3(0.07, hubY - 0.05, 0.55), 0.006, 4),
    ]),
    chainMat,
  );
  // a bottle on the down tube
  const bottle = add(
    merge([
      tubeGeo(v3(0, 0.5, -0.12), v3(0, 0.68, -0.3), 0.034, 10),
      tubeGeo(v3(0, 0.68, -0.3), v3(0, 0.71, -0.33), 0.014, 8),
    ]),
    std('#e8eef2', { roughness: 0.35 }),
  );
  bottle.position.set(0, 0.03, 0.02);

  const crank = new THREE.Group();
  crank.position.copy(bb);
  add(
    merge([
      // chainring on five spider arms
      new THREE.TorusGeometry(0.1, 0.009, 5, 32).rotateY(Math.PI / 2).translate(0.07, 0, 0),
      ...[0, 1, 2, 3, 4].map((k) => tubeGeo(v3(0.07, 0, 0), v3(0.07, Math.sin((k / 5) * Math.PI * 2) * 0.095, Math.cos((k / 5) * Math.PI * 2) * 0.095), 0.008, 4)),
      new THREE.BoxGeometry(0.02, 0.17, 0.032).translate(0.088, -0.085, 0),
      new THREE.BoxGeometry(0.02, 0.17, 0.032).translate(-0.088, 0.085, 0),
      new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6).rotateZ(Math.PI / 2),
    ]),
    metal,
    crank,
  );
  const pedalMesh = add(merge([new THREE.BoxGeometry(0.09, 0.022, 0.07).translate(0.14, -0.17, 0), new THREE.BoxGeometry(0.09, 0.022, 0.07).translate(-0.14, 0.17, 0)]), dark, crank);
  body.add(crank);

  // extras are made the first time a style asks for them, so rival riders never pay for them
  const extras: Record<string, THREE.Object3D> = {};
  const extra = (key: string, make: () => THREE.Object3D, parent: THREE.Object3D = body) => {
    if (!extras[key]) {
      extras[key] = shadowed(make());
      parent.add(extras[key]);
    }
    return extras[key];
  };
  let decalMat: THREE.MeshStandardMaterial | null = null;
  let decalKey = '';
  let lampMat: THREE.MeshStandardMaterial | null = null;
  let glowMat: THREE.MeshBasicMaterial | null = null;
  const fillMat = std('#c9ccd2', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide });
  const setBikeStyle = (s: BikeStyle) => {
    frameMat.color.set(s.primary);
    stayMat.color.set(s.secondary);
    accentMat.color.set(s.accent);
    fillMat.color.set(s.accent);
    chainMat.color.set(s.accent).multiplyScalar(0.45);
    for (const m of [frameMat, stayMat]) finishMaterial(m, s.finish);
    finishMaterial(accentMat, s.finish === 'matte' ? 'matte' : s.finish === 'chrome' ? 'chrome' : 'metallic');
    // frame shape
    frameMesh.geometry = frameGeo(s.frame);
    stayMesh.geometry = stayGeo(s.frame);
    // bars, grips, saddle and pedals
    const [bar, grip] = barGeo(s.bars);
    barMesh.geometry = bar;
    gripMesh.geometry = grip;
    gripMesh.material = s.grips === 'accent' ? accentMat : dark;
    seatMesh.geometry = seatGeo(s.seat);
    seatMesh.material = s.seat === 'comfy' ? leather : dark;
    pedalMesh.material = s.pedals === 'accent' ? accentMat : dark;
    // wheels: tyre colour and width, spokes, deep rims or discs
    rubber.color.set(s.tyre);
    const fat = s.wheel === 'fat';
    for (const t of tyres) t.scale.set(fat ? 1.8 : 1, fat ? 1.03 : 1, fat ? 1.03 : 1);
    for (const sp of spokeMeshes) sp.visible = s.wheel !== 'disc';
    wheels.forEach((w, i) => {
      extra('deep' + i, () => new THREE.Mesh(new THREE.RingGeometry(wheelR - 0.12, wheelR - 0.03, 36, 1).rotateY(Math.PI / 2), fillMat), w).visible = s.wheel === 'deep';
      extra('disc' + i, () => new THREE.Mesh(new THREE.CircleGeometry(wheelR - 0.03, 36).rotateY(Math.PI / 2), fillMat), w).visible = s.wheel === 'disc';
    });
    bottle.visible = s.bottle;
    // decal: a printed sleeve on the down tube and top tube
    decalMat ??= new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.4, metalness: 0.2, depthWrite: false });
    const dk = s.decal ? `${s.decal.pattern}|${s.decal.text ?? ''}|${s.decal.color ?? s.accent}|${s.primary}` : '';
    if (dk !== decalKey) {
      decalKey = dk;
      decalMat.map?.dispose();
      decalMat.map = s.decal ? decalTexture(s.decal.pattern, s.decal.color ?? s.accent, s.primary, s.decal.text) : null;
      decalMat.needsUpdate = true;
    }
    const sleeve = extra('decal', () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(tubeGeo(bb.clone().lerp(headLow, 0.2), bb.clone().lerp(headLow, 0.82), 0.0345, 14), decalMat!));
      g.add(new THREE.Mesh(tubeGeo(seatTop.clone().lerp(headTop, 0.18), seatTop.clone().lerp(headTop, 0.8), 0.0265, 12), decalMat!));
      g.traverse((c) => { c.castShadow = false; });
      return g;
    });
    // on the step-through and MTB frames only the down tube is where the classic one is
    sleeve.visible = !!s.decal;
    sleeve.children[1].visible = s.frame === 'diamond';
    sleeve.children[0].scale.setScalar(s.frame === 'mtb' ? 1.35 : 1);
    // lights: a front lamp and rear light, plus a glow under the frame for the coloured ones
    lampMat ??= new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.4, roughness: 0.2 });
    glowMat ??= new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    const lamp = extra('lamp', () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0.955, -0.5), dark));
      g.add(new THREE.Mesh(new THREE.CircleGeometry(0.024, 12).rotateY(Math.PI).translate(0, 0.955, -0.531), lampMat!));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.02).translate(0, 0.86, 0.235), std('#ff2a2a', { emissive: '#ff1a1a', emissiveIntensity: 1.2 })));
      return g;
    });
    lamp.visible = !!s.light;
    const glow = extra('glow', () => {
      const m = new THREE.Mesh(tubeGeo(bb.clone().lerp(headLow, 0.08).add(v3(0, -0.045, 0)), bb.clone().lerp(headLow, 0.9).add(v3(0, -0.04, 0)), 0.012, 6), glowMat!);
      m.castShadow = false;
      return m;
    });
    glow.visible = !!s.light && s.glow;
    if (s.light) glowMat.color.set(s.light);
    // a wicker basket on the front; a rack with a bag on the back
    const basket = extra('basket', () => {
      const w = 0.15, h = 0.16, d = 0.12, y0 = 0.86, z0 = -0.66;
      const c = (x: number, y: number, z: number) => v3(x, y0 + y, z0 + z);
      const rods: THREE.BufferGeometry[] = [];
      for (const y of [0, h * 0.5, h]) for (const [a, b] of [[c(-w, y, -d), c(w, y, -d)], [c(-w, y, d), c(w, y, d)], [c(-w, y, -d), c(-w, y, d)], [c(w, y, -d), c(w, y, d)]]) rods.push(tubeGeo(a, b, 0.005, 4));
      for (let i = 0; i <= 6; i++) {
        const x = -w + (i / 6) * 2 * w;
        rods.push(tubeGeo(c(x, 0, -d), c(x, h, -d), 0.004, 3), tubeGeo(c(x, 0, d), c(x, h, d), 0.004, 3));
      }
      rods.push(tubeGeo(c(0, 0, d), v3(0, 0.62, -0.49), 0.007, 4));
      const g = new THREE.Group();
      g.add(new THREE.Mesh(merge(rods), std('#b8864b', { roughness: 0.8 })));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.008, d * 2).translate(0, y0, z0), std('#8a6238', { roughness: 0.9 })));
      return g;
    });
    basket.visible = s.basket;
    const rack = extra('rack', () => {
      const g = new THREE.Group();
      const y = 0.74;
      g.add(new THREE.Mesh(merge([
        ...[-1, 1].flatMap((k) => [tubeGeo(v3(k * 0.07, y, 0.3), v3(k * 0.07, y, 0.78), 0.006, 4), tubeGeo(v3(k * 0.07, y, 0.72), rearHub(k), 0.006, 4)]),
        tubeGeo(v3(-0.07, y, 0.78), v3(0.07, y, 0.78), 0.006, 4),
        tubeGeo(v3(0, y, 0.3), seatTop.clone().lerp(bb, 0.15), 0.006, 4),
      ]), metal));
      g.add(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.13, 0.3, 2, 0.03).translate(0, y + 0.07, 0.55), stayMat));
      return g;
    });
    rack.visible = s.rack;
  };
  const bikeParts = new Set(body.children);

  // ---------- rider ----------
  const jerseyMat = std(jersey, { roughness: 0.6 });
  const skin = std('#7a4b2e', { roughness: 0.55 });
  const shorts = std('#1c2433', { roughness: 0.65 });
  if (!ventTex) {
    ventTex = helmetTexture();
  }
  const helmetMat = std('#f5c518', { roughness: 0.3, metalness: 0.15, map: ventTex });
  const hairMat = std('#15100d', { roughness: 0.95 });
  const trim = std('#ffffff', { roughness: 0.6 });
  const gear = std('#20242c', { roughness: 0.6 });
  const gearLight = std('#3a4250', { roughness: 0.6 });
  const strap = std('#111318', { roughness: 0.7 });

  // the upper body sits in a frame along the spine: local y up the back, +z out of the back
  const upper = new THREE.Group();
  body.add(upper);
  const hipTop = v3(0, 1.03, 0.15), neckBase = v3(0, 1.45, -0.17);
  const spine = neckBase.clone().sub(hipTop);
  const chest = new THREE.Group();
  chest.position.copy(hipTop).lerp(neckBase, 0.5);
  chest.quaternion.setFromUnitVectors(Y, spine.clone().normalize());
  upper.add(chest);
  const torsoBase = v3(1.18, 1, 0.82);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, spine.length() - 0.2, 6, 14), jerseyMat);
  torso.scale.copy(torsoBase);
  chest.add(torso);
  // shoulders rounded into the jersey
  const shoulderY = 0.17;
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.062, 12, 8).translate(s * 0.15, shoulderY, -0.01), jerseyMat, torso);
  // pelvis in shorts
  add(new THREE.CapsuleGeometry(0.105, 0.1, 4, 10).rotateZ(Math.PI / 2).translate(0, 1.0, 0.18), shorts);

  // a collar ring for the hall T-shirt, a hood for the hoodie
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 18).rotateX(Math.PI / 2), trim);
  collar.position.set(0, spine.length() / 2 - 0.04, -0.01);
  chest.add(collar);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), jerseyMat);
  hood.position.set(0, spine.length() / 2 - 0.06, 0.1);
  hood.rotation.x = 1.1;
  hood.scale.set(1.1, 0.8, 0.9);
  chest.add(hood);

  // head and neck in one skin mesh: skull, jaw, nose, ears
  const headPos = v3(0, 1.62, -0.31);
  const head = add(
    merge([
      place(new THREE.SphereGeometry(0.115, 18, 14), headPos.x, headPos.y, headPos.z, 0, 0, 0, 0.92, 1.06, 1.04),
      place(new THREE.SphereGeometry(0.08, 12, 8), headPos.x, headPos.y - 0.06, headPos.z - 0.04, 0, 0, 0, 0.95, 0.85, 1),
      place(new THREE.ConeGeometry(0.022, 0.05, 6), headPos.x, headPos.y - 0.01, headPos.z - 0.12, -Math.PI / 2 - 0.4, 0, 0),
      ...[-1, 1].map((s) => place(new THREE.SphereGeometry(0.028, 8, 6), headPos.x + s * 0.104, headPos.y - 0.005, headPos.z + 0.01, 0, 0, 0, 0.45, 1, 0.75)),
      tubeGeo(neckBase.clone().add(v3(0, -0.02, 0.03)), headPos.clone().add(v3(0, -0.07, 0.04)), 0.052, 10),
    ]),
    skin,
  );
  void head;

  // helmet: a vented shell that sweeps back to a point, with chin straps
  const helmet = new THREE.Group();
  body.add(helmet);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), helmetMat);
  shell.position.copy(headPos).add(v3(0, 0.012, 0.02));
  shell.rotation.x = 0.12;
  shell.scale.set(0.9, 0.9, 1.2);
  helmet.add(shell);
  helmet.add(
    new THREE.Mesh(
      merge(
        [-1, 1].flatMap((s) => [
          tubeGeo(headPos.clone().add(v3(s * 0.1, -0.01, -0.03)), headPos.clone().add(v3(s * 0.085, -0.075, 0.0)), 0.006, 4),
          tubeGeo(headPos.clone().add(v3(s * 0.1, -0.01, 0.06)), headPos.clone().add(v3(s * 0.085, -0.075, 0.0)), 0.006, 4),
          tubeGeo(headPos.clone().add(v3(s * 0.085, -0.075, 0.0)), headPos.clone().add(v3(0, -0.125, -0.06)), 0.007, 4),
        ]),
      ),
      strap,
    ),
  );

  // hair shows without a helmet; a puff of braids at the back marks the female rider
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), hairMat);
  hair.position.copy(headPos).add(v3(0, 0.012, 0.012));
  hair.scale.set(0.95, 1.02, 1.06);
  body.add(hair);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), hairMat);
  bun.position.copy(headPos).add(v3(0, 0.07, 0.14));
  body.add(bun);

  // wraparound sunglasses: a curved mirror lens, a thin brow bar and arms to the ears
  const shades = new THREE.Group();
  body.add(shades);
  // mirrored lens: dark, with a blue-violet sheen that catches the sky
  const lensMat = new THREE.MeshStandardMaterial({ color: '#22324f', metalness: 0.95, roughness: 0.05, emissive: '#35508f', emissiveIntensity: 0.35 });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.124, 0.116, 0.05, 18, 1, true, Math.PI - 1.05, 2.1), lensMat);
  lens.position.copy(headPos).add(v3(0, 0.02, 0.0));
  lens.scale.set(0.98, 1, 1.02);
  shades.add(lens);
  shades.add(
    new THREE.Mesh(
      merge([
        new THREE.CylinderGeometry(0.126, 0.126, 0.01, 18, 1, true, Math.PI - 1.05, 2.1).translate(headPos.x, headPos.y + 0.048, headPos.z),
        ...[-1, 1].map((s) => tubeGeo(headPos.clone().add(v3(s * 0.104, 0.04, -0.06)), headPos.clone().add(v3(s * 0.112, 0.02, 0.06)), 0.005, 4)),
      ]),
      strap,
    ),
  );

  // backpack on the back, with a front pocket and shoulder straps
  const pack = new THREE.Group();
  chest.add(pack);
  const bz = 0.16 * torsoBase.z;
  pack.add(new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.38, 0.14, 2, 0.045).translate(0, 0.02, bz + 0.07), gear));
  pack.add(
    new THREE.Mesh(
      merge([
        new RoundedBoxGeometry(0.22, 0.15, 0.05, 2, 0.02).translate(0, -0.07, bz + 0.15),
        // zip lines and a grab loop
        new THREE.BoxGeometry(0.26, 0.008, 0.01).translate(0, 0.15, bz + 0.13),
        new THREE.TorusGeometry(0.03, 0.007, 4, 10).translate(0, 0.22, bz + 0.03),
      ]),
      gearLight,
    ),
  );
  pack.add(
    new THREE.Mesh(
      merge([
        ...[-1, 1].flatMap((s) => {
          const x = s * 0.085;
          const p = [v3(x, 0.17, bz + 0.02), v3(x * 1.1, 0.27, 0.02), v3(x * 1.15, 0.2, -bz - 0.02), v3(x, -0.02, -bz - 0.03)];
          return [tubeGeo(p[0], p[1], 0.013, 5), tubeGeo(p[1], p[2], 0.013, 5), tubeGeo(p[2], p[3], 0.013, 5)];
        }),
        // sternum strap
        tubeGeo(v3(-0.09, 0.09, -bz - 0.035), v3(0.09, 0.09, -bz - 0.035), 0.008, 4),
      ]),
      strap,
    ),
  );

  // arms bent at the elbow down to the grips
  const arms: THREE.Mesh[] = [];
  const shortSleeves: THREE.Mesh[] = [];
  const longSleeves: THREE.Mesh[] = [];
  const gloves: THREE.Mesh[] = [];
  const watch = new THREE.Group();
  body.add(watch);
  for (const s of [-1, 1]) {
    const S = v3(s * 0.19, 1.41, -0.15);
    const E = v3(s * 0.285, 1.17, -0.24);
    const H = v3(s * 0.25, 1.0, -0.47);
    const W = H.clone().lerp(E, 0.22);
    const upperArm = limb(S, E, 0.047, skin);
    // forearm with the hand round the grip at its end (local +y runs elbow to wrist)
    const fore = limb(E, W, 0.04, skin, (len) => [place(new THREE.SphereGeometry(1, 10, 8), 0, len / 2 + 0.05, 0.0, 0, 0, 0, 0.042, 0.06, 0.048)]);
    body.add(upperArm, fore);
    arms.push(upperArm, fore);
    // short sleeve: snug over the shoulder and down to mid upper arm
    const sleeve = new THREE.Mesh(tubeGeo(S, S.clone().lerp(E, 0.42), 0.056, 10, true), jerseyMat);
    body.add(sleeve);
    shortSleeves.push(sleeve);
    const long = new THREE.Mesh(merge([tubeGeo(S, E, 0.06, 10, true), tubeGeo(E, W.clone().lerp(E, 0.12), 0.052, 10, true)]), jerseyMat);
    body.add(long);
    longSleeves.push(long);
    // glove over the hand, with a cuff
    const glove = new THREE.Mesh(
      merge([
        place(new THREE.SphereGeometry(1, 10, 8), H.x, H.y, H.z, 0, 0, 0, 0.05, 0.05, 0.062),
        tubeGeo(W.clone().lerp(E, 0.05), W.clone().lerp(H, 0.45), 0.047, 10),
      ]),
      gear,
    );
    body.add(glove);
    gloves.push(glove);
    if (s === -1) {
      // watch on the left wrist: strap round the forearm, steel case and a dark face on top
      const at = W.clone().lerp(E, 0.2);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, E.clone().sub(W).normalize());
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.01, 6, 16).rotateX(Math.PI / 2), strap);
      band.position.copy(at);
      band.quaternion.copy(q);
      const face = new THREE.Group();
      face.position.copy(at);
      face.quaternion.copy(q);
      // the face sits on the outside of the wrist
      face.add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.014, 16).rotateZ(Math.PI / 2).translate(-0.045, 0, 0), std('#d7d9de', { metalness: 0.85, roughness: 0.22 })));
      face.add(new THREE.Mesh(new THREE.CircleGeometry(0.019, 16).rotateY(-Math.PI / 2).translate(-0.0525, 0, 0), new THREE.MeshStandardMaterial({ color: '#0b1220', roughness: 0.1, metalness: 0.4, emissive: '#1d3a5a', emissiveIntensity: 0.4 })));
      watch.add(band, face);
    }
  }

  // legs: each swings from the hip; thigh in shorts, bent knee, calf, sock and shoe
  const legs: THREE.Object3D[] = [];
  const thighs: THREE.Mesh[] = [];
  const shoeMat = std('#22252b', { roughness: 0.6 });
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.98, 0.17);
    const K = v3(s * 0.02, -0.27, -0.27);
    const A = v3(s * 0.01, -0.68, -0.13);
    const thigh = limb(v3(0, 0, 0), K.clone().multiplyScalar(0.82), 0.078, shorts);
    hip.add(thigh);
    thighs.push(thigh);
    // calf: a lathe so it bulges below the knee and slims to the ankle
    const calf = new THREE.LatheGeometry(
      [[0.036, 0], [0.042, 0.06], [0.056, 0.2], [0.058, 0.27], [0.05, 0.36], [0.05, 0.4]].map(([r, y]) => new THREE.Vector2(r, y)),
      10,
    );
    const shinDir = K.clone().sub(A);
    calf.applyMatrix4(new THREE.Matrix4().compose(A, new THREE.Quaternion().setFromUnitVectors(Y, shinDir.clone().normalize()), v3(1, shinDir.length() / 0.4, 1)));
    add(merge([calf, tubeGeo(K.clone().multiplyScalar(0.72), K, 0.06, 10, true)]), skin, hip);
    // sock and sole
    const foot = A.clone().add(v3(0, -0.06, -0.05));
    add(
      merge([
        tubeGeo(A.clone().add(v3(0, 0.05, 0)), A.clone().add(v3(0, -0.035, 0)), 0.042, 10),
        place(new THREE.CapsuleGeometry(0.042, 0.17, 4, 8), foot.x, foot.y - 0.028, foot.z, Math.PI / 2, 0, 0, 1.12, 1, 0.35),
      ]),
      trim,
      hip,
    );
    add(place(new THREE.CapsuleGeometry(0.045, 0.15, 4, 10), foot.x, foot.y + 0.012, foot.z, Math.PI / 2 + 0.06, 0, 0, 1, 1, 0.82), shoeMat, hip);
    body.add(hip);
    legs.push(hip);
  }

  const setLook = (look: RiderLook) => {
    skin.color.set(look.skin);
    // body type: shoulders and chest width, and thicker arms and thighs for broad
    const w = { slim: 0.88, regular: 1, broad: 1.16 }[look.body] * (look.gender === 'female' ? 0.94 : 1);
    torso.scale.set(torsoBase.x * w, torsoBase.y, torsoBase.z * w);
    for (const a of arms) a.scale.set(w, 1, w);
    for (const t of thighs) t.scale.set(w, 1, w);
    // outfit
    jerseyMat.color.set(look.outfit === 'kente' ? '#ffffff' : look.jersey);
    jerseyMat.map = look.outfit === 'kente' ? kenteTexture() : null;
    jerseyMat.roughness = look.outfit === 'hoodie' ? 0.9 : 0.6;
    jerseyMat.needsUpdate = true;
    collar.visible = look.outfit === 'hall-tee';
    hood.visible = look.outfit === 'hoodie' && !look.accessories.includes('backpack');
    // long sleeves for the hoodie
    for (const sl of shortSleeves) sl.visible = look.outfit !== 'hoodie';
    for (const sl of longSleeves) sl.visible = look.outfit === 'hoodie';
    // accessories
    const has = (a: string) => look.accessories.includes(a);
    helmet.visible = has('helmet');
    helmetMat.color.set(look.helmet);
    hair.visible = !has('helmet');
    bun.visible = look.gender === 'female';
    shades.visible = has('sunglasses');
    pack.visible = has('backpack');
    watch.visible = has('watch');
    for (const g of gloves) g.visible = has('gloves');
  };

  // everything that isn't the bike is the rider, so the garage can show the bike on its own
  const riderGroup = new THREE.Group();
  for (const c of [...body.children]) if (!bikeParts.has(c)) riderGroup.add(c);
  body.add(riderGroup);

  shadowed(root);
  const rig: RiderRig = {
    root, body, wheels, crank, legs: legs as [THREE.Object3D, THREE.Object3D],
    setJersey: (c) => jerseyMat.color.set(c),
    setBikeColor: (c) => { frameMat.color.set(c); stayMat.color.set(c); },
    setLook,
    setBikeStyle,
    showRider: (on) => { riderGroup.visible = on; },
  };
  setLook({ gender: 'male', body: 'regular', skin: '#7a4b2e', outfit: 'jersey', jersey, helmet: '#f5c518', accessories: ['helmet'] });
  return rig;
}

export interface RiderLook {
  gender: 'male' | 'female';
  body: 'slim' | 'regular' | 'broad';
  skin: string;
  outfit: 'jersey' | 'hall-tee' | 'hoodie' | 'kente';
  /** resolved jersey colour */
  jersey: string;
  helmet: string;
  accessories: string[];
}

/** Kente-style stripes in gold, green, red and black, drawn once. */
let kente: THREE.CanvasTexture | null = null;
function kenteTexture() {
  if (kente) return kente;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const bands = ['#f2b705', '#0f7b3a', '#f2b705', '#c8102e', '#111111', '#f2b705', '#0f7b3a', '#c8102e'];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * 8, 64, 8); });
  // the woven blocks that make it read as kente
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2) {
    g.fillStyle = (x + y) % 4 === 0 ? '#111111' : '#f2b705';
    g.fillRect(x * 8 + (y % 2) * 8, y * 8 + 2, 6, 4);
  }
  kente = new THREE.CanvasTexture(c);
  kente.colorSpace = THREE.SRGBColorSpace;
  kente.wrapS = kente.wrapT = THREE.RepeatWrapping;
  kente.repeat.set(2, 2);
  return kente;
}

// ---------- obstacles ----------

export type ObstacleKind = 'car' | 'trotro' | 'pedestrian' | 'barrier' | 'pothole';

export interface ObstacleSpec {
  kind: ObstacleKind;
  width: number;
  length: number;
  /** height the rider must clear by jumping; Infinity = must dodge */
  clearHeight: number;
  /** slows the rider instead of ending the ride */
  hazard: boolean;
}

export const OBSTACLES: Record<ObstacleKind, ObstacleSpec> = {
  car: { kind: 'car', width: 1.8, length: 4.2, clearHeight: Infinity, hazard: false },
  trotro: { kind: 'trotro', width: 2.0, length: 5.4, clearHeight: Infinity, hazard: false },
  pedestrian: { kind: 'pedestrian', width: 0.6, length: 0.5, clearHeight: Infinity, hazard: false },
  barrier: { kind: 'barrier', width: 2.0, length: 0.4, clearHeight: 0.55, hazard: false },
  pothole: { kind: 'pothole', width: 1.4, length: 1.2, clearHeight: 0.12, hazard: true },
};

const CAR_COLORS = ['#c0392b', '#ecf0f1', '#2c3e50', '#7f8c8d', '#1e5aa8', '#d4ac0d', '#111111'];
const PEOPLE_COLORS = ['#e74c3c', '#27ae60', '#f39c12', '#8e44ad', '#2980b9', '#ecf0f1', '#d35400'];
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

const shared = {
  tyre: std('#16171a', { roughness: 0.9 }),
  glass: std('#22303d', { roughness: 0.1, metalness: 0.6 }),
  light: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe08a', emissiveIntensity: 0.8 }),
  tail: new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2b20', emissiveIntensity: 0.6 }),
  rim: std('#b9bec6', { metalness: 0.85, roughness: 0.3 }),
  hair: std('#15100d', { roughness: 0.9 }),
};

/** A walking student's body parts, built once and shared by every pedestrian. */
let people: { legs: THREE.BufferGeometry; shirt: THREE.BufferGeometry; skin: THREE.BufferGeometry; dark: THREE.BufferGeometry; bag: THREE.BufferGeometry } | null = null;
function personGeo() {
  if (people) return people;
  const legs: THREE.BufferGeometry[] = [], shirt: THREE.BufferGeometry[] = [], skin: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    // a mid-stride pose: one leg forward, the opposite arm forward
    legs.push(tubeGeo(v3(s * 0.09, 0.92, 0), v3(s * 0.1, 0.12, s * 0.12), 0.07, 8, true));
    dark.push(place(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), s * 0.1, 0.06, s * 0.12 - 0.05, Math.PI / 2, 0, 0, 1, 1, 0.75));
    shirt.push(tubeGeo(v3(s * 0.21, 1.38, 0), v3(s * 0.25, 1.1, -s * 0.08), 0.055, 8, true));
    skin.push(tubeGeo(v3(s * 0.25, 1.1, -s * 0.08), v3(s * 0.25, 0.86, -s * 0.12), 0.042, 8, true));
  }
  legs.push(new THREE.CapsuleGeometry(0.15, 0.08, 4, 10).rotateZ(Math.PI / 2).translate(0, 0.95, 0));
  shirt.push(place(new THREE.CapsuleGeometry(0.17, 0.36, 4, 12), 0, 1.2, 0, 0, 0, 0, 1.15, 1, 0.8));
  skin.push(place(new THREE.SphereGeometry(0.115, 14, 10), 0, 1.66, 0, 0, 0, 0, 0.92, 1.06, 1), tubeGeo(v3(0, 1.45, 0), v3(0, 1.58, 0), 0.05, 8));
  dark.push(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2).translate(0, 1.675, 0.01));
  people = {
    legs: merge(legs),
    shirt: merge(shirt),
    skin: merge(skin),
    dark: merge(dark),
    bag: new RoundedBoxGeometry(0.3, 0.38, 0.16, 2, 0.04).translate(0, 1.2, 0.2),
  };
  return people;
}

/** Four tyres and four rims for a vehicle size, merged and shared by every vehicle of that size. */
const wheelSets = new Map<string, { tyres: THREE.BufferGeometry; rims: THREE.BufferGeometry }>();
function wheelSet(width: number, front: number, back: number, inset: number) {
  const key = `${width},${front},${back},${inset}`;
  let w = wheelSets.get(key);
  if (w) return w;
  const tyres: THREE.BufferGeometry[] = [], rims: THREE.BufferGeometry[] = [];
  for (const x of [-width / 2 + inset, width / 2 - inset]) {
    for (const z of [front, back]) {
      tyres.push(new THREE.TorusGeometry(0.25, 0.09, 8, 18).rotateY(Math.PI / 2).translate(x, 0.33, z));
      // alloy rim: a dished disc with five spokes, on the outside face
      const out = Math.sign(x) * 0.07;
      rims.push(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14).rotateZ(Math.PI / 2).translate(x + out, 0.33, z));
      rims.push(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8).rotateZ(Math.PI / 2).translate(x + out * 1.3, 0.33, z));
    }
  }
  w = { tyres: merge(tyres), rims: merge(rims) };
  wheelSets.set(key, w);
  return w;
}

/** Shared bodies and glasshouses per vehicle size: rounded shell, tapered cabin. */
const shells = new Map<string, THREE.BufferGeometry>();
function shell(key: string, make: () => THREE.BufferGeometry) {
  let g = shells.get(key);
  if (!g) shells.set(key, (g = make()));
  return g;
}
function taperedCabin(w: number, h: number, l: number, frontTaper: number, backTaper: number) {
  const g = new RoundedBoxGeometry(w, h, l, 2, 0.06);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= 0) continue;
    const t = y / (h / 2);
    p.setX(i, p.getX(i) * (1 - 0.1 * t));
    const z = p.getZ(i);
    p.setZ(i, z < 0 ? z + frontTaper * t * (-z / (l / 2)) : z - backTaper * t * (z / (l / 2)));
  }
  g.computeVertexNormals();
  return g;
}

function vehicle(len: number, width: number, bodyH: number, cabinH: number, color: string, cabinLen: number, cabinOffset: number) {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.3, metalness: 0.45 });
  const body = new THREE.Mesh(shell(`b${len},${width},${bodyH}`, () => new RoundedBoxGeometry(width, bodyH, len, 3, 0.16)), paint);
  body.position.y = 0.3 + bodyH / 2;
  g.add(body);
  // glass cabin raked front and back, with a painted roof on top
  const cabin = new THREE.Mesh(shell(`c${width},${cabinH},${cabinLen}`, () => taperedCabin(width * 0.9, cabinH, cabinLen, 0.42, 0.3)), shared.glass);
  cabin.position.set(0, 0.3 + bodyH + cabinH / 2 - 0.02, cabinOffset);
  g.add(cabin);
  const roof = new THREE.Mesh(shell(`r${width},${cabinLen}`, () => new RoundedBoxGeometry(width * 0.8, 0.06, cabinLen * 0.62, 2, 0.025)), paint);
  roof.position.set(0, 0.3 + bodyH + cabinH - 0.02, cabinOffset + 0.04);
  g.add(roof);
  const ws = wheelSet(width, -len / 2 + 0.75, len / 2 - 0.75, 0.12);
  g.add(new THREE.Mesh(ws.tyres, shared.tyre), new THREE.Mesh(ws.rims, shared.rim));
  // rear faces the rider (+z), front faces -z
  for (const x of [-width / 2 + 0.25, width / 2 - 0.25]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), shared.tail);
    t.position.set(x, 0.3 + bodyH * 0.7, len / 2 + 0.01);
    g.add(t);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), shared.light);
    h.position.set(x, 0.3 + bodyH * 0.6, -len / 2 - 0.01);
    g.add(h);
  }
  return g;
}

const TAXI_BODY = ['#d9dadc', '#f2f2f0', '#8c1c24', '#1d2f5c', '#5b5f66'];
const taxiYellow = std('#f5b700', { roughness: 0.4, metalness: 0.3 });

/** A taxi as seen in Accra: any body colour, with all four corners painted yellow. */
function taxi() {
  const len = 4.2, width = 1.8, bodyH = 0.7;
  const g = vehicle(len, width, bodyH, 0.55, pick(TAXI_BODY), 2.1, 0.2);
  for (const z of [-1, 1]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, bodyH + 0.02, 0.85), taxiYellow);
    corner.position.set(0, 0.3 + bodyH / 2, z * (len / 2 - 0.42));
    g.add(corner);
  }
  return g;
}

// Slogans painted on the back of trotros
const SLOGANS = ['GOD IS KING', 'NO TIME TO CHECK TIME', 'SIKA MPE DEDE', 'PSALM 23', 'ONYAME BEKYERE', 'NO KING AS GOD', 'EVERYTHING BY GRACE', 'FEAR WOMEN', 'JESUS NEVER FAILS', 'ADOM WURA'];
const sloganMats = new Map<string, THREE.MeshStandardMaterial>();
function sloganMat(text: string) {
  let m = sloganMats.get(text);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b2430';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 34;
  do { g.font = `800 ${size}px Sora, sans-serif`; size -= 2; } while (g.measureText(text).width > 236 && size > 12);
  g.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2, metalness: 0.3 });
  sloganMats.set(text, m);
  return m;
}

const TROTRO_BODY = ['#eceae4', '#d3d6da', '#f1efe8', '#c9cdd2'];
const TROTRO_STRIPE = ['#c0392b', '#1e5aa8', '#27ae60', '#f1c40f', '#6c3483'];

/** A trotro: a high-roof minibus with a slogan across the back window and luggage on the roof. */
function trotro() {
  const g = new THREE.Group();
  const len = 5.4, width = 2.0, h = 1.95;
  const paint = std(pick(TROTRO_BODY), { roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(shell('trotro', () => new RoundedBoxGeometry(width, h, len - 0.7, 2, 0.12)), paint);
  body.position.set(0, 0.32 + h / 2, 0.35);
  g.add(body);
  // short bonnet at the front (front faces -z)
  const bonnet = new THREE.Mesh(shell('bonnet', () => new RoundedBoxGeometry(width * 0.96, 0.75, 0.8, 2, 0.1)), paint);
  bonnet.position.set(0, 0.32 + 0.375, -len / 2 + 0.4);
  g.add(bonnet);
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.8, 0.05), shared.glass);
  windscreen.position.set(0, 0.32 + 1.3, -len / 2 + 0.68);
  windscreen.rotation.x = -0.25;
  g.add(windscreen);
  // side windows and a coloured stripe
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, len - 1.4), shared.glass);
    win.position.set(sx * (width / 2 + 0.005), 0.32 + 1.4, 0.4);
    g.add(win);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, len - 0.8), std(pick(TROTRO_STRIPE)));
    stripe.position.set(sx * (width / 2 + 0.006), 0.32 + 0.85, 0.35);
    g.add(stripe);
  }
  // the back faces the rider: slogan on the rear window
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.86, 0.62), sloganMat(pick(SLOGANS)));
  back.position.set(0, 0.32 + 1.45, len / 2 + 0.006);
  g.add(back);
  const ws = wheelSet(width, -len / 2 + 0.85, len / 2 - 0.8, 0.1);
  g.add(new THREE.Mesh(ws.tyres, shared.tyre), new THREE.Mesh(ws.rims, shared.rim));
  for (const x of [-width / 2 + 0.2, width / 2 - 0.2]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.04), shared.tail);
    t.position.set(x, 0.32 + 0.6, len / 2 + 0.01);
    g.add(t);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.04), shared.light);
    hl.position.set(x, 0.32 + 0.5, -len / 2 - 0.01);
    g.add(hl);
  }
  if (Math.random() < 0.5) {
    // roof rack with luggage
    const rack = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.05, 2.4), std('#2b2b2b', { metalness: 0.6 }));
    rack.position.set(0, 0.32 + h + 0.08, 0.6);
    const bags = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.38, 1.7), std(pick(['#6e2c00', '#1f618d', '#7d3c98', '#196f3d'])));
    bags.position.set(0, 0.32 + h + 0.3, 0.7);
    g.add(rack, bags);
  }
  return g;
}

export function buildObstacle(kind: ObstacleKind): THREE.Object3D {
  let o: THREE.Object3D;
  switch (kind) {
    case 'car':
      // Accra taxis have yellow-painted corners; other cars are plain
      o = Math.random() < 0.55 ? taxi() : vehicle(4.2, 1.8, 0.7, 0.55, pick(CAR_COLORS), 2.1, 0.2);
      break;
    case 'trotro':
      o = trotro();
      break;
    case 'pedestrian': {
      // trousers, shirt with arms, skin (head, neck, hands), dark (hair, shoes); geometry shared
      o = new THREE.Group();
      const pg = personGeo();
      o.add(
        new THREE.Mesh(pg.legs, std(pick(['#2c3e50', '#1f2a36', '#4a4a4a', '#6b5a45', '#2d3f6b']))),
        new THREE.Mesh(pg.shirt, std(pick(PEOPLE_COLORS))),
        new THREE.Mesh(pg.skin, std(pick(['#5a3825', '#7a4b2e', '#8d5a3b', '#4a2c1c']))),
        new THREE.Mesh(pg.dark, shared.hair),
      );
      if (Math.random() < 0.5) {
        const bag = new THREE.Mesh(pg.bag, std(pick(['#111', '#5d4037', '#1a237e'])));
        o.add(bag);
      }
      break;
    }
    case 'barrier': {
      o = new THREE.Group();
      const stripeTex = (() => {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 32;
        const x = c.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
          x.fillStyle = i % 2 ? '#ffffff' : '#e53935';
          x.beginPath();
          x.moveTo(i * 16, 0); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16, 32); x.lineTo(i * 16 - 16, 32);
          x.fill();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.06), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6 }));
      board.position.y = 0.42;
      o.add(board);
      for (const x of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.36), std('#333'));
        leg.position.set(x, 0.25, 0);
        o.add(leg);
      }
      break;
    }
    case 'pothole': {
      o = new THREE.Group();
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.7, 18), std('#1e1f22', { roughness: 1 }));
      hole.rotation.x = -Math.PI / 2;
      hole.scale.set(1, 0.85, 1);
      hole.position.y = 0.012;
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), std('#4b5a66', { roughness: 0.05, metalness: 0.6 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(0.1, 0.014, 0.05);
      o.add(hole, water);
      o.traverse((c) => ((c as THREE.Mesh).receiveShadow = true));
      return o;
    }
  }
  return shadowed(o);
}

const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 22).rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: '#ffcc1a', metalness: 0.6, roughness: 0.3, emissive: '#c08a00', emissiveIntensity: 0.55 });

export function buildCoin() {
  const m = new THREE.Mesh(coinGeo, coinMat);
  m.castShadow = true;
  return m;
}
