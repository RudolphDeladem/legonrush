// Missions mode (Home): numbered levels on real campus roads. Clearing a level unlocks the next,
// and each one asks for more: a tighter clock, heavier traffic, coins to collect, rain and night.
// Progress lives in the profile (missionLevels). Not the daily missions panel, nor the timed
// campus errands in Explore (missions.ts).
import type { HudState, TimeOfDay } from '../game/Game';
import { placeByName, type Place } from '../game/campusmap';
import { TOUR_STOPS, routeThrough, type Route } from '../game/routes';
import { track, type Difficulty, type Profile, type RideResult } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { grant } from './inventory';
import { H, clock, esc, fmt, on, screen, type ChallengeRide } from './host';

export interface MissionLevel {
  n: number;
  name: string;
  brief: string;
  stops: string[];
  time: TimeOfDay;
  /** traffic and obstacles for this level, whatever the Settings say */
  traffic: Difficulty;
  /** average speed needed, metres a second, and seconds of slack on top */
  pace: number;
  slack: number;
  /** coins to collect per km (0: none needed) */
  coinsPerKm: number;
  rain?: boolean;
  reward: number;
}

export const TIERS = [
  { from: 1, name: 'Fresher', text: 'Learn the roads. Light traffic and plenty of time.' },
  { from: 6, name: 'Continuing student', text: 'Busier roads, coins to collect and a sunset or two.' },
  { from: 11, name: 'Final year', text: 'Heavy traffic, rain and night rides. Every second counts.' },
];

const L = (n: number, name: string, brief: string, stops: string[], time: TimeOfDay, traffic: Difficulty, pace: number, slack: number, coinsPerKm: number, reward: number, rain = false): MissionLevel =>
  ({ n, name, brief, stops, time, traffic, pace, slack, coinsPerKm, reward, rain });

export const LEVELS: MissionLevel[] = [
  L(1, 'First pedal', 'Ride from Limann Hall to the Night Market. Just get there in time.', ['Dr. Hilla Limann Hall', 'Night Market'], 'day', 'easy', 10, 20, 0, 100),
  L(2, 'Lunch run', 'From the Night Market to the Central Cafeteria before the queue grows.', ['Night Market', 'Central Cafeteria, CC'], 'day', 'easy', 10.5, 18, 0, 120),
  L(3, 'To class', 'From CC to JQB, and pick up some coins on the way.', ['Central Cafeteria, CC', 'Jones Quartey Building, JQB'], 'day', 'easy', 11, 16, 8, 150),
  L(4, 'Library dash', 'JQB to the Balme Library, then the Registry before it closes.', ['Jones Quartey Building, JQB', 'The Balme Library', 'University of Ghana Registry'], 'day', 'normal', 11.5, 15, 0, 180),
  L(5, 'Great Hall climb', 'Sarbah Hall past Legon Hall and up to the Great Hall.', ['Mensah Sarbah Hall', 'Legon Hall', 'Great Hall'], 'day', 'normal', 12, 14, 10, 220),
  L(6, 'Gate run', 'Commonwealth Hall to the Main Gate as the sun goes down.', ['Commonwealth Hall', 'Legon Main Entrance'], 'sunset', 'normal', 12.5, 13, 12, 250),
  L(7, 'Market rush', 'Akuafo Hall to the Night Market, then on to Volta Hall.', ['Akuafo Hall Main', 'Night Market', 'Volta Hall'], 'day', 'normal', 13, 12, 15, 280),
  L(8, 'Rain check', 'Jean Nelson Aka Hall to the Business School through the rain. Watch the puddles.', ['Jean Nelson Aka Hall', 'The Balme Library', 'University of Ghana Business School'], 'day', 'normal', 12.5, 12, 10, 300, true),
  L(9, 'Oval lap', 'Commonwealth Hall past the Athletic Oval to the Sports Complex at golden hour.', ['Commonwealth Hall', 'Athletic Oval', 'Sports Complex'], 'sunset', 'normal', 13.5, 11, 18, 330),
  L(10, 'Engineering sprint', 'Limann Hall, out past the Main Gate, to Engineering. Traffic is heavy now.', ['Dr. Hilla Limann Hall', 'Legon Main Entrance', 'School of Engineering Sciences'], 'day', 'hard', 13.5, 10, 15, 400),
  L(11, 'Night errand', 'Sports Complex to Bush Canteen by way of the Night Market, after dark.', ['Sports Complex', 'Night Market', 'Bush Canteen (near Department of Music)'], 'night', 'hard', 14, 9, 18, 450),
  L(12, 'Hospital run', 'Volta Hall to the University Hospital in the rain. Someone needs you there fast.', ['Volta Hall', 'University of Ghana Hospital'], 'day', 'hard', 13.5, 8, 12, 500, true),
  L(13, 'Hall to hall', 'Kwapong, Sey, Legon and Commonwealth: four halls in one ride.', ['Alexander Kwapong Hall', 'Elizabeth Frances Sey Hall', 'Legon Hall', 'Commonwealth Hall'], 'day', 'hard', 14.5, 8, 22, 550),
  L(14, "Freshers' Tour, flat out", "The whole Freshers' Tour at race pace, into the sunset.", TOUR_STOPS, 'sunset', 'hard', 14.5, 7, 22, 650),
  L(15, 'Legon Rush', 'Limann to the Main Gate, the Great Hall and the Sports Complex at night. The final test.', ['Dr. Hilla Limann Hall', 'Legon Main Entrance', 'Great Hall', 'Commonwealth Hall', 'Sports Complex'], 'night', 'hard', 15, 6, 20, 1000),
];

