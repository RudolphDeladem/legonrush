// Everything the screens list: official challenges, the server's player challenges, and the ones on
// this phone. Joining and leaving (coins, reminders), prize payouts, and the map pins.
import { H, esc, fmt } from '../host';
import { icons } from '../../ui/icons';
import { grant, spend } from '../inventory';
import { cancelReminder, remind } from '../notify';
import { registerPinSource } from '../pins';
import * as api from './api';
import { chRoute, officialSchedule, phaseOf, timeText, dayDiff, type Challenge } from './model';

let officialCache: { at: number; list: Challenge[] } | null = null;
function officials() {
  // the schedule changes at most once a minute (days roll over)
  const now = Date.now();
  if (!officialCache || now - officialCache.at > 60e3) officialCache = { at: now, list: officialSchedule(now) };
  return officialCache.list;
}

/** every challenge this rider can see, newest server info first */
export function all(): Challenge[] {
  const s = api.local();
  const byId = new Map<string, Challenge>();
  for (const c of officials()) byId.set(c.id, c);
  for (const m of Object.values(s.mine)) if (!byId.has(m.id) || !m.snap.official) byId.set(m.id, m.snap);
  for (const c of s.cache) {
    const base = byId.get(c.id);
    byId.set(c.id, base?.official ? { ...base, riders: c.riders, joined: c.joined, status: c.status } : c);
  }
  return [...byId.values()].map((c) => (s.mine[c.id] && !c.joined ? { ...c, joined: true } : c));
}
export const find = (id: string) => all().find((c) => c.id === id) ?? null;
export const joined = (c: Challenge) => !!c.joined || !!api.mine(c.id);
export const isCreator = (c: Challenge) => !!c.creator && c.creator.id === H().myId();

let loading: Promise<void> | null = null;
let lastLoad = 0;
/** fetches the server's list (at most every 20 s), settles finished ones and pays prizes */
export function refresh(force = false): Promise<void> {
  if (!api.online()) return Promise.resolve();
  if (loading) return loading;
  if (!force && Date.now() - lastLoad < 20e3) return Promise.resolve();
  lastLoad = Date.now();
  loading = (async () => {
    await api.feed();
    await api.loadConfig();
    // anyone can close a challenge that has ended; the server pays the prizes once
    for (const c of all()) if (!c.official && joined(c) && c.status !== 'ended' && c.status !== 'cancelled' && Date.now() > c.endsAt) await api.settle(c.id);
    await collect();
  })().finally(() => { loading = null; });
  return loading;
}

/** prizes and refunds waiting on the server: added to this rider's coins once */
export async function collect() {
  const r = await api.claim();
  if (!r.ok || !r.data.length) return;
  const p = H().profile();
  for (const x of r.data) {
    grant(p, { coins: x.coins });
    H().toast(x.kind === 'prize'
      ? `${icons.trophy} <b>You won ${fmt(x.coins)} coins</b> in ${esc(x.name)}${x.place ? ` (${x.place === 1 ? '1st' : x.place === 2 ? '2nd' : x.place === 3 ? '3rd' : `${x.place}th`} place)` : ''}`
      : `${icons.coin} <b>${fmt(x.coins)} coins refunded</b> from ${esc(x.name)}`);
  }
}

export type JoinResult = { ok: true } | { ok: false; message: string };

