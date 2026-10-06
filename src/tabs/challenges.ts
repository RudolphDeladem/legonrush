// The Challenges tab, in DELA's design: a hero over the clock tower, search and chips, the "Your own
// challenge" banner, then rows of photo cards (today's, popular, by type), the calendar and my
// challenges. It stands alone: nothing here links to Missions, Quick Match, Vibe Ride, Explore or
// Events. The challenge system itself lives in src/features/challenges/; types in kinds.ts.
import { registerTab } from './registry';
import { icons } from '../ui/icons';
import { H, esc, fmt, screen, on } from '../features/host';
import * as api from '../features/challenges/api';
import { all, joined, isCreator, refresh, setPinOpener, setRemindersOn } from '../features/challenges/data';
import { ACCESS, CH_ROUTES, FORMATS, chRoute, dateKey, dayDiff, phaseOf, raceTime, type Access, type Challenge, type Format, type Phase } from '../features/challenges/model';
import { chRow, chTile, empty, ic, ticker } from '../features/challenges/view';
import { CH_KINDS, kindOf, photoUrl } from '../features/challenges/kinds';
import { codeScreen, detailScreen, joinScreen } from '../features/challenges/screens';
import { createScreen } from '../features/challenges/create';
import { adminScreen } from '../features/challenges/admin';
import '../features/challenges/challenges.css';

type View = 'browse' | 'calendar' | 'mine';
type Sort = 'soon' | 'players' | 'prize' | 'popular' | 'new';
type MineTab = 'upcoming' | 'live' | 'created' | 'joined' | 'completed' | 'invites' | 'pbs';
interface Filters { status: Phase[]; access: Access[]; entry: ('free' | 'paid')[]; type: Format[]; route: string[]; kind: string[] }

// what the rider was looking at, kept while the app is open
const ui = {
  view: 'browse' as View,
  q: '',
  f: { status: [], access: [], entry: [], type: [], route: [], kind: [] } as Filters,
  sort: 'soon' as Sort,
  range: 'today' as 'today' | 'tomorrow' | 'week' | 'next' | 'date',
  date: dateKey(Date.now()),
  mine: 'upcoming' as MineTab,
  allDay: '' as string,
  admin: false,
};
const active = () => !!ui.q.trim() || Object.values(ui.f).some((v) => v.length);
const filterCount = () => Object.values(ui.f).reduce((n, v) => n + v.length, 0);

/** what this rider can see at all: public ones, and private ones they are part of */
function visible(now = Date.now()) {
  return all().filter((c) => c.status !== 'removed' && (c.access === 'open' || c.access === 'hall' || joined(c) || isCreator(c) || !!c.invited) && c.endsAt > now - 7 * 86400e3);
}
/** official challenges open all day (the daily time trials and the pace bike): listed once, not in every day's timeline */
const allDayTrial = (c: Challenge) => c.official && c.endsAt - c.startsAt >= 12 * 3600e3;

