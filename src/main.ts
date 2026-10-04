import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, type Action, type HudState } from './game/Game';
import { BIKES, HALLS, HALL_PLACE, UPCOMING_ROUTES, bikeById, hallById } from './data/campus';
import { CAMPUS_LOOP, exploreRoute, type Route } from './game/routes';
import { ATTRIBUTION, placeByName, resolvePlace, searchPlaces, type Place, type PlaceKind, type PlaceMatch, type TravelMode, type Turn } from './game/campusmap';
import { miniMap, routeMap } from './ui/mapview';
import { applyRide, clearProfile, levelFor, loadProfile, loadSettings, newProfile, saveProfile, saveSettings, xpForLevel, type Profile, type RideResult, type RideRewards } from './state';
import { setSound, unlockAudio } from './audio';
import { icons } from './ui/icons';

// Service workers are unavailable in some embeds; the game still runs without offline support.
if ('serviceWorker' in navigator) registerSW({ immediate: true, onRegisterError: () => {} });

const app = document.getElementById('app')!;
const canvas = document.getElementById('world') as HTMLCanvasElement;
// in-world signs are drawn with Sora, so wait for it (but never block the game on it)
await Promise.race([document.fonts.load('700 56px Sora'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
const game = new Game(canvas);
if (import.meta.env.DEV) Object.assign(window, { __game: game });

let profile: Profile | null = loadProfile();
const settings = loadSettings();
setSound(settings.sound);

type Tab = 'home' | 'ride' | 'race' | 'events' | 'you';
let tab: Tab = 'home';

let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
});

addEventListener('pointerdown', unlockAudio, { once: false });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
const km = (m: number) => (m / 1000).toFixed(2);
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);
const isTouch = matchMedia('(pointer: coarse)').matches;

function render(html: string) {
  app.innerHTML = html;
}

function on(sel: string, ev: string, fn: (e: Event, el: HTMLElement) => void) {
  app.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
}

function applyLook() {
  if (!profile) return;
  game.setLook(hallById(profile.hall).color, bikeById(profile.bike).color);
}

// ---------- splash + welcome ----------

function splash() {
  game.showcase();
  render(`
    <div class="screen solid center fade-in">
      <div class="logo">LEGON<span>RUSH</span></div>
      <p class="tag" style="margin-top:12px">The Campus Lifestyle Reimagined.</p>
      <p class="kicker" style="margin-top:22px">Ride. Race. Connect.</p>
      <div class="splash-bar"><div></div></div>
    </div>`);
  setTimeout(() => (profile ? home() : welcome()), 1400);
}

function welcome() {
  game.showcase();
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack" style="text-align:center">
        <div class="title" style="font-size:clamp(34px,10vw,52px)">Your campus.<br>Your ride.<br><span style="color:var(--gold)">Your world.</span></div>
        <p class="kicker" style="margin:6px 0 18px">Ride. Race. Connect.</p>
        <button class="btn btn-primary" id="start">Get started</button>
        <button class="btn btn-ghost" id="guest">Continue as guest</button>
        <button class="btn btn-link" disabled>Sign in · coming soon</button>
      </div>
    </div>`);
  on('#start', 'click', () => createRider(newProfile()));
  on('#guest', 'click', () => {
    profile = newProfile();
    profile.name = 'Guest';
    saveProfile(profile);
    applyLook();
    play(true);
  });
}

// ---------- onboarding ----------

function createRider(draft: Profile, editing = false) {
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack">
        <p class="kicker">${editing ? 'Edit rider' : 'Step 1 of 2'}</p>
        <h1 class="title">Create your rider</h1>
        <div class="field"><label for="name">Display name</label><input id="name" maxlength="18" autocomplete="nickname" value="${esc(draft.guest && draft.name === 'Rider' ? '' : draft.name)}" placeholder="Rudolph"></div>
        <div class="field"><label for="user">Username</label><input id="user" maxlength="20" autocapitalize="off" value="${esc(draft.username)}" placeholder="rudolphrides"></div>
        <p class="kicker" style="margin-top:8px">Choose your hall</p>
        <p class="muted small">Represent your hall across LEGONRUSH.</p>
        <div class="hall-grid">
          ${HALLS.map((h) => `
            <button class="card selectable hall-card ${draft.hall === h.id ? 'selected' : ''}" data-hall="${h.id}">
              <div class="hall-swatch" style="background:${h.color}"></div>
              <div class="hall-name">${esc(h.name)}</div>
            </button>`).join('')}
        </div>
        <button class="btn btn-primary" id="next" style="margin-top:8px">${editing ? 'Save' : 'Continue'}</button>
        ${editing ? '<button class="btn btn-link" id="cancel">Cancel</button>' : '<button class="btn btn-link" id="back">Back</button>'}
      </div>
    </div>`);
  on('[data-hall]', 'click', (_, el) => {
    draft.hall = el.dataset.hall!;
    app.querySelectorAll('[data-hall]').forEach((b) => b.classList.toggle('selected', b === el));
    game.setLook(hallById(draft.hall).color, bikeById(draft.bike).color);
  });
  on('#next', 'click', () => {
    const name = (app.querySelector('#name') as HTMLInputElement).value.trim();
    const user = (app.querySelector('#user') as HTMLInputElement).value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
    if (!name) {
      (app.querySelector('#name') as HTMLInputElement).focus();
      return;
    }
    draft.name = name;
    draft.username = user;
    draft.guest = false;
    if (editing) {
      profile = draft;
      saveProfile(draft);
      applyLook();
      home('you');
    } else chooseBike(draft);
  });
  on('#back', 'click', welcome);
  on('#cancel', 'click', () => home('you'));
}

