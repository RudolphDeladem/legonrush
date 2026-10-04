import * as THREE from 'three';

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
  setBikeColor(color: string): void;
}

export function buildRider(jersey: string, bikeColor: string): RiderRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // --- bike (faces -z) ---
  const frameMat = std(bikeColor, { metalness: 0.5, roughness: 0.35 });
  const dark = std('#1b1d22', { roughness: 0.5 });
  const metal = std('#c9ccd2', { metalness: 0.8, roughness: 0.3 });

  const wheels: THREE.Object3D[] = [];
  const wheelR = 0.34;
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.045, 10, 28), dark);
    tyre.rotation.y = Math.PI / 2;
    w.add(tyre);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, wheelR * 2, 4), metal);
      spoke.rotation.x = (i / 6) * Math.PI;
      w.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10), metal);
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    w.position.set(0, wheelR + 0.045, z);
    body.add(w);
    wheels.push(w);
  }

  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.03, mat: THREE.Material = frameMat) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    body.add(m);
    return m;
  };
  const hubY = wheelR + 0.045;
  const bb = new THREE.Vector3(0, 0.36, 0.05); // bottom bracket
  const seatTop = new THREE.Vector3(0, 0.86, 0.2);
  const headTop = new THREE.Vector3(0, 0.9, -0.42);
  const headLow = new THREE.Vector3(0, 0.66, -0.45);
  const rearHub = new THREE.Vector3(0, hubY, 0.55);
  const frontHub = new THREE.Vector3(0, hubY, -0.55);
  tube(bb, seatTop);
  tube(seatTop, headTop);
  tube(bb, headLow, 0.035);
  tube(bb, rearHub, 0.022);
  tube(seatTop, rearHub, 0.02);
  tube(headTop, frontHub, 0.025, metal);
  tube(headTop, new THREE.Vector3(0, 1.0, -0.4), 0.025, metal);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.56, 8), dark);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.0, -0.4);
  body.add(bar);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.26), dark);
  seat.position.set(0, 0.9, 0.22);
  body.add(seat);

  const crank = new THREE.Group();
  crank.position.copy(bb);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16), metal);
  ring.rotation.z = Math.PI / 2;
  crank.add(ring);
  body.add(crank);

  // --- rider ---
  const jerseyMat = std(jersey, { roughness: 0.6 });
  const skin = std('#7a4b2e', { roughness: 0.6 });
  const shorts = std('#1c2433');
  const helmetMat = std('#f5c518', { roughness: 0.35, metalness: 0.2 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 12), jerseyMat);
  torso.position.set(0, 1.25, -0.02);
  torso.rotation.x = -0.85;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  head.position.set(0, 1.58, -0.3);
  body.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmetMat);
  helmet.position.copy(head.position).add(new THREE.Vector3(0, 0.02, 0.01));
  helmet.scale.set(1, 0.95, 1.2);
  body.add(helmet);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), skin);
    const shoulder = new THREE.Vector3(side * 0.19, 1.42, -0.18);
    const hand = new THREE.Vector3(side * 0.24, 1.02, -0.4);
    arm.position.copy(shoulder).lerp(hand, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hand.clone().sub(shoulder).normalize());
    body.add(arm);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.1, 4, 8), jerseyMat);
    sleeve.position.copy(shoulder).lerp(hand, 0.15);
    sleeve.quaternion.copy(arm.quaternion);
    body.add(sleeve);
  }

  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.98, 0.16);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), shorts);
    thigh.position.set(0, -0.2, 0);
    hip.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), skin);
    shin.position.set(0, -0.52, 0.02);
    hip.add(shin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.2), dark);
    shoe.position.set(0, -0.72, -0.04);
    hip.add(shoe);
    body.add(hip);
    legs.push(hip);
  }

  shadowed(root);
  return {
    root, body, wheels, crank, legs: legs as [THREE.Object3D, THREE.Object3D],
    setJersey: (c) => jerseyMat.color.set(c),
    setBikeColor: (c) => frameMat.color.set(c),
  };
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
  trotro: { kind: 'trotro', width: 2.0, length: 5.2, clearHeight: Infinity, hazard: false },
  pedestrian: { kind: 'pedestrian', width: 0.6, length: 0.5, clearHeight: Infinity, hazard: false },
  barrier: { kind: 'barrier', width: 2.0, length: 0.4, clearHeight: 0.55, hazard: false },
  pothole: { kind: 'pothole', width: 1.4, length: 1.2, clearHeight: 0.12, hazard: true },
};

const CAR_COLORS = ['#c0392b', '#ecf0f1', '#2c3e50', '#7f8c8d', '#1e5aa8', '#d4ac0d', '#111111'];
const PEOPLE_COLORS = ['#e74c3c', '#27ae60', '#f39c12', '#8e44ad', '#2980b9', '#ecf0f1', '#d35400'];
const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];

const shared = {
  wheel: new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2),
  tyre: std('#16171a', { roughness: 0.9 }),
  glass: std('#22303d', { roughness: 0.1, metalness: 0.6 }),
  light: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe08a', emissiveIntensity: 0.8 }),
  tail: new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2b20', emissiveIntensity: 0.6 }),
};

function vehicle(len: number, width: number, bodyH: number, cabinH: number, color: string, cabinLen: number, cabinOffset: number) {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.35, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, bodyH, len), paint);
  body.position.y = 0.3 + bodyH / 2;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, cabinH, cabinLen), shared.glass);
  cabin.position.set(0, 0.3 + bodyH + cabinH / 2, cabinOffset);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.06, cabinLen * 0.96), paint);
  roof.position.set(0, 0.3 + bodyH + cabinH, cabinOffset);
  g.add(roof);
  for (const x of [-width / 2 + 0.05, width / 2 - 0.05]) {
    for (const z of [-len / 2 + 0.75, len / 2 - 0.75]) {
      const w = new THREE.Mesh(shared.wheel, shared.tyre);
      w.position.set(x, 0.33, z);
      g.add(w);
    }
  }
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

export function buildObstacle(kind: ObstacleKind): THREE.Object3D {
  let o: THREE.Object3D;
  switch (kind) {
    case 'car':
      o = vehicle(4.2, 1.8, 0.7, 0.55, pick(CAR_COLORS), 2.1, 0.2);
      break;
    case 'trotro': {
      o = vehicle(5.2, 2.0, 1.25, 0.7, pick(['#f1c40f', '#e8e8e8', '#d35400', '#2e86c1']), 4.4, 0.2);
      // luggage on the roof rack
      const bags = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.6), std(pick(['#6e2c00', '#1f618d', '#7d3c98'])));
      bags.position.set(0, 0.3 + 1.25 + 0.7 + 0.22, 0.6);
      o.add(bags);
      break;
    }
    case 'pedestrian': {
      o = new THREE.Group();
      const shirt = std(pick(PEOPLE_COLORS));
      const skin = std(pick(['#5a3825', '#7a4b2e', '#8d5a3b', '#4a2c1c']));
      const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), std('#2c3e50'));
      legs.position.y = 0.45;
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), shirt);
      torso.position.y = 1.15;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
      head.position.y = 1.62;
      o.add(legs, torso, head);
      if (Math.random() < 0.5) {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.16), std(pick(['#111', '#5d4037', '#1a237e'])));
        bag.position.set(0, 1.15, 0.22);
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
