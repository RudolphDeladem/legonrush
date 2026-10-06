// Accounts and online features on Supabase: sign-in, progress synced between devices,
// race leaderboards and Hall Week standings. The client library loads only once someone
// signs in or opens a leaderboard, so guests never download it.
// Tables and rules live in supabase/schema.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { newGarage, newGear, normalizeProfile, type Gear, type GarageSave, type Profile } from './state';
import { SUPABASE_KEY, SUPABASE_REF, SUPABASE_URL, weekStart } from './cloud-config';

const AUTH_KEY = `sb-${SUPABASE_REF}-auth-token`;
const OUTBOX_KEY = 'legonrush.outbox.v1';

export interface Account {
  id: string;
  email: string;
}

export let account: Account | null = null;

let client: Promise<SupabaseClient> | null = null;
function sb() {
  return (client ??= import('@supabase/supabase-js').then((m) =>
    m.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  ));
}

/** the shared client, for live channels */
export const realtimeClient = sb;

const hasStoredSession = () => {
  try {
    return !!localStorage.getItem(AUTH_KEY);
  } catch {
    return false;
  }
};

/** Restores a saved sign-in (or one arriving from an email link) without loading the library for guests. */
export async function restore(onChange: () => void) {
  const fromEmail = /access_token=|type=(signup|recovery|magiclink)/.test(location.hash);
  if (!hasStoredSession() && !fromEmail) return;
  try {
    const c = await sb();
    const { data } = await c.auth.getSession();
    setAccount(data.session?.user);
    c.auth.onAuthStateChange((_e, s) => {
      const before = account?.id;
      setAccount(s?.user);
      if (account?.id !== before) onChange();
    });
    if (fromEmail) history.replaceState(null, '', location.pathname + location.search);
    if (account) flush();
  } catch {
    /* offline: try again next launch */
  }
}

function setAccount(u: { id: string; email?: string } | undefined | null) {
  account = u ? { id: u.id, email: u.email ?? '' } : null;
}

/** Turns Supabase's messages into plain words for the sign-in screen. */
function friendly(message: string) {
  if (/invalid login/i.test(message)) return 'That email and password don\'t match.';
  if (/already registered/i.test(message)) return 'That email already has an account. Sign in instead.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you.';
  if (/password should be/i.test(message)) return 'Use a password of at least 6 characters.';
  if (/rate limit/i.test(message)) return 'Too many tries. Wait a few minutes and try again.';
  if (/fetch|network/i.test(message)) return 'No connection. Check your data or Wi-Fi.';
  return message;
}

export type AuthResult = { ok: true } | { ok: false; error: string } | { ok: 'confirm' };

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await (await sb()).auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: friendly(error.message) };
    setAccount(data.user);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(String(e)) };
  }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await (await sb()).auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}play/` } });
    if (error) return { ok: false, error: friendly(error.message) };
    if (!data.session) return { ok: 'confirm' };
    setAccount(data.user);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(String(e)) };
  }
}

export async function resetPassword(email: string): Promise<AuthResult> {
  try {
    const { error } = await (await sb()).auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${import.meta.env.BASE_URL}play/` });
    return error ? { ok: false, error: friendly(error.message) } : { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(String(e)) };
  }
}

/** after a password-reset link: set the new password */
export async function setPassword(password: string): Promise<AuthResult> {
  try {
    const { error } = await (await sb()).auth.updateUser({ password });
    return error ? { ok: false, error: friendly(error.message) } : { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(String(e)) };
  }
}

export const cameFromReset = () => /type=recovery/.test(location.hash);

export async function signOut() {
  try {
    await (await sb()).auth.signOut();
  } catch {
    /* the local session is cleared either way */
  }
  account = null;
}

// ---------- progress ----------

/** the account's saved progress, or null if it has none yet */
export async function pull(): Promise<Profile | null> {
  if (!account) return null;
  const { data, error } = await (await sb()).from('saves').select('data').eq('id', account.id).maybeSingle();
  if (error) throw error;
  return (data?.data as Profile) ?? null;
}

