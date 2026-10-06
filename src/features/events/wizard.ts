// Create an event in nine short steps: type, details, location, date and time, entry, capacity,
// rewards, rules, preview and publish. Rider (community) events cost coins by size (prices from
// the server's config table); LEGONRUSH admins publish official events for free.
import { H, esc, fmt, screen } from '../host';
import { icons } from '../../ui/icons';
import * as cloud from '../../cloud';
import { PLACES, placeByName, searchPlaces } from '../../game/campusmap';
import { campusOverview } from '../../ui/mapview';
import { spend } from '../inventory';
import { sfx } from '../../audio';
import type { CampusEvent, EventRewards, EventType, RuleId } from './types';
import { COVERS, EVENT_ITEMS, LOCATIONS, RULES, TYPES, WIZARD_RULES, coverUrl, placeLabel } from './catalog';
import { createEvent, defaultPrices, eventPrices, isAdmin, sizeFor, type Size } from './cloud';
import { refresh, rewardText } from './store';
import { eventCard } from './ui';
import { HUNT_SPOTS } from './schedule';
import { eventDetail } from './detail';

interface Draft {
  type: EventType | '';
  name: string;
  description: string;
  cover: string;
  host: string;
  place: string;
  spot: string;
  clues: string[];
  stops: string[];
  date: string;
  from: string;
  to: string;
  /** hours before the start that registration closes (0 = at the start) */
  deadline: number;
  fee: number;
  capacity: number | null;
  xp: number;
  topup: number;
  done: { coins: number; diamonds: number; xp: number; items: string[]; hall: number };
  rules: RuleId[];
  limit: number;
  official: boolean;
}
const KEY = 'legonrush.events.draft.v1';
const tomorrow = () => { const d = new Date(Date.now() + 86400e3); return d.toLocaleDateString('en-CA'); };
const fresh = (): Draft => ({
  type: '', name: '', description: '', cover: '', host: '', place: '', spot: '', clues: ['', '', ''], stops: [],
  date: tomorrow(), from: '18:00', to: '20:00', deadline: 0, fee: 0, capacity: 50, xp: 50, topup: 0,
  done: { coins: 0, diamonds: 0, xp: 100, items: [], hall: 0 }, rules: [], limit: 300, official: false,
});
function load(): Draft { try { return { ...fresh(), ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }; } catch { return fresh(); } }
const save = (d: Draft) => { try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ } };

const STEPS = ['Type', 'Details', 'Location', 'Date & time', 'Entry', 'Capacity', 'Rewards', 'Rules', 'Preview'];
let admin = false;
let prices = defaultPrices();

export async function createWizard(back: () => void) {
  admin = await isAdmin();
  prices = await eventPrices();
  const d = load();
  if (admin && !d.host) d.official = true;
  step(0, d, back);
}

const startAt = (d: Draft) => new Date(`${d.date}T${d.from}`).getTime();
const endAt = (d: Draft) => { const s = startAt(d); let e = new Date(`${d.date}T${d.to}`).getTime(); if (e <= s) e += 86400e3; return e; };
const cost = (d: Draft) => (d.official ? 0 : prices[sizeFor(d.capacity)] + d.topup);

function problems(d: Draft, n: number): string | null {
  if (n === 0 && !d.type) return 'Choose a type of event.';
  if (n === 1) {
    if (d.name.trim().length < 3) return 'Give your event a name (at least 3 letters).';
    if (d.description.trim().length < 10) return 'Describe it in a sentence or two.';
  }
  if (n === 2) {
    if (!d.place) return 'Pick where it happens.';
    if (d.type === 'treasure' && !d.spot) return 'Choose where the treasure is hidden.';
    if (d.type === 'treasure' && !d.clues[0].trim()) return 'Write at least the first clue.';
    if (d.type === 'explorer' && d.stops.length < 2) return 'Pick at least two places to reach.';
  }
  if (n === 3) {
    const s = startAt(d), e = endAt(d);
    if (Number.isNaN(s) || Number.isNaN(e)) return 'Pick a date and times.';
    if (s < Date.now() + (d.official ? 5 : 60) * 60e3) return d.official ? 'The start must be in the future.' : 'Start at least an hour from now, so riders can join.';
    if (s > Date.now() + 60 * 86400e3) return 'Events can be planned up to two months ahead.';
    if (e - s < 30 * 60e3) return 'Events last at least 30 minutes.';
    if (e - s > 12 * 3600e3) return 'Events last at most 12 hours. Use a series for more days.';
  }
  return null;
}

