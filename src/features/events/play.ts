// Playing events in the 3D game: each activity is a plug-in for a normal ride (ride-hook.ts).
//  - Treasure Hunt: ride where you like; a hot/cold meter; the treasure appears on the road when near
//  - Coin Rush: coins keep landing on the road ahead for the time limit
//  - Diamond Rush: three rare diamonds on the road
//  - Photo Hunt / Campus Explorer: reach every place on a list (a photo is taken at each)
//  - Sunset Ride: ride to a scenic spot at golden hour; the moment is photographed
//  - Ride there: for social events, arrive, park the bike, enter the event space
// Event rules (night, rain, fog, no minimap, no boost, no helmet, time limit, no racing) apply here.
import type { HudState, RideEnd } from '../../game/Game';
import { exploreRoute, raceRoute, routeThrough, RACES, type Route } from '../../game/routes';
import { placeByName, type Place } from '../../game/campusmap';
import { EVENTS } from '../../data/events';
import { homePlace } from '../missions';
import { H, esc, clock } from '../host';
import { grant } from '../inventory';
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import type { EventRide, EventRideCtx } from './ride-hook';
import type { CampusEvent } from './types';
import { complete, takePart, rewardText } from './store';
import { timedOf } from './schedule';
import { placeLabel } from './catalog';

// ---------- small saved state per event (this phone) ----------
const KEY = 'legonrush.events.play.v1';
export interface PlayState {
  /** hunt: rides so far, closest distance (m), last place ridden to, found */
  rides?: number;
  best?: number;
  last?: string;
  found?: boolean;
  /** photo hunt / explorer: places reached */
  got?: string[];
  /** diamonds picked up (paid up to the number placed) */
  gems?: number;
  /** best coin rush haul */
  haul?: number;
}
function readAll(): Record<string, PlayState> { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export const playState = (key: string): PlayState => readAll()[key] ?? {};
export function savePlay(key: string, s: PlayState) {
  const all = readAll();
  all[key] = s;
  // keep the last 40 events
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete all[k];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full */ }
}
const PHOTO_KEY = 'legonrush.events.photos.v1';
export function photos(key: string): { place: string; url: string }[] {
  try { return (JSON.parse(localStorage.getItem(PHOTO_KEY) || '{}')[key] ?? []); } catch { return []; }
}
function savePhoto(key: string, place: string, url: string) {
  try {
    const all = JSON.parse(localStorage.getItem(PHOTO_KEY) || '{}');
    // photos from the newest three events only: they are small, but phones have little room
    const keep = Object.keys(all).filter((k) => k !== key).slice(-2);
    const next: Record<string, unknown> = {};
    for (const k of keep) next[k] = all[k];
    next[key] = [...(all[key] ?? []).filter((x: { place: string }) => x.place !== place), { place, url }];
    localStorage.setItem(PHOTO_KEY, JSON.stringify(next));
  } catch { /* full: the tick still counts */ }
}
/** a small JPEG of the game view */
function snapshot(game: EventRideCtx['game'], done: (url: string) => void) {
  let src = '';
  try { src = game.capture(); } catch { return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    const w = 320, h = Math.round((img.height / img.width) * w) || 180;
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    try { done(c.toDataURL('image/jpeg', 0.72)); } catch { /* tainted canvas */ }
  };
  img.src = src;
}

// ---------- routes ----------
const place = (name: string) => placeByName(name);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const startPlace = () => homePlace(H().profile());

/** a fresh copy of a route so its lighting can be set without touching shared routes */
const withTime = (r: Route | null, e: CampusEvent): Route | null => r && ({ ...r, time: e.rules.includes('night') ? 'night' : e.rules.includes('sunset') ? 'sunset' : r.time });

/** from your hall to the event; a short loop if you live next door */
export function routeThere(e: CampusEvent): Route | null {
  const to = place(e.place);
  if (!to) return null;
  let from = startPlace();
  if (dist(from, to) < 250) from = place('Legon Main Entrance')!;
  return withTime(exploreRoute(from, to), e);
}

/** a ride of at least 1.2 km that starts in the event area (Coin Rush, Diamond Rush) */
function areaRoute(e: CampusEvent): Route | null {
  const from = place(e.place);
  if (!from) return null;
  const far = ['Great Hall', 'Legon Main Entrance', 'Athletic Oval', 'Night Market', 'University of Ghana Sports Directorate', 'Commonwealth Hall', 'School of Engineering Sciences', 'Akuafo Hall Main']
    .map(place).filter((q): q is Place => !!q && dist(q, from) > 1200);
  const to = far[Math.abs(hash(e.key)) % Math.max(1, far.length)] ?? place('Great Hall')!;
  return withTime(exploreRoute(from, to), e);
}
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

