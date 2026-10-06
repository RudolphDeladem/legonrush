// The Garage & Store catalogue: every bike, part, cosmetic and rider item, what it does and how to get it.
// Works fully offline; admins can change prices and rotations from Supabase (see remote.ts, 40-store.sql).
//
// Item ids are "<kind>:<name>" and are what profile.items counts (features/inventory.ts), so any system
// can hand one out with grant(p, { items: ['decal:sunset'] }). Bikes are "bike:<bike id>" and the bike id
// is what profile.bike holds.
import { GARAGE_BIKES, HALLS, BIKES, type BikeSpec } from '../../data/campus';
import { SHOP, levelFor, type Profile } from '../../state';
import type { BikeStyle } from '../../game/models';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITY: Record<Rarity, { name: string; color: string; rank: number }> = {
  common: { name: 'Common', color: '#8a94a6', rank: 0 },
  uncommon: { name: 'Uncommon', color: '#2e9e5b', rank: 1 },
  rare: { name: 'Rare', color: '#2f7bea', rank: 2 },
  epic: { name: 'Epic', color: '#8b46d9', rank: 3 },
  legendary: { name: 'Legendary', color: '#d99a00', rank: 4 },
  mythic: { name: 'Mythic', color: '#e0384b', rank: 5 },
};
export const RARITIES = Object.keys(RARITY) as Rarity[];

export type StatKey = 'speed' | 'accel' | 'handling' | 'endurance' | 'boost' | 'terrain';
export type Stats = Record<StatKey, number>;
export const STATS: { id: StatKey; name: string; short: string; text: string }[] = [
  { id: 'speed', name: 'Speed', short: 'SPD', text: 'Top speed on the road.' },
  { id: 'accel', name: 'Acceleration', short: 'ACC', text: 'How fast you get back up to speed.' },
  { id: 'handling', name: 'Handling', short: 'HDL', text: 'How quick and steady lane changes are.' },
  { id: 'endurance', name: 'Endurance', short: 'END', text: 'Boosts tire your legs less.' },
  { id: 'boost', name: 'Boost', short: 'BST', text: 'Boosts last longer.' },
  { id: 'terrain', name: 'Terrain', short: 'TER', text: 'Grip in the rain and on rough ground.' },
];
const st = (speed: number, accel: number, handling: number, endurance: number, boost: number, terrain: number): Stats => ({ speed, accel, handling, endurance, boost, terrain });

export type BikeClass = 'city' | 'speed' | 'mtb' | 'race' | 'cruiser' | 'special';
export const CLASSES: Record<BikeClass, { name: string; text: string }> = {
  city: { name: 'City', text: 'Balanced: exploring, long rides, everyday campus riding.' },
  speed: { name: 'Speed', text: 'High top speed and acceleration; less handling and endurance.' },
  mtb: { name: 'MTB', text: 'Handling, stability and grip on rough ground.' },
  race: { name: 'Race', text: 'Competitive: speed, acceleration and handling.' },
  cruiser: { name: 'Cruiser', text: 'Smooth and stylish, made for Vibe Rides.' },
  special: { name: 'Special', text: 'Event and limited editions.' },
};

/** where an item comes from, for "how to get it" and the store's Source filter */
export type Source = 'store' | 'diamonds' | 'challenge' | 'event' | 'explore' | 'treasure' | 'hall' | 'mission' | 'level' | 'limited' | 'starter';
export const SOURCES: Record<Source, string> = {
  store: 'Store', diamonds: 'Diamonds', challenge: 'Challenges', event: 'Events', explore: 'Exploration', treasure: 'Treasure',
  hall: 'Hall', mission: 'Missions', level: 'Progression', limited: 'Limited time', starter: 'Starter',
};

export type Kind = 'bike' | 'part' | 'paint' | 'finish' | 'decal' | 'wheel' | 'tyre' | 'bars' | 'seat' | 'grips' | 'light' | 'acc' | 'bell' | 'rider' | 'jersey' | 'gear' | 'bundle';
export type PartSlot = 'frame' | 'wheels' | 'tires' | 'gearing' | 'brakes' | 'boost';
export const SLOTS: { id: PartSlot; name: string; improves: string; grow: Partial<Stats> }[] = [
  { id: 'frame', name: 'Frame', improves: 'Speed and endurance', grow: { speed: 1.5, endurance: 1.5 } },
  { id: 'wheels', name: 'Wheels', improves: 'Acceleration', grow: { accel: 2 } },
  { id: 'tires', name: 'Tyres', improves: 'Handling and terrain', grow: { handling: 1, terrain: 2 } },
  { id: 'gearing', name: 'Gearing', improves: 'Speed and acceleration', grow: { speed: 1.5, accel: 1 } },
  { id: 'brakes', name: 'Brakes', improves: 'Handling (and the brake button)', grow: { handling: 2 } },
  { id: 'boost', name: 'Boost system', improves: 'Boost', grow: { boost: 2.5 } },
];
/** parts can be upgraded from level I to V; each level adds the slot's growth */
export const MAX_LEVEL = 5;
/** parts can never add more than this to a stat, so coins alone can't make a rider unbeatable */
export const PART_CAP = 20;

export interface Price { coins?: number; diamonds?: number }
/** how to get an item that isn't simply bought; check returns [progress, goal] */
export interface Unlock { source: Source; text: string; check?: (p: Profile) => [number, number]; soon?: boolean }

