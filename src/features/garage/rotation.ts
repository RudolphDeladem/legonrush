// What the store shows right now: the weekly featured collection, the daily limited drop, the free daily
// item and seasonal items. Worked out from the date (everyone sees the same), unless an admin scheduled
// something else (remote.ts).
import { seeded, weekId } from '../../state';
import { ITEMS, item, type Item } from './catalog';
import { liveRotation } from './remote';

export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA');
const midnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const nextMonday = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 - ((d.getDay() + 6) % 7));

/** the featured collection rotates every Monday */
const FEATURED = ['bundle:gold-rush', 'bundle:sunset', 'bundle:campus-racer', 'bundle:night', 'bundle:explorer'];
/** limited drops: one a day, only sold while they are the drop */
const DROPS = ['bike:night-racer', 'decal:flames', 'wheel:disc', 'rider:helmet-chrome'];
/** the free daily item: a small cosmetic or a few coins */
export type DailyGift = { id: string; name: string; coins?: number; item?: string; gear?: Item['gear'] };
const DAILY: DailyGift[] = [
  { id: 'decal:campus-stripe', name: 'Campus Stripe decal', item: 'decal:campus-stripe' },
  { id: 'decal:dots', name: 'Polka decal', item: 'decal:dots' },
  { id: 'paint:mint', name: 'Mint paint', item: 'paint:mint' },
  { id: 'tyre:tan', name: 'Gum-wall tyres', item: 'tyre:tan' },
  { id: 'grips:accent', name: 'Colour grips & pedals', item: 'grips:accent' },
  { id: 'coins:100', name: '100 Rush Coins', coins: 100 },
  { id: 'gear:energy', name: 'Energy drink', gear: { energy: 1 } },
  { id: 'gear:helmet1', name: 'Crash helmet', gear: { helmets: 1 } },
  { id: 'coins:150', name: '150 Rush Coins', coins: 150 },
];

/** is today inside an item's yearly season? and when does the season end */
export function seasonState(it: Item, now = new Date()): { on: boolean; ends?: Date; starts?: Date } {
  if (!it.season) return { on: true };
  const y = now.getFullYear();
  const md = (s: string, year: number) => { const [m, d] = s.split('-').map(Number); return new Date(year, m - 1, d); };
  const wraps = it.season.to < it.season.from;
  for (const year of [y - 1, y, y + 1]) {
    const from = md(it.season.from, year);
    const to = md(it.season.to, wraps ? year + 1 : year);
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
    if (now >= from && now < end) return { on: true, ends: end };
  }
  let start = md(it.season.from, y);
  if (start <= now) start = md(it.season.from, y + 1);
  return { on: false, starts: start };
}

export interface Rotation {
  featured: Item;
  featuredEnds: Date;
  drop: Item;
  dropEnds: Date;
  daily: DailyGift;
  /** limited things ending within a week, soonest first */
  ending: { item: Item; ends: Date }[];
  /** items added in the last 45 days */
  fresh: Item[];
}

export function rotation(now = new Date()): Rotation {
  const week = weekId(now);
  const day = localDay(now);
  const rf = seeded('featured:' + week)(), rd = seeded('drop:' + day)(), rg = seeded('gift:' + day)();
  const pick = <T,>(list: T[], r: number) => list[Math.floor(r * list.length) % list.length];
  const t = now.getTime();
  // an admin's schedule wins over the automatic one
  const sf = liveRotation('featured', t)[0], sd = liveRotation('drop', t)[0], sg = liveRotation('daily', t)[0];
  const featured = (sf && item(sf.item_id)) || item(pick(FEATURED, rf))!;
  const drop = (sd && item(sd.item_id)) || item(pick(DROPS, rd))!;
  const daily = (sg && DAILY.find((g) => g.id === sg.item_id)) || (sg && item(sg.item_id) ? { id: sg.item_id, name: item(sg.item_id)!.name, item: sg.item_id } : null) || pick(DAILY, rg);
  const featuredEnds = sf ? new Date(sf.ends_at) : nextMonday(now);
  const dropEnds = sd ? new Date(sd.ends_at) : midnight(now);
  const ending: { item: Item; ends: Date }[] = [{ item: drop, ends: dropEnds }];
  if (featured.dropOnly) ending.push({ item: featured, ends: featuredEnds });
  for (const r of liveRotation('ending', t)) { const it = item(r.item_id); if (it) ending.push({ item: it, ends: new Date(r.ends_at) }); }
  for (const it of ITEMS) {
    const s = seasonState(it, now);
    if (it.season && s.on && s.ends && s.ends.getTime() - t < 21 * 864e5) ending.push({ item: it, ends: s.ends });
  }
  ending.sort((a, b) => a.ends.getTime() - b.ends.getTime());
  const fresh = ITEMS.filter((i) => i.added && t - Date.parse(i.added) < 45 * 864e5 && i.kind !== 'bundle');
  return { featured, featuredEnds, drop, dropEnds, daily, ending, fresh };
}

/** "2d 4h", "5h 12m", "12:04" */
export function countdown(to: Date, now = Date.now()) {
  const s = Math.max(0, Math.floor((to.getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