function chooseBike(draft: Profile) {
  game.showcase();
  game.setLook(hallById(draft.hall).color, bikeById(draft.bike).color);
  render(`
    <div class="screen scrim fade-in">
      <div class="wrap stack">
        <p class="kicker">Step 2 of 2</p>
        <h1 class="title">Choose your starter bike</h1>
      </div>
      <div class="grow"></div>
      <div class="wrap stack">
        <div class="bike-grid">
          ${BIKES.map((b) => `
            <button class="card selectable bike-card ${draft.bike === b.id ? 'selected' : ''}" data-bike="${b.id}">
              <div class="hall-swatch" style="background:${b.color};margin:0 auto 8px"></div>
              <h3>${b.name}</h3>
              <p class="muted small">${b.tagline}</p>
              <div class="stat-line"><span>SPD</span><span class="dots">${dots(b.speed)}</span></div>
              <div class="stat-line"><span>ACC</span><span class="dots">${dots(b.acceleration)}</span></div>
              <div class="stat-line"><span>HDL</span><span class="dots">${dots(b.handling)}</span></div>
            </button>`).join('')}
        </div>
        <button class="btn btn-primary" id="go">Let's go</button>
      </div>
    </div>`);
  on('[data-bike]', 'click', (_, el) => {
    draft.bike = el.dataset.bike!;
    app.querySelectorAll('[data-bike]').forEach((b) => b.classList.toggle('selected', b === el));
    game.setLook(hallById(draft.hall).color, bikeById(draft.bike).color);
  });
  on('#go', 'click', () => {
    profile = draft;
    saveProfile(profile);
    applyLook();
    play(!profile.tutorialDone);
  });
}

// ---------- gameplay ----------

