// Race Challenges on the server (supabase/sql/20-challenges.sql), plus what this phone remembers.
// Player challenges, entries, invitations, results and prize payouts live on the server; every
// write goes through a security-definer function there. Official challenges are made by code
// (model.ts) and work for everyone, with results posted when the rider is signed in.
// In development, ?chmock runs the same calls against a pretend server in localStorage.
import * as cloud from '../../cloud';
import { FUNCTIONS_URL, SUPABASE_KEY } from '../../cloud-config';
import { levelFor } from '../../state';
import { H } from '../host';
import type { GhostRun } from '../../game/Game';
import { DEFAULT_CONFIG, ROUTE_LENGTH, chRoute, newChallengeCode, officialById, prizeSplit, type Challenge, type ChallengeConfig, type Format, type Access } from './model';

export interface Entry { id: string; name: string; username?: string | null; hall: string; bike: string; level: number; joinedAt: number; me: boolean }
export interface BoardRow { rank: number; id: string; name: string; username?: string | null; hall: string; best: number; attempts: number; me: boolean }
export interface Stats { participants: number; finishers: number; average: number | null; fastest: number | null }
export interface Payout { challenge: string; name: string; coins: number; kind: 'prize' | 'refund'; place?: number | null }
export interface Report { id: number; challenge: string; name: string; reason: string; by: string; at: number; creator: string | null }
export interface NewChallenge {
  name: string; description: string; route: string; format: Format; attempts: number; access: Access; hall?: string | null;
  maxRiders: number; entryFee: number; prize: string; startsAt: number; regClosesAt: number; endsAt: number; startNow: boolean;
  ghost?: { name: string; time: number; run: GhostRun } | null;
}
export interface Submitted { accepted: boolean; reason?: string; place?: number; riders?: number }

export type Res<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
const ok = <T>(data: T): Res<T> => ({ ok: true, data });
const no = (code: string, message: string): Res<never> => ({ ok: false, code, message });
const OFFLINE = no('offline', "Couldn't reach LEGONRUSH. Check your connection and try again.");

// ---------- which server ----------

const MOCK = import.meta.env.DEV && (new URLSearchParams(location.search).has('chmock') || sessionStorage.getItem('legonrush.chmock') === '1');
if (MOCK) sessionStorage.setItem('legonrush.chmock', '1');

/** player challenges need an account (and a connection) */
export const online = () => MOCK || !!cloud.account;
export const isMock = () => MOCK;

// ---------- this phone ----------

export interface Mine {
  id: string;
  joinedAt: number;
  /** rides that counted */
  attempts: number;
  best?: number;
  /** the best before the latest one, for "previous → new" */
  prev?: number;
  /** coins paid to join (refunded if the challenge is cancelled) */
  paid: number;
  /** the official first-finish bonus was given */
  bonus?: boolean;
  /** latest server answer for the board place */
  place?: number;
  /** a copy so My challenges works offline */
  snap: Challenge;
}
interface Store { v: 1; mine: Record<string, Mine>; remind: boolean; cache: Challenge[]; cacheAt: number; config: ChallengeConfig; seen: string[] }
const KEY = 'legonrush.challenges.v1';
let store: Store | null = null;
export function local(): Store {
  if (store) return store;
  try { store = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { store = null; }
  if (!store || store.v !== 1) store = { v: 1, mine: {}, remind: true, cache: [], cacheAt: 0, config: DEFAULT_CONFIG, seen: [] };
  store.config = { ...DEFAULT_CONFIG, ...store.config };
  store.seen ??= [];
  return store;
}
export function saveLocal() {
  const s = local();
  // forget finished challenges after a month
  const old = Date.now() - 30 * 86400e3;
  for (const [id, m] of Object.entries(s.mine)) if (m.snap.endsAt < old) delete s.mine[id];
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full: kept for this session */ }
}
export const mine = (id: string) => local().mine[id];