export interface Item {
  id: string;
  kind: Kind;
  name: string;
  blurb: string;
  rarity: Rarity;
  /** bought in the store; missing means earned (see unlock) */
  price?: Price;
  unlock?: Unlock;
  /** owned by everyone from the start */
  free?: boolean;
  /** a store collection/theme it belongs to */
  collection?: string;
  /** on sale only between these dates every year (MM-DD, inclusive; may wrap the new year) */
  season?: { from: string; to: string; name: string };
  /** only sold while it's the store's limited drop or featured */
  dropOnly?: boolean;
  /** new arrival since this date (YYYY-MM-DD) */
  added?: string;
  /** hall it belongs to (hall editions and hall cosmetics) */
  hall?: string;
  // bikes
  cls?: BikeClass;
  stats?: Stats;
  look?: Partial<BikeStyle>;
  // performance parts
  slot?: PartSlot;
  bonus?: Partial<Stats>;
  /** brake button strength this brake gives (1 rim, 2 disc) */
  brakeLevel?: number;
  // cosmetics: what it changes on the bike's look
  style?: Partial<BikeStyle>;
  color?: string;
  // rider items: what it changes on the rider's look
  rider?: { helmet?: string; outfit?: 'jersey' | 'hall-tee' | 'hoodie' | 'kente'; jersey?: string };
  // ride gear (used up): what buying it adds
  gear?: { helmets?: number; repairKits?: number; energy?: number };
  // bundles: the items inside
  contains?: string[];
  /** coins inside a bundle */
  coins?: number;
}

// ---------- unlock checks ----------
const has = (n: number, goal: number): [number, number] => [Math.min(n, goal), goal];
const stat = (k: keyof Profile['stats']) => (p: Profile) => p.stats?.[k] ?? 0;
const U = {
  places: (n: number): Unlock => ({ source: 'explore', text: `Discover ${n} places on campus`, check: (p) => has(p.visited.length, n) }),
  treasure: (n: number): Unlock => ({ source: 'treasure', text: `Find ${n} treasures`, check: (p) => has(stat('treasure')(p), n) }),
  wins: (n: number): Unlock => ({ source: 'challenge', text: `Win ${n} races`, check: (p) => has(p.wins, n) }),
  races: (n: number): Unlock => ({ source: 'challenge', text: `Finish ${n} races`, check: (p) => has(stat('races')(p), n) }),
  level: (n: number): Unlock => ({ source: 'level', text: `Reach level ${n}`, check: (p) => has(levelFor(p.xp), n) }),
  nearMiss: (n: number): Unlock => ({ source: 'challenge', text: `Have ${n} near misses`, check: (p) => has(stat('nearMiss')(p), n) }),
  nightKm: (n: number): Unlock => ({ source: 'challenge', text: `Ride ${n} km at night`, check: (p) => has(Math.floor(stat('nightKm')(p)), n) }),
  missions: (n: number): Unlock => ({ source: 'mission', text: `Complete ${n} campus missions`, check: (p) => has(stat('missions')(p), n) }),
  challenges: (n: number): Unlock => ({ source: 'mission', text: `Claim ${n} daily or weekly challenges`, check: (p) => has(stat('challenges')(p), n) }),
  km: (n: number): Unlock => ({ source: 'challenge', text: `Ride ${n} km in total`, check: (p) => has(Math.floor(p.totalDistance / 1000), n) }),
  event: (name: string): Unlock => ({ source: 'event', text: name }),
};

// ---------- bikes ----------
const look = (frame: BikeStyle['frame'], wheel: BikeStyle['wheel'], bars: BikeStyle['bars'], seat: BikeStyle['seat'], primary: string, secondary: string, accent: string, more: Partial<BikeStyle> = {}): Partial<BikeStyle> =>
  ({ frame, wheel, bars, seat, primary, secondary, accent, ...more });
const bike = (id: string, name: string, cls: BikeClass, rarity: Rarity, stats: Stats, lk: Partial<BikeStyle>, blurb: string, extra: Partial<Item> = {}): Item =>
  ({ id: 'bike:' + id, kind: 'bike', name, cls, rarity, stats, look: lk, blurb, ...extra });

const HALL_EDITION_TEXT: Record<string, string> = {
  legon: 'In the orange of the hall that gave the campus its name.',
  akuafo: 'Green and gold, for the farmers’ hall.',
  commonwealth: 'Vandal red. Loud, proud and fast off the line.',
  volta: 'Blue and gold, smooth as the river it is named after.',
  sarbah: 'Deep Sarbah blue with a clean white accent.',
  'jean-nelson': 'Teal and white, for JNA riders.',
  kwapong: 'Kwapong magenta with silver trim.',
  sey: 'Olive and gold for Sey Hall.',
  limann: 'Limann violet-blue with a bright accent.',
};

