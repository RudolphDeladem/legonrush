import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BikeSpec } from '../data/campus';
import { CAMPUS_LOOP, type Route, type RideStep } from './routes';
import { sfx } from '../audio';
import { buildCoin, buildObstacle, buildRider, OBSTACLES, type ObstacleKind, type ObstacleSpec, type RiderLook, type RiderRig } from './models';
import type { Track } from './track';
import { buildLandmarks } from './landmarks';
import { buildCampus, buildRouteLayer, buildSky, disposeLayer, lampGlow, LANES, ROAD_HALF } from './world';
import { buildingAt } from './campusmap';
import { setNightLights } from './life';
import { createWeatherFx, type WeatherFx } from './weatherfx';

/** 'pedal' is one tap of the pedal; see Game.pedal() for press/release */
export type Action = 'left' | 'right' | 'jump' | 'boost' | 'pedal';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Weather = 'clear' | 'rain';
/** shop upgrade levels, 0..3 each */
export interface Upgrades { speed: number; grip: number; boost: number }
/** one-ride items from the shop */
export interface RideItems { energy: boolean; repairKits: number }

export interface HudState {
  distance: number;
  routeLength: number;
  coins: number;
  boost: number;
  boosting: boolean;
  speed: number;
  countdown: string | null;
  /** rider position on the map (metres, +x east, -z north) and heading */
  pos: [number, number];
  yaw: number;
  /** explore rides: the next direction and how far away it is */
  next: { text: string; turn: string; dist: number } | null;
  /** seconds behind the first rival (negative: ahead), when racing one */
  ghostGap: number | null;
  /** your place among the rivals, when racing more than one */
  place: { pos: number; of: number } | null;
  /** crash helmets left: each one saves a ride from one crash */
  helmets: number;
  /** holding the brake (only with brakes fitted) */
  braking: boolean;
  /** speed for display, in km/h (scaled to what a fast cyclist would see) */
  kmh: number;
  /** rider's legs: 1 fresh, drains while boosting, refills while cruising; low stamina slows you */
  stamina: number;
  /** riding in a rival's slipstream */
  drafting: boolean;
  /** pedal rhythm 0..1: steady pedal taps build it for a small speed bonus */
  rhythm: number;
  /** repair kits left this ride */
  repairKits: number;
  /** stopped to fix the bike with a repair kit */
  repairing: boolean;
}

/** A recorded ride: road distance and lateral offset every `step` seconds. */
export interface GhostRun {
  step: number;
  d: number[];
  x: number[];
}
const GHOST_STEP = 0.1;

/** Another rider on the road: your best run, a friend's challenge or a bot, replayed from a recording. */
export interface Rival {
  run: GhostRun;
  name: string;
  color: string;
  /** see-through, for your own best run */
  ghostly: boolean;
  /** someone riding right now: their run grows as their position arrives over the network */
  live?: boolean;
  /** a bot that rides live in this ride (dodges traffic, makes mistakes, rubber-bands); its run is recorded as it rides */
  bot?: BotStyle;
}

/** How a bot rides. */
export interface BotStyle {
  /** speed relative to an average rider (about 0.9..1.1) */
  pace: number;
  /** favourite lane 0..2 and offset inside it (-0.5..0.5 m): every rider has their own line */
  lane: number;
  line: number;
  /** 0..1: higher reacts sooner to traffic and makes fewer mistakes */
  skill: number;
}

interface BotState {
  d: number; x: number; vx: number; y: number; vy: number; v: number;
  lane: number;
  /** seconds left of a mistake (wobble and slow down) or a knock */
  slowT: number;
  nextMistake: number;
  /** seconds until the bot next looks at the road ahead */
  think: number;
  wide: number;
  prevD: number;
}

/** how far behind real time live riders are drawn, so their position can be smoothed between updates */
const LIVE_LAG = 0.8;

interface RivalState extends Rival {
  rig: RiderRig;
  crank: number;
  finish: number;
  lean: number;
  sim?: BotState;
}

/** Ramps, speed bumps and puddles: road features that are not obstacles. */
interface Feature {
  kind: 'ramp' | 'bump' | 'puddle';
  mesh: THREE.Object3D;
  d: number;
  x: number;
  /** width across the road, length along it */
  w: number;
  len: number;
  done: boolean;
}

interface Treasure {
  mesh: THREE.Object3D;
  d: number;
  x: number;
  lane: number;
  taken: boolean;
  t: number;
}

const DIFF: Record<Difficulty, { gap: number; double: number; moving: number; botPace: number; catchUp: number; ease: number }> = {
  easy: { gap: 1.35, double: 0.14, moving: 0.3, botPace: 0.93, catchUp: 0.04, ease: 0.16 },
  normal: { gap: 1, double: 0.25, moving: 0.4, botPace: 1, catchUp: 0.1, ease: 0.08 },
  hard: { gap: 0.78, double: 0.36, moving: 0.5, botPace: 1.06, catchUp: 0.16, ease: 0.03 },
};

/** small seeded random generator, for treasure spots everyone on a route shares */
function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared meshes for road features, built once. */
let featureKit: { ramp: THREE.BufferGeometry; rampMat: THREE.Material; bump: THREE.BufferGeometry; bumpMat: THREE.Material; puddle: THREE.BufferGeometry; puddleMat: THREE.Material; gem: THREE.BufferGeometry; gemMat: THREE.Material } | null = null;
const RAMP = { w: 1.9, len: 3.2, h: 0.7 };
function kit() {
  if (featureKit) return featureKit;
  // a wedge rising along the direction of travel (-z)
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(RAMP.len, 0), new THREE.Vector2(RAMP.len, RAMP.h)]);
  const ramp = new THREE.ExtrudeGeometry(shape, { depth: RAMP.w, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-RAMP.w / 2, 0, 0);
  const bump = new THREE.CapsuleGeometry(0.34, ROAD_HALF * 2 - 0.8, 2, 8).rotateZ(Math.PI / 2).scale(1, 0.4, 1);
  const puddle = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  const gem = new THREE.OctahedronGeometry(0.32, 0).scale(1, 1.35, 1);
  featureKit = {
    ramp,
    rampMat: new THREE.MeshStandardMaterial({ color: '#c08a4e', roughness: 0.85 }),
    bump,
    bumpMat: new THREE.MeshStandardMaterial({ color: '#f2c81e', roughness: 0.6, emissive: '#3a2a00', polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -14 }),
    puddle,
    puddleMat: new THREE.MeshStandardMaterial({ color: '#8fa6b8', roughness: 0.05, metalness: 0.85, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 }),
    gem,
    gemMat: new THREE.MeshStandardMaterial({ color: '#ffcf3a', metalness: 1, roughness: 0.22, emissive: '#8a5a00', emissiveIntensity: 0.6 }),
  };
  return featureKit;
}

export interface RideEnd {
  distance: number;
  coins: number;
  time: number;
  finished: boolean;
}

interface Obstacle {
  spec: ObstacleSpec;
  mesh: THREE.Object3D;
  lane: number;
  /** lateral offset from the road centre */
  x: number;
  d: number;
  vd: number;
  /** cruising speed it returns to after braking */
  cruise: number;
  hit: boolean;
  /** rider has gone past it (near-miss checked) */
  passed: boolean;
  /** seconds until this car may honk again */
  honk: number;
  /** lateral shift while giving way to the rider */
  shift: number;
  fling?: THREE.Vector3;
}

/** A student walking along the pavement: scenery, not an obstacle. */
interface Walker {
  mesh: THREE.Object3D;
  d: number;
  x: number;
  v: number;
  t: number;
}

interface Coin {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  d: number;
  taken: boolean;
  t: number;
}

type Phase = 'showcase' | 'cinematic' | 'countdown' | 'riding' | 'crashed' | 'finished';

export type TimeOfDay = 'day' | 'sunset' | 'night';

const SKIES: Record<TimeOfDay, { lamps: number; top: string; bottom: string; fog: [number, number]; sun: string; sunI: number; sunPos: [number, number, number]; hemiSky: string; hemiGround: string; hemiI: number; env: number; exposure: number }> = {
  day: { lamps: 0, top: '#3f7fcf', bottom: '#f2d7b0', fog: [70, 340], sun: '#fff1d6', sunI: 2.6, sunPos: [-30, 45, 20], hemiSky: '#cfe3ff', hemiGround: '#5a6b3a', hemiI: 1.1, env: 0.35, exposure: 1.05 },
  sunset: { lamps: 0.5, top: '#2b3f7a', bottom: '#ff9a4a', fog: [60, 300], sun: '#ffb070', sunI: 2.4, sunPos: [-40, 14, -60], hemiSky: '#ffc59a', hemiGround: '#4a3a2a', hemiI: 0.8, env: 0.3, exposure: 1.0 },
  night: { lamps: 1, top: '#03060f', bottom: '#1b2650', fog: [40, 220], sun: '#9fb6ff', sunI: 0.55, sunPos: [20, 40, 10], hemiSky: '#3a4f8a', hemiGround: '#10131c', hemiI: 0.45, env: 0.12, exposure: 1.15 },
};