function step(n: number, d: Draft, back: () => void) {
  save(d);
  const h = H();
  const isLast = n === STEPS.length - 1;
  screen(`
    <p class="kicker">${icons.plus} ${d.official ? 'Official event' : 'Create an event'}</p>
    <h1 class="title">${esc(STEPS[n])}</h1>
    <div class="ev-steps" aria-label="Step ${n + 1} of ${STEPS.length}">${STEPS.map((_, i) => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</div>
    <p class="muted small">Step ${n + 1} of ${STEPS.length}</p>
    <div id="wz" class="stack">${body(n, d)}</div>
    <p class="ev-note bad" id="wzErr" hidden></p>
    ${isLast ? '' : `<div class="two"><button class="btn btn-ghost" id="wzPrev">${n ? 'Back' : 'Cancel'}</button><button class="btn btn-primary" id="wzNext">Next</button></div>`}
  `, () => (n ? step(n - 1, d, back) : back()), 'ev-wizard');
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => h.app.querySelector<T>(s);
  const err = (m: string | null) => { const el = $('#wzErr')!; el.hidden = !m; el.textContent = m ?? ''; };
  const read = () => readForm(n, d);
  $('#wzPrev')?.addEventListener('click', () => { read(); n ? step(n - 1, d, back) : back(); });
  $('#wzNext')?.addEventListener('click', () => {
    read();
    const bad = problems(d, n);
    if (bad) return err(bad);
    step(n + 1, d, back);
  });
  bindStep(n, d, back);
}

