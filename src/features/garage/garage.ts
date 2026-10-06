// Garage rules: what a rider owns, how each bike is set up and looks, what its stats are, and how those
// stats reach the game (rideSpec / rideUpgrades). Pure logic: no HTML here.
import { bikeById, hallById, type BikeSpec } from '../../data/campus';
import { currentWeek, saveProfile, type GarageBike, type Profile, type Upgrade } from '../../state';
import type { BikeStyle } from '../../game/models';
import { postActivity } from '../activity';
import {
  BIKE_ITEMS, ITEMS, MAX_LEVEL, PART_CAP, PART_ITEMS, RARITY, SLOTS, STARTER_BIKES, STATS, bikeItem, bikeLook, item,
  type Item, type PartSlot, type Price, type Stats, type StatKey,
} from './catalog';
import { isDisabled, priceOverride, rarityOverride } from './remote';
import { rotation, seasonState } from './rotation';

// ---------- ownership ----------

/** how many of an item the rider has (bikes, cosmetics: 0 or 1; ride gear: the count) */
export function count(p: Profile, id: string): number {
  const it = item(id);
  if (it?.free) return 1;
  if (it?.gear) return it.gear.helmets ? p.gear.helmets : it.gear.repairKits ? p.gear.repairKits : p.gear.energy;
  const n = p.items[id] ?? 0;
  if (n > 0) return n;
  const [kind, name] = id.split(':');
  // the older shop's lists still count
  if (kind === 'bike') return STARTER_BIKES.includes(name) || p.ownedBikes.includes(name) ? 1 : 0;
  if (kind === 'paint') return p.gear.paints.includes(name) ? 1 : 0;
  if (kind === 'bell') return p.gear.bells.includes(name) ? 1 : 0;
  if (kind === 'light') return p.gear.lights.includes(name) ? 1 : 0;
  if (kind === 'jersey') return name === p.hall || p.gear.jerseys.includes(name) ? 1 : 0;
  if (id === 'part:brakes-rim') return p.gear.brakes >= 1 ? 1 : 0;
  if (id === 'part:brakes-disc') return p.gear.brakes >= 2 ? 1 : 0;
  // your own hall's decal is free
  if (kind === 'decal' && it?.hall && it.hall === p.hall) return 1;
  return 0;
}
export const owned = (p: Profile, id: string) => count(p, id) > 0;

/** adds an item (a bundle adds what is inside); keeps the older lists in step so older screens agree */
export function give(p: Profile, id: string) {
  const it = item(id);
  if (!it) return;
  if (it.kind === 'bundle') {
    for (const x of it.contains ?? []) give(p, x);
    p.coins += it.coins ?? 0;
    return;
  }
  if (it.gear) {
    p.gear.helmets += it.gear.helmets ?? 0;
    p.gear.repairKits += it.gear.repairKits ?? 0;
    p.gear.energy += it.gear.energy ?? 0;
    return;
  }
  p.items[id] = Math.max(1, (p.items[id] ?? 0) + (owned(p, id) ? 0 : 1));
  const [kind, name] = id.split(':');
  if (kind === 'bike' && !p.ownedBikes.includes(name)) p.ownedBikes.push(name);
  if (kind === 'paint' && !p.gear.paints.includes(name)) p.gear.paints.push(name);
  if (kind === 'bell' && !p.gear.bells.includes(name)) p.gear.bells.push(name);
  if (kind === 'light' && !p.gear.lights.includes(name)) p.gear.lights.push(name);
  if (kind === 'jersey' && !p.gear.jerseys.includes(name)) p.gear.jerseys.push(name);
  if (it.slot) g(p).levels[id] ??= 1;
}

/** what the store charges now (admins can change prices) */
export const priceOf = (it: Item): Price | undefined => priceOverride(it.id, it.price);
export const rarityOf = (it: Item) => rarityOverride(it.id) ?? it.rarity;

export type Status = 'equipped' | 'owned' | 'available' | 'limited' | 'locked' | 'soon' | 'gone';
/**
 * equipped / owned; available to buy; limited (on sale for a while); locked (earned: see unlock);
 * soon (coming soon); gone (seasonal or a drop that isn't on sale now)
 */
