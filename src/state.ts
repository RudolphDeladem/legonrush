import type { BikeStyle } from './game/models';
export interface Profile {
  name: string;
  username: string;
  hall: string;
  bike: string;
  guest: boolean;
  coins: number;
  xp: number;
  rides: number;
  finishes: number;
  totalDistance: number;
  bestScore: number;
  bestDistance: number;
  /** best finish time per route id, seconds */
  bestTimes: Record<string, number>;
  tutorialDone: boolean;
  /** local date (YYYY-MM-DD) of the last daily reward, and how many days in a row */
  lastDaily: string;
  streak: number;
  /** garage bikes bought or won (the starter bikes are always available) */
  ownedBikes: string[];
  /** this week's riding for your hall */
  week: { id: string; km: number; claimed: boolean };
  gender: Gender;
  department: string;
  /** Snapchat username, without the @ */
  snap: string;
  /** show the Snapchat handle to other riders */
  snapPublic: boolean;
  look: Look;
  /** races finished first against other riders */
  wins: number;
  /** today's missions: progress and which rewards were claimed */
  missions: MissionDay;
  /** answers from the sign-up steps */
  about: About;
  /** diamonds: the rare currency (treasure, events, the store) */
  diamonds: number;
  /** owned items by id (cosmetics, parts, decals, titles, event badges...): how many */
  items: Record<string, number>;
  /** shop gear: crash helmets left (each saves one crash) and brakes fitted (0 none, 1 rim, 2 disc), plus the shop extras */
  gear: Gear;
  /** this week's challenges: progress and which rewards were claimed */
  weekly: MissionWeek;
  /** days in a row with all three daily challenges claimed */
  dailyStreak: { last: string; count: number };
  /** lifetime counters for badges */
  stats: Stats;
  /** badge ids unlocked (see features/achievements.ts) */
  badges: string[];
  /** place names reached in Explore or on the Freshers' Tour; landmarks here have their fact unlocked */
  visited: string[];
  /** favourite place names, beyond your hall and department */
  favourites: string[];
  /** campus missions: best time per mission id, seconds */
  missionBest: Record<string, number>;
  /** this week's treasure hunt */
  treasure: { week: string; found: number; claimed: boolean };

  // ---------- Garage & Store (src/features/garage) ----------
  /** each bike's look and fitted parts, part levels, loadouts, wishlist and the store's free items */
  garage: GarageSave;
}

// ---------- Garage & Store (src/features/garage) ----------
/** a bike's saved look (any field missing uses the bike's own) and its performance parts by slot */
export interface GarageBike { style?: Partial<BikeStyle>; parts?: Record<string, string> }
export interface GarageLoadout { name: string; bike: string; parts: Record<string, string> }
export interface GarageSave {
  /** save format: 1 once the older shop items were moved into items */
  v: number;
  bikes: Record<string, GarageBike>;
  /** upgrade level (1..5) of each performance part owned */
  levels: Record<string, number>;
  /** three saved setups; null is an empty slot */
  loadouts: (GarageLoadout | null)[];
  wishlist: string[];
  /** local date (YYYY-MM-DD) the store's free daily item was claimed */
  daily: string;
  /** the free First Ride bundle was claimed */
  starter: boolean;
  /** the garage background: day, sunset or night */
  scene: string;
  /** Hall Week ids completed (hall bike editions unlock with these) */
  hallWeeks: string[];
  /** when any of this last changed, so the newer device wins when syncing */
  at: number;
}
export const newGarage = (): GarageSave => ({ v: 0, bikes: {}, levels: {}, loadouts: [null, null, null], wishlist: [], daily: '', starter: false, scene: 'day', hallWeeks: [], at: 0 });

