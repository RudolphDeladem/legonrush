// Community's server calls. Everything goes through the security-definer functions in
// supabase/sql/30-community.sql, which apply each rider's privacy, blocks and the 18+ rule.
// Every call fails softly: screens show "sign in", "offline" or "being set up" instead of breaking.
import * as cloud from '../../cloud';
import type { Card, Chat, Crew, DatingCard, Home, Msg, Notification, Post, BoardRow, Reaction } from './model';

export type Problem = 'signin' | 'offline' | 'setup' | 'privacy' | 'rate' | 'coins' | 'in_crew' | 'name_taken' | 'level' | 'blocked' | 'not_found' | 'dating_off' | 'not_leader' | 'error';

export class CommunityError extends Error {
  constructor(public problem: Problem, detail = '') {
    super(detail || problem);
  }
}

/** plain words for each problem */
export const PROBLEM_TEXT: Record<Problem, string> = {
  signin: 'Sign in to use Community.',
  offline: "You're offline. Community comes back when you reconnect.",
  setup: 'Community is being set up. Check back soon.',
  privacy: "Their privacy settings don't allow that.",
  rate: "You're doing that a lot. Take a short break and try again.",
  coins: "You don't have enough coins for that yet.",
  in_crew: "You're already in a crew. Leave it first to join another.",
  name_taken: 'That crew name is taken. Try another.',
  level: "Your level isn't high enough for that crew yet.",
  blocked: "You can't interact with this rider.",
  not_found: "That isn't available any more.",
  dating_off: 'Dating is for riders 18+ who switched it on.',
  not_leader: 'Only the crew leader can do that.',
  error: 'Something went wrong. Try again.',
};
export const problemOf = (e: unknown): Problem => (e instanceof CommunityError ? e.problem : 'error');
export const problemText = (e: unknown) => PROBLEM_TEXT[problemOf(e)];

/** the server's state, as far as we know: 'setup' once a function turned out to be missing */
export let backend: 'unknown' | 'ok' | 'setup' = 'unknown';
export const signedIn = () => !!cloud.account;
export const myId = () => cloud.account?.id ?? '';

const KNOWN = new Set<Problem>(['privacy', 'rate', 'coins', 'in_crew', 'name_taken', 'level', 'blocked', 'not_found', 'dating_off', 'not_leader']);

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!cloud.account) throw new CommunityError('signin');
  if (!navigator.onLine) throw new CommunityError('offline');
  let res: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    const c = await cloud.realtimeClient();
    res = await c.rpc(fn, args);
  } catch {
    throw new CommunityError('offline');
  }
  const { data, error } = res;
  if (error) {
    const msg = String(error.message ?? '');
    if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || /could not find the function|does not exist/i.test(msg)) {
      backend = 'setup';
      throw new CommunityError('setup', msg);
    }
    if (/fetch|network|failed to/i.test(msg)) throw new CommunityError('offline', msg);
    if (msg === 'signin') throw new CommunityError('signin');
    throw new CommunityError(KNOWN.has(msg as Problem) ? (msg as Problem) : 'error', msg);
  }
  backend = 'ok';
  return data as T;
}

// ---------- home, settings, people ----------
export const home = () => rpc<Home>('community_home');
export const saveSettings = (p: Record<string, unknown>) => rpc<Record<string, unknown>>('community_save_settings', { p });

export type PeopleMode = 'search' | 'suggest' | 'friends' | 'requests' | 'sent' | 'followers' | 'following' | 'hall' | 'course' | 'level'
  | 'friends_status' | 'buddies' | 'social' | 'compete' | 'blocked' | 'ids' | 'crew';
export const people = (mode: PeopleMode, q = '', limit = 30, offset = 0) =>
  rpc<Card[] | null>('community_people', { p_mode: mode, p_q: q, p_limit: limit, p_offset: offset }).then((r) => r ?? []);
