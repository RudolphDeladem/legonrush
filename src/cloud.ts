// Accounts and online features on Supabase: sign-in, progress synced between devices,
// race leaderboards and Hall Week standings. The client library loads only once someone
// signs in or opens a leaderboard, so guests never download it.
// Tables and rules live in supabase/schema.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from './state';
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
    const { data, error } = await (await sb()).auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/play/` } });
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
    const { error } = await (await sb()).auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/play/` });
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
  return {
    ...base,
    name: who.name, username: who.username, hall: who.hall, bike: who.bike, guest: false,
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
  };
}

// ---------- results: sent now, or kept until the phone is back online ----------

type Outgoing = { table: 'runs'; row: { route: string; time: number } } | { table: 'rides'; row: { hall: string; km: number } };

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
export function record(r: { hall: string; km: number; race?: { route: string; time: number } }) {
  if (!account) return;
  const items = readOutbox();
  if (r.km >= 0.05 && r.hall !== 'none') items.push({ table: 'rides', row: { hall: r.hall, km: Math.min(15, Math.round(r.km * 1000) / 1000) } });
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