// ---------- the calls ----------

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Res<T>> {
  if (MOCK) return mock(fn, args) as Res<T>;
  if (!cloud.account) return no('sign_in', 'Sign in to use rider challenges.');
  try {
    const { data, error } = await (await cloud.realtimeClient()).rpc(fn, args);
    if (error) {
      // the database answers in words for the rider: "raise exception 'full: This challenge is full.'"
      const m = /^([a-z_]+): (.*)$/.exec(error.message ?? '');
      return m ? no(m[1], m[2]) : error.code === 'PGRST202' ? no('not_ready', 'Rider challenges are coming soon.') : OFFLINE;
    }
    return ok(data as T);
  } catch {
    return OFFLINE;
  }
}

const toMs = (v: unknown) => (typeof v === 'number' ? v : v ? Date.parse(String(v)) : 0);
/** a challenge row from the database (snake_case, timestamps) */
export function fromRow(r: any): Challenge {
  const off = String(r.id).startsWith('off-') ? officialById(String(r.id)) : null;
  if (off) return { ...off, riders: Number(r.riders ?? 0), joined: !!r.joined, status: r.status ?? off.status };
  return {
    id: String(r.id), code: r.code ?? '', official: false, name: r.name, description: r.description ?? '',
    creator: r.creator_id ? { id: r.creator_id, name: r.creator_name ?? 'Rider', username: r.creator_username ?? null, hall: r.creator_hall ?? null } : null,
    route: r.route, format: r.format, attempts: Number(r.attempts ?? 1), access: r.access, hall: r.hall ?? null,
    maxRiders: Number(r.max_riders), entryFee: Number(r.entry_fee ?? 0), prize: r.prize ?? 'top3',
    startsAt: toMs(r.starts_at), regClosesAt: toMs(r.reg_closes_at), endsAt: toMs(r.ends_at), startNow: !!r.start_now,
    status: r.status, riders: Number(r.riders ?? 0), createdAt: toMs(r.created_at), ghost: r.ghost ?? null,
    joined: !!r.joined, invited: r.invite_status ? { from: r.invite_from ?? 'A rider', status: r.invite_status } : null,
  };
}
const toRow = (c: NewChallenge) => ({
  name: c.name, description: c.description, route: c.route, format: c.format, attempts: c.attempts, access: c.access, hall: c.hall ?? null,
  max_riders: c.maxRiders, entry_fee: c.entryFee, prize: c.prize, starts_at: new Date(c.startsAt).toISOString(),
  reg_closes_at: new Date(c.regClosesAt).toISOString(), ends_at: new Date(c.endsAt).toISOString(), start_now: c.startNow, ghost: c.ghost ?? null,
});

