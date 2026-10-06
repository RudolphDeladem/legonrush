// Race Challenges: what a challenge is, the rules admins can change, the routes you can race,
// and the official LEGONRUSH schedule that keeps the calendar full. No screens here.
import { CAMPUS_LOOP, RACES, raceRoute, routeThrough, type Route } from '../../game/routes';
import { placeByName } from '../../game/campusmap';
import type { GhostRun } from '../../game/Game';

export type Format = 'time_trial' | 'live_race' | 'ghost' | 'best_of' | 'tournament';
export type Access = 'open' | 'friends' | 'code' | 'link' | 'hall';
/** what a challenge shows as: computed from its times and server state */
export type Phase = 'upcoming' | 'soon' | 'live' | 'ended' | 'cancelled';

export interface Person { id: string; name: string; username?: string | null; hall?: string | null }

export interface Challenge {
  id: string;
  /** what riders type to find it: LR-7K29X */
  code: string;
  official: boolean;
  name: string;
  description: string;
  /** null for official LEGONRUSH challenges */
  creator: Person | null;
  route: string;
  format: Format;
  /** attempts that count (Best of N); 1 for live races and ghost duels, 0 = unlimited (time trials) */
  attempts: number;
  access: Access;
  /** Hall-only challenges: the hall id */
  hall?: string | null;
  maxRiders: number;
  /** coins to join; 0 is free */
  entryFee: number;
  /** id of an approved prize template (PRIZE_TEMPLATES) */
  prize: string;
  /** ms since 1970 */
  startsAt: number;
  regClosesAt: number;
  endsAt: number;
  /** "Start now": the race starts when the riders are ready, not at a fixed time */
  startNow: boolean;
  /** server state; ended/cancelled override the clock */
  status: 'open' | 'live' | 'ended' | 'cancelled' | 'removed';
  /** riders registered */
  riders: number;
  createdAt: number;
  /** ghost challenges: the run everyone races */
  ghost?: { name: string; time: number; run: GhostRun } | null;
  /** for the signed-in rider */
  joined?: boolean;
  invited?: { from: string; status: 'pending' | 'accepted' | 'declined' } | null;
  /** official challenges: a short line about the series */
  series?: string;
  /** the challenge type (kinds.ts); rider-made ones work it out from their access */
  kind?: string;
  /** official challenges: a photo other than the type's (public/photos) */
  photo?: string;
  /** treasure hunts: the clues */
  clues?: string[];
}

/** What admins can change (config table, key 'challenges'); these are the defaults. */
export interface ChallengeConfig {
  creationFee: number;
  entryMin: number;
  entryMax: number;
  maxPool: number;
  maxRiders: number;
  /** player challenges one rider may create per day */
  perDay: number;
  /** finishing an official challenge for the first time */
  officialBonus: number;
  disabledRoutes: string[];
  disabledFormats: Format[];
}
export const DEFAULT_CONFIG: ChallengeConfig = {
  creationFee: 2000,
  entryMin: 50,
  entryMax: 1000,
  maxPool: 10000,
  maxRiders: 10,
  perDay: 2,
  officialBonus: 100,
  disabledRoutes: [],
  disabledFormats: ['tournament'],
};

export const FORMATS: { id: Format; name: string; icon: string; line: string; soon?: boolean }[] = [
  { id: 'time_trial', name: 'Time trial', icon: 'clock', line: 'Ride any time before it ends. Fastest time wins.' },
  { id: 'live_race', name: 'Live race', icon: 'flag', line: 'Everyone rides at the same time, side by side.' },
  { id: 'ghost', name: 'Ghost challenge', icon: 'ghost', line: 'Race a recorded ride. Beat the ghost and the leaderboard.' },
  { id: 'best_of', name: 'Best of attempts', icon: 'replay', line: 'A few tries each. Your best time counts.' },
  { id: 'tournament', name: 'Tournament', icon: 'trophy', line: 'Rounds and a final.', soon: true },
];
export const formatOf = (f: Format) => FORMATS.find((x) => x.id === f)!;