// ---------- each step ----------
function body(n: number, d: Draft): string {
  const p = H().profile();
  switch (n) {
    case 0:
      return `${admin ? `<div class="seg wide" id="wzKind"><button data-v="1" class="${d.official ? 'on' : ''}">${icons.shield} Official (free)</button><button data-v="0" class="${d.official ? '' : 'on'}">Rider event</button></div>` : ''}
        <div class="ev-type-grid">${(Object.keys(TYPES) as EventType[]).filter((t) => TYPES[t].wizard).map((t) => `<button class="ev-type-opt${d.type === t ? ' on' : ''}" data-type="${t}">${TYPES[t].icon}<b>${esc(TYPES[t].label)}</b><small>${esc(TYPES[t].hint)}</small></button>`).join('')}</div>`;
    case 1:
      return `<div class="field"><label for="wzName">Event name</label><input id="wzName" maxlength="40" value="${esc(d.name)}" placeholder="e.g. Botanical Jams"></div>
        <div class="field"><label for="wzDesc">Description</label><textarea id="wzDesc" maxlength="400" rows="4" placeholder="What will happen? Who is it for?">${esc(d.description)}</textarea></div>
        <div class="field"><label for="wzHost">Host</label><input id="wzHost" maxlength="30" value="${esc(d.host || (d.official ? 'LEGONRUSH' : p.name))}"></div>
        <b class="small">Cover picture</b>
        <div class="ev-covers">${COVERS.map(([id, label]) => `<button class="ev-cover-opt${(d.cover || TYPES[d.type as EventType]?.cover) === id ? ' on' : ''}" data-cover="${id}" style="background-image:url('${coverUrl(id)}')" aria-label="${esc(label)}"></button>`).join('')}</div>`;
    case 2:
      return `<canvas class="ev-minimap tap" id="wzMap" width="640" height="420" aria-label="Campus map: tap to choose"></canvas>
        <p class="muted small">Tap the map, or choose a place below.${d.place ? ` Chosen: <b>${esc(placeLabel(d.place))}</b>` : ''}</p>
        <div class="ev-chips">${LOCATIONS.map(([v, l]) => `<button class="chip${d.place === v ? ' on' : ''}" data-place="${esc(v)}">${esc(l)}</button>`).join('')}</div>
        <div class="field"><input id="wzSearch" placeholder="Search any place on campus" autocomplete="off"></div><ul class="ev-suggest" id="wzList"></ul>
        ${d.type === 'treasure' ? `<b class="small">Where is the treasure hidden? (only you see this)</b>
          <div class="ev-chips">${HUNT_SPOTS.map((s) => `<button class="chip${d.spot === s.place ? ' on' : ''}" data-spot="${esc(s.place)}">${esc(placeLabel(s.place))}</button>`).join('')}</div>
          ${d.clues.map((c, i) => `<div class="field"><label for="wzClue${i}">Clue ${i + 1}${i ? ' (shown after another ride)' : ''}</label><input id="wzClue${i}" maxlength="120" value="${esc(c)}"></div>`).join('')}` : ''}
        ${d.type === 'explorer' ? `<b class="small">Places to reach (2 to 5)</b><div class="ev-chips">${LOCATIONS.map(([v, l]) => `<button class="chip${d.stops.includes(v) ? ' on' : ''}" data-stop="${esc(v)}">${esc(l)}</button>`).join('')}</div>` : ''}`;
    case 3:
      return `<div class="field"><label for="wzDate">Date</label><input type="date" id="wzDate" value="${d.date}" min="${new Date().toLocaleDateString('en-CA')}"></div>
        <div class="two"><div class="field"><label for="wzFrom">Starts</label><input type="time" id="wzFrom" value="${d.from}"></div><div class="field"><label for="wzTo">Ends</label><input type="time" id="wzTo" value="${d.to}"></div></div>
        <b class="small">Registration closes</b>
        <div class="seg wide" id="wzDeadline">${[[0, 'At the start'], [1, '1 hour before'], [24, '1 day before']].map(([v, l]) => `<button data-v="${v}" class="${d.deadline === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    case 4:
      return `<div class="seg wide" id="wzPaid"><button data-v="0" class="${d.fee ? '' : 'on'}">Free</button><button data-v="1" class="${d.fee ? 'on' : ''}">Paid</button></div>
        <div id="wzFeeBox" ${d.fee ? '' : 'hidden'}><b class="small">Entry fee</b><div class="ev-chips">${[100, 250, 500, 1000, 2500].map((v) => `<button class="chip${d.fee === v ? ' on' : ''}" data-fee="${v}">${icons.coin} ${fmt(v)}</button>`).join('')}</div>
        <p class="muted small">Riders pay when they join. ${d.official ? '' : 'Fees go into the prize pool for your winners.'} Coins only, never cash.</p></div>
        <div class="ev-preview-fee">${d.fee ? `${icons.coin} <b>${fmt(d.fee)} Rush Coins to join</b>` : '<b>Free to join</b>'}</div>`;
    case 5: {
      const caps: [number | null, string][] = [[null, 'Unlimited'], [25, '25'], [50, '50'], [100, '100'], [250, '250'], [500, '500']];
      const custom = d.capacity !== null && !caps.some(([v]) => v === d.capacity);
      return `<div class="ev-chips">${caps.map(([v, l]) => `<button class="chip${d.capacity === v ? ' on' : ''}" data-cap="${v ?? 'u'}">${l}</button>`).join('')}<button class="chip${custom ? ' on' : ''}" data-cap="c">Custom</button></div>
        <div class="field" id="wzCapBox" ${custom ? '' : 'hidden'}><label for="wzCap">How many riders?</label><input type="number" id="wzCap" min="2" max="5000" value="${custom ? d.capacity : 40}"></div>
        ${d.official ? '<p class="muted small">Official events are free to create.</p>' : priceTable(d)}`;
    }
    case 6:
      return d.official
        ? `<b class="small">For taking part</b>${chips('xp', [0, 50, 100, 250], d.xp, (v) => `${v} XP`)}
          <b class="small">For completing it</b>
          ${chips('dcoins', [0, 200, 500, 1000, 2000, 5000], d.done.coins, (v) => `${icons.coin} ${fmt(v)}`)}
          ${chips('ddia', [0, 1, 2, 5], d.done.diamonds, (v) => `${icons.diamond} ${v}`)}
          ${chips('dxp', [0, 100, 250, 500], d.done.xp, (v) => `${v} XP`)}
          <b class="small">Items (titles, badges, cosmetics)</b>
          <div class="ev-chips">${EVENT_ITEMS.map((it) => `<button class="chip${d.done.items.includes(it.id) ? ' on' : ''}" data-item="${it.id}">${it.icon} ${esc(it.name)}</button>`).join('')}</div>
          <b class="small">Hall points</b>${chips('hall', [0, 50, 100, 500], d.done.hall, (v) => `+${v}`)}`
        : `<b class="small">For taking part</b>${chips('xp', [0, 50, 100], d.xp, (v) => `${v} XP`)}
          <div class="card stack" style="gap:6px"><b>${icons.trophy} Prize pool</b>
          <p class="muted small">${d.fee ? 'Every entry fee goes into the pool.' : 'Free events have no entry fees.'} Add coins of your own to make it worth winning. After the event, the top three by score get 60%, 25% and 15%.</p>
          ${chips('topup', [0, 500, 1000, 2000, 5000], d.topup, (v) => `${icons.coin} ${fmt(v)}`)}</div>`;
    case 7:
      return `<p class="muted small">Special rules make it different. ${TYPES[d.type as EventType]?.activity === 'space' ? 'Ride rules apply on the way there.' : ''}</p>
        <div class="ev-rule-grid">${WIZARD_RULES.map((r) => `<button class="ev-rule-opt${d.rules.includes(r) ? ' on' : ''}" data-rule="${r}">${RULES[r].icon}<b>${esc(RULES[r].label)}</b><small>${esc(RULES[r].hint)}</small></button>`).join('')}</div>
        <div id="wzLimitBox" ${d.rules.includes('timelimit') ? '' : 'hidden'}><b class="small">Time limit</b>${chips('limit', [120, 300, 600], d.limit, (v) => `${v / 60} min`)}</div>`;
    case 8: {
      const e = toEvent(d);
      const c = cost(d);
      const short = c > p.coins;
      const signedOut = !cloud.account;
      return `<div class="ev-preview">${eventCard(e, { wide: true })}</div>
        <div class="card stack" style="gap:6px">
          <div class="ev-rw"><span class="muted small">When</span><b>${esc(new Date(e.start).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</b></div>
          <div class="ev-rw"><span class="muted small">Where</span><b>${esc(placeLabel(e.place))}</b></div>
          <div class="ev-rw"><span class="muted small">Entry</span><b>${e.fee ? `${fmt(e.fee)} coins` : 'Free'}</b></div>
          <div class="ev-rw"><span class="muted small">Capacity</span><b>${e.capacity ?? 'Unlimited'}</b></div>
          ${e.rules.length ? `<div class="ev-rw"><span class="muted small">Rules</span><b>${e.rules.map((r) => esc(RULES[r].label)).join(', ')}</b></div>` : ''}
          ${rewardText(e.rewards.join) ? `<div class="ev-rw"><span class="muted small">Taking part</span><b>${esc(rewardText(e.rewards.join))}</b></div>` : ''}
          ${rewardText(e.rewards.done) ? `<div class="ev-rw"><span class="muted small">Completing</span><b>${esc(rewardText(e.rewards.done))}</b></div>` : ''}
        </div>
        ${d.official ? `<p class="ev-note good">${icons.shield} Official LEGONRUSH event. Free to publish.</p>`
          : `<div class="ev-cost${short ? ' short' : ''}">${icons.coin}<div><b>${fmt(c)} Rush Coins</b><span class="muted small">${esc(sizeLabel(sizeFor(d.capacity)))} event${d.topup ? ` + ${fmt(d.topup)} prize pool` : ''}. You have ${fmt(p.coins)}.</span></div></div>
          ${short ? `<p class="ev-note bad">${icons.close} Not enough Rush Coins. You need ${fmt(c)} to create this event.</p>` : ''}`}
        ${signedOut ? `<p class="ev-note bad">Sign in to publish events, so riders can find and join them.</p>` : ''}
        <button class="btn btn-primary ev-cta" id="wzPublish" ${(short && !d.official) || signedOut ? 'disabled' : ''}>${d.official ? 'Publish event' : `Publish for ${fmt(c)} coins`}</button>
        <button class="btn btn-ghost" id="wzPrev">Back</button>`;
    }
  }
  return '';
}
const sizeLabel = (s: Size) => ({ small: 'Small (up to 25)', medium: 'Medium (up to 100)', large: 'Large (up to 250)', major: 'Major (250+ or unlimited)' })[s];
function priceTable(d: Draft) {
  const now = sizeFor(d.capacity);
  return `<div class="ev-prices">${(['small', 'medium', 'large', 'major'] as Size[]).map((s) => `<div class="${s === now ? 'on' : ''}"><span>${esc(sizeLabel(s))}</span><b>${icons.coin} ${fmt(prices[s])}</b></div>`).join('')}</div>
    <p class="muted small">Creating a rider event costs coins, so the list stays worth reading.</p>`;
}
const chips = (name: string, vals: number[], cur: number, label: (v: number) => string) =>
  `<div class="ev-chips" data-chips="${name}">${vals.map((v) => `<button class="chip${cur === v ? ' on' : ''}" data-v="${v}">${label(v)}</button>`).join('')}</div>`;