/** registers for a challenge: pays the entry fee, remembers it and sets the reminders */
export async function joinChallenge(c: Challenge): Promise<JoinResult> {
  const p = H().profile();
  const s = api.local();
  if (!c.official && !api.online()) return { ok: false, message: 'Sign in to join rider challenges.' };
  if (c.entryFee > p.coins) return { ok: false, message: `You need ${fmt(c.entryFee)} coins to join. Your balance: ${fmt(p.coins)}.` };
  let paid = 0;
  if (api.online()) {
    if (c.official) await api.ensureOfficial(c);
    // the coins leave first; if the server says no, they come straight back
    if (c.entryFee > 0 && !spend(p, { coins: c.entryFee })) return { ok: false, message: 'Not enough coins.' };
    const r = await api.join(c.id);
    if (!r.ok) {
      if (c.entryFee > 0) grant(p, { coins: c.entryFee });
      // official challenges still work on this phone
      if (!c.official) return { ok: false, message: r.message };
    } else paid = c.entryFee;
  }
  s.mine[c.id] = { ...(s.mine[c.id] ?? { attempts: 0 }), id: c.id, joinedAt: Date.now(), paid, snap: { ...c, joined: true, riders: c.riders + 1 } };
  s.cache = s.cache.map((x) => (x.id === c.id ? { ...x, joined: true, riders: x.riders + 1 } : x));
  api.saveLocal();
  setReminders(c);
  return { ok: true };
}

export async function leaveChallenge(c: Challenge): Promise<JoinResult> {
  const s = api.local();
  if (api.online() && !c.official) {
    const r = await api.leave(c.id);
    if (!r.ok) return { ok: false, message: r.message };
    if (r.data.refund > 0) grant(H().profile(), { coins: r.data.refund });
  }
  delete s.mine[c.id];
  s.cache = s.cache.map((x) => (x.id === c.id ? { ...x, joined: false, riders: Math.max(0, x.riders - 1) } : x));
  api.saveLocal();
  cancelReminder(`chal:${c.id}`);
  return { ok: true };
}

/** tomorrow / 30 minutes / starting now: only for things that start later */
export function setReminders(c: Challenge) {
  cancelReminder(`chal:${c.id}`);
  if (!api.local().remind) return;
  const now = Date.now();
  const route = chRoute(c.route)?.name ?? '';
  const at = timeText(c.startsAt);
  const day = c.startsAt - 24 * 3600e3;
  if (day > now + 3600e3 && dayDiff(c.startsAt, day) === 1) remind({ id: `chal:${c.id}:day`, title: `${c.name} starts tomorrow at ${at}`, body: `${route}. You're registered.`, at: day, tab: 'challenges' });
  if (c.startsAt - 30 * 60e3 > now) remind({ id: `chal:${c.id}:30`, title: `${c.name} starts in 30 minutes`, body: c.format === 'live_race' ? 'Be in the lobby before the start.' : `${route}.`, at: c.startsAt - 30 * 60e3, tab: 'challenges' });
  if (c.startsAt > now) remind({ id: `chal:${c.id}:now`, title: 'Your challenge is starting now!', body: c.name, at: c.startsAt, tab: 'challenges' });
}
export function setRemindersOn(on: boolean) {
  const s = api.local();
  s.remind = on;
  api.saveLocal();
  for (const m of Object.values(s.mine)) on ? setReminders(m.snap) : cancelReminder(`chal:${m.id}`);
}

// the map: live races and anything starting within a few hours, at the route's start line
let openDetail: ((c: Challenge) => void) | null = null;
export const setPinOpener = (fn: (c: Challenge) => void) => (openDetail = fn);
registerPinSource('challenges', () => {
  const now = Date.now();
  return all()
    .filter((c) => {
      const ph = phaseOf(c, now);
      // all-day official time trials would cover the map; show races, player challenges and my own
      const busy = c.official && c.format !== 'live_race' && !joined(c);
      return !busy && (ph === 'live' || (ph === 'soon' || (ph === 'upcoming' && c.startsAt - now < 6 * 3600e3))) && (joined(c) || c.access === 'open' || c.access === 'hall');
    })
    .slice(0, 12)
    .map((c) => ({
      id: `challenge:${c.id}`,
      kind: 'challenge' as const,
      place: chRoute(c.route)?.start,
      title: c.name,
      sub: phaseOf(c, now) === 'live' ? 'Live now' : `Starts ${timeText(c.startsAt)}`,
      live: phaseOf(c, now) === 'live',
      open: () => openDetail?.(c),
    }));
});