export const card = (id: string) => rpc<Card | null>('community_card', { p_id: id });
export const friend = (id: string, action: 'request' | 'accept' | 'decline' | 'remove') => rpc<'friend' | 'sent' | 'none'>('community_friend', { p_id: id, p_action: action });
export const toggle = (id: string, kind: 'follow' | 'mute' | 'hide' | 'block', on: boolean) => rpc<boolean>('community_toggle', { p_id: id, p_kind: kind, p_on: on });
export const report = (user: string | null, kind: 'user' | 'post' | 'message' | 'crew', target: string | null, reason: string, details?: string, context?: unknown) =>
  rpc<number>('community_report', { p_user: user, p_kind: kind, p_target: target, p_reason: reason, p_details: details ?? null, p_context: context ?? null });
export const rodeWith = (id: string) => rpc<void>('community_rode_with', { p_id: id });
export const vibeInvite = (id: string, code: string) => rpc<void>('community_vibe_invite', { p_id: id, p_code: code });

// ---------- feed ----------
export type FeedScope = 'home' | 'friends' | 'hall' | 'course' | 'crew' | 'user';
export const feed = (scope: FeedScope = 'home', ref: string | null = null, before: number | null = null, limit = 20) =>
  rpc<Post[] | null>('community_feed', { p_scope: scope, p_ref: ref, p_before: before, p_limit: limit }).then((r) => r ?? []);
export const post = (kind: Post['kind'], text: string, o: { akind?: string; ref?: string; audience?: Post['audience'] } = {}) =>
  rpc<number | null>('community_post', { p_kind: kind, p_text: text, p_akind: o.akind ?? null, p_ref: o.ref ?? null, p_audience: o.audience ?? null });
export const deletePost = (id: number) => rpc<void>('community_post_delete', { p_id: id });
export const react = (id: number, kind: Reaction | null) => rpc<Reaction | null>('community_react', { p_post: id, p_kind: kind });

// ---------- crews ----------
export const crews = (q = '') => rpc<Crew[] | null>('crew_list', { p_q: q, p_limit: 40 }).then((r) => r ?? []);
export const crew = (id: number) => rpc<Crew | null>('crew_get', { p_id: id });
export const createCrew = (c: { name: string; logo: string; color: string; description: string; public: boolean; minLevel: number }) =>
  rpc<{ id: number; fee: number }>('crew_create', { p_name: c.name, p_logo: c.logo, p_color: c.color, p_description: c.description, p_public: c.public, p_min_level: c.minLevel });
export const joinCrew = (id: number) => rpc<'member' | 'pending'>('crew_join', { p_id: id });
export const answerCrew = (id: number, user: string, accept: boolean) => rpc<void>('crew_answer', { p_id: id, p_user: user, p_accept: accept });
export const leaveCrew = (id: number) => rpc<void>('crew_leave', { p_id: id });
export const updateCrew = (id: number, p: Record<string, unknown>) => rpc<void>('crew_update', { p_id: id, p });
export type CrewMetric = 'xp' | 'km' | 'wins' | 'events' | 'challenges';
export const crewBoard = (metric: CrewMetric, crewId: number | null = null) => rpc<BoardRow[] | null>('crew_board', { p_metric: metric, p_crew: crewId }).then((r) => r ?? []);

// ---------- messages ----------
export const openChat = (id: string) => rpc<number>('chat_open', { p_id: id });
export const chats = () => rpc<Chat[] | null>('chat_list').then((r) => r ?? []);
export const messages = (conv: number, before: number | null = null) => rpc<Msg[] | null>('chat_messages', { p_conv: conv, p_before: before, p_limit: 40 }).then((r) => r ?? []);
export const send = (conv: number, text: string) => rpc<number>('chat_send', { p_conv: conv, p_text: text });
export const reactMsg = (id: number, emoji: string | null) => rpc<void>('chat_react', { p_msg: id, p_emoji: emoji });
export const markChat = (conv: number, action: 'read' | 'leave' | 'mute' | 'unmute') => rpc<void>('chat_mark', { p_conv: conv, p_action: action });