function matches(c: Challenge, now: number) {
  const f = ui.f;
  const ph = phaseOf(c, now);
  if (f.status.length && !f.status.includes(ph)) return false;
  if (f.access.length && !f.access.includes(c.access) && !(f.access.includes('friends') && c.invited)) return false;
  if (f.entry.length && !f.entry.includes(c.entryFee > 0 ? 'paid' : 'free')) return false;
  if (f.type.length && !f.type.includes(c.format)) return false;
  if (f.route.length && !f.route.includes(c.route)) return false;
  if (f.kind.length && !f.kind.includes(kindOf(c).id)) return false;
  const q = ui.q.trim().toLowerCase().replace(/^@/, '');
  if (q) {
    const r = chRoute(c.route);
    const hay = [c.name, c.code, c.code.replace('-', ''), c.creator?.name, c.creator?.username, r?.name, r?.line, ...(r?.area ?? []), c.official ? 'legonrush official' : '', kindOf(c).name].join(' ').toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}
function sorted(list: Challenge[], now: number) {
  const s = ui.sort;
  const rank = (c: Challenge) => ({ live: 0, soon: 1, upcoming: 2, ended: 3, cancelled: 4 })[phaseOf(c, now)];
  return [...list].sort((a, b) =>
    s === 'players' ? b.riders - a.riders
    : s === 'prize' ? b.entryFee * b.riders - a.entryFee * a.riders || b.entryFee * b.maxRiders - a.entryFee * a.maxRiders
    : s === 'popular' ? b.riders / Math.min(b.maxRiders, 50) - a.riders / Math.min(a.maxRiders, 50) || b.riders - a.riders
    : s === 'new' ? b.createdAt - a.createdAt
    : rank(a) - rank(b) || a.startsAt - b.startsAt);
}

// ---------- the page ----------

function render() {
  const p = H().profile();
  const cfg = api.local().config;
  const now = Date.now();
  const list = visible(now);
  const invites = list.filter((c) => c.invited?.status === 'pending' && phaseOf(c, now) !== 'ended').length;
  const next = list.filter((c) => joined(c) && c.startsAt > now && phaseOf(c, now) !== 'cancelled').sort((a, b) => a.startsAt - b.startsAt)[0];
  const short = p.coins < cfg.creationFee;
  const hallOn = ui.f.kind.includes('hall');
  const chip = (q: string, on: boolean, label: string) => `<button class="chip-btn${on ? ' on' : ''}" data-quick="${q}">${label}</button>`;
  return `<div class="chx chx2" id="chx" style="--chx-banner:url('${photoUrl('challenges-banner')}');--chx-banner-sm:url('${photoUrl('challenges-banner-sm')}')">
    <section class="chx-hero">
      <div class="chx-hero-card">
        <p class="chx-kick"><span>${icons.flag}</span>Challenges</p>
        <h1>Compete on campus</h1>
        <p>Take on daily challenges, create your own, and prove your skills around LEGON.</p>
      </div>
      <button class="btn btn-ghost btn-sm chx-admin-btn" id="chxAdmin" ${ui.admin ? '' : 'hidden'} aria-label="Challenge admin">${icons.shield}<span>Admin</span></button>
    </section>
    <div class="chx-searchrow">
      <label class="chx-search">${icons.search}<input id="chxQ" type="search" placeholder="Search challenges, riders, routes or codes" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></label>
      <button class="btn btn-ghost chx-filter-btn${filterCount() ? ' on' : ''}" id="chxFilters">${icons.filter}<span>Filters${filterCount() ? ` · ${filterCount()}` : ''}</span></button>
    </div>
    <div class="chx-quick" role="group" aria-label="Quick filters">
      ${chip('all', !active(), 'All')}
      ${chip('live', ui.f.status.includes('live'), `${icons.flag} Live`)}
      ${chip('soon', ui.f.status.includes('soon'), `${icons.clock} Starting soon`)}
      ${chip('upcoming', ui.f.status.includes('upcoming'), `${icons.events} Upcoming`)}
      ${chip('free', ui.f.entry.includes('free'), 'Free')}
      ${chip('paid', ui.f.entry.includes('paid'), `${icons.coin} Paid`)}
      ${chip('friends', ui.f.access.includes('friends'), `${icons.social} Friends`)}
      ${chip('hall', hallOn, `${icons.pillars} Hall`)}
    </div>
    <div class="chx-own">
      <span class="chx-own-ico">${icons.flag}</span>
      <span class="grow"><b>Your own challenge</b><small>Pick a route, set the rules, invite riders, schedule it. Make it open, code-only or invite-only, and set the maximum riders.</small></span>
      <span class="chx-own-act">
        <button class="btn btn-primary" id="chxCreate" ${short ? 'disabled' : ''}>${icons.plus} Create challenge</button>
        <small>Creation fee ${icons.coin} ${fmt(cfg.creationFee)} Rush Coins${short ? ` · you have ${fmt(p.coins)}` : ''}</small>
      </span>
      <button class="chx-own-code" id="chxCode">${icons.key} Have a code or link? Join a private challenge ${icons.arrow}</button>
    </div>
    ${invites || next ? `<div class="chx-pulse" role="status">
      ${invites ? `<button data-mine="invites">${icons.mail}<b>${invites}</b> invitation${invites === 1 ? '' : 's'} waiting</button>` : ''}
      ${next ? `<button data-chx-open="${esc(next.id)}">${icons.flag} Your next challenge starts in <b data-cd="${next.startsAt}">…</b></button>` : ''}
    </div>` : ''}
    <div class="seg wide chx-views">
      <button class="${ui.view === 'browse' ? 'on' : ''}" data-goview="browse">${icons.grid} Browse</button>
      <button class="${ui.view === 'calendar' ? 'on' : ''}" data-goview="calendar">${icons.events} Calendar</button>
      <button class="${ui.view === 'mine' ? 'on' : ''}" data-goview="mine">${icons.user} My challenges</button>
    </div>
    <div id="chxBody">${body()}</div>
  </div>`;
}

function body() {
  const now = Date.now();
  if (active() && ui.view !== 'mine') return results(now);
  if (ui.view === 'calendar') return calendar(now);
  if (ui.view === 'mine') return mineView(now);
  return browse(now);
}

const section = (id: string, icon: string, title: string, inner: string, more = '') =>
  `<section class="chx-sec" id="sec-${id}"><div class="chx-sec-top"><h2 class="chx-sec-h">${icon ? ic(icon) : ''} ${title}</h2>${more}</div>${inner}</section>`;
const rail = (list: Challenge[], now: number) => `<div class="chx-rail">${list.map((c) => chTile(c, now)).join('')}</div>`;
const grid = (list: Challenge[], now: number) => `<div class="chx-tiles">${list.map((c) => chTile(c, now)).join('')}</div>`;
const viewAll = (attrs: string) => `<button class="chx-all" ${attrs}>View all ${icons.arrow}</button>`;

function results(now: number) {
  const list = sorted(visible(now).filter((c) => matches(c, now)), now);
  const sortSel = `<label class="chx-sort">Sort <select id="chxSort">${([['soon', 'Starting soon'], ['players', 'Most players'], ['prize', 'Highest prize'], ['popular', 'Most popular'], ['new', 'Recently created']] as [Sort, string][]).map(([v, n]) => `<option value="${v}"${ui.sort === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
  const code = /^LR-?[A-Z0-9]{4,6}$/i.test(ui.q.trim()) ? `<button class="btn btn-ghost btn-sm" data-findcode>${icons.key} Look up code ${esc(ui.q.trim().toUpperCase())}</button>` : '';
  return `<div class="chx-results-top"><b>${list.length} challenge${list.length === 1 ? '' : 's'}</b>${code}<span class="grow"></span>${sortSel}<button class="btn btn-link btn-sm" data-clear>Clear</button></div>
    ${list.length ? grid(list.slice(0, 60), now) : empty('search', 'No challenges match', 'Try fewer filters or another word. Private challenges only show up with their code.', `<button class="btn btn-ghost btn-sm" data-clear>Clear search and filters</button>`)}`;
}

function browse(now: number) {
  const list = visible(now);
  const open = list.filter((c) => ['live', 'soon', 'upcoming'].includes(phaseOf(c, now)));
  const rank = (c: Challenge) => ({ live: 0, soon: 1, upcoming: 2, ended: 3, cancelled: 4 })[phaseOf(c, now)];
  // today: races and timed windows first (they don't wait), then the all-day ones by type
  const today = open.filter((c) => dayDiff(c.startsAt, now) <= 0 && c.kind !== 'time' && !(c.format === 'live_race' && phaseOf(c, now) === 'live' && !joined(c)))
    .sort((a, b) => rank(a) - rank(b) || Number(allDayTrial(a)) - Number(allDayTrial(b)) || a.startsAt - b.startsAt);
  const todayRail = [...today.filter((c) => !allDayTrial(c) && c.format === 'live_race').slice(0, 2), ...today.filter((c) => allDayTrial(c) || c.format !== 'live_race')].slice(0, 12);
  // popular: most riders first; official weekly and limited-time ones fill the row
  const pop = open.filter((c) => c.riders > 0 && discoverableNow(c)).sort((a, b) => b.riders - a.riders);
  const fill = open.filter((c) => c.official && ['weekly', 'special', 'hall', 'interhall', 'skill', 'location', 'treasure', 'distance'].includes(kindOf(c).id) && dayDiff(c.startsAt, now) < 7 && !pop.includes(c)).sort((a, b) => rank(a) - rank(b) || a.startsAt - b.startsAt);
  const popular = [...pop, ...fill].filter((c, i, a) => a.findIndex((x) => x.id === c.id || (x.official && c.official && x.name === c.name)) === i).slice(0, 8);
  const live = open.filter((c) => phaseOf(c, now) === 'live').length;
  const races = open.filter((c) => c.format === 'live_race' && phaseOf(c, now) !== 'live').sort((a, b) => a.startsAt - b.startsAt).slice(0, 8);
  const trials = open.filter((c) => c.kind === 'time' && phaseOf(c, now) === 'live');
  const riders = open.filter((c) => !c.official && discoverableNow(c)).sort((a, b) => rank(a) - rank(b) || a.startsAt - b.startsAt).slice(0, 8);
  const weekly = open.filter((c) => c.official && (kindOf(c).id === 'weekly' || kindOf(c).id === 'hall') && dayDiff(c.startsAt, now) > 0 && dayDiff(c.startsAt, now) < 7).sort((a, b) => a.startsAt - b.startsAt).slice(0, 6);
  const invites = list.filter((c) => c.invited?.status === 'pending' && phaseOf(c, now) !== 'ended' && phaseOf(c, now) !== 'cancelled');
  const mineUp = list.filter((c) => joined(c) && ['live', 'soon', 'upcoming'].includes(phaseOf(c, now))).sort((a, b) => a.startsAt - b.startsAt);
  const done = list.filter((c) => (joined(c) || isCreator(c)) && phaseOf(c, now) === 'ended').sort((a, b) => b.endsAt - a.endsAt).slice(0, 4);
  const kinds = CH_KINDS.filter((k) => open.some((c) => kindOf(c).id === k.id));

  return [
    mineUp.length ? section('mine', '', 'Your challenges', rail(mineUp.slice(0, 8), now), viewAll('data-goview="mine"')) : '',
    invites.length ? section('invites', '', 'Invitations', invites.map(inviteCard).join('')) : '',
    section('today', '', `Today's challenges <span class="chx-live-n"><i></i>${live} live</span>`, rail(todayRail, now), viewAll('data-goview="calendar" data-range="today"')),
    section('popular', '', 'Popular challenges', rail(popular, now), viewAll('data-sortview="popular"')),
    races.length ? section('races', '', 'Live races starting soon', rail(races, now), viewAll('data-quick="soon"')) : '',
    section('types', '', 'Challenge types', `<div class="chx-kinds">${kinds.map((k) => `<button class="chx-kind" data-kind="${k.id}"><span class="chx-kind-img" style="background-image:url('${photoUrl(k.photo)}')"></span><span class="chx-kind-ico">${ic(k.icon)}</span><b>${esc(k.name)}</b><small>${open.filter((c) => kindOf(c).id === k.id).length} open</small></button>`).join('')}</div>`),
    riders.length ? section('riders', '', 'Made by riders', rail(riders, now), viewAll('data-kindall="player"')) : '',
    trials.length ? section('trials', '', 'Time trials on every route', rail(trials, now), viewAll('data-kindall="time"')) : '',
    weekly.length ? section('weekly', '', 'Coming this week', rail(weekly, now), viewAll('data-goview="calendar" data-range="week"')) : '',
    done.length ? section('done', '', 'Completed', `<div class="card chx-rows">${done.map((c) => doneRow(c)).join('')}</div>`) : '',
    api.online() ? '' : `<p class="muted small chx-quiet">${icons.user} Sign in to create, join and see rider challenges. Official LEGONRUSH challenges work for everyone.</p>`,
  ].join('');
}
/** rider challenges that anyone may find */
const discoverableNow = (c: Challenge) => c.access === 'open' || c.access === 'hall';

function mineRow(c: Challenge, now: number) {
  const ph = phaseOf(c, now);
  return `<button class="chx-row is-mine" data-chx-open="${esc(c.id)}">
    <span class="chx-tile f-${c.format}">${ic(FORMATS.find((f) => f.id === c.format)!.icon)}</span>
    <span class="grow chx-name"><b>${esc(c.name)}</b><small>${ph === 'live' ? (c.format === 'live_race' ? 'Live now' : `Open now${c.attempts > 1 ? ` · ${Math.max(0, c.attempts - (api.mine(c.id)?.attempts ?? 0))} tries left` : ''}`) : c.startNow ? 'Starts when riders are ready' : c.startsAt - now < 6 * 3600e3 ? `Starts in <span data-cd="${c.startsAt}">…</span>` : esc(whenOf(c))}${c.official ? '' : ` · ${c.riders}/${c.maxRiders}`}${c.entryFee ? ` · ${fmt(c.entryFee)} entry` : ''}</small></span>
    <span class="chx-go">View ${icons.arrow}</span>
  </button>`;
}
const whenOf = (c: Challenge) => { const d = dayDiff(c.startsAt); const t = new Date(c.startsAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase(); return `${d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(c.startsAt).toLocaleDateString('en-GB', { weekday: 'long' })} · ${t}`; };
function doneRow(c: Challenge) {
  const m = api.mine(c.id);
  return `<button class="chx-row" data-chx-open="${esc(c.id)}"><span class="chx-tile done">${icons.flagCheck}</span><span class="grow chx-name"><b>${esc(c.name)}</b><small>${m?.best ? `Your best ${raceTime(m.best)}${m.place ? ` · ${ordinal(m.place)}` : ''}` : 'No finish'} · ended ${esc(whenOf({ ...c, startsAt: c.endsAt }))}</small></span><span class="chx-go">Results ${icons.arrow}</span></button>`;
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

function inviteCard(c: Challenge) {
  return `<div class="card chx-invite-card">
    <p class="small">${icons.bell} <b>${esc(c.invited?.from ?? 'A rider')}</b> invited you to a challenge</p>
    <button class="chx-row" data-chx-open="${esc(c.id)}"><span class="chx-tile f-${c.format}">${ic(FORMATS.find((f) => f.id === c.format)!.icon)}</span><span class="grow chx-name"><b>${esc(c.name)}</b><small>${esc(chRoute(c.route)?.name ?? '')} · ${esc(whenOf(c))} · ${c.entryFee ? `${fmt(c.entryFee)} entry` : 'Free'}</small></span></button>
    <div class="two"><button class="btn btn-primary btn-sm" data-accept="${esc(c.id)}">Accept</button><button class="btn btn-ghost btn-sm" data-decline="${esc(c.id)}">Decline</button></div>
  </div>`;
}

// ---------- calendar ----------

function calendar(now: number) {
  const list = visible(now).filter((c) => phaseOf(c, now) !== 'cancelled');
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const day = (k: number) => { const d = new Date(start); d.setDate(d.getDate() + k); return d.getTime(); };
  const toMon = (7 - ((start.getDay() + 6) % 7)) % 7 || 7;
  const ranges: Record<typeof ui.range, [number, number]> = {
    today: [day(0), day(1)], tomorrow: [day(1), day(2)], week: [day(0), day(toMon)], next: [day(toMon), day(toMon + 7)],
    date: (() => { const d = new Date(`${ui.date}T00:00`); const n = new Date(d); n.setDate(n.getDate() + 1); return [d.getTime(), n.getTime()]; })(),
  };
  const [a, b] = ranges[ui.range];
  const inRange = list.filter((c) => c.startsAt >= a && c.startsAt < b).sort((x, y) => x.startsAt - y.startsAt);
  const days = new Map<string, Challenge[]>();
  for (const c of inRange) { const k = dateKey(c.startsAt); days.set(k, [...(days.get(k) ?? []), c]); }
  const chip = (id: typeof ui.range, name: string) => `<button class="chip-btn${ui.range === id ? ' on' : ''}" data-range="${id}">${name}</button>`;
  return `<div class="chx-cal-top">${chip('today', 'Today')}${chip('tomorrow', 'Tomorrow')}${chip('week', 'This week')}${chip('next', 'Next week')}
      <label class="chip-btn chx-date${ui.range === 'date' ? ' on' : ''}">${icons.events}<input type="date" id="chxDate" value="${ui.date}" min="${dateKey(now - 7 * 86400e3)}" aria-label="Pick a date"></label></div>
    ${days.size ? [...days].map(([k, l]) => {
      const trials = l.filter(allDayTrial);
      const rest = l.filter((c) => !allDayTrial(c));
      const head = new Date(`${k}T12:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
      return `<div class="chx-day"><h3>${head}</h3><div class="card chx-rows">
        ${trials.length ? `<button class="chx-row" data-allday="${k}"><span class="chx-time">All day</span><span class="chx-tile f-time_trial">${icons.clock}</span><span class="grow chx-name"><b>All-day challenges</b><small>${trials.length} challenges · time trials, hunts, skills and more</small></span><span class="chx-go">${ui.allDay === k ? 'Hide' : 'Show'}</span></button>${ui.allDay === k ? trials.map((c) => chRow(c, now).replace('class="chx-row', 'class="chx-row sub')).join('') : ''}` : ''}
        ${rest.map((c) => chRow(c, now)).join('')}</div></div>`;
    }).join('') : empty('events', 'Nothing on these days', 'Pick another day, or schedule a challenge yourself.')}`;
}

// ---------- my challenges ----------

function mineView(now: number) {
  const list = visible(now);
  const mine = list.filter((c) => joined(c) || isCreator(c));
  const tabs: [MineTab, string, Challenge[]][] = [
    ['upcoming', 'Upcoming', mine.filter((c) => ['soon', 'upcoming'].includes(phaseOf(c, now))).sort((a, b) => a.startsAt - b.startsAt)],
    ['live', 'Live', mine.filter((c) => phaseOf(c, now) === 'live')],
    ['created', 'My created', list.filter(isCreator).sort((a, b) => b.createdAt - a.createdAt)],
    ['joined', 'Joined', mine.filter((c) => !isCreator(c)).sort((a, b) => b.startsAt - a.startsAt)],
    ['completed', 'Completed', mine.filter((c) => ['ended', 'cancelled'].includes(phaseOf(c, now))).sort((a, b) => b.endsAt - a.endsAt)],
    ['invites', 'Invitations', list.filter((c) => c.invited?.status === 'pending' && phaseOf(c, now) !== 'ended')],
    ['pbs', 'Personal bests', []],
  ];
  const cur = tabs.find(([id]) => id === ui.mine)!;
  let inner: string;
  if (ui.mine === 'pbs') {
    const p = H().profile();
    const bests = Object.values(api.local().mine).filter((m) => m.best).sort((a, b) => b.joinedAt - a.joinedAt);
    inner = `<h3 class="chx-mini-h">Routes</h3><div class="card chx-rows">${CH_ROUTES.filter((r) => !r.hidden).map((r) => `<div class="chx-row static"><span class="chx-tile">${icons.pin}</span><span class="grow chx-name"><b>${esc(r.name)}</b><small>${esc(r.line)}</small></span><b class="chx-pbt">${p.bestTimes[r.id] ? raceTime(p.bestTimes[r.id]) : '—'}</b></div>`).join('')}</div>
      <h3 class="chx-mini-h">Challenges</h3>${bests.length ? `<div class="card chx-rows">${bests.map((m) => `<button class="chx-row" data-chx-open="${esc(m.id)}"><span class="chx-tile">${icons.trophy}</span><span class="grow chx-name"><b>${esc(m.snap.name)}</b><small>${esc(chRoute(m.snap.route)?.name ?? '')} · ${m.attempts} ride${m.attempts === 1 ? '' : 's'}${m.place ? ` · ${ordinal(m.place)}` : ''}</small></span><b class="chx-pbt">${raceTime(m.best!)}</b></button>`).join('')}</div>` : empty('trophy', 'No challenge times yet', 'Finish a challenge and your best time shows here.')}`;
  } else if (ui.mine === 'invites') {
    inner = cur[2].length ? cur[2].map(inviteCard).join('') : empty('mail', 'No invitations', 'When a rider invites you, it shows up here.');
  } else {
    inner = cur[2].length ? grid(cur[2].slice(0, 40), now) : empty(ui.mine === 'created' ? 'plus' : 'flag', ui.mine === 'created' ? "You haven't created a challenge" : 'Nothing here yet', ui.mine === 'created' ? 'Create one: pick a route, set the rules and share the code.' : 'Challenges you join show up here.');
  }
  return `<div class="chx-quick chx-minetabs">${tabs.map(([id, n, l]) => `<button class="chip-btn${ui.mine === id ? ' on' : ''}" data-mine="${id}">${n}${l.length ? ` <small>${l.length}</small>` : ''}</button>`).join('')}</div>
    ${inner}
    <label class="chx-toggle"><input type="checkbox" id="chxRemind" ${api.local().remind ? 'checked' : ''}><span>${icons.bell} Challenge reminders: the day before, 30 minutes before and at the start</span></label>`;
}

// ---------- wiring ----------

function filtersSheet(redraw: () => void) {
  const f: Filters = structuredClone(ui.f);
  let sort = ui.sort;
  const sh = document.createElement('div');
  sh.className = 'overlay sheet-overlay fade-in';
  const group = <T extends string>(key: keyof Filters, title: string, items: [T, string][]) =>
    `<div class="chx-fgroup"><b>${title}</b><div class="chx-chips">${items.map(([v, n]) => `<button class="chip-btn${(f[key] as string[]).includes(v) ? ' on' : ''}" data-fk="${key}" data-fv="${v}">${esc(n)}</button>`).join('')}</div></div>`;
  const draw = () => {
    sh.innerHTML = `<div class="sheet light-ui chx-sheet" role="dialog" aria-label="Filters"><div class="row"><h2 class="title" style="font-size:22px">Filters</h2><span class="grow"></span><button class="btn btn-link" data-x>Close</button></div>
      ${group('status', 'Status', [['live', 'Live now'], ['soon', 'Starting soon'], ['upcoming', 'Upcoming'], ['ended', 'Completed']])}
      ${group('access', 'Access', ACCESS.map((a) => [a.id, a.name] as [string, string]))}
      ${group('entry', 'Entry', [['free', 'Free'], ['paid', 'Paid']])}
      ${group('kind', 'Type', CH_KINDS.map((k) => [k.id, k.name] as [string, string]))}
      ${group('type', 'Format', FORMATS.filter((x) => !x.soon).map((x) => [x.id, x.name] as [string, string]))}
      ${group('route', 'Route', CH_ROUTES.filter((r) => !r.hidden).map((r) => [r.id, r.name] as [string, string]))}
      <div class="chx-fgroup"><b>Sort</b><div class="chx-chips">${([['soon', 'Starting soon'], ['players', 'Most players'], ['prize', 'Highest prize'], ['popular', 'Most popular'], ['new', 'Recently created']] as [Sort, string][]).map(([v, n]) => `<button class="chip-btn${sort === v ? ' on' : ''}" data-sort="${v}">${n}</button>`).join('')}</div></div>
      <div class="two"><button class="btn btn-ghost" data-reset>Reset</button><button class="btn btn-primary" data-apply>Show results</button></div></div>`;
  };
  draw();
  document.body.appendChild(sh);
  sh.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const fv = t.closest<HTMLElement>('[data-fv]');
    if (fv) {
      const k = fv.dataset.fk as keyof Filters;
      const list = f[k] as string[];
      (f[k] as string[]) = list.includes(fv.dataset.fv!) ? list.filter((x) => x !== fv.dataset.fv) : [...list, fv.dataset.fv!];
      return draw();
    }
    const so = t.closest<HTMLElement>('[data-sort]');
    if (so) { sort = so.dataset.sort as Sort; return draw(); }
    if (t.closest('[data-reset]')) { (Object.keys(f) as (keyof Filters)[]).forEach((k) => (f[k] = [])); sort = 'soon'; return draw(); }
    if (t.closest('[data-apply]')) { ui.f = f; ui.sort = sort; sh.remove(); return redraw(); }
    if (e.target === sh || t.closest('[data-x]')) sh.remove();
  });
}

function bind(root: HTMLElement) {
  const h = H();
  let stopTick = () => {};
  const redrawBody = () => {
    const b = root.querySelector<HTMLElement>('#chxBody');
    if (!b) return;
    b.innerHTML = body();
    stopTick();
    stopTick = ticker(root, redrawAll);
  };
  // the chips and counts at the top change with filters too
  const redrawAll = () => {
    const el = root.querySelector<HTMLElement>('#chx');
    if (!el) return;
    const y = root.scrollTop;
    const q = root.querySelector<HTMLInputElement>('#chxQ');
    const focused = document.activeElement === q;
    el.outerHTML = render();
    root.scrollTop = y;
    if (focused) { const n = root.querySelector<HTMLInputElement>('#chxQ')!; n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    wireInputs();
    stopTick();
    stopTick = ticker(root, redrawAll);
  };
  const wireInputs = () => {
    const q = root.querySelector<HTMLInputElement>('#chxQ')!;
    let t = 0;
    q.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => { ui.q = q.value; redrawAll(); }, 250); });
    root.querySelector<HTMLSelectElement>('#chxSort')?.addEventListener('change', (e) => { ui.sort = (e.target as HTMLSelectElement).value as Sort; redrawBody(); });
    root.querySelector<HTMLInputElement>('#chxDate')?.addEventListener('change', (e) => { ui.date = (e.target as HTMLInputElement).value; ui.range = 'date'; redrawBody(); });
    root.querySelector<HTMLInputElement>('#chxRemind')?.addEventListener('change', (e) => setRemindersOn((e.target as HTMLInputElement).checked));
  };
  wireInputs();
  stopTick = ticker(root, redrawAll);

  const onClick = async (e: Event) => {
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>('button, [data-chx-open]');
    if (!el || !root.contains(el)) return;
    const d = el.dataset;
    const back = () => h.home('challenges');
    if (d.chxOpen) { const c = all().find((x) => x.id === d.chxOpen); if (c) detailScreen(c, back); return; }
    if (d.quick) {
      const q = d.quick;
      if (q === 'all') { ui.f = { status: [], access: [], entry: [], type: [], route: [], kind: [] }; ui.q = ''; }
      else if (['live', 'soon', 'upcoming'].includes(q)) ui.f.status = ui.f.status.includes(q as Phase) ? ui.f.status.filter((x) => x !== q) : [...ui.f.status, q as Phase];
      else if (q === 'free' || q === 'paid') ui.f.entry = ui.f.entry.includes(q) ? [] : [q];
      else if (q === 'hall') ui.f.kind = ui.f.kind.includes('hall') ? ui.f.kind.filter((x) => x !== 'hall' && x !== 'interhall') : [...ui.f.kind, 'hall', 'interhall'];
      else ui.f.access = ui.f.access.includes(q as Access) ? ui.f.access.filter((x) => x !== q) : [...ui.f.access, q as Access];
      if (ui.view === 'mine') ui.view = 'browse';
      return redrawAll();
    }
    if (d.kind || d.kindall) { ui.f.kind = [(d.kind ?? d.kindall)!]; ui.view = 'browse'; root.scrollTop = 0; return redrawAll(); }
    if (d.sortview) { ui.sort = d.sortview as Sort; ui.f.status = ['live', 'soon', 'upcoming']; ui.view = 'browse'; return redrawAll(); }
    if (d.goview) { ui.view = d.goview as View; if (d.range) ui.range = d.range as typeof ui.range; return redrawAll(); }
    if (d.range) { ui.range = d.range as typeof ui.range; return redrawBody(); }
    if (d.allday) { ui.allDay = ui.allDay === d.allday ? '' : d.allday; return redrawBody(); }
    if (d.mine) { ui.view = 'mine'; ui.mine = d.mine as MineTab; return redrawAll(); }
    if (d.clear !== undefined) { ui.q = ''; ui.f = { status: [], access: [], entry: [], type: [], route: [], kind: [] }; return redrawAll(); }
    if (d.findcode !== undefined) return codeScreen(back, ui.q.trim());
    if (d.accept) { const c = all().find((x) => x.id === d.accept); if (c) joinScreen(c, back); return; }
    if (d.decline) {
      (el as HTMLButtonElement).disabled = true;
      const r = await api.answerInvite(d.decline, false);
      if (!r.ok) return h.toast(esc(r.message));
      const s = api.local();
      s.cache = s.cache.map((x) => (x.id === d.decline ? { ...x, invited: x.invited ? { ...x.invited, status: 'declined' } : null } : x));
      api.saveLocal();
      return redrawAll();
    }
    switch (el.id) {
      case 'chxCreate': return createScreen(back);
      case 'chxCode': return codeScreen(back);
      case 'chxFilters': return filtersSheet(redrawAll);
      case 'chxAdmin': return void adminScreen(back);
    }
  };
  root.addEventListener('click', onClick);

  // fresh challenges from the server, then show them
  void refresh().then(() => { if (root.querySelector('#chx')) redrawAll(); });
  void api.isAdmin().then((yes) => {
    if (yes === ui.admin) return;
    ui.admin = yes;
    const b = root.querySelector<HTMLElement>('#chxAdmin');
    if (b) b.hidden = !yes;
  });
  // lists change as challenges start and end
  const minute = setInterval(() => { if (!document.activeElement?.closest('#chx input, #chx select')) redrawBody(); }, 60e3);
  return () => {
    stopTick();
    clearInterval(minute);
    root.removeEventListener('click', onClick);
  };
}

registerTab('challenges', { render, bind });
setPinOpener((c) => detailScreen(c, () => H().home('map')));
