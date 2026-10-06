// Rain: falling streaks round the camera, wet dark roads with a sheen, puddles
// that mirror the sky on the roads nearby, a lower grey sky and closer fog.
// Three extra draw calls while it rains (streaks, puddles), none when dry.
//
// Usage (the lead wires this):
//   const wx = createWeatherFx(scene);
//   wx.set(rain);                 // from Game.setWeather
//   wx.update(dt, camera);        // every frame, after setTimeOfDay has run
import * as THREE from 'three';
import { NODE_XZ, ROADS } from './campusmap';
import { setWet } from './world';
import { ROAD_WIDTH } from './life';

const DROPS = 2600;
const BOX = { x: 44, y: 22, z: 44 };

function rainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, opacity: { value: 0 }, color: { value: new THREE.Color('#eef3fa') } },
    vertexShader: `
      uniform float time; uniform vec3 center;
      attribute float tip; attribute float speed;
      varying float vTip;
      void main() {
        vec3 box = vec3(${BOX.x.toFixed(1)}, ${BOX.y.toFixed(1)}, ${BOX.z.toFixed(1)});
        vec3 p = position;
        p.y -= time * speed;
        // wrap each drop into a box that follows the camera
        p = mod(p - center + box * 0.5, box) - box * 0.5 + center;
        // the streak: the top end trails up and a little sideways with the wind
        p += vec3(0.15, 1.3, 0.06) * tip * (speed / 14.0);
        vTip = tip;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float opacity; uniform vec3 color; varying float vTip;
      void main() { gl_FragColor = vec4(color, opacity * mix(1.0, 0.25, vTip)); }`,
    transparent: true,
    depthWrite: false,
  });
}

function puddleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  // an irregular blob from a few overlapping soft ellipses
  let seed = 9;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 7; i++) {
    const x = 40 + r() * 48, y = 44 + r() * 40, rx = 16 + r() * 22, ry = 10 + r() * 14;
    const grad = g.createRadialGradient(x, y, 0, x, y, rx);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    g.translate(-x, -y);
    g.beginPath();
    g.arc(x, y, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  return new THREE.CanvasTexture(c);
}

/** Candidate puddle spots on the rideable roads, every few metres. */
function puddleSpots() {
  const out: number[] = [];
  let seed = 31;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const road of ROADS) {
    if (road.cls > 3) continue;
    const half = ROAD_WIDTH[road.cls] / 2;
    for (let k = 0; k < road.nodes.length - 1; k++) {
      const a = road.nodes[k], b = road.nodes[k + 1];
      const ax = NODE_XZ[a * 2], az = NODE_XZ[a * 2 + 1], bx = NODE_XZ[b * 2], bz = NODE_XZ[b * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let t = r() * 9; t < len; t += 6 + r() * 12) {
        if (r() < 0.55) continue;
        // puddles gather near the edges more than in the crown of the road
        const side = (r() < 0.5 ? -1 : 1) * (half - 0.6 - r() * r() * (half - 0.6));
        out.push(ax + ux * t - uz * side, az + uz * t + ux * side, r() * Math.PI, 0.7 + r() * 1.2);
      }
    }
  }
  return new Float32Array(out);
}

/** Keeps a value scaled while it rains, and notices when something else resets it. */
class Damp {
  base = 0;
  applied = NaN;
  constructor(private get: () => number, private put: (v: number) => void) {}
  apply(k: number) {
    const now = this.get();
    if (now !== this.applied) this.base = now;
    this.applied = this.base * k;
    this.put(this.applied);
  }
}
class DampColor {
  base = new THREE.Color();
  applied = new THREE.Color(NaN, NaN, NaN);
  constructor(private c: THREE.Color) {}
  apply(to: THREE.Color, k: number) {
    if (!this.c.equals(this.applied)) this.base.copy(this.c);
    this.c.copy(this.base).lerp(to, k);
    this.applied.copy(this.c);
  }
}

export interface WeatherFx {
  set(rain: boolean): void;
  update(dt: number, camera: THREE.Camera): void;
}