export const ACCESS: { id: Access; name: string; icon: string; line: string }[] = [
  { id: 'open', name: 'Open', icon: 'globe', line: 'Anyone can find it and join.' },
  { id: 'friends', name: 'Invited riders', icon: 'social', line: 'Only riders you invite can join.' },
  { id: 'code', name: 'Code required', icon: 'key', line: "Hidden from search. Riders join with the code." },
  { id: 'link', name: 'Invite link', icon: 'link', line: 'Hidden. Only people with the link can open it.' },
  { id: 'hall', name: 'Hall only', icon: 'pillars', line: 'Only riders from your hall can join.' },
];
export const accessOf = (a: Access) => ACCESS.find((x) => x.id === a)!;
/** shows up in browse and search */
export const discoverable = (c: Challenge) => c.access === 'open' || c.access === 'hall';

/** Approved prize splits: the creator picks one, the pool is worked out from real entries. */
export const PRIZE_TEMPLATES: { id: string; name: string; split: number[] }[] = [
  { id: 'top3', name: 'Top 3', split: [60, 30, 10] },
  { id: 'top2', name: 'Top 2', split: [70, 30] },
  { id: 'winner', name: 'Winner takes all', split: [100] },
];
export const templateOf = (id: string) => PRIZE_TEMPLATES.find((t) => t.id === id) ?? PRIZE_TEMPLATES[0];
/** coins for each place from a pool (rounded down; the remainder goes to 1st) */
export function prizeSplit(pool: number, template: string) {
  const parts = templateOf(template).split.map((pc) => Math.floor((pool * pc) / 100));
  parts[0] += pool - parts.reduce((a, b) => a + b, 0);
  return parts;
}
export const poolOf = (c: Pick<Challenge, 'entryFee' | 'riders'>) => c.entryFee * c.riders;
export const maxPoolOf = (c: Pick<Challenge, 'entryFee' | 'maxRiders'>) => c.entryFee * c.maxRiders;

export const EXPIRY: { h: number; name: string }[] = [
  { h: 1, name: '1 hour' }, { h: 6, name: '6 hours' }, { h: 24, name: '24 hours' }, { h: 72, name: '3 days' }, { h: 168, name: '7 days' },
];
export const RIDER_LIMITS = [2, 4, 6, 8, 10];

// ---------- routes ----------

export interface ChallengeRoute {
  id: string;
  name: string;
  /** a short line: from → to */
  line: string;
  /** the start line's place (map pins) */
  start: string;
  /** the area people search for: Engineering, Balme, Great Hall, Main Gate, Halls */
  area: string[];
  difficulty: number;
  build: () => Route;
  /** official only (treasure hunts): not offered when riders create a challenge or filter */
  hidden?: boolean;
}

const extra = new Map<string, Route>();
const through = (id: string, name: string, stops: string[], difficulty: number) => () => {
  if (!extra.has(id)) {
    const ps = stops.map((n) => placeByName(n)!);
    extra.set(id, routeThrough(ps, { id, name, kind: 'race', difficulty })!);
  }
  return extra.get(id)!;
};
const race = (id: string) => () => raceRoute(RACES.find((r) => r.id === id)!);