/** through the stops still to reach, nearest first, starting from your hall */
function stopsRoute(e: CampusEvent, got: string[]): Route | null {
  const left = (e.stops ?? []).filter((s) => !got.includes(s)).map(place).filter((q): q is Place => !!q);
  if (!left.length) return null;
  const order: Place[] = [];
  let at = startPlace();
  while (left.length) {
    left.sort((a, b) => dist(a, at) - dist(b, at));
    at = left.shift()!;
    order.push(at);
  }
  const from = dist(startPlace(), order[0]) < 60 ? place('Legon Main Entrance')! : startPlace();
  return withTime(routeThrough([from, ...order], { id: 'explore', name: e.name, kind: 'explore', difficulty: 1 }), e);
}

// ---------- the shared plug-in ----------
interface Hooks {
  route: Route;
  start?(ctx: EventRideCtx, el: HTMLElement): void;
  hud?(h: HudState, t: number, ctx: EventRideCtx): void;
  end?(r: RideEnd): string;
  leave?(): void;
  /** seconds; the ride stops when it runs out */
  limit?: number;
  timeUp?(): void;
}

let back: (key: string) => void = () => H().home('events');
/** where "Back to the event" goes (detail.ts sets it) */
export function setBack(fn: (key: string) => void) { back = fn; }

function backButton(e: CampusEvent, label = 'Back to the event') {
  setTimeout(() => H().app.querySelector('[data-ev-back]')?.addEventListener('click', () => back(e.key)), 0);
  return `<button class="btn btn-primary" data-ev-back>${icons.events} ${label}</button>`;
}

function ride(e: CampusEvent, hooks: Hooks): EventRide {
  let ctx: EventRideCtx | null = null;
  let el: HTMLElement | null = null;
  let t = 0, last = 0, upDone = false, drain = false;
  const rules = e.rules;
  const plug: EventRide = {
    rain: rules.includes('rain'),
    start(c) {
      ctx = c;
      t = 0; last = 0; upDone = false;
      const g = c.game;
      if (rules.includes('night')) g.setTimeOfDay('night');
      else if (rules.includes('sunset')) g.setTimeOfDay('sunset');
      if (rules.includes('fog') && g.scene.fog && 'near' in g.scene.fog) { (g.scene.fog as { near: number; far: number }).near = 6; (g.scene.fog as { near: number; far: number }).far = 70; }
      if (rules.includes('noracing')) g.calm = true;
      if (rules.includes('nominimap')) c.hud.querySelector<HTMLElement>('#minimap')?.setAttribute('hidden', '');
      if (rules.includes('nohelmet')) { g.setGear(0, c.brakes); c.hud.querySelector<HTMLElement>('.sp-helmets')?.setAttribute('hidden', ''); }
      drain = rules.includes('noboost');
      if (drain) { c.hud.querySelector<HTMLElement>('#boostBtn')?.setAttribute('hidden', ''); c.hud.querySelector<HTMLElement>('#boostLabel')?.setAttribute('hidden', ''); }
      el = document.createElement('div');
      el.className = 'ev-hud';
      c.hud.appendChild(el);
      takePart(H().profile(), e);
      hooks.start?.(c, el);
    },
    hud(h) {
      const n = performance.now();
      if (!h.countdown && last && !ctx?.game.paused) t += Math.min(0.05, (n - last) / 1000);
      last = n;
      if (drain && h.boost > 0) ctx?.game.giveBoost(-h.boost);
      if (ctx) hooks.hud?.(h, t, ctx);
      if (hooks.limit && !upDone && t >= hooks.limit) {
        upDone = true;
        hooks.timeUp?.();
        flash('TIME UP', 'Well ridden!', 2400);
        setTimeout(() => ctx?.quit(), 1800);
      }
    },
    end: (r) => hooks.end?.(r) ?? '',
    leave() { (hooks.leave ?? (() => back(e.key)))(); },
    stop() { el?.remove(); el = null; },
  };
  const flash = (head: string, text: string, ms = 1800) => {
    const p = ctx?.hud.querySelector<HTMLElement>('#prompt');
    if (!p) return;
    p.innerHTML = `<small>${head}</small>${text}`;
    setTimeout(() => { if (p.textContent?.startsWith(head)) p.innerHTML = ''; }, ms);
  };
  (plug as EventRide & { flash: typeof flash }).flash = flash;
  return plug;
}
const flashOf = (p: EventRide) => (p as EventRide & { flash: (h: string, t: string, ms?: number) => void }).flash;