export const BIKE_ITEMS: Item[] = [
  // the three starter bikes everyone has
  bike('city', 'Legon City', 'city', 'common', st(50, 55, 60, 65, 50, 50), look('diamond', 'spoke', 'flat', 'race', '#f2c230', '#f2c230', '#c9ccd2'), 'The everyday campus bike. Good at everything, great at getting you to lectures.', { free: true }),
  bike('speed', 'Rush Speed', 'speed', 'common', st(78, 60, 45, 45, 58, 35), look('diamond', 'deep', 'drop', 'race', '#e04848', '#e04848', '#1a1a1a'), 'Light and twitchy. Point it down University Avenue and hold on.', { free: true }),
  bike('cruiser', 'Campus Cruiser', 'cruiser', 'common', st(40, 52, 72, 70, 45, 55), look('step', 'spoke', 'riser', 'comfy', '#3bb6e8', '#3bb6e8', '#f2f2ee', { tyre: '#b07a45' }), 'Sit up, slow down and enjoy the ride. Made for Vibe Rides.', { free: true }),
  // the older garage bikes
  bike('bmx', 'Trail BMX', 'mtb', 'uncommon', st(48, 75, 74, 50, 50, 70), look('mtb', 'fat', 'riser', 'race', '#2ecc71', '#1a1a1a', '#f2f2ee'), 'Quick off the line and happy on rough ground.', { price: { coins: 1200 } }),
  bike('pro', 'Pro Racer', 'race', 'rare', st(85, 72, 66, 52, 62, 38), look('diamond', 'deep', 'drop', 'race', '#f5f5f5', '#f5f5f5', '#d7263d'), 'Built for records. Stiff, light and very fast.', { price: { coins: 3000 } }),
  bike('sunset', 'Sunset Bike', 'special', 'epic', st(72, 70, 68, 60, 62, 48), look('diamond', 'deep', 'drop', 'race', '#ff8c42', '#c2366b', '#ffcf4a', { decal: { pattern: 'sunset' } }), 'Awarded for finishing Sunset Rush while it is live.', { unlock: U.event('Finish Sunset Rush while it is live (Events)') }),
  bike('neon', 'Neon Bike', 'special', 'epic', st(72, 76, 66, 58, 66, 45), look('diamond', 'deep', 'flat', 'race', '#39ff14', '#111418', '#39ff14', { finish: 'neon', light: '#39ff14', glow: true }), 'Awarded for finishing Night Rush while it is live.', { unlock: U.event('Finish Night Rush while it is live (Events)') }),
  // new bikes
  bike('x1', 'LEGONRUSH X1', 'race', 'rare', st(80, 70, 70, 58, 64, 42), look('diamond', 'deep', 'drop', 'race', '#1b2a57', '#1b2a57', '#f5c518', { decal: { pattern: 'word', text: 'LEGONRUSH' }, finish: 'metallic' }), 'The flagship. Navy and gold, balanced for racing and riding all day.', { price: { coins: 2500 }, added: '2026-10-01' }),
  bike('eng-sprint', 'Engineering Sprint', 'race', 'rare', st(88, 82, 62, 54, 62, 40), look('diamond', 'disc', 'drop', 'race', '#f2f2ee', '#1a1a1a', '#ff7a1a', { decal: { pattern: 'speed', color: '#ff7a1a' } }), 'Built for riders who don’t believe in taking the scenic route.', { price: { coins: 3500 }, added: '2026-10-01', collection: 'campus-racer' }),
  bike('balme', 'Balme Scholar', 'city', 'uncommon', st(55, 58, 64, 72, 50, 55), look('diamond', 'spoke', 'flat', 'comfy', '#1f6b45', '#1f6b45', '#d8c9a3', { basket: true, tyre: '#b07a45' }), 'A sensible bike with a basket for your books. Quiet, comfortable, goes forever.', { price: { coins: 900 } }),
  bike('ridge', 'Ridge Trail', 'mtb', 'uncommon', st(50, 62, 72, 64, 48, 82), look('mtb', 'fat', 'riser', 'race', '#6b4f2a', '#1a1a1a', '#f2b705'), 'Fat tyres and a tough frame for the rough paths behind the halls.', { price: { coins: 1500 } }),
  bike('kente', 'Kente Classic', 'cruiser', 'rare', st(46, 55, 76, 74, 50, 58), look('step', 'spoke', 'riser', 'comfy', '#111111', '#0f7b3a', '#f2b705', { decal: { pattern: 'kente' }, tyre: '#b07a45' }), 'Woven colours and an easy ride. Turns heads at every Vibe Ride.', { price: { coins: 2200 } }),
  bike('botanical', 'Botanical Cruiser', 'cruiser', 'rare', st(45, 55, 78, 76, 50, 62), look('step', 'spoke', 'riser', 'comfy', '#2e8b3a', '#a3d977', '#f2f2ee', { basket: true }), 'Green as the Botanical Gardens. Unlocked by riders who explore.', { unlock: U.places(25) }),
  bike('night-racer', 'Night Racer', 'speed', 'epic', st(86, 74, 58, 52, 70, 38), look('diamond', 'deep', 'drop', 'race', '#141824', '#141824', '#3ad6ff', { finish: 'matte', light: '#3ad6ff', glow: true }), 'Matte black with a blue glow. Only sold as a limited drop.', { price: { coins: 2000 }, dropOnly: true, added: '2026-10-01' }),
  bike('great-hall', 'Great Hall Tourer', 'city', 'rare', st(62, 62, 68, 78, 55, 58), look('diamond', 'spoke', 'flat', 'comfy', '#7a1f2b', '#7a1f2b', '#d7b56d', { rack: true }), 'A touring bike with a rack and bag, for riders who have seen the whole campus.', { unlock: U.level(12) }),
  bike('gold-rush', 'Gold Rush', 'race', 'legendary', st(90, 84, 72, 62, 72, 45), look('diamond', 'deep', 'drop', 'race', '#d4a017', '#111111', '#f5c518', { finish: 'metallic', decal: { pattern: 'stripe', color: '#111111' } }), 'Solid gold looks, serious speed. The bike everyone notices.', { price: { coins: 6000 }, collection: 'gold-rush' }),
  bike('diamond', 'Diamond Series', 'special', 'mythic', st(90, 86, 78, 66, 74, 50), look('diamond', 'disc', 'drop', 'race', '#bfe6ff', '#e8f6ff', '#ffffff', { finish: 'chrome' }), 'Chrome and ice. The rarest bike you can buy.', { price: { diamonds: 400 } }),
  bike('speed-demon', 'Speed Demon', 'speed', 'legendary', st(94, 80, 60, 54, 74, 36), look('diamond', 'disc', 'drop', 'race', '#b0121b', '#111111', '#ff7a1a', { decal: { pattern: 'flames', color: '#ff7a1a' } }), 'Earned, never bought: for riders who win again and again.', { unlock: U.wins(50) }),
  bike('explorer', 'Campus Explorer', 'mtb', 'epic', st(56, 66, 78, 72, 56, 90), look('mtb', 'fat', 'riser', 'race', '#3a5f3a', '#1a1a1a', '#f2b705', { rack: true, light: '#fff6d8' }), 'For riders who have been everywhere on campus and want to go again.', { unlock: U.places(60) }),
  bike('treasure', 'Treasure Bike', 'special', 'mythic', st(86, 82, 80, 72, 76, 70), look('diamond', 'deep', 'flat', 'race', '#c99a2e', '#3b2a1a', '#ffd21f', { finish: 'metallic', decal: { pattern: 'map', color: '#3b2a1a' } }), 'Extremely rare. Only the most patient treasure hunters ride one.', { unlock: U.treasure(50) }),
  bike('hall-champion', 'Hall Champion', 'special', 'legendary', st(88, 82, 78, 66, 72, 55), look('diamond', 'deep', 'drop', 'race', '#ffd21f', '#0b1530', '#ffffff', { finish: 'metallic', decal: { pattern: 'word', text: 'CHAMPION', color: '#0b1530' } }), 'Awarded to riders of the hall that wins the Hall Championship.', { unlock: { source: 'hall', text: 'Ride for the hall that wins the Hall Championship' } }),
  bike('freshers', 'Freshers Bike', 'special', 'rare', st(64, 66, 70, 66, 60, 55), look('diamond', 'spoke', 'flat', 'race', '#7b3fc4', '#7b3fc4', '#ffd21f', { decal: { pattern: 'word', text: 'FRESHERS' } }), 'Welcome to Legon. On sale during Freshers season only.', { price: { coins: 1500 }, season: { from: '09-01', to: '10-31', name: 'Freshers season' }, added: '2026-09-01' }),
  bike('independence', 'Independence Rider', 'special', 'epic', st(74, 72, 70, 64, 64, 50), look('diamond', 'deep', 'drop', 'race', '#c8102e', '#0f7b3a', '#f2b705', { decal: { pattern: 'stripe', color: '#f2b705' } }), 'Red, gold and green for the 6th of March. On sale around Independence Day.', { price: { coins: 2500 }, season: { from: '03-01', to: '03-14', name: 'Independence week' } }),
  bike('christmas', 'Christmas Cruiser', 'cruiser', 'epic', st(50, 58, 78, 76, 56, 60), look('step', 'spoke', 'riser', 'comfy', '#b3121f', '#f2f2ee', '#1f8a3b', { basket: true, light: '#ffc21a', glow: true }), 'Festive red with a basket for gifts. On sale over Christmas.', { price: { coins: 2000 }, season: { from: '12-10', to: '01-06', name: 'Christmas' } }),
  // one edition per real hall, unlocked by riding for your hall
  ...HALLS.filter((h) => h.id !== 'none').map((h) => bike(`hall-${h.id}`, `${h.short === 'Vandals' ? 'Commonwealth' : h.short === 'JNA' ? 'JNA' : h.short} Edition`, 'city', 'rare', st(66, 66, 68, 68, 58, 58),
    look('diamond', 'deep', 'flat', 'race', h.color, h.color, '#f2f2ee', { decal: { pattern: 'hall', text: h.short.toUpperCase(), color: '#f2f2ee' } }),
    HALL_EDITION_TEXT[h.id] ?? `${h.name} colours.`,
    { hall: h.id, unlock: { source: 'hall', text: `${h.name} riders: complete Hall Week once (ride ${10} km for your hall in a week)` } })),
];