let pushTimer = 0;
/** Saves progress to the account a moment after the last change. */
export function push(p: Profile) {
  if (!account) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void pushNow(p), 1500);
}

async function pushNow(p: Profile) {
  if (!account) return;
  try {
    const c = await sb();
    const id = account.id;
    const card = {
      id,
      name: p.name.slice(0, 18) || 'Rider',
      username: /^[A-Za-z0-9_.]{2,20}$/.test(p.username) ? p.username : null,
      hall: p.hall,
      bike: p.bike,
      department: p.department || null,
      snap: p.snapPublic && /^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(p.snap) ? p.snap : null,
      gender: p.gender,
      look: p.look,
      xp: Math.round(p.xp),
      km: Math.round(p.totalDistance / 10) / 100,
      updated_at: new Date().toISOString(),
    };
    let r = await c.from('profiles').upsert(card);
    // someone else has that username: keep the account working without it
    if (r.error?.code === '23505') r = await c.from('profiles').upsert({ ...card, username: null });
    await c.from('saves').upsert({ id, data: p, updated_at: card.updated_at });
    flush();
  } catch {
    /* offline: the next change or launch tries again */
  }
}

const union = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])];
const maxEach = <T extends Record<string, number | undefined>>(a: T = {} as T, b: T = {} as T) => {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  return out as T;
};

/** shop gear: the most of each item, every cosmetic owned on either side, and what the newer rider has fitted */
function mergeGear(local: Profile, remote: Profile, base: Profile): Gear {
  const l = { ...newGear(), ...local.gear }, r = { ...newGear(), ...remote.gear }, fitted = base === local ? l : r;
  return {
    ...fitted,
    helmets: Math.max(l.helmets, r.helmets), brakes: Math.max(l.brakes, r.brakes),
    repairKits: Math.max(l.repairKits, r.repairKits), energy: Math.max(l.energy, r.energy),
    upgrades: maxEach(l.upgrades, r.upgrades),
    paints: union(l.paints, r.paints), bells: union(l.bells, r.bells), lights: union(l.lights, r.lights), jerseys: union(l.jerseys, r.jerseys),
  };
}

/** challenges, badges, places, favourites, missions and the treasure hunt */
function mergeFeatures(local: Profile, remote: Profile) {
  const later = <K extends 'weekly' | 'treasure' | 'dailyStreak'>(k: K, id: (p: Profile) => string, both: (a: Profile[K], b: Profile[K]) => Profile[K]) => {
    const a = local[k], b = remote[k];
    if (!a || !b) return (a ?? b)!;
    return id(local) === id(remote) ? both(a, b) : id(local) > id(remote) ? a : b;
  };
  const missionBest = { ...(local.missionBest ?? {}) };
  for (const [k, t] of Object.entries(remote.missionBest ?? {})) missionBest[k] = Math.min(t, missionBest[k] ?? Infinity);
  return {
    weekly: later('weekly', (p) => p.weekly?.id ?? '', (a, b) => ({ id: a.id, n: maxEach(a.n, b.n), claimed: union(a.claimed, b.claimed) })),
    treasure: later('treasure', (p) => p.treasure?.week ?? '', (a, b) => ({ week: a.week, found: Math.max(a.found, b.found), claimed: a.claimed || b.claimed })),
    dailyStreak: later('dailyStreak', (p) => p.dailyStreak?.last ?? '', (a, b) => (a.count >= b.count ? a : b)),
    stats: maxEach(local.stats, remote.stats),
    badges: union(local.badges, remote.badges),
    visited: union(local.visited, remote.visited),
    favourites: union(local.favourites, remote.favourites),
    missionBest,
    diamonds: Math.max(local.diamonds ?? 0, remote.diamonds ?? 0),
    items: maxEach(local.items ?? {}, remote.items ?? {}),
    garage: mergeGarage(local.garage, remote.garage),
    // Events system: everything joined, finished, stamped or claimed on either device
    events: {
      joined: maxEach(local.events?.joined, remote.events?.joined),
      done: union(local.events?.done, remote.events?.done),
      stamps: maxEach(local.events?.stamps, remote.events?.stamps),
      claimed: union(local.events?.claimed, remote.events?.claimed),
    },
    // Map: discoveries rewarded and collection rewards claimed (union, so nothing is paid twice)
    mapDex: { seen: union(local.mapDex?.seen, remote.mapDex?.seen), claimed: union(local.mapDex?.claimed, remote.mapDex?.claimed) },
  };
}

