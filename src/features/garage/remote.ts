// The store's online side (supabase/sql/40-store.sql): price and availability overrides, rotations admins
// schedule (featured, limited drop, daily free item), a purchase log, wishlist counts and the admin check.
// Everything works offline from the catalogue; what was last fetched is kept on the phone.
import * as cloud from '../../cloud';
import type { Price, Rarity } from './catalog';

export interface ItemOverride { id: string; price_coins: number | null; price_diamonds: number | null; disabled: boolean; rarity: Rarity | null; name: string | null }
export type Slot = 'featured' | 'drop' | 'daily' | 'ending';
export interface RotationRow { id?: number; slot: Slot; item_id: string; starts_at: string; ends_at: string }

const KEY = 'legonrush.store.v1';
interface Cache { items: ItemOverride[]; rotation: RotationRow[]; at: number }
let cache: Cache = read();
function read(): Cache {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (c && Array.isArray(c.items) && Array.isArray(c.rotation)) return c;
  } catch { /* ignore */ }
  return { items: [], rotation: [], at: 0 };
}
function write() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}

const withTimeout = <T,>(p: PromiseLike<T>, ms = 6000) => Promise.race([Promise.resolve(p), new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

let loading: Promise<boolean> | null = null;
/** Fetches the admins' overrides and rotations (at most every 10 minutes). Resolves true when something changed. */
export function loadStore(force = false): Promise<boolean> {
  if (!navigator.onLine) return Promise.resolve(false);
  if (!force && Date.now() - cache.at < 10 * 60e3) return Promise.resolve(false);
  return (loading ??= (async () => {
    try {
      const c = await withTimeout(cloud.realtimeClient());
      const now = new Date().toISOString();
      const [items, rot] = await withTimeout(Promise.all([
        c.from('store_items').select('id,price_coins,price_diamonds,disabled,rarity,name'),
        c.from('store_rotation').select('id,slot,item_id,starts_at,ends_at').gte('ends_at', now).order('starts_at'),
      ]));
      if (items.error || rot.error) return false;
      const before = JSON.stringify([cache.items, cache.rotation]);
      cache = { items: (items.data ?? []) as ItemOverride[], rotation: (rot.data ?? []) as RotationRow[], at: Date.now() };
      write();
      return before !== JSON.stringify([cache.items, cache.rotation]);
    } catch {
      return false;
    } finally {
      loading = null;
    }
  })());
}

const override = (id: string) => cache.items.find((o) => o.id === id);
/** the price after any admin change */
export function priceOverride(id: string, price: Price | undefined): Price | undefined {
  const o = override(id);
  if (!o || (o.price_coins == null && o.price_diamonds == null)) return price;
  return { ...(o.price_coins != null ? { coins: o.price_coins } : {}), ...(o.price_diamonds != null ? { diamonds: o.price_diamonds } : {}) };
}
export const isDisabled = (id: string) => !!override(id)?.disabled;
export const rarityOverride = (id: string) => override(id)?.rarity ?? null;
/** rotation rows an admin scheduled that are running at this moment */
export function liveRotation(slot: Slot, now = Date.now()) {
  return cache.rotation.filter((r) => r.slot === slot && Date.parse(r.starts_at) <= now && Date.parse(r.ends_at) > now);
}

/** Records a purchase for the admins' sales view (signed-in riders only; best effort). */
export async function logPurchase(itemId: string, price: Price) {
  if (!cloud.account) return;
  try {
    const c = await withTimeout(cloud.realtimeClient());
    await withTimeout(c.from('store_purchases').insert({ item_id: itemId, coins: price.coins ?? 0, diamonds: price.diamonds ?? 0 }));
  } catch { /* offline: not logged */ }
}

/** Mirrors a wishlist change online, so the store can say how many riders want an item. */
export async function wish(itemId: string, on: boolean) {
  if (!cloud.account) return;
  try {
    const c = await withTimeout(cloud.realtimeClient());
    if (on) await withTimeout(c.from('store_wishlist').upsert({ user_id: cloud.account.id, item_id: itemId }));
    else await withTimeout(c.from('store_wishlist').delete().eq('user_id', cloud.account.id).eq('item_id', itemId));
  } catch { /* offline */ }
}

let trendCache: { at: number; rows: { item_id: string; riders: number }[] } = { at: 0, rows: [] };
/** The most wished-for items (real counts from riders' wishlists); empty offline or with no backend. */
export async function trending(): Promise<{ item_id: string; riders: number }[]> {
  if (Date.now() - trendCache.at < 10 * 60e3) return trendCache.rows;
  try {
    const c = await withTimeout(cloud.realtimeClient());
    const { data, error } = await withTimeout(c.rpc('store_trending', { p_limit: 6 }));
    if (error) return [];
    trendCache = { at: Date.now(), rows: (data ?? []) as { item_id: string; riders: number }[] };
    return trendCache.rows;
  } catch {
    return [];
  }
}

let admin: boolean | null = null;
/** true when the signed-in rider is a LEGONRUSH admin (00-core.sql is_admin) */
export async function isAdmin() {
  if (!cloud.account) return false;
  if (admin !== null) return admin;
  try {
    const c = await withTimeout(cloud.realtimeClient());
    const { data, error } = await withTimeout(c.rpc('is_admin'));
    admin = !error && data === true;
  } catch {
    admin = false;
  }
  return admin;
}

/** admin: change an item's price or switch it off (empty prices go back to the catalogue's) */
export async function saveOverride(o: ItemOverride) {
  const c = await withTimeout(cloud.realtimeClient());
  const { error } = await withTimeout(c.from('store_items').upsert({ ...o, updated_at: new Date().toISOString() }));
  if (error) throw error;
  await loadStore(true);
}
/** admin: schedule an item in a store slot */
export async function addRotation(r: RotationRow) {
  const c = await withTimeout(cloud.realtimeClient());
  const { error } = await withTimeout(c.from('store_rotation').insert(r));
  if (error) throw error;
  await loadStore(true);
}
export async function removeRotation(id: number) {
  const c = await withTimeout(cloud.realtimeClient());
  const { error } = await withTimeout(c.from('store_rotation').delete().eq('id', id));
  if (error) throw error;
  await loadStore(true);
}
export const scheduled = () => cache.rotation;
export const overrides = () => cache.items;
