// The rider's side of events: the merged calendar (official + server), joining and leaving
// (entry fees, reminders), taking part and finishing (rewards once per event), the Event Passport
// and notification preferences.
import * as cloud from '../../cloud';
import { saveProfile, newEventsProgress, type Profile } from '../../state';
import { grant, spend, type Reward } from '../inventory';
import { cancelReminder, remind, askPermission } from '../notify';
import { postActivity } from '../activity';
import { hallById } from '../../data/campus';
import { now, officialCalendar, statusOf } from './schedule';
import * as srv from './cloud';
import { TYPES, eventItem } from './catalog';
import type { CampusEvent, EventType, SeriesInfo } from './types';
import { icons } from '../../ui/icons';

// ---------- the calendar ----------
let counts: Record<string, number> = {};
let countsAt = 0;

/** every event we know about right now (official schedule + whatever the server sent last) */
export function allEvents(): CampusEvent[] {
  const off = officialCalendar().events;
  const db = srv.cachedServerEvents() ?? [];
  return [...off, ...db].map((e) => (counts[e.key] !== undefined ? { ...e, joinedCount: counts[e.key] } : e));
}
export function allSeries(): SeriesInfo[] {
  const list = [...officialCalendar().series];
  // server series: grouped by series id
  const by = new Map<string, CampusEvent[]>();
  for (const e of srv.cachedServerEvents() ?? []) if (e.series) by.set(e.series.id, [...(by.get(e.series.id) ?? []), e]);
  for (const [id, days] of by) {
    days.sort((a, b) => a.start - b.start);
    list.push({ id, name: days[0].series!.name, blurb: days[0].blurb, cover: days[0].cover, start: days[0].start, end: days[days.length - 1].end, days });
  }
  return list.sort((a, b) => a.start - b.start);
}
export const eventByKey = (key: string) => allEvents().find((e) => e.key === key);
export const seriesById = (id: string) => allSeries().find((s) => s.id === id);

/** fetch server events and real counts; resolves with whether the server answered */
export async function refresh(force = false): Promise<boolean> {
  const list = await srv.serverEvents(force);
  if (force || Date.now() - countsAt > 60e3) {
    const t = now();
    const keys = allEvents().filter((e) => e.end > t - 3600e3 && e.start < t + 7 * 86400e3).map((e) => e.key).slice(0, 150);
    const c = await srv.joinedCounts(keys);
    if (Object.keys(c).length || list) { counts = c; countsAt = Date.now(); }
  }
  return list !== null;
}

// ---------- the rider's progress ----------
const prog = (p: Profile) => (p.events ??= newEventsProgress());
export const isJoined = (p: Profile, key: string) => !!prog(p).joined[key];
export const isDone = (p: Profile, key: string) => prog(p).done.includes(key);
export const tookPart = (p: Profile, key: string) => prog(p).done.includes(key + '#in');

// ---------- notification preferences (this phone) ----------
export interface Prefs { before: boolean; start: boolean; series: boolean }
const PREF_KEY = 'legonrush.events.prefs.v1';
export function prefs(): Prefs {
  try { return { before: true, start: true, series: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { before: true, start: true, series: false }; }
}
export function setPrefs(p: Partial<Prefs>) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), ...p })); } catch { /* storage blocked */ }
}

function scheduleReminders(e: CampusEvent) {
  const pr = prefs();
  const t = now();
  if (pr.before && e.start - 30 * 60e3 > t) remind({ id: `ev:${e.key}:30`, title: `${e.name} starts in 30 minutes`, body: `At ${e.place.replace(/, .*$/, '')}. Open Events to get ready.`, at: e.start - 30 * 60e3, tab: 'events' });
  if (pr.start && e.start > t) remind({ id: `ev:${e.key}:go`, title: `${e.name} is live now`, body: 'Your event has started.', at: e.start, tab: 'events' });
}

/** with the "New series" preference on: a reminder the day before each series starts */
export function scheduleSeriesNews() {
  const t = now();
  for (const s of allSeries()) {
    const id = `ev:series:${s.id}`;
    if (!prefs().series) { cancelReminder(id); continue; }
    const at = s.start - 86400e3;
    if (at > t && at < t + 21 * 86400e3) remind({ id, title: `${s.name} starts tomorrow`, body: s.blurb, at, tab: 'events' });
  }
}

export type JoinResult = { ok: true; paid: number } | { ok: false; error: string };

/** can this rider join right now? a reason when not */
export function joinBlock(p: Profile, e: CampusEvent): string | null {
  const st = statusOf(e);
  if (st === 'cancelled') return 'This event was cancelled.';
  if (st === 'completed') return 'This event has ended.';
  if (e.regDeadline && now() > e.regDeadline) return 'Registration has closed.';
  if (e.capacity !== null && e.joinedCount !== undefined && e.joinedCount >= e.capacity && !isJoined(p, e.key)) return 'This event is full.';
  if (e.fee > p.coins) return `You need ${e.fee.toLocaleString('en-GB')} Rush Coins to join.`;
  if (e.source !== 'official' && !cloud.account) return 'Sign in to join rider and admin events.';
  return null;
}