// ---------- performance parts ----------
const part = (slot: PartSlot, id: string, name: string, rarity: Rarity, bonus: Partial<Stats>, blurb: string, extra: Partial<Item> = {}): Item =>
  ({ id: `part:${slot}-${id}`, kind: 'part', slot, name, rarity, bonus, blurb, ...extra });
export const PART_ITEMS: Item[] = [
  part('frame', 'stock', 'Stock frame', 'common', {}, 'The frame your bike came with.', { free: true }),
  part('frame', 'alloy', 'Alloy Lite', 'uncommon', { speed: 3, endurance: 2 }, 'A lighter alloy frame: a little faster and easier on the legs.', { price: { coins: 700 } }),
  part('frame', 'carbon', 'Carbon Pro', 'rare', { speed: 5, endurance: 3 }, 'Stiff, light carbon. Every pedal stroke goes into speed.', { price: { coins: 1600 } }),
  part('frame', 'gold', 'Gold Rush frame', 'legendary', { speed: 6, endurance: 5 }, 'Part of the Gold Rush collection.', { price: { diamonds: 120 }, collection: 'gold-rush' }),
  part('wheels', 'stock', 'Stock wheels', 'common', {}, 'Standard 32-spoke wheels.', { free: true }),
  part('wheels', 'aero7', 'Aero 7', 'uncommon', { accel: 4 }, 'Light aero rims that spin up fast.', { price: { coins: 800 }, collection: 'campus-racer' }),
  part('wheels', 'deep', 'Deep Carbon', 'rare', { accel: 6, speed: 1 }, 'Deep carbon rims: quick to accelerate and they hold speed.', { price: { coins: 1500 } }),
  part('wheels', 'diamond', 'Diamond Wheels', 'epic', { accel: 7, speed: 2 }, 'A treasure hunter’s reward.', { unlock: U.treasure(20) }),
  part('tires', 'stock', 'Stock tyres', 'common', {}, 'All-round road tyres.', { free: true }),
  part('tires', 'grip', 'Campus Grip', 'uncommon', { handling: 3, terrain: 3 }, 'Grippy tyres for campus roads, wet or dry.', { price: { coins: 650 } }),
  part('tires', 'knobby', 'Trail Knobby', 'uncommon', { handling: 1, terrain: 8 }, 'Knobbly tyres for the rough paths and puddles.', { price: { coins: 900 } }),
  part('tires', 'rain', 'Rain Master', 'rare', { handling: 5, terrain: 5 }, 'Made for Legon’s sudden showers.', { price: { coins: 1400 } }),
  part('gearing', 'stock', 'Stock gearing', 'common', {}, 'A simple 8-speed.', { free: true }),
  part('gearing', 'shift', 'SpeedShift', 'uncommon', { speed: 3, accel: 3 }, 'Crisper, closer gears.', { price: { coins: 1000 } }),
  part('gearing', 'race12', 'Race 12', 'rare', { speed: 5, accel: 4 }, 'A 12-speed racing groupset.', { price: { coins: 1800 } }),
  part('brakes', 'none', 'No hand brakes', 'common', {}, 'Without hand brakes there is no brake button: you steer round trouble.', { free: true }),
  part('brakes', 'rim', 'Rim brakes', 'common', { handling: 2 }, 'Hold the brake button to slow down before a crash.', { price: { coins: SHOP.brakes[0].price }, brakeLevel: 1 }),
  part('brakes', 'disc', 'Disc brakes', 'uncommon', { handling: 4 }, 'Stop twice as hard as rim brakes. Made for the Night Circuit.', { price: { coins: SHOP.brakes[1].price }, brakeLevel: 2 }),
  part('brakes', 'prostop', 'Pro Stop hydraulic', 'rare', { handling: 6 }, 'Hydraulic discs: the strongest stop and the steadiest handling.', { price: { coins: 2400 }, brakeLevel: 2 }),
  part('boost', 'stock', 'Stock boost', 'common', {}, 'Your legs and a deep breath.', { free: true }),
  part('boost', 'turbo', 'Turbo Cadence', 'uncommon', { boost: 5 }, 'Boosts last a little longer.', { price: { coins: 800 } }),
  part('boost', 'kick', 'Kente Kick', 'rare', { boost: 8 }, 'A bigger, longer boost.', { price: { coins: 1600 } }),
  part('boost', 'nitro', 'Night Nitro', 'epic', { boost: 10, accel: 2 }, 'For riders who own the night.', { unlock: U.nightKm(25) }),
];