/** player challenges this rider can see: open ones, their own, ones they joined or were invited to */
export async function feed(): Promise<Res<Challenge[]>> {
  const r = await rpc<any[]>('challenge_feed');
  if (!r.ok) return r;
  const list = (r.data ?? []).map(fromRow);
  const s = local();
  s.cache = list;
  s.cacheAt = Date.now();
  // keep my copies fresh
  for (const c of list) if (s.mine[c.id]) s.mine[c.id].snap = c;
  saveLocal();
  return ok(list);
}
export const byCode = async (code: string) => { const r = await rpc<any>('challenge_by_code', { p_code: code }); return r.ok ? ok(r.data ? fromRow(r.data) : null) : r; };
export const getOne = async (id: string) => { const r = await rpc<any>('challenge_get', { p_id: id }); return r.ok ? ok(r.data ? fromRow(r.data) : null) : r; };
export const create = async (c: NewChallenge) => { const r = await rpc<any>('challenge_create', { p: toRow(c) }); return r.ok ? ok(fromRow(r.data)) : r; };
export const update = async (id: string, c: NewChallenge) => { const r = await rpc<any>('challenge_update', { p_id: id, p: toRow(c) }); return r.ok ? ok(fromRow(r.data)) : r; };
/** official challenges get a server row the first time someone joins or rides one */
export const ensureOfficial = (c: Challenge) => rpc<null>('challenge_official', { p_id: c.id, p_route: c.route, p_format: c.format, p_attempts: c.attempts, p_starts: new Date(c.startsAt).toISOString(), p_ends: new Date(c.endsAt).toISOString() });
export const join = (id: string) => rpc<{ fee: number }>('challenge_join', { p_id: id });
export const leave = (id: string) => rpc<{ refund: number }>('challenge_leave', { p_id: id });
export const invite = (id: string, usernames: string[]) => rpc<number>('challenge_invite', { p_id: id, p_usernames: usernames });
export const answerInvite = (id: string, accept: boolean) => rpc<null>('challenge_answer_invite', { p_id: id, p_accept: accept });
export const closeRegistration = (id: string) => rpc<null>('challenge_close_registration', { p_id: id });
export const cancel = (id: string) => rpc<{ refunded: number }>('challenge_cancel', { p_id: id });
export const startNow = (id: string) => rpc<null>('challenge_start_now', { p_id: id });
export const settle = (id: string) => rpc<{ settled: boolean }>('challenge_settle', { p_id: id });
export const report = (id: string, reason: string) => rpc<null>('challenge_report', { p_id: id, p_reason: reason });
export async function entries(id: string): Promise<Res<Entry[]>> {
  const r = await rpc<any[]>('challenge_entries', { p_id: id });
  if (!r.ok) return r;
  const me = H().myId();
  return ok((r.data ?? []).map((e) => ({ id: e.user_id, name: e.name, username: e.username, hall: e.hall, bike: e.bike, level: levelFor(Number(e.xp ?? 0)), joinedAt: toMs(e.joined_at), me: e.user_id === me || !!e.me })));
}
export async function board(id: string): Promise<Res<BoardRow[]>> {
  const r = await rpc<any[]>('challenge_board', { p_id: id });
  if (!r.ok) return r;
  return ok((r.data ?? []).map((b) => ({ rank: Number(b.rank), id: b.user_id, name: b.name, username: b.username, hall: b.hall, best: Number(b.best), attempts: Number(b.attempts), me: !!b.me })));
}
export async function stats(id: string): Promise<Res<Stats>> {
  const r = await rpc<any>('challenge_stats', { p_id: id });
  if (!r.ok) return r;
  const d = r.data ?? {};
  return ok({ participants: Number(d.participants ?? 0), finishers: Number(d.finishers ?? 0), average: d.average == null ? null : Number(d.average), fastest: d.fastest == null ? null : Number(d.fastest) });
}
/** prizes and refunds waiting for this rider: added to their coins once */
export async function claim(): Promise<Res<Payout[]>> {
  const r = await rpc<any[]>('challenge_claim');
  if (!r.ok) return r;
  return ok((r.data ?? []).map((p) => ({ challenge: p.challenge_id, name: p.name ?? 'a challenge', coins: Number(p.coins), kind: p.kind, place: p.place })));
}

/** an attempt ticket: the server notes the start time, and counts attempts */
export const startAttempt = (id: string) => rpc<string>('challenge_start_attempt', { p_id: id });

/**
 * A finished ride. Free challenges post through the database (time sanity checks); paid ones go
 * through the challenge-submit Edge Function, which checks the whole ride recording like the prize race.
 */
export async function submit(c: Challenge, ticket: string, r: { time: number; finished: boolean; trace: GhostRun }): Promise<Res<Submitted>> {
  if (MOCK) return mock('challenge_submit', { p_attempt: ticket, p_time: r.time, p_finished: r.finished, p_challenge: c.id }) as Res<Submitted>;
  if (c.entryFee <= 0) return rpc<Submitted>('challenge_submit', { p_attempt: ticket, p_time: Math.round(r.time * 100) / 100, p_finished: r.finished });
  try {
    const { data } = await (await cloud.realtimeClient()).auth.getSession();
    const t = data.session?.access_token;
    if (!t) return no('sign_in', 'Sign in to ride paid challenges.');
    const res = await fetch(`${FUNCTIONS_URL}/challenge-submit`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt: ticket, route: c.route, time: r.time, finished: r.finished, length: chRoute(c.route)?.build().length ?? ROUTE_LENGTH[c.route], trace: r.trace }),
    });
    const out = await res.json().catch(() => null);
    if (out?.ok) return ok({ accepted: !!out.accepted, reason: out.message ?? out.reason, place: out.place, riders: out.riders });
    return no(out?.code ?? 'server', out?.message ?? 'Your result could not be sent. It is kept on this phone.');
  } catch {
    return OFFLINE;
  }
}

