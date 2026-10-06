// Campus collection: the places you have reached (profile.visited, filled in when an Explore
// ride arrives) and the official routes you have finished, grouped, with rewards to claim.
import type { Place } from '../../game/campusmap';
import type { Profile } from '../../state';
import { grant, type Reward } from '../inventory';
import type { CampusMap, CollectionGroup } from './campus';
import { MAP_ROUTES } from './routes';

/** XP for each newly discovered place (hidden spots are worth more) */
export const DISCOVER_XP = 50;
export const HIDDEN_XP = 120;

export interface GroupProgress { group: CollectionGroup; found: Place[]; total: number }
export interface Progress { groups: GroupProgress[]; routes: { found: number; total: number }; found: number; total: number }

const visited = (p: Profile) => new Set(p.visited ?? []);

export function progress(map: CampusMap, p: Profile): Progress {
  const v = visited(p);
  const groups = map.collection.map((group) => ({ group, found: group.places.filter((pl) => v.has(pl.name)), total: group.places.length }));
  const routes = { found: MAP_ROUTES.filter((r) => p.bestTimes?.[r.id] !== undefined).length, total: MAP_ROUTES.length };
  const found = groups.reduce((n, g) => n + g.found.length, 0) + routes.found;
  const total = groups.reduce((n, g) => n + g.total, 0) + routes.total;
  return { groups, routes, found, total };
}

export const isHidden = (map: CampusMap, name: string) => map.collection.some((g) => g.hidden && g.places.some((pl) => pl.name === name));
export const inCollection = (map: CampusMap, name: string) => map.collection.some((g) => g.places.some((pl) => pl.name === name));

/**
 * Places reached since the map was last opened: pays their discovery XP once and remembers them.
 * Returns what was new (for the "Discovered" banner).
 */
export function creditDiscoveries(map: CampusMap, p: Profile): { place: Place; xp: number; hidden: boolean }[] {
  p.mapDex ??= { seen: [], claimed: [] };
  const seen = new Set(p.mapDex.seen);
  const fresh: { place: Place; xp: number; hidden: boolean }[] = [];
  for (const g of map.collection) {
    for (const pl of g.places) {
      if (seen.has(pl.name) || !(p.visited ?? []).includes(pl.name)) continue;
      seen.add(pl.name);
      fresh.push({ place: pl, xp: g.hidden ? HIDDEN_XP : DISCOVER_XP, hidden: !!g.hidden });
    }
  }
  if (!fresh.length) return fresh;
  p.mapDex.seen = [...seen];
  grant(p, { xp: fresh.reduce((n, f) => n + f.xp, 0) });
  return fresh;
}

export interface Milestone { id: string; label: string; goal: number; got: number; reward: Reward; claimed: boolean; ready: boolean }

const TOTAL_STEPS: [number, Reward][] = [
  [5, { coins: 150 }],
  [15, { coins: 400, xp: 150 }],
  [30, { coins: 800, diamonds: 2 }],
  [50, { coins: 1500, diamonds: 4 }],
];

/** the collection's rewards: steps on the total, each group completed, and the whole set */
export function milestones(map: CampusMap, p: Profile): Milestone[] {
  const pr = progress(map, p);
  const claimed = new Set(p.mapDex?.claimed ?? []);
  const out: Milestone[] = [];
  const add = (id: string, label: string, goal: number, got: number, reward: Reward) =>
    out.push({ id: `${map.campus.id}:${id}`, label, goal, got: Math.min(goal, got), reward, claimed: claimed.has(`${map.campus.id}:${id}`), ready: got >= goal });
  for (const [n, r] of TOTAL_STEPS) if (n < pr.total) add(`total-${n}`, `Discover ${n} places or routes`, n, pr.found, r);
  for (const g of pr.groups) add(`group-${g.group.id}`, `All ${g.group.name.toLowerCase()}`, g.total, g.found.length, g.group.hidden ? { coins: 600, diamonds: 3 } : { coins: 400, diamonds: 1 });
  add('group-routes', 'Every official route', pr.routes.total, pr.routes.found, { coins: 500, diamonds: 2 });
  add('complete', `The whole of ${map.campus.short}`, pr.total, pr.found, { coins: 3000, diamonds: 10 });
  return out;
}

/** pays a collection reward once; returns it, or null if it isn't ready or was already paid */
export function claimMilestone(map: CampusMap, p: Profile, id: string): Reward | null {
  const m = milestones(map, p).find((x) => x.id === id);
  if (!m || !m.ready || m.claimed) return null;
  p.mapDex ??= { seen: [], claimed: [] };
  p.mapDex.claimed.push(id);
  return grant(p, m.reward);
}

export const readyCount = (map: CampusMap, p: Profile) => milestones(map, p).filter((m) => m.ready && !m.claimed).length;