// ---------- cosmetics ----------
const cos = (kind: Kind, id: string, name: string, rarity: Rarity, blurb: string, extra: Partial<Item>): Item => ({ id: `${kind}:${id}`, kind, name, rarity, blurb, ...extra });
const paint = (id: string, name: string, color: string, rarity: Rarity, price?: number, extra: Partial<Item> = {}) =>
  cos('paint', id, name, rarity, 'A colour for the frame, fork or trim.', { color, ...(price ? { price: { coins: price } } : { free: true }), ...extra });
export const PAINT_ITEMS: Item[] = [
  paint('graphite', 'Graphite', '#3a3f47', 'common'),
  paint('silver', 'Silver', '#b9c0c9', 'common'),
  paint('snow', 'Snow', '#f4f4f4', 'common'),
  ...SHOP.paints.map((x) => paint(x.id, x.name, x.color, x.price >= 500 ? 'uncommon' : 'common', x.price)),
  paint('electric', 'Electric Blue', '#1e90ff', 'uncommon', 800, { added: '2026-10-01' }),
  paint('sunset', 'Sunset Orange', '#ff7a3d', 'uncommon', 600, { collection: 'sunset' }),
  paint('rose', 'Rose', '#e85d9a', 'uncommon', 500),
  paint('violet', 'Violet', '#7b3fc4', 'uncommon', 500),
  paint('mint', 'Mint', '#3ad6a0', 'common', 350),
  paint('ug-blue', 'UG Blue', '#003a70', 'uncommon', 600),
  paint('lime', 'Neon Lime', '#39ff14', 'rare', 900, { collection: 'night' }),
];
const finish = (id: BikeStyle['finish'], name: string, rarity: Rarity, blurb: string, extra: Partial<Item>) => cos('finish', id, name, rarity, blurb, { style: { finish: id }, ...extra });
export const FINISH_ITEMS: Item[] = [
  finish('gloss', 'Gloss', 'common', 'A classic shiny paint job.', { free: true }),
  finish('matte', 'Matte', 'uncommon', 'Flat, modern and moody.', { price: { coins: 300 } }),
  finish('metallic', 'Metallic', 'rare', 'Flake that sparkles in the sun.', { price: { coins: 600 } }),
  finish('carbon', 'Carbon weave', 'rare', 'Your colour over a carbon-fibre weave.', { price: { coins: 1200 } }),
  finish('chrome', 'Chrome', 'epic', 'Mirror chrome. Very hard to miss.', { price: { diamonds: 80 } }),
  finish('neon', 'Neon glow', 'epic', 'The paint itself glows. Unlocked by riding at night.', { unlock: U.nightKm(10), collection: 'night' }),
];
const decal = (id: string, name: string, rarity: Rarity, group: string, d: NonNullable<BikeStyle['decal']>, extra: Partial<Item>) =>
  cos('decal', id, name, rarity, extra.blurb ?? `${group} decal for your frame.`, { style: { decal: d }, collection: extra.collection ?? group.toLowerCase(), ...extra });