const GRAVITY = 22;
const JUMP_V = 7;
const RIDER_LEN = 1.6;
const RIDER_W = 0.6;
const REPAIR_TIME = 1.8;
const NEAR_MISS_COINS = 2;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
  private sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  private sky: THREE.Mesh;
  private hemi = new THREE.HemisphereLight('#cfe3ff', '#5a6b3a', 1.1);
  private sunOffset = new THREE.Vector3(-30, 45, 20);
  private cine = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private rider: RiderRig;
  private route: Route = CAMPUS_LOOP;
  private track: Track = CAMPUS_LOOP.track;
  private routeLayer: THREE.Group | null = null;
  private timer = new THREE.Timer();
  private headlight = new THREE.SpotLight('#fff1cf', 0, 45, 0.55, 0.6, 1.2);
  private rivals: RivalState[] = [];
  private rigPool: { rig: RiderRig; mat: THREE.MeshStandardMaterial }[] = [];
  private rec: GhostRun = { step: GHOST_STEP, d: [], x: [] };

  private phase: Phase = 'showcase';
  paused = false;
  /** tutorial: obstacles wait until the rider has tried every move */
  private holdSpawns = false;

  // rider state
  private d = 0;
  private x = 0;
  private y = 0;
  private vy = 0;
  private lane = 1;
  private speed = 0;
  private slowTimer = 0;
  private boost = 0;
  private boostTime = 0;
  private coins = 0;
  private time = 0;
  private endTimer = 0;
  private countdownT = 0;
  private lastCount = '';
  private bike: BikeSpec | null = null;
  private crank = 0;
  private lean = 0;
  private shake = 0;
  /** gear from the shop: crash helmets left and brake level (0 none, 1 rim, 2 disc) */
  private helmets = 0;
  private brakeLevel = 0;
  private braking = false;
  /** seconds of no-crash time after a helmet saves you */
  private shield = 0;

  // ride settings (kept across rides until changed)
  private upgrades: Upgrades = { speed: 0, grip: 0, boost: 0 };
  private difficultyLevel: Difficulty = 'normal';
  private items: RideItems = { energy: false, repairKits: 0 };
  private weather: Weather = 'clear';
  private treasureCfg = { count: 0, seed: 1 };

  // ride state for the newer moves
  private vx = 0;
  private stamina = 1;
  private drafting = false;
  private draftHold = 0;
  private rhythm = 0;
  private pedalDown = false;
  private lastTap = -10;
  private tapGap = 0;
  private repairKits = 0;
  private repairT = 0;
  private puddleT = 0;
  private onRamp = false;
  private prevD = 0;
  private honkCool = 0;
  private features: Feature[] = [];
  private treasures: Treasure[] = [];
  private treasureFound = 0;
  private photo = false;
  private photoYaw = 0;
  private photoPitch = 0.35;

  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private nextSpawn = 0;
  private dynamic = new THREE.Group();
  private walkers: Walker[] = [];
  private orbit = 0;

  onHud: (h: HudState) => void = () => {};
  /** no camera shake, steady field of view, slow menu camera */
  reducedMotion = false;
  /** auto graphics: called once when a ride runs too slowly on high */
  onSlow: () => void = () => {};
  watchSpeed = false;
  private quality: 'high' | 'low' = 'high';
  private fpsFrames = 0;
  private fpsTime = 0;
  private lowEnd: boolean;
  /** no traffic or obstacles: for learning the way */
  calm = false;
  onEnd: (r: RideEnd) => void = () => {};
  /** a helmet just saved the rider from a crash; how many are left */
  onHelmet: (left: number) => void = () => {};
  onAction: (a: Action) => void = () => {};
  /** passed close to a car, rider or barrier without touching it (2 bonus coins are already counted) */
  onNearMiss: () => void = () => {};
  /** started (true) or stopped (false) riding in a rival's slipstream */
  onDraft: (on: boolean) => void = () => {};
  /** a ramp or speed bump threw the rider into the air */
  onJump: () => void = () => {};
  /** a repair kit fixed the bike after a crash; how many are left */
  onRepair: (left: number) => void = () => {};
  /** picked up a treasure; how many found so far this ride */
  onTreasure: (found: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4 || Math.min(screen.width, screen.height) < 500;
    this.lowEnd = lowEnd;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd || devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // soft image-based lighting so metal and paint read properly
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const horizon = '#f2d7b0';
    this.scene.fog = new THREE.Fog(horizon, 70, 340);
    this.sky = buildSky('#3f7fcf', horizon);
    this.scene.add(this.sky);

    this.scene.add(this.hemi);
    this.sun.position.set(-30, 45, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildCampus(), buildLandmarks());
    this.setRoute(CAMPUS_LOOP);
    this.scene.add(this.dynamic);

    this.rider = buildRider('#d64545', '#f2c230');
    this.scene.add(this.rider.root);
    // a lamp on the handlebars for night rides
    this.headlight.position.set(0, 1.1, -0.5);
    this.headlight.target.position.set(0, 0, -14);
    this.rider.root.add(this.headlight, this.headlight.target);


    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** low: no shadows and a lower resolution, for cheap phones */
  setQuality(q: 'high' | 'low') {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.sun.castShadow = q === 'high';
    this.renderer.setPixelRatio(q === 'low' ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, this.lowEnd ? 1.5 : 2));
    this.resize();
    // materials compiled with shadows must be rebuilt
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  get currentQuality() {
    return this.quality;
  }

  get currentRoute() {
    return this.route;
  }

  /** Swaps the ridden route; the campus itself stays. */
  setRoute(route: Route) {
    if (this.routeLayer) {
      this.scene.remove(this.routeLayer);
      disposeLayer(this.routeLayer);
    }
    this.route = route;
    this.track = route.track;
    this.routeLayer = buildRouteLayer(route.track, {
      start: route.lead,
      finish: route.lead + route.length,
      startText: route.kind === 'explore' ? route.from.name : 'Start',
      finishText: route.kind === 'explore' ? route.to.name : 'Finish',
      labels: route.labels,
      destination: route.to,
    });
    this.scene.add(this.routeLayer);
    if (this.rider) this.reset(); // the constructor resets once the rider exists
  }

  /** Next direction ahead of the rider, for the explore HUD. */
  private nextStep(): { step: RideStep; dist: number } | null {
    for (const step of this.route.steps) {
      if (step.turn === 'start') continue;
      if (step.d > this.d - 3) return { step, dist: Math.max(0, step.d - this.d) };
    }
    return null;
  }

  setLook(look: RiderLook, bikeColor: string) {
    this.rider.setLook(look);
    this.rider.setBikeColor(bikeColor);
  }

  setTimeOfDay(t: TimeOfDay) {
    setNightLights(t === 'night');
    const k = SKIES[t];
    const mat = this.sky.material as THREE.ShaderMaterial;
    mat.uniforms.top.value.set(k.top);
    mat.uniforms.bottom.value.set(k.bottom);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(k.bottom);
    [fog.near, fog.far] = k.fog;
    this.sun.color.set(k.sun);
    this.sun.intensity = k.sunI;
    this.sunOffset.set(...k.sunPos);
    this.hemi.color.set(k.hemiSky);
    this.hemi.groundColor.set(k.hemiGround);
    this.hemi.intensity = k.hemiI;
    this.scene.environmentIntensity = k.env;
    this.renderer.toneMappingExposure = k.exposure;
    lampGlow.head.emissiveIntensity = k.lamps * 2.5;
    lampGlow.pool.opacity = k.lamps * 0.45;
    lampGlow.pool.visible = k.lamps > 0;
    this.headlight.intensity = k.lamps * 90;
  }

  /** Your best run on this route, to race against; null for none. */
  setGhost(g: GhostRun | null) {
    this.setRivals(g ? [{ run: g, name: 'Best run', color: '#9fd8ff', ghostly: true }] : []);
  }

  /** Riders replayed beside you; the first one is the gap shown in the HUD. */
  setRivals(list: Rival[]) {
    for (const p of this.rigPool) p.rig.root.visible = false;
    this.rivals = list.filter((r) => r.live || r.run.d.length > 1).map((r, i) => {
      let p = this.rigPool[i];
      if (!p) {
        const rig = buildRider('#ffffff', '#ffffff');
        const mat = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
        rig.root.traverse((o) => {
          if (o instanceof THREE.Mesh) { o.material = mat; o.castShadow = false; }
        });
        rig.root.visible = false;
        this.scene.add(rig.root);
        p = this.rigPool[i] = { rig, mat };
      }
      p.mat.color.set(r.color);
      p.mat.emissive.set(r.color);
      p.mat.emissiveIntensity = r.ghostly ? 0.4 : 0.15;
      p.mat.opacity = r.ghostly ? 0.38 : 0.7;
      return { ...r, rig: p.rig, crank: 0, lean: 0, finish: r.bot ? Infinity : this.finishTime(r.run) };
    });
  }

  /** When a recorded run crossed the finish line, in seconds; Infinity if it never did. */
  private finishTime(g: GhostRun) {
    for (let i = 1; i < g.d.length; i++) {
      if (g.d[i] >= this.route.length) {
        const k = (this.route.length - g.d[i - 1]) / Math.max(1e-6, g.d[i] - g.d[i - 1]);
        return (i - 1 + Math.min(1, Math.max(0, k))) * g.step;
      }
    }
    return Infinity;
  }

  /** a rival's ride time: live riders are drawn slightly in the past */
  private rivalT(r: Rival) {
    return r.live ? Math.max(0, this.time - LIVE_LAG) : this.time;
  }

  /** Your ride so far, growing as you ride, to stream to the people riding with you. */
  get recording(): GhostRun {
    return this.rec;
  }

  /** Finish times of the rivals in this ride, in order. */
  get rivalTimes() {
    return this.rivals.map((r) => {
      // a bot still riding when you stop: its time at the pace it has now
      if (r.sim && r.finish === Infinity) return { name: r.name, time: this.time + Math.max(0, this.route.length - r.sim.d) / Math.max(4, r.sim.v) };
      return { name: r.name, time: r.finish };
    });
  }

  /** The ride just finished, sampled for a ghost. */
  get lastRun(): GhostRun {
    return { step: this.rec.step, d: this.rec.d.slice(), x: this.rec.x.slice() };
  }

  /** A recorded run's distance and offset at ride time t. */
  private runAt(g: GhostRun, t: number): [number, number] {
    if (!g.d.length) return [0, 0];
    const f = t / g.step;
    const i = Math.min(Math.floor(f), g.d.length - 1);
    const j = Math.min(i + 1, g.d.length - 1);
    const k = Math.min(1, f - i);
    return [g.d[i] + (g.d[j] - g.d[i]) * k, g.x[i] + (g.x[j] - g.x[i]) * k];
  }

  /** Fixed camera for trailers and marketing shots; offsets are relative to the rider. */
  cinematic(d: number, lane: number, cam: [number, number, number], look: [number, number, number]) {
    this.reset();
    this.phase = 'cinematic';
    this.d = d;
    this.lane = lane;
    this.x = LANES[lane];
    const p = this.pose(d, this.x);
    // offsets are in the rider's frame: x right, y up, z behind
    const local = (o: [number, number, number]) => new THREE.Vector3(p.x + p.nx * o[0] - p.tx * o[2], o[1], p.z + p.nz * o[0] - p.tz * o[2]);
    this.cine.pos.copy(local(cam));
    this.cine.look.copy(local(look));
  }

  /** Places traffic and coins ahead of the rider for staged shots. */
  stage(items: { kind: ObstacleKind | 'coin'; lane: number; ahead: number }[]) {
    for (const it of items) {
      if (it.kind === 'coin') this.addCoin(LANES[it.lane], 0.9, this.d + it.ahead);
      else this.addObstacle(it.kind, it.lane, this.d + it.ahead);
    }
  }

  /** Idle camera orbiting the rider, used behind menus. */
  showcase() {
    this.reset();
    this.phase = 'showcase';
    this.dressing = false;
    this.setTimeOfDay('day');
  }

  /** a close orbit with the rider in the top half of the screen, for dressing the rider */
  dressView() {
    if (this.phase !== 'showcase') this.showcase();
    // start from the front, so the face, glasses and outfit show first
    if (!this.dressing) this.orbit = Math.PI * 0.8;
    this.dressing = true;
  }
  private dressing = false;

  start(bike: BikeSpec, tutorial: boolean) {
    this.reset();
    this.bike = bike;
    this.holdSpawns = tutorial;
    this.nextSpawn = tutorial ? 200 : 90;
    this.phase = 'countdown';
    this.countdownT = tutorial ? 0.01 : 2.4;
    this.lastCount = '';
    this.setTimeOfDay(this.route.time ?? 'day');
    this.repairKits = this.items.repairKits;
    for (const r of this.rivals) {
      r.rig.root.visible = true;
      if (r.bot) {
        // bots ride live: their run is written as they go
        const x = LANES[r.bot.lane] + r.bot.line;
        r.run = { step: GHOST_STEP, d: [0], x: [x] };
        r.finish = Infinity;
        r.sim = { d: 0, x, vx: 0, y: 0, vy: 0, v: 0, lane: r.bot.lane, slowT: 0, nextMistake: 12 + Math.random() * 25 * (0.5 + r.bot.skill), think: 0, wide: 0, prevD: 0 };
      }
    }
    this.placeTreasure();
    this.updateGhost(0);
  }

  /** shop upgrade levels (0..3 each): speed +4% top speed, grip steadier steering, boost +20% boost time, per level */
  setUpgrades(u: Upgrades) {
    const lv = (n: number) => Math.max(0, Math.min(3, Math.round(n) || 0));
    this.upgrades = { speed: lv(u.speed), grip: lv(u.grip), boost: lv(u.boost) };
  }

  /** traffic density, obstacle frequency and how hard the bots ride */
  setDifficulty(d: Difficulty) {
    this.difficultyLevel = DIFF[d] ? d : 'normal';
  }

  /** items for the next ride: an energy drink (boosts last 50% longer) and repair kits */
  setRideItems(i: RideItems) {
    this.items = { energy: !!i.energy, repairKits: Math.max(0, Math.floor(i.repairKits) || 0) };
    if (this.phase !== 'riding') this.repairKits = this.items.repairKits;
  }

  /** rain: slippery steering and puddles that slow you */
  setWeather(w: Weather) {
    this.weather = w === 'rain' ? 'rain' : 'clear';
    this.weatherFx().set(this.weather === 'rain');
  }

  private wfx: WeatherFx | null = null;
  private weatherFx() {
    return (this.wfx ??= createWeatherFx(this.scene));
  }

  /** where the rider is on the campus map, for sound */
  get riderXZ(): [number, number] {
    const p = this.rider.root.position;
    return [p.x, p.z];
  }

  /** gold treasure placed at spots along the route picked from the seed (the same seed gives the same spots) */
  setTreasure(count: number, seed: number) {
    this.treasureCfg = { count: Math.max(0, Math.min(20, Math.floor(count) || 0)), seed: Math.floor(seed) || 1 };
    if (this.phase === 'riding' || this.phase === 'countdown') this.placeTreasure();
  }

  private placeTreasure() {
    for (const t of this.treasures) this.dynamic.remove(t.mesh);
    this.treasures = [];
    this.treasureFound = 0;
    const { count, seed } = this.treasureCfg;
    if (!count) return;
    const rnd = seeded(seed);
    const k = kit();
    const span = this.route.length * 0.8;
    for (let i = 0; i < count; i++) {
      // one spot in each stretch of the route, somewhere inside it
      const d = this.route.length * 0.1 + span * ((i + 0.15 + rnd() * 0.7) / count);
      const lane = (rnd() * 3) | 0;
      const mesh = new THREE.Mesh(k.gem, k.gemMat);
      this.place(mesh, d, LANES[lane], 1.0);
      this.dynamic.add(mesh);
      this.treasures.push({ mesh, d, x: LANES[lane], lane, taken: false, t: 0 });
    }
  }

  /** Photo mode: freezes the ride and lets the camera orbit the rider. */
  setPhotoMode(on: boolean) {
    if (on === this.photo) return;
    this.photo = on;
    if (on) {
      // start from a three-quarter front view
      this.photoYaw = this.rider.root.rotation.y + Math.PI * 0.75;
      this.photoPitch = 0.3;
    }
  }

  get photoMode() {
    return this.photo;
  }

  /** Turns the photo camera: dx, dy in screen pixels of a drag. */
  orbitPhoto(dx: number, dy: number) {
    if (!this.photo) return;
    this.photoYaw -= dx * 0.008;
    this.photoPitch = Math.max(0.02, Math.min(1.25, this.photoPitch + dy * 0.006));
  }

  /** The current view as a PNG data URL. */
  capture(): string {
    this.render(0);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Press (true) and release (false) the pedal. Steady taps, about 2 to 3 a second, build rhythm for a small speed bonus. */
  pedal(down: boolean) {
    if (down === this.pedalDown) return;
    this.pedalDown = down;
    if (!down || this.phase !== 'riding' || this.paused || this.photo) return;
    const gap = this.time - this.lastTap;
    this.lastTap = this.time;
    if (gap >= 0.22 && gap <= 0.85) {
      // steady beats build rhythm, ragged ones lose some
      const steady = this.tapGap > 0 && gap / this.tapGap > 0.7 && gap / this.tapGap < 1.4;
      this.rhythm = steady ? Math.min(1, this.rhythm + 0.2) : Math.max(0, this.rhythm * 0.6 + 0.05);
    } else if (gap < 0.22) this.rhythm *= 0.8; // mashing doesn't help
    this.tapGap = gap;
  }

  /** Called by the tutorial once every move has been tried. */
  releaseSpawns() {
    this.holdSpawns = false;
    this.nextSpawn = Math.max(this.nextSpawn, this.d + 70);
  }

  /** fits the shop gear for the next ride */
  setGear(helmets: number, brakeLevel: number) {
    this.helmets = helmets;
    this.brakeLevel = brakeLevel;
  }

  /** hold to brake; does nothing without brakes */
  setBrake(on: boolean) {
    const was = this.braking;
    this.braking = on && this.brakeLevel > 0 && this.phase === 'riding';
    if (this.braking && !was) sfx.lane();
  }

  giveBoost(amount: number) {
    this.boost = Math.min(1, this.boost + amount);
  }

  get isRiding() {
    return this.phase === 'riding';
  }

  action(a: Action) {
    if (this.phase !== 'riding' || this.paused) return;
    if (a === 'left' && this.lane > 0) { this.lane--; sfx.lane(); }
    else if (a === 'right' && this.lane < 2) { this.lane++; sfx.lane(); }
    else if (a === 'jump') {
      if (this.y > 0.01) return;
      this.vy = JUMP_V;
      sfx.jump();
    } else if (a === 'boost') {
      if (this.boost < 0.25 || this.boostTime > 0) return;
      this.boostTime = (1.5 + this.boost * 3) * (1 + 0.2 * this.upgrades.boost) * (this.items.energy ? 1.5 : 1);
      this.boost = 0;
      sfx.boost();
    } else if (a === 'pedal') {
      this.pedal(true);
      this.pedal(false);
    } else return;
    this.onAction(a);
  }

  abort() {
    this.showcase();
  }

  private reset() {
    for (const w of this.walkers) { w.d = -1e9; w.mesh.visible = false; }
    for (const o of this.obstacles) this.dynamic.remove(o.mesh);
    for (const c of this.coinList) this.dynamic.remove(c.mesh);
    for (const f of this.features) this.dynamic.remove(f.mesh);
    for (const t of this.treasures) this.dynamic.remove(t.mesh);
    this.obstacles = [];
    this.coinList = [];
    this.features = [];
    this.treasures = [];
    this.treasureFound = 0;
    this.vx = this.rhythm = this.repairT = this.puddleT = this.prevD = this.draftHold = this.tapGap = 0;
    this.lastTap = -10;
    this.stamina = 1;
    this.onRamp = this.pedalDown = this.photo = false;
    if (this.drafting) { this.drafting = false; this.onDraft(false); }
    this.repairKits = this.items.repairKits;
    this.d = this.x = this.y = this.vy = this.speed = this.boost = this.boostTime = this.coins = this.time = 0;
    this.slowTimer = this.endTimer = this.lean = this.shake = this.shield = 0;
    this.braking = false;
    this.lane = 1;
    this.paused = false;
    this.rec = { step: GHOST_STEP, d: [], x: [] };
    for (const p of this.rigPool) p.rig.root.visible = false;
    this.rider.body.rotation.set(0, 0, 0);
    this.rider.body.position.set(0, 0, 0);
  }

  /** Road frame at ride distance d (the start line is `lead` metres into the track). */
  private pose(d: number, x = 0) {
    return this.track.pose(d + this.route.lead, x);
  }

  /** Puts an object on the road at ride distance d, lateral x, facing along the road. */
  private place(obj: THREE.Object3D, d: number, x: number, y = 0, yaw = 0) {
    const p = this.pose(d, x);
    obj.position.set(p.x, y, p.z);
    obj.rotation.y = p.yaw + yaw;
  }

  private resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the road readable in portrait
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  private get baseSpeed() {
    const s = this.bike?.speed ?? 3;
    return 15 + s * 1.1;
  }

  private frame() {
    this.timer.update();
    const raw = this.timer.getDelta();
    const dt = Math.min(raw, 1 / 20);
    // auto graphics: average frame rate over a few seconds of riding
    if (this.watchSpeed && this.quality === 'high' && this.phase === 'riding' && !this.paused && raw < 1) {
      this.fpsFrames++;
      this.fpsTime += raw;
      if (this.fpsTime > 4) {
        const fps = this.fpsFrames / this.fpsTime;
        this.fpsFrames = this.fpsTime = 0;
        if (fps < 28) {
          this.watchSpeed = false;
          this.onSlow();
        }
      }
    }
    if (!this.paused && !this.photo) this.update(dt);
    this.render(dt);
  }

  private update(dt: number) {
    if (this.phase === 'cinematic') {
      this.crank += dt * 6;
      this.animateRider(dt, 6);
      return;
    }
    if (this.phase === 'showcase') {
      this.updateWalkers(dt);
      this.orbit += dt * (this.reducedMotion ? 0.04 : 0.18);
      this.crank += dt * 3;
      this.animateRider(dt, 0.4);
      return;
    }

    if (this.phase === 'countdown') {
      this.countdownT -= dt;
      const n = Math.ceil(this.countdownT / 0.8);
      const label = this.countdownT > 0 ? String(n) : 'GO!';
      if (label !== this.lastCount) {
        this.lastCount = label;
        if (this.countdownT > 0) sfx.count(); else sfx.go();
      }
      if (this.countdownT <= 0) this.phase = 'riding';
      this.emitHud(this.countdownT > 0 ? label : null);
      this.animateRider(dt, 0);
      return;
    }

    if (this.phase === 'riding') {
      this.time += dt;
      const progress = this.d / this.route.length;
      const difficulty = Math.min(1, progress * 1.3 + (this.route.difficulty - 2) * 0.1);
      let target = this.baseSpeed + difficulty * 6;
      const boosting = this.boostTime > 0;
      if (boosting) {
        target *= 1.45;
        this.boostTime -= dt;
      }
      // stamina: long boosts tire the legs, cruising brings them back
      if (boosting) this.stamina = Math.max(0, this.stamina - dt * 0.2);
      else this.stamina = Math.min(1, this.stamina + dt * (this.braking || this.repairT > 0 ? 0.3 : 0.14) - dt * 0.015 * this.rhythm);
      if (this.stamina < 0.3) target *= 0.82 + 0.18 * (this.stamina / 0.3);
      // pedal rhythm fades without steady taps
      if (this.time - this.lastTap > Math.max(0.9, this.tapGap * 1.6)) this.rhythm = Math.max(0, this.rhythm - dt * 1.2);
      if (this.stamina > 0.3) target *= 1 + 0.06 * this.rhythm;
      this.updateDraft(dt);
      if (this.drafting) {
        target *= 1.07;
        this.boost = Math.min(1, this.boost + dt * 0.035);
      }
      if (this.puddleT > 0) {
        target *= 0.86;
        this.puddleT -= dt;
      }
      if (this.slowTimer > 0) {
        target *= 0.6;
        this.slowTimer -= dt;
      }
      if (this.shield > 0) this.shield -= dt;
      if (this.honkCool > 0) this.honkCool -= dt;
      const accel = 4 + (this.bike?.acceleration ?? 3) * 1.6;
      if (this.repairT > 0) {
        // stopped at the roadside fixing the bike
        this.repairT -= dt;
        this.speed = Math.max(0, this.speed - 30 * dt);
        if (this.repairT <= 0) {
          this.shield = 2.5;
          this.slowTimer = 0.8;
          sfx.go();
        }
      } else if (this.braking && !boosting) {
        // disc brakes stop about twice as hard as rim brakes
        const floor = 2.5;
        this.speed = Math.max(Math.min(this.speed, floor), this.speed - (this.brakeLevel > 1 ? 26 : 13) * dt);
      } else this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), accel * dt * (target < this.speed ? 2.5 : 1));
    } else {
      // crashed or finished: coast to a stop
      this.speed = Math.max(0, this.speed - (this.phase === 'crashed' ? 30 : 10) * dt);
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.endTimer > -1) {
        this.endTimer = -10;
        this.onEnd({ distance: Math.min(this.d, this.route.length), coins: this.coins, time: this.time, finished: this.phase === 'finished' });
      }
    }

    this.prevD = this.d;
    this.d += this.speed * dt;
    if (this.phase === 'riding' || this.phase === 'finished') {
      while (this.rec.d.length * GHOST_STEP <= this.time) {
        this.rec.d.push(Math.round(Math.min(this.d, this.route.length + 30) * 100) / 100);
        this.rec.x.push(Math.round(this.x * 100) / 100);
      }
    }

    this.steer(dt);
    this.vertical(dt);

    if (this.phase === 'riding') {
      this.spawn();
      this.collide();
      if (this.d >= this.route.length) {
        this.phase = 'finished';
        this.endTimer = 1.4;
        sfx.finish();
      }
    }
    this.updateDynamic(dt);
    this.updateTraffic(dt);
    this.updateWalkers(dt);
    this.updateBots(dt);
    this.updateGhost(dt);
    this.crank += dt * this.speed * 0.9 * (1 + 0.25 * this.rhythm);
    this.animateRider(dt, this.speed);
    this.emitHud(null);
  }

  /** grip: how well the tyres hold, from the grip upgrade and the weather */
  private get grip() {
    const g = 1 + 0.15 * this.upgrades.grip;
    return this.weather === 'rain' ? g * (0.62 + 0.06 * this.upgrades.grip) : g;
  }

  /** Lane changes as a spring: quick and smooth on a dry road, looser and floatier in the rain. */
  private steer(dt: number) {
    const handling = this.bike?.handling ?? 3;
    const k = (95 + handling * 14) * this.grip;
    // dry roads are near critically damped; wet ones overshoot a little
    const c = 2 * Math.sqrt(k) * (this.weather === 'rain' ? 0.62 + 0.08 * this.upgrades.grip : 1);
    const tx = LANES[this.lane];
    const h = dt / 2;
    for (let i = 0; i < 2; i++) {
      this.vx += (k * (tx - this.x) - c * this.vx) * h;
      this.vx = Math.max(-16, Math.min(16, this.vx));
      this.x += this.vx * h;
    }
    this.x = Math.max(-ROAD_HALF + 0.5, Math.min(ROAD_HALF - 0.5, this.x));
    // lean into the bend (v²·curvature/g) and into lane changes
    const v = this.speed;
    const a = this.pose(this.d), b = this.pose(this.d + 4);
    const curve = ((b.tx - a.tx) * a.nx + (b.tz - a.tz) * a.nz) / 4;
    const turn = Math.atan((v * v * curve) / 9.8);
    const target = this.y > 0.05 ? this.lean * 0.95 : Math.max(-0.45, Math.min(0.45, -turn * 0.8 - this.vx * 0.045));
    this.lean += (target - this.lean) * Math.min(1, dt * 8);
  }

  /** Jumps, ramps and speed bumps. */
  private vertical(dt: number) {
    let ramp: Feature | null = null;
    for (const f of this.features) {
      if (f.kind !== 'ramp' || this.d < f.d || this.d > f.d + f.len || Math.abs(this.x - f.x) > f.w / 2 + 0.15) continue;
      if (this.y <= (RAMP.h * (this.d - f.d)) / f.len + 0.2) ramp = f;
    }
    if (ramp && this.phase !== 'crashed') {
      // ride up the ramp surface
      const slope = RAMP.h / ramp.len;
      this.y = slope * (this.d - ramp.d);
      this.vy = slope * this.speed;
      this.onRamp = true;
      return;
    }
    if (this.onRamp) {
      // off the lip: airborne
      this.onRamp = false;
      if (this.y > 0.1) {
        this.vy = Math.max(this.vy, 3.5) + 1.8;
        sfx.jump();
        this.onJump();
      }
    }
    for (const f of this.features) {
      if (f.kind !== 'bump' || f.done || this.prevD > f.d || this.d < f.d) continue;
      f.done = true;
      if (this.y < 0.05 && this.phase === 'riding') {
        this.vy = 2.4 + this.speed * 0.04;
        this.y = 0.01;
        this.shake = Math.max(this.shake, 0.12);
        sfx.bump();
        this.onJump();
      }
    }
    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }
  }

  /** Slipstream: riding just behind a rival, in their line. */
  private updateDraft(dt: number) {
    let behind = false;
    for (const r of this.rivals) {
      if (!r.rig.root.visible) continue;
      const [gd, gx] = this.rivalPos(r);
      const gap = gd - this.d;
      if (gap > 1.2 && gap < 8.5 && Math.abs(gx - this.x) < 0.9) { behind = true; break; }
    }
    if (behind) this.draftHold = 0.35;
    else this.draftHold -= dt;
    const on = this.draftHold > 0 && this.speed > 8;
    if (on !== this.drafting) {
      this.drafting = on;
      this.onDraft(on);
    }
  }

  /** a rival's road distance and offset now */
  private rivalPos(r: RivalState): [number, number] {
    return r.sim ? [r.sim.d, r.sim.x] : this.runAt(r.run, this.rivalT(r));
  }

  /** Keeps a few students walking on the pavements around the rider, reusing the same figures. */
  private updateWalkers(dt: number) {
    const want = this.quality === 'low' ? 10 : 22;
    const end = this.route.length + this.route.tail - 5;
    while (this.walkers.length < want) {
      const mesh = buildObstacle('pedestrian');
      mesh.traverse((o) => { o.castShadow = false; });
      mesh.visible = false;
      this.dynamic.add(mesh);
      this.walkers.push({ mesh, d: -1e9, x: 0, v: 0, t: Math.random() * 6 });
    }
    const spread = this.phase === 'showcase' || this.walkers.every((w) => !w.mesh.visible);
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i];
      w.mesh.visible = i < want && w.d > this.d - 25 && w.d > -this.route.lead + 2 && w.d < end;
      if (!w.mesh.visible && i < want) {
        // respawn: spread around at first, later far ahead where it can't pop into view
        const d = this.d + (spread ? -20 + Math.random() * 200 : 90 + Math.random() * 110);
        const x = (Math.random() < 0.5 ? -1 : 1) * (ROAD_HALF + 0.4 + Math.random() * 1.0);
        const p = this.pose(d, x);
        if (d >= end || d < -this.route.lead + 2 || buildingAt(p.x, p.z, 0.6) || this.track.distanceToRoad(p.x, p.z) < ROAD_HALF + 0.3) continue;
        Object.assign(w, { d, x, v: (Math.random() < 0.5 ? -1 : 1) * (1.1 + Math.random() * 0.5) });
        w.mesh.visible = true;
      }
      if (!w.mesh.visible) continue;
      w.d += w.v * dt;
      w.t += dt * 7;
      this.place(w.mesh, w.d, w.x, 0.12 + Math.abs(Math.sin(w.t)) * 0.05, w.v < 0 ? Math.PI : 0);
      w.mesh.rotation.z = Math.sin(w.t) * 0.04;
    }
  }

  private updateGhost(dt: number) {
    for (const r of this.rivals) {
      const rig = r.rig;
      if (r.live && r.finish === Infinity && r.run.d.length && r.run.d[r.run.d.length - 1] >= this.route.length) r.finish = this.finishTime(r.run);
      let gd: number, gx: number, v: number, vx: number, y = 0;
      if (r.sim) {
        ({ d: gd, x: gx, v, vx, y } = r.sim);
      } else {
        const t = this.rivalT(r);
        [gd, gx] = this.runAt(r.run, t);
        const [pd, px] = this.runAt(r.run, Math.max(0, t - 0.2));
        v = (gd - pd) / 0.2;
        vx = (gx - px) / 0.2;
      }
      const p = this.pose(gd, gx);
      rig.root.position.set(p.x, y, p.z);
      rig.root.rotation.y = p.yaw;
      r.crank += dt * v * 0.9;
      for (const w of rig.wheels) w.rotation.x -= (v / 0.38) * dt;
      rig.crank.rotation.x = -r.crank;
      rig.legs[0].rotation.x = Math.sin(r.crank) * 0.55;
      rig.legs[1].rotation.x = Math.sin(r.crank + Math.PI) * 0.55;
      // rivals lean into bends and line changes too
      const q = this.pose(gd + 4);
      const curve = ((q.tx - p.tx) * p.nx + (q.tz - p.tz) * p.nz) / 4;
      const lean = Math.max(-0.45, Math.min(0.45, -Math.atan((v * v * curve) / 9.8) * 0.8 - vx * 0.045));
      r.lean += (lean - r.lean) * Math.min(1, dt * 6);
      rig.body.rotation.z = r.sim && r.sim.slowT > 0.6 ? Math.sin(this.time * 18) * 0.12 : r.lean;
      // rivals ride on past their finish line, then leave the road
      rig.root.visible = gd < this.route.length + 25;
    }
  }

  /** Bots ride live: their own line, dodging traffic, the odd mistake, and a pull towards you that depends on the difficulty. */
  private updateBots(dt: number) {
    if (this.phase === 'countdown' || this.phase === 'showcase' || this.phase === 'cinematic') return;
    const diff = DIFF[this.difficultyLevel];
    for (const r of this.rivals) {
      const b = r.sim, st = r.bot;
      if (!b || !st) continue;
      const progress = Math.min(1, b.d / this.route.length);
      let target = (16.5 + this.route.difficulty * 0.6) * st.pace * diff.botPace * (1 + 0.28 * Math.min(1, progress * 1.3));
      // rubber band: bots behind you push, bots ahead ease off
      if (this.phase === 'riding') {
        const gap = this.d - b.d;
        target *= gap > 0 ? 1 + Math.min(1, gap / 80) * diff.catchUp : 1 - Math.min(1, -gap / 80) * diff.ease;
      }
      // the odd mistake: a wobble that costs speed, or running wide
      b.nextMistake -= dt;
      if (b.nextMistake <= 0) {
        b.nextMistake = 10 + Math.random() * 30 * (0.4 + st.skill);
        if (Math.random() < 0.55) b.slowT = 0.9 + Math.random();
        else b.wide = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6);
      }
      if (b.slowT > 0) {
        b.slowT -= dt;
        target *= 0.62;
      }
      b.wide *= Math.max(0, 1 - dt * 0.6);
      // look up the road now and then
      b.think -= dt;
      if (b.think <= 0) {
        b.think = 0.25 + (1 - st.skill) * 0.4;
        const look = 8 + st.skill * 18;
        const blocked = (lane: number) => this.obstacles.some((o) => !o.hit && !o.fling && o.d - b.d > 1.5 && o.d - b.d < look && Math.abs(o.x - LANES[lane]) < (o.spec.width + 0.6) / 2 + 0.3);
        if (blocked(b.lane)) {
          const free = [b.lane - 1, b.lane + 1].filter((l) => l >= 0 && l <= 2 && !blocked(l));
          if (free.length) b.lane = free[(Math.random() * free.length) | 0];
          else b.slowT = Math.max(b.slowT, 0.4);
        } else if (b.lane !== st.lane && Math.random() < 0.25) {
          const toward = b.lane + Math.sign(st.lane - b.lane);
          if (!blocked(toward)) b.lane = toward;
        }
      }
      // hop low barriers right in front
      if (b.y === 0) {
        for (const o of this.obstacles) {
          if (o.hit || o.spec.clearHeight > 1 || Math.abs(o.x - b.x) > 1.2) continue;
          const ahead = o.d - b.d;
          if (ahead > 0 && ahead < Math.max(3, b.v * 0.28)) { b.vy = JUMP_V; break; }
        }
      }
      b.v += Math.sign(target - b.v) * Math.min(Math.abs(target - b.v), (target < b.v ? 12 : 7) * dt);
      b.prevD = b.d;
      b.d += b.v * dt;
      // steer to their line
      const tx = Math.max(-ROAD_HALF + 0.6, Math.min(ROAD_HALF - 0.6, LANES[b.lane] + st.line + b.wide));
      const k = 60 + st.skill * 60, c = 2 * Math.sqrt(k) * 0.9;
      b.vx += (k * (tx - b.x) - c * b.vx) * dt;
      b.x += b.vx * dt;
      // ramps launch bots too
      const ramp = this.features.find((f) => f.kind === 'ramp' && b.d >= f.d && b.d <= f.d + f.len && Math.abs(b.x - f.x) < f.w / 2 + 0.15);
      if (ramp && b.y <= (RAMP.h * (b.d - ramp.d)) / ramp.len + 0.2) {
        b.y = (RAMP.h * (b.d - ramp.d)) / ramp.len;
        b.vy = (RAMP.h / ramp.len) * b.v + 1.8;
      } else if (b.y > 0 || b.vy > 0) {
        b.vy -= GRAVITY * dt;
        b.y = Math.max(0, b.y + b.vy * dt);
        if (b.y === 0) b.vy = 0;
      }
      // knocks: bots don't crash out, they lose time
      if (b.slowT < 0.5) {
        for (const o of this.obstacles) {
          if (o.hit || b.y > o.spec.clearHeight) continue;
          if (Math.abs(o.d - b.d) < (o.spec.length + RIDER_LEN) / 2 * 0.8 && Math.abs(o.x - b.x) < (o.spec.width + RIDER_W) / 2 * 0.75) {
            b.slowT = o.spec.hazard ? 0.7 : 1.5;
            if (!o.spec.hazard) b.v *= 0.55;
            break;
          }
        }
      }
      if (this.phase === 'riding') {
        while (r.run.d.length * GHOST_STEP <= this.time) {
          r.run.d.push(Math.round(Math.min(b.d, this.route.length + 30) * 100) / 100);
          r.run.x.push(Math.round(b.x * 100) / 100);
        }
        if (r.finish === Infinity && b.d >= this.route.length) r.finish = this.time - (b.d - this.route.length) / Math.max(1, b.v);
      }
    }
  }

  /** Traffic that behaves: cars brake behind slower things, honk at riders who cut in, and ease over to let you by. */
  private updateTraffic(dt: number) {
    for (const o of this.obstacles) {
      if (!o.cruise || o.hit || o.fling) continue;
      let want = o.cruise;
      for (const q of this.obstacles) {
        if (q === o || q.fling) continue;
        const ahead = q.d - o.d;
        if (ahead > 0 && ahead < 16 && Math.abs(q.x - o.x) < 1.7) want = Math.min(want, ahead < 7 ? q.vd * 0.8 : q.vd + (ahead - 7) * 0.6);
      }
      // the rider just in front, in its lane
      const ra = this.d - o.d;
      if (this.phase === 'riding' && ra > 0 && ra < 14 && Math.abs(this.x - o.x) < 1.4) {
        want = Math.min(want, this.speed * 0.85);
        if (ra < 9 && o.honk <= 0 && this.speed < o.vd + 4) this.honk(o);
      }
      if (o.honk > 0) o.honk -= dt;
      o.vd += Math.sign(want - o.vd) * Math.min(Math.abs(want - o.vd), (want < o.vd ? 9 : 3) * dt);
      // give way: a rider closing in from behind in its lane, so drift towards the kerb
      const behind = o.d - this.d;
      let shift = 0;
      if (this.phase === 'riding' && behind > 4 && behind < 26 && Math.abs(this.x - LANES[o.lane]) < 1.4) shift = o.lane === 0 ? -0.6 : o.lane === 2 ? 0.6 : this.x >= LANES[1] ? -0.6 : 0.6;
      o.shift += Math.sign(shift - o.shift) * Math.min(Math.abs(shift - o.shift), 0.9 * dt);
      o.x = LANES[o.lane] + o.shift;
      o.d += o.vd * dt;
      this.place(o.mesh, o.d, o.x);
    }
  }

  private honk(o: Obstacle) {
    o.honk = 6;
    if (this.honkCool > 0) return;
    this.honkCool = 2.5;
    sfx.honk();
  }

  private ghostGap(): number | null {
    const r = this.rivals[0];
    if (!r || this.phase === 'countdown') return null;
    const [gd] = this.rivalPos(r);
    // the rival has finished: the gap is how long ago it crossed the line
    if (gd >= this.route.length && r.finish < Infinity) return this.time - r.finish;
    return (gd - this.d) / Math.max(this.speed, 8);
  }

  private standing(): { pos: number; of: number } | null {
    if (this.rivals.length < 2) return null;
    const ahead = this.rivals.filter((r) => {
      if (this.d >= this.route.length) return r.finish < this.time;
      return this.rivalPos(r)[0] > this.d;
    }).length;
    return { pos: ahead + 1, of: this.rivals.length + 1 };
  }

  private emitHud(countdown: string | null) {
    this.onHud({
      distance: Math.min(this.d, this.route.length),
      routeLength: this.route.length,
      coins: this.coins,
      boost: this.boost,
      boosting: this.boostTime > 0,
      speed: this.speed,
      countdown,
      pos: [this.rider.root.position.x, this.rider.root.position.z],
      yaw: this.rider.root.rotation.y,
      ghostGap: this.ghostGap(),
      place: this.standing(),
      helmets: this.helmets,
      braking: this.braking,
      next: this.route.kind === 'explore' ? (() => { const n = this.nextStep(); return n && { text: n.step.text, turn: n.step.turn, dist: n.dist }; })() : null,
      kmh: Math.round(this.speed * 1.6),
      stamina: this.stamina,
      drafting: this.drafting,
      rhythm: this.rhythm,
      repairKits: this.repairKits,
      repairing: this.repairT > 0,
    });
  }

  // ---------- spawning ----------

  private spawn() {
    const diff = DIFF[this.difficultyLevel];
    while (!this.holdSpawns && this.nextSpawn < this.d + 230 && this.nextSpawn < this.route.length - 50) {
      this.spawnRow(this.nextSpawn);
      const progress = this.nextSpawn / this.route.length;
      // explore rides are about finding the way, so traffic is lighter
      const gap = THREE.MathUtils.lerp(42, 24, Math.min(1, progress * 1.4)) * (this.route.kind === 'explore' ? 1.8 : 1) * diff.gap * (0.8 + Math.random() * 0.45);
      // ramps, speed bumps and puddles go in the quiet stretch between rows
      this.spawnFeature(this.nextSpawn + gap * 0.5);
      this.nextSpawn += gap;
    }
  }

  private spawnFeature(d: number) {
    if (d > this.route.length - 40) return;
    const k = kit();
    const r = Math.random();
    const footpath = this.route.classAt(d) === 4;
    if (this.weather === 'rain' && r < 0.45) {
      const lane = (Math.random() * 3) | 0;
      const x = LANES[lane] + (Math.random() - 0.5) * 0.8;
      const w = 1.4 + Math.random() * 0.8, len = 2 + Math.random() * 1.6;
      const mesh = new THREE.Mesh(k.puddle, k.puddleMat);
      mesh.scale.set(w / 2, 1, len / 2);
      this.place(mesh, d, x, 0.025);
      this.addFeature({ kind: 'puddle', mesh, d, x, w, len, done: false });
    } else if (r > 0.86) {
      // a jump ramp in a free lane, with coins to collect in the air
      const lane = (Math.random() * 3) | 0;
      if (this.treasures.some((t) => t.lane === lane && Math.abs(t.d - d) < 12)) return;
      const mesh = new THREE.Mesh(k.ramp, k.rampMat);
      mesh.castShadow = this.quality === 'high';
      this.place(mesh, d, LANES[lane]);
      this.addFeature({ kind: 'ramp', mesh, d, x: LANES[lane], w: RAMP.w, len: RAMP.len, done: false });
      for (let i = 1; i <= 4; i++) this.addCoin(LANES[lane], 1.5 + Math.sin((i / 5) * Math.PI) * 1.1, d + RAMP.len + i * 2.6);
    } else if (r > 0.76 && !footpath) {
      const mesh = new THREE.Mesh(k.bump, k.bumpMat);
      this.place(mesh, d, 0, 0.02);
      this.addFeature({ kind: 'bump', mesh, d, x: 0, w: ROAD_HALF * 2, len: 0.5, done: false });
    }
  }

  private addFeature(f: Feature) {
    f.mesh.matrixAutoUpdate = false;
    f.mesh.updateMatrix();
    this.dynamic.add(f.mesh);
    this.features.push(f);
  }

  private spawnRow(d: number) {
    // calm rides: coins only, nothing to dodge
    if (this.calm) {
      this.addCoinLine((Math.random() * 3) | 0, d, 5);
      return;
    }
    const progress = d / this.route.length;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    // no cars or trotros on footpaths
    const footpath = this.route.classAt(d) === 4;
    const highKinds: ObstacleKind[] = footpath ? ['pedestrian'] : ['car', 'car', 'trotro', 'pedestrian'];
    const high = () => highKinds[(Math.random() * highKinds.length) | 0];
    const r = Math.random();
    const double = DIFF[this.difficultyLevel].double;

    if (r < 0.35) {
      this.addObstacle(high(), lanes[0], d);
      this.addCoinLine(lanes[1], d - 8, 5);
    } else if (r < 0.35 + double && progress > 0.15) {
      this.addObstacle(high(), lanes[0], d);
      this.addObstacle(high(), lanes[1], d + (Math.random() - 0.5) * 4);
      this.addCoinLine(lanes[2], d - 10, 6);
    } else if (r < 0.8) {
      const kind: ObstacleKind = Math.random() < 0.6 ? 'barrier' : 'pothole';
      const n = progress > 0.3 ? 3 : 1 + ((Math.random() * 2) | 0);
      for (let k = 0; k < n; k++) this.addObstacle(kind, lanes[k], d);
      if (kind === 'barrier') this.addCoinArc(lanes[0], d);
      else this.addCoinLine(lanes[0], d - 6, 4);
    } else {
      this.addObstacle(high(), lanes[0], d);
      this.addObstacle('barrier', lanes[1], d);
      this.addCoinArc(lanes[1], d);
    }
  }

  private addObstacle(kind: ObstacleKind, lane: number, d: number) {
    // keep treasure spots clear
    if (this.treasures.some((t) => t.lane === lane && Math.abs(t.d - d) < 8)) return;
    const spec = OBSTACLES[kind];
    const mesh = buildObstacle(kind);
    // some cars are moving with traffic
    const vd = kind === 'car' && Math.random() < DIFF[this.difficultyLevel].moving ? 5 + Math.random() * 3 : 0;
    const yaw = kind === 'pedestrian' ? (Math.random() - 0.5) * Math.PI : kind === 'pothole' ? Math.random() * Math.PI : 0;
    const x = LANES[lane] + (kind === 'pothole' || kind === 'pedestrian' ? (Math.random() - 0.5) * 0.6 : 0);
    this.place(mesh, d, x, 0, yaw);
    this.dynamic.add(mesh);
    this.obstacles.push({ spec, mesh, lane, x, d, vd, cruise: vd, hit: false, passed: false, honk: 0, shift: 0 });
  }

  private addCoinLine(lane: number, d: number, n: number) {
    for (let k = 0; k < n; k++) this.addCoin(LANES[lane], 0.9, d + k * 3);
  }

  private addCoinArc(lane: number, d: number) {
    // follows the jump arc over an obstacle at d
    const v = Math.max(this.speed, this.baseSpeed);
    for (let k = -3; k <= 3; k++) {
      const dd = d + k * 2.2;
      const t = (dd - d) / v + JUMP_V / GRAVITY;
      const h = Math.max(0, JUMP_V * t - 0.5 * GRAVITY * t * t);
      this.addCoin(LANES[lane], 0.9 + h, dd);
    }
  }

  private addCoin(x: number, y: number, d: number) {
    if (d > this.route.length - 20) return;
    const mesh = buildCoin();
    this.place(mesh, d, x, y);
    this.dynamic.add(mesh);
    this.coinList.push({ mesh, x, y, d, taken: false, t: 0 });
  }

  // ---------- collisions ----------

  private collide() {
    for (const o of this.obstacles) {
      if (o.hit || this.repairT > 0) continue;
      const overlapD = Math.abs(o.d - this.d) < (o.spec.length + RIDER_LEN) / 2 * 0.85;
      if (!overlapD) continue;
      const overlapX = Math.abs(o.x - this.x) < (o.spec.width + RIDER_W) / 2 * 0.8;
      if (!overlapX) continue;
      if (this.y > o.spec.clearHeight) continue;
      o.hit = true;
      if (this.boostTime > 0) {
        // boosting riders bulldoze through
        const p = this.pose(this.d);
        const side = (Math.random() - 0.5) * 8;
        o.fling = new THREE.Vector3(p.tx * 12 + p.nx * side, 6, p.tz * 12 + p.nz * side);
        this.shake = 0.3;
        sfx.bump();
      } else if (this.shield > 0) {
        // just got back up after a helmet save: brush past
        this.slowTimer = Math.max(this.slowTimer, 0.6);
        sfx.bump();
      } else if (o.spec.hazard || this.route.kind === 'explore') {
        // explore rides never end in a crash, they just slow you down
        this.slowTimer = 1.2;
        this.shake = 0.35;
        sfx.bump();
      } else if (this.helmets > 0) {
        // the helmet takes the hit: wobble, slow down, ride on
        this.helmets--;
        this.shield = 2.5;
        this.slowTimer = 2;
        this.speed *= 0.35;
        this.shake = 0.6;
        sfx.crash();
        this.onHelmet(this.helmets);
      } else if (this.repairKits > 0) {
        // a repair kit: a short stop to fix the bike, then ride on
        this.repairKits--;
        this.repairT = REPAIR_TIME;
        this.boostTime = 0;
        this.shake = 0.6;
        sfx.crash();
        this.onRepair(this.repairKits);
      } else {
        this.phase = 'crashed';
        this.endTimer = 1.3;
        this.shake = 0.6;
        sfx.crash();
      }
      break;
    }
    // near misses: past something solid with very little room to spare
    for (const o of this.obstacles) {
      if (o.passed || o.hit || o.fling || this.d - o.d < (o.spec.length + RIDER_LEN) / 2) continue;
      o.passed = true;
      if (o.spec.hazard || this.shield > 0 || this.repairT > 0 || this.phase !== 'riding') continue;
      const room = Math.abs(o.x - this.x) - (o.spec.width + RIDER_W) / 2 * 0.8;
      if (room >= 0 && room < 0.7 && this.d - o.d < 12) {
        this.coins += NEAR_MISS_COINS;
        sfx.coin();
        if (o.cruise && Math.random() < 0.5) this.honk(o);
        this.onNearMiss();
      }
    }
    for (const c of this.coinList) {
      if (c.taken) continue;
      if (Math.abs(c.d - this.d) < 1.1 && Math.abs(c.x - this.x) < 0.9 && Math.abs(c.y - (this.y + 0.9)) < 1.0) {
        c.taken = true;
        this.coins++;
        this.boost = Math.min(1, this.boost + 0.06);
        sfx.coin();
      }
    }
    for (const t of this.treasures) {
      if (t.taken || Math.abs(t.d - this.d) > 1.4 || Math.abs(t.x - this.x) > 1.0 || this.y > 1.8) continue;
      t.taken = true;
      this.treasureFound++;
      sfx.coin();
      setTimeout(() => sfx.coin(), 120);
      this.onTreasure(this.treasureFound);
    }
    for (const f of this.features) {
      if (f.kind !== 'puddle' || f.done || this.y > 0.1 || Math.abs(f.d - this.d) > f.len / 2 || Math.abs(f.x - this.x) > f.w / 2) continue;
      f.done = true;
      this.puddleT = 0.8;
      // wet roads: the back wheel steps out a little
      if (this.weather === 'rain') this.vx += (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 1.5) / this.grip;
    }
  }

  private updateDynamic(dt: number) {
    const behind = this.d - 15;
    this.obstacles = this.obstacles.filter((o) => {
      if (o.fling) {
        o.mesh.position.addScaledVector(o.fling, dt);
        o.fling.y -= GRAVITY * dt;
        o.mesh.rotation.x += dt * 6;
      }
      if (o.d < behind || o.mesh.position.y < -10) {
        this.dynamic.remove(o.mesh);
        return false;
      }
      return true;
    });
    this.coinList = this.coinList.filter((c) => {
      c.mesh.rotation.y += dt * 3.5;
      if (c.taken) {
        c.t += dt;
        const p = this.pose(this.d, this.x);
        c.mesh.position.set(p.x, this.y + 1.2 + c.t * 6, p.z);
        c.mesh.scale.setScalar(Math.max(0.01, 1 - c.t * 4));
      }
      if (c.d < behind || c.t > 0.25) {
        this.dynamic.remove(c.mesh);
        return false;
      }
      return true;
    });
    this.features = this.features.filter((f) => {
      if (f.d + f.len > behind) return true;
      this.dynamic.remove(f.mesh);
      return false;
    });
    this.treasures = this.treasures.filter((t) => {
      t.mesh.rotation.y += dt * 2.2;
      if (t.taken) {
        t.t += dt;
        t.mesh.position.y += dt * 5;
        t.mesh.scale.setScalar(Math.max(0.01, 1 + t.t * 2 - t.t * t.t * 8));
      } else if (Math.abs(t.d - this.d) < 120) t.mesh.position.y = 1.0 + Math.sin(this.time * 3 + t.d) * 0.12;
      if (t.d < behind || t.t > 0.5) {
        this.dynamic.remove(t.mesh);
        return false;
      }
      return true;
    });
  }

  // ---------- rider + camera ----------

  private animateRider(dt: number, speed: number) {
    const r = this.rider;
    this.place(r.root, this.d, this.x, this.y);
    const wheelSpin = (speed / 0.38) * dt;
    for (const w of r.wheels) w.rotation.x -= wheelSpin;
    r.crank.rotation.x = -this.crank;
    r.legs[0].rotation.x = Math.sin(this.crank) * 0.55;
    r.legs[1].rotation.x = Math.sin(this.crank + Math.PI) * 0.55;
    if (this.phase === 'crashed') {
      r.body.rotation.z = Math.min(r.body.rotation.z + dt * 4, 1.4);
      r.body.position.y = Math.max(-0.2, r.body.position.y - dt);
    } else if (this.repairT > 0) {
      // down on the road, fix the bike, back up
      const t = REPAIR_TIME - this.repairT;
      const down = Math.min(1, t / 0.4, this.repairT / 0.5);
      r.body.rotation.z = down * 1.1;
      r.body.position.y = -down * 0.12;
    } else if (this.shield > 1.6) {
      r.body.rotation.z = Math.sin(this.shield * 22) * 0.35;
      r.body.position.y = 0;
    } else {
      r.body.rotation.z = this.lean;
      r.body.position.y = 0;
      // nose up off a ramp lip, level again on the way down
      const pitch = this.y > 0 ? Math.max(-0.3, Math.min(0.1, -this.vy * 0.03 - 0.08)) : 0;
      r.body.rotation.x += (pitch - r.body.rotation.x) * Math.min(1, dt * 10);
    }
  }

  private render(dt: number) {
    const cam = this.camera;
    if (this.photo) {
      // photo mode: orbit the frozen rider
      const c = this.rider.root.position;
      const r = 4.4, a = this.photoYaw, e = this.photoPitch;
      cam.position.set(c.x + Math.sin(a) * Math.cos(e) * r, c.y + 0.9 + Math.sin(e) * r, c.z + Math.cos(a) * Math.cos(e) * r);
      cam.lookAt(c.x, c.y + 0.9, c.z);
      cam.fov = innerWidth < innerHeight ? 64 : 50;
      cam.updateProjectionMatrix();
    } else if (this.phase === 'cinematic') {
      cam.position.copy(this.cine.pos);
      cam.lookAt(this.cine.look);
    } else if (this.phase === 'showcase') {
      const a = this.orbit;
      const p = this.pose(this.d);
      const r = this.dressing ? 3.3 : 5.5;
      cam.position.set(p.x + Math.sin(a) * r, this.dressing ? 1.7 : 2.1, p.z + Math.cos(a) * r);
      cam.lookAt(p.x, this.dressing ? -0.15 : 0.9, p.z);
    } else {
      const boosting = this.boostTime > 0;
      const back = boosting ? 7.2 : 6.2;
      const behind = this.pose(this.d - back, this.x * 0.6);
      this.camTarget.set(behind.x, 3.1 + this.y * 0.4, behind.z);
      cam.position.lerp(this.camTarget, Math.min(1, dt * 8));
      if (this.shake > 0 && !this.reducedMotion) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
        this.shake = Math.max(0, this.shake - dt);
      }
      const ahead = this.pose(this.d + 12, this.x * 0.8);
      cam.lookAt(ahead.x, 1.1, ahead.z);
      // the camera banks a little with the bike
      if (!this.reducedMotion) cam.rotateZ(this.lean * 0.18);
      const fovBase = innerWidth < innerHeight ? 72 : 60;
      const fov = this.reducedMotion ? fovBase + 3 : fovBase + (boosting ? 10 : 0) + this.speed * 0.15;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    // shadows follow the rider
    const here = this.rider.root.position;
    this.sun.position.set(here.x + this.sunOffset.x, this.sunOffset.y, here.z + this.sunOffset.z);
    this.sun.target.position.set(here.x, 0, here.z);
    this.wfx?.update(dt, cam);
    this.renderer.render(this.scene, cam);
  }
  private camTarget = new THREE.Vector3();
}