/** Garage & Store: the newer device's looks, parts and loadouts; the best of both for everything earned */
function mergeGarage(a?: GarageSave, b?: GarageSave): GarageSave {
  if (!a || !b) return (a ?? b ?? newGarage());
  const newer = (a.at ?? 0) >= (b.at ?? 0) ? a : b;
  return {
    ...newer,
    levels: maxEach(a.levels, b.levels),
    wishlist: union(a.wishlist, b.wishlist),
    hallWeeks: union(a.hallWeeks, b.hallWeeks),
    daily: (a.daily ?? '') > (b.daily ?? '') ? a.daily : b.daily,
    starter: !!(a.starter || b.starter),
    v: Math.max(a.v ?? 0, b.v ?? 0),
  };
}

/** Combines this device's progress with the account's, keeping the best of both. */
export function merge(local: Profile, remote: Profile): Profile {
  const base = remote.xp >= local.xp ? remote : local;
  const bestTimes = { ...local.bestTimes };
  for (const [k, t] of Object.entries(remote.bestTimes ?? {})) bestTimes[k] = Math.min(t, bestTimes[k] ?? Infinity);
  const sameWeek = local.week?.id === remote.week?.id;
  const week = sameWeek
    ? { id: local.week.id, km: Math.max(local.week.km, remote.week.km), claimed: local.week.claimed || remote.week.claimed }
    : (local.week?.id ?? '') > (remote.week?.id ?? '') ? local.week : remote.week;
  const daily = (local.lastDaily ?? '') > (remote.lastDaily ?? '') ? local : remote;
  // the account's rider (name, hall, bike) wins unless it never made one
  const who = remote.guest ? local : remote;
  return normalizeProfile({
    ...base,
    name: who.name, username: who.username, hall: who.hall, bike: who.bike, guest: false,
    gender: who.gender ?? local.gender, department: who.department ?? local.department ?? '',
    snap: who.snap ?? '', snapPublic: who.snapPublic ?? true, look: { ...local.look, ...who.look },
    about: { ...local.about, ...who.about },
    gear: mergeGear(local, remote, base),
    ...mergeFeatures(local, remote),
    xp: Math.max(local.xp, remote.xp),
    rides: Math.max(local.rides, remote.rides),
    finishes: Math.max(local.finishes, remote.finishes),
    totalDistance: Math.max(local.totalDistance, remote.totalDistance),
    bestScore: Math.max(local.bestScore, remote.bestScore),
    bestDistance: Math.max(local.bestDistance, remote.bestDistance),
    bestTimes,
    tutorialDone: local.tutorialDone || remote.tutorialDone,
    ownedBikes: [...new Set([...(local.ownedBikes ?? []), ...(remote.ownedBikes ?? [])])],
    lastDaily: daily.lastDaily, streak: daily.streak,
    week,
  });
}

// ---------- results: sent now, or kept until the phone is back online ----------

type Outgoing = { table: 'runs'; row: { route: string; time: number } } | { table: 'rides'; row: { hall: string; department: string | null; km: number } };

function readOutbox(): Outgoing[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeOutbox(items: Outgoing[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-200)));
  } catch {
    /* storage full: drop them */
  }
}

