// A Campus Life hangout in 3D, set inside the real campus: the place gets a plaza with its own
// props (food stalls, a DJ booth and speakers, benches, bunting...) and a crowd. Everyone moves:
// people dance in time with the sound system, chat in little groups, sit, eat, take photos,
// arrive on their bikes and leave. You walk around (tap the ground, or WASD) and meet them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingAt, placeByName } from '../../game/campusmap';
import type { SceneGuest } from '../../game/Game';
import { inLandmark } from '../../game/life';
import { partyBeat, setParty } from '../../audio';
import { makeBot, lineFor, type BotPerson } from './bots';
import type { ShowKind, Theme, Venue } from './venues';

// ---------- shared materials and parts ----------
const mats = new Map<string, THREE.MeshStandardMaterial>();
const mat = (hex: string, o: { e?: number; rough?: number; metal?: number } = {}) => {
  const k = `${hex}|${o.e ?? 0}|${o.rough ?? 0.8}|${o.metal ?? 0}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color: hex, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, emissive: o.e ? hex : '#000000', emissiveIntensity: o.e ?? 0 })));
  return m;
};
const G = {
  leg: new THREE.CapsuleGeometry(0.07, 0.68, 4, 8).translate(0, -0.42, 0),
  shoe: new THREE.BoxGeometry(0.11, 0.07, 0.24).translate(0, -0.85, -0.04),
  torso: new THREE.CapsuleGeometry(0.17, 0.34, 4, 10).scale(1.12, 1, 0.74).translate(0, 0.3, 0),
  skirt: new THREE.CylinderGeometry(0.17, 0.3, 0.5, 12, 1, true).translate(0, -0.2, 0),
  head: new THREE.SphereGeometry(0.115, 14, 10).scale(0.92, 1.06, 1).translate(0, 0.14, 0),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8).translate(0, 0.62, 0),
  hair: new THREE.SphereGeometry(0.122, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.1).translate(0, 0.155, 0.008),
  bun: new THREE.SphereGeometry(0.075, 10, 8).translate(0, 0.24, 0.07),
  arm: new THREE.CapsuleGeometry(0.045, 0.5, 4, 8).translate(0, -0.3, 0),
  sleeve: new THREE.CapsuleGeometry(0.06, 0.12, 4, 8).translate(0, -0.08, 0),
  phone: new THREE.BoxGeometry(0.07, 0.13, 0.012).translate(0, -0.6, -0.05),
  plate: new THREE.CylinderGeometry(0.09, 0.07, 0.03, 10).translate(0, -0.6, -0.08),
  cup: new THREE.CylinderGeometry(0.045, 0.035, 0.13, 8).translate(0, -0.6, -0.06),
  mic: new THREE.CylinderGeometry(0.018, 0.012, 0.2, 6).rotateX(-0.9).translate(0, -0.6, -0.08),
};

/** a person who can move their arms and legs */
interface Fig {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  head: THREE.Group;
  phone: THREE.Mesh;
  plate: THREE.Mesh;
  cup: THREE.Mesh;
  mic: THREE.Mesh;
  meshes: THREE.Mesh[];
}
function figure(o: { skin: string; shirt: string; bottom: string; female: boolean; dress: boolean; hair?: string }): Fig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92;
  root.add(body);
  const meshes: THREE.Mesh[] = [];
  const m = (g: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) => { const x = new THREE.Mesh(g, material); x.castShadow = g === G.torso || g === G.leg; parent.add(x); meshes.push(x); return x; };
  const skin = mat(o.skin, { rough: 0.6 }), shirt = mat(o.shirt), bottom = mat(o.bottom), dark = mat(o.hair ?? '#151110', { rough: 0.9 }), shoe = mat('#202020');
  m(G.torso, shirt, body);
  if (o.dress) m(G.skirt, mat(o.bottom === '#d9c7a3' ? o.shirt : o.bottom), body).material.side = THREE.DoubleSide;
  m(G.neck, skin, body);
  const head = new THREE.Group();
  head.position.y = 0.62;
  body.add(head);
  m(G.head, skin, head);
  m(G.hair, dark, head);
  if (o.female && !o.dress) m(G.bun, dark, head);
  const limb = (x: number, y: number, arm: boolean) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    body.add(g);
    if (arm) { m(G.arm, skin, g); m(G.sleeve, shirt, g); } else { m(G.leg, o.dress ? skin : bottom, g); m(G.shoe, shoe, g); }
    return g;
  };
  const armL = limb(-0.24, 0.48, true), armR = limb(0.24, 0.48, true);
  const legL = limb(-0.1, 0, false), legR = limb(0.1, 0, false);
  const phone = m(G.phone, mat('#111', { rough: 0.3, metal: 0.3 }), armR);
  const plate = m(G.plate, mat('#f4f4f4'), armL);
  const cup = m(G.cup, mat('#d8232a', { rough: 0.5 }), armR);
  const mic = m(G.mic, mat('#222', { metal: 0.6, rough: 0.3 }), armR);
  phone.visible = plate.visible = cup.visible = mic.visible = false;
  return { root, body, armL, armR, legL, legR, head, phone, plate, cup, mic, meshes };
}

// ---------- canvas signs ----------
function signTex(text: string, bg: string, fg: string, w = 256, h = 64, font = 'bold 34px system-ui, sans-serif') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stripeTex(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- the people ----------
export type Act = 'idle' | 'walk' | 'dance' | 'chat' | 'sit' | 'eat' | 'photo' | 'pose' | 'wave' | 'highfive' | 'kiss' | 'vendor' | 'dj' | 'sing' | 'crew' | 'leave';

export interface Person {
  key: string;
  name: string;
  hall: string;
  bot: boolean;
  me?: boolean;
  fig: Fig;
  x: number; z: number; yaw: number;
  /** standing on the stage */
  y?: number;
  /** where they're going and what they'll do there */
  tx: number; tz: number; tyaw: number | null;
  act: Act;
  then: Act;
  /** seconds left in this activity (bots) */
  timer: number;
  phase: number;
  moves: number;
  /** a chat bubble */
  say: string;
  sayT: number;
  /** a seat or a stall spot they hold */
  spot: Spot | null;
  /** came on a bike: the bike walks in with them until it's parked */
  bike?: THREE.Object3D;
  /** a short gesture over the activity (wave, high five) */
  gesture: Act | null;
  gestureT: number;
}

interface Spot { x: number; z: number; yaw: number; kind: 'seat' | 'stall' | 'dance' | 'chat' | 'photo' | 'vendor' | 'dj' | 'rack'; taken: string | null; y?: number }

export interface HangoutWorld extends SceneGuest {
  people: () => Person[];
  me: Person;
  /** tap at screen point: a person, or walk there */
  tap(px: number, py: number): Person | null;
  drag(dx: number, dy: number): void;
  zoom(f: number): void;
  keys: Set<string>;
  /** your activity */
  doAct(a: 'dance' | 'sit' | 'eat' | 'drink' | 'wave' | 'photo' | 'stop'): void;
  /** the nearest vendor, or the performer on stage */
  staff(kind: 'vendor' | 'stage'): Person | null;
  /** walk towards a point, stopping `short` metres before it */
  walkTo(x: number, z: number, short?: number): void;
  /** the crowd cheers for a moment (song request, end of a set) */
  cheer(): void;
  /** the nearest person you could interact with, and how far */
  closest(): { p: Person; d: number } | null;
  /** a bot answers an ask after a moment; true if they said yes */
  askBot(p: Person, kind: string): Promise<boolean>;
  /** someone in this space right now (real riders) */
  setPeer(key: string, name: string, s: { x: number; z: number; yaw: number; act: Act } | null): void;
  peerGesture(key: string, g: Act): void;
  speak(key: string, text: string): void;
  /** a bot near you answers what you said */
  nearestBot(): Person | null;
  /** someone free comes over to you, faces you and waves */
  /** someone comes over to talk: `who` if given, else one of the nearest free people */
  meetSomeone(who?: Person): Person | null;
  selfie(capture: () => string): string;
  /** for streaming your position */
  state(): { x: number; z: number; yaw: number; act: Act };
  count(): number;
  setCrowd(n: number): void;
  labels: HTMLElement;
  dispose(): void;
}

const RADIUS = 15;
/** full people (who you can tap and talk to); the rest of the crowd is lighter and drawn in one go */
const LOW = (navigator.hardwareConcurrency ?? 4) <= 4 || Math.min(screen.width, screen.height) < 500;
const FULL = LOW ? 10 : 22;
const AMBIENT_MAX = 130;

// the lighter crowd: legs, body (arms down or up) and head, each one instanced mesh
const A = (() => {
  const merge = (parts: THREE.BufferGeometry[], tint: number[] = []) => {
    let n = 0;
    for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const idx: number[] = [];
    let o = 0;
    parts.forEach((g, i) => {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array as Float32Array, o * 3);
      nor.set(g.attributes.normal.array as Float32Array, o * 3);
      col.fill(tint[i] ?? 1, o * 3, (o + c) * 3);
      const gi = g.index!.array;
      for (let k = 0; k < gi.length; k++) idx.push(gi[k] + o);
      o += c;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  };
  const leg = (x: number) => new THREE.CapsuleGeometry(0.075, 0.68, 2, 6).translate(x, 0.5, 0);
  const shoe = (x: number) => new THREE.BoxGeometry(0.11, 0.07, 0.24).translate(x, 0.07, -0.04);
  const torso = () => new THREE.CapsuleGeometry(0.17, 0.34, 2, 7).scale(1.12, 1, 0.74).translate(0, 1.22, 0);
  const arm = (x: number, up: boolean) => { const g = new THREE.CapsuleGeometry(0.05, 0.52, 2, 5).translate(0, -0.3, 0); if (up) g.rotateZ(x < 0 ? -2.7 : 2.7); else g.rotateZ(x < 0 ? -0.08 : 0.08); return g.translate(x, 1.4, 0); };
  const legs = merge([leg(-0.1), leg(0.1), shoe(-0.1), shoe(0.1)], [1, 1, 0.25, 0.25]);
  const down = merge([torso(), arm(-0.24, false), arm(0.24, false)]);
  const up = merge([torso(), arm(-0.24, true), arm(0.24, true)]);
  const head = merge([
    new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6).translate(0, 1.54, 0),
    new THREE.SphereGeometry(0.115, 8, 6).scale(0.92, 1.06, 1).translate(0, 1.68, 0),
    new THREE.SphereGeometry(0.122, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.1).translate(0, 1.695, 0.008),
  ], [1, 1, 0.13]);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  return { legs, down, up, head, m };
})();

/** an open spot near the place: no building within the plaza */
function openCentre(place: { x: number; z: number }) {
  const clear = (x: number, z: number, r: number) => {
    for (const rr of [0, r * 0.5, r]) for (let k = 0; k < (rr ? 10 : 1); k++) {
      const a = (k / 10) * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      if (buildingAt(px, pz, 0.5) || inLandmark(px, pz, 1)) return false;
    }
    return true;
  };
  for (const r of [RADIUS + 2, RADIUS - 2, 10, 7]) {
    for (let d = 0; d <= 90; d += 5) {
      for (let k = 0; k < (d ? 16 : 1); k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = place.x + Math.cos(a) * d, z = place.z + Math.sin(a) * d;
        if (clear(x, z, r)) return { x, z };
      }
    }
  }
  return { x: place.x, z: place.z };
}

export function buildHangout(v: Venue, me: { name: string; hall: string; skin: string; shirt: string; female: boolean }, crowd: number, night: boolean, show?: { kind: ShowKind; who: string; label: string }): HangoutWorld {
  const place = placeByName(v.place)!;
  const C = openCentre(place);
  const root = new THREE.Group();
  root.position.set(C.x, 0, C.z);
  root.updateMatrixWorld();
  const focus = new THREE.Vector3(C.x, 0, C.z);
  let seed = 7;
  for (const c of v.id) seed = (seed * 31 + c.charCodeAt(0)) % 2147483647;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const spots: Spot[] = [];
  const beaters: { obj: THREE.Object3D; base: number; amt: number }[] = [];
  const glows: { m: THREE.MeshStandardMaterial; hue: number }[] = [];
  const spinners: THREE.Object3D[] = [];
  const sweepers: { obj: THREE.Object3D; ph: number }[] = [];
  const speakers: THREE.Vector3[] = [];
  const dispose: (() => void)[] = [];
  /** things on the ground the light crowd stands clear of */
  const solid: [number, number, number][] = [];
  const bb = new THREE.Box3();
  const add = (o: THREE.Object3D, x: number, z: number, yaw = 0, y = 0) => {
    o.position.set(x, y, z); o.rotation.y = yaw; root.add(o);
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = true; });
    o.updateMatrixWorld(true);
    bb.setFromObject(o);
    if (bb.max.y > 0.25 && bb.min.y < 1.2) solid.push([(bb.min.x + bb.max.x) / 2 - root.position.x, (bb.min.z + bb.max.z) / 2 - root.position.z, Math.min(3, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2)]);
    return o;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, y = h / 2) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, y, 0), m); return b; };

  // ---------- ground ----------
  const groundCol = v.theme === 'garden' ? '#5f8f45' : v.theme === 'jam' ? '#3a3f48' : v.theme === 'market' ? '#8a6f5a' : '#a9a49a';
  const ground = new THREE.Mesh(new THREE.CircleGeometry(RADIUS + 3, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: groundCol, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  ground.position.y = 0.03;
  ground.receiveShadow = true;
  root.add(ground);

  // ---------- props ----------
  const stall = (x: number, z: number, yaw: number, a: string, b: string, sign: string) => {
    const g = new THREE.Group();
    g.add(box(2.2, 1, 0.9, mat('#e9e2d6')));
    for (const [px, pz] of [[-1.05, -0.4], [1.05, -0.4], [-1.05, 0.4], [1.05, 0.4]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(px, 1.15, pz), mat('#777', { metal: 0.6, rough: 0.4 })); g.add(p); }
    const aw = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 1.5), new THREE.MeshStandardMaterial({ map: stripeTex(a, b), roughness: 0.8 }));
    aw.position.set(0, 2.3, -0.15); aw.rotation.x = -0.18;
    g.add(aw);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.45), new THREE.MeshStandardMaterial({ map: signTex(sign, a, b === '#f2f2f2' ? '#1b1b1b' : '#ffffff'), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: night ? 0.25 : 0, emissiveMap: null }));
    s.position.set(0, 2.62, -0.86);
    s.rotation.y = Math.PI;
    g.add(s);
    // food on the counter
    for (let i = 0; i < 4; i++) { const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.2, 10).translate(-0.75 + i * 0.5, 1.1, -0.1), mat(['#9a9a9a', '#c8102e', '#e08a1e', '#f5c518'][i])); g.add(pot); }
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 2.15, -0.5), mat('#ffd27a', { e: night ? 2 : 0.2 }));
    g.add(bulb);
    add(g, x, z, yaw);
    // the vendor stands behind, customers in front (front is -z in the stall's frame)
    const f = (d: number, side = 0) => ({ x: x + Math.sin(yaw) * d + Math.cos(yaw) * side, z: z + Math.cos(yaw) * d - Math.sin(yaw) * side });
    const vp = f(0.9);
    spots.push({ ...vp, yaw, kind: 'vendor', taken: null });
    for (const side of [-0.6, 0.6]) { const cp = f(-1.25, side); spots.push({ ...cp, yaw: yaw + Math.PI, kind: 'stall', taken: null }); }
  };
  const chair = (x: number, z: number, yaw: number, col: string) => {
    const g = new THREE.Group();
    g.add(box(0.45, 0.06, 0.45, mat(col), 0.45));
    const back = box(0.45, 0.45, 0.05, mat(col), 0.7); back.position.z = 0.2; g.add(back);
    for (const [px, pz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5).translate(px, 0.22, pz), mat(col)));
    add(g, x, z, yaw);
    spots.push({ x, z, yaw, kind: 'seat', taken: null, y: 0.47 });
  };
  const table = (x: number, z: number, n: number) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16).translate(0, 0.74, 0), mat('#f2f2f2')), x, z);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.74, 8).translate(0, 0.37, 0), mat('#ddd')), x, z);
    const col = ['#f2f2f2', '#c8102e', '#1f6fb8', '#2e8b3a'][(rand() * 4) | 0];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rand(); chair(x + Math.sin(a) * 0.95, z + Math.cos(a) * 0.95, a, col); }
  };
  const bench = (x: number, z: number, yaw: number) => {
    const g = new THREE.Group();
    g.add(box(1.8, 0.08, 0.45, mat('#8a5a35'), 0.45));
    const back = box(1.8, 0.4, 0.06, mat('#8a5a35'), 0.75); back.position.z = 0.22; g.add(back);
    for (const px of [-0.8, 0.8]) g.add(box(0.08, 0.45, 0.4, mat('#3a3a3a')).translateX(px));
    add(g, x, z, yaw);
    for (const s of [-0.5, 0.5]) spots.push({ x: x + Math.cos(yaw) * s, z: z - Math.sin(yaw) * s, yaw, kind: 'seat', taken: null, y: 0.49 });
  };
  const speaker = (x: number, z: number) => {
    const yaw = Math.atan2(x, z);
    const g = new THREE.Group();
    g.add(box(0.8, 1.1, 0.6, mat('#151515', { rough: 0.5 })));
    const top = box(0.7, 0.7, 0.55, mat('#1d1d1d', { rough: 0.5 }), 1.45); g.add(top);
    for (const [y, r] of [[0.55, 0.28], [1.45, 0.17]] as const) {
      const cone = new THREE.Mesh(new THREE.CircleGeometry(r, 18), mat('#333', { rough: 0.3 }));
      cone.position.set(0, y, -0.31); cone.rotation.y = Math.PI;
      g.add(cone);
      beaters.push({ obj: cone, base: 1, amt: 0.12 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.03, 20), mat('#41e0ff', { e: night ? 2 : 0.6 }));
      ring.position.set(0, y, -0.315); ring.rotation.y = Math.PI;
      g.add(ring);
      glows.push({ m: ring.material as THREE.MeshStandardMaterial, hue: rand() });
    }
    add(g, x, z, yaw);
    speakers.push(new THREE.Vector3(x, 0, z));
  };
  const lights = (pts: [number, number][], h = 3.2) => {
    // string lights between poles, sagging between each pair
    for (const [x, z] of pts) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6).translate(0, h / 2, 0), mat('#555', { metal: 0.5 })), x, z);
    const bulbs: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      for (let k = 1; k < 12; k++) { const t = k / 12; bulbs.push(new THREE.Vector3(ax + (bx - ax) * t, h - 0.1 - Math.sin(t * Math.PI) * 0.6, az + (bz - az) * t)); }
    }
    // the wire the bulbs hang from
    const wire: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      for (let k = 0; k <= 12; k++) { const t = k / 12; wire.push(new THREE.Vector3(ax + (bx - ax) * t, h - 0.04 - Math.sin(t * Math.PI) * 0.6, az + (bz - az) * t)); }
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: '#2a2a2a' })));
    const cols = ['#ffd27a', '#ff6b6b', '#6bd3ff', '#9cff6b', '#ff9ad5'];
    cols.forEach((c, ci) => {
      const these = bulbs.filter((_, i) => i % cols.length === ci);
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), mat(c, { e: night ? 2.2 : 0.5 }), these.length);
      these.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
      root.add(im);
      glows.push({ m: im.material as THREE.MeshStandardMaterial, hue: ci / cols.length });
    });
  };
  const banner = (x: number, z: number, yaw: number, text: string, bg: string, fg = '#ffffff', w = 4, h = 0.9, y = 2.6) => {
    for (const s of [-w / 2, w / 2]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, y + h / 2, 6).translate(0, (y + h / 2) / 2, 0), mat('#666', { metal: 0.5 })), x + Math.cos(yaw) * s, z - Math.sin(yaw) * s);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTex(text, bg, fg, 512, 112, 'bold 64px system-ui, sans-serif'), side: THREE.DoubleSide, roughness: 0.7 }));
    add(b, x, z, yaw, y);
  };
  const bunting = (a: [number, number], b: [number, number], cols: string[]) => {
    const n = Math.max(6, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.15, 0, 0), new THREE.Vector3(0.15, 0, 0), new THREE.Vector3(0, -0.32, 0)]);
    tri.computeVertexNormals();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const f = new THREE.Mesh(tri, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.8 }));
      f.position.set(a[0] + (b[0] - a[0]) * t, 3.1 - Math.sin(t * Math.PI) * 0.5, a[1] + (b[1] - a[1]) * t);
      f.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
      root.add(f);
      sweepers.push({ obj: f, ph: i * 0.7 });
    }
  };
  const simpleBike = (col: string) => {
    const g = new THREE.Group();
    const tyre = new THREE.TorusGeometry(0.33, 0.035, 6, 18).rotateY(Math.PI / 2);
    for (const z of [-0.52, 0.52]) { const w = new THREE.Mesh(tyre, mat('#1a1a1a')); w.position.set(0, 0.36, z); g.add(w); }
    const tube = (a: THREE.Vector3, b: THREE.Vector3) => { const len = a.distanceTo(b); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 5), mat(col, { metal: 0.4, rough: 0.4 })); m.position.copy(a).lerp(b, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(m); };
    const V = (y: number, z: number) => new THREE.Vector3(0, y, z);
    tube(V(0.36, 0.52), V(0.5, 0)); tube(V(0.5, 0), V(0.92, -0.05)); tube(V(0.92, -0.05), V(0.9, 0.42)); tube(V(0.36, -0.52), V(0.92, -0.42)); tube(V(0.9, 0.42), V(0.36, 0.52)); tube(V(0.92, -0.42), V(0.5, 0));
    tube(V(0.92, -0.42), V(1.05, -0.45));
    const seat = box(0.12, 0.04, 0.24, mat('#111'), 0.95); seat.position.z = 0.42; g.add(seat);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5).rotateZ(Math.PI / 2), mat('#222')); bar.position.set(0, 1.06, -0.45); g.add(bar);
    g.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = true; });
    return g;
  };
  // the bike rack at the edge, where you parked and where people arrive
  const rackA = Math.PI * 1.25;
  const rx = Math.cos(rackA) * (RADIUS - 1.5), rz = Math.sin(rackA) * (RADIUS - 1.5);
  const rackYaw = Math.atan2(rx, rz);
  add(box(4.6, 0.06, 0.06, mat('#888', { metal: 0.6 }), 0.7), rx, rz, rackYaw);
  for (let i = 0; i < 8; i++) {
    const s = -2 + i * 0.58;
    const sx = rx + Math.cos(rackYaw) * s, sz = rz - Math.sin(rackYaw) * s;
    spots.push({ x: sx, z: sz, yaw: rackYaw, kind: 'rack', taken: null });
  }
  const rackSpots = spots.filter((s) => s.kind === 'rack');
  const parkBike = (s: Spot, bike?: THREE.Object3D) => {
    const b = bike ?? simpleBike(['#c8102e', '#1f3a93', '#1b1b1b', '#f5c518', '#2e8b3a', '#e8e8e8'][(rand() * 6) | 0]);
    if (!bike) root.add(b);
    b.position.set(s.x, 0, s.z);
    b.rotation.y = s.yaw;
    s.taken = 'bike';
  };
  // a few bikes already parked, and yours
  parkBike(rackSpots[0], (() => { const b = simpleBike(me.shirt); root.add(b); return b; })());
  for (let i = 1; i < 5; i++) parkBike(rackSpots[i]);

  const SIGNS = ['WAAKYE', 'KELEWELE', 'JOLLOF', 'INDOMIE', 'KENKEY & FISH', 'FRIED RICE', 'SHAWARMA', 'SOBOLO & ICE'];
  const AWN: [string, string][] = [['#c8102e', '#f2f2f2'], ['#f5c518', '#1f6fb8'], ['#2e8b3a', '#f5c518'], ['#1f6fb8', '#f2f2f2'], ['#e08a1e', '#2b2f3a'], ['#8e24aa', '#f2f2f2']];
  const ring = (n: number, r: number, a0 = 0, span = Math.PI * 2) => Array.from({ length: n }, (_, i) => { const a = a0 + (span * (i + 0.5)) / n; return [Math.cos(a) * r, Math.sin(a) * r, a] as const; });
  const faceIn = (x: number, z: number) => Math.atan2(-x, -z) + Math.PI; // a stall's front (-z local) faces the centre

  switch (v.theme as Theme) {
    case 'market': {
      for (const [i, [x, z, ]] of ring(7, RADIUS - 3.5, rackA + 0.55, Math.PI * 1.6).entries()) stall(x, z, faceIn(x, z), ...AWN[i % AWN.length], SIGNS[i % SIGNS.length]);
      for (const [x, z] of [[-2.5, 1.5], [2.5, -1], [0, -4], [-3.5, -3.5], [3.8, 3.5]]) table(x, z, 3 + ((rand() * 2) | 0));
      lights([[-9, -9], [0, -11], [9, -9], [11, 0], [9, 9]]);
      banner(0, RADIUS - 0.5, Math.PI, v.name.toUpperCase(), '#1b1b1b', '#f5c518');
      break;
    }
    case 'jam': {
      // DJ booth facing the dance floor, speaker stacks either side, stage lights and a photo wall
      const booth = new THREE.Group();
      booth.add(box(3, 1.05, 1, mat('#111', { rough: 0.4 })));
      const front = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.9), new THREE.MeshStandardMaterial({ map: signTex(v.name.toUpperCase(), '#111111', '#f5c518', 512, 128, 'bold 76px system-ui, sans-serif'), emissive: '#ffffff', emissiveIntensity: night ? 0.35 : 0.05 }));
      front.position.set(0, 0.52, -0.51); front.rotation.y = Math.PI;
      booth.add(front);
      for (const s of [-0.7, 0.7]) { const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 20).translate(0, 1.08, 0), mat('#2a2a2a', { metal: 0.6 })); deck.position.x = s; booth.add(deck); spinners.push(deck); }
      add(booth, 0, 7.5, 0);
      spots.push({ x: 0, z: 8.3, yaw: 0, kind: 'dj', taken: null });
      speaker(-3.2, 7.3); speaker(3.2, 7.3); speaker(-6, 5); speaker(6, 5);
      // dance floor tiles that light up on the beat
      const tiles = new THREE.Group();
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ff3fa4', emissiveIntensity: 0.5, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
        t.position.set(-3 + i * 1.5, 0.05, 0.5 + j * 1.5 - 1);
        tiles.add(t);
        glows.push({ m: t.material as THREE.MeshStandardMaterial, hue: (i + j * 3) / 20 });
      }
      root.add(tiles);
      for (let i = 0; i < 16; i++) spots.push({ x: -3 + rand() * 6, z: -1.5 + rand() * 5.5, yaw: 0, kind: 'dance', taken: null });
      // sweeping stage lights
      for (const [x, z, c] of [[-4.5, 8.5, '#ff3fa4'], [4.5, 8.5, '#41e0ff'], [0, 9.5, '#f5c518']] as const) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6).translate(0, 2.1, 0), mat('#444', { metal: 0.6 })), x, z);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 16, 1, true).translate(0, -3.5, 0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: night ? 0.16 : 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const pivot = new THREE.Group();
        pivot.position.set(x, 4.2, z);
        pivot.add(beam);
        root.add(pivot);
        sweepers.push({ obj: pivot, ph: x });
      }
      // photo wall
      banner(-9.5, -4, Math.PI / 2 + 0.5, `LEGONRUSH • ${v.name.toUpperCase()}`, '#f5c518', '#111111', 3.4, 2, 1.4);
      spots.push({ x: -8.2, z: -3.2, yaw: Math.PI / 2 + 0.5 + Math.PI, kind: 'photo', taken: null });
      for (const [x, z, a] of [[8.5, -5, -0.8], [9.5, -2, -1.2], [-3, -9, 0.2], [0, -9.8, 0], [3, -9, -0.2]] as const) bench(x, z, a);
      lights([[-11, -6], [-6, -11], [6, -11], [11, -6]]);
      stall(-10, 4, faceIn(-10, 4), '#2e8b3a', '#f5c518', 'DRINKS');
      break;
    }
    case 'square': {
      const quiet = v.style === 'chill';
      for (const [x, z] of ring(6, 7.5)) bench(x, z, Math.atan2(x, z));
      if (!quiet) {
        stall(-RADIUS + 4, -2, faceIn(-RADIUS + 4, -2), '#f5c518', '#1f6fb8', 'MOBILE MONEY');
        stall(-RADIUS + 5, 4, faceIn(-RADIUS + 5, 4), '#c8102e', '#f2f2f2', 'SNACKS & DRINKS');
        banner(0, RADIUS - 1, Math.PI, v.name.toUpperCase().replace(/ (MEETUP|HANGOUT)$/, ''), '#0b2a5b', '#ffffff');
      } else {
        // a small speaker on a table, and the fountain area
        add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.5, 24).translate(0, 0.25, 0), mat('#cfc8ba')), 0, 0);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.05, 24).translate(0, 0.48, 0), new THREE.MeshStandardMaterial({ color: '#5aa6d6', roughness: 0.1, metalness: 0.3 }));
        add(water, 0, 0);
        const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.15, 1.6, 8, 1, true).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: '#cfe9ff', transparent: true, opacity: 0.55 }));
        add(jet, 0, 0);
        beaters.push({ obj: jet, base: 1, amt: 0.05 });
      }
      lights([[-10, 9], [-3, 12], [3, 12], [10, 9]]);
      break;
    }
    case 'garden': {
      for (let i = 0; i < 7; i++) {
        const a = rand() * Math.PI * 2, r = 9 + rand() * 4;
        if (Math.hypot(Math.cos(a) * r, Math.sin(a) * r + 10.5) < 4.5) continue;
        const tr = new THREE.Group();
        tr.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 7).translate(0, 1.3, 0), mat('#5a4030')));
        tr.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.7 + rand(), 1).translate(0, 3.6, 0), mat(['#2f6b2a', '#3f7d33', '#24591f'][i % 3])));
        add(tr, Math.cos(a) * r, Math.sin(a) * r);
      }
      // picnic mats with people sitting round them
      for (const [x, z, c] of [[-3, 2, '#c8102e'], [3, 3, '#f5c518'], [0, -3, '#1f6fb8'], [-5, -4, '#2e8b3a']] as const) {
        add(box(2.2, 0.02, 1.6, mat(c), 0.04), x, z, rand());
        for (const [sx, sz] of [[-0.8, 0.9], [0.8, 0.9], [0, -0.9]]) spots.push({ x: x + sx, z: z + sz, yaw: Math.atan2(-sx, -sz), kind: 'seat', taken: null, y: 0.06 });
      }
      for (const [x, z, a] of [[6, -6, -0.8], [-7, 5, 2.3]] as const) bench(x, z, a);
      lights([[-8, 8], [0, 10], [8, 8]], 2.8);
      spots.push({ x: 0, z: 8, yaw: Math.PI, kind: 'photo', taken: null });
      break;
    }
    case 'hall': {
      const col = v.color ?? '#c8102e';
      banner(0, RADIUS - 1, Math.PI, v.name.toUpperCase(), col, '#ffffff', 5.6, 1);
      bunting([-10, -8], [10, -8], [col, '#ffffff', '#f5c518']);
      bunting([-10, 8], [10, 8], [col, '#ffffff', '#f5c518']);
      // merch table in hall colours
      const merch = new THREE.Group();
      merch.add(box(2.4, 0.9, 0.9, mat('#f2f2f2')));
      for (let i = 0; i < 5; i++) { const shirt = box(0.36, 0.06, 0.3, mat(i % 2 ? col : '#ffffff'), 0.94); shirt.position.x = -0.9 + i * 0.45; merch.add(shirt); }
      add(merch, 0, -RADIUS + 4.5, 0);
      spots.push({ x: 0, z: -RADIUS + 5.4, yaw: 0, kind: 'vendor', taken: null });
      for (const s of [-0.7, 0.7]) spots.push({ x: s, z: -RADIUS + 3.4, yaw: Math.PI, kind: 'stall', taken: null });
      for (const [x, z] of [[-5, 4], [5, 4]]) table(x, z, 4);
      for (let i = 0; i < 12; i++) spots.push({ x: -3 + rand() * 6, z: -3 + rand() * 5, yaw: 0, kind: 'dance', taken: null });
      lights([[-11, -5], [-11, 5], [11, 5], [11, -5]]);
      break;
    }
  }
  // ---------- the stage: whoever is performing this hour ----------
  const kind: ShowKind = show?.kind ?? (v.theme === 'jam' ? 'dj' : 'live');
  /** where the audience faces */
  let stageAt: { x: number; z: number } | null = v.theme === 'jam' ? { x: 0, z: 7.5 } : null;
  let screenTex: { c: HTMLCanvasElement; t: THREE.CanvasTexture } | null = null;
  const stageSpots: Spot[] = [];
  const STAGE: Partial<Record<Theme, [number, number]>> = { market: [7.6, 0], square: [10.6, 0], garden: [0, -10.5], hall: [0, 10.4] };
  const sp = STAGE[v.theme];
  if (sp) {
    const [x, z] = sp;
    const yaw = Math.atan2(x, z); // the stage's back is away from the centre
    const g = new THREE.Group();
    const loc = (lx: number, lz: number) => ({ x: x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z: z - Math.sin(yaw) * lx + Math.cos(yaw) * lz });
    if (kind === 'movie') {
      // a big outdoor screen on two poles, with a projector glow
      for (const s of [-3.2, 3.2]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6).translate(s, 2.3, 0.05), mat('#444', { metal: 0.5 })));
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      screenTex = { c, t };
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.4), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      scr.position.set(0, 2.75, 0); scr.rotation.y = Math.PI;
      g.add(scr);
      g.add(box(6.2, 0.12, 0.12, mat('#222'), 4.5));
    } else {
      // a low stage with a sign behind, two lights and a mic stand
      g.add(box(4.2, 0.5, 2.6, mat('#2b2f3a', { rough: 0.6 })));
      const edge = box(4.2, 0.06, 0.06, mat('#f5c518', { e: night ? 1.5 : 0.3 }), 0.5); edge.position.z = -1.3; g.add(edge);
      glows.push({ m: edge.material as THREE.MeshStandardMaterial, hue: 0.12 });
      for (const s of [-2, 2]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6).translate(s, 1.7, 1.25), mat('#555', { metal: 0.5 })));
      const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshStandardMaterial({ map: signTex(`LIVE • ${(show?.label ?? 'Live music').toUpperCase()}`, '#111111', '#f5c518', 512, 128, 'bold 54px system-ui, sans-serif'), emissive: '#ffffff', emissiveIntensity: night ? 0.3 : 0.04, side: THREE.DoubleSide }));
      back.position.set(0, 2.85, 1.25); back.rotation.y = Math.PI;
      g.add(back);
      if (kind !== 'dance' && kind !== 'dj') {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 5).translate(0, 1.2, -0.55), mat('#222', { metal: 0.6 })));
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10).translate(0, 0.52, -0.55), mat('#222')));
      }
      if (kind === 'dj') {
        const desk = box(1.8, 0.95, 0.7, mat('#111', { rough: 0.4 }), 0.5 + 0.475); desk.position.z = 0.1; g.add(desk);
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16).translate(0, 1.47, 0.1), mat('#2a2a2a', { metal: 0.6 })); g.add(deck); spinners.push(deck);
      }
      if (kind === 'live') for (const s of [-1.3, 1.3]) { const amp = box(0.6, 0.7, 0.4, mat('#1b1b1b'), 0.85); amp.position.set(s, 0, 0.9); g.add(amp); }
      for (const [s, c] of [[-2, '#ff3fa4'], [2, '#41e0ff']] as const) {
        const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4, 12, 1, true).translate(0, -2, 0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: night ? 0.14 : 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        const pivot = new THREE.Group(); pivot.position.set(s, 3.4, 1.2); pivot.add(beam); g.add(pivot);
        sweepers.push({ obj: pivot, ph: s * 2 });
      }
    }
    add(g, x, z, yaw);
    speaker(loc(-2.9, 0.4).x, loc(-2.9, 0.4).z);
    speaker(loc(2.9, 0.4).x, loc(2.9, 0.4).z);
    stageAt = { x, z };
    const face = yaw + Math.PI;
    if (kind === 'dance') for (const lx of [-1.2, 0, 1.2]) { const q = loc(lx, -0.2); stageSpots.push({ ...q, yaw: face, kind: 'dj', taken: null, y: 0.5 }); }
    else if (kind === 'live') { for (const lx of [0, -1.4, 1.4]) { const q = loc(lx, lx ? 0.3 : -0.4); stageSpots.push({ ...q, yaw: face, kind: 'dj', taken: null, y: 0.5 }); } }
    else if (kind === 'dj') { const q = loc(0, 0.65); stageSpots.push({ ...q, yaw: face, kind: 'dj', taken: null, y: 0.5 }); }
    else if (kind !== 'movie') { const q = loc(0, -0.2); stageSpots.push({ ...q, yaw: face, kind: 'dj', taken: null, y: 0.5 }); }
    // the audience: a dance area or seats in front of the stage
    for (let i = 0; i < 8; i++) { const q = loc(-2 + rand() * 4, -3 - rand() * 3); spots.push({ ...q, yaw: face, kind: 'dance', taken: null }); }
  } else if (v.theme === 'jam' && (kind === 'dance' || kind === 'live')) {
    // performers in front of the DJ booth
    for (const lx of kind === 'dance' ? [-1.4, 0, 1.4] : [0]) stageSpots.push({ x: lx, z: 5.7, yaw: 0, kind: 'dj', taken: null });
  }
  spots.push(...stageSpots);

  // places where little groups stand and talk
  for (let i = 0; i < 6; i++) { const a = rand() * Math.PI * 2, r = 3 + rand() * (RADIUS - 6); spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: 0, kind: 'chat', taken: null }); }
  if (!spots.some((s) => s.kind === 'photo')) spots.push({ x: 0, z: RADIUS - 3, yaw: Math.PI, kind: 'photo', taken: null });
  if (!spots.some((s) => s.kind === 'dance')) for (let i = 0; i < 6; i++) spots.push({ x: -2 + rand() * 4, z: -2 + rand() * 4, yaw: 0, kind: 'dance', taken: null });

  // ---------- one draw call per material for everything that never moves ----------
  {
    const moving = new Set<THREE.Object3D>([...beaters.map((b) => b.obj), ...spinners, ...sweepers.map((x) => x.obj)]);
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const groups = new Map<string, { m: THREE.Material; gs: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>();
    const done: THREE.Mesh[] = [];
    const mtx = new THREE.Matrix4();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
      for (let q: THREE.Object3D | null = o; q && q !== root; q = q.parent) if (moving.has(q)) return;
      let g = m.geometry.clone();
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(mtx.multiplyMatrices(inv, m.matrixWorld));
      const key = m.material.uuid;
      let e = groups.get(key);
      if (!e) groups.set(key, (e = { m: m.material, gs: [], cast: false, recv: false }));
      e.gs.push(g);
      e.cast ||= m.castShadow;
      e.recv ||= m.receiveShadow;
      done.push(m);
    });
    for (const m of done) { m.removeFromParent(); m.geometry.dispose(); }
    for (const e of groups.values()) {
      const g = mergeGeometries(e.gs);
      for (const x of e.gs) x.dispose();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, e.m);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.recv;
      root.add(mesh);
    }
  }

  // ---------- people ----------
  const people: Person[] = [];
  const mkPerson = (key: string, name: string, hall: string, look: { skin: string; shirt: string; bottom: string; female: boolean; dress: boolean }, bot: boolean, moves = 0): Person => {
    const fig = figure(look);
    root.add(fig.root);
    const p: Person = { key, name, hall, bot, fig, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, tyaw: null, act: 'idle', then: 'idle', timer: 0, phase: rand() * 10, moves, say: '', sayT: 0, spot: null, gesture: null, gestureT: 0 };
    people.push(p);
    return p;
  };
  const meP = mkPerson('me', 'You', me.hall, { skin: me.skin, shirt: me.shirt, bottom: '#1e2633', female: me.female, dress: false }, false);
  meP.me = true;
  // you've just parked: start by your bike
  const myRack = rackSpots[0];
  meP.x = myRack.x * 0.72; meP.z = myRack.z * 0.72;
  meP.tx = meP.x; meP.tz = meP.z;
  meP.yaw = Math.atan2(-meP.x, -meP.z) + Math.PI;

  const free = (kind: Spot['kind']) => { const l = spots.filter((s) => s.kind === kind && !s.taken); return l.length ? l[(rand() * l.length) | 0] : null; };
  const release = (p: Person) => { if (p.spot) { p.spot.taken = null; p.spot = null; } };
  const goTo = (p: Person, x: number, z: number, then: Act, yaw: number | null = null) => {
    p.tx = x; p.tz = z; p.then = then; p.tyaw = yaw;
    p.act = Math.hypot(x - p.x, z - p.z) > 0.3 ? 'walk' : then;
  };
  const edge = () => { const a = rand() * Math.PI * 2; return { x: Math.cos(a) * (RADIUS + 6), z: Math.sin(a) * (RADIUS + 6) }; };
  const weights: Record<Theme, [Act, number][]> = {
    market: [['eat', 0.28], ['chat', 0.28], ['sit', 0.2], ['walk', 0.08], ['dance', 0.1], ['photo', 0.06]],
    jam: [['dance', 0.5], ['chat', 0.2], ['photo', 0.1], ['sit', 0.1], ['walk', 0.1]],
    square: [['chat', 0.4], ['sit', 0.3], ['walk', 0.15], ['photo', 0.08], ['dance', 0.07]],
    garden: [['sit', 0.45], ['chat', 0.28], ['photo', 0.15], ['walk', 0.12]],
    hall: [['dance', 0.32], ['chat', 0.33], ['sit', 0.1], ['photo', 0.1], ['walk', 0.08], ['eat', 0.07]],
  };
  const pickAct = (): Act => { let r = rand(); for (const [a, w] of weights[v.theme]) { if ((r -= w) <= 0) return a; } return 'chat'; };

  /** gives a bot something to do next (and friends to do it with) */
  function assign(p: Person, spread = false) {
    release(p);
    p.fig.phone.visible = p.fig.plate.visible = false;
    let a = pickAct();
    const place = (x: number, z: number, act: Act, yaw: number | null = null) => {
      if (spread) { p.x = x; p.z = z; p.act = act; p.tx = x; p.tz = z; p.tyaw = yaw; if (yaw !== null) p.yaw = yaw; }
      else goTo(p, x, z, act, yaw);
    };
    p.timer = 15 + rand() * 30;
    if (a === 'eat') { const s = free('stall'); if (s) { s.taken = p.key; p.spot = s; p.fig.plate.visible = true; return place(s.x, s.z, 'eat', s.yaw); } a = 'chat'; }
    if (a === 'sit') { const s = free('seat'); if (s) { s.taken = p.key; p.spot = s; return place(s.x, s.z, 'sit', s.yaw); } a = 'chat'; }
    if (a === 'dance') { const s = free('dance'); const x = s ? s.x : -2 + rand() * 4, z = s ? s.z : -2 + rand() * 4; if (s) { s.taken = p.key; p.spot = s; } return place(x + rand() * 0.6, z + rand() * 0.6, 'dance', null); }
    if (a === 'photo') {
      // a friend poses, this one takes the picture
      const s = spots.find((x) => x.kind === 'photo')!;
      const friend = people.find((q) => q.bot && q !== p && !q.spot && (q.act === 'walk' || q.act === 'idle' || q.act === 'chat') && rand() < 0.5);
      // the photographer stands between the spot and the middle, facing the friend
      const ang = Math.atan2(-s.x, -s.z) + (rand() - 0.5) * 0.9;
      const fx = s.x + Math.sin(ang) * 0.3, fz = s.z + Math.cos(ang) * 0.3;
      const px = fx + Math.sin(ang) * 2.2, pz = fz + Math.cos(ang) * 2.2;
      const fy = Math.atan2(px - fx, pz - fz) + Math.PI;
      if (friend) { release(friend); friend.timer = p.timer; friend.fig.phone.visible = friend.fig.plate.visible = false; if (spread) { friend.x = friend.tx = fx; friend.z = friend.tz = fz; friend.act = 'pose'; friend.yaw = fy; friend.tyaw = fy; } else goTo(friend, fx, fz, 'pose', fy); }
      p.fig.phone.visible = true;
      return place(px, pz, 'photo', Math.atan2(fx - px, fz - pz) + Math.PI);
    }
    if (a === 'walk') { const r = 2 + rand() * (RADIUS - 4), t = rand() * Math.PI * 2; p.timer = 6 + rand() * 6; return place(Math.cos(t) * r, Math.sin(t) * r, 'idle'); }
    // chat: join a group spot, standing round it
    const s = spots.filter((x) => x.kind === 'chat')[(rand() * 6) | 0];
    const ang = rand() * Math.PI * 2, r = 0.75 + rand() * 0.35;
    const x = s.x + Math.cos(ang) * r, z = s.z + Math.sin(ang) * r;
    place(x, z, 'chat', Math.atan2(s.x - x, s.z - z) + Math.PI);
  }

  // staff: vendors at the stalls, a DJ at the booth
  let performer: Person | null = null;
  for (const s of spots.filter((x) => x.kind === 'vendor' || x.kind === 'dj')) {
    const b = makeBot(rand, v.color);
    const onStage = stageSpots.includes(s);
    const lead = onStage ? s === stageSpots[0] : true;
    // the performer's act: on the decks, at the mic, or dancing with the crew
    const act: Act = s.kind === 'vendor' ? 'vendor' : !onStage ? 'dj' : kind === 'dj' ? 'dj' : kind === 'dance' ? 'crew' : lead ? 'sing' : 'crew';
    const name = s.kind === 'vendor' ? b.name
      : !onStage ? (kind === 'dj' && show ? show.who : `DJ ${b.name.split(' ')[0]}`)
      : lead && show ? (kind === 'dance' ? `${show.who}` : show.who) : kind === 'dance' && show ? `${b.name.split(' ')[0]} · ${show.who}` : b.name;
    const p = mkPerson(b.key, name, s.kind === 'vendor' || !onStage || !lead ? b.hall : show?.label ?? b.hall, { ...b, shirt: act === 'dj' ? '#111111' : act === 'crew' ? (v.color ?? '#f5c518') : b.shirt }, true, onStage ? stageSpots.indexOf(s) % 4 : b.moves);
    p.x = p.tx = s.x; p.z = p.tz = s.z; p.yaw = p.tyaw = s.yaw; p.y = s.y; p.act = p.then = act; p.timer = Infinity;
    s.taken = p.key; p.spot = s;
    if (act === 'sing') p.fig.mic.visible = true;
    if (onStage && lead) performer = p;
    else if (!onStage && s.kind === 'dj' && !performer) performer = p;
  }
  const staff = people.length - 1;
  const isStaff = (p: Person) => p.act === 'vendor' || p.act === 'dj' || p.act === 'sing' || p.act === 'crew';
  const crowdBots = () => people.filter((p) => p.bot && p.act !== 'leave' && !isStaff(p));
  const addBot = (spread: boolean) => {
    const b: BotPerson = makeBot(rand, v.color);
    const p = mkPerson(b.key, b.name, b.hall, b, true, b.moves);
    if (spread) { assign(p, true); return p; }
    // arrives: walks in from the edge, sometimes on a bike they park at the rack
    const e = edge();
    p.x = e.x; p.z = e.z;
    const s = rand() < 0.5 ? rackSpots.find((x) => !x.taken) : undefined;
    if (s) {
      s.taken = p.key;
      p.bike = simpleBike(['#c8102e', '#1f3a93', '#1b1b1b', '#f5c518', '#2e8b3a'][(rand() * 5) | 0]);
      root.add(p.bike);
      p.spot = s;
      goTo(p, s.x + Math.cos(s.yaw) * 0.5, s.z - Math.sin(s.yaw) * 0.5, 'idle');
      p.timer = 1;
    } else { assign(p); }
    return p;
  };
  const fullFor = (n: number) => Math.min(n, FULL);
  for (let i = 0, n = Math.max(0, fullFor(crowd) - people.length); i < n; i++) addBot(true);

  // ---------- the rest of the crowd ----------
  // lighter people that fill the place up to the real head count: dancing in front of the stage,
  // standing in little groups, watching. Four draw calls for all of them.
  interface Amb { x: number; z: number; yaw: number; dance: boolean; up: boolean; ph: number; shirt: THREE.Color }
  const amb: Amb[] = [];
  const ambLegs = new THREE.InstancedMesh(A.legs, A.m, AMBIENT_MAX);
  const ambDown = new THREE.InstancedMesh(A.down, A.m, AMBIENT_MAX);
  const ambUp = new THREE.InstancedMesh(A.up, A.m, AMBIENT_MAX);
  const ambHead = new THREE.InstancedMesh(A.head, A.m, AMBIENT_MAX);
  const SH = ['#f2f2f2', '#2b2f3a', '#c8102e', '#1f3a93', '#f5c518', '#2e8b3a', '#e08a1e', '#8e24aa', '#16a3a3', '#e4572e', '#ff7aa8', '#1b1b1b', '#7fb3ff', ...(v.color ? [v.color, v.color, v.color] : [])];
  const BT = ['#1e2633', '#2b3a55', '#3a3a3a', '#6b5b45', '#14161b', '#4a5a7a', '#d9c7a3'];
  const SK = ['#3b2219', '#4a2c1c', '#5a3523', '#6b4430', '#7a4b2e', '#8d5a3b'];
  const colr = new THREE.Color();
  for (const im of [ambLegs, ambDown, ambUp, ambHead]) { im.frustumCulled = false; im.count = 0; root.add(im); }
  const clearOf = (x: number, z: number) => {
    if (Math.hypot(x, z) > RADIUS + 5 || buildingAt(x + C.x, z + C.z, 0.6) || inLandmark(x + C.x, z + C.z, 0.6)) return false;
    for (const [sx, sz, r] of solid) if (Math.hypot(x - sx, z - sz) < r + 0.35) return false;
    for (const q of spots) if ((q.kind === 'seat' || q.kind === 'stall' || q.kind === 'vendor' || q.kind === 'rack' || q.kind === 'dj' || q.kind === 'photo') && Math.hypot(x - q.x, z - q.z) < 0.6) return false;
    for (const a of amb) if (Math.hypot(x - a.x, z - a.z) < 0.62) return false;
    return true;
  };
  const focusPt = stageAt ?? { x: 0, z: 0 };
  const danceSpots = spots.filter((q) => q.kind === 'dance');
  const danceTheme = v.theme === 'jam' || v.theme === 'hall' || (show && (show.kind === 'dj' || show.kind === 'dance' || show.kind === 'live'));
  function placeAmb() {
    for (let tries = 0; tries < 60; tries++) {
      let x: number, z: number, dance = false;
      const r = rand();
      if (danceTheme && r < 0.45 && danceSpots.length) {
        // the dance floor
        const d = danceSpots[(rand() * danceSpots.length) | 0];
        x = d.x + (rand() - 0.5) * 3; z = d.z + (rand() - 0.5) * 3; dance = true;
      } else if (stageAt && r < 0.7) {
        // watching the stage: a loose arc in front of it
        const a = Math.atan2(-focusPt.x, -focusPt.z) + (rand() - 0.5) * 1.6, dist = 4 + rand() * 6;
        x = focusPt.x + Math.sin(a) * dist; z = focusPt.z + Math.cos(a) * dist;
        dance = !!danceTheme && rand() < 0.5;
      } else {
        // round the edge of the place and just outside it
        const a = rand() * Math.PI * 2, dist = RADIUS - 4 + rand() * 8;
        x = Math.cos(a) * dist; z = Math.sin(a) * dist;
      }
      if (!clearOf(x, z)) continue;
      // face the stage (or the middle) if watching; groups face each other
      let yaw = Math.atan2(x - focusPt.x, z - focusPt.z) + (rand() - 0.5) * 0.6;
      const mate = !dance && amb.find((a) => !a.dance && Math.hypot(a.x - x, a.z - z) < 1.3);
      if (mate) { yaw = Math.atan2(x - mate.x, z - mate.z); }
      const i = amb.length;
      const a: Amb = { x, z, yaw, dance, up: dance && rand() < 0.35, ph: rand() * 10, shirt: new THREE.Color(SH[(rand() * SH.length) | 0]) };
      amb.push(a);
      ambLegs.setColorAt(i, colr.set(BT[(rand() * BT.length) | 0]));
      ambHead.setColorAt(i, colr.set(SK[(rand() * SK.length) | 0]));
      // bodies are split between arms-down and arms-up: their colours are set as they're drawn
      ambDown.setColorAt(i, a.shirt); ambUp.setColorAt(i, a.shirt);
      return true;
    }
    return false;
  }
  let ambWant = 0;
  const setAmb = (n: number) => {
    ambWant = Math.max(0, Math.min(AMBIENT_MAX, n));
    while (amb.length < ambWant && placeAmb());
    for (const im of [ambLegs, ambDown, ambUp, ambHead]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };
  setAmb(crowd - fullFor(crowd));
  const ambM = new THREE.Matrix4(), ambQ = new THREE.Quaternion(), ambP = new THREE.Vector3(), ambS = new THREE.Vector3(1, 1, 1), ambE = new THREE.Euler();
  function animAmb(beat: number, time: number) {
    const n = Math.min(amb.length, ambWant);
    ambLegs.count = ambHead.count = n;
    let nd = 0, nu = 0;
    for (let i = 0; i < n; i++) {
      const a = amb[i];
      const b = Math.sin((beat + a.ph * 0.05) * Math.PI);
      const bob = a.dance ? -Math.abs(b) * 0.06 : Math.sin(time * 1.3 + a.ph) * 0.008;
      const tw = a.dance ? Math.sin((beat / 2 + a.ph) * Math.PI) * 0.35 : Math.sin(time * 0.4 + a.ph) * 0.12;
      ambE.set(a.dance ? Math.abs(b) * 0.05 : 0, a.yaw + tw, a.dance ? b * 0.05 : 0);
      ambQ.setFromEuler(ambE);
      ambP.set(a.x, bob, a.z);
      ambM.compose(ambP, ambQ, ambS);
      ambLegs.setMatrixAt(i, ambM);
      ambHead.setMatrixAt(i, ambM);
      const im = a.up ? ambUp : ambDown, j = a.up ? nu++ : nd++;
      im.setMatrixAt(j, ambM);
      im.setColorAt(j, a.shirt);
    }
    ambDown.count = nd; ambUp.count = nu;
    for (const im of [ambLegs, ambDown, ambUp, ambHead]) im.instanceMatrix.needsUpdate = true;
    ambDown.instanceColor!.needsUpdate = ambUp.instanceColor!.needsUpdate = true;
  }
  /** a moment of cheering: arms go up all over */
  let cheerT = 0;
  // the movie on the outdoor screen: slow-moving shapes and colours
  let screenT = 0;
  function drawScreen(time: number) {
    if (!screenTex) return;
    const g = screenTex.c.getContext('2d')!;
    const sc = Math.floor(time / 6) % 4;
    const bgs = [['#0d2a4a', '#e08a1e'], ['#14361c', '#f5c518'], ['#3a1430', '#ff7aa8'], ['#1b1b1b', '#41e0ff']][sc];
    const gr = g.createLinearGradient(0, 0, 0, 90); gr.addColorStop(0, bgs[0]); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 160, 90);
    g.fillStyle = bgs[1]; g.globalAlpha = 0.85;
    g.beginPath(); g.arc(30 + ((time * 6) % 100), 30, 10, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1; g.fillStyle = '#050505';
    for (let i = 0; i < 3; i++) { const x = 40 + i * 35 + Math.sin(time * 0.7 + i) * 8; g.fillRect(x, 50, 10, 30); g.beginPath(); g.arc(x + 5, 45, 7, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '8px sans-serif'; g.textAlign = 'center';
    g.fillText(['Chale, where were you last night?', 'Legon will always be home.', 'Ei! This one too!', 'Meet me at the Night Market.'][sc], 80, 86);
    screenTex.t.needsUpdate = true;
  }

  // ---------- animation ----------
  const tmpV = new THREE.Vector3();
  function pose(p: Person, dt: number, beat: number) {
    const f = p.fig;
    p.phase += dt;
    const t = p.phase;
    let bodyY = 0.92, lean = 0, twist = 0;
    let aL = 0, aR = 0, zL = 0.08, zR = -0.08, lL = 0, lR = 0, nod = 0;
    const act = p.act;
    const bt = beat * Math.PI;
    switch (act) {
      case 'walk': case 'leave': {
        const s = Math.sin(t * 7.5);
        lL = s * 0.55; lR = -s * 0.55; aL = -s * 0.45; aR = s * 0.45;
        bodyY += Math.abs(Math.cos(t * 7.5)) * 0.04;
        break;
      }
      case 'sing': {
        const b = Math.sin(bt);
        aR = -2.25; zR = 0.28;
        aL = Math.sin(t * 0.9) > 0.3 ? -1.4 - Math.abs(b) * 0.4 : -0.3; zL = 0.4;
        twist = Math.sin(bt / 4) * 0.35;
        bodyY += -Math.abs(b) * 0.03;
        nod = 0.08 + Math.abs(b) * 0.06;
        break;
      }
      case 'dance': case 'dj': case 'crew': {
        const b = Math.sin(bt), half = Math.sin(bt / 2);
        bodyY += -Math.abs(b) * 0.07 + (act === 'dj' ? 0.03 : 0);
        nod = Math.abs(b) * 0.18;
        if (act === 'dj') { aL = -1.1 + b * 0.1; aR = -1.1 + (Math.sin(t * 0.7) > 0.8 ? -1.6 : 0) + b * 0.1; break; }
        switch (act === 'crew' ? Math.floor(beat / 8 + p.moves) % 4 : p.moves) {
          case 0: aL = -2.6 - half * 0.4; aR = -2.6 + half * 0.4; zL = 0.3; zR = -0.3; twist = half * 0.25; break; // hands up
          case 1: aL = -1.2 + b * 0.8; aR = -1.2 - b * 0.8; lL = Math.max(0, b) * 0.4; lR = Math.max(0, -b) * 0.4; twist = half * 0.4; break; // azonto-ish pumps
          case 2: twist = half * 0.6; aL = -0.6; aR = -0.6; zL = 0.6 + b * 0.3; zR = -0.6 + b * 0.3; lean = b * 0.08; break; // side to side
          default: aL = -0.9 - Math.abs(b) * 0.9; aR = -0.4; zR = -0.9 - b * 0.4; twist = Math.sin(bt / 4) * 0.9; lL = -Math.abs(half) * 0.3; break; // spin and point
        }
        break;
      }
      case 'chat': {
        const g = Math.sin(t * 1.3 + p.moves) > 0.55;
        aR = g ? -0.9 + Math.sin(t * 5) * 0.2 : 0;
        zR = g ? -0.3 : -0.08;
        nod = Math.max(0, Math.sin(t * 2.1)) * 0.12;
        twist = Math.sin(t * 0.5 + p.moves) * 0.15;
        break;
      }
      case 'sit':
        bodyY = (p.spot?.y ?? 0.47) + 0.03;
        lL = lR = -1.45;
        aL = aR = -0.5;
        nod = Math.max(0, Math.sin(t * 1.7)) * 0.1;
        if (p.fig.plate.visible || v.theme === 'garden') aR = -0.7 + Math.sin(t * 1.2) * 0.2;
        break;
      case 'eat': {
        const bite = (t % 3.2) < 0.9;
        aL = -1.1; aR = bite ? -2.3 : -0.9; zR = bite ? 0.2 : -0.1;
        break;
      }
      case 'vendor': {
        const serve = (t % 5) < 1;
        aL = aR = serve ? -1.3 : -0.5;
        nod = Math.sin(t * 1.5) * 0.06;
        break;
      }
      case 'photo': aR = -1.55; aL = -0.6; zL = 0.25; break;
      case 'pose': aR = -2.9; zR = -0.25; aL = 0.2; zL = 0.35; twist = Math.sin(t * 0.8) * 0.1; break;
      default: aL = Math.sin(t * 1.1) * 0.05; aR = -Math.sin(t * 1.1) * 0.05; nod = Math.sin(t * 0.9) * 0.04;
    }
    // a quick gesture on top: wave or high five
    if (p.gesture && p.gestureT > 0) {
      p.gestureT -= dt;
      if (p.gesture === 'wave') { aR = -0.3; zR = -2.5 + Math.sin(t * 12) * 0.35; }
      else if (p.gesture === 'highfive') { aR = -2.7; zR = -0.1; }
      else if (p.gesture === 'kiss') { lean = 0.16; nod = 0.12; aL = aR = -0.9; zL = 0.5; zR = -0.5; }
      if (p.gestureT <= 0) p.gesture = null;
    }
    // breathing
    f.body.scale.y = 1 + Math.sin(t * 2) * 0.008;
    const k = Math.min(1, dt * 12);
    f.body.position.y += (bodyY - f.body.position.y) * k;
    f.body.rotation.x += (lean - f.body.rotation.x) * k;
    f.body.rotation.y += (twist - f.body.rotation.y) * k;
    // the numbers above read "negative = forward / up / outward"; the rig turns the other way
    f.armL.rotation.x += (-aL - f.armL.rotation.x) * k; f.armR.rotation.x += (-aR - f.armR.rotation.x) * k;
    f.armL.rotation.z += (-zL - f.armL.rotation.z) * k; f.armR.rotation.z += (-zR - f.armR.rotation.z) * k;
    f.legL.rotation.x += (-lL - f.legL.rotation.x) * k; f.legR.rotation.x += (-lR - f.legR.rotation.x) * k;
    f.head.rotation.x = nod;
  }

  function move(p: Person, dt: number) {
    const dx = p.tx - p.x, dz = p.tz - p.z;
    const d = Math.hypot(dx, dz);
    if (p.act === 'walk' || p.act === 'leave') {
      const sp = p.me ? 2.2 : 1.25;
      if (d < 0.08) {
        p.x = p.tx; p.z = p.tz;
        if (p.act === 'leave') return true;
        p.act = p.then;
        if (p.bike && p.spot?.kind === 'rack') { parkBike(p.spot, p.bike); p.bike = undefined; p.spot = null; assign(p); }
      } else {
        const st = Math.min(d, sp * dt);
        p.x += (dx / d) * st; p.z += (dz / d) * st;
        p.yaw = turn(p.yaw, Math.atan2(dx, dz) + Math.PI, dt * 8);
        if (p.bike) { p.bike.position.set(p.x + Math.cos(p.yaw) * 0.5, 0, p.z - Math.sin(p.yaw) * 0.5); p.bike.rotation.y = p.yaw; }
      }
    } else if (p.tyaw !== null) p.yaw = turn(p.yaw, p.tyaw, dt * 5);
    // people don't stand inside each other
    if (p.act === 'walk' || p.act === 'idle' || p.act === 'chat' || p.act === 'dance') {
      for (const q of people) {
        if (q === p) continue;
        const ox = p.x - q.x, oz = p.z - q.z, od = ox * ox + oz * oz;
        if (od < 0.3 && od > 1e-6) { const s = (0.55 - Math.sqrt(od)) * 0.5; p.x += (ox / Math.sqrt(od)) * s; p.z += (oz / Math.sqrt(od)) * s; }
      }
    }
    p.fig.root.position.set(p.x, p.y ?? 0, p.z);
    p.fig.root.rotation.y = p.yaw;
    return false;
  }
  const turn = (a: number, b: number, k: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, k); };

  // ---------- labels and bubbles (DOM, over the canvas) ----------
  const labels = document.createElement('div');
  labels.className = 'life-labels';
  const tags = new Map<string, HTMLElement>();
  function drawLabels(cam: THREE.PerspectiveCamera) {
    const W = innerWidth, H = innerHeight;
    const list = people.filter((p) => !p.me || p.sayT > 0).map((p) => ({ p, d: Math.hypot(p.x - camX(), p.z - camZ()) })).sort((a, b) => a.d - b.d);
    const shown = new Set<string>();
    let n = 0;
    for (const { p, d } of list) {
      if (d > 16 || (n >= 9 && p.sayT <= 0)) continue;
      tmpV.set(p.x + C.x, 2.05 + (p.y ?? 0) + (p.act === 'sit' ? -0.45 : 0), p.z + C.z).project(cam);
      if (tmpV.z > 1 || tmpV.x < -1.1 || tmpV.x > 1.1 || tmpV.y < -1.1 || tmpV.y > 1.1) continue;
      let el = tags.get(p.key);
      if (!el) { el = document.createElement('div'); el.className = 'life-tag'; labels.appendChild(el); tags.set(p.key, el); }
      const html = `${p.sayT > 0 ? `<span class="life-say">${escapeHtml(p.say)}</span>` : ''}<b>${escapeHtml(p.me ? 'You' : p.name)}</b>${p.hall && !p.me ? `<small>${escapeHtml(p.hall)}</small>` : ''}`;
      if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
      el.style.transform = `translate(${((tmpV.x + 1) / 2) * W}px, ${((1 - tmpV.y) / 2) * H}px) translate(-50%, -100%) scale(${Math.max(0.7, 1.15 - d / 22)})`;
      el.style.opacity = String(d > 12 ? 1 - (d - 12) / 4 : 1);
      el.classList.toggle('real', !p.bot && !p.me);
      shown.add(p.key);
      n++;
    }
    for (const [k, el] of tags) if (!shown.has(k)) { el.remove(); tags.delete(k); }
  }

  // ---------- camera and controls ----------
  // start looking towards the stage, so the first thing you see is the show
  if (stageAt) meP.yaw = meP.tyaw = Math.atan2(meP.x - stageAt.x, meP.z - stageAt.z);
  let camYaw = meP.yaw, camPitch = 0.42, camDist = 7.5;
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  let camX = () => meP.x, camZ = () => meP.z;
  const keys = new Set<string>();
  let selfieT = 0;
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let lastCam: THREE.PerspectiveCamera | null = null;
  let snap = true;

  let chatterT = 2;
  let arriveT = 8;
  let t = 0;
  let wantCount = fullFor(crowd);
  const peers = new Map<string, Person>();

  const world: HangoutWorld = {
    root, focus, labels, keys,
    me: meP,
    people: () => people.filter((p) => p.act !== 'leave' && !p.me && !isStaff(p)).concat(people.filter(isStaff)),
    count: () => people.filter((p) => p.act !== 'leave').length + Math.min(amb.length, ambWant),
    setCrowd(n) { wantCount = fullFor(n); setAmb(n - wantCount); },
    staff(k) {
      if (k === 'stage') return performer;
      let best: Person | null = null, bd = Infinity;
      for (const p of people) { if (p.act !== 'vendor') continue; const d = Math.hypot(p.x - meP.x, p.z - meP.z); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    cheer() { cheerT = 2.5; },
    walkTo(x, z, short = 0) {
      release(meP);
      meP.fig.plate.visible = meP.fig.phone.visible = meP.fig.cup.visible = false;
      const d = Math.hypot(x - meP.x, z - meP.z);
      const k = d > short ? (d - short) / d : 0;
      const c = clampR(meP.x + (x - meP.x) * k, meP.z + (z - meP.z) * k);
      goTo(meP, c.x, c.z, 'idle', Math.atan2(meP.x - x, meP.z - z));
    },
    closest() {
      let best: Person | null = null, bd = Infinity;
      for (const p of people) { if (p.me || p.act === 'leave' || p.bike) continue; const d = Math.hypot(p.x - meP.x, p.z - meP.z); if (d < bd) { bd = d; best = p; } }
      return best ? { p: best, d: bd } : null;
    },
    update(dt, cam) {
      lastCam = cam;
      t += dt;
      const pb = partyBeat();
      const beat = pb ? pb.beat : t * 1.75;
      // you: keys move you relative to the camera
      let kx = 0, kz = 0;
      if (keys.has('w') || keys.has('arrowup')) kz -= 1;
      if (keys.has('s') || keys.has('arrowdown')) kz += 1;
      if (keys.has('a') || keys.has('arrowleft')) kx -= 1;
      if (keys.has('d') || keys.has('arrowright')) kx += 1;
      if (kx || kz) {
        const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
        const mx = fx * -kz + Math.cos(camYaw) * kx, mz = fz * -kz - Math.sin(camYaw) * kx;
        const l = Math.hypot(mx, mz) || 1;
        release(meP);
        meP.fig.plate.visible = meP.fig.phone.visible = false;
        goTo(meP, clampR(meP.x + (mx / l) * 1.2, meP.z + (mz / l) * 1.2).x, clampR(meP.x + (mx / l) * 1.2, meP.z + (mz / l) * 1.2).z, 'idle');
      }
      // bots: next activity, arrivals and departures
      for (const p of people) {
        if (!p.bot || p.act === 'walk' || p.act === 'leave') continue;
        if ((p.timer -= dt) <= 0) {
          if (rand() < 0.12 && crowdBots().length > wantCount * 0.6) { release(p); p.fig.phone.visible = p.fig.plate.visible = false; const e = edge(); goTo(p, e.x, e.z, 'idle'); p.act = 'leave'; }
          else assign(p);
        }
      }
      if ((arriveT -= dt) <= 0) {
        arriveT = 10 + rand() * 20;
        if (crowdBots().length + peers.size < wantCount - 1) addBot(false);
      }
      // someone says something
      if ((chatterT -= dt) <= 0) {
        chatterT = 2.5 + rand() * 4;
        const talkers = people.filter((p) => p.bot && (p.act === 'chat' || p.act === 'dance' || p.act === 'eat' || p.act === 'sit') && Math.hypot(p.x - meP.x, p.z - meP.z) < 14);
        const p = talkers[(rand() * talkers.length) | 0];
        if (p) { p.say = lineFor(v.theme, rand); p.sayT = 4; }
        // and every so often one waves at you
        const near = people.find((q) => q.bot && !isStaff(q) && !q.gesture && Math.hypot(q.x - meP.x, q.z - meP.z) < 3.2);
        if (near && rand() < 0.25) { near.gesture = 'wave'; near.gestureT = 1.6; near.tyaw = Math.atan2(meP.x - near.x, meP.z - near.z) + Math.PI; }
      }
      for (let i = people.length - 1; i >= 0; i--) {
        const p = people[i];
        if (p.sayT > 0) p.sayT -= dt;
        if (move(p, dt) && p.act === 'leave') { root.remove(p.fig.root); people.splice(i, 1); }
        else pose(p, dt, beat + p.moves * 0.05);
      }
      // the set: speakers pump, lights cycle, decks spin, beams sweep
      const pulse = Math.pow(Math.max(0, Math.cos((beat % 1) * Math.PI)), 6);
      if (cheerT > 0) { cheerT -= dt; for (let i = 0; i < amb.length; i++) if (i % 2 === 0) amb[i].up = cheerT > 0 ? true : amb[i].dance && i % 6 === 0; }
      animAmb(beat, t);
      if (screenTex && (screenT -= dt) <= 0) { screenT = 0.35; drawScreen(t); }
      for (const b of beaters) b.obj.scale.setScalar(b.base + pulse * b.amt);
      for (const g of glows) { g.m.emissive.setHSL((g.hue + beat / 16) % 1, 0.9, 0.55); g.m.emissiveIntensity = (night ? 1.2 : 0.4) + pulse * (night ? 1.6 : 0.4); }
      for (const s of spinners) s.rotation.y += dt * 3.5;
      for (const s of sweepers) { s.obj.rotation.z = Math.sin(t * 0.8 + s.ph) * 0.35; s.obj.rotation.x = Math.cos(t * 0.6 + s.ph) * 0.2; }
      // the sound system gets louder as you walk up to it
      const sd = speakers.length ? Math.min(...speakers.map((s) => Math.hypot(s.x - meP.x, s.z - meP.z))) : 12;
      setParty({ level: 1 - Math.min(1, Math.max(0, (sd - 2) / 16)), people: people.length });
      // camera: behind you, or in front for a selfie
      focus.set(C.x + meP.x, 0, C.z + meP.z);
      if (selfieT > 0) {
        selfieT -= dt;
        const fx = Math.sin(meP.yaw + Math.PI), fz = Math.cos(meP.yaw + Math.PI);
        camPos.set(C.x + meP.x + fx * 2.4, 1.85, C.z + meP.z + fz * 2.4);
        look.set(C.x + meP.x, 1.5, C.z + meP.z);
        cam.position.copy(camPos);
      } else {
        // come in closer rather than sit inside a wall or a roof
        let d = camDist;
        for (; d > 2.6; d -= 0.4) {
          const x = C.x + meP.x + Math.sin(camYaw) * Math.cos(camPitch) * d, z = C.z + meP.z + Math.cos(camYaw) * Math.cos(camPitch) * d;
          if (!buildingAt(x, z, 0.4) && !inLandmark(x, z, 0.5)) break;
        }
        camPos.set(C.x + meP.x + Math.sin(camYaw) * Math.cos(camPitch) * d, 0.6 + Math.sin(camPitch) * d + 1, C.z + meP.z + Math.cos(camYaw) * Math.cos(camPitch) * d);
        if (snap) { cam.position.copy(camPos); snap = false; } else cam.position.lerp(camPos, Math.min(1, dt * 6));
        look.set(C.x + meP.x, 1.3, C.z + meP.z);
      }
      cam.lookAt(look);
      const fov = innerWidth < innerHeight ? 66 : 55;
      if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = fov; cam.updateProjectionMatrix(); }
      drawLabels(cam);
    },
    tap(px, py) {
      const cam = lastCam;
      if (!cam) return null;
      // the nearest person to the tap on screen
      let best: Person | null = null, bd = 46;
      for (const p of people) {
        if (p.me) continue;
        for (const y of [0.9, 1.5]) {
          tmpV.set(p.x + C.x, y, p.z + C.z).project(cam);
          if (tmpV.z > 1) continue;
          const d = Math.hypot(((tmpV.x + 1) / 2) * innerWidth - px, ((1 - tmpV.y) / 2) * innerHeight - py);
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (best) return best;
      ray.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), cam);
      const hit = ray.ray.intersectPlane(plane, tmpV);
      if (hit) {
        release(meP);
        meP.fig.plate.visible = meP.fig.phone.visible = false;
        const c = clampR(hit.x - C.x, hit.z - C.z);
        goTo(meP, c.x, c.z, 'idle');
      }
      return null;
    },
    drag(dx, dy) {
      camYaw -= dx * 0.008;
      camPitch = Math.max(0.12, Math.min(1.1, camPitch + dy * 0.005));
    },
    zoom(f) { camDist = Math.max(3.5, Math.min(14, camDist * f)); },
    doAct(a) {
      release(meP);
      meP.fig.plate.visible = meP.fig.phone.visible = meP.fig.cup.visible = false;
      if (a === 'stop') { goTo(meP, meP.x, meP.z, 'idle'); return; }
      if (a === 'wave') { meP.gesture = 'wave'; meP.gestureT = 1.8; return; }
      if (a === 'dance') { const s = nearestSpot('dance'); if (s && Math.hypot(s.x - meP.x, s.z - meP.z) < 30) goTo(meP, s.x + 0.5, s.z - 0.4, 'dance'); else goTo(meP, meP.x, meP.z, 'dance'); return; }
      if (a === 'sit') { const s = nearestSpot('seat', true); if (s) { s.taken = 'me'; meP.spot = s; goTo(meP, s.x, s.z, 'sit', s.yaw); } return; }
      if (a === 'eat' || a === 'drink') {
        meP.fig.cup.visible = a === 'drink';
        meP.fig.plate.visible = a === 'eat';
        const s = nearestSpot('stall', true);
        if (s && Math.hypot(s.x - meP.x, s.z - meP.z) < 9) { s.taken = 'me'; meP.spot = s; goTo(meP, s.x, s.z, 'eat', s.yaw); }
        else goTo(meP, meP.x, meP.z, 'eat');
        return;
      }
    },
    askBot(p, kind) {
      return new Promise((res) => {
        setTimeout(() => {
          const yes = rand() < (kind === 'kiss' ? 0.6 : kind === 'flirt' ? 0.75 : 0.9);
          if (yes) {
            p.tyaw = Math.atan2(meP.x - p.x, meP.z - p.z) + Math.PI;
            meP.tyaw = Math.atan2(p.x - meP.x, p.z - meP.z) + Math.PI;
            if (kind === 'hi') { p.gesture = meP.gesture = 'wave'; p.gestureT = meP.gestureT = 1.8; p.say = ['Hey! 👋', 'Chale, how far?', 'Hi! Welcome'][(rand() * 3) | 0]; p.sayT = 3.5; }
            if (kind === 'highfive') { const mx = (p.x + meP.x) / 2, mz = (p.z + meP.z) / 2; goTo(p, mx + (p.x - mx) * 0.5 / Math.max(0.5, Math.hypot(p.x - mx, p.z - mz)), mz + (p.z - mz) * 0.5 / Math.max(0.5, Math.hypot(p.x - mx, p.z - mz)), 'idle'); p.gesture = meP.gesture = 'highfive'; p.gestureT = meP.gestureT = 1.4; p.say = '🙌'; p.sayT = 2; }
            if (kind === 'dance') { release(p); goTo(p, meP.x + 0.9, meP.z + 0.3, 'dance'); p.timer = 25; goTo(meP, meP.x, meP.z, 'dance'); p.say = 'Let’s go! 💃'; p.sayT = 3; }
            if (kind === 'photo') { release(p); goTo(p, meP.x + Math.cos(meP.yaw) * 0.7, meP.z - Math.sin(meP.yaw) * 0.7, 'pose', meP.yaw); p.timer = 8; }
            if (kind === 'kiss' || kind === 'flirt') {
              // they come close and face you
              release(p);
              const d = Math.max(0.01, Math.hypot(p.x - meP.x, p.z - meP.z)), gap = kind === 'kiss' ? 0.55 : 1;
              const x = meP.x + ((p.x - meP.x) / d) * gap, z = meP.z + ((p.z - meP.z) / d) * gap;
              goTo(p, x, z, 'idle', Math.atan2(meP.x - x, meP.z - z) + Math.PI);
              meP.tyaw = Math.atan2(x - meP.x, z - meP.z) + Math.PI;
              p.timer = 20;
              if (kind === 'kiss') setTimeout(() => { p.gesture = meP.gesture = 'kiss'; p.gestureT = meP.gestureT = 1.6; p.say = '😘'; p.sayT = 2.5; }, 900);
              else { p.say = ['Hehe 😊', 'You’re sweet', 'Stop it 🙈', 'Okay, I see you 😏'][(rand() * 4) | 0]; p.sayT = 3; }
            }
          } else { p.say = kind === 'kiss' ? ['Not yet 🙈', 'Slow down, let’s talk first', 'Hmm, maybe another time'][(rand() * 3) | 0] : ['Maybe later 🙏', 'I’m with my friends, sorry', 'Give me a minute'][(rand() * 3) | 0]; p.sayT = 3; }
          res(yes);
        }, 700 + rand() * 1200);
      });
    },
    setPeer(key, name, s) {
      let p = peers.get(key);
      if (!s) { if (p) { release(p); const e = edge(); goTo(p, e.x, e.z, 'idle'); p.act = 'leave'; peers.delete(key); } return; }
      if (!p) {
        let h = 0;
        for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 997;
        p = mkPerson(key, name, '', { skin: ['#3b2219', '#5a3523', '#7a4b2e', '#9a6440'][h % 4], shirt: `hsl(${h % 360} 60% 50%)`, bottom: '#1e2633', female: h % 2 === 0, dress: false }, false, h % 4);
        // they arrive from the bike rack
        p.x = rackSpots[0].x * 0.9; p.z = rackSpots[0].z * 0.9;
        peers.set(key, p);
      }
      p.name = name;
      const c = clampR(s.x, s.z);
      if (Math.hypot(c.x - p.x, c.z - p.z) > 0.3) goTo(p, c.x, c.z, s.act === 'walk' ? 'idle' : s.act, s.yaw);
      else { p.act = s.act === 'walk' ? 'idle' : s.act; p.tyaw = s.yaw; }
      p.fig.plate.visible = s.act === 'eat';
      p.fig.phone.visible = s.act === 'photo';
    },
    peerGesture(key, g) { const p = peers.get(key); if (p) { p.gesture = g; p.gestureT = 1.8; } },
    speak(key, text) { const p = key === 'me' ? meP : peers.get(key) ?? people.find((x) => x.key === key); if (p) { p.say = text.slice(0, 80); p.sayT = 5; } },
    nearestBot() {
      let best: Person | null = null, bd = 9;
      for (const p of people) { if (!p.bot || p.act === 'leave') continue; const d = Math.hypot(p.x - meP.x, p.z - meP.z); if (d < bd) { bd = d; best = p; } }
      return best;
    },
    meetSomeone(who) {
      const free = people.filter((q) => q.bot && !q.bike && (q.act === 'chat' || q.act === 'idle' || q.act === 'dance' || q.act === 'sit') && Math.hypot(q.x - meP.x, q.z - meP.z) < 16);
      if (who && (!who.bot || who.bike || !people.includes(who) || isStaff(who))) return null;
      if (!who && !free.length) return null;
      free.sort((a, b) => Math.hypot(a.x - meP.x, a.z - meP.z) - Math.hypot(b.x - meP.x, b.z - meP.z));
      const p = who ?? free[(rand() * Math.min(4, free.length)) | 0];
      release(p);
      p.fig.phone.visible = p.fig.plate.visible = false;
      const a = meP.yaw + Math.PI + (rand() - 0.5) * 1.2;
      const x = meP.x - Math.sin(a) * 1.3, z = meP.z - Math.cos(a) * 1.3;
      goTo(p, x, z, 'chat', Math.atan2(meP.x - x, meP.z - z) + Math.PI);
      p.timer = 30;
      p.gesture = 'wave'; p.gestureT = 1.6;
      return p;
    },
    selfie(capture) {
      selfieT = 0.25;
      meP.act = 'pose';
      meP.gesture = null;
      // render this frame from the front
      world.update(0.016, lastCam!);
      const url = capture();
      selfieT = 0;
      setTimeout(() => { if (meP.act === 'pose') meP.act = 'idle'; }, 1500);
      return url;
    },
    state: () => ({ x: Math.round(meP.x * 10) / 10, z: Math.round(meP.z * 10) / 10, yaw: Math.round(meP.yaw * 100) / 100, act: meP.act }),
    dispose() {
      labels.remove();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh && !(o as THREE.Line).isLine) return;
        if (m.geometry === A.legs || m.geometry === A.down || m.geometry === A.up || m.geometry === A.head) { (m as THREE.InstancedMesh).dispose(); return; }
        if (!(Object.values(G) as THREE.BufferGeometry[]).includes(m.geometry)) m.geometry.dispose();
        const ms = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of ms) { if (![...mats.values()].includes(x as THREE.MeshStandardMaterial)) { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); } }
      });
      for (const d of dispose) d();
    },
  };
  function nearestSpot(kind: Spot['kind'], freeOnly = false) {
    let best: Spot | null = null, bd = Infinity;
    for (const s of spots) { if (s.kind !== kind || (freeOnly && s.taken)) continue; const d = Math.hypot(s.x - meP.x, s.z - meP.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function clampR(x: number, z: number) { const d = Math.hypot(x, z), m = RADIUS + 1; return d > m ? { x: (x / d) * m, z: (z / d) * m } : { x, z }; }
  void staff;
  return world;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
