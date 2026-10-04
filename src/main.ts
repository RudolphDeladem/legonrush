import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, type Action, type HudState } from './game/Game';
import { BIKES, HALLS, HALL_PLACE, bikeById, hallById } from './data/campus';
import { CAMPUS_LOOP, RACES, TOUR_STOPS, exploreRoute, freshersTour, raceRoute, type RaceDef, type Route } from './game/routes';
import { ATTRIBUTION, LINE_ENDS, PLACES, placeByName, toLatLng, resolvePlace, searchPlaces, type Place, type PlaceKind, type PlaceMatch, type TravelMode, type Turn } from './game/campusmap';
import { campusOverview, miniMap, routeMap, type Pin } from './ui/mapview';
import { applyRide, claimDaily, clearGhosts, dailyReward, clearProfile, levelFor, loadGhost, loadProfile, loadSettings, newProfile, saveGhost, saveProfile, saveSettings, xpForLevel, type Profile, type RideResult, type RideRewards } from './state';
import { music, setMusicVolume, setSound, sfx, unlockAudio } from './audio';
import { icons } from './ui/icons';

// Service workers are unavailable in some embeds; the game still runs without offline support.
// A new version waits until the player taps Update, so a deploy never reloads the page mid-ride.
const updateBar = document.createElement('div');
updateBar.className = 'update-bar';
updateBar.hidden = true;
updateBar.innerHTML = `<span>A new version of LEGONRUSH is ready.</span><button class="btn btn-primary" id="updateNow">Update</button>`;
document.body.appendChild(updateBar);
let updateReady = false;
const showUpdate = (screen: 'ride' | 'menu') => { updateBar.hidden = !updateReady || screen === 'ride'; };
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => { updateReady = true; showUpdate(game?.isRiding ? 'ride' : 'menu'); },
    onRegisterError: () => {},
  });
  updateBar.querySelector('#updateNow')!.addEventListener('click', () => updateSW(true));
}