/** Records a ride for Hall Week, and a finished race for the leaderboard. */
export function record(r: { hall: string; department: string; km: number; race?: { route: string; time: number } }) {
  if (!account) return;
  const items = readOutbox();
  if (r.km >= 0.05 && r.hall !== 'none') items.push({ table: 'rides', row: { hall: r.hall, department: r.department || null, km: Math.min(15, Math.round(r.km * 1000) / 1000) } });
  if (r.race) items.push({ table: 'runs', row: { route: r.race.route, time: Math.round(r.race.time * 100) / 100 } });
  writeOutbox(items);
  flush();
}

let flushing = false;
export async function flush() {
  if (!account || flushing) return;
  flushing = true;
  try {
    const c = await sb();
    let items = readOutbox();
    while (items.length) {
      const { error } = await c.from(items[0].table).insert(items[0].row as Record<string, unknown>);
      // a rule rejected it (say, an impossible time): drop it rather than retry forever
      if (error && !/^(22|23|42)/.test(error.code ?? '')) break;
      items = items.slice(1);
      writeOutbox(items);
    }
  } catch {
    /* offline */
  } finally {
    flushing = false;
  }
}
addEventListener('online', () => void flush());

// ---------- boards ----------

export interface BoardRow {
  name: string;
  username: string | null;
  hall: string;
  department: string | null;
  snap: string | null;
  best: number;
  me: boolean;
}

export async function leaderboard(route: string): Promise<BoardRow[]> {
  const { data, error } = await (await sb()).rpc('leaderboard', { p_route: route, p_limit: 20 });
  if (error) throw error;
  return (data ?? []).map((r: BoardRow) => ({ ...r, best: Number(r.best) }));
}

export interface HallRow {
  hall: string;
  km: number;
  riders: number;
}

/** kilometres per hall since Monday */
export async function hallStandings(): Promise<HallRow[]> {
  const { data, error } = await (await sb()).rpc('hall_standings', { p_since: weekStart().toISOString() });
  if (error) throw error;
  return (data ?? []).map((r: HallRow) => ({ hall: r.hall, km: Number(r.km), riders: Number(r.riders) }));
}

export interface DeptRow {
  department: string;
  km: number;
  riders: number;
}

/** kilometres per department since Monday */
export async function departmentStandings(): Promise<DeptRow[]> {
  const { data, error } = await (await sb()).rpc('department_standings', { p_since: weekStart().toISOString() });
  if (error) throw error;
  return (data ?? []).map((r: DeptRow) => ({ department: r.department, km: Number(r.km), riders: Number(r.riders) }));
}

// ---------- riders and invites ----------

export interface RiderCard {
  id: string;
  name: string;
  username: string | null;
  hall: string;
  department: string | null;
  snap: string | null;
}

/** riders whose username or Snapchat starts with the text */
export async function findRiders(q: string): Promise<RiderCard[]> {
  const t = q.replace(/^@/, '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (t.length < 2) return [];
  const { data, error } = await (await sb())
    .from('profiles')
    .select('id, name, username, hall, department, snap')
    .or(`username.ilike.${t}%,snap.ilike.${t}%`)
    .limit(8);
  if (error) throw error;
  return (data ?? []).filter((r: RiderCard) => r.id !== account?.id);
}

export interface Invite {
  id: number;
  code: string;
  from: { id: string; name: string; hall: string };
  at: string;
}

/** Leaves an invite for a rider, so they see it next time they open the game. */
export async function sendInvite(toId: string, code: string) {
  if (!account) return false;
  const { error } = await (await sb()).from('invites').insert({ to_id: toId, code });
  return !error;
}

/** invites from the last two hours you haven't answered */
export async function pendingInvites(): Promise<Invite[]> {
  if (!account) return [];
  const since = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data, error } = await (await sb())
    .from('invites')
    .select('id, code, created_at, from:profiles!invites_from_id_fkey(id, name, hall)')
    .eq('to_id', account.id)
    .eq('seen', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, code: r.code, at: r.created_at, from: r.from }));
}

export async function answerInvite(id: number) {
  try {
    await (await sb()).from('invites').update({ seen: true }).eq('id', id);
  } catch {
    /* offline: it expires on its own */
  }
}