export function createWeatherFx(scene: THREE.Scene): WeatherFx {
  // --- streaks: one line per drop, top and bottom share the drop's position ---
  const pos = new Float32Array(DROPS * 6), tip = new Float32Array(DROPS * 2), speed = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = Math.random() * BOX.x, y = Math.random() * BOX.y, z = Math.random() * BOX.z, s = 12 + Math.random() * 6;
    pos.set([x, y, z, x, y, z], i * 6);
    tip.set([0, 1], i * 2);
    speed.set([s, s], i * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
  geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
  const rainMat = rainMaterial();
  const streaks = new THREE.LineSegments(geo, rainMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 5;
  streaks.visible = false;
  scene.add(streaks);

  // --- puddles: a pool of mirror-like patches moved onto the roads near the camera ---
  const spots = puddleSpots();
  const POOL = 48;
  const puddleMat = new THREE.MeshStandardMaterial({
    color: '#3a4250', roughness: 0.04, metalness: 0.85, alphaMap: puddleTexture(), transparent: true, opacity: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16, envMapIntensity: 1.6,
  });
  const puddles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), puddleMat, POOL);
  puddles.count = 0;
  puddles.frustumCulled = false;
  puddles.renderOrder = 1;
  puddles.visible = false;
  scene.add(puddles);
  const placedAt = new THREE.Vector3(1e9, 0, 0);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const placePuddles = (cx: number, cz: number) => {
    let n = 0;
    const near: [number, number][] = [];
    for (let i = 0; i < spots.length; i += 4) {
      const d = Math.hypot(spots[i] - cx, spots[i + 1] - cz);
      if (d < 75) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, i] of near) {
      if (n >= POOL) break;
      const s = spots[i + 3];
      m.compose(v.set(spots[i], 0.02, spots[i + 1]), q.setFromAxisAngle(up, spots[i + 2]), sc.set(s * 1.6, 1, s));
      puddles.setMatrixAt(n++, m);
    }
    puddles.count = n;
    puddles.instanceMatrix.needsUpdate = true;
  };

  // --- the sky, fog and light dim while it rains ---
  const sky = scene.children.find((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms?.top) as THREE.Mesh | undefined;
  const skyU = sky ? (sky.material as THREE.ShaderMaterial).uniforms : null;
  const lights = scene.children.filter((o) => (o as THREE.DirectionalLight).isDirectionalLight || (o as THREE.HemisphereLight).isHemisphereLight) as THREE.Light[];
  const lightDamp = lights.map((l) => new Damp(() => l.intensity, (x) => (l.intensity = x)));
  const fog = () => scene.fog as THREE.Fog | null;
  const fogFar = new Damp(() => fog()?.far ?? 0, (x) => fog() && (fog()!.far = x));
  const fogNear = new Damp(() => fog()?.near ?? 0, (x) => fog() && (fog()!.near = x));
  const fogColor = scene.fog ? new DampColor((scene.fog as THREE.Fog).color) : null;
  const skyTop = skyU ? new DampColor(skyU.top.value) : null;
  const skyBottom = skyU ? new DampColor(skyU.bottom.value) : null;
  const grey = new THREE.Color('#7d8794'), greyTop = new THREE.Color('#4f5a68');

  let raining = false;
  let k = 0; // 0 dry .. 1 full rain, eased
  let t = 0;
  let wasActive = false;
  let cloudBase = skyU?.cloud?.value ?? 0.4;
  const cam = new THREE.Vector3();

  return {
    set(rain: boolean) {
      raining = rain;
    },
    update(dt: number, camera: THREE.Camera) {
      k += ((raining ? 1 : 0) - k) * Math.min(1, dt * 0.8);
      if (!raining && k < 0.01) k = 0;
      const active = k > 0;
      if (!active && !wasActive) return;
      wasActive = active;
      t += dt;
      camera.getWorldPosition(cam);
      streaks.visible = puddles.visible = active;
      rainMat.uniforms.time.value = t;
      rainMat.uniforms.center.value.copy(cam);
      rainMat.uniforms.opacity.value = 0.8 * k;
      puddleMat.opacity = 0.85 * k;
      if (Math.hypot(cam.x - placedAt.x, cam.z - placedAt.z) > 25) {
        placedAt.copy(cam);
        placePuddles(cam.x, cam.z);
      }
      setWet(k);
      for (const d of lightDamp) d.apply(1 - 0.35 * k);
      fogFar.apply(1 - 0.45 * k);
      fogNear.apply(1 - 0.6 * k);
      // night stays dark: grey the sky only as far as it is already bright
      const lum = skyBottom ? skyBottom.base.getHSL({ h: 0, s: 0, l: 0 }).l : 0.5;
      const gk = 0.65 * k * Math.min(1, lum * 1.6);
      fogColor?.apply(grey, gk);
      skyBottom?.apply(grey, gk);
      skyTop?.apply(greyTop, gk);
      // rain clouds over: more cover while it rains, back to the time of day's own after
      if (skyU?.cloud) {
        if (k < 0.02) cloudBase = skyU.cloud.value;
        else skyU.cloud.value = cloudBase + (0.85 - cloudBase) * k;
      }
    },
  };
}
