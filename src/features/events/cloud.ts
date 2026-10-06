// Events on the server (supabase/sql/10-events.sql): admin and community events, real join
// counts, registration with capacity, entry fees held in escrow, scores and leaderboards, and
// rewards the server pays out (prize pools, refunds). Public reads use plain fetch so riders who
// never sign in don't download the Supabase library. Everything returns null when the server
// can't be reached, and the screens say so.
import * as cloud from '../../cloud';
import { SUPABASE_KEY, SUPABASE_URL } from '../../cloud-config';
import type { Reward } from '../inventory';
import type { CampusEvent, EventRewards, EventType, RuleId } from './types';
import { TYPES } from './catalog';

const REST = `${SUPABASE_URL}/rest/v1`;

async function get<T>(path: string, ms = 6000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${REST}/${path}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: ctl.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function rpcAnon<T>(fn: string, args: Record<string, unknown>, ms = 6000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: ctl.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
/** signed-in calls (they need the rider's token) */
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: string | null }> {
  if (!cloud.account) return { data: null, error: 'signin' };
  try {
    const c = await cloud.realtimeClient();
    const { data, error } = await c.rpc(fn, args);
    if (error) return { data: null, error: error.message || 'error' };
    return { data: data as T, error: null };
  } catch {
    return { data: null, error: 'offline' };
  }
}

// ---------- events ----------
interface Row {
  id: string; source: 'admin' | 'community'; type: string; name: string; blurb: string | null; description: string | null; cover: string | null;
  host: string | null; owner_id: string | null; place: string; starts_at: string; ends_at: string; reg_deadline: string | null;
  capacity: number | null; fee: number; rewards: EventRewards | null; rules: string[] | null; time_limit: number | null;
  series_id: string | null; series_name: string | null; series_day: number | null; series_of: number | null;
  stops: string[] | null; spot: string | null; clues: string[] | null; status: string; created_at: string;
}

const asType = (t: string): EventType => (t in TYPES ? (t as EventType) : 'special');
function fromRow(r: Row): CampusEvent {
  const type = asType(r.type);
  return {
    key: `db:${r.id}`, source: r.source === 'admin' ? 'admin' : 'community', type, activity: TYPES[type].activity,
    name: r.name, blurb: r.blurb ?? '', description: r.description ?? '', cover: r.cover ?? TYPES[type].cover,
    host: r.host ?? (r.source === 'admin' ? 'LEGONRUSH' : 'A rider'), ownerId: r.owner_id ?? undefined, place: r.place,
    start: Date.parse(r.starts_at), end: Date.parse(r.ends_at), regDeadline: r.reg_deadline ? Date.parse(r.reg_deadline) : undefined,
    capacity: r.capacity, fee: Math.max(0, r.fee | 0), rewards: r.rewards ?? {}, rules: (r.rules ?? []) as RuleId[], timeLimit: r.time_limit ?? undefined,
    series: r.series_id ? { id: r.series_id, name: r.series_name ?? 'Series', day: r.series_day ?? 1, of: r.series_of ?? 1 } : undefined,
    stops: r.stops ?? undefined, spot: r.spot ?? undefined, clues: r.clues ?? undefined,
    cancelled: r.status === 'cancelled', createdAt: Date.parse(r.created_at),
  };
}

let serverCache: { at: number; list: CampusEvent[] | null } | null = null;
/** admin and community events from yesterday to two months ahead; null if the server can't be reached */
export async function serverEvents(force = false): Promise<CampusEvent[] | null> {
  if (!force && serverCache && Date.now() - serverCache.at < 60e3) return serverCache.list;
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const rows = await get<Row[]>(`events_public?select=*&ends_at=gte.${encodeURIComponent(since)}&order=starts_at.asc&limit=200`);
  const list = rows ? rows.map(fromRow) : null;
  serverCache = { at: Date.now(), list };
  return list;
}
export const cachedServerEvents = () => serverCache?.list ?? null;

/** real numbers of riders registered, by event key; empty when unknown */
export async function joinedCounts(keys: string[]): Promise<Record<string, number>> {
  if (!keys.length) return {};
  const rows = await rpcAnon<{ event_key: string; joined: number }[]>('event_counts', { p_keys: keys });
  const out: Record<string, number> = {};
  for (const r of rows ?? []) out[r.event_key] = Number(r.joined) || 0;
  return out;
}

const DEFAULT_PRICES = { small: 5000, medium: 15000, large: 30000, major: 75000 };
export type Size = keyof typeof DEFAULT_PRICES;
let prices: typeof DEFAULT_PRICES | null = null;
/** community event prices, set by admins in the config table (key "event_prices") */
export async function eventPrices() {
  if (prices) return prices;
  const rows = await get<{ value: Partial<typeof DEFAULT_PRICES> }[]>('config?select=value&key=eq.event_prices');
  const v = rows?.[0]?.value ?? {};
  const ok = (n: unknown, d: number) => (typeof n === 'number' && n >= 0 ? Math.round(n) : d);
  const p = { small: ok(v.small, DEFAULT_PRICES.small), medium: ok(v.medium, DEFAULT_PRICES.medium), large: ok(v.large, DEFAULT_PRICES.large), major: ok(v.major, DEFAULT_PRICES.major) };
  if (rows) prices = p;
  return p;
}
export const defaultPrices = () => ({ ...DEFAULT_PRICES });
/** size by capacity: small up to 25, medium up to 100, large up to 250, major beyond (or unlimited) */
export const sizeFor = (capacity: number | null): Size => (capacity === null ? 'major' : capacity <= 25 ? 'small' : capacity <= 100 ? 'medium' : capacity <= 250 ? 'large' : 'major');

let admin: { id: string; yes: boolean } | null = null;
/** whether the signed-in rider is a LEGONRUSH admin (is_admin() on the server) */
export async function isAdmin(): Promise<boolean> {
  if (!cloud.account) return false;
  if (admin?.id === cloud.account.id) return admin.yes;
  const { data, error } = await rpc<boolean>('is_admin');
  if (error) return false;
  admin = { id: cloud.account.id, yes: !!data };
  return admin.yes;
}

// ---------- registration ----------
export type JoinReply = { ok: true; paid: number; joined: number } | { ok: false; error: string };
const JOIN_ERRORS: Record<string, string> = {
  full: 'This event is full.',
  closed: 'Registration has closed.',
  cancelled: 'This event was cancelled.',
  signin: 'Sign in to join events with an entry fee.',
  offline: 'Can\'t reach LEGONRUSH right now. Check your connection and try again.',
  exists: 'You have already joined.',
};
export const joinError = (code: string) => JOIN_ERRORS[code] ?? 'Something went wrong. Try again.';

export async function register(key: string, who: { name: string; hall: string }): Promise<JoinReply> {
  const { data, error } = await rpc<{ ok: boolean; error?: string; paid?: number; joined?: number }>('register_event', { p_key: key, p_name: who.name.slice(0, 24), p_hall: who.hall });
  if (error) return { ok: false, error: /full|closed|cancelled|exists/.exec(error)?.[0] ?? (error === 'signin' || error === 'offline' ? error : 'error') };
  if (!data?.ok) return { ok: false, error: data?.error ?? 'error' };
  return { ok: true, paid: data.paid ?? 0, joined: data.joined ?? 0 };
}
export async function unregister(key: string) {
  const { error } = await rpc('leave_event', { p_key: key });
  return !error;
}

// ---------- creating ----------
export interface NewEvent {
  type: EventType; name: string; description: string; cover: string; host: string; place: string;
  starts_at: string; ends_at: string; reg_deadline: string; capacity: number | null; fee: number;
  rewards: EventRewards; rules: RuleId[]; time_limit: number | null; official: boolean; prize_topup: number;
  spot?: string; clues?: string[]; stops?: string[];
}
export async function createEvent(e: NewEvent): Promise<{ ok: true; id: string; cost: number } | { ok: false; error: string }> {
  const { data, error } = await rpc<{ id: string; cost: number }>('create_event', { p: e });
  if (error) return { ok: false, error: error === 'signin' ? 'Sign in to create events.' : error === 'offline' ? 'Can\'t reach LEGONRUSH right now. Nothing was charged.' : error.replace(/^.*?:\s*/, '') };
  return { ok: true, id: data!.id, cost: data!.cost };
}
export async function cancelEvent(id: string) {
  const { error } = await rpc('cancel_event', { p_id: id });
  return !error;
}

// ---------- scores ----------
export interface ScoreRow { name: string; hall: string; score: number; me?: boolean }
export async function submitScore(key: string, game: string, score: number) {
  await rpc('submit_event_score', { p_key: key, p_game: game, p_score: Math.round(score) });
}
export async function leaderboard(key: string, game: string): Promise<ScoreRow[] | null> {
  const rows = await get<{ name: string; hall: string; score: number; user_id: string }[]>(`event_results?select=name,hall,score,user_id&event_key=eq.${encodeURIComponent(key)}&game=eq.${encodeURIComponent(game)}&order=score.desc&limit=20`);
  return rows ? rows.map((r) => ({ name: r.name, hall: r.hall, score: Number(r.score), me: r.user_id === cloud.account?.id })) : null;
}

// ---------- rewards the server pays (prize pools, refunds) ----------
export interface ServerReward extends Reward { reason: string; event_key: string }
export async function claimRewards(): Promise<ServerReward[]> {
  const { data } = await rpc<{ coins: number; xp: number; diamonds: number; items: string[] | null; reason: string; event_key: string }[]>('claim_event_rewards');
  return (data ?? []).map((r) => ({ coins: r.coins || 0, xp: r.xp || 0, diamonds: r.diamonds || 0, items: r.items ?? [], reason: r.reason, event_key: r.event_key }));
}

// ---------- safety ----------
export async function reportRider(r: { eventKey: string; who: string; name: string; reason: string; lines: string[] }) {
  await rpc('report_event_rider', { p_key: r.eventKey, p_who: r.who, p_name: r.name, p_reason: r.reason, p_lines: r.lines.slice(-20) });
}