// ---------- settings ----------

export async function loadConfig(): Promise<ChallengeConfig> {
  const s = local();
  if (MOCK) return (s.config = { ...DEFAULT_CONFIG, ...mockDb().config });
  try {
    const { data } = await (await cloud.realtimeClient()).from('config').select('value').eq('key', 'challenges').maybeSingle();
    if (data?.value) {
      const v = data.value as Record<string, unknown>;
      s.config = {
        ...DEFAULT_CONFIG,
        ...(['creationFee', 'entryMin', 'entryMax', 'maxPool', 'maxRiders', 'perDay', 'officialBonus'] as const).reduce((o, k) => (typeof v[k] === 'number' ? { ...o, [k]: v[k] } : o), {}),
        disabledRoutes: Array.isArray(v.disabledRoutes) ? (v.disabledRoutes as string[]) : [],
        disabledFormats: Array.isArray(v.disabledFormats) ? (v.disabledFormats as Format[]) : DEFAULT_CONFIG.disabledFormats,
      };
      saveLocal();
    }
  } catch { /* offline: the last known settings */ }
  return s.config;
}

// ---------- admin ----------

export async function isAdmin(): Promise<boolean> {
  if (MOCK) return !!mockDb().admin;
  if (!cloud.account) return false;
  try {
    const { data } = await (await cloud.realtimeClient()).rpc('is_admin');
    return data === true;
  } catch {
    return false;
  }
}
export async function saveConfig(c: ChallengeConfig): Promise<Res<null>> {
  if (MOCK) { const db = mockDb(); db.config = c; mockSave(db); local().config = c; return ok(null); }
  try {
    const { error } = await (await cloud.realtimeClient()).from('config').upsert({ key: 'challenges', value: c, updated_at: new Date().toISOString() });
    if (error) return no('denied', 'Only admins can change challenge settings.');
    local().config = c;
    saveLocal();
    return ok(null);
  } catch {
    return OFFLINE;
  }
}
export async function reports(): Promise<Res<Report[]>> {
  const r = await rpc<any[]>('challenge_admin_reports');
  if (!r.ok) return r;
  return ok((r.data ?? []).map((x) => ({ id: Number(x.id), challenge: x.challenge_id, name: x.name, reason: x.reason, by: x.by_name ?? 'Rider', at: toMs(x.created_at), creator: x.creator_id ?? null })));
}
export const adminRecent = async () => { const r = await rpc<any[]>('challenge_admin_recent'); return r.ok ? ok((r.data ?? []).map(fromRow)) : r; };
export const adminRemove = (id: string, reason: string) => rpc<null>('challenge_admin_remove', { p_id: id, p_reason: reason });
export const adminBan = (user: string, reason: string, days: number) => rpc<null>('challenge_admin_ban', { p_user: user, p_reason: reason, p_days: days });
export const adminDismiss = (report: number) => rpc<null>('challenge_admin_dismiss', { p_report: report });

// ---------- the pretend server (development only) ----------
// Same rules as the SQL functions, so the screens can be tried without Supabase. Nobody else is in
// it: only challenges you make yourself (or a test puts there).

interface MockDb {
  admin: boolean;
  config: ChallengeConfig;
  challenges: any[];
  entries: { cid: string; uid: string; name: string; hall: string; bike: string; xp: number; at: number; paid: number }[];
  attempts: { id: string; cid: string; uid: string; at: number; used: boolean }[];
  results: { cid: string; uid: string; time: number; at: number }[];
  invites: { cid: string; to: string; from: string; status: 'pending' | 'accepted' | 'declined' }[];
  payouts: { cid: string; uid: string; coins: number; kind: 'prize' | 'refund'; place: number | null; claimed: boolean }[];
  reports: { id: number; cid: string; reason: string; by: string; at: number }[];
  bans: string[];
}
const MKEY = 'legonrush.chmock.v1';
function mockDb(): MockDb {
  let db: MockDb | null = null;
  try { db = JSON.parse(localStorage.getItem(MKEY) ?? 'null'); } catch { /* fresh */ }
  return { admin: true, config: DEFAULT_CONFIG, challenges: [], entries: [], attempts: [], results: [], invites: [], payouts: [], reports: [], bans: [], ...db };
}
const mockSave = (db: MockDb) => localStorage.setItem(MKEY, JSON.stringify(db));