export function status(p: Profile, it: Item, now = new Date()): Status {
  if (it.gear) return isDisabled(it.id) ? 'gone' : 'available';
  if (it.kind !== 'bundle' && owned(p, it.id)) return equipped(p, it) ? 'equipped' : 'owned';
  if (it.kind === 'bundle' && (it.contains ?? []).every((x) => owned(p, x))) return 'owned';
  if (it.unlock?.soon) return 'soon';
  if (isDisabled(it.id)) return 'gone';
  if (it.hall && it.kind === 'bike') return 'locked';
  const price = priceOf(it);
  if (!price || (!price.coins && !price.diamonds)) return it.id === 'bundle:first-ride' ? (g(p).starter ? 'owned' : 'available') : 'locked';
  if (it.season) return seasonState(it, now).on ? 'limited' : 'gone';
  if (it.dropOnly) {
    const r = rotation(now);
    return r.drop.id === it.id || r.featured.id === it.id ? 'limited' : 'gone';
  }
  return 'available';
}
export const buyable = (s: Status) => s === 'available' || s === 'limited';

/** [progress, goal] towards an earned item, when the game can count it */
export function progress(p: Profile, it: Item): [number, number] | null {
  return it.unlock?.check ? it.unlock.check(p) : null;
}

/** Hands out earned items whose goal is now reached, and hall editions. Returns what is new. Saves when something changed. */
export function syncUnlocks(p: Profile): Item[] {
  const fresh: Item[] = [];
  // Hall Week: remember each week the rider reached the goal
  const w = currentWeek(p);
  if (w.claimed && !g(p).hallWeeks.includes(w.id)) g(p).hallWeeks.push(w.id);
  for (const it of ITEMS) {
    if (owned(p, it.id) || it.unlock?.soon) continue;
    let ok = false;
    if (it.kind === 'bike' && it.hall) ok = it.hall === p.hall && g(p).hallWeeks.length > 0;
    else if (it.unlock?.check && !priceOf(it)) { const [a, b] = it.unlock.check(p); ok = a >= b; }
    if (!ok) continue;
    give(p, it.id);
    fresh.push(it);
    if (RARITY[it.rarity].rank >= 3) postActivity({ kind: 'badge', text: `unlocked the ${RARITY[it.rarity].name} ${it.name}`, ref: it.id });
  }
  if (fresh.length) touch(p);
  return fresh;
}

// ---------- the garage save ----------

const g = (p: Profile) => p.garage;
export function bikeSave(p: Profile, bikeId = p.bike): GarageBike {
  return (g(p).bikes[bikeId] ??= {});
}
/** marks the garage changed (for syncing) and saves */
export function touch(p: Profile) {
  g(p).at = Date.now();
  saveProfile(p);
}

// ---------- looks ----------

/** the bike's look: its own design with the rider's changes on top */
export function styleFor(p: Profile, bikeId = p.bike, draft?: Partial<BikeStyle>): BikeStyle {
  const s: BikeStyle = { ...bikeLook(bikeItem(bikeId)), ...bikeSave(p, bikeId).style, ...draft };
  // the personal decal prints the rider's name
  if (s.decal?.pattern === 'word' && s.decal.text === undefined) s.decal = { ...s.decal, text: (p.name || 'RIDER').toUpperCase().slice(0, 14) };
  return s;
}
/** the colours a bike can be painted: its own colours plus every paint owned */
export function palette(p: Profile, bikeId = p.bike) {
  const own = bikeLook(bikeItem(bikeId));
  const list = [
    { id: 'own:primary', name: 'Original', color: own.primary },
    { id: 'own:secondary', name: 'Original 2', color: own.secondary },
    { id: 'own:accent', name: 'Original trim', color: own.accent },
  ];
  const out = list.filter((x, i) => !list.slice(0, i).some((y) => y.color.toLowerCase() === x.color.toLowerCase()));
  const seen = new Set(out.map((x) => x.color.toLowerCase()));
  for (const it of ITEMS) if (it.kind === 'paint' && owned(p, it.id) && !seen.has(it.color!.toLowerCase())) { out.push({ id: it.id, name: it.name, color: it.color! }); seen.add(it.color!.toLowerCase()); }
  return out;
}

