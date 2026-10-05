// Real-money features talking to the Supabase Edge Functions (supabase/functions/*):
// coin bundles (Paystack checkout), the free weekly prize race (results checked on the server)
// and the prize wallet with Mobile Money cash-outs. Screens are in money-ui.ts.
import * as cloud from '../cloud';
import { FUNCTIONS_URL, PAYSTACK_PUBLIC_KEY, SUPABASE_KEY } from '../cloud-config';
import type { GhostRun } from '../game/Game';

/** In development only, a key can be set in localStorage to try the screens against a mock or test backend. */
function publicKey() {
  if (PAYSTACK_PUBLIC_KEY) return PAYSTACK_PUBLIC_KEY;
  if (!import.meta.env.DEV) return '';
  try {
    return localStorage.getItem('legonrush.paystackKey') ?? '';
  } catch {
    return '';
  }
}

/** false until the owner has set up Paystack and the functions: every money screen then says "Coming soon" */
export const moneyOn = () => /^pk_(test|live)_/.test(publicKey());
export const testMode = () => publicKey().startsWith('pk_test_');

export type Fail = { ok: false; code: string; message: string };
export type Reply<T> = ({ ok: true } & T) | Fail;

async function token() {
  if (!cloud.account) return null;
  try {
    const { data } = await (await cloud.realtimeClient()).auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function call<T>(fn: string, payload?: unknown): Promise<Reply<T>> {
  if (!moneyOn()) return { ok: false, code: 'not_ready', message: 'Coming soon.' };
  const t = await token();
  const headers: Record<string, string> = { apikey: SUPABASE_KEY };
  if (t) headers.Authorization = `Bearer ${t}`;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${FUNCTIONS_URL}/${fn}`, { method: payload === undefined ? 'GET' : 'POST', headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const out = await r.json().catch(() => null);
    if (out && typeof out.ok === 'boolean') return out;
    return { ok: false, code: r.status === 404 ? 'not_ready' : 'server', message: r.status === 404 ? 'Coming soon.' : 'Something went wrong. Try again in a minute.' };
  } catch {
    return { ok: false, code: 'offline', message: 'No connection. Check your data or Wi-Fi.' };
  }
}

/** pesewas as "GHS 12.50" (or "GHS 12" for whole cedis) */
export const ghs = (pesewas: number) => `GHS ${pesewas % 100 ? (pesewas / 100).toFixed(2) : String(pesewas / 100)}`;

// ---------- coin bundles ----------

export interface Bundle {
  id: string;
  coins: number;
  price: number;
  label: string;
  tag?: string;
}

export const bundles = () => call<{ enabled: boolean; test: boolean; bundles: Bundle[] }>('paystack-init');
export const checkout = (bundle: string) =>
  call<{ authorization_url: string; reference: string }>('paystack-init', { bundle, return_to: `${location.origin}${import.meta.env.BASE_URL}play/` });
export const verifyPayment = (reference: string) => call<{ status: 'paid' | 'pending' | 'failed' }>('paystack-init', { verify: reference });
export const claimCoins = () => call<{ coins: number; references: string[] }>('paystack-init', { claim: true });

// ---------- wallet ----------

export interface LedgerRow {
  amount_pesewas: number;
  kind: 'prize' | 'cashout' | 'refund' | 'adjust';
  note: string | null;
  created_at: string;
}
export interface PayoutRow {
  amount_pesewas: number;
  network: string;
  momo_number: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  failure_reason: string | null;
  created_at: string;
  reference: string;
}
export interface Wallet {
  balance: number;
  min: number;
  mode: 'auto' | 'manual';
  history: LedgerRow[];
  payouts: PayoutRow[];
}

export const NETWORKS = [
  { id: 'mtn', name: 'MTN MoMo' },
  { id: 'telecel', name: 'Telecel Cash' },
  { id: 'airteltigo', name: 'AirtelTigo Money' },
] as const;

export const wallet = () => call<Wallet>('cashout');
export const cashOut = (r: { amount: number; network: string; number: string; name: string; adult: boolean }) =>
  call<{ status: 'pending' | 'processing' | 'sent'; message: string; reference: string }>('cashout', r);

// ---------- weekly prize race ----------

export interface PrizeEvent {
  id: number;
  title: string;
  route: string;
  route_length: number;
  prizes: number[];
  sponsor: string | null;
  starts_at: string;
  ends_at: string;
}
export interface PrizeRow {
  place: number;
  name: string;
  username: string | null;
  hall: string;
  best: number;
  me: boolean;
}
export interface PrizeWeek {
  event: PrizeEvent | null;
  board: PrizeRow[];
  riders: number;
  my_place?: number;
  mine?: { time: number; accepted: boolean; reason: string | null; at: string }[];
}

export const prizeWeek = () => call<PrizeWeek>('submit-run');

/** the ticket for the prize ride under way, if any */
let ticket: { id: string; route: string; at: number } | null = null;

/** Asks the server for a start ticket; the ride only counts for prizes with one. */
export async function startPrizeRide(route: string) {
  const r = await call<{ ticket: string; route: string }>('submit-run', { action: 'start' });
  if (r.ok) ticket = { id: r.ticket, route: r.route || route, at: Date.now() };
  return r;
}

export type PrizeVerdict = Reply<{ accepted: true; time: number; place: number; riders: number } | { accepted: false; reason: string; message: string }>;

/**
 * After a ride ends: if it was a prize ride, sends the result and the recording for checking.
 * Returns null when the ride was not a prize ride.
 */
export async function submitPrizeRide(route: { id: string; length: number }, r: { finished: boolean; time: number }, run: GhostRun): Promise<PrizeVerdict | null> {
  if (!ticket || !prizeTicketFor(route.id)) return null;
  const t = ticket;
  ticket = null;
  if (!r.finished) return null;
  return call('submit-run', { action: 'finish', ticket: t.id, route: route.id, time: r.time, finished: r.finished, length: route.length, trace: run });
}

/** a prize ride is under way on this route (a ticket left over from a ride quit long ago doesn't count) */
export const prizeTicketFor = (routeId: string) => !!ticket && ticket.route === routeId && Date.now() - ticket.at < 3600e3;