function mock(fn: string, a: Record<string, any>): Res<unknown> {
  const db = mockDb();
  const p = H().profile();
  const me = H().myId();
  const now = Date.now();
  const find = (id: string) => db.challenges.find((c) => c.id === id);
  const count = (id: string) => db.entries.filter((e) => e.cid === id).length;
  const view = (c: any) => {
    const inv = db.invites.find((i) => i.cid === c.id && i.to === me);
    return { ...c, riders: count(c.id), joined: db.entries.some((e) => e.cid === c.id && e.uid === me), invite_status: inv?.status ?? null, invite_from: inv?.from ?? null };
  };
  const done = <T>(v: T) => { mockSave(db); return ok(v); };
  const live = (c: any) => c && !['cancelled', 'removed', 'ended'].includes(c.status) && Date.parse(c.ends_at) > now;
  switch (fn) {
    case 'challenge_feed':
      return ok(db.challenges.filter((c) => c.status !== 'removed' && (['open', 'hall'].includes(c.access) || c.creator_id === me || db.entries.some((e) => e.cid === c.id && e.uid === me) || db.invites.some((i) => i.cid === c.id && i.to === me))).map(view));
    case 'challenge_by_code': {
      const c = db.challenges.find((x) => x.code === a.p_code && x.status !== 'removed');
      return ok(c ? view(c) : null);
    }
    case 'challenge_get': {
      const c = find(a.p_id);
      return ok(c ? view(c) : null);
    }
    case 'challenge_official': {
      if (!find(a.p_id)) db.challenges.push({ id: a.p_id, official: true, route: a.p_route, format: a.p_format, attempts: a.p_attempts, starts_at: a.p_starts, ends_at: a.p_ends, reg_closes_at: a.p_format === 'live_race' ? a.p_starts : a.p_ends, status: 'open', access: 'open', entry_fee: 0, max_riders: a.p_format === 'live_race' ? 10 : 9999 });
      return done(null);
    }
    case 'challenge_create': {
      if (db.bans.includes(me)) return no('banned', 'You can’t create challenges right now.');
      const today = db.challenges.filter((c) => c.creator_id === me && now - Date.parse(c.created_at) < 86400e3).length;
      if (today >= db.config.perDay) return no('limit', `You can create ${db.config.perDay} challenges a day.`);
      const c = { ...a.p, id: crypto.randomUUID(), code: newChallengeCode(), status: 'open', created_at: new Date().toISOString(), creator_id: me, creator_name: p.name, creator_username: p.username || null, creator_hall: p.hall, creation_fee: db.config.creationFee };
      db.challenges.push(c);
      if (!c.entry_fee) db.entries.push({ cid: c.id, uid: me, name: p.name, hall: p.hall, bike: p.bike, xp: p.xp, at: now, paid: 0 });
      return done(view(c));
    }
    case 'challenge_update': {
      const c = find(a.p_id);
      if (!c || c.creator_id !== me) return no('denied', 'Only the creator can edit this challenge.');
      if (db.entries.some((e) => e.cid === c.id && e.uid !== me)) return no('locked', 'Riders have joined, so the settings are locked.');
      Object.assign(c, a.p);
      return done(view(c));
    }
    case 'challenge_join': {
      const c = find(a.p_id);
      if (!live(c)) return no('closed', 'This challenge has ended.');
      if (db.entries.some((e) => e.cid === c.id && e.uid === me)) return ok({ fee: 0 });
      if (Date.parse(c.reg_closes_at) <= now) return no('closed', 'Registration is closed.');
      if (count(c.id) >= c.max_riders) return no('full', 'This challenge is full.');
      if (c.access === 'hall' && c.hall !== p.hall) return no('hall', 'This challenge is for another hall.');
      if (c.access === 'friends' && !db.invites.some((i) => i.cid === c.id && i.to === me)) return no('invite', 'This challenge is for invited riders only.');
      db.entries.push({ cid: c.id, uid: me, name: p.name, hall: p.hall, bike: p.bike, xp: p.xp, at: now, paid: c.entry_fee ?? 0 });
      db.invites.filter((i) => i.cid === c.id && i.to === me).forEach((i) => (i.status = 'accepted'));
      return done({ fee: c.entry_fee ?? 0 });
    }
    case 'challenge_leave': {
      const c = find(a.p_id);
      const e = db.entries.find((x) => x.cid === a.p_id && x.uid === me);
      if (!c || !e) return ok({ refund: 0 });
      if (c.creator_id === me) return no('creator', 'You made this challenge. Cancel it instead.');
      if (Date.parse(c.starts_at) <= now) return no('started', 'The challenge has started, so you can’t leave it now.');
      db.entries = db.entries.filter((x) => x !== e);
      return done({ refund: e.paid });
    }
    case 'challenge_invite': {
      const c = find(a.p_id);
      if (!c || c.creator_id !== me) return no('denied', 'Only the creator can invite riders.');
      for (const u of a.p_usernames as string[]) if (!db.invites.some((i) => i.cid === c.id && i.to === u)) db.invites.push({ cid: c.id, to: u, from: p.name, status: 'pending' });
      return done((a.p_usernames as string[]).length);
    }
    case 'challenge_answer_invite': {
      db.invites.filter((i) => i.cid === a.p_id && i.to === me).forEach((i) => (i.status = a.p_accept ? 'accepted' : 'declined'));
      return done(null);
    }
    case 'challenge_close_registration': case 'challenge_start_now': {
      const c = find(a.p_id);
      if (!c || c.creator_id !== me) return no('denied', 'Only the creator can do that.');
      c.reg_closes_at = new Date(now).toISOString();
      if (fn === 'challenge_start_now') { c.starts_at = c.reg_closes_at; c.status = 'live'; }
      return done(null);
    }
    case 'challenge_cancel': case 'challenge_admin_remove': {
      const c = find(a.p_id);
      if (!c || (fn === 'challenge_cancel' && c.creator_id !== me)) return no('denied', 'Only the creator can cancel this challenge.');
      if (fn === 'challenge_cancel' && Date.parse(c.starts_at) <= now && c.format === 'live_race') return no('started', 'The race has started.');
      c.status = fn === 'challenge_cancel' ? 'cancelled' : 'removed';
      let refunded = 0;
      for (const e of db.entries.filter((x) => x.cid === c.id && x.paid > 0)) { db.payouts.push({ cid: c.id, uid: e.uid, coins: e.paid, kind: 'refund', place: null, claimed: false }); refunded++; }
      return done({ refunded });
    }
    case 'challenge_entries':
      return ok(db.entries.filter((e) => e.cid === a.p_id).sort((x, y) => x.at - y.at).map((e) => ({ user_id: e.uid, name: e.name, username: null, hall: e.hall, bike: e.bike, xp: e.xp, joined_at: e.at, me: e.uid === me })));
    case 'challenge_start_attempt': {
      const c = find(a.p_id);
      if (!c) return no('missing', 'Challenge not found.');
      if (!live(c) || Date.parse(c.starts_at) > now + 60e3) return no('closed', 'This challenge is not open for rides right now.');
      if (!db.entries.some((e) => e.cid === c.id && e.uid === me)) {
        if (c.entry_fee > 0) return no('join', 'Join the challenge first.');
        db.entries.push({ cid: c.id, uid: me, name: p.name, hall: p.hall, bike: p.bike, xp: p.xp, at: now, paid: 0 });
      }
      const used = db.attempts.filter((x) => x.cid === c.id && x.uid === me).length;
      if (c.attempts > 0 && used >= c.attempts) return no('attempts', 'You have used all your attempts.');
      const id = crypto.randomUUID();
      db.attempts.push({ id, cid: c.id, uid: me, at: now, used: false });
      return done(id);
    }
    case 'challenge_submit': {
      const t = db.attempts.find((x) => x.id === a.p_attempt && x.uid === me && !x.used);
      if (!t) return no('ticket', 'That ride was already counted.');
      t.used = true;
      const len = ROUTE_LENGTH[find(t.cid)?.route] ?? 2000;
      if (!a.p_finished) return done({ accepted: false, reason: 'Only finished rides count.' });
      if (a.p_time < len / 40 || (now - t.at) / 1000 + 2 < a.p_time) return done({ accepted: false, reason: 'That time is faster than the game allows.' });
      db.results.push({ cid: t.cid, uid: me, time: a.p_time, at: now });
      const best = bestOf(db, t.cid);
      return done({ accepted: true, place: best.findIndex((b) => b.uid === me) + 1, riders: best.length });
    }
    case 'challenge_board': {
      const counts = (uid: string) => db.results.filter((r) => r.cid === a.p_id && r.uid === uid).length;
      return ok(bestOf(db, a.p_id).map((b, i) => { const e = db.entries.find((x) => x.cid === a.p_id && x.uid === b.uid); return { rank: i + 1, user_id: b.uid, name: e?.name ?? p.name, username: null, hall: e?.hall ?? p.hall, best: b.time, attempts: counts(b.uid), me: b.uid === me }; }));
    }
    case 'challenge_stats': {
      const best = bestOf(db, a.p_id);
      return ok({ participants: count(a.p_id), finishers: best.length, average: best.length ? best.reduce((s, b) => s + b.time, 0) / best.length : null, fastest: best[0]?.time ?? null });
    }
    case 'challenge_settle': {
      const c = find(a.p_id);
      if (!c || c.status === 'ended' || Date.parse(c.ends_at) > now) return ok({ settled: false });
      c.status = 'ended';
      const best = bestOf(db, c.id);
      const pool = db.entries.filter((e) => e.cid === c.id).reduce((s, e) => s + e.paid, 0);
      if (pool > 0 && best.length >= 2) prizeSplit(pool, c.prize).forEach((coins, i) => { if (best[i]) db.payouts.push({ cid: c.id, uid: best[i].uid, coins, kind: 'prize', place: i + 1, claimed: false }); else db.payouts.push({ cid: c.id, uid: best[0].uid, coins, kind: 'prize', place: 1, claimed: false }); });
      else for (const e of db.entries.filter((x) => x.cid === c.id && x.paid > 0)) db.payouts.push({ cid: c.id, uid: e.uid, coins: e.paid, kind: 'refund', place: null, claimed: false });
      return done({ settled: true });
    }
    case 'challenge_claim': {
      const mineP = db.payouts.filter((x) => x.uid === me && !x.claimed);
      mineP.forEach((x) => (x.claimed = true));
      return done(mineP.map((x) => ({ challenge_id: x.cid, name: find(x.cid)?.name, coins: x.coins, kind: x.kind, place: x.place })));
    }
    case 'challenge_report':
      db.reports.push({ id: db.reports.length + 1, cid: a.p_id, reason: a.p_reason, by: p.name, at: now });
      return done(null);
    case 'challenge_admin_reports':
      return ok(db.reports.map((r) => ({ id: r.id, challenge_id: r.cid, name: find(r.cid)?.name ?? '?', reason: r.reason, by_name: r.by, created_at: r.at, creator_id: find(r.cid)?.creator_id })));
    case 'challenge_admin_recent':
      return ok(db.challenges.filter((c) => !c.official).slice(-30).reverse().map(view));
    case 'challenge_admin_ban':
      db.bans.push(a.p_user);
      return done(null);
    case 'challenge_admin_dismiss':
      db.reports = db.reports.filter((r) => r.id !== a.p_report);
      return done(null);
  }
  return no('not_ready', 'Not available.');
}
function bestOf(db: MockDb, cid: string) {
  const best = new Map<string, { uid: string; time: number; at: number }>();
  for (const r of db.results.filter((x) => x.cid === cid)) { const b = best.get(r.uid); if (!b || r.time < b.time) best.set(r.uid, r); }
  return [...best.values()].sort((x, y) => x.time - y.time || x.at - y.at);
}
