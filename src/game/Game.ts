import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMPUS_LOOP, type BikeSpec, type Route } from '../data/campus';
import { sfx } from '../audio';
import { buildCoin, buildObstacle, buildRider, OBSTACLES, type ObstacleKind, type ObstacleSpec, type RiderRig } from './models';
import { buildSky, buildWorld, LANES } from './world';

export type Action = 'left' | 'right' | 'jump' | 'boost';

export interface HudState {
  distance: number;
  routeLength: number;
  coins: number;
  boost: number;
  boosting: boolean;
  speed: number;
  countdown: string | null;
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

type Phase = 'showcase' | 'countdown' | 'riding' | 'crashed' | 'finished';

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
  private rider: RiderRig;
  private route: Route = CAMPUS_LOOP;
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

    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#5a6b3a', 1.1));
    this.sun.position.set(-30, 45, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildWorld(this.route));
    this.scene.add(this.dynamic);

    this.rider = buildRider('#d64545', '#f2c230');
    this.scene.add(this.rider.root);

    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setLook(jersey: string, bikeColor: string) {
    this.rider.setJersey(jersey);
    this.rider.setBikeColor(bikeColor);
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
    });
  }

  // ---------- spawning ----------

  private spawn() {
    while (!this.holdSpawns && this.nextSpawn < this.d + 230 && this.nextSpawn < this.route.length - 50) {
      this.spawnRow(this.nextSpawn);
      const progress = this.nextSpawn / this.route.length;
      const gap = THREE.MathUtils.lerp(42, 24, Math.min(1, progress * 1.4));
      this.nextSpawn += gap * (0.8 + Math.random() * 0.45);
    }
  }

  private spawnRow(d: number) {
    const progress = d / this.route.length;
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const highKinds: ObstacleKind[] = ['car', 'car', 'trotro', 'pedestrian'];
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
    if (kind === 'pedestrian') mesh.rotation.y = (Math.random() - 0.5) * Math.PI;
    if (kind === 'pothole') mesh.rotation.y = Math.random() * Math.PI;
    mesh.position.set(LANES[lane] + (kind === 'pothole' || kind === 'pedestrian' ? (Math.random() - 0.5) * 0.6 : 0), 0, -d);
    this.dynamic.add(mesh);
    this.obstacles.push({ spec, mesh, lane, d, vd, hit: false });
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
    mesh.position.set(x, y, -d);
    this.dynamic.add(mesh);
    this.coinList.push({ mesh, x, y, d, taken: false, t: 0 });
  }

  // ---------- collisions ----------

  private collide() {
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const overlapD = Math.abs(o.d - this.d) < (o.spec.length + RIDER_LEN) / 2 * 0.85;
      if (!overlapD) continue;
      const overlapX = Math.abs(o.mesh.position.x - this.x) < (o.spec.width + RIDER_W) / 2 * 0.8;
      if (!overlapX) continue;
      if (this.y > o.spec.clearHeight) continue;
      o.hit = true;
      if (this.boostTime > 0) {
        // boosting riders bulldoze through
        o.fling = new THREE.Vector3((Math.random() - 0.5) * 8, 6, -12);
        this.shake = 0.3;
        sfx.bump();
      } else if (o.spec.hazard) {
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
        o.mesh.position.z = -o.d;
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
        c.mesh.position.set(this.x, this.y + 1.2 + c.t * 6, -this.d);
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
    r.root.position.set(this.x, this.y, -this.d);
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
    if (this.phase === 'showcase') {
      const a = this.orbit;
      cam.position.set(Math.sin(a) * 5.5, 2.1, Math.cos(a) * 5.5 - this.d);
      cam.lookAt(0, 0.9, -this.d);
    } else {
      const boosting = this.boostTime > 0;
      const back = boosting ? 7.2 : 6.2;
      const target = new THREE.Vector3(this.x * 0.6, 3.1 + this.y * 0.4, -this.d + back);
      cam.position.lerp(target, Math.min(1, dt * 8));
      if (this.shake > 0) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
        this.shake = Math.max(0, this.shake - dt);
      }
      cam.lookAt(this.x * 0.8, 1.1, -this.d - 12);
      const fovBase = innerWidth < innerHeight ? 72 : 60;
      const fov = fovBase + (boosting ? 10 : 0) + this.speed * 0.15;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    // shadows follow the rider
    this.sun.position.set(this.x - 30, 45, -this.d + 20);
    this.sun.target.position.set(this.x, 0, -this.d - 10);
    this.renderer.render(this.scene, cam);
  }
}