function readForm(n: number, d: Draft) {
  const v = (id: string) => H().app.querySelector<HTMLInputElement>('#' + id)?.value ?? '';
  if (n === 1) { d.name = v('wzName').trim(); d.description = v('wzDesc').trim(); d.host = v('wzHost').trim().slice(0, 30); }
  if (n === 2 && d.type === 'treasure') d.clues = d.clues.map((_, i) => v(`wzClue${i}`).trim());
  if (n === 3) { d.date = v('wzDate'); d.from = v('wzFrom'); d.to = v('wzTo'); }
  if (n === 5 && H().app.querySelector('#wzCapBox:not([hidden])')) d.capacity = Math.max(2, Math.min(5000, Math.round(Number(v('wzCap')) || 2)));
  save(d);
}

function bindStep(n: number, d: Draft, back: () => void) {
  const app = H().app;
  const all = (s: string, fn: (el: HTMLElement) => void) => app.querySelectorAll<HTMLElement>(s).forEach((el) => el.addEventListener('click', () => fn(el)));
  const redraw = () => { readForm(n, d); step(n, d, back); };
  all('#wzKind [data-v]', (el) => { d.official = el.dataset.v === '1'; d.host = ''; redraw(); });
  all('[data-type]', (el) => { d.type = el.dataset.type as EventType; redraw(); });
  all('[data-cover]', (el) => { d.cover = el.dataset.cover!; app.querySelectorAll('[data-cover]').forEach((x) => x.classList.toggle('on', x === el)); save(d); });
  all('[data-place]', (el) => { d.place = el.dataset.place!; redraw(); });
  all('[data-spot]', (el) => { d.spot = el.dataset.spot!; redraw(); });
  all('[data-stop]', (el) => { const s = el.dataset.stop!; d.stops = d.stops.includes(s) ? d.stops.filter((x) => x !== s) : [...d.stops, s].slice(0, 5); redraw(); });
  all('#wzDeadline [data-v]', (el) => { d.deadline = Number(el.dataset.v); redraw(); });
  all('#wzPaid [data-v]', (el) => { d.fee = el.dataset.v === '1' ? d.fee || 500 : 0; redraw(); });
  all('[data-fee]', (el) => { d.fee = Number(el.dataset.fee); redraw(); });
  all('[data-cap]', (el) => { const c = el.dataset.cap!; d.capacity = c === 'u' ? null : c === 'c' ? 40 : Number(c); redraw(); });
  all('[data-rule]', (el) => { const r = el.dataset.rule as RuleId; d.rules = d.rules.includes(r) ? d.rules.filter((x) => x !== r) : [...d.rules, r]; redraw(); });
  all('[data-item]', (el) => { const it = el.dataset.item!; d.done.items = d.done.items.includes(it) ? d.done.items.filter((x) => x !== it) : [...d.done.items, it]; redraw(); });
  app.querySelectorAll<HTMLElement>('[data-chips]').forEach((box) => box.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => el.addEventListener('click', () => {
    const val = Number(el.dataset.v);
    const k = box.dataset.chips;
    if (k === 'xp') d.xp = val; if (k === 'topup') d.topup = val; if (k === 'limit') d.limit = val;
    if (k === 'dcoins') d.done.coins = val; if (k === 'ddia') d.done.diamonds = val; if (k === 'dxp') d.done.xp = val; if (k === 'hall') d.done.hall = val;
    redraw();
  })));
  // location: tap the map or search
  const canvas = app.querySelector<HTMLCanvasElement>('#wzMap');
  if (canvas) {
    const named = PLACES.filter((q) => q.kind !== 'transport' && q.kind !== 'other');
    const around = LOCATIONS.map(([nm]) => placeByName(nm)).filter((q): q is NonNullable<typeof q> => !!q);
    const m = campusOverview(canvas, around);
    const sel = placeByName(d.place);
    m.draw(sel ? [{ x: sel.x, z: sel.z, color: '#ea4335', label: placeLabel(sel.name) }] : around.slice(0, 8).map((q) => ({ x: q.x, z: q.z, color: '#1a73e8' })));
    canvas.addEventListener('click', (ev) => {
      const r = canvas.getBoundingClientRect();
      const [x, z] = m.toWorld(((ev.clientX - r.left) / r.width) * canvas.width, ((ev.clientY - r.top) / r.height) * canvas.height);
      const near = [...named].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (near) { d.place = near.name; redraw(); }
    });
  }
  const search = app.querySelector<HTMLInputElement>('#wzSearch');
  search?.addEventListener('input', () => {
    const list = app.querySelector<HTMLElement>('#wzList')!;
    const q = search.value.trim();
    list.innerHTML = q.length < 2 ? '' : searchPlaces(q, 6).map((mm) => `<li><button data-pick="${esc(mm.place.name)}">${icons.pin}${esc(mm.place.name)}</button></li>`).join('');
    list.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => { d.place = b.dataset.pick!; redraw(); }));
  });
  if (n === 5) {
    const box = app.querySelector<HTMLElement>('#wzCapBox');
    app.querySelector<HTMLInputElement>('#wzCap')?.addEventListener('change', () => { readForm(n, d); if (box && !box.hidden) step(n, d, back); });
  }
  app.querySelector('#wzPublish')?.addEventListener('click', (ev) => publish(d, ev.currentTarget as HTMLButtonElement, back));
}