export const DECAL_GROUPS = ['LEGONRUSH', 'Campus', 'Race', 'Achievements', 'Events', 'Hall', 'Crews', 'Personal'];
export const DECAL_ITEMS: Item[] = [
  decal('legonrush', 'LEGONRUSH', 'common', 'LEGONRUSH', { pattern: 'word', text: 'LEGONRUSH' }, { free: true, blurb: 'The official game logo.' }),
  decal('campus-stripe', 'Campus Stripe', 'common', 'Campus', { pattern: 'stripe' }, { price: { coins: 200 } }),
  decal('dots', 'Polka', 'common', 'Campus', { pattern: 'dots' }, { price: { coins: 250 } }),
  decal('kente', 'Kente weave', 'rare', 'Campus', { pattern: 'kente' }, { price: { coins: 600 } }),
  decal('speed-lines', 'Speed Lines', 'uncommon', 'Race', { pattern: 'speed' }, { price: { coins: 350 }, collection: 'campus-racer' }),
  decal('checker', 'Checkered Flag', 'uncommon', 'Race', { pattern: 'checker' }, { price: { coins: 400 } }),
  decal('flames', 'Flames', 'rare', 'Race', { pattern: 'flames' }, { price: { coins: 650 }, dropOnly: true }),
  decal('gold', 'Gold Rush stripe', 'legendary', 'Race', { pattern: 'stripe', color: '#d4a017' }, { price: { coins: 900 }, collection: 'gold-rush' }),
  decal('champion', 'Champion', 'epic', 'Achievements', { pattern: 'word', text: 'CHAMPION' }, { unlock: U.wins(10) }),
  decal('explorer', 'Explorer', 'rare', 'Achievements', { pattern: 'word', text: 'EXPLORER' }, { unlock: U.places(30) }),
  decal('speedster', 'Speedster', 'rare', 'Achievements', { pattern: 'word', text: 'SPEEDSTER' }, { unlock: U.nearMiss(100) }),
  decal('treasure-hunter', 'Treasure Hunter', 'epic', 'Achievements', { pattern: 'map' }, { unlock: U.treasure(10) }),
  decal('sunset', 'Sunset fade', 'epic', 'Events', { pattern: 'sunset' }, { unlock: { source: 'event', text: 'Win the Sunset Bike in Sunset Rush', check: (p) => has(p.ownedBikes.includes('sunset') ? 1 : 0, 1) }, collection: 'sunset' }),
  decal('freshers', 'Freshers ’26', 'uncommon', 'Events', { pattern: 'word', text: 'FRESHERS' }, { price: { coins: 300 }, season: { from: '09-01', to: '10-31', name: 'Freshers season' } }),
  decal('independence', 'Black Star', 'rare', 'Events', { pattern: 'stripe', color: '#111111' }, { price: { coins: 500 }, season: { from: '03-01', to: '03-14', name: 'Independence week' } }),
  decal('christmas', 'Christmas stripe', 'rare', 'Events', { pattern: 'stripe', color: '#1f8a3b' }, { price: { coins: 450 }, season: { from: '12-10', to: '01-06', name: 'Christmas' } }),
  ...HALLS.filter((h) => h.id !== 'none').map((h) => decal(`hall-${h.id}`, `${h.short === 'Vandals' ? 'Commonwealth' : h.short} Pride`, 'rare', 'Hall', { pattern: 'hall', text: h.short.toUpperCase(), color: h.color }, { price: { coins: 450 }, hall: h.id, blurb: `${h.name} colours on your frame. Free for ${h.name} riders.` })),
  decal('crew', 'Crew logo', 'rare', 'Crews', { pattern: 'word', text: 'CREW' }, { unlock: { source: 'store', text: 'Coming with Crews in Community', soon: true } }),
  decal('name', 'Your name', 'rare', 'Personal', { pattern: 'word' }, { price: { coins: 500 }, blurb: 'Your rider name printed along the frame.' }),
];
export const STYLE_ITEMS: Item[] = [
  cos('wheel', 'spoke', 'Spoked wheels', 'common', 'Classic spokes.', { style: { wheel: 'spoke' }, free: true }),
  cos('wheel', 'deep', 'Deep rims', 'uncommon', 'Deep-section rims in your accent colour.', { style: { wheel: 'deep' }, price: { coins: 500 } }),
  cos('wheel', 'disc', 'Disc wheels', 'epic', 'Solid disc wheels, like a time-trial bike.', { style: { wheel: 'disc' }, price: { coins: 1500 }, dropOnly: true }),
  cos('wheel', 'fat', 'Fat tyres', 'uncommon', 'Chunky tyres. Looks only: tyre grip is a performance part.', { style: { wheel: 'fat' }, price: { coins: 400 } }),
  cos('tyre', 'black', 'Black tyres', 'common', 'Classic black.', { style: { tyre: '#141518' }, color: '#141518', free: true }),
  cos('tyre', 'tan', 'Gum-wall tyres', 'common', 'Tan sidewalls, very classic.', { style: { tyre: '#b07a45' }, color: '#b07a45', price: { coins: 200 } }),
  cos('tyre', 'white', 'White-wall tyres', 'uncommon', 'Bright white tyres.', { style: { tyre: '#ececec' }, color: '#ececec', price: { coins: 250 } }),
  cos('tyre', 'red', 'Red tyres', 'uncommon', 'Bright red tyres.', { style: { tyre: '#c8102e' }, color: '#c8102e', price: { coins: 300 } }),
  cos('bars', 'flat', 'Flat bars', 'common', 'Straight handlebars.', { style: { bars: 'flat' }, free: true }),
  cos('bars', 'drop', 'Drop bars', 'uncommon', 'Curled racing bars.', { style: { bars: 'drop' }, price: { coins: 400 } }),
  cos('bars', 'riser', 'Riser bars', 'common', 'Wide, swept-back bars.', { style: { bars: 'riser' }, price: { coins: 300 } }),
  cos('seat', 'race', 'Race saddle', 'common', 'Slim and light.', { style: { seat: 'race' }, free: true }),
  cos('seat', 'comfy', 'Comfort saddle', 'common', 'A wide leather saddle on springs.', { style: { seat: 'comfy' }, price: { coins: 250 } }),
  cos('grips', 'dark', 'Black grips & pedals', 'common', 'Plain black.', { style: { grips: 'dark', pedals: 'dark' }, free: true }),
  cos('grips', 'accent', 'Colour grips & pedals', 'common', 'Grips and pedals in your accent colour.', { style: { grips: 'accent', pedals: 'accent' }, price: { coins: 150 } }),
];
export const LIGHT_ITEMS: Item[] = [
  cos('light', 'none', 'No lights', 'common', 'Nothing fitted.', { style: { light: '', glow: false }, free: true }),
  ...SHOP.lights.map((l) => cos('light', l.id, l.name, l.id === 'white' ? 'common' : 'uncommon', l.text, { style: { light: l.color, glow: l.id !== 'white' }, color: l.color, price: { coins: l.price } })),
  cos('light', 'sunset', 'Sunset glow', 'rare', 'A warm orange glow under the frame.', { style: { light: '#ff7a3d', glow: true }, color: '#ff7a3d', price: { coins: 700 }, collection: 'sunset' }),
  cos('light', 'lime', 'Night glow', 'rare', 'A neon green glow for the Night Circuit.', { style: { light: '#39ff14', glow: true }, color: '#39ff14', price: { coins: 800 }, collection: 'night' }),
];
export const ACC_ITEMS: Item[] = [
  cos('acc', 'bottle', 'Water bottle', 'common', 'Stay hydrated.', { style: { bottle: true }, free: true }),
  cos('acc', 'basket', 'Campus basket', 'common', 'A wicker basket for books and shopping.', { style: { basket: true }, price: { coins: 350 } }),
  cos('acc', 'rack', 'Rear rack & bag', 'uncommon', 'A rack with a bag in your secondary colour.', { style: { rack: true }, price: { coins: 450 } }),
  ...SHOP.bells.map((b) => cos('bell', b.id, b.name, 'common', b.text, { price: { coins: b.price } })),
];