function go(route: Route | null, plug: EventRide | null, extras: { event?: (typeof EVENTS)[number] } = {}) {
  if (!route || !plug) return false;
  H().play(route, { eventPlay: plug, ...extras });
  return true;
}

// ---------- Treasure Hunt ----------
export const HEAT: [number, string, string][] = [
  [100, 'Treasure nearby', 'nearby'], [250, 'Very hot', 'vhot'], [500, 'Hot', 'hot'], [900, 'Warm', 'warm'], [Infinity, 'Cold', 'cold'],
];
export const heatOf = (m: number) => HEAT.find(([d]) => m < d)!;

/** ride towards a place of your choice while hunting */
export function playHunt(e: CampusEvent, toName: string): boolean {
  const spot = place(e.spot ?? '');
  const to = place(toName);
  const st = playState(e.key);
  const from = place(st.last ?? '') ?? startPlace();
  if (!spot || !to) return false;
  const route = withTime(exploreRoute(dist(from, to) < 60 ? place('Legon Main Entrance')! : from, to), e);
  if (!route) return false;
  let best = Infinity, found = false, lastPos: [number, number] = [from.x, from.z];
  let meter: HTMLElement | null = null;
  const plug = ride(e, {
    route,
    start(c, el) {
      best = Infinity; found = false;
      el.innerHTML = `<span class="ev-hud-ico">${icons.diamond}</span><span class="grow"><small>${esc(e.name.toUpperCase())}</small><b class="ev-heat" id="evHeat">…</b></span><span class="ev-meter"><i id="evMeter"></i></span>`;
      meter = el.querySelector('#evMeter');
      // the treasure is on the road if this route passes close to it
      const pr = route.track.project(spot.x, spot.z);
      if (pr.dist < 90) {
        const d = Math.max(40, Math.min(route.length - 12, pr.d - route.lead));
        c.game.addTreasureAt([{ d, lane: 1 }]);
      }
      c.game.onTreasure = () => {
        found = true;
        const p = H().profile();
        savePlay(e.key, { ...playState(e.key), found: true, best: 0 });
        complete(p, e);
        flashOf(plug)('TREASURE FOUND', rewardText(e.rewards.done), 2600);
        setTimeout(() => c.quit(), 2200);
      };
    },
    hud(h) {
      lastPos = h.pos;
      const m = Math.hypot(h.pos[0] - spot.x, h.pos[1] - spot.z);
      best = Math.min(best, m);
      const [, label, cls] = heatOf(m);
      const hEl = H().app.querySelector<HTMLElement>('#evHeat');
      if (hEl && hEl.textContent !== label) { hEl.textContent = label; hEl.className = `ev-heat ${cls}`; if (cls === 'nearby') sfx.coin(); }
      if (meter) meter.style.width = `${Math.max(6, Math.min(100, 100 - (m / 1400) * 100))}%`;
    },
    end(r) {
      const st2 = playState(e.key);
      const rides = (st2.rides ?? 0) + 1;
      savePlay(e.key, { ...st2, rides, best: Math.min(st2.best ?? Infinity, Math.round(best)), last: r.finished ? to.name : st2.last });
      void lastPos;
      if (found) return `<div class="card ev-result good">${icons.diamond}<div><b>You found the treasure!</b><p class="muted small">${esc(rewardText(e.rewards.done))}</p></div></div>${backButton(e)}`;
      const [, label] = heatOf(best);
      return `<div class="card ev-result">${icons.compass}<div><b>Not here. Closest you got: ${label.toLowerCase()} (${Math.round(best)} m)</b><p class="muted small">${rides < (e.clues?.length ?? 1) ? 'A new clue is waiting for you.' : 'Read the clues again and try another place.'}</p></div></div>${backButton(e, 'Keep hunting')}`;
    },
    leave() {
      if (!found) {
        const st2 = playState(e.key);
        savePlay(e.key, { ...st2, rides: (st2.rides ?? 0) + 1, best: Math.min(st2.best ?? Infinity, Math.round(best)) });
      }
      back(e.key);
    },
  });
  return go(route, plug);
}