/** is this cosmetic (or bike, part, rider item) the one in use? */
export function equipped(p: Profile, it: Item, bikeId = p.bike): boolean {
  if (it.kind === 'bike') return p.bike === it.id.slice(5);
  if (it.kind === 'part') return fittedPart(p, bikeId, it.slot!).id === it.id;
  if (it.kind === 'bell') return p.gear.bell === it.id.slice(5);
  if (it.kind === 'rider' || it.kind === 'jersey') {
    const r = it.rider!;
    if (r.helmet) return p.look.accessories.includes('helmet') && p.look.helmet.toLowerCase() === r.helmet.toLowerCase();
    const jersey = p.look.jersey || hallById(p.hall).color;
    return jersey.toLowerCase() === (r.jersey ?? '').toLowerCase() && p.look.outfit === (r.outfit ?? p.look.outfit);
  }
  const s = styleFor(p, bikeId);
  if (it.kind === 'paint') return [s.primary, s.secondary, s.accent].some((c) => c.toLowerCase() === it.color!.toLowerCase());
  if (it.kind === 'decal') {
    // compare with the saved decal (the name decal is saved without its text)
    const saved = bikeSave(p, bikeId).style ?? {};
    const d = 'decal' in saved ? saved.decal : bikeLook(bikeItem(bikeId)).decal;
    const e = it.style!.decal!;
    return !!d && d.pattern === e.pattern && (d.text ?? '') === (e.text ?? '') && (d.color ?? '') === (e.color ?? '');
  }
  const patch = it.style ?? {};
  return Object.keys(patch).length > 0 && Object.entries(patch).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v);
}

/** puts a cosmetic on a bike (or the rider) */
export function applyItem(p: Profile, id: string, bikeId = p.bike, slot?: 'primary' | 'secondary' | 'accent') {
  const it = item(id);
  if (!it || !owned(p, id)) return;
  if (it.kind === 'bike') return equipBike(p, id.slice(5));
  if (it.kind === 'part') return fitPart(p, bikeId, id);
  if (it.kind === 'bell') { p.gear.bell = p.gear.bell === id.slice(5) ? '' : id.slice(5); return touch(p); }
  if (it.kind === 'rider' || it.kind === 'jersey') return wear(p, it);
  const b = bikeSave(p, bikeId);
  if (it.kind === 'paint') b.style = { ...b.style, [slot ?? 'primary']: it.color };
  else if (it.kind === 'decal') b.style = { ...b.style, decal: equipped(p, it, bikeId) ? null : { ...it.style!.decal! } };
  else if (it.kind === 'acc') {
    const key = Object.keys(it.style!)[0] as 'basket' | 'rack' | 'bottle';
    b.style = { ...b.style, [key]: !styleFor(p, bikeId)[key] };
  } else b.style = { ...b.style, ...it.style };
  // older screens remember one light for all bikes
  if (it.kind === 'light') p.gear.light = id === 'light:none' ? '' : id.slice(6);
  touch(p);
}
export function setColor(p: Profile, bikeId: string, slot: 'primary' | 'secondary' | 'accent', color: string) {
  const b = bikeSave(p, bikeId);
  b.style = { ...b.style, [slot]: color };
  touch(p);
}
/** back to the bike's own design (parts stay fitted) */
export function resetLook(p: Profile, bikeId: string) {
  bikeSave(p, bikeId).style = {};
  touch(p);
}

/** a rider item changes the rider's look */
function wear(p: Profile, it: Item) {
  const r = it.rider!;
  if (r.helmet) {
    p.look = { ...p.look, helmet: r.helmet, accessories: p.look.accessories.includes('helmet') ? p.look.accessories : [...p.look.accessories, 'helmet'] };
  } else {
    const own = it.kind === 'jersey' && it.hall === p.hall;
    p.look = { ...p.look, outfit: r.outfit ?? p.look.outfit, jersey: own ? '' : r.jersey ?? p.look.jersey };
  }
  touch(p);
}

// ---------- parts and stats ----------