export const CH_ROUTES: ChallengeRoute[] = [
  { id: CAMPUS_LOOP.id, name: 'Limann to Great Hall', line: 'Limann Hall → Great Hall', start: 'Dr. Hilla Limann Hall', area: ['Limann', 'Great Hall', 'Sarbah', 'Legon Hall'], difficulty: 2, build: () => CAMPUS_LOOP },
  { id: 'engineering-run', name: 'Engineering Run', line: 'Limann Hall → Main Gate → Engineering', start: 'Dr. Hilla Limann Hall', area: ['Engineering', 'Main Gate', 'Limann'], difficulty: 3, build: race('engineering-run') },
  { id: 'balme-sprint', name: 'Balme Sprint', line: 'Night Market → Balme Library', start: 'Night Market', area: ['Balme', 'Library', 'Night Market'], difficulty: 1, build: through('balme-sprint', 'Balme Sprint', ['Night Market', 'The Balme Library'], 1) },
  { id: 'hall-loop', name: 'Hall Loop', line: 'Volta → Commonwealth → Legon → Akuafo → Sarbah', start: 'Volta Hall', area: ['Halls', 'Volta', 'Commonwealth', 'Legon Hall', 'Akuafo', 'Sarbah'], difficulty: 2, build: through('hall-loop', 'Hall Loop', ['Volta Hall', 'Commonwealth Hall', 'Legon Hall', 'Akuafo Hall Main', 'Mensah Sarbah Hall'], 2) },
  { id: 'legon-hill', name: 'Legon Hill', line: 'Main Gate → up the hill → Great Hall', start: 'Legon Main Entrance', area: ['Main Gate', 'Great Hall', 'Hill'], difficulty: 3, build: through('legon-hill', 'Legon Hill', ['Legon Main Entrance', 'Great Hall'], 3) },
  { id: 'sunset-route', name: 'Sunset Route', line: 'Commonwealth → Athletic Oval → Sports Complex', start: 'Commonwealth Hall', area: ['Sunset', 'Commonwealth', 'Sports', 'Night Market'], difficulty: 3, build: race('sunset-route') },
  { id: 'night-circuit', name: 'Night Circuit', line: 'Sports Complex → Night Market → Legon Hospital', start: 'Sports Complex', area: ['Night', 'Sports', 'Hospital', 'Night Market'], difficulty: 4, build: race('night-circuit') },
  { id: 'library-explorer', name: 'Library Explorer', line: 'Balme → JQB → NNB → Great Hall → CC', start: 'The Balme Library', area: ['Balme', 'Library', 'JQB', 'NNB', 'Great Hall', 'CC'], difficulty: 2, build: through('library-explorer', 'Library Explorer', ['The Balme Library', 'Jones Quartey Building, JQB', 'New N Block, NNB', 'Great Hall', 'Central Cafeteria, CC'], 2) },
  { id: 'grand-tour', name: 'Grand Tour', line: 'Main Gate → Engineering → Night Market → Athletic Oval → Commonwealth', start: 'Legon Main Entrance', area: ['Main Gate', 'Engineering', 'Night Market', 'Athletic Oval', 'Commonwealth', 'Distance'], difficulty: 3, build: through('grand-tour', 'Grand Tour', ['Legon Main Entrance', 'School of Engineering Sciences', 'Night Market', 'Athletic Oval', 'Commonwealth Hall'], 3) },
  { id: 'skills-course', name: 'Skills Course', line: 'Pent → ISH → Night Market → Bush Canteen', start: 'Pentagon Block A', area: ['Pent', 'ISH', 'Night Market', 'Skills'], difficulty: 5, build: through('skills-course', 'Skills Course', ['Pentagon Block A', 'International Students Hostel 1, ISH 1', 'Night Market', 'Bush Canteen (near Department of Music)'], 5) },
  { id: 'hunt-koko', name: 'Hidden place', line: 'Start at the Great Hall', start: 'Great Hall', area: [], difficulty: 2, hidden: true, build: through('hunt-koko', 'Treasure Hunt', ['Great Hall', 'Koko Joint'], 2) },
  { id: 'hunt-pub', name: 'Hidden place', line: 'Start at the Night Market', start: 'Night Market', area: [], difficulty: 2, hidden: true, build: through('hunt-pub', 'Treasure Hunt', ['Night Market', 'Library Pub'], 2) },
  { id: 'hunt-fountain', name: 'Hidden place', line: 'Start at Commonwealth Hall', start: 'Commonwealth Hall', area: [], difficulty: 2, hidden: true, build: through('hunt-fountain', 'Treasure Hunt', ['Commonwealth Hall', 'Balme Library Fountain'], 2) },
  { id: 'hunt-oval', name: 'Hidden place', line: 'Start at Volta Hall', start: 'Volta Hall', area: [], difficulty: 2, hidden: true, build: through('hunt-oval', 'Treasure Hunt', ['Volta Hall', 'Athletic Oval'], 2) },
];
export const chRoute = (id: string) => CH_ROUTES.find((r) => r.id === id);
/** route lengths in metres, so cards don't build a route just to show its length (checked by the dev test) */
export const ROUTE_LENGTH: Record<string, number> = {
  'limann-great-hall': 2576, 'engineering-run': 2422, 'balme-sprint': 1491, 'hall-loop': 1773, 'legon-hill': 1950, 'sunset-route': 2643, 'night-circuit': 2945,
  'library-explorer': 4897, 'grand-tour': 3795, 'skills-course': 2494, 'hunt-koko': 2181, 'hunt-pub': 1208, 'hunt-fountain': 946, 'hunt-oval': 718,
};
export const kmOf = (route: string) => `${((ROUTE_LENGTH[route] ?? chRoute(route)?.build().length ?? 0) / 1000).toFixed(1)} km`;

