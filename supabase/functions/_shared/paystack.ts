// Paystack: coin bundles (prices live HERE on the server, never trusted from the app),
// Mobile Money networks, API calls and webhook signature checks.
import { env } from './http.ts';

export interface Bundle {
  id: string;
  coins: number;
  /** price in pesewas (GHS 1 = 100) */
  price: number;
  label: string;
  tag?: string;
}

/** What players can buy. Change prices here and redeploy paystack-init. */
export const BUNDLES: Bundle[] = [
  { id: 'coins-500', coins: 500, price: 500, label: 'Pocket' },
  { id: 'coins-1200', coins: 1200, price: 1000, label: 'Saddle bag', tag: '+20% coins' },
  { id: 'coins-3000', coins: 3000, price: 2000, label: 'Backpack', tag: 'Popular' },
  { id: 'coins-8000', coins: 8000, price: 5000, label: 'Treasure chest', tag: 'Best value' },
];

/**
 * Paystack's codes for Ghana Mobile Money (type "mobile_money", currency GHS). If Paystack ever renames
 * one, check GET https://api.paystack.co/bank?currency=GHS&type=mobile_money and update it here.
 */
export const NETWORKS: Record<string, { name: string; bankCode: string }> = {
  mtn: { name: 'MTN MoMo', bankCode: 'MTN' },
  telecel: { name: 'Telecel Cash', bankCode: 'VOD' },
  airteltigo: { name: 'AirtelTigo Money', bankCode: 'ATL' },
};

export const paystackReady = () => env('PAYSTACK_SECRET_KEY').startsWith('sk_');
/** true for a test key: no real money moves */
export const paystackTest = () => env('PAYSTACK_SECRET_KEY').startsWith('sk_test_');

/** calls the Paystack API; returns { status, message, data } as Paystack sends it */
export async function paystack<T = Record<string, unknown>>(path: string, payload?: unknown): Promise<{ status: boolean; message: string; data: T }> {
  const r = await fetch(`${env('PAYSTACK_API_URL', 'https://api.paystack.co')}${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${env('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({ status: false, message: `Paystack replied ${r.status}`, data: null }));
  return out;
}

/** Paystack signs each webhook with HMAC-SHA512 of the raw body, keyed with the secret key. */
export async function validSignature(raw: string, signature: string | null) {
  if (!signature || !paystackReady()) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('PAYSTACK_SECRET_KEY')), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}
