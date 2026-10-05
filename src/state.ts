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
  /** shop gear: crash helmets left (each saves one crash) and brakes fitted (0 none, 1 rim, 2 disc) */
  gear: { helmets: number; brakes: number };
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
}
export const newAbout = (): About => ({ dob: '', campus: 'ug', status: '', riderType: '', instagram: '', tiktok: '', newsOptIn: false, termsAt: '' });

export interface MissionDay {
  day: string;
  km: number;
  /** riders you vibe-rode with today */
  friends: string[];
  /** places you reached in Explore today */
  places: string[];
  claimed: string[];
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
    wins: 0, missions: { day: '', km: 0, friends: [], places: [], claimed: [] },
    about: newAbout(),
    gear: { helmets: 1, brakes: 0 },
  };
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = { ...newProfile(), ...JSON.parse(raw) } as Profile;
    p.look = { ...defaultLook(), ...p.look };
    p.missions = { ...newProfile().missions, ...p.missions };
    p.about = { ...newAbout(), ...p.about };
    p.gear = { ...newProfile().gear, ...p.gear };
    return p;
  } catch {
    return null;
  }
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
}

const defaultSettings = (): Settings => ({
  sound: true, volume: 0.8, musicVolume: 0.5, graphics: 'auto', slowDevice: false, leftHanded: false, campus: 'ug',
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
// Daily missions: three small goals that reset every day.
export interface Mission {
  id: string;
  icon: string;
  title: string;
  goal: number;
  reward: number;
  progress: (m: MissionDay) => number;
  unit?: string;
}
export const MISSIONS: Mission[] = [
  { id: 'km', icon: 'bike' as const, title: 'Ride 5 km', goal: 5, reward: 200, progress: (m) => m.km, unit: 'km' },
  { id: 'friends', icon: 'heart' as const, title: 'Vibe ride with 2 friends', goal: 2, reward: 300, progress: (m) => m.friends.length },
  { id: 'places', icon: 'pin' as const, title: 'Discover 3 new places', goal: 3, reward: 250, progress: (m) => m.places.length },
];

export function todayMissions(p: Profile) {
  const day = localDay(new Date());
  if (p.missions?.day !== day) p.missions = { day, km: 0, friends: [], places: [], claimed: [] };
  return p.missions;
}

export function claimMission(p: Profile, id: string) {
  const m = todayMissions(p);
  const def = MISSIONS.find((x) => x.id === id);
  if (!def || m.claimed.includes(id) || def.progress(m) < def.goal) return 0;
  m.claimed.push(id);
  p.coins += def.reward;
  saveProfile(p);
  return def.reward;
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
  todayMissions(p).km += r.distance / 1000;
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
};