/** a straight-line ride at an even pace: the official pace bike (not a person) */
export function paceRun(route: string): { name: string; time: number; run: GhostRun } {
  const len = ROUTE_LENGTH[route] ?? 2000;
  // a strong but beatable average: 16 m/s, after a second to get going
  const pace = Math.round(len / 16);
  const v = len / (pace - 1);
  const step = 0.1;
  const d: number[] = [], x: number[] = [];
  for (let i = 0; i <= Math.ceil(pace / step); i++) {
    const t = i * step;
    d.push(Math.round(Math.min(len, v * Math.max(0, t - 1)) * 100) / 100);
    x.push(Math.round(Math.sin(t / 3) * 80) / 100);
  }
  return { name: 'Pace bike', time: pace, run: { step, d, x } };
}

// ---------- time ----------

export function phaseOf(c: Challenge, now = Date.now()): Phase {
  if (c.status === 'cancelled' || c.status === 'removed') return 'cancelled';
  if (c.status === 'ended' || now >= c.endsAt) return 'ended';
  // "Start now" races wait in the lobby until the riders are ready
  if (c.startNow && c.format === 'live_race' && c.status === 'open') return 'soon';
  if (c.status === 'live' || now >= c.startsAt) return 'live';
  return c.startsAt - now <= 60 * 60e3 ? 'soon' : 'upcoming';
}
export const regOpen = (c: Challenge, now = Date.now()) => {
  const ph = phaseOf(c, now);
  if (ph === 'ended' || ph === 'cancelled') return false;
  if (now >= c.regClosesAt) return false;
  // a live race that has started can't be joined; time trials stay open until they end
  if (c.format === 'live_race' && ph === 'live') return false;
  return c.riders < c.maxRiders;
};

const pad = (n: number) => String(n).padStart(2, '0');
/** 2:18.42 */
export const raceTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
/** a live countdown: 02:14, 18:42, 1:05:09, then "45 min", "3 h 20 min", "2 days" */
export function countdown(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600) return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  if (s < 6 * 3600) return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} days`;
}
/** "in words" for reminders and lists: Starts in 45 minutes */
export function startsText(c: Challenge, now = Date.now()) {
  const ms = c.startsAt - now;
  if (ms <= 0) return c.format === 'live_race' ? 'Starting now' : 'Open now';
  if (ms < 60e3) return `Starts in ${Math.ceil(ms / 1000)} s`;
  return `Starts in ${countdown(ms)}`;
}
export const timeText = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', ' ').toUpperCase();
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayDiff = (t: number, now = Date.now()) => Math.round((dayStart(t) - dayStart(now)) / 86400e3);
/** Today · 6:00 PM, Tomorrow · 9:00 AM, Saturday · 5:00 PM, Sat 10 Oct · 5:00 PM */
export function whenText(t: number, now = Date.now()) {
  const dd = dayDiff(t, now);
  const day = dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : dd === -1 ? 'Yesterday' : dd > 1 && dd < 7 ? new Date(t).toLocaleDateString('en-GB', { weekday: 'long' }) : new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${timeText(t)}`;
}
export const dateKey = (t: number) => new Date(t).toLocaleDateString('en-CA');

// ---------- codes ----------

const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newChallengeCode() {
  return 'LR-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => ABC[b % ABC.length]).join('');
}
/** accepts LR-7K29X, lr7k29x, a full link with ?ch=...; null if it can't be a code */
export function cleanCode(raw: string): string | null {
  let s = raw.trim();
  try {
    if (/[/?=]/.test(s)) s = new URL(s.includes('://') ? s : `https://${s}`).searchParams.get('ch') ?? s;
  } catch { /* a bare code */ }
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('LR')) s = s.slice(2);
  return /^[A-Z0-9]{5,6}$/.test(s) ? `LR-${s}` : null;
}

// ---------- the official schedule ----------
// LEGONRUSH's own challenges, made by code for any day: never empty, the same on every phone.

