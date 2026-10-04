import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, type Action, type HudState } from './game/Game';
import { BIKES, CAMPUS_LOOP, HALLS, ROUTES, bikeById, hallById } from './data/campus';
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

/** Heading-up mini map of the real campus road around the rider. */
function miniMap(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const { outline, landmarks, finish } = game.map;
  const R = canvas.width / 2;
  const k = R / 260; // shows about 260 m around the rider
  return (pos: [number, number], yaw: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 21, 48, 0.72)';
    ctx.fill();
    ctx.clip();
    ctx.translate(R, R + R * 0.25);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.translate(-pos[0], -pos[1]);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    outline.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 7 / k;
    ctx.stroke();
    for (const l of landmarks) {
      ctx.beginPath();
      ctx.arc(l.x, l.z, (l.place.kind === 'hall' || l.place.kind === 'landmark' ? 7 : 4.5) / k, 0, Math.PI * 2);
      ctx.fillStyle = l.place.kind === 'hall' ? '#f5c518' : l.place.kind === 'landmark' ? '#ff7a59' : '#5ec8ff';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(finish.x, finish.z, 9 / k, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.restore();
    // rider arrow, always pointing up
    ctx.save();
    ctx.translate(R, R + R * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 4); ctx.lineTo(-10, 10); ctx.closePath();
    ctx.fillStyle = '#f5c518';
    ctx.strokeStyle = '#0b1530';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function play(tutorial: boolean) {
  if (!profile) return;
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
          <p class="muted">${esc(CAMPUS_LOOP.name.toUpperCase())}</p>
        </div>
        <div class="row">
          <div class="hud-pill">${icons.coin} <span id="coins">0</span></div>
          <button class="pause-btn" id="pause" aria-label="Pause">${icons.pause}</button>
        </div>
      </div>
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
  const drawMap = miniMap(app.querySelector<HTMLCanvasElement>('#minimap')!);

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
    const result: RideResult = { routeId: CAMPUS_LOOP.id, ...r };
    const rewards = applyRide(profile!, result);
    results(result, rewards);
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
      if (p === 'restart') { cleanup(); play(false); }
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

  game.start(bike, tutorial);
}

// ---------- results ----------

function results(r: RideResult, rw: RideRewards) {
  const p = profile!;
  const levelUp = rw.levelAfter > rw.levelBefore;
  const headline = r.finished ? 'Finish!' : 'Wiped out';
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">${esc(CAMPUS_LOOP.name)}</p>
        <h1 class="title">${headline}</h1>
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
  on('#again', 'click', () => play(false));
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
        <div class="card locked"><div class="row"><h3 style="font-weight:800">FREE RIDE</h3><span class="grow"></span><span class="badge">Phase 2</span></div><p class="muted small">Explore the campus with no score pressure.</p></div>
        <p class="kicker" style="margin-top:8px">Routes</p>
        ${ROUTES.map((r) => `
          <div class="card ${r.available ? 'selectable' : 'locked'}" ${r.available ? 'id="routeCard"' : ''}>
            <div class="row"><h3 style="font-weight:800">${esc(r.name.toUpperCase())}</h3><span class="grow"></span>${r.available ? `<span class="badge gold">${r.reward} ${icons.coin}</span>` : '<span class="badge">Phase 2</span>'}</div>
            <p class="muted small" style="margin-top:4px">${(r.length / 1000).toFixed(1)} km · Difficulty ${'★'.repeat(r.difficulty)}${'☆'.repeat(5 - r.difficulty)}${r.available && p.bestTimes[r.id] ? ` · Best ${clock(p.bestTimes[r.id])}` : ''}</p>
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

splash();