function toEvent(d: Draft): CampusEvent {
  const type = (d.type || 'social') as EventType;
  const rewards: EventRewards = d.official
    ? { join: d.xp ? { xp: d.xp } : undefined, done: { coins: d.done.coins || undefined, diamonds: d.done.diamonds || undefined, xp: d.done.xp || undefined, items: d.done.items.length ? d.done.items : undefined }, hall: d.done.hall || undefined }
    : { join: d.xp ? { xp: d.xp } : undefined, winner: d.fee || d.topup ? { coins: 0 } : undefined };
  return {
    key: 'preview', source: d.official ? 'admin' : 'community', type, activity: TYPES[type].activity,
    name: d.name || 'Your event', blurb: d.description.slice(0, 90), description: d.description, cover: d.cover || TYPES[type].cover,
    host: d.official ? 'LEGONRUSH' : d.host || H().profile().name, place: d.place || 'Athletic Oval',
    start: startAt(d), end: endAt(d), regDeadline: startAt(d) - d.deadline * 3600e3 || undefined,
    capacity: d.capacity, fee: d.fee, rewards, rules: d.rules, timeLimit: d.rules.includes('timelimit') ? d.limit : undefined,
    spot: d.spot || undefined, clues: d.clues.filter(Boolean), stops: d.stops.length ? d.stops : undefined, createdAt: Date.now(),
  };
}