/** Moves the older shop's purchases (bikes, paints, bells, lights, jerseys, brakes, upgrades) into items. */
function migrateGarage(p: Profile) {
  const g: GarageSave = { ...newGarage(), ...p.garage };
  g.loadouts = [0, 1, 2].map((i) => g.loadouts?.[i] ?? null);
  if (g.v >= 1) return g;
  const give = (id: string) => { p.items[id] = Math.max(1, p.items[id] ?? 0); };
  for (const b of p.ownedBikes ?? []) give('bike:' + b);
  for (const x of p.gear.paints) give('paint:' + x);
  for (const x of p.gear.bells) give('bell:' + x);
  for (const x of p.gear.lights) give('light:' + x);
  for (const x of p.gear.jerseys) give('jersey:' + x);
  if (p.gear.brakes >= 1) give('part:brakes-rim');
  if (p.gear.brakes >= 2) give('part:brakes-disc');
  // the old upgrades (0..3, on every bike) become the stock parts' levels (1..4)
  const u = p.gear.upgrades;
  g.levels['part:gearing-stock'] = Math.max(g.levels['part:gearing-stock'] ?? 1, 1 + (u.speed ?? 0));
  g.levels['part:tires-stock'] = Math.max(g.levels['part:tires-stock'] ?? 1, 1 + (u.grip ?? 0));
  g.levels['part:boost-stock'] = Math.max(g.levels['part:boost-stock'] ?? 1, 1 + (u.boost ?? 0));
  // the paint and light that were fitted go on the bike being ridden
  const paint = SHOP.paints.find((x) => x.id === p.gear.paint)?.color;
  const light = SHOP.lights.find((x) => x.id === p.gear.light);
  if (paint || light) {
    const b = (g.bikes[p.bike] ??= {});
    b.style = { ...b.style, ...(paint ? { primary: paint } : {}), ...(light ? { light: light.color, glow: light.id !== 'white' } : {}) };
  }
  g.v = 1;
  return g;
}

export type Upgrade = 'speed' | 'grip' | 'boost';
export interface Gear {
  helmets: number;
  brakes: number;
  /** each one fixes the bike after a crash with no helmet left */
  repairKits: number;
  /** energy drinks owned; one is drunk at the start of a ride while energyOn */
  energy: number;
  energyOn: boolean;
  /** bike upgrade levels 0..3, kept across bikes */
  upgrades: Record<Upgrade, number>;
  /** cosmetics: owned ids and the one fitted ('' for none, or the bike's own colour) */
  paints: string[];
  paint: string;
  bells: string[];
  bell: string;
  lights: string[];
  light: string;
  /** hall jerseys bought (hall ids) */
  jerseys: string[];
}
export const newGear = (): Gear => ({
  helmets: 1, brakes: 0, repairKits: 0, energy: 0, energyOn: true, upgrades: { speed: 0, grip: 0, boost: 0 },
  paints: [], paint: '', bells: [], bell: '', lights: [], light: '', jerseys: [],
});

/** what a challenge counts */
export type Stat = 'km' | 'coins' | 'races' | 'nearMiss' | 'jumps' | 'arrivals' | 'treasure' | 'missions';
export type Counts = Partial<Record<Stat, number>>;
export type Stats = Partial<Record<Stat | 'nightKm' | 'challenges', number>>;
export interface MissionWeek {
  id: string;
  n: Counts;
  claimed: string[];
}

export type RiderType = 'racer' | 'explorer' | 'social' | 'speedster' | 'chill';
export type StudentStatus = 'student' | 'alumni' | 'staff' | 'visitor';
export interface About {
  /** YYYY-MM-DD, optional */
  dob: string;
  campus: string;
  status: StudentStatus | '';
  riderType: RiderType | '';
  instagram: string;
  tiktok: string;
  newsOptIn: boolean;
  /** when the rider accepted the terms (ISO date), empty if never */
  termsAt: string;
  /** when the "Complete your profile" reward was paid (ISO date), empty if not yet */
  completedAt: string;
}
export const newAbout = (): About => ({ dob: '', campus: 'ug', status: '', riderType: '', instagram: '', tiktok: '', newsOptIn: false, termsAt: '', completedAt: '' });