export interface LevelProgress { best: number; stars: number }

const progress = (p: Profile) => (p.missionLevels ??= {});
/** the highest level you may ride: one past the last you cleared */
export const unlockedLevel = (p: Profile) => {
  const done = progress(p);
  let n = 1;
  while (n < LEVELS.length && done[n]) n++;
  return n;
};
export const levelsCleared = (p: Profile) => LEVELS.filter((l) => progress(p)[l.n]).length;

const routes = new Map<number, Route | null>();
export function levelRoute(l: MissionLevel) {
  if (!routes.has(l.n)) {
    const stops = l.stops.map(placeByName);
    routes.set(l.n, stops.every(Boolean) ? routeThrough(stops as Place[], { id: `level-${l.n}`, name: `Level ${l.n}: ${l.name}`, kind: 'race', difficulty: Math.min(5, 1 + Math.floor(l.n / 4)), time: l.time }) : null);
  }
  return routes.get(l.n)!;
}

export const timeLimit = (l: MissionLevel, r: Route) => Math.round(r.length / l.pace + l.slack);
export const coinGoal = (l: MissionLevel, r: Route) => Math.round((r.length / 1000) * l.coinsPerKm);
/** 1 star for clearing, 2 with 10% of the clock to spare, 3 with 20% */
const starsFor = (left: number, limit: number) => (left >= limit * 0.2 ? 3 : left >= limit * 0.1 ? 2 : 1);
const starRow = (n: number) => `<span class="lv-stars">${[1, 2, 3].map((k) => `<span class="${k <= n ? 'on' : ''}">${fx.starFill}</span>`).join('')}</span>`;

/** The level map: every level, locked ones greyed, with the chosen level's details on top. */
export function levelsScreen(back: () => void = () => H().home(), pick?: number) {
  const p = H().profile();
  const open = unlockedLevel(p);
  const sel = LEVELS[Math.min(open, pick ?? open) - 1];
  const r = levelRoute(sel);
  const best = progress(p)[sel.n];
  const goals = r ? [
    `${fx.timer} Finish in ${clock(timeLimit(sel, r))}`,
    coinGoal(sel, r) ? `${icons.coin} Collect ${coinGoal(sel, r)} coins` : '',
    sel.rain ? `${icons.rain} Rain` : '',
    sel.time === 'night' ? `${icons.moon} Night` : sel.time === 'sunset' ? `${icons.sunrise} Sunset` : '',
    `${icons.alert} ${sel.traffic === 'easy' ? 'Light' : sel.traffic === 'normal' ? 'Busy' : 'Heavy'} traffic`,
  ].filter(Boolean) : [];
  screen(`
    <p class="kicker">${icons.target} Missions</p>
    <h1 class="title">Mission levels</h1>
    <p class="muted">Clear a level to unlock the next. Each one is harder than the last. ${levelsCleared(p)} of ${LEVELS.length} cleared.</p>
    <div class="card lv-detail">
      <div class="row"><span class="lv-num big">${sel.n}</span><div class="grow"><small class="muted">LEVEL ${sel.n} · ${esc(tierOf(sel.n).name.toUpperCase())}</small><h3>${esc(sel.name)}</h3></div>${best ? starRow(best.stars) : ''}</div>
      <p class="small">${esc(sel.brief)}</p>
      ${r ? `<div class="fx-meta">${goals.map((g) => `<span>${g}</span>`).join('')}<span>${fx.route} ${(r.length / 1000).toFixed(1)} km</span><span>${icons.coin} ${fmt(sel.reward)} first clear</span>${best ? `<span>${icons.trophy} Best ${clock(best.best)}</span>` : ''}</div>
      <button class="btn btn-primary" id="lvGo">${best ? 'Play again' : `Start level ${sel.n}`}</button>` : '<p class="muted small">This level is not ready in your version of the game.</p>'}
    </div>
    ${TIERS.map((t, k) => {
      const to = TIERS[k + 1]?.from ?? LEVELS.length + 1;
      return `<div class="lv-tier"><b>${esc(t.name)}</b><small class="muted">${esc(t.text)}</small></div>
      <div class="lv-grid">${LEVELS.filter((l) => l.n >= t.from && l.n < to).map((l) => {
        const got = progress(p)[l.n];
        const locked = l.n > open;
        return `<button class="lv-tile${locked ? ' locked' : ''}${l.n === sel.n ? ' sel' : ''}${got ? ' done' : ''}" data-lv="${l.n}"${locked ? ' aria-disabled="true"' : ''}>
          <span class="lv-num">${locked ? icons.lock : l.n}</span><span class="lv-name">${esc(l.name)}</span>${got ? starRow(got.stars) : locked ? '<small class="muted">Locked</small>' : '<small class="lv-new">Next up</small>'}
        </button>`;
      }).join('')}</div>`;
    }).join('')}
  `, back, 'lv-screen');
  on('[data-lv]', 'click', (_, el) => {
    const n = Number(el.dataset.lv);
    if (n > open) return H().toast(`Clear level ${open} to unlock level ${open + 1}.`);
    levelsScreen(back, n);
  });
  on('#lvGo', 'click', () => playLevel(sel, back));
}