export const partsFor = (slot: PartSlot) => PART_ITEMS.filter((x) => x.slot === slot);
/** the part fitted in a slot (stock when nothing was fitted; brakes default to the best owned) */
export function fittedPart(p: Profile, bikeId: string, slot: PartSlot, parts?: Record<string, string>): Item {
  const id = (parts ?? bikeSave(p, bikeId).parts ?? {})[slot];
  const it = id ? item(id) : undefined;
  if (it && owned(p, it.id)) return it;
  if (slot === 'brakes') {
    const best = partsFor('brakes').filter((x) => owned(p, x.id)).sort((a, b) => (b.brakeLevel ?? 0) - (a.brakeLevel ?? 0) || (b.bonus?.handling ?? 0) - (a.bonus?.handling ?? 0))[0];
    if (best) return best;
  }
  return item(`part:${slot}-stock`)!;
}
export const partLevel = (p: Profile, id: string) => Math.max(1, Math.min(MAX_LEVEL, g(p).levels[id] ?? 1));

/** what a part adds at its level */
export function partBonus(it: Item, level: number): Partial<Stats> {
  const out: Partial<Stats> = { ...it.bonus };
  const grow = SLOTS.find((s) => s.id === it.slot)?.grow ?? {};
  for (const [k, v] of Object.entries(grow) as [StatKey, number][]) out[k] = (out[k] ?? 0) + v * (level - 1);
  return out;
}

/** a bike's stats (0..100) with its parts at their levels; parts add at most PART_CAP to any stat */
export function statsFor(p: Profile, bikeId = p.bike, parts?: Record<string, string>, levels?: Record<string, number>): Stats {
  const base = bikeItem(bikeId).stats!;
  const add: Record<string, number> = {};
  for (const s of SLOTS) {
    const it = fittedPart(p, bikeId, s.id, parts);
    const lv = levels?.[it.id] ?? partLevel(p, it.id);
    for (const [k, v] of Object.entries(partBonus(it, lv))) add[k] = (add[k] ?? 0) + (v ?? 0);
  }
  const out = {} as Stats;
  for (const { id } of STATS) out[id] = Math.round(Math.min(100, base[id] + Math.min(PART_CAP, add[id] ?? 0)));
  return out;
}
/** stats a bike has with no parts upgraded (store pages and comparisons of bikes not owned) */
export const baseStats = (bikeId: string) => ({ ...bikeItem(bikeId).stats! });
export const ratingOf = (s: Stats) => Math.round(STATS.reduce((n, x) => n + s[x.id], 0) / STATS.length);

/** coins to take a part from level to level + 1 */
export function upgradeCost(it: Item, level: number) {
  const base = [250, 350, 500, 700, 900, 1200][RARITY[it.rarity].rank];
  return Math.round((base * [1, 2.2, 4, 6.5][level - 1]) / 50) * 50;
}

export function fitPart(p: Profile, bikeId: string, id: string) {
  const it = item(id);
  if (!it?.slot || !owned(p, id)) return;
  const b = bikeSave(p, bikeId);
  b.parts = { ...b.parts, [it.slot]: id };
  syncGear(p);
  touch(p);
}

/** upgrades a part one level if the rider can pay; returns the new level or 0 */
export function upgradePart(p: Profile, id: string, pay: (coins: number) => boolean) {
  const it = item(id);
  if (!it?.slot || !owned(p, id)) return 0;
  const lv = partLevel(p, id);
  if (lv >= MAX_LEVEL || !pay(upgradeCost(it, lv))) return 0;
  g(p).levels[id] = lv + 1;
  if (lv + 1 === MAX_LEVEL) postActivity({ kind: 'badge', text: `maxed out ${it.name} to level V`, ref: id });
  touch(p);
  return lv + 1;
}

export function equipBike(p: Profile, bikeId: string) {
  if (!owned(p, 'bike:' + bikeId)) return;
  p.bike = bikeId;
  syncGear(p);
  touch(p);
}

/** the brake button follows the brakes fitted to the bike being ridden */
export function syncGear(p: Profile) {
  p.gear.brakes = fittedPart(p, p.bike, 'brakes').brakeLevel ?? 0;
}

// ---------- the ride ----------

const five = (n: number) => 1 + n / 25;
const step = (n: number) => Math.max(0, Math.min(3, Math.floor((n - 40) / 20)));
/** The bike the game rides: the Garage's stats turned into the game's 1..5 numbers. Prize rides don't use this. */
export function rideSpec(p: Profile): BikeSpec {
  const s = statsFor(p);
  const b = bikeById(p.bike);
  return { ...b, speed: five(s.speed), acceleration: five(s.accel), handling: five(s.handling), endurance: five(s.endurance) };
}
/** grip (terrain) and boost steps 0..3 for Game.setUpgrades; speed is already in rideSpec */
export function rideUpgrades(p: Profile): Record<Upgrade, number> {
  const s = statsFor(p);
  return { speed: step(s.speed), grip: step(s.terrain), boost: step(s.boost) };
}

