// Small helpers shared by the LEGONRUSH money functions: settings, replies, the signed-in rider,
// and the database (PostgREST with the service role key, which Supabase gives every function).

export const env = (name: string, fallback = '') => Deno.env.get(name) ?? fallback;

export const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** a refusal the game shows in plain words */
export const fail = (code: string, message: string, status = 400) => json({ ok: false, code, message }, status);

/** answers the browser's CORS pre-check; null for real requests */
export const preflight = (req: Request) => (req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null);

export async function body<T>(req: Request, maxBytes = 64_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface User {
  id: string;
  email: string;
}

/** the signed-in rider who sent the request (from their Supabase access token), or null */
export async function user(req: Request): Promise<User | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_KEY } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? { id: u.id, email: u.email ?? '' } : null;
}

/** true when the request carries the owner's ADMIN_SECRET in the x-admin-secret header */
export function isAdmin(req: Request) {
  const secret = env('ADMIN_SECRET');
  const given = req.headers.get('x-admin-secret') ?? '';
  if (secret.length < 16 || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ---------- database ----------

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const db = {
  /** rows matching a PostgREST query string, e.g. select('payouts', 'user_id=eq.X&select=id') */
  select: <T = Record<string, unknown>>(table: string, query: string): Promise<T[]> => rest(`${table}?${query}`),
  insert: <T = Record<string, unknown>>(table: string, row: Record<string, unknown>): Promise<T[]> =>
    rest(table, { method: 'POST', body: JSON.stringify(row), prefer: 'return=representation' }),
  /** updates matching rows and returns them as they are now (only the rows this call changed) */
  update: <T = Record<string, unknown>>(table: string, query: string, patch: Record<string, unknown>): Promise<T[]> =>
    rest(`${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=representation' }),
  rpc: <T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }),
};

/** a reference nobody can guess: prefix plus 20 random characters */
export function newReference(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return `${prefix}-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;
}

/** Monday 00:00 UTC (Ghana time) of the week containing `now` */
export function weekStartUTC(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
