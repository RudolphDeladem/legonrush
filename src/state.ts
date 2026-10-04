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
}

const KEY = 'legonrush.profile.v1';
const SETTINGS_KEY = 'legonrush.settings.v1';

export function newProfile(): Profile {
  return {
    name: 'Rider', username: '', hall: 'none', bike: 'city', guest: true,
    coins: 0, xp: 0, rides: 0, finishes: 0, totalDistance: 0, bestScore: 0, bestDistance: 0,
    bestTimes: {}, tutorialDone: false,
  };
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...newProfile(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
}

export function clearProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface Settings { sound: boolean }

export function loadSettings(): Settings {
  try {
    return { sound: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { sound: true };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
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

/** reward is the coin bonus for reaching the finish */
export function applyRide(p: Profile, r: RideResult, reward = 250): RideRewards {
  const finishBonus = r.finished ? reward : 0;
  const score = Math.round(r.distance + r.coins * 10 + (r.finished ? 500 : 0));
  const coins = r.coins + finishBonus;
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