// ---------- selling ----------

/** coins back for selling an item: a third of a coin price. Starters, earned items, diamond items and the bike you ride can't be sold. */
export function sellValue(p: Profile, it: Item) {
  const price = it.price;
  if (!price?.coins || price.diamonds || it.free || it.gear || it.kind === 'bundle' || !owned(p, it.id) || (p.items[it.id] ?? 0) < 1) return 0;
  if (it.kind === 'bike' && p.bike === it.id.slice(5)) return 0;
  if (it.kind === 'jersey' && it.hall === p.hall) return 0;
  return Math.round(price.coins / 3 / 10) * 10;
}
export function sell(p: Profile, id: string) {
  const it = item(id);
  if (!it) return 0;
  const v = sellValue(p, it);
  if (!v) return 0;
  p.items[id] = 0;
  const [kind, name] = id.split(':');
  if (kind === 'bike') p.ownedBikes = p.ownedBikes.filter((x) => x !== name);
  if (kind === 'paint') p.gear.paints = p.gear.paints.filter((x) => x !== name);
  if (kind === 'bell') { p.gear.bells = p.gear.bells.filter((x) => x !== name); if (p.gear.bell === name) p.gear.bell = ''; }
  if (kind === 'light') p.gear.lights = p.gear.lights.filter((x) => x !== name);
  if (kind === 'jersey') p.gear.jerseys = p.gear.jerseys.filter((x) => x !== name);
  if (id === 'part:brakes-rim' || id === 'part:brakes-disc') p.gear.brakes = Math.min(p.gear.brakes, id === 'part:brakes-rim' ? 0 : 1);
  delete g(p).levels[id];
  // take a sold cosmetic or part off every bike
  for (const b of Object.values(g(p).bikes)) {
    if (b.parts) for (const [k, v2] of Object.entries(b.parts)) if (v2 === id) delete b.parts[k];
    if (b.style && it.style) for (const k of Object.keys(it.style)) delete (b.style as Record<string, unknown>)[k];
    if (b.style && it.kind === 'paint') for (const k of ['primary', 'secondary', 'accent'] as const) if (b.style[k]?.toLowerCase() === it.color!.toLowerCase()) delete b.style[k];
  }
  p.coins += v;
  syncGear(p);
  touch(p);
  return v;
}

// ---------- loadouts ----------

export function saveLoadout(p: Profile, i: number, name: string) {
  g(p).loadouts[i] = { name: name.trim().slice(0, 18) || `Setup ${i + 1}`, bike: p.bike, parts: { ...(bikeSave(p).parts ?? {}) } };
  touch(p);
}
export function useLoadout(p: Profile, i: number) {
  const l = g(p).loadouts[i];
  if (!l || !owned(p, 'bike:' + l.bike)) return false;
  p.bike = l.bike;
  const b = bikeSave(p, l.bike);
  b.parts = Object.fromEntries(Object.entries(l.parts).filter(([, id]) => owned(p, id)));
  syncGear(p);
  touch(p);
  return true;
}
export function clearLoadout(p: Profile, i: number) {
  g(p).loadouts[i] = null;
  touch(p);
}

// ---------- wishlist ----------

export const wished = (p: Profile, id: string) => g(p).wishlist.includes(id);
export function toggleWish(p: Profile, id: string) {
  const w = g(p).wishlist;
  const i = w.indexOf(id);
  if (i >= 0) w.splice(i, 1); else w.push(id);
  touch(p);
  return i < 0;
}

// ---------- counts for menus ----------

export function collectionCounts(p: Profile) {
  const bikes = BIKE_ITEMS.filter((b) => owned(p, b.id)).length;
  const kinds = ITEMS.filter((i) => !i.gear && i.kind !== 'bundle');
  return { bikes, bikesTotal: BIKE_ITEMS.length, items: kinds.filter((i) => owned(p, i.id)).length, itemsTotal: kinds.length };
}