/** coins for finishing "Complete your profile" */
export const PROFILE_REWARD = 300;
/** the profile answers asked after sign-up; done when status, programme and rider type are in */
export function profileTodo(p: Profile) {
  const a = p.about;
  return {
    birthday: !!a.dob,
    campus: !!a.status && (a.status === 'staff' || a.status === 'visitor' || !!p.department),
    social: !!(p.snap || a.instagram || a.tiktok),
    type: !!a.riderType,
  };
}
export const profileComplete = (p: Profile) => { const t = profileTodo(p); return t.campus && t.type; };

export interface MissionDay {
  day: string;
  km: number;
  /** riders you vibe-rode with today */
  friends: string[];
  /** places you reached in Explore today */
  places: string[];
  claimed: string[];
  /** today's counts for the rotating challenges (distance stays in km above) */
  n: Counts;
}

export type Gender = 'male' | 'female';
export type BodyType = 'slim' | 'regular' | 'broad';
export type Outfit = 'jersey' | 'hall-tee' | 'hoodie' | 'kente';
export type Accessory = 'backpack' | 'sunglasses' | 'helmet' | 'watch' | 'gloves';

/** how your rider looks; colours are hex, and an empty jersey colour means your hall's */
export interface Look {
  body: BodyType;
  skin: string;
  outfit: Outfit;
  jersey: string;
  helmet: string;
  accessories: Accessory[];
}

export const SKIN_TONES = ['#3b2219', '#5a3523', '#7a4b2e', '#9a6440', '#c28a5c', '#e0b48c'];

export const defaultLook = (): Look => ({ body: 'regular', skin: '#7a4b2e', outfit: 'jersey', jersey: '', helmet: '#f5c518', accessories: ['helmet'] });

const KEY = 'legonrush.profile.v1';
const SETTINGS_KEY = 'legonrush.settings.v1';

