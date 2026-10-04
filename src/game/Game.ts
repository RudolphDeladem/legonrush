import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BikeSpec } from '../data/campus';
import { CAMPUS_LOOP, type Route, type RideStep } from './routes';
import { sfx } from '../audio';
import { buildCoin, buildObstacle, buildRider, OBSTACLES, type ObstacleKind, type ObstacleSpec, type RiderRig } from './models';
import type { Track } from './track';
import { buildLandmarks } from './landmarks';
import { buildCampus, buildRouteLayer, buildSky, disposeLayer, LANES } from './world';

export type Action = 'left' | 'right' | 'jump' | 'boost';

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
  hit: boolean;
  fling?: THREE.Vector3;
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

const SKIES: Record<TimeOfDay, { top: string; bottom: string; fog: [number, number]; sun: string; sunI: number; sunPos: [number, number, number]; hemiSky: string; hemiGround: string; hemiI: number; env: number; exposure: number }> = {
  day: { top: '#3f7fcf', bottom: '#f2d7b0', fog: [70, 340], sun: '#fff1d6', sunI: 2.6, sunPos: [-30, 45, 20], hemiSky: '#cfe3ff', hemiGround: '#5a6b3a', hemiI: 1.1, env: 0.35, exposure: 1.05 },
  sunset: { top: '#2b3f7a', bottom: '#ff9a4a', fog: [60, 300], sun: '#ffb070', sunI: 2.4, sunPos: [-40, 14, -60], hemiSky: '#ffc59a', hemiGround: '#4a3a2a', hemiI: 0.8, env: 0.3, exposure: 1.0 },
  night: { top: '#03060f', bottom: '#1b2650', fog: [40, 220], sun: '#9fb6ff', sunI: 0.55, sunPos: [20, 40, 10], hemiSky: '#3a4f8a', hemiGround: '#10131c', hemiI: 0.45, env: 0.12, exposure: 1.15 },
};