const app = document.getElementById('app')!;
const canvas = document.getElementById('world') as HTMLCanvasElement;
// in-world signs are drawn with Sora, so wait for it (but never block the game on it)
await Promise.race([document.fonts.load('700 56px Sora'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
const game = new Game(canvas);
if (import.meta.env.DEV) Object.assign(window, { __game: game });

let profile: Profile | null = loadProfile();
const settings = loadSettings();
function applySettings() {
  setSound(settings.sound, settings.volume);
  setMusicVolume(settings.musicVolume);
  if (!settings.sound || settings.musicVolume <= 0) music(false);
  game.reducedMotion = settings.reducedMotion;
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
  game.setQuality(settings.graphics === 'low' || (settings.graphics === 'auto' && settings.slowDevice) ? 'low' : 'high');
}
applySettings();
const changeSettings = (patch: Partial<typeof settings>) => {
  Object.assign(settings, patch);
  saveSettings(settings);
  applySettings();
};

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

// The phone's back button steps back inside the app instead of closing it.
let backAction: (() => void) | null = null;
let trapped = false;
function onBack(fn: (() => void) | null) {
  backAction = fn;
  if (fn && !trapped) {
    history.pushState({ legonrush: true }, '');
    trapped = true;
  }
}
addEventListener('popstate', () => {
  trapped = false;
  const fn = backAction;
  backAction = null;
  if (fn) fn();
});

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
  setTimeout(() => {
    // a shared route link opens straight into Explore, even for someone new
    const link = new URLSearchParams(location.search);
    if (link.get('to')) {
      history.replaceState(null, '', location.pathname);
      if (link.get('mode') === 'walk' || link.get('mode') === 'cycle') { exploreOpts.mode = link.get('mode') as TravelMode; saveExploreOpts(); }
      if (!profile) {
        profile = newProfile();
        profile.name = 'Guest';
        saveProfile(profile);
      }
      return explorePicker(link.get('from') ?? undefined, link.get('to')!);
    }
    if (profile) home();
    else welcome();
  }, 1400);
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
  onBack(null);
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
  // a guest who already has progress goes back home, never to the welcome screen that would start over
  const back = () => (editing ? home('you') : profile ? home() : welcome());
  on('#back', 'click', back);
  on('#cancel', 'click', back);
  onBack(back);
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
  onBack(() => createRider(draft));
}

// ---------- gameplay ----------

const ARROW: Record<Turn, string> = {
  start: '↑', straight: '↑', 'slight-left': '↖', 'slight-right': '↗', left: '←', right: '→', 'sharp-left': '↙', 'sharp-right': '↘', arrive: '◎', stop: '★',
};
const dm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const isExplore = (r: Route) => r.kind === 'explore';
const routeKey = (r: Route) => (r.id === 'explore' ? `explore:${r.from.name}>${r.to.name}` : r.id);
const finishReward = (r: Route) => (isExplore(r) ? 50 + Math.round(r.length / 20) : 250);

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function play(tutorial: boolean, route: Route = CAMPUS_LOOP) {
  if (!profile) return;
  if (game.currentRoute !== route) game.setRoute(route);
  applyLook();
  const bike = bikeById(profile.bike);
  render(`
    <div class="hud${settings.leftHanded ? ' lefty' : ''}">
      <div class="touch-layer" id="touch"></div>
      <div class="boosting-vignette" id="vignette"></div>
      <div class="hud-top" style="position:relative">
        <div class="hud-pill"><small>DISTANCE</small><span id="dist">0.00</span> KM</div>
        <div class="hud-progress">
          <div class="xpbar"><div id="prog" style="width:0%"></div></div>
          <p class="muted">${esc((route.id === 'explore' ? `To ${route.to.name}` : route.name).toUpperCase())}</p>
          <p class="ghost-gap" id="ghostGap" hidden></p>
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
  const ghostGap = $('ghostGap');
  // races: your best run rides with you
  const ghost = route.kind === 'race' ? loadGhost(route.id) : null;
  game.setGhost(ghost);
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
        turn.classList.toggle('arrive', h.next.turn === 'arrive' || h.next.turn === 'stop');
      }
      turnDist.textContent = h.next.dist < 25 ? 'Now' : dm(h.next.dist);
      turn.classList.toggle('soon', h.next.dist < 60);
    }
    prog.style.width = `${(h.distance / h.routeLength) * 100}%`;
    ghostGap.hidden = h.ghostGap === null;
    if (h.ghostGap !== null) {
      const behind = h.ghostGap > 0.05;
      ghostGap.textContent = `Best run ${behind ? '+' : '−'}${Math.abs(h.ghostGap).toFixed(1)} s`;
      ghostGap.classList.toggle('behind', behind);
    }
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
    const run = game.lastRun;
    const rewards = applyRide(profile!, result, finishReward(route));
    if (route.kind === 'race' && r.finished && profile!.bestTimes[result.routeId] === r.time) saveGhost(route.id, { time: r.time, ...run });
    results(result, rewards, route, !!ghost);
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
    if (!game.isRiding) return onBack(togglePause);
    if (game.paused) return resume();
    game.paused = true;
    music(false);
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
    onBack(resume);
    ov.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (p === 'continue') resume();
      if (p === 'restart') { cleanup(); play(false, route); }
      if (p === 'sound') {
        changeSettings({ sound: !settings.sound });
        b.textContent = `Sound: ${settings.sound ? 'On' : 'Off'}`;
      }
      if (p === 'exit') { cleanup(); leave(); }
    }));
  };
  const resume = () => {
    game.paused = false;
    music(true);
    app.querySelector('#pauseOverlay')?.remove();
    onBack(togglePause);
  };
  const leave = () => (route.id === 'explore' ? explorePicker(route.from.name, route.to.name) : route.id === 'freshers-tour' ? explorePicker() : home(route.kind === 'race' ? 'ride' : 'home'));
  $('pause').addEventListener('click', togglePause);
  const onHidden = () => { if (document.hidden && game.isRiding && !game.paused) togglePause(); };
  document.addEventListener('visibilitychange', onHidden);

  function cleanup() {
    music(false);
    if (keyHandler) removeEventListener('keydown', keyHandler);
    keyHandler = null;
    document.removeEventListener('visibilitychange', onHidden);
    game.onHud = () => {};
    game.onEnd = () => {};
    game.onAction = () => {};
    game.paused = false;
  }

  game.calm = isExplore(route) && exploreOpts.calm;
  // auto graphics: drop to smooth mode once if this phone can't keep up
  game.watchSpeed = settings.graphics === 'auto' && !settings.slowDevice;
  game.onSlow = () => {
    changeSettings({ slowDevice: true });
    prompt.innerHTML = `<small>GRAPHICS</small>Switched to smooth mode for this phone`;
    setTimeout(() => { if (prompt.textContent?.includes('smooth mode')) prompt.innerHTML = ''; }, 3000);
  };
  game.start(bike, tutorial);
  music(true);
  showUpdate('ride');
  onBack(togglePause);
}

// ---------- results ----------

function results(r: RideResult, rw: RideRewards, route: Route, hadGhost = false) {
  const p = profile!;
  showUpdate('menu');
  const levelUp = rw.levelAfter > rw.levelBefore;
  const unlocked = RACES.filter((x) => x.level > rw.levelBefore && x.level <= rw.levelAfter);
  const explore = isExplore(route);
  const headline = r.finished ? (explore ? 'You made it' : 'Finish!') : 'Wiped out';
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">${esc(route.name)}</p>
        <h1 class="title">${headline}</h1>
        ${explore && r.finished && route.id === 'explore' ? placeCard(route.to) : ''}
        ${explore && r.finished ? `<p class="muted">${route.id === 'freshers-tour' ? `You toured ${TOUR_STOPS.length} places every fresher needs.` : `You found your way to <b>${esc(route.to.name)}</b>.`} Here is the way you rode:</p>${stepsList(route)}` : ''}
        ${rw.newBestTime ? '<span class="badge gold">New personal best 🔥</span>' : rw.newBestScore ? '<span class="badge gold">New high score 🔥</span>' : ''}
        <div class="result-big">${km(r.distance)} <span style="font-size:0.4em">KM</span></div>
        ${r.finished ? `<p class="muted">Time ${clock(r.time)}</p>` : ''}
        <div class="card">
          <div class="reward-row"><span>Score</span><b data-count="${rw.score}">0</b></div>
          <div class="reward-row"><span>Coins</span><b>+<span data-count="${rw.coins}">0</span> ${icons.coin}</b></div>
          <div class="reward-row"><span>XP</span><b>+<span data-count="${rw.xp}">0</span></b></div>
        </div>
        ${levelUp ? `<div class="levelup">🎉 Level up! You're now level ${rw.levelAfter}</div>` : ''}
        ${unlocked.map((x) => `<button class="card selectable unlock-card" data-race="${x.id}"><div class="row"><b>🔓 New race: ${esc(x.name)}</b><span class="grow"></span>${icons.arrow}</div><p class="muted small">${esc(x.blurb)}</p></button>`).join('')}
        ${route.kind === 'race' && r.finished && !hadGhost ? `<p class="muted small">Next time on this route, a ghost of this run rides with you. Beat it.</p>` : ''}
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
  on('#explore', 'click', () => explorePicker(route.id === 'explore' ? route.to.name : undefined));
  on('#home', 'click', () => home());
  on('#create', 'click', () => createRider({ ...p, name: '' }, false));
  on('[data-race]', 'click', (_, el) => play(false, raceRoute(RACES.find((x) => x.id === el.dataset.race)!)));
  onBack(() => home());
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
  const daily = dailyReward(p);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const TIME_ICON = { day: '☀️', sunset: '🌅', night: '🌙' };
  const raceCard = (r: RaceDef) => {
    if (level < r.level) {
      return `<div class="card locked"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge">Level ${r.level}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">Reach level ${r.level} to unlock.</p></div>`;
    }
    const route = raceRoute(r);
    const b = p.bestTimes[r.id];
    return `<button class="card selectable" data-race="${r.id}" style="text-align:left"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">${(route.length / 1000).toFixed(1)} km · Difficulty ${stars(r.difficulty)}${b ? ` · Best ${clock(b)} 👻` : ''}</p></button>`;
  };
  const exploreCard = `<button class="card selectable explore-card" id="exploreBtn"><div class="row"><h3 style="font-weight:800">${icons.ride} EXPLORE CAMPUS</h3><span class="grow"></span><span class="badge gold">New</span></div><p class="muted small" style="margin-top:4px">New on campus? Pick where you are and where you need to be, then ride the real way there with directions.</p></button>
    <button class="card selectable explore-card" id="quizBtn"><div class="row"><h3 style="font-weight:800">📍 WHERE IS IT?</h3><span class="grow"></span><span class="badge gold">Earn ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">Five campus places. Tap the map where you think each one is.</p></button>`;

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
        ${daily ? `<button class="card selectable daily-card" id="daily"><div class="row"><span class="daily-icon">🎁</span><div class="grow"><b>Daily reward · Day ${daily.day}</b><p class="muted small">${daily.day > 1 ? `${daily.day} days in a row. ` : ''}Come back tomorrow for more.</p></div><span class="badge gold">+${daily.coins} ${icons.coin}</span></div></button>` : p.streak > 1 ? `<p class="muted small">🔥 ${p.streak}-day streak. Your next reward unlocks tomorrow.</p>` : ''}
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
        <p class="kicker" style="margin-top:8px">Races</p>
        <p class="muted small">Beat your best time: a ghost of your best run rides with you.</p>
        <div class="card selectable" id="routeCard">
          <div class="row"><h3 style="font-weight:800">${esc(CAMPUS_LOOP.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div>
          <p class="muted small" style="margin-top:4px">${(CAMPUS_LOOP.length / 1000).toFixed(1)} km · Difficulty ${stars(CAMPUS_LOOP.difficulty)}${best ? ` · Best ${clock(best)} 👻` : ''}</p>
        </div>
        ${RACES.map(raceCard).join('')}
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
        <button class="btn btn-primary" data-tab="ride">Race your ghost on solo routes</button>
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
        <button class="btn btn-ghost" id="settings">Settings</button>
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
  on('[data-race]', 'click', (_, el) => play(false, raceRoute(RACES.find((r) => r.id === el.dataset.race)!)));
  on('#settings', 'click', () => settingsScreen());
  on('#daily', 'click', () => {
    if (claimDaily(p)) sfx.finish();
    home('home');
  });
  showUpdate('menu');
  // back from another tab goes to Home; from Home it leaves the app
  onBack(tab === 'home' ? null : () => home());
  on('#quizBtn', 'click', () => whereIsIt());
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
    clearGhosts();
    profile = null;
    welcome();
  });
}

// ---------- settings ----------

function settingsScreen() {
  const seg = (id: string, options: [string, string][], value: string) =>
    `<div class="seg" id="${id}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  const graphicsNote = () => settings.graphics === 'auto'
    ? `Starts sharp and switches to smooth if your phone struggles.${settings.slowDevice ? ' This phone is on smooth.' : ''}`
    : settings.graphics === 'low' ? 'No shadows and a lower resolution. Runs faster and uses less battery.' : 'Shadows and full resolution.';
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack settings">
        <button class="btn btn-link back" id="back">← Back</button>
        <h1 class="title">Settings</h1>
        <div class="card stack">
          <div class="set-row"><b>Sound</b>${seg('sound', [['1', 'On'], ['0', 'Off']], settings.sound ? '1' : '0')}</div>
          <label class="set-row"><span>Effects</span><input type="range" id="volume" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}" aria-label="Sound effects volume"></label>
          <label class="set-row"><span>Music</span><input type="range" id="musicVol" min="0" max="100" step="5" value="${Math.round(settings.musicVolume * 100)}" aria-label="Ride music volume"></label>
          <p class="muted small">Music plays during rides. Slide it to zero to turn it off.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Graphics</b>${seg('graphics', [['auto', 'Auto'], ['high', 'Sharp'], ['low', 'Smooth']], settings.graphics)}</div>
          <p class="muted small" id="gNote">${graphicsNote()}</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Boost button</b>${seg('hand', [['0', 'Right'], ['1', 'Left']], settings.leftHanded ? '1' : '0')}</div>
          <p class="muted small">Put the boost button under the thumb you prefer.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Motion</b>${seg('motion', [['0', 'Full'], ['1', 'Reduced']], settings.reducedMotion ? '1' : '0')}</div>
          <p class="muted small">Reduced turns off camera shake, speed zoom and screen animations.</p>
        </div>
      </div>
    </div>`);
  const pick = (id: string, fn: (v: string) => void) => on(`#${id} [data-v]`, 'click', (_, el) => {
    app.querySelectorAll(`#${id} [data-v]`).forEach((b) => b.classList.toggle('on', b === el));
    fn(el.dataset.v!);
  });
  pick('sound', (v) => changeSettings({ sound: v === '1' }));
  pick('graphics', (v) => {
    // choosing Auto again gives the phone a fresh chance at sharp graphics
    changeSettings({ graphics: v as typeof settings.graphics, slowDevice: false });
    app.querySelector('#gNote')!.textContent = graphicsNote();
  });
  pick('hand', (v) => changeSettings({ leftHanded: v === '1' }));
  pick('motion', (v) => changeSettings({ reducedMotion: v === '1' }));
  on('#volume', 'input', (_, el) => changeSettings({ volume: Number((el as HTMLInputElement).value) / 100 }));
  on('#volume', 'change', () => sfx.coin());
  on('#musicVol', 'input', (_, el) => changeSettings({ musicVolume: Number((el as HTMLInputElement).value) / 100 }));
  on('#back', 'click', () => home('you'));
  onBack(() => home('you'));
}

// ---------- explore ----------

const POPULAR = ['School of Law', 'Pent Hostel Block A', 'The Balme Library', 'Great Hall', 'Night Market', 'Jones Quartey Building, JQB', 'University of Ghana Hospital', 'Legon Main Entrance'];

function stepsList(route: Route) {
  return `<ol class="steps">${route.steps.map((s, i) => `
    <li class="${s.turn === 'arrive' || s.turn === 'stop' ? 'arrive' : ''}"><span class="turn-arrow">${ARROW[s.turn]}</span><span class="grow">${esc(s.text)}</span>${i < route.steps.length - 1 ? `<small class="muted">${dm(route.steps[i + 1].d - s.d)}</small>` : ''}</li>`).join('')}</ol>`;
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

/** What a place is, for the cards in Explore. Kept short and factual. */
const PLACE_INFO: [RegExp, string][] = [
  [/^The Balme Library$/, "The university's main library."],
  [/^Jones Quartey Building/, 'Lecture block with about seven lecture halls. The Radio Univers newsroom is here too.'],
  [/^Night Market$/, 'On-campus food market with food stalls and a mini mall.'],
  [/^Bush Canteen/, "Officially the University Workers' Canteen: affordable local food."],
  [/^Great Hall$/, 'Where congregations (graduations) and big university events are held.'],
  [/^University of Ghana Registry$/, 'Main administration: admissions, records and student matters.'],
  [/^University of Ghana Hospital$/, 'The university hospital for students and staff, often called Legon Hospital.'],
  [/^Commonwealth Hall$/, 'All-male hall. Residents are the Vandals; the motto is "Truth Stands".'],
  [/^Volta Hall$/, 'All-female hall.'],
  [/^Mensah Sarbah Hall$/, 'Residents are the Vikings. The hall has annexes A to D.'],
  [/^Akuafo Hall/, 'Akuafo is Akan for farmers.'],
  [/^Legon Hall$/, 'The first hall built on campus, close to the Balme Library.'],
  [/^Pent/, 'Part of Africa Union Hall (Pent): five hostel blocks named for their pentagon shape.'],
  [/^(Dr. Hilla Limann|Alexander Kwapong|Elizabeth Frances Sey|Jean Nelson Aka) Hall$/, 'One of the four Diaspora halls.'],
];
const NEARBY_KINDS = new Set<PlaceKind>(['food', 'bank', 'health', 'landmark', 'academic', 'sport']);

function placeCard(place: Place) {
  const [icon, label] = KIND_ICON[place.kind];
  const info = PLACE_INFO.find(([re]) => re.test(place.name))?.[1];
  const nearby: Place[] = [];
  for (const q of [...PLACES].sort((a, b) => Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z))) {
    if (Math.hypot(q.x - place.x, q.z - place.z) > 250 || nearby.length >= 4) break;
    if (q === place || !NEARBY_KINDS.has(q.kind) || nearby.some((n) => n.name.split(' (')[0] === q.name.split(' (')[0])) continue;
    nearby.push(q);
  }
  // nearest trotro stop and where its trotros go
  let stop: Place | undefined, stopD = Infinity;
  for (const q of PLACES) {
    if (!q.lines) continue;
    const d = Math.hypot(q.x - place.x, q.z - place.z);
    if (d < stopD) { stop = q; stopD = d; }
  }
  const ends = stop && stopD < 900 ? [...new Set(stop.lines!.flatMap((l) => LINE_ENDS[l] ?? []))].slice(0, 8) : [];
  return `
    <div class="card place-card">
      <div class="row"><span class="kind-icon">${icon}</span><div class="grow"><b>${esc(place.name)}</b><div class="muted small">${label}</div></div></div>
      ${info ? `<p class="small" style="margin-top:8px">${esc(info)}</p>` : ''}
      ${nearby.length ? `<p class="muted small" style="margin-top:8px">Nearby: ${nearby.map((n) => `${KIND_ICON[n.kind][0]} ${esc(n.name.split(' (')[0])}`).join(' · ')}</p>` : ''}
      ${stop && ends.length ? `<p class="muted small" style="margin-top:6px">🚌 Nearest trotro stop: <b>${esc(stop.name.split(' (')[0])}</b>, ${dm(stopD)} away. Trotros to ${ends.map(esc).join(', ')}.</p>` : ''}
    </div>`;
}

async function shareRoute(from: Place, to: Place, note: HTMLElement) {
  const url = `${location.origin}/play/?${new URLSearchParams({ from: from.name, to: to.name, mode: exploreOpts.mode })}`;
  const text = `How to get from ${from.name} to ${to.name} on campus, on LEGONRUSH`;
  try {
    if (navigator.share) return await navigator.share({ title: 'LEGONRUSH', text, url });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  note.hidden = false;
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    note.innerHTML = `Link copied. <a href="https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}" target="_blank" rel="noopener">Send on WhatsApp</a>`;
  } catch {
    note.innerHTML = `<a href="https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}" target="_blank" rel="noopener">Send on WhatsApp</a> or copy: <span class="small">${esc(url)}</span>`;
  }
}

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
        <button class="card selectable tour-card" id="tour"><div class="row"><h3 style="font-weight:800">⭐ FRESHERS' TOUR</h3><span class="grow"></span><span class="badge gold">${TOUR_STOPS.length} places · 3.5 km</span></div><p class="muted small" style="margin-top:4px">One ride past the places you need in week one: ${TOUR_STOPS.map((n) => esc(n.replace(/^The |, .*$/g, ''))).join(', ')}.</p></button>
        <p class="kicker" style="margin-top:6px">Or plan your own way</p>
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
      ${placeCard(to)}
      <canvas class="route-map" width="720" height="440" aria-label="Map of the way from ${esc(from.name)} to ${esc(to.name)}"></canvas>
      <div class="stats three">
        <div class="stat"><b>${dm(route.length)}</b><span>Distance</span></div>
        <div class="stat"><b>${mins(route.length / 1.3)}</b><span>Walking</span></div>
        <div class="stat"><b>${mins(route.length / 4.5)}</b><span>Cycling</span></div>
      </div>
      <button class="btn btn-primary" id="go">Ride there</button>
      <div class="two">
        <button class="btn btn-ghost" id="share">Share route</button>
        <a class="btn btn-ghost" id="gmaps" target="_blank" rel="noopener">Google Maps</a>
      </div>
      <p class="muted small" id="shareNote" hidden></p>
      <p class="kicker" style="margin-top:6px">Directions</p>
      ${stepsList(route)}`;
    routeMap(preview.querySelector('canvas')!, route);
    preview.querySelector('#go')!.addEventListener('click', () => route && play(false, route));
    const [fl, fg] = toLatLng(from.x, from.z), [tl, tg] = toLatLng(to.x, to.z);
    preview.querySelector<HTMLAnchorElement>('#gmaps')!.href =
      `https://www.google.com/maps/dir/?api=1&origin=${fl.toFixed(6)},${fg.toFixed(6)}&destination=${tl.toFixed(6)},${tg.toFixed(6)}&travelmode=${exploreOpts.mode === 'walk' ? 'walking' : 'bicycling'}`;
    const a = from, b = to;
    preview.querySelector('#share')!.addEventListener('click', () => shareRoute(a, b, preview.querySelector('#shareNote')!));
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
  onBack(() => home());
  on('#tour', 'click', () => play(false, freshersTour()));
  update();
}

// ---------- where is it? ----------

const QUIZ_POOL = [
  'The Balme Library', 'Great Hall', 'University of Ghana Registry', 'Legon Main Entrance', 'Night Market', 'Central Cafeteria, CC',
  'Jones Quartey Building, JQB', 'New N Block, NNB', 'School of Law', 'University of Ghana Business School', 'University of Ghana Hospital',
  'Athletic Oval', 'Pent Hostel Block A', 'Legon Hall', 'Akuafo Hall Main', 'Commonwealth Hall', 'Volta Hall', 'Mensah Sarbah Hall',
  'Jean Nelson Aka Hall', 'Alexander Kwapong Hall', 'Elizabeth Frances Sey Hall', 'Dr. Hilla Limann Hall', 'International Students Hostel 1, ISH 1',
  'Valco Trust Hostel Phase 1', 'SRC Union Building',
];
const ROUNDS = 5;
const quizPoints = (m: number) => (m <= 40 ? 100 : Math.max(0, Math.round(100 * (1 - (m - 40) / 560))));

function whereIsIt() {
  if (!profile) return welcome();
  const p = profile;
  const home_ = placeByName(HALL_PLACE[p.hall] ?? '');
  const pool = QUIZ_POOL.map((n) => placeByName(n)).filter((pl): pl is Place => !!pl && pl !== home_);
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, ROUNDS);
  let round = 0, total = 0;
  render(`
    <div class="screen scrim fade-in">
      <div class="wrap stack quiz">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker" id="qRound"></p>
        <h1 class="title" id="qTitle" style="font-size:clamp(22px,6vw,30px)"></h1>
        <p class="muted small" id="qHint">Tap the map where you think it is.</p>
        <canvas class="quiz-map" id="qMap" width="720" height="780" aria-label="Campus map"></canvas>
        <p id="qResult" class="quiz-result"></p>
        <div class="two" id="qNext" hidden>
          <button class="btn btn-ghost" id="qRide">Ride there</button>
          <button class="btn btn-primary" id="qGo">Next</button>
        </div>
      </div>
    </div>`);
  const canvas = app.querySelector<HTMLCanvasElement>('#qMap')!;
  const map = campusOverview(canvas, [...pool, ...(home_ ? [home_] : [])]);
  const $ = (id: string) => app.querySelector<HTMLElement>('#' + id)!;
  const youPin: Pin[] = home_ ? [{ x: home_.x, z: home_.z, color: '#5ec8ff', label: 'Your hall' }] : [];
  let answered = false;
  const ask = () => {
    answered = false;
    const target = picks[round];
    $('qRound').textContent = `Where is it? · ${round + 1} of ${picks.length} · ${total} pts`;
    $('qTitle').textContent = target.name.replace(/, [A-Z]+ ?\d?$/, '');
    $('qHint').hidden = false;
    $('qResult').textContent = '';
    $('qNext').hidden = true;
    map.draw(youPin);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (answered) return;
    answered = true;
    const r = canvas.getBoundingClientRect();
    const [x, z] = map.toWorld(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
    const target = picks[round];
    const off = Math.hypot(x - target.x, z - target.z);
    const pts = quizPoints(off);
    total += pts;
    const guess: Pin = { x, z, color: '#ffd21f' };
    const real: Pin = { x: target.x, z: target.z, color: '#22c55e', label: target.name.replace(/^The |, .*$/g, '') };
    map.draw([...youPin, guess, real], [guess, real]);
    $('qHint').hidden = true;
    $('qResult').innerHTML = `${off <= 40 ? 'Spot on!' : `${dm(off)} away.`} <b>+${pts}</b>`;
    $('qRound').textContent = `Where is it? · ${round + 1} of ${picks.length} · ${total} pts`;
    $('qNext').hidden = false;
    $('qGo').textContent = round + 1 < picks.length ? 'Next' : 'See score';
  });
  on('#qGo', 'click', () => {
    round++;
    if (round < picks.length) return ask();
    const coins = Math.round(total / 5), xp = Math.round(total / 2);
    p.coins += coins;
    p.xp += xp;
    saveProfile(p);
    render(`
      <div class="screen scrim fade-in">
        <div class="grow"></div>
        <div class="wrap stack" style="text-align:center">
          <p class="kicker">Where is it?</p>
          <h1 class="title">${total >= 400 ? 'Campus expert' : total >= 250 ? 'Getting there' : 'Keep exploring'}</h1>
          <div class="result-big">${total} <span style="font-size:0.4em">/ ${picks.length * 100}</span></div>
          <div class="card">
            <div class="reward-row"><span>Coins</span><b>+${coins} ${icons.coin}</b></div>
            <div class="reward-row"><span>XP</span><b>+${xp}</b></div>
          </div>
          <button class="btn btn-primary" id="again">Play again</button>
          <button class="btn btn-ghost" id="explore">Explore campus</button>
          <button class="btn btn-ghost" id="home">Home</button>
        </div>
      </div>`);
    on('#again', 'click', () => whereIsIt());
    on('#explore', 'click', () => explorePicker());
    on('#home', 'click', () => home());
  });
  on('#qRide', 'click', () => explorePicker(undefined, picks[round].name));
  on('#back', 'click', () => home());
  onBack(() => home());
  ask();
}

splash();