/**
 * Join an event. Official schedule events join on the phone (and are counted on the server when
 * signed in). Server events register first; the entry fee is taken only after the server says yes.
 */
export async function join(p: Profile, e: CampusEvent): Promise<JoinResult> {
  if (isJoined(p, e.key)) return { ok: true, paid: 0 };
  const block = joinBlock(p, e);
  if (block) return { ok: false, error: block };
  let paid = 0;
  if (e.source === 'official') {
    if (cloud.account) void srv.register(e.key, { name: p.name, hall: p.hall }).then((r) => { if (r.ok) counts[e.key] = r.joined; });
  } else {
    const r = await srv.register(e.key, { name: p.name, hall: p.hall });
    if (!r.ok) return { ok: false, error: srv.joinError(r.error) };
    counts[e.key] = r.joined;
    paid = r.paid;
    // the server recorded the fee in escrow; take it from the coins on this phone
    if (paid && !spend(p, { coins: paid })) return { ok: false, error: 'Not enough Rush Coins.' };
  }
  prog(p).joined[e.key] = Date.now();
  saveProfile(p);
  scheduleReminders(e);
  void askPermission();
  postActivity({ kind: 'event_join', text: `${p.name} joined ${e.name}`, ref: e.key });
  return { ok: true, paid };
}

/** leave before it starts: refunds come back from the server as a reward to claim */
export async function leave(p: Profile, e: CampusEvent): Promise<boolean> {
  if (e.source !== 'official' || cloud.account) {
    const ok = await srv.unregister(e.key);
    if (!ok && e.source !== 'official') return false;
  }
  delete prog(p).joined[e.key];
  saveProfile(p);
  cancelReminder(`ev:${e.key}`);
  if (counts[e.key]) counts[e.key]--;
  return true;
}

// ---------- taking part and finishing ----------
/** stamp id for the passport */
export const stampOf = (t: EventType): StampId => (t === 'treasure' || t === 'coinrush' || t === 'diamondrush' || t === 'photohunt' || t === 'explorer' || t === 'sunset' || t === 'night' || t === 'rain' || t === 'party' || t === 'games' || t === 'hall' || t === 'festival' ? t : t === 'sports' ? 'games' : 'social');

/** first time you take part: the join reward and a passport stamp. Returns what was paid, or null if already counted. */
export function takePart(p: Profile, e: CampusEvent): Reward | null {
  const g = prog(p);
  if (g.done.includes(e.key + '#in')) return null;
  g.done.push(e.key + '#in');
  if (!g.joined[e.key]) g.joined[e.key] = Date.now();
  const st = stampOf(e.type);
  g.stamps[st] = (g.stamps[st] ?? 0) + 1;
  if (e.series) g.stamps[`s:${e.series.id}`] = (g.stamps[`s:${e.series.id}`] ?? 0) + 1;
  prune(p);
  return grant(p, e.rewards.join ?? {});
}

/** finished the activity: the completion reward, once */
export function complete(p: Profile, e: CampusEvent): Reward | null {
  takePart(p, e);
  const g = prog(p);
  if (g.done.includes(e.key)) return null;
  g.done.push(e.key);
  const r = grant(p, e.rewards.done ?? {});
  postActivity({ kind: 'event_done', text: `${p.name} completed ${e.name}`, ref: e.key });
  return r;
}

function prune(p: Profile) {
  const g = prog(p);
  const old = Date.now() - 90 * 86400e3;
  for (const [k, at] of Object.entries(g.joined)) if (at < old) delete g.joined[k];
  if (g.done.length > 600) g.done = g.done.slice(-400);
}

/** what a reward is, in words */
export function rewardText(r?: Reward) {
  if (!r) return '';
  const parts: string[] = [];
  if (r.coins) parts.push(`${r.coins.toLocaleString('en-GB')} coins`);
  if (r.diamonds) parts.push(`${r.diamonds} diamond${r.diamonds === 1 ? '' : 's'}`);
  if (r.xp) parts.push(`${r.xp} XP`);
  for (const id of r.items ?? []) parts.push(eventItem(id)?.name ?? id);
  return parts.join(' · ');
}
export const rewardValue = (e: CampusEvent) => {
  const r = e.rewards;
  const v = (x?: Reward) => (x?.coins ?? 0) + (x?.diamonds ?? 0) * 500 + (x?.xp ?? 0) + (x?.items?.length ?? 0) * 400;
  return v(r.done) + v(r.join) + v(r.winner) + v(r.top3) * 0.5;
};

/** the server's payouts (prize pools, refunds): added once each */
export async function collectServerRewards(p: Profile): Promise<string[]> {
  if (!cloud.account) return [];
  const rows = await srv.claimRewards();
  const lines: string[] = [];
  for (const r of rows) {
    grant(p, r);
    lines.push(`${r.reason}: ${rewardText(r)}`);
  }
  return lines;
}