const ARROW: Record<Turn, string> = {
  start: '↑', straight: '↑', 'slight-left': '↖', 'slight-right': '↗', left: '←', right: '→', 'sharp-left': '↙', 'sharp-right': '↘', arrive: '◎',
};
const dm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const isExplore = (r: Route) => r.kind === 'explore';
const routeKey = (r: Route) => (isExplore(r) ? `explore:${r.from.name}>${r.to.name}` : r.id);
const finishReward = (r: Route) => (isExplore(r) ? 50 + Math.round(r.length / 20) : 250);

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function play(tutorial: boolean, route: Route = CAMPUS_LOOP) {
  if (!profile) return;
  if (game.currentRoute !== route) game.setRoute(route);
  applyLook();
  const bike = bikeById(profile.bike);
  render(`
    <div class="hud">
      <div class="touch-layer" id="touch"></div>
      <div class="boosting-vignette" id="vignette"></div>
      <div class="hud-top" style="position:relative">
        <div class="hud-pill"><small>DISTANCE</small><span id="dist">0.00</span> KM</div>
        <div class="hud-progress">
          <div class="xpbar"><div id="prog" style="width:0%"></div></div>
          <p class="muted">${esc((isExplore(route) ? `To ${route.to.name}` : route.name).toUpperCase())}</p>
        </div>
        <div class="row">
          <div class="hud-pill">${icons.coin} <span id="coins">0</span></div>
          <button class="pause-btn" id="pause" aria-label="Pause">${icons.pause}</button>
        </div>
      </div>
      <div class="turn-banner" id="turn" hidden><span class="turn-arrow" id="turnArrow"></span><div><b id="turnDist"></b><span id="turnText"></span></div></div>
      <div class="prompt" id="prompt"></div>
      <div class="hud-bottom" style="position:relative">
        <div class="boost" id="boostWrap"><label>BOOST${isTouch ? '' : ' · B / SHIFT'}</label><div class="xpbar"><div id="boost" style="width:0%"></div></div></div>
        ${isTouch ? '<button class="boost-btn" id="boostBtn" disabled>BOOST</button>' : ''}
      </div>
      <canvas class="minimap" id="minimap" width="240" height="240" aria-hidden="true"></canvas>
    </div>`);

  const $ = (id: string) => app.querySelector<HTMLElement>('#' + id)!;
  const dist = $('dist');
  const prog = $('prog');
  const coins = $('coins');
  const boost = $('boost');
  const boostWrap = $('boostWrap');
  const prompt = $('prompt');
  const vignette = $('vignette');
  const boostBtn = app.querySelector<HTMLButtonElement>('#boostBtn');
  const drawMap = miniMap(app.querySelector<HTMLCanvasElement>('#minimap')!, route);
  const turn = $('turn'), turnArrow = $('turnArrow'), turnDist = $('turnDist'), turnText = $('turnText');
  let lastTurn = '';

  // tutorial: teach through play, one move at a time
  const steps: { action: Action; text: string }[] = [
    { action: 'left', text: isTouch ? 'Swipe left' : 'Press ←' },
    { action: 'right', text: isTouch ? 'Swipe right' : 'Press →' },
    { action: 'jump', text: isTouch ? 'Swipe up to jump' : 'Press ↑ or Space to jump' },
    { action: 'boost', text: isTouch ? 'Tap boost' : 'Press B to boost' },
  ];
  let step = tutorial ? 0 : -1;
  let countdownShown = false;
  const showStep = () => {
    if (step < 0) return;
    if (step >= steps.length) {
      prompt.innerHTML = `You've got it.`;
      game.releaseSpawns();
      step = -1;
      setTimeout(() => { if (prompt.textContent === `You've got it.`) prompt.innerHTML = ''; }, 1600);
      return;
    }
    if (steps[step].action === 'boost') game.giveBoost(1);
    prompt.innerHTML = `<small>TUTORIAL</small>${steps[step].text}`;
  };

  game.onAction = (a) => {
    if (step >= 0 && steps[step].action === a) {
      step++;
      setTimeout(showStep, 350);
    }
  };

  game.onHud = (h: HudState) => {
    dist.textContent = km(h.distance);
    drawMap(h.pos, h.yaw);
    turn.hidden = !h.next || !!h.countdown;
    if (h.next) {
      const key = h.next.turn + h.next.text;
      if (key !== lastTurn) {
        lastTurn = key;
        turnArrow.textContent = ARROW[h.next.turn as Turn] ?? '↑';
        turnText.textContent = h.next.text;
        turn.classList.toggle('arrive', h.next.turn === 'arrive');
      }
      turnDist.textContent = h.next.dist < 25 ? 'Now' : dm(h.next.dist);
      turn.classList.toggle('soon', h.next.dist < 60);
    }
    prog.style.width = `${(h.distance / h.routeLength) * 100}%`;
    coins.textContent = String(h.coins);
    boost.style.width = `${h.boost * 100}%`;
    const ready = h.boost >= 0.25 && !h.boosting;
    boostWrap.classList.toggle('ready', ready);
    if (boostBtn) boostBtn.disabled = !ready;
    vignette.classList.toggle('on', h.boosting);
    if (h.countdown) {
      prompt.innerHTML = `<span class="countdown">${h.countdown}</span>`;
      countdownShown = true;
    } else if (countdownShown) {
      countdownShown = false;
      prompt.innerHTML = '';
      showStep();
    }
  };

  game.onEnd = (r) => {
    cleanup();
    const result: RideResult = { routeId: routeKey(route), ...r };
    const rewards = applyRide(profile!, result, finishReward(route));
    results(result, rewards, route);
  };

  // controls
  const keyMap: Record<string, Action> = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyB: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
  };
  keyHandler = (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') return togglePause();
    const a = keyMap[e.code];
    if (a) {
      e.preventDefault();
      game.action(a);
    }
  };
  addEventListener('keydown', keyHandler);

  const touch = $('touch');
  let sx = 0, sy = 0, st = 0, swiped = false;
  touch.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); swiped = false; });
  touch.addEventListener('pointermove', (e) => {
    if (swiped || !st) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    swiped = true;
    if (Math.abs(dx) > Math.abs(dy)) game.action(dx < 0 ? 'left' : 'right');
    else if (dy < 0) game.action('jump');
  });
  touch.addEventListener('pointerup', () => {
    if (!swiped && performance.now() - st < 250 && isTouch) game.action('boost');
    st = 0;
  });
  boostBtn?.addEventListener('pointerdown', (e) => { e.stopPropagation(); game.action('boost'); });

  const togglePause = () => {
    if (!game.isRiding) return;
    if (game.paused) return resume();
    game.paused = true;
    const ov = document.createElement('div');
    ov.className = 'overlay fade-in';
    ov.id = 'pauseOverlay';
    ov.innerHTML = `
      <div class="panel">
        <h2 class="title">Paused</h2>
        <button class="btn btn-primary" data-p="continue">Continue</button>
        <button class="btn btn-ghost" data-p="restart">Restart</button>
        <button class="btn btn-ghost" data-p="sound">Sound: ${settings.sound ? 'On' : 'Off'}</button>
        <p class="muted small" style="margin:6px 0">${isTouch ? 'Swipe left/right to change lanes, up to jump, tap to boost.' : '← → or A D to steer, ↑ W or Space to jump, B or Shift to boost, Esc to pause.'}</p>
        <button class="btn btn-link" data-p="exit">Exit ride</button>
      </div>`;
    app.appendChild(ov);
    ov.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (p === 'continue') resume();
      if (p === 'restart') { cleanup(); play(false, route); }
      if (p === 'sound') {
        settings.sound = !settings.sound;
        setSound(settings.sound);
        saveSettings(settings);
        b.textContent = `Sound: ${settings.sound ? 'On' : 'Off'}`;
      }
      if (p === 'exit') { cleanup(); home(); }
    }));
  };
  const resume = () => {
    game.paused = false;
    app.querySelector('#pauseOverlay')?.remove();
  };
  $('pause').addEventListener('click', togglePause);
  const onHidden = () => { if (document.hidden && game.isRiding && !game.paused) togglePause(); };
  document.addEventListener('visibilitychange', onHidden);

  function cleanup() {
    if (keyHandler) removeEventListener('keydown', keyHandler);
    keyHandler = null;
    document.removeEventListener('visibilitychange', onHidden);
    game.onHud = () => {};
    game.onEnd = () => {};
    game.onAction = () => {};
    game.paused = false;
  }

  game.calm = isExplore(route) && exploreOpts.calm;
  game.start(bike, tutorial);
}