const GRAVITY = 22;
const JUMP_V = 7;
const RIDER_LEN = 1.6;
const RIDER_W = 0.6;

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

  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private nextSpawn = 0;
  private dynamic = new THREE.Group();
  private orbit = 0;

  onHud: (h: HudState) => void = () => {};
  /** no traffic or obstacles: for learning the way */
  calm = false;
  onEnd: (r: RideEnd) => void = () => {};
  onAction: (a: Action) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4 || Math.min(screen.width, screen.height) < 500;
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

    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
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

  setLook(jersey: string, bikeColor: string) {
    this.rider.setJersey(jersey);
    this.rider.setBikeColor(bikeColor);
  }

  setTimeOfDay(t: TimeOfDay) {
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
  }

  start(bike: BikeSpec, tutorial: boolean) {
    this.reset();
    this.bike = bike;
    this.holdSpawns = tutorial;
    this.nextSpawn = tutorial ? 200 : 90;
    this.phase = 'countdown';
    this.countdownT = tutorial ? 0.01 : 2.4;
    this.lastCount = '';
  }

  /** Called by the tutorial once every move has been tried. */
  releaseSpawns() {
    this.holdSpawns = false;
    this.nextSpawn = Math.max(this.nextSpawn, this.d + 70);
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
      this.boostTime = 1.5 + this.boost * 3;
      this.boost = 0;
      sfx.boost();
    } else return;
    this.onAction(a);
  }

  abort() {
    this.showcase();
  }

  private reset() {
    for (const o of this.obstacles) this.dynamic.remove(o.mesh);
    for (const c of this.coinList) this.dynamic.remove(c.mesh);
    this.obstacles = [];
    this.coinList = [];
    this.d = this.x = this.y = this.vy = this.speed = this.boost = this.boostTime = this.coins = this.time = 0;
    this.slowTimer = this.endTimer = this.lean = this.shake = 0;
    this.lane = 1;
    this.paused = false;
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
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    if (!this.paused) this.update(dt);
    this.render(dt);
  }

  private update(dt: number) {
    if (this.phase === 'cinematic') {
      this.crank += dt * 6;
      this.animateRider(dt, 6);
      return;
    }
    if (this.phase === 'showcase') {
      this.orbit += dt * 0.18;
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
      if (this.boostTime > 0) {
        target *= 1.45;
        this.boostTime -= dt;
      }
      if (this.slowTimer > 0) {
        target *= 0.6;
        this.slowTimer -= dt;
      }
      const accel = 4 + (this.bike?.acceleration ?? 3) * 1.6;
      this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), accel * dt * (target < this.speed ? 2.5 : 1));
    } else {
      // crashed or finished: coast to a stop
      this.speed = Math.max(0, this.speed - (this.phase === 'crashed' ? 30 : 10) * dt);
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.endTimer > -1) {
        this.endTimer = -10;
        this.onEnd({ distance: Math.min(this.d, this.route.length), coins: this.coins, time: this.time, finished: this.phase === 'finished' });
      }
    }

    this.d += this.speed * dt;

    // lateral + vertical motion
    const handling = this.bike?.handling ?? 3;
    const tx = LANES[this.lane];
    const laneSpeed = 9 + handling * 1.8;
    const dx = tx - this.x;
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), laneSpeed * dt);
    this.lean += ((-dx * 0.25) - this.lean) * Math.min(1, dt * 10);
    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }

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
    this.crank += dt * this.speed * 0.9;
    this.animateRider(dt, this.speed);
    this.emitHud(null);
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
      next: this.route.kind === 'explore' ? (() => { const n = this.nextStep(); return n && { text: n.step.text, turn: n.step.turn, dist: n.dist }; })() : null,
    });
  }

  // ---------- spawning ----------

  private spawn() {
    while (!this.holdSpawns && this.nextSpawn < this.d + 230 && this.nextSpawn < this.route.length - 50) {
      this.spawnRow(this.nextSpawn);
      const progress = this.nextSpawn / this.route.length;
      // explore rides are about finding the way, so traffic is lighter
      const gap = THREE.MathUtils.lerp(42, 24, Math.min(1, progress * 1.4)) * (this.route.kind === 'explore' ? 1.8 : 1);
      this.nextSpawn += gap * (0.8 + Math.random() * 0.45);
    }
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

    if (r < 0.35) {
      this.addObstacle(high(), lanes[0], d);
      this.addCoinLine(lanes[1], d - 8, 5);
    } else if (r < 0.6 && progress > 0.15) {
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
    const spec = OBSTACLES[kind];
    const mesh = buildObstacle(kind);
    // some cars are moving with traffic
    const vd = kind === 'car' && Math.random() < 0.4 ? 5 + Math.random() * 3 : 0;
    const yaw = kind === 'pedestrian' ? (Math.random() - 0.5) * Math.PI : kind === 'pothole' ? Math.random() * Math.PI : 0;
    const x = LANES[lane] + (kind === 'pothole' || kind === 'pedestrian' ? (Math.random() - 0.5) * 0.6 : 0);
    this.place(mesh, d, x, 0, yaw);
    this.dynamic.add(mesh);
    this.obstacles.push({ spec, mesh, lane, x, d, vd, hit: false });
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
      if (o.hit) continue;
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
      } else if (o.spec.hazard || this.route.kind === 'explore') {
        // explore rides never end in a crash, they just slow you down
        this.slowTimer = 1.2;
        this.shake = 0.35;
        sfx.bump();
      } else {
        this.phase = 'crashed';
        this.endTimer = 1.3;
        this.shake = 0.6;
        sfx.crash();
      }
      break;
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
  }

  private updateDynamic(dt: number) {
    const behind = this.d - 15;
    this.obstacles = this.obstacles.filter((o) => {
      if (o.fling) {
        o.mesh.position.addScaledVector(o.fling, dt);
        o.fling.y -= GRAVITY * dt;
        o.mesh.rotation.x += dt * 6;
      } else if (o.vd && !o.hit) {
        o.d += o.vd * dt;
        this.place(o.mesh, o.d, o.x);
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
    } else {
      r.body.rotation.z = this.lean;
      r.body.rotation.x = this.y > 0 ? -0.15 : 0;
    }
  }

  private render(dt: number) {
    const cam = this.camera;
    if (this.phase === 'cinematic') {
      cam.position.copy(this.cine.pos);
      cam.lookAt(this.cine.look);
    } else if (this.phase === 'showcase') {
      const a = this.orbit;
      const p = this.pose(this.d);
      cam.position.set(p.x + Math.sin(a) * 5.5, 2.1, p.z + Math.cos(a) * 5.5);
      cam.lookAt(p.x, 0.9, p.z);
    } else {
      const boosting = this.boostTime > 0;
      const back = boosting ? 7.2 : 6.2;
      const behind = this.pose(this.d - back, this.x * 0.6);
      const target = new THREE.Vector3(behind.x, 3.1 + this.y * 0.4, behind.z);
      cam.position.lerp(target, Math.min(1, dt * 8));
      if (this.shake > 0) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
        this.shake = Math.max(0, this.shake - dt);
      }
      const ahead = this.pose(this.d + 12, this.x * 0.8);
      cam.lookAt(ahead.x, 1.1, ahead.z);
      const fovBase = innerWidth < innerHeight ? 72 : 60;
      const fov = fovBase + (boosting ? 10 : 0) + this.speed * 0.15;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    // shadows follow the rider
    const here = this.rider.root.position;
    this.sun.position.set(here.x + this.sunOffset.x, this.sunOffset.y, here.z + this.sunOffset.z);
    this.sun.target.position.set(here.x, 0, here.z);
    this.renderer.render(this.scene, cam);
  }
}
