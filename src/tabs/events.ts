// Events tab: "What's happening on campus?" Search, filters, sorting, and sections (your events,
// live now, later today, this week, event series, all week long), with the Event Passport.
import { registerTab } from './registry';
import { H, esc } from '../features/host';
import { icons } from '../ui/icons';
import { placeByName } from '../game/campusmap';
import { reminders, cancelReminder } from '../features/notify';
import { homePlace } from '../features/missions';
import { initEvents, claimPayouts, openLinkedEvent, eventDetail, seriesScreen, createWizard, passportCardHtml } from '../features/events';
import { allEvents, allSeries, isJoined, prefs, setPrefs, refresh, rewardValue, scheduleSeriesNews } from '../features/events/store';
import { now, statusOf, isOn, countdown } from '../features/events/schedule';
import { FILTERS, SORTS, TYPES, placeLabel, type FilterId, type SortId } from '../features/events/catalog';
import { eventCard, seriesCard, emptyHtml } from '../features/events/ui';
import type { CampusEvent } from '../features/events/types';
import { campusLifeHtml, campusLifeClick } from '../features/life';

initEvents();

const VIEW_KEY = 'legonrush.events.view.v1';
let filter: FilterId = 'all';
let sort: SortId = 'soon';
let query = '';
let serverOk: boolean | null = null;
try { ({ filter = 'all', sort = 'soon' } = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')); } catch { /* defaults */ }
if (!FILTERS.some(([id]) => id === filter)) filter = 'all';

/** Events are socials: places to meet people and hang out. Races, hunts and other challenges live in Race and Challenges. */
const isSocial = (e: CampusEvent) => (e.activity === 'space' || e.activity === 'sunset') && !e.name.startsWith('Hall Wars');
const remember = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ filter, sort })); } catch { /* blocked */ } };

const DAILY = /^off:(coinrush|rainrush|sunset|night):/;
const ALLWEEK = (e: CampusEvent) => e.activity === 'prize' || e.activity === 'hallweek';
const dayEnd = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };

function matches(e: CampusEvent, q: string) {
  if (!q) return true;
  const hay = `${e.name} ${e.place} ${placeLabel(e.place)} ${e.host} ${TYPES[e.type].label} ${e.series?.name ?? ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}
function byFilter(e: CampusEvent, f: FilterId, t: number) {
  const st = statusOf(e, t);
  if (st === 'completed' || st === 'cancelled') return false;
  switch (f) {
    case 'live': return isOn(st);
    case 'today': return e.start <= dayEnd(t);
    case 'upcoming': return e.start > t;
    case 'treasure': case 'social': case 'games': case 'hall': return TYPES[e.type].group === f;
    case 'free': return !e.fee;
    default: return true;
  }
}
function sorter(s: SortId) {
  const home = homePlace(H().profile());
  const far = (e: CampusEvent) => { const q = placeByName(e.place); return q ? Math.hypot(q.x - home.x, q.z - home.z) : 1e9; };
  const soon = (a: CampusEvent, b: CampusEvent) => (isOn(statusOf(a)) ? a.end - 1e13 : a.start) - (isOn(statusOf(b)) ? b.end - 1e13 : b.start);
  return (a: CampusEvent, b: CampusEvent) =>
    s === 'popular' ? (b.joinedCount ?? -1) - (a.joinedCount ?? -1) || soon(a, b)
    : s === 'reward' ? rewardValue(b) - rewardValue(a) || soon(a, b)
    : s === 'closest' ? far(a) - far(b) || soon(a, b)
    : s === 'free' ? a.fee - b.fee || soon(a, b)
    : s === 'recent' ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
    : soon(a, b);
}

const rail = (title: string, list: CampusEvent[], icon: string, note = '') => list.length
  ? `<section class="ev-sec"><div class="ev-sec-h"><h2>${icon}${esc(title)}</h2><span class="muted small">${note || list.length}</span></div><div class="ev-rail">${list.map((e) => eventCard(e, { joined: isJoined(H().profile(), e.key) })).join('')}</div></section>`
  : '';

function listHtml() {
  const t = now();
  const p = H().profile();
  const all = allEvents().filter((e) => isSocial(e) && matches(e, query));
  const s = sorter(sort);

  // a search or a filter: one list
  if (query || filter !== 'all') {
    const list = all.filter((e) => byFilter(e, filter, t) && !(filter !== 'live' && ALLWEEK(e))).sort(s);
    // the daily ones repeat: keep the next of each
    const seen = new Set<string>();
    const shown = list.filter((e) => { const k = DAILY.exec(e.key)?.[1]; if (!k || filter === 'live') return true; if (seen.has(k)) return false; seen.add(k); return true; });
    return shown.length
      ? `<div class="ev-grid">${shown.slice(0, 40).map((e) => eventCard(e, { joined: isJoined(p, e.key) })).join('')}</div>`
      : emptyHtml(query ? `Nothing matches "${query}"` : 'Nothing here right now', query ? 'Try a place like "Oval" or a type like "treasure".' : 'Try another filter, or check back later: new events are added every day.', icons.search);
  }

  const open = all.filter((e) => byFilter(e, 'all', t) && !ALLWEEK(e));
  const mine = open.filter((e) => isJoined(p, e.key)).sort(s).slice(0, 8);
  const live = open.filter((e) => isOn(statusOf(e, t))).sort(s);
  const today = open.filter((e) => !isOn(statusOf(e, t)) && e.start <= dayEnd(t)).sort(s);
  const week = open.filter((e) => e.start > dayEnd(t) && e.start < t + 7 * 86400e3 && !DAILY.test(e.key)).sort(s);
  const series = allSeries().map((x) => ({ ...x, days: x.days.filter(isSocial) })).filter((x) => x.end > t && x.days.length).slice(0, 6);
  const next = [...today, ...week][0];

  return `
    ${serverOk === false ? `<p class="ev-offline">${icons.wifiOff} Showing official events. Rider events and join counts load when you're online.</p>` : ''}
    ${campusLifeHtml()}
    ${rail('Your events', mine, icons.check)}
    ${live.length ? rail('Live now', live, '<i class="ev-dot"></i>') : `<div class="ev-nolive">${icons.clock}<span><b>Nothing live right now.</b> ${next ? `Next: ${esc(next.name)} in ${countdown(next.start - t)}.` : ''}</span></div>`}
    ${rail('Later today', today, icons.clock)}
    ${rail('This week', week, icons.events)}
    ${series.length ? `<section class="ev-sec"><div class="ev-sec-h"><h2>${icons.sparkle}Event series</h2><span class="muted small">${series.length}</span></div><div class="ev-rail">${series.map(seriesCard).join('')}</div></section>` : ''}
    <section class="ev-sec">${passportCardHtml(p, 'events')}</section>`;
}

function render() {
  return `<div class="hub ev-home">
    <div class="ev-head">
      <p class="kicker grow">Events</p>
      <button class="btn btn-primary btn-sm" id="evCreate">${icons.plus} Create event</button>
    </div>
    <h1 class="title ev-title">What's happening on campus?</h1>
    <p class="muted ev-sub">Meet people, hang out, dance, eat. No racing here, just campus life.</p>
    <label class="ev-search">${icons.search}<input id="evQ" type="search" placeholder="Search events, locations or hosts" value="${esc(query)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="ev-filters" role="tablist">${FILTERS.map(([id, label]) => `<button class="ev-filter${filter === id ? ' on' : ''}" data-filter="${id}" role="tab" aria-selected="${filter === id}">${id === 'live' ? '<i class="ev-dot"></i>' : ''}${label}</button>`).join('')}</div>
    <div class="ev-sortrow"><button class="ev-link" id="evPrefs">${icons.bell} Reminders</button><span class="grow"></span>
      <label class="ev-sort">${icons.grid}<select id="evSort" aria-label="Sort events">${SORTS.map(([id, label]) => `<option value="${id}"${sort === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div>
    <div id="evList">${listHtml()}</div>
  </div>`;
}

function bind(root: HTMLElement) {
  const back = () => H().home('events');
  let alive = true;
  const list = root.querySelector<HTMLElement>('#evList')!;
  const redraw = () => { if (alive) { list.innerHTML = listHtml(); } };
  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (campusLifeClick(t, back)) return;
    const card = t.closest<HTMLElement>('[data-ev]');
    if (card) return eventDetail(card.dataset.ev!, back);
    const ser = t.closest<HTMLElement>('[data-series]');
    if (ser) return seriesScreen(ser.dataset.series!, back);
    const f = t.closest<HTMLElement>('[data-filter]');
    if (f) {
      filter = f.dataset.filter as FilterId;
      remember();
      root.querySelectorAll('[data-filter]').forEach((x) => { x.classList.toggle('on', x === f); x.setAttribute('aria-selected', String(x === f)); });
      f.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      return redraw();
    }
  });
  root.querySelector('#evCreate')!.addEventListener('click', () => void createWizard(back));
  root.querySelector('#evPrefs')!.addEventListener('click', () => prefsSheet());
  root.querySelector<HTMLSelectElement>('#evSort')!.addEventListener('change', (ev) => { sort = (ev.target as HTMLSelectElement).value as SortId; remember(); redraw(); });
  const q = root.querySelector<HTMLInputElement>('#evQ')!;
  let timer = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { query = q.value.trim(); redraw(); }, 160); });

  if (openLinkedEvent()) return;
  // rider events, real counts and payouts arrive a moment later
  void refresh().then((ok) => { serverOk = ok; redraw(); });
  void claimPayouts();
  scheduleSeriesNews();
  const tick = setInterval(redraw, 60e3);
  return () => { alive = false; clearInterval(tick); clearTimeout(timer); };
}