// ---------- rider items ----------
const helmet = (id: string, name: string, color: string, rarity: Rarity, extra: Partial<Item>) => cos('rider', 'helmet-' + id, name, rarity, 'A helmet design for your rider. Looks only.', { rider: { helmet: color }, color, ...extra });
export const RIDER_ITEMS: Item[] = [
  helmet('orange', 'Sunset helmet', '#ff7a3d', 'uncommon', { price: { coins: 300 }, collection: 'sunset' }),
  helmet('pink', 'Rose helmet', '#e85d9a', 'uncommon', { price: { coins: 300 } }),
  helmet('violet', 'Freshers helmet', '#7b3fc4', 'uncommon', { price: { coins: 300 }, season: { from: '09-01', to: '10-31', name: 'Freshers season' } }),
  helmet('neon', 'Neon helmet', '#39ff14', 'rare', { price: { coins: 500 }, collection: 'night' }),
  helmet('gold', 'Gold helmet', '#d4a017', 'legendary', { price: { coins: 900 }, collection: 'gold-rush' }),
  helmet('chrome', 'Chrome helmet', '#c9d1db', 'epic', { price: { diamonds: 60 }, dropOnly: true }),
  cos('rider', 'jacket-gold', 'Gold Rush jacket', 'legendary', 'A gold hoodie to match the bike.', { rider: { outfit: 'hoodie', jersey: '#d4a017' }, color: '#d4a017', price: { coins: 1200 }, collection: 'gold-rush' }),
  cos('rider', 'jersey-sunset', 'Sunset jersey', 'epic', 'Orange fading to pink, for golden-hour riders.', { rider: { outfit: 'jersey', jersey: '#ff7a3d' }, color: '#ff7a3d', price: { coins: 700 }, collection: 'sunset' }),
  cos('rider', 'jersey-night', 'Night Rider jersey', 'rare', 'Midnight navy.', { rider: { outfit: 'jersey', jersey: '#141824' }, color: '#141824', price: { coins: 600 }, collection: 'night' }),
  cos('rider', 'jersey-race', 'Racing jersey', 'uncommon', 'Bright race red.', { rider: { outfit: 'jersey', jersey: '#d7263d' }, color: '#d7263d', price: { coins: 400 }, collection: 'campus-racer' }),
  cos('rider', 'jersey-explorer', 'Explorer jacket', 'rare', 'Khaki, for riders who go everywhere.', { rider: { outfit: 'hoodie', jersey: '#8a7a4a' }, color: '#8a7a4a', unlock: U.places(15) }),
  ...HALLS.filter((h) => h.id !== 'none').map((h) => cos('jersey', h.id, `${h.short === 'Vandals' ? 'Commonwealth' : h.short} jersey`, 'common', `Ride in ${h.name} colours. Free for ${h.name} riders.`, { rider: { outfit: 'jersey', jersey: h.color }, color: h.color, hall: h.id, price: { coins: SHOP.jersey.price } })),
];

