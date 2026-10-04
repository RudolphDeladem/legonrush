// Live channels for riding with other people: who is online, Quick Match, Vibe Ride and its chat.
// Built on Supabase Realtime (presence + broadcast), so nothing is stored: a channel exists while
// people are in it. For local testing, ?fakelive in dev runs the same channels between browser tabs.
import { realtimeClient as client } from './cloud';

export interface Peer<S = Record<string, unknown>> {
  key: string;
  state: S;
}

export interface Channel {
  /** tell everyone else in the channel */
  send(event: string, payload: Record<string, unknown>): void;
  on(event: string, fn: (payload: any) => void): void;
  /** fires whenever someone joins, leaves or changes their state */
  onPeers(fn: (peers: Peer<any>[]) => void): void;
  /** what others see about you while you are here */
  track(state: Record<string, unknown>): void;
  peers(): Peer<any>[];
  leave(): void;
}

const FAKE = import.meta.env.DEV && (new URLSearchParams(location.search).has('fakelive') || sessionStorage.getItem('legonrush.fakelive') === '1');
if (FAKE) sessionStorage.setItem('legonrush.fakelive', '1');

/** Joins a channel; null if live features can't be reached (offline, blocked). */
export async function join(name: string, key: string, state?: Record<string, unknown>): Promise<Channel | null> {
  try {
    const ch = FAKE ? fakeChannel(name, key) : await realtimeChannel(name, key);
    if (ch && state) ch.track(state);
    return ch;
  } catch {
    return null;
  }
}

/** a short code people can type: no 0/O or 1/I */
export function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
}

async function realtimeChannel(name: string, key: string): Promise<Channel | null> {
  const c = await client();
  const ch = c.channel(name, { config: { presence: { key }, broadcast: { self: false } } });
  const handlers = new Map<string, ((p: any) => void)[]>();
  let peerFns: ((p: Peer[]) => void)[] = [];
  let peers: Peer[] = [];
  ch.on('broadcast', { event: '*' }, (m) => handlers.get(m.event)?.forEach((fn) => fn(m.payload)));
  ch.on('presence', { event: 'sync' }, () => {
    const st = ch.presenceState() as Record<string, Record<string, unknown>[]>;
    peers = Object.entries(st).filter(([k, metas]) => k !== key && metas.length).map(([k, metas]) => ({ key: k, state: metas[metas.length - 1] }));
    peerFns.forEach((fn) => fn(peers));
  });
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(true); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); resolve(false); }
    });
  });
  if (!ok) {
    void c.removeChannel(ch);
    return null;
  }
  let tracked: Record<string, unknown> | null = null;
  return {
    send: (event, payload) => void ch.send({ type: 'broadcast', event, payload }),
    on: (event, fn) => handlers.set(event, [...(handlers.get(event) ?? []), fn]),
    onPeers: (fn) => { peerFns.push(fn); fn(peers); },
    track: (state) => { tracked = state; void ch.track(tracked); },
    peers: () => peers,
    leave: () => { peerFns = []; handlers.clear(); void c.removeChannel(ch); },
  };
}

/** the same channel between tabs of one browser (or a test harness's bus), for testing without a server */
function fakeChannel(name: string, key: string): Channel {
  type Bus = { post: (name: string, m: unknown) => void; listen: (name: string, fn: (m: any) => void) => () => void };
  const bus = (window as unknown as { __fakeBus?: Bus }).__fakeBus;
  const bc = bus ? null : new BroadcastChannel(`legonrush-fake:${name}`);
  const post = (m: unknown) => (bus ? bus.post(name, m) : bc!.postMessage(m));
  const handlers = new Map<string, ((p: any) => void)[]>();
  let peerFns: ((p: Peer[]) => void)[] = [];
  const seen = new Map<string, { state: Record<string, unknown>; at: number }>();
  let state: Record<string, unknown> | null = null;
  const list = () => [...seen].map(([k, v]) => ({ key: k, state: v.state }));
  const changed = () => peerFns.forEach((fn) => fn(list()));
  const hello = (reply: boolean) => state && post({ t: 'hi', from: key, state, reply });
  const receive = (m: any) => {
    if (m.from === key) return;
    if (m.t === 'b') handlers.get(m.event)?.forEach((fn) => fn(m.payload));
    if (m.t === 'hi') {
      const known = seen.has(m.from) && JSON.stringify(seen.get(m.from)!.state) === JSON.stringify(m.state);
      seen.set(m.from, { state: m.state, at: Date.now() });
      if (!known) changed();
      if (!m.reply) hello(true);
    }
    if (m.t === 'bye' && seen.delete(m.from)) changed();
  };
  const unlisten = bus ? bus.listen(name, receive) : ((bc!.onmessage = (e) => receive(e.data)), () => bc!.close());
  const beat = setInterval(() => {
    hello(true);
    let gone = false;
    for (const [k, v] of seen) if (Date.now() - v.at > 5000) { seen.delete(k); gone = true; }
    if (gone) changed();
  }, 1500);
  const bye = () => post({ t: 'bye', from: key });
  addEventListener('pagehide', bye);
  return {
    send: (event, payload) => post({ t: 'b', from: key, event, payload }),
    on: (event, fn) => handlers.set(event, [...(handlers.get(event) ?? []), fn]),
    onPeers: (fn) => { peerFns.push(fn); fn(list()); },
    track: (s) => { state = s; hello(false); },
    peers: list,
    leave: () => { bye(); clearInterval(beat); removeEventListener('pagehide', bye); peerFns = []; handlers.clear(); unlisten(); },
  };
}