async function publish(d: Draft, b: HTMLButtonElement, back: () => void) {
  const p = H().profile();
  const c = cost(d);
  if (!d.official && c > p.coins) return;
  if (!b.dataset.sure && !d.official) {
    b.dataset.sure = '1';
    b.textContent = `Confirm: ${fmt(c)} coins will be deducted`;
    return;
  }
  b.disabled = true;
  b.textContent = 'Publishing…';
  const e = toEvent(d);
  const r = await createEvent({
    type: e.type, name: e.name, description: e.description, cover: e.cover, host: e.host, place: e.place,
    starts_at: new Date(e.start).toISOString(), ends_at: new Date(e.end).toISOString(), reg_deadline: new Date(e.regDeadline ?? e.start).toISOString(),
    capacity: e.capacity, fee: e.fee, rewards: e.rewards, rules: e.rules, time_limit: e.timeLimit ?? null, official: d.official, prize_topup: d.official ? 0 : d.topup,
    ...(e.spot ? { spot: e.spot, clues: e.clues } : {}), ...(e.stops ? { stops: e.stops } : {}),
  });
  if (!r.ok) {
    b.disabled = false;
    b.textContent = 'Try again';
    const el = H().app.querySelector<HTMLElement>('#wzErr');
    if (el) { el.hidden = false; el.textContent = r.error; }
    return;
  }
  // the server charged the creation fee into escrow; take it from the coins on this phone
  if (r.cost) spend(p, { coins: r.cost });
  sessionStorage.removeItem(KEY);
  sfx.finish();
  await refresh(true);
  eventDetail(`db:${r.id}`, back);
}