// ---------- Event Passport ----------
export type StampId = 'treasure' | 'coinrush' | 'diamondrush' | 'photohunt' | 'explorer' | 'sunset' | 'night' | 'rain' | 'social' | 'party' | 'games' | 'hall' | 'festival';
export const STAMPS: { id: StampId; label: string; icon: string }[] = [
  { id: 'treasure', label: 'Treasure Hunt', icon: icons.diamond },
  { id: 'coinrush', label: 'Coin Rush', icon: icons.coin },
  { id: 'diamondrush', label: 'Diamond Rush', icon: icons.diamond },
  { id: 'photohunt', label: 'Photo Hunt', icon: icons.camera },
  { id: 'explorer', label: 'Explorer', icon: icons.compass },
  { id: 'sunset', label: 'Sunset Ride', icon: icons.sunrise },
  { id: 'night', label: 'Night Rush', icon: icons.moon },
  { id: 'rain', label: 'Rain Rush', icon: icons.rain },
  { id: 'social', label: 'Jam Night', icon: icons.music },
  { id: 'party', label: 'Party', icon: icons.sparkle },
  { id: 'games', label: 'Games Night', icon: icons.target },
  { id: 'hall', label: 'Hall Wars', icon: icons.pillars },
  { id: 'festival', label: 'Festival', icon: icons.star },
];

export interface Collection { id: string; name: string; need: { stamp: string; n: number }[]; reward: Reward; hint: string }
export const COLLECTIONS: Collection[] = [
  { id: 'treasure-hunter', name: 'Treasure Hunter', hint: 'Treasure Hunt, Coin Rush and Diamond Rush', need: [{ stamp: 'treasure', n: 1 }, { stamp: 'coinrush', n: 1 }, { stamp: 'diamondrush', n: 1 }], reward: { diamonds: 1, items: ['title-treasure-hunter'] } },
  { id: 'campus-explorer', name: 'Campus Explorer', hint: 'Photo Hunt, Explorer and a Sunset Ride', need: [{ stamp: 'photohunt', n: 1 }, { stamp: 'explorer', n: 1 }, { stamp: 'sunset', n: 1 }], reward: { coins: 500, items: ['title-campus-explorer'] } },
  { id: 'night-rider', name: 'Night Rider', hint: 'Three Night Rush events', need: [{ stamp: 'night', n: 3 }], reward: { coins: 400, items: ['title-night-rider'] } },
  { id: 'party', name: 'Life of the Party', hint: 'A jam, a party and a games night', need: [{ stamp: 'social', n: 1 }, { stamp: 'party', n: 1 }, { stamp: 'games', n: 1 }], reward: { coins: 400, items: ['title-life-of-the-party'] } },
  { id: 'hall-hero', name: 'Hall Hero', hint: 'Three Hall Wars events', need: [{ stamp: 'hall', n: 3 }], reward: { coins: 600, items: ['title-hall-hero'] } },
  { id: 'freshers', name: 'Freshers Champion', hint: 'Five days of one Freshers Week', need: [{ stamp: 's:freshers-*', n: 5 }], reward: { diamonds: 1, items: ['title-freshers-champion'] } },
  { id: 'full', name: 'Full Passport', hint: 'A stamp of every kind', need: STAMPS.map((s) => ({ stamp: s.id, n: 1 })), reward: { diamonds: 5, items: ['badge-passport-complete'] } },
];

const stampCount = (p: Profile, id: string) => {
  const s = prog(p).stamps;
  if (id.endsWith('*')) return Math.max(0, ...Object.entries(s).filter(([k]) => k.startsWith(id.slice(0, -1))).map(([, v]) => v));
  return s[id] ?? 0;
};
export const collectionProgress = (p: Profile, c: Collection) => {
  const got = c.need.filter((n) => stampCount(p, n.stamp) >= n.n).length;
  const one = c.need.length === 1 ? Math.min(stampCount(p, c.need[0].stamp), c.need[0].n) : got;
  const of = c.need.length === 1 ? c.need[0].n : c.need.length;
  return { got: one, of, ready: got === c.need.length, claimed: prog(p).claimed.includes(c.id) };
};
export function claimCollection(p: Profile, id: string): Reward | null {
  const c = COLLECTIONS.find((x) => x.id === id);
  if (!c) return null;
  const st = collectionProgress(p, c);
  if (!st.ready || st.claimed) return null;
  prog(p).claimed.push(c.id);
  postActivity({ kind: 'badge', text: `${p.name} completed the ${c.name} passport collection` });
  return grant(p, c.reward);
}
export const stamps = (p: Profile) => prog(p).stamps;
export const hallName = (id: string) => hallById(id).name;
export const typeLabel = (t: EventType) => TYPES[t].label;