const tierOf = (n: number) => [...TIERS].reverse().find((t) => n >= t.from)!;

export function playLevel(l: MissionLevel, back: () => void = () => H().home()) {
  const r = levelRoute(l);
  if (!r) return;
  const limit = timeLimit(l, r), coins = coinGoal(l, r);
  const ride: ChallengeRide = {
    difficulty: l.traffic,
    rain: !!l.rain,
    hud: (hud) => levelHud(hud, l, limit, coins),
    after: (res) => {
      const out = finishLevel(l, res, limit, coins);
      const nextLevel = LEVELS[l.n];
      ride.next = out.passed && nextLevel
        ? { label: `Next: level ${nextLevel.n}`, run: () => playLevel(nextLevel, back) }
        : out.passed ? { label: 'All levels', run: () => levelsScreen(back) } : { label: 'Try again', run: () => playLevel(l, back) };
      return out.html;
    },
    leave: () => levelsScreen(back, l.n),
  };
  H().play(r, { challengeRide: ride });
}

function levelHud(hud: HTMLElement, l: MissionLevel, limit: number, goal: number) {
  const el = document.createElement('div');
  el.className = 'fx-mhud';
  el.innerHTML = `<span class="fx-ico">${icons.target}</span><span class="grow"><small>LEVEL ${l.n} · ${esc(l.name.toUpperCase())}</small><b id="lvClock"></b></span><span class="fx-mnote" id="lvCoins"></span>`;
  hud.appendChild(el);
  const clockEl = el.querySelector<HTMLElement>('#lvClock')!;
  const coinsEl = el.querySelector<HTMLElement>('#lvCoins')!;
  let t = 0, last = 0;
  return (h: HudState) => {
    const now = performance.now();
    // ride time the way the game counts it: frames are capped at 1/20 s
    if (!h.countdown && last && h.distance < h.routeLength) t += Math.min(0.05, (now - last) / 1000);
    last = now;
    const left = limit - t;
    el.classList.toggle('late', left < 0);
    el.classList.toggle('soon', left >= 0 && left < 10);
    clockEl.textContent = left >= 0 ? clock(left) : `Late ${clock(-left)}`;
    coinsEl.textContent = goal ? `${Math.min(h.coins, goal)}/${goal} coins` : '';
  };
}

function finishLevel(l: MissionLevel, r: RideResult, limit: number, goal: number) {
  const p = H().profile();
  const late = r.time - limit;
  const passed = r.finished && late <= 0 && r.coins >= goal;
  const why = !r.finished ? 'You crashed out before the finish.' : late > 0 ? `${clock(late)} too slow.` : `${r.coins} of ${goal} coins. Grab more on the way.`;
  const prev = progress(p)[l.n];
  let bonus = 0, stars = 0;
  if (passed) {
    stars = starsFor(-late, limit);
    if (!prev) {
      bonus = l.reward;
      grant(p, { coins: bonus, xp: 50 + l.n * 10 });
    }
    progress(p)[l.n] = { best: Math.min(prev?.best ?? Infinity, r.time), stars: Math.max(prev?.stars ?? 0, stars) };
    track(p, 'missions');
  }
  const next = LEVELS[l.n];
  const html = `<div class="card fx-outcome ${passed ? 'pass' : 'fail'}">
    <div class="row"><span class="fx-ico">${passed ? icons.check : fx.hourglass}</span><b class="grow">Level ${l.n}: ${passed ? 'cleared' : 'not cleared'}</b>${passed ? starRow(stars) : ''}${bonus ? `<span class="badge gold">+${fmt(bonus)} ${icons.coin}</span>` : ''}</div>
    <p class="small muted">${passed ? `Done in ${clock(r.time)} with ${clock(-late)} to spare.${!prev && next ? ` Level ${next.n} is unlocked.` : !next ? ' You cleared the final level!' : ''}` : esc(why)}</p>
  </div>`;
  return { passed, html };
}