// ---------- Coin Rush ----------
export function playCoinRush(e: CampusEvent): boolean {
  const route = areaRoute(e);
  if (!route) return false;
  const limit = e.timeLimit ?? 120;
  let coins = 0, next = 0, banked = false, ended = false;
  let clockEl: HTMLElement | null = null, countEl: HTMLElement | null = null;
  const bank = () => {
    if (banked) return;
    banked = true;
    const p = H().profile();
    const st = playState(e.key);
    savePlay(e.key, { ...st, haul: Math.max(st.haul ?? 0, coins) });
    if (coins >= 40) complete(p, e);
  };
  const plug = ride(e, {
    route, limit,
    start(c, el) {
      coins = 0; next = 0; banked = false; ended = false;
      el.innerHTML = `<span class="ev-hud-ico">${icons.coin}</span><span class="grow"><small>${esc(e.name.toUpperCase())}</small><b id="evClock">${clock(limit)}</b></span><span class="ev-count"><b id="evCount">0</b><small>/ 40</small></span>`;
      clockEl = el.querySelector('#evClock');
      countEl = el.querySelector('#evCount');
    },
    hud(h, t, c) {
      coins = h.coins;
      if (clockEl) clockEl.textContent = clock(Math.max(0, limit - t));
      if (countEl) countEl.textContent = String(coins);
      // a fresh line of coins on the road ahead every second
      if (!h.countdown && t >= next && t < limit) {
        next = t + 1;
        const lane = Math.floor(Math.random() * 3);
        c.game.stage([0, 6, 12, 18].map((k) => ({ kind: 'coin' as const, lane, ahead: 45 + k })));
      }
    },
    timeUp() {
      // the ride stops here; its coins are paid now (the results screen won't run)
      bank();
      if (!ended) grant(H().profile(), { coins });
    },
    end() {
      ended = true;
      bank();
      return `<div class="card ev-result${coins >= 40 ? ' good' : ''}">${icons.coin}<div><b>${coins} coins collected</b><p class="muted small">${coins >= 40 ? `Bonus: ${esc(rewardText(e.rewards.done))}` : 'Collect 40 in one go for the bonus.'}</p></div></div>${backButton(e)}`;
    },
  });
  return go(route, plug);
}

// ---------- Diamond Rush ----------
const GEMS = 3;
export function playDiamondRush(e: CampusEvent): boolean {
  const route = areaRoute(e);
  if (!route) return false;
  let found = 0;
  const pay = () => {
    const p = H().profile();
    const st = playState(e.key);
    const already = st.gems ?? 0;
    const add = Math.max(0, Math.min(GEMS, found) - already);
    if (add) { grant(p, { diamonds: add }); savePlay(e.key, { ...st, gems: already + add }); }
    if (found) complete(p, e);
    return add;
  };
  const plug = ride(e, {
    route,
    start(c, el) {
      found = 0;
      el.innerHTML = `<span class="ev-hud-ico">${icons.diamond}</span><span class="grow"><small>${esc(e.name.toUpperCase())}</small><b>Grab the diamonds</b></span><span class="ev-count"><b id="evCount">0</b><small>/ ${GEMS}</small></span>`;
      c.game.setTreasure(GEMS, Math.abs(hash(e.key)) || 7);
      c.game.onTreasure = (n) => {
        found = n;
        const ce = H().app.querySelector('#evCount');
        if (ce) ce.textContent = String(n);
        flashOf(plug)('DIAMOND', `${n} of ${GEMS}`, 1600);
      };
    },
    end() {
      const add = pay();
      return `<div class="card ev-result${found ? ' good' : ''}">${icons.diamond}<div><b>${found} of ${GEMS} diamonds</b><p class="muted small">${add ? `+${add} diamond${add === 1 ? '' : 's'} added.` : found ? 'You already collected these diamonds.' : 'They glint in the lanes: steer into them.'}</p></div></div>${backButton(e)}`;
    },
    leave() { pay(); back(e.key); },
  });
  return go(route, plug);
}