interface Slot { key: string; name: string; series: string; format: Format; route: (day: number) => string; hour: number; min: number; lengthMin: number; attempts: number; days?: number[]; description: string; kind: string; photo?: string }
// the first seven routes, in their original order (official ids include the route)
const ROTATE = CH_ROUTES.slice(0, 7).map((r) => r.id);
const DAILY_TT_ROUTES = ['engineering-run', 'balme-sprint', 'limann-great-hall', 'hall-loop', 'legon-hill', 'sunset-route', 'night-circuit'];
const HUNTS: { route: string; clues: string[] }[] = [
  { route: 'hunt-koko', clues: ['Students queue here before the sun is fully up.', 'It is served hot in a small bowl, with koose or bread.', 'Not far from the halls, everyone knows the name.'] },
  { route: 'hunt-pub', clues: ['Close to the books, but nobody comes here to read.', 'Music, drinks and loud debates after dark.', 'Its name joins two things: a library and a ...'] },
  { route: 'hunt-fountain', clues: ['Water, but you cannot drink it.', 'In front of the most famous building for studying.', 'Graduation photos are taken right here.'] },
  { route: 'hunt-oval', clues: ['Inter-hall athletics finals happen here.', 'A big loop, but not for bikes.', 'Sprinters train on it at dawn.'] },
];
const SLOTS: Slot[] = [
  // Campus Sprint: a live race every hour, so there is always one about to start
  ...[8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22].map((h): Slot => ({ key: `sprint-${h}`, name: 'Campus Sprint', series: 'Hourly live race', format: 'live_race', route: (d) => ROTATE[(d + h) % 7], hour: h, min: 0, lengthMin: 20, attempts: 1, description: 'A live race on the hour. Join the lobby, line up with whoever is there and go.', kind: 'daily' })),
  { key: 'hunt', name: 'Treasure Hunt', series: 'Daily treasure hunt', format: 'time_trial', route: (d) => HUNTS[d % HUNTS.length].route, hour: 6, min: 0, lengthMin: 18 * 60, attempts: 0, description: "Find today's hidden location. Read the clues, then ride there as fast as you can.", kind: 'treasure' },
  { key: 'library', name: 'Library Explorer', series: 'Daily location challenge', format: 'time_trial', route: () => 'library-explorer', hour: 6, min: 0, lengthMin: 18 * 60, attempts: 0, description: 'Visit 5 locations: the Balme Library, JQB, NNB, the Great Hall and CC, in one ride.', kind: 'location' },
  { key: 'grand-tour', name: 'Grand Tour', series: 'Daily distance challenge', format: 'time_trial', route: () => 'grand-tour', hour: 6, min: 0, lengthMin: 18 * 60, attempts: 0, description: 'The long one: from the Main Gate past Engineering, the Night Market and the Athletic Oval up to Commonwealth.', kind: 'distance' },
  { key: 'skills', name: 'Skills Challenge', series: 'Daily skills challenge', format: 'best_of', route: () => 'skills-course', hour: 6, min: 0, lengthMin: 18 * 60, attempts: 3, description: 'Obstacles and precision: tight corners and busy roads around Pent and ISH. Three tries, best one counts.', kind: 'skill' },
  { key: 'interhall', name: 'Inter-Hall Challenge', series: 'Daily inter-hall', format: 'best_of', route: (d) => ['hall-loop', 'limann-great-hall', 'sunset-route'][d % 3], hour: 6, min: 0, lengthMin: 18 * 60, attempts: 3, description: 'Represent your hall. Every time you post counts for your hall on the inter-hall board.', kind: 'interhall' },
  { key: 'sunset-tt', name: 'Sunset Time Trial', series: 'Limited time · every evening', format: 'time_trial', route: () => 'sunset-route', hour: 17, min: 0, lengthMin: 105, attempts: 0, description: 'Only open while the sun goes down. Ride the Sunset Route from Commonwealth to the Sports Complex.', kind: 'special', photo: 'sc-sunset' },
  { key: 'night-ride', name: 'Night Ride Challenge', series: 'Limited time · every night', format: 'time_trial', route: () => 'night-circuit', hour: 20, min: 0, lengthMin: 225, attempts: 0, description: 'The Night Circuit under the streetlights. Open 8 PM to 11:45 PM.', kind: 'special', photo: 'sc-night' },
  { key: 'morning', name: 'Morning Rush', series: 'Daily live race', format: 'live_race', route: () => 'limann-great-hall', hour: 7, min: 30, lengthMin: 20, attempts: 1, days: [1, 2, 3, 4, 5], description: 'Race to the Great Hall before your first lecture. Everyone in the lobby at 7:30 starts together.', kind: 'daily' },
  { key: 'lunch', name: 'Lunch Sprint', series: 'Daily live race', format: 'live_race', route: () => 'balme-sprint', hour: 12, min: 30, lengthMin: 20, attempts: 1, description: 'A short, fast sprint from the Night Market to the Balme Library. Be in the lobby before 12:30.', kind: 'daily' },
  { key: 'after-class', name: 'After-Class Race', series: 'Daily live race', format: 'live_race', route: (d) => ['engineering-run', 'legon-hill', 'hall-loop'][d % 3], hour: 16, min: 30, lengthMin: 20, attempts: 1, description: 'Classes are done. Line up and race whoever turns up.', kind: 'daily' },
  { key: 'pace', name: 'Beat the Pace Bike', series: 'Daily ghost challenge', format: 'ghost', route: (d) => ROTATE[d % ROTATE.length], hour: 6, min: 0, lengthMin: 17 * 60, attempts: 0, description: "The LEGONRUSH pace bike rides a strong, even time. Beat it, then beat everyone else who did.", kind: 'time' },
  { key: 'hall-war', name: 'Hall Speed War', series: 'Weekly · Saturday', format: 'best_of', route: () => 'hall-loop', hour: 18, min: 0, lengthMin: 120, attempts: 3, days: [6], description: 'Three tries round the Hall Loop. Your best time counts, and it counts for your hall.', kind: 'hall' },
  { key: 'midweek', name: 'Midweek Showdown', series: 'Weekly · Wednesday', format: 'live_race', route: () => 'night-circuit', hour: 20, min: 0, lengthMin: 20, attempts: 1, days: [3], description: 'The big midweek race on the Night Circuit, under the streetlights.', kind: 'weekly' },
  { key: 'sunday-hill', name: 'Sunday Hill Climb', series: 'Weekly · Sunday', format: 'best_of', route: () => 'legon-hill', hour: 16, min: 0, lengthMin: 180, attempts: 3, days: [0], description: 'From the Main Gate up to the Great Hall. Three attempts, best one counts.', kind: 'weekly' },
];