// ---------- ride gear (used up on rides) ----------
export const GEAR_ITEMS: Item[] = [
  cos('gear', 'helmet1', 'Crash helmet', 'common', 'Saves you from one crash so the ride goes on. Used up when it saves you.', { gear: { helmets: 1 }, price: { coins: SHOP.helmet.price } }),
  cos('gear', 'helmet3', `Crash helmets ×${SHOP.helmet.pack}`, 'common', 'A pack of crash helmets, cheaper together.', { gear: { helmets: SHOP.helmet.pack }, price: { coins: SHOP.helmet.packPrice } }),
  cos('gear', 'repair', 'Repair kit', 'common', 'Fixes your bike after a crash when you have no helmet left.', { gear: { repairKits: 1 }, price: { coins: SHOP.repairKit.price } }),
  cos('gear', 'energy', 'Energy drink', 'common', 'Your boost lasts longer for one ride. One is used when a ride starts.', { gear: { energy: 1 }, price: { coins: SHOP.energy.price } }),
];

// ---------- bundles ----------
const bundle = (id: string, name: string, rarity: Rarity, blurb: string, contains: string[], price: Price, extra: Partial<Item> = {}) => cos('bundle', id, name, rarity, blurb, { contains, price, ...extra });
export const BUNDLE_ITEMS: Item[] = [
  bundle('first-ride', 'First Ride bundle', 'common', 'Free for every new rider: everything you need to get going.', ['gear:helmet3', 'decal:campus-stripe'], {}, { coins: 300 }),
  bundle('campus-racer', 'Campus Racer bundle', 'rare', 'Engineering Sprint with race wheels, jersey and decal.', ['bike:eng-sprint', 'part:wheels-aero7', 'rider:jersey-race', 'decal:speed-lines'], { coins: 4000 }, { collection: 'campus-racer', added: '2026-10-01' }),
  bundle('gold-rush', 'Gold Rush collection', 'legendary', 'The Gold Rush bike with its gold stripe, gold helmet and jacket.', ['bike:gold-rush', 'decal:gold', 'rider:helmet-gold', 'rider:jacket-gold'], { coins: 7000 }, { collection: 'gold-rush' }),
  bundle('sunset', 'Sunset Rider set', 'epic', 'Golden-hour colours for bike and rider. Limited time.', ['paint:sunset', 'light:sunset', 'rider:jersey-sunset', 'rider:helmet-orange'], { coins: 1500 }, { collection: 'sunset', dropOnly: true }),
  bundle('night', 'Night Rush kit', 'rare', 'Glow in the dark: neon paint, light, helmet and jersey. Limited time.', ['paint:lime', 'light:lime', 'rider:helmet-neon', 'rider:jersey-night'], { coins: 2200 }, { collection: 'night', dropOnly: true }),
  bundle('explorer', 'Campus Explorer pack', 'uncommon', 'Fat tyres, a basket, rack and lights for exploring.', ['wheel:fat', 'acc:basket', 'acc:rack', 'light:white'], { coins: 1150 }),
];

export const ITEMS: Item[] = [...BIKE_ITEMS, ...PART_ITEMS, ...PAINT_ITEMS, ...FINISH_ITEMS, ...DECAL_ITEMS, ...STYLE_ITEMS, ...LIGHT_ITEMS, ...ACC_ITEMS, ...RIDER_ITEMS, ...GEAR_ITEMS, ...BUNDLE_ITEMS];
const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
export const item = (id: string) => BY_ID.get(id);
export const bikeItem = (bikeId: string) => BY_ID.get('bike:' + bikeId) ?? BIKE_ITEMS[0];
export const STARTER_BIKES = BIKES.map((b) => b.id);

/** the value of the items in a bundle, for "save X" */
export function bundleValue(b: Item) {
  return (b.contains ?? []).reduce((n, id) => n + (item(id)?.price?.coins ?? 0), 0) + (b.coins ?? 0);
}

/** a bike's own look, filled in */
export function bikeLook(it: Item): BikeStyle {
  const l = it.look ?? {};
  return {
    primary: '#f2c230', secondary: l.primary ?? '#f2c230', accent: '#c9ccd2', finish: 'gloss', frame: 'diamond', wheel: 'spoke', tyre: '#141518',
    bars: 'flat', grips: 'dark', seat: 'race', pedals: 'dark', decal: null, light: '', glow: false, basket: false, rack: false, bottle: true,
    ...l,
  };
}

// The game (rides, results, the old menus) knows bikes as BikeSpecs: add the new ones so bikeById() finds
// them by name and colour. Their ride numbers come from the Garage's stats (see stats.ts rideSpec).
const toFive = (n: number) => Math.round((1 + n / 25) * 10) / 10;
for (const b of BIKE_ITEMS) {
  const id = b.id.slice(5);
  if (BIKES.some((x) => x.id === id) || GARAGE_BIKES.some((x) => x.id === id)) continue;
  const spec: BikeSpec = { id, name: b.name, tagline: CLASSES[b.cls!].name, speed: toFive(b.stats!.speed), acceleration: toFive(b.stats!.accel), handling: toFive(b.stats!.handling), color: b.look?.primary ?? '#f2c230' };
  GARAGE_BIKES.push(spec);
}
// the starter and older bikes keep their ids; show the Garage's names for them
for (const spec of [...BIKES, ...GARAGE_BIKES]) {
  const it = BY_ID.get('bike:' + spec.id);
  if (it) spec.name = it.name;
}