// ---------- dating ----------
export const datingDiscover = () => rpc<DatingCard[] | null>('dating_discover', { p_limit: 12 }).then((r) => r ?? []);
export const datingAnswer = (id: string, action: 'like' | 'pass' | 'unmatch') => rpc<'match' | 'liked' | 'none'>('dating_answer', { p_id: id, p_action: action });
export const datingMatches = () => rpc<DatingCard[] | null>('dating_matches').then((r) => r ?? []);

// ---------- notifications, boards, groups ----------
export const notifications = () => rpc<Notification[] | null>('community_notifications', { p_limit: 40 }).then((r) => r ?? []);
export const readNotifications = () => rpc<void>('community_notifications_read');
export type BoardKind = 'riders' | 'active' | 'events' | 'challenges' | 'social' | 'contributors';
export const board = (kind: BoardKind) => rpc<BoardRow[] | null>('community_board', { p_kind: kind, p_limit: 20 }).then((r) => r ?? []);
export const group = (kind: 'hall' | 'course', ref: string) => rpc<{ members: number; people: Card[]; feed: Post[]; crews: Crew[] }>('community_group', { p_kind: kind, p_ref: ref });

// ---------- live: new messages, reactions and notifications ----------
export type LiveEvent =
  | { type: 'message'; conv: number; msg: { id: number; sender: string; text: string; created_at: string } }
  | { type: 'reaction'; conv: number }
  | { type: 'notification'; n: Notification };
const listeners = new Set<(e: LiveEvent) => void>();
let liveFor = '';
let liveCh: { unsubscribe: () => unknown } | null = null;

/** listen for live events (returns a stop function); connects once while signed in */
export function onLive(fn: (e: LiveEvent) => void) {
  listeners.add(fn);
  void connectLive();
  return () => listeners.delete(fn);
}

export async function connectLive() {
  const me = cloud.account?.id;
  if (!me || liveFor === me || !navigator.onLine) return;
  liveFor = me;
  try {
    const c = await cloud.realtimeClient();
    const emit = (e: LiveEvent) => listeners.forEach((fn) => { try { fn(e); } catch { /* one bad listener shouldn't stop the rest */ } });
    // row rules decide what reaches this rider: only chats they're in, only their notifications
    const ch = c.channel(`community:${me}`)
      .on('postgres_changes' as never, { event: 'INSERT', schema: 'public', table: 'messages' }, (m: { new: { id: number; conversation_id: number; sender: string; text: string; created_at: string } }) =>
        emit({ type: 'message', conv: m.new.conversation_id, msg: m.new }))
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'message_reactions' }, (m: { new?: { conversation_id?: number }; old?: { conversation_id?: number } }) =>
        emit({ type: 'reaction', conv: Number(m.new?.conversation_id ?? m.old?.conversation_id ?? 0) }))
      .on('postgres_changes' as never, { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, (m: { new: Notification & { created_at: string } }) =>
        emit({ type: 'notification', n: { ...m.new, at: m.new.created_at } }));
    ch.subscribe((status: string) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { liveFor = ''; liveCh = null; }
    });
    liveCh = ch;
  } catch {
    liveFor = '';
  }
}

export function disconnectLive() {
  liveCh?.unsubscribe();
  liveCh = null;
  liveFor = '';
}

// ---------- prices admins can change (config table, read by everyone) ----------
const configCache = new Map<string, number>();
/** a number from the config table, or the code default when offline / not set */
export async function configNumber(key: string, fallback: number) {
  if (configCache.has(key)) return configCache.get(key)!;
  try {
    const c = await cloud.realtimeClient();
    const { data } = await c.from('config').select('value').eq('key', key).maybeSingle();
    const n = Number((data as { value?: unknown } | null)?.value);
    const v = Number.isFinite(n) && n >= 0 ? n : fallback;
    configCache.set(key, v);
    return v;
  } catch {
    return fallback;
  }
}
export const CREW_FEE_DEFAULT = 2000;