const dayIndex = (t: number) => Math.floor((dayStart(t) + 12 * 3600e3) / 86400e3);
const ymd = (t: number) => dateKey(t).replace(/-/g, '');

function officialFor(day: number /* ms at local midnight */): Challenge[] {
  const out: Challenge[] = [];
  const di = dayIndex(day);
  const wd = new Date(day).getDay();
  // a daily time trial on every route, all day
  for (const route of DAILY_TT_ROUTES) {
    const r = chRoute(route)!;
    out.push({ ...official(`off-tt-${route}-${ymd(day)}`, `${r.name} Time Trial`, 'Daily time trial', 'time_trial', route, day, day + 86400e3 - 60e3, 0, `Ride ${r.name} as often as you like today. Your fastest time goes on today's board.`), kind: 'time' });
  }
  for (const s of SLOTS) {
    if (s.days && !s.days.includes(wd)) continue;
    const start = day + (s.hour * 60 + s.min) * 60e3;
    const route = s.route(di);
    const c = official(`off-${s.key}-${route}-${ymd(day)}`, s.name, s.series, s.format, route, start, start + s.lengthMin * 60e3, s.attempts, s.description);
    c.kind = s.kind;
    if (s.photo) c.photo = s.photo;
    if (s.kind === 'treasure') c.clues = HUNTS.find((x) => x.route === route)?.clues;
    out.push(c);
  }
  return out;
}

function official(id: string, name: string, series: string, format: Format, route: string, startsAt: number, endsAt: number, attempts: number, description: string): Challenge {
  return {
    id, code: '', official: true, name, series, description, creator: null, route, format, attempts, access: 'open',
    maxRiders: format === 'live_race' ? 10 : 9999, entryFee: 0, prize: 'top3', startsAt,
    // live races: register until the start; trials until they end
    regClosesAt: format === 'live_race' ? startsAt : endsAt,
    endsAt, startNow: false, status: 'open', riders: 0, createdAt: startsAt - 7 * 86400e3,
    // the pace bike's run is made when someone rides it (paceRun)
    ghost: null,
  };
}

/** official challenges from `daysBack` days ago to `daysAhead` days ahead */
export function officialSchedule(now = Date.now(), daysBack = 1, daysAhead = 14): Challenge[] {
  const today = dayStart(now);
  const out: Challenge[] = [];
  for (let k = -daysBack; k <= daysAhead; k++) {
    const d = new Date(today);
    d.setDate(d.getDate() + k);
    out.push(...officialFor(d.getTime()));
  }
  return out;
}
/** an official challenge from its id, any day (for links and the leaderboard) */
export function officialById(id: string): Challenge | null {
  const m = /-(\d{8})$/.exec(id);
  if (!m || !id.startsWith('off-')) return null;
  const t = new Date(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8)).getTime();
  return officialFor(t).find((c) => c.id === id) ?? null;
}