// ---------- results ----------

function results(r: RideResult, rw: RideRewards, route: Route) {
  const p = profile!;
  const levelUp = rw.levelAfter > rw.levelBefore;
  const explore = isExplore(route);
  const headline = r.finished ? (explore ? 'You made it' : 'Finish!') : 'Wiped out';
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">${esc(route.name)}</p>
        <h1 class="title">${headline}</h1>
        ${explore && r.finished ? `<p class="muted">You found your way to <b>${esc(route.to.name)}</b>. Here is the way you rode:</p>${stepsList(route)}` : ''}
        ${rw.newBestTime ? '<span class="badge gold">New personal best 🔥</span>' : rw.newBestScore ? '<span class="badge gold">New high score 🔥</span>' : ''}
        <div class="result-big">${km(r.distance)} <span style="font-size:0.4em">KM</span></div>
        ${r.finished ? `<p class="muted">Time ${clock(r.time)}</p>` : ''}
        <div class="card">
          <div class="reward-row"><span>Score</span><b data-count="${rw.score}">0</b></div>
          <div class="reward-row"><span>Coins</span><b>+<span data-count="${rw.coins}">0</span> ${icons.coin}</b></div>
          <div class="reward-row"><span>XP</span><b>+<span data-count="${rw.xp}">0</span></b></div>
        </div>
        ${levelUp ? `<div class="levelup">🎉 Level up! You're now level ${rw.levelAfter}</div>` : ''}
        ${p.guest ? `<div class="card stack"><p><b>Save your progress</b></p><p class="muted small">Create your rider to pick your hall and keep your stats.</p><button class="btn btn-ghost" id="create">Create rider</button></div>` : ''}
        <button class="btn btn-primary" id="again">Ride again</button>
        ${explore ? '<button class="btn btn-ghost" id="explore">Go somewhere else</button>' : ''}
        <button class="btn btn-ghost" id="home">Home</button>
      </div>
    </div>`);
  // animated counters
  app.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  on('#again', 'click', () => play(false, route));
  on('#explore', 'click', () => explorePicker(route.to.name));
  on('#home', 'click', () => home());
  on('#create', 'click', () => createRider({ ...p, name: '' }, false));
}

// ---------- hub ----------

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

function shell(content: string) {
  const items: [Tab, string, string][] = [
    ['home', 'HOME', icons.home], ['ride', 'RIDE', icons.ride], ['race', 'RACE', icons.race], ['events', 'EVENTS', icons.events], ['you', 'YOU', icons.you],
  ];
  return `
    <div class="shell">
      <nav class="nav">
        <div class="nav-brand">LEGON<span>RUSH</span></div>
        ${items.map(([id, label, icon]) => `<button class="nav-item ${tab === id ? 'active' : ''}" data-tab="${id}">${icon}<span>${label}</span></button>`).join('')}
      </nav>
      <main class="content scrim fade-in">${content}</main>
    </div>`;
}

function home(next: Tab = 'home') {
  if (!profile) return welcome();
  tab = next;
  game.showcase();
  applyLook();
  const p = profile;
  const level = levelFor(p.xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const hall = hallById(p.hall);
  const best = p.bestTimes[CAMPUS_LOOP.id];
  const exploreCard = `<button class="card selectable explore-card" id="exploreBtn"><div class="row"><h3 style="font-weight:800">${icons.ride} EXPLORE CAMPUS</h3><span class="grow"></span><span class="badge gold">New</span></div><p class="muted small" style="margin-top:4px">New on campus? Pick where you are and where you need to be, then ride the real way there with directions.</p></button>`;

  const views: Record<Tab, string> = {
    home: `
      <div class="hub">
        <div class="hub-top">
          <div>
            <p class="kicker">${greeting()}</p>
            <h1 class="title">${esc(p.name)}</h1>
          </div>
          <div class="chips"><span class="chip">${icons.coin} ${fmt(p.coins)}</span></div>
        </div>
        <div class="card stack" style="gap:8px">
          <div class="row"><b>Level ${level}</b><span class="grow"></span><span class="muted small">${fmt(p.xp - lo)} / ${fmt(hi - lo)} XP</span></div>
          <div class="xpbar"><div style="width:${((p.xp - lo) / (hi - lo)) * 100}%"></div></div>
          <div class="row small muted"><span class="hall-swatch" style="background:${hall.color}"></span>${esc(hall.name)}</div>
        </div>
        <div class="spacer"></div>
        <button class="ride-cta" id="ride">
          <div><div class="big">RIDE</div><div class="sub">Quick Ride · ${esc(CAMPUS_LOOP.name)} · ${(CAMPUS_LOOP.length / 1000).toFixed(1)} km</div></div>
          ${icons.arrow}
        </button>
        ${exploreCard}
        <div class="two">
          <button class="card mini" data-tab="race" style="text-align:left"><h3>Race</h3><p class="muted small">Compete with others</p><span class="badge" style="margin-top:8px">Soon</span></button>
          <button class="card mini" style="text-align:left" data-tab="events"><h3>Together</h3><p class="muted small">Ride with someone</p><span class="badge" style="margin-top:8px">Soon</span></button>
        </div>
        ${best ? `<div class="card row"><span class="muted small">Your best on ${esc(CAMPUS_LOOP.name)}</span><span class="grow"></span><b>${clock(best)}</b></div>` : ''}
      </div>`,
    ride: `
      <div class="hub">
        <p class="kicker">Ride</p>
        <h1 class="title">Where to?</h1>
        <button class="ride-cta" id="ride">
          <div><div class="big" style="font-size:26px">QUICK RIDE</div><div class="sub">Start immediately</div></div>${icons.arrow}
        </button>
        ${exploreCard}
        <p class="kicker" style="margin-top:8px">Routes</p>
        <div class="card selectable" id="routeCard">
          <div class="row"><h3 style="font-weight:800">${esc(CAMPUS_LOOP.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div>
          <p class="muted small" style="margin-top:4px">${(CAMPUS_LOOP.length / 1000).toFixed(1)} km · Difficulty ${'★'.repeat(CAMPUS_LOOP.difficulty)}${'☆'.repeat(5 - CAMPUS_LOOP.difficulty)}${best ? ` · Best ${clock(best)}` : ''}</p>
        </div>
        ${UPCOMING_ROUTES.map((r) => `
          <div class="card locked">
            <div class="row"><h3 style="font-weight:800">${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge">Phase 2</span></div>
            <p class="muted small" style="margin-top:4px">${(r.length / 1000).toFixed(1)} km · Difficulty ${'★'.repeat(r.difficulty)}${'☆'.repeat(5 - r.difficulty)}</p>
          </div>`).join('')}
      </div>`,
    race: `
      <div class="hub">
        <p class="kicker">Race</p>
        <h1 class="title">Multiplayer is coming</h1>
        <p class="muted">Quick Match, private rooms with a code, and hall races for up to 10 riders arrive in Phase 3.</p>
        <div class="card locked"><h3 style="font-weight:800">QUICK MATCH</h3><p class="muted small">Find a race</p></div>
        <div class="card locked"><h3 style="font-weight:800">CREATE CHALLENGE</h3><p class="muted small">Create your own room</p></div>
        <div class="card locked"><h3 style="font-weight:800">JOIN WITH CODE</h3><p class="muted small">Enter a friend's code</p></div>
        <div class="card locked"><h3 style="font-weight:800">HALL RACE</h3><p class="muted small">Represent ${esc(hall.name)}</p></div>
        <button class="btn btn-primary" id="ride">Practise on ${esc(CAMPUS_LOOP.name)}</button>
      </div>`,
    events: `
      <div class="hub">
        <p class="kicker">Events</p>
        <h1 class="title">Campus events</h1>
        <p class="muted">Live events, hall championships and Together rides arrive in Phase 4.</p>
        <div class="card locked"><div class="row"><h3 style="font-weight:800">🌅 SUNSET RUSH</h3><span class="grow"></span><span class="badge">Soon</span></div><p class="muted small">A sunset route with exclusive rewards.</p></div>
        <div class="card locked"><div class="row"><h3 style="font-weight:800">🌙 NIGHT RUSH</h3><span class="grow"></span><span class="badge">Soon</span></div><p class="muted small">Night-time campus cycling.</p></div>
        <div class="card locked"><div class="row"><h3 style="font-weight:800">🏫 HALL CHAMPIONSHIP</h3><span class="grow"></span><span class="badge">Soon</span></div><p class="muted small">Ride for ${esc(hall.name)}.</p></div>
      </div>`,
    you: `
      <div class="hub">
        <div class="row" style="gap:14px">
          <div class="avatar" style="background:${hall.color}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
          <div>
            <h1 class="title" style="font-size:26px">${esc(p.name)}</h1>
            ${p.username ? `<p class="muted">@${esc(p.username)}</p>` : ''}
            <p class="small" style="margin-top:4px">Level ${level} · ${esc(hall.name)}</p>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><b>${km(p.totalDistance)}</b><span>KM ridden</span></div>
          <div class="stat"><b>${p.rides}</b><span>Rides</span></div>
          <div class="stat"><b>${p.finishes}</b><span>Finishes</span></div>
          <div class="stat"><b>${fmt(p.bestScore)}</b><span>Best score</span></div>
          <div class="stat"><b>${fmt(p.coins)}</b><span>Rush coins</span></div>
          <div class="stat"><b>${fmt(p.xp)}</b><span>XP</span></div>
        </div>
        <div class="card row"><span class="muted small">Bike</span><span class="grow"></span><b>${bikeById(p.bike).name}</b></div>
        <button class="btn btn-ghost" id="edit">${p.guest ? 'Create rider' : 'Edit rider'}</button>
        ${installPrompt ? '<button class="btn btn-ghost" id="install">Install app</button>' : ''}
        <button class="btn btn-link" id="reset">Reset progress</button>
        <p class="muted small">Progress is saved on this device. Accounts and cross-device sync arrive with Phase 2.</p>
      </div>`,
  };

  render(shell(views[tab]));
  on('[data-tab]', 'click', (_, el) => home(el.dataset.tab as Tab));
  on('#ride', 'click', () => play(false));
  on('#routeCard', 'click', () => play(false));
  on('#exploreBtn', 'click', () => explorePicker());
  on('#edit', 'click', () => createRider({ ...p }, !p.guest));
  on('#install', 'click', async () => {
    await installPrompt?.prompt();
    installPrompt = null;
  });
  on('#reset', 'click', (_, el) => {
    // two taps instead of confirm(), which some embedded browsers block
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1';
      el.textContent = 'Tap again to erase all progress';
      return;
    }
    clearProfile();
    profile = null;
    welcome();
  });
}

// ---------- explore ----------

const POPULAR = ['School of Law', 'Pent Hostel Block A', 'The Balme Library', 'Great Hall', 'Night Market', 'Jones Quartey Building, JQB', 'University of Ghana Hospital', 'Legon Main Entrance'];

function stepsList(route: Route) {
  return `<ol class="steps">${route.steps.map((s, i) => `
    <li class="${s.turn === 'arrive' ? 'arrive' : ''}"><span class="turn-arrow">${ARROW[s.turn]}</span><span class="grow">${esc(s.text)}</span>${i < route.steps.length - 1 ? `<small class="muted">${dm(route.steps[i + 1].d - s.d)}</small>` : ''}</li>`).join('')}</ol>`;
}

const KIND_ICON: Record<PlaceKind, [string, string]> = {
  hall: ['🛏️', 'Hall'], academic: ['🎓', 'Faculty'], landmark: ['⭐', 'Landmark'], food: ['🍽️', 'Food'], bank: ['🏦', 'Bank'],
  transport: ['🚌', 'Bus stop'], worship: ['🕊️', 'Worship'], sport: ['⚽', 'Sport'], health: ['🏥', 'Health'], other: ['📍', 'Place'],
};

// Explore options, remembered on this device
const EXPLORE_KEY = 'legonrush.explore.v1';
const exploreOpts: { mode: TravelMode; calm: boolean } = (() => {
  try { return { mode: 'cycle', calm: true, ...JSON.parse(localStorage.getItem(EXPLORE_KEY) ?? '{}') }; } catch { return { mode: 'cycle', calm: true }; }
})();
const saveExploreOpts = () => { try { localStorage.setItem(EXPLORE_KEY, JSON.stringify(exploreOpts)); } catch { /* private mode */ } };

function explorePicker(fromName?: string, toName = '') {
  if (!profile) return welcome();
  const p = profile;
  let from: Place | undefined = resolvePlace(fromName ?? HALL_PLACE[p.hall] ?? 'Legon Main Entrance');
  let to: Place | undefined = toName ? resolvePlace(toName) : undefined;
  const seg = (id: string, options: [string, string][], value: string) =>
    `<div class="seg" id="${id}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  render(`
    <div class="screen scrim fade-in">
      <div class="wrap stack explore">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker">Explore campus</p>
        <h1 class="title">Find your way</h1>
        <p class="muted">Pick where you are and where you need to be. Type a name or what students call it, like Vandals, Pent or JQB.</p>
        <div class="field picker"><label for="from">From</label><input id="from" autocomplete="off" spellcheck="false" placeholder="Your hall, a faculty, a landmark…"><ul class="suggest" id="fromList" hidden></ul></div>
        <button class="btn btn-link swap" id="swap" aria-label="Swap from and to">⇅ Swap</button>
        <div class="field picker"><label for="to">To</label><input id="to" autocomplete="off" spellcheck="false" placeholder="Where do you need to be?"><ul class="suggest" id="toList" hidden></ul></div>
        <div class="chips">${POPULAR.filter((n) => placeByName(n)).map((n) => `<button class="chip" data-to="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="row options">${seg('mode', [['cycle', '🚲 Cycle'], ['walk', '🚶 Walk']], exploreOpts.mode)}${seg('calm', [['1', 'Calm ride'], ['0', 'With traffic']], exploreOpts.calm ? '1' : '0')}</div>
        <div id="preview" class="stack"></div>
        <p class="muted small">${esc(ATTRIBUTION)}</p>
      </div>
    </div>`);
  const fromIn = app.querySelector<HTMLInputElement>('#from')!;
  const toIn = app.querySelector<HTMLInputElement>('#to')!;
  const preview = app.querySelector<HTMLElement>('#preview')!;
  const show = (place: Place | undefined) => (place ? place.name : '');
  fromIn.value = show(from);
  toIn.value = show(to);

  let route: Route | null = null;
  const update = () => {
    route = null;
    if (!from || !to) {
      preview.innerHTML = '';
      return;
    }
    if (from === to) {
      preview.innerHTML = `<p class="muted small">You're already there. Pick a different destination.</p>`;
      return;
    }
    route = exploreRoute(from, to, exploreOpts.mode);
    if (!route) {
      preview.innerHTML = `<p class="muted small">No path connects those two places on the map yet.</p>`;
      return;
    }
    preview.innerHTML = `
      <canvas class="route-map" width="720" height="440" aria-label="Map of the way from ${esc(from.name)} to ${esc(to.name)}"></canvas>
      <div class="stats three">
        <div class="stat"><b>${dm(route.length)}</b><span>Distance</span></div>
        <div class="stat"><b>${mins(route.length / 1.3)}</b><span>Walking</span></div>
        <div class="stat"><b>${mins(route.length / 4.5)}</b><span>Cycling</span></div>
      </div>
      <button class="btn btn-primary" id="go">Ride there</button>
      <p class="kicker" style="margin-top:6px">Directions</p>
      ${stepsList(route)}`;
    routeMap(preview.querySelector('canvas')!, route);
    preview.querySelector('#go')!.addEventListener('click', () => route && play(false, route));
  };

  // type-ahead with the kind of each place, nicknames included
  const picker = (input: HTMLInputElement, list: HTMLElement, set: (p: Place) => void) => {
    let matches: PlaceMatch[] = [];
    let active = 0;
    const draw = () => {
      list.hidden = !matches.length;
      list.innerHTML = matches.map((m, i) => {
        const [icon, label] = KIND_ICON[m.place.kind];
        return `<li data-i="${i}" class="${i === active ? 'on' : ''}"><span class="kind" title="${label}">${icon}</span><span class="grow">${esc(m.place.name)}${m.alias ? ` <small class="muted">“${esc(m.alias)}”</small>` : ''}</span><small class="muted">${label}</small></li>`;
      }).join('');
    };
    const choose = (m: PlaceMatch | undefined) => {
      if (!m) return;
      set(m.place);
      input.value = m.place.name;
      matches = [];
      draw();
      update();
    };
    input.addEventListener('input', () => {
      matches = searchPlaces(input.value, 7);
      active = 0;
      draw();
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (!matches.length) return;
      if (e.key === 'ArrowDown') { active = (active + 1) % matches.length; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active + matches.length - 1) % matches.length; draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(matches[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { matches = []; draw(); }
    });
    // pointerdown fires before the input loses focus
    list.addEventListener('pointerdown', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
      if (li) { e.preventDefault(); choose(matches[Number(li.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(() => { matches = []; draw(); }, 150));
  };
  picker(fromIn, app.querySelector('#fromList')!, (pl) => { from = pl; });
  picker(toIn, app.querySelector('#toList')!, (pl) => { to = pl; });

  on('[data-to]', 'click', (_, el) => { to = placeByName(el.dataset.to!); toIn.value = show(to); update(); });
  on('#swap', 'click', () => { [from, to] = [to, from]; fromIn.value = show(from); toIn.value = show(to); update(); });
  on('#mode [data-v]', 'click', (_, el) => {
    exploreOpts.mode = el.dataset.v as TravelMode;
    saveExploreOpts();
    app.querySelectorAll('#mode [data-v]').forEach((b) => b.classList.toggle('on', b === el));
    update();
  });
  on('#calm [data-v]', 'click', (_, el) => {
    exploreOpts.calm = el.dataset.v === '1';
    saveExploreOpts();
    app.querySelectorAll('#calm [data-v]').forEach((b) => b.classList.toggle('on', b === el));
  });
  on('#back', 'click', () => home());
  update();
}

splash();