export function newProfile(): Profile {
  return {
    name: 'Rider', username: '', hall: 'none', bike: 'city', guest: true,
    coins: 0, xp: 0, rides: 0, finishes: 0, totalDistance: 0, bestScore: 0, bestDistance: 0,
    bestTimes: {}, tutorialDone: false, lastDaily: '', streak: 0,
    ownedBikes: [], week: { id: '', km: 0, claimed: false },
    gender: 'male', department: '', snap: '', snapPublic: true, look: defaultLook(),
    wins: 0, missions: { day: '', km: 0, friends: [], places: [], claimed: [], n: {} },
    about: newAbout(),
    gear: newGear(),
    weekly: { id: '', n: {}, claimed: [] }, dailyStreak: { last: '', count: 0 }, stats: {}, badges: [], visited: [], favourites: [],
    missionBest: {}, treasure: { week: '', found: 0, claimed: false },
    diamonds: 0, items: {},
    garage: newGarage(),
  };
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** fills in anything an older saved profile (on this phone or in the account) is missing */
export function normalizeProfile(saved: Partial<Profile>): Profile {
  const d = newProfile();
  const p = { ...d, ...saved } as Profile;
  p.look = { ...defaultLook(), ...p.look };
  p.missions = { ...d.missions, ...p.missions };
  p.missions.n ??= {};
  p.about = { ...newAbout(), ...p.about };
  p.gear = { ...newGear(), ...p.gear };
  p.items ??= {};
  p.diamonds ??= 0;
  p.gear.upgrades = { ...newGear().upgrades, ...p.gear.upgrades };
  p.weekly = { ...d.weekly, ...p.weekly };
  p.dailyStreak = { ...d.dailyStreak, ...p.dailyStreak };
  p.treasure = { ...d.treasure, ...p.treasure };
  p.stats ??= {};
  p.garage = migrateGarage(p);
  return p;
}

let afterSave: ((p: Profile) => void) | null = null;
/** called after every save, so a signed-in rider's progress reaches their account */
export function onProfileSave(fn: (p: Profile) => void) {
  afterSave = fn;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
  afterSave?.(p);
}

export function clearProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export type Graphics = 'auto' | 'high' | 'low';

export interface Settings {
  sound: boolean;
  /** sound effects volume, 0 to 1 */
  volume: number;
  /** ride music volume, 0 to 1; 0 is off */
  musicVolume: number;
  /** auto starts high and drops to low if the phone struggles */
  graphics: Graphics;
  /** set once auto mode has found this device too slow for high */
  slowDevice: boolean;
  leftHanded: boolean;
  reducedMotion: boolean;
  /** the campus you ride on */
  campus: string;
  /** how hard rides are: traffic and obstacles (the game) and mission timers */
  difficulty: Difficulty;
  /** weather in rides: changing (sun and showers come and go), live (Legon's real weather) or always clear */
  weather: 'changing' | 'live' | 'clear';
  /** the welcome screens were shown (only once, to someone new) */
  onboarded: boolean;
  /** buzz the phone on crashes, coins and the finish */
  vibration: boolean;
  /** larger buttons and text in the menus */
  bigButtons: boolean;
  /** dark menus for riding at night */
  nightMenus: boolean;
}
export type Difficulty = 'easy' | 'normal' | 'hard';

const defaultSettings = (): Settings => ({
  sound: true, volume: 0.8, musicVolume: 0.5, graphics: 'auto', slowDevice: false, leftHanded: false, campus: 'ug', difficulty: 'normal', weather: 'changing',
  onboarded: false, vibration: true, bigButtons: false, nightMenus: false,
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
});

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// Daily reward: grows each day in a row, up to a week, and resets after a missed day.
const DAILY_COINS = [50, 75, 100, 125, 150, 175, 250];
const localDay = (d: Date) => d.toLocaleDateString('en-CA');

export function dailyReward(p: Profile, now = new Date()) {
  const today = localDay(now);
  if (p.lastDaily === today) return null;
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const day = p.lastDaily === yesterday ? p.streak + 1 : 1;
  return { day, coins: DAILY_COINS[Math.min(day, DAILY_COINS.length) - 1], today };
}

export function claimDaily(p: Profile, now = new Date()) {
  const r = dailyReward(p, now);
  if (!r) return null;
  p.lastDaily = r.today;
  p.streak = r.day;
  p.coins += r.coins;
  saveProfile(p);
  return r;
}

// Level n needs 250 * n(n-1)/2 XP in total: 0, 250, 750, 1500, ...
export function levelFor(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function xpForLevel(level: number) {
  return (250 * level * (level - 1)) / 2;
}

export interface RideResult {
  routeId: string;
  distance: number;
  coins: number;
  time: number;
  finished: boolean;
}

export interface RideRewards {
  score: number;
  coins: number;
  xp: number;
  newBestScore: boolean;
  newBestTime: boolean;
  levelBefore: number;
  levelAfter: number;
}

// Hall Week: ride a set distance for your hall each week (Monday to Sunday) for a bonus.
export const WEEK_GOAL_KM = 10;
export const WEEK_REWARD = 500;
export function weekId(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d.toLocaleDateString('en-CA');
}
// Challenges: three daily goals and three weekly goals, picked from a pool by the date.
export interface Mission {
  id: string;
  icon: string;
  title: string;
  goal: number;
  reward: number;
  progress: (m: MissionDay) => number;
  unit?: string;
}
const cnt = (stat: Stat) => (m: { n: Counts }) => m.n?.[stat] ?? 0;
const DAILY_POOL: Mission[] = [
  { id: 'km3', icon: 'bike', title: 'Ride 3 km', goal: 3, reward: 150, progress: (m) => m.km, unit: 'km' },
  { id: 'km', icon: 'bike', title: 'Ride 5 km', goal: 5, reward: 200, progress: (m) => m.km, unit: 'km' },
  { id: 'coins', icon: 'coin', title: 'Collect 150 coins on rides', goal: 150, reward: 200, progress: cnt('coins') },
  { id: 'race1', icon: 'flag', title: 'Finish a race', goal: 1, reward: 150, progress: cnt('races') },
  { id: 'race2', icon: 'flag', title: 'Finish 2 races', goal: 2, reward: 250, progress: cnt('races') },
  { id: 'near', icon: 'bolt', title: 'Have 5 near misses', goal: 5, reward: 200, progress: cnt('nearMiss') },
  { id: 'jumps', icon: 'star', title: 'Jump 10 times', goal: 10, reward: 150, progress: cnt('jumps') },
  { id: 'arrive', icon: 'map', title: 'Ride to 2 places in Explore', goal: 2, reward: 200, progress: cnt('arrivals') },
  { id: 'treasure', icon: 'gift', title: 'Find a treasure', goal: 1, reward: 250, progress: cnt('treasure') },
  { id: 'friends', icon: 'heart', title: 'Vibe ride with 2 friends', goal: 2, reward: 300, progress: (m) => m.friends.length },
  { id: 'places', icon: 'pin', title: 'Discover 3 new places', goal: 3, reward: 250, progress: (m) => m.places.length },
];
const WEEKLY_POOL: Mission[] = [
  { id: 'w-km', icon: 'bike', title: 'Ride 25 km this week', goal: 25, reward: 1000, progress: cnt('km'), unit: 'km' },
  { id: 'w-coins', icon: 'coin', title: 'Collect 1,500 coins on rides', goal: 1500, reward: 800, progress: cnt('coins') },
  { id: 'w-races', icon: 'flag', title: 'Finish 8 races', goal: 8, reward: 900, progress: cnt('races') },
  { id: 'w-near', icon: 'bolt', title: 'Have 40 near misses', goal: 40, reward: 900, progress: cnt('nearMiss') },
  { id: 'w-jumps', icon: 'star', title: 'Jump 80 times', goal: 80, reward: 700, progress: cnt('jumps') },
  { id: 'w-arrive', icon: 'map', title: 'Ride to 6 places in Explore', goal: 6, reward: 900, progress: cnt('arrivals') },
  { id: 'w-treasure', icon: 'gift', title: 'Find 5 treasures', goal: 5, reward: 1200, progress: cnt('treasure') },
  { id: 'w-missions', icon: 'target', title: 'Complete 3 campus missions', goal: 3, reward: 1000, progress: cnt('missions') },
];
/** bonus coins for clearing all three daily challenges, per day in a row (up to 7 days) */
export const STREAK_BONUS = 100;

/** a small seeded random from a text, so everyone gets the same challenges on the same day */
export function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
/** picks n challenges that count different things (the daily set always starts with a distance one) */
function pickMissions(pool: Mission[], seed: string, n: number, distanceFirst: boolean) {
  const rnd = seeded(seed);
  const order = pool.map((m) => [rnd(), m] as const).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
  const kind = (x: Mission) => (x.id.startsWith('km') ? 'km' : x.id.replace(/\d+$/, ''));
  const out: Mission[] = distanceFirst ? [order.find((x) => x.id.startsWith('km'))!] : [];
  for (const x of order) {
    if (out.length >= n) break;
    if (!out.some((o) => kind(o) === kind(x))) out.push(x);
  }
  return out;
}
/** today's three daily challenges; todayMissions() refreshes the list when the day changes */
export const MISSIONS: Mission[] = [];
/** this week's three weekly challenges; thisWeek() refreshes the list when the week changes */
export const WEEKLY_MISSIONS: Mission[] = [];
let missionsFor = '';
let weeklyFor = '';

export function todayMissions(p: Profile) {
  const day = localDay(new Date());
  if (p.missions?.day !== day) p.missions = { day, km: 0, friends: [], places: [], claimed: [], n: {} };
  p.missions.n ??= {};
  if (missionsFor !== day) {
    MISSIONS.splice(0, MISSIONS.length, ...pickMissions(DAILY_POOL, 'day:' + day, 3, true));
    missionsFor = day;
  }
  return p.missions;
}

/** this week's challenge progress (Monday to Sunday) */
export function thisWeek(p: Profile) {
  const id = weekId();
  if (p.weekly?.id !== id) p.weekly = { id, n: {}, claimed: [] };
  if (weeklyFor !== id) {
    WEEKLY_MISSIONS.splice(0, WEEKLY_MISSIONS.length, ...pickMissions(WEEKLY_POOL, 'week:' + id, 3, false));
    weeklyFor = id;
  }
  return p.weekly;
}

/** Counts something that happened, for the daily and weekly challenges and the badges.
 *  Does not save: call it during a ride; the ride's end saves the profile. */
export function track(p: Profile, stat: Stat, n = 1) {
  if (!(n > 0)) return;
  const m = todayMissions(p);
  if (stat === 'km') m.km += n;
  else m.n[stat] = (m.n[stat] ?? 0) + n;
  const w = thisWeek(p);
  w.n[stat] = (w.n[stat] ?? 0) + n;
  p.stats[stat] = (p.stats[stat] ?? 0) + n;
}

/** Claims a daily challenge (or a weekly one: ids starting "w-"). Returns the coins paid, streak bonus included, or 0. */
export function claimMission(p: Profile, id: string) {
  const weekly = id.startsWith('w-');
  const m = weekly ? thisWeek(p) : todayMissions(p);
  const def = (weekly ? WEEKLY_MISSIONS : MISSIONS).find((x) => x.id === id);
  if (!def || m.claimed.includes(id) || def.progress(m as MissionDay) < def.goal) return 0;
  m.claimed.push(id);
  let paid = def.reward;
  p.stats.challenges = (p.stats.challenges ?? 0) + 1;
  // all three dailies done: the streak grows and pays a bonus
  if (!weekly && MISSIONS.every((x) => p.missions.claimed.includes(x.id)) && p.dailyStreak.last !== p.missions.day) {
    const [y, mo, d] = p.missions.day.split('-').map(Number);
    const yesterday = localDay(new Date(y, mo - 1, d - 1));
    p.dailyStreak = { last: p.missions.day, count: p.dailyStreak.last === yesterday ? p.dailyStreak.count + 1 : 1 };
    paid += STREAK_BONUS * Math.min(7, p.dailyStreak.count);
  }
  p.coins += paid;
  saveProfile(p);
  return paid;
}

/** the challenge streak as it stands now: 0 once a whole day was missed */
export function missionStreak(p: Profile, now = new Date()) {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return p.dailyStreak.last === today || p.dailyStreak.last === yesterday ? p.dailyStreak.count : 0;
}

export function currentWeek(p: Profile) {
  const id = weekId();
  if (p.week.id !== id) p.week = { id, km: 0, claimed: false };
  return p.week;
}

/** reward is the coin bonus for reaching the finish; boost multiplies all coins (events) */
export function applyRide(p: Profile, r: RideResult, reward = 250, boost = 1): RideRewards {
  const finishBonus = r.finished ? reward : 0;
  const score = Math.round(r.distance + r.coins * 10 + (r.finished ? 500 : 0));
  const coins = (r.coins + finishBonus) * boost;
  currentWeek(p).km += r.distance / 1000;
  // challenges and badges: distance, coins picked up, and a finished race or Explore arrival
  track(p, 'km', r.distance / 1000);
  track(p, 'coins', r.coins);
  if (r.finished) track(p, /^(explore|mission|freshers-tour)/.test(r.routeId) ? 'arrivals' : 'races');
  const hour = new Date().getHours();
  if (r.routeId === 'night-circuit' || hour >= 19 || hour < 5) p.stats.nightKm = (p.stats.nightKm ?? 0) + r.distance / 1000;
  const xp = Math.round(r.distance / 10 + r.coins + (r.finished ? 200 : 0));
  const levelBefore = levelFor(p.xp);

  const newBestScore = score > p.bestScore;
  const prevTime = p.bestTimes[r.routeId];
  const newBestTime = r.finished && (prevTime === undefined || r.time < prevTime);

  p.coins += coins;
  p.xp += xp;
  p.rides += 1;
  if (r.finished) p.finishes += 1;
  p.totalDistance += r.distance;
  p.bestScore = Math.max(p.bestScore, score);
  p.bestDistance = Math.max(p.bestDistance, r.distance);
  if (newBestTime) p.bestTimes[r.routeId] = r.time;
  p.tutorialDone = true;
  saveProfile(p);

  return { score, coins, xp, newBestScore: newBestScore && p.rides > 1, newBestTime: newBestTime && prevTime !== undefined, levelBefore, levelAfter: levelFor(p.xp) };
}

// Ghost runs: your best ride on each race, replayed beside you next time.
const GHOST_KEY = 'legonrush.ghost.v1.';

export interface StoredGhost {
  time: number;
  step: number;
  d: number[];
  x: number[];
}

export function loadGhost(routeId: string): StoredGhost | null {
  try {
    const g = JSON.parse(localStorage.getItem(GHOST_KEY + routeId) ?? 'null');
    return g && Array.isArray(g.d) && Array.isArray(g.x) ? g : null;
  } catch {
    return null;
  }
}

export function saveGhost(routeId: string, g: StoredGhost) {
  try {
    localStorage.setItem(GHOST_KEY + routeId, JSON.stringify(g));
  } catch {
    /* storage full or unavailable: no ghost next time */
  }
}

export function clearGhosts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(GHOST_KEY)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** the shop: crash helmets are used up, brakes stay on every bike */
export const SHOP = {
  helmet: { price: 150, pack: 3, packPrice: 400 },
  brakes: [
    { level: 1, name: 'Rim brakes', text: 'Hold to slow down before a crash.', price: 500 },
    { level: 2, name: 'Disc brakes', text: 'Stop twice as hard. Made for the Night Circuit.', price: 1200 },
  ],
  repairKit: { price: 250 },
  energy: { price: 100 },
  /** bike upgrades: price of levels 1, 2 and 3 */
  upgrades: [
    { id: 'speed' as Upgrade, name: 'Speed', text: 'A lighter frame and smoother chain: a higher top speed.', prices: [400, 900, 1800] },
    { id: 'grip' as Upgrade, name: 'Grip', text: 'Better tyres: quicker, safer lane changes.', prices: [300, 700, 1400] },
    { id: 'boost' as Upgrade, name: 'Boost', text: 'Boost fills faster and lasts longer.', prices: [350, 800, 1600] },
  ],
  paints: [
    { id: 'gold', name: 'Legon Gold', color: '#f5c518', price: 300 },
    { id: 'navy', name: 'Midnight Navy', color: '#1b2a57', price: 300 },
    { id: 'kente', name: 'Kente Green', color: '#1f8a3b', price: 400 },
    { id: 'red', name: 'Flame Red', color: '#d7263d', price: 400 },
    { id: 'white', name: 'Pearl White', color: '#f2f2ee', price: 500 },
    { id: 'black', name: 'Matte Black', color: '#1a1a1a', price: 500 },
  ],
  bells: [
    { id: 'ding', name: 'Classic bell', text: 'A bright ding-ding.', price: 150 },
    { id: 'horn', name: 'Bulb horn', text: 'A cheeky honk.', price: 250 },
  ],
  lights: [
    { id: 'white', name: 'Front light', text: 'A white beam for night rides.', color: '#fff6d8', price: 300 },
    { id: 'gold', name: 'Gold glow', text: 'A warm gold glow under the frame.', color: '#ffc21a', price: 600 },
    { id: 'blue', name: 'Neon blue', text: 'A cool blue glow under the frame.', color: '#3ad6ff', price: 600 },
  ],
  /** a hall jersey in the hall's colours; your own hall's is free */
  jersey: { price: 350 },
};