function prefsSheet() {
  const pr = prefs();
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  const mine = reminders().filter((r) => r.id.startsWith('ev:'));
  const sw = (id: keyof typeof pr, label: string, hint: string) => `<label class="ev-switch"><span class="grow"><b>${label}</b><small class="muted">${hint}</small></span><input type="checkbox" data-pref="${id}" ${pr[id] ? 'checked' : ''}><i></i></label>`;
  ov.innerHTML = `<div class="sheet light-ui ev-prefs">
    <div class="row"><h2 class="title" style="font-size:24px">${icons.bell} Event notifications</h2><span class="grow"></span><button class="btn btn-link" data-close>Done</button></div>
    ${sw('before', '30 minutes before', 'For events you joined')}
    ${sw('start', 'When it starts', 'For events you joined')}
    ${sw('series', 'New series', 'Freshers Week, Hall Wars and other series')}
    <b class="small">Coming up</b>
    ${mine.length ? `<ul class="ev-rem">${mine.slice(0, 8).map((r) => `<li><span class="grow"><b>${esc(r.title)}</b><small class="muted">${new Date(r.at).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small></span><button class="btn btn-link" data-rm="${esc(r.id)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted small">No reminders yet. Join an event and we\'ll remind you.</p>'}
    <p class="muted small">Reminders show while LEGONRUSH is open${'Notification' in window && Notification.permission === 'granted' ? ', and as phone notifications' : ''}.</p>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === ov || t.closest('[data-close]')) return ov.remove();
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) { cancelReminder(rm.dataset.rm!); rm.closest('li')?.remove(); }
  });
  ov.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((i) => i.addEventListener('change', () => { setPrefs({ [i.dataset.pref!]: i.checked }); scheduleSeriesNews(); }));
}

registerTab('events', { render, bind });