// ---------- Photo Hunt and Campus Explorer ----------
export function playStops(e: CampusEvent): boolean {
  const st0 = playState(e.key);
  const route = stopsRoute(e, st0.got ?? []);
  if (!route) return false;
  const photo = e.activity === 'photohunt';
  const stops = (e.stops ?? []).map((n) => place(n)).filter((q): q is Place => !!q);
  let game: EventRideCtx['game'] | null = null;
  let listEl: HTMLElement | null = null;
  const draw = () => {
    const got = playState(e.key).got ?? [];
    if (listEl) listEl.innerHTML = stops.map((s) => `<li class="${got.includes(s.name) ? 'on' : ''}">${got.includes(s.name) ? icons.check : icons.pin}<span>${esc(placeLabel(s.name))}</span></li>`).join('');
  };
  const plug = ride(e, {
    route,
    start(c, el) {
      game = c.game;
      el.classList.add('tall');
      el.innerHTML = `<span class="ev-hud-ico">${photo ? icons.camera : icons.compass}</span><span class="grow"><small>${esc(e.name.toUpperCase())}</small><ul class="ev-ticks" id="evTicks"></ul></span>`;
      listEl = el.querySelector('#evTicks');
      draw();
    },
    hud(h) {
      const st = playState(e.key);
      const got = st.got ?? [];
      for (const s of stops) {
        if (got.includes(s.name) || Math.hypot(h.pos[0] - s.x, h.pos[1] - s.z) > 50) continue;
        const next = { ...st, got: [...got, s.name] };
        savePlay(e.key, next);
        sfx.coin();
        flashOf(plug)(photo ? 'PHOTO TAKEN' : 'PLACE FOUND', `${placeLabel(s.name)} · ${next.got.length} of ${stops.length}`, 2000);
        if (photo && game) snapshot(game, (url) => savePhoto(e.key, s.name, url));
        draw();
        if (next.got.length >= stops.length) complete(H().profile(), e);
        break;
      }
    },
    end() {
      const got = playState(e.key).got ?? [];
      const all = got.length >= stops.length;
      return `<div class="card ev-result${all ? ' good' : ''}">${photo ? icons.camera : icons.compass}<div><b>${got.length} of ${stops.length} places</b><p class="muted small">${all ? `Complete! ${esc(rewardText(e.rewards.done))}` : 'Your progress is saved. Ride again for the rest.'}</p></div></div>${backButton(e)}`;
    },
  });
  return go(route, plug);
}

// ---------- Sunset Ride, night rides and "ride there" ----------
/** ride to the event; scenic rides finish with a photo, social ones with Park bike / Enter event */
export function playThere(e: CampusEvent, onArrive?: () => void): boolean {
  const route = routeThere(e);
  if (!route) return false;
  let game: EventRideCtx['game'] | null = null;
  const scenic = e.activity === 'sunset';
  const plug = ride(e, {
    route,
    start(c, el) {
      game = c.game;
      el.innerHTML = `<span class="ev-hud-ico">${scenic ? icons.sunrise : icons.pin}</span><span class="grow"><small>${esc(e.name.toUpperCase())}</small><b>To ${esc(placeLabel(e.place))}</b></span>`;
    },
    end(r) {
      if (!r.finished) return backButton(e);
      if (scenic) {
        if (game) snapshot(game, (url) => savePhoto(e.key, e.place, url));
        const got = complete(H().profile(), e);
        return `<div class="card ev-result good">${icons.sunrise}<div><b>You watched the sunset at ${esc(placeLabel(e.place))}</b><p class="muted small">${got ? esc(rewardText(got)) : 'Saved to your Event Passport.'} The photo is on the event page.</p></div></div>${backButton(e)}`;
      }
      // social: arrived; the space opens from here
      setTimeout(() => H().app.querySelector('[data-ev-enter]')?.addEventListener('click', () => onArrive?.()), 0);
      savePlay(e.key, { ...playState(e.key), last: e.place });
      return `<div class="card ev-result good">${icons.bike}<div><b>You've arrived at ${esc(placeLabel(e.place))}</b><p class="muted small">Park your bike and go in.</p></div></div>
        <button class="btn btn-primary" data-ev-enter>${icons.bike} Park bike and enter event</button>`;
    },
  });
  return go(route, plug);
}

/** the daily timed race (Night Rush / Sunset Rush): double coins and a bike while it is live */
export function playTimed(e: CampusEvent): boolean {
  const t = timedOf(e);
  const def = t?.def ?? EVENTS[0];
  const race = RACES.find((r) => r.id === def.race);
  if (!race) return false;
  const route = raceRoute(race);
  const plug = ride({ ...e, rules: [] }, {
    route,
    start(_c, el) { el.innerHTML = `<span class="ev-hud-ico">${def.id === 'night-rush' ? icons.moon : icons.sunrise}</span><span class="grow"><small>${esc(def.name.toUpperCase())}</small><b>${t?.live ? 'Double coins' : 'Practice ride'}</b></span>`; },
    end(r) {
      if (r.finished && t?.live) complete(H().profile(), e);
      return backButton(e);
    },
  });
  return go(route, plug, t?.live ? { event: def } : {});
}

/** after a treasure is found or time is up, a reward is shown where the rider lands */
export function huntFoundHtml(e: CampusEvent) {
  return playState(e.key).found ? `<div class="card ev-result good">${icons.diamond}<div><b>Treasure found</b><p class="muted small">${esc(rewardText(e.rewards.done))}</p></div></div>` : '';
}
