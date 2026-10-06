// The official LEGONRUSH calendar, made by code so Events is never empty: daily rides, a weekly
// programme (Treasure Hunt on Saturdays, Games Night on Thursdays...) and seasonal series at the
// right dates (Freshers Week, Independence Ride on 6 March, Valentine, Graduation Fest, Christmas,
// Hall Wars). Admin and community events from the server are added on top (cloud.ts).
import { EVENTS, eventStatus } from '../../data/events';
import { TOUR_STOPS } from '../../game/routes';
import { seeded } from '../../state';
import type { CampusEvent, EventRewards, EventType, RuleId, SeriesInfo, Status } from './types';
import { TYPES } from './catalog';

const H = 3600e3, MIN = 60e3, DAY = 24 * H;

/** "now" for the events; ?evnow=2026-10-08T20:30 in development to see another time */
export function now() {
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('evnow');
    if (q) {
      const base = Date.parse(q);
      if (!Number.isNaN(base)) return base + (performance.now() - loadedAt);
    }
  }
  return Date.now();
}
const loadedAt = performance.now();

const at = (day: Date, hour: number, min = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, min).getTime();
const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pick = <T>(list: T[], salt: string) => list[Math.floor(seeded(salt)() * list.length)];

// ---------- treasure spots and clues ----------
// Clues go from cryptic to plain; one more is shown each time you ride without finding it.
export const HUNT_SPOTS: { place: string; clues: string[] }[] = [
  { place: 'The Balme Library', clues: ['Where knowledge watches over the square.', 'Thousands of books carry the name of the first Principal.', 'At the top of the square with the fountain: the library.'] },
  { place: 'Great Hall', clues: ['Gowns are worn here on the biggest day of a student\'s life.', 'It sits high up on Legon Hill.', 'Congregations are held in this hall.'] },
  { place: 'Night Market', clues: ['Hungry after dark? Everyone ends up here.', 'Rows of stalls that stay busy into the evening.', 'Jollof, kelewele and noise: follow your nose to the market.'] },
  { place: 'Athletic Oval', clues: ['They run round and round but never get anywhere.', 'Track and field live here.', 'The oval where athletes train.'] },
  { place: 'Commonwealth Hall', clues: ['The Vandals guard this one.', '"Truth Stands", high on the hill.', 'The all-male hall up on Legon Hill.'] },
  { place: 'Legon Main Entrance', clues: ['Every journey to Legon starts here.', 'Everyone takes a photo under it on their first day.', 'The Main Gate.'] },
  { place: 'University of Ghana Registry', clues: ['Where your name is officially written down.', 'Admission letters and transcripts come from here.', 'The Registry.'] },
  { place: 'Mensah Sarbah Hall', clues: ['Vikings, far from any sea.', 'Named after a Gold Coast lawyer and nationalist.', 'Mensah Sarbah Hall.'] },
  { place: 'Akuafo Hall Main', clues: ['The farmers\' hall.', 'One of the five traditional halls; its name is Akan.', 'Akuafo Hall.'] },
  { place: 'Jones Quartey Building, JQB', clues: ['Three letters, many lectures.', 'A big lecture block where hundreds sit at once.', 'JQB.'] },
];

const PHOTO_SETS = [
  ['Legon Main Entrance', 'The Balme Library', 'Balme Library Fountain', 'Great Hall'],
  ['Commonwealth Hall', 'Great Hall', 'Athletic Oval', 'Night Market'],
  ['University of Ghana Registry', 'Jones Quartey Building, JQB', 'Central Cafeteria, CC', 'Akuafo Hall Main'],
];
const EXPLORER_SETS = [
  ['Legon Hall', 'Akuafo Hall Main', 'Mensah Sarbah Hall', 'Volta Hall', 'Commonwealth Hall'],
  ['School of Engineering Sciences', 'University of Ghana Business School', 'School of Law', 'Jones Quartey Building, JQB'],
  ['SRC Union Building', 'Kuffour Quadrangle', 'Night Market', 'University of Ghana Sports Directorate'],
];
const SCENIC = ['Great Hall', 'Athletic Oval', 'Commonwealth Hall', 'University of Ghana Botanical Gardens'];
const RUSH_AREAS = ['Athletic Oval', 'Night Market', 'Balme Library Fountain', 'University of Ghana Sports Directorate', 'Commonwealth Hall', 'Legon Main Entrance', 'Central Cafeteria, CC'];

// ---------- building blocks ----------
interface Draft {
  id: string;
  type: EventType;
  name: string;
  blurb: string;
  description: string;
  place: string;
  start: number;
  end: number;
  rewards: EventRewards;
  rules?: RuleId[];
  timeLimit?: number;
  cover?: string;
  stops?: string[];
  spot?: string;
  clues?: string[];
  timed?: string;
  activity?: CampusEvent['activity'];
  series?: CampusEvent['series'];
  /** registration opens this long before the start (default 1 day) */
  opens?: number;
}

function official(d: Draft): CampusEvent {
  return {
    key: `off:${d.id}`,
    source: 'official',
    type: d.type,
    activity: d.activity ?? TYPES[d.type].activity,
    name: d.name,
    blurb: d.blurb,
    description: d.description,
    cover: d.cover ?? TYPES[d.type].cover,
    host: 'LEGONRUSH',
    place: d.place,
    start: d.start,
    end: d.end,
    regDeadline: d.end,
    capacity: null,
    fee: 0,
    rewards: d.rewards,
    rules: d.rules ?? [],
    timeLimit: d.timeLimit,
    series: d.series,
    stops: d.stops,
    spot: d.spot,
    clues: d.clues,
    timed: d.timed,
    createdAt: d.start - (d.opens ?? DAY),
  };
}

const huntFor = (salt: string) => pick(HUNT_SPOTS, 'hunt:' + salt);

function treasureHunt(id: string, day: Date, name: string, opts: Partial<Draft> = {}): CampusEvent {
  const h = huntFor(id);
  return official({
    id, type: 'treasure', name, activity: 'hunt',
    blurb: 'One treasure is hidden on campus. Follow the clues.',
    description: 'A treasure is hidden somewhere on campus. Read the clue, choose where to ride and watch the meter: Cold, Warm, Hot, Very hot. When it says Treasure nearby, it is on the road ahead. A new clue appears each time you ride without finding it.',
    place: 'Balme Library Fountain', start: at(day, 16), end: at(day, 20),
    rewards: { join: { xp: 50 }, done: { coins: 1500, diamonds: 2, xp: 300 } },
    rules: ['nominimap', 'sunset'], spot: h.place, clues: h.clues, cover: 'lm-aerial', opens: 3 * DAY,
    ...opts,
  });
}

function coinRush(id: string, day: Date, hour: number, opts: Partial<Draft> = {}): CampusEvent {
  const area = pick(RUSH_AREAS, 'rush:' + id);
  return official({
    id, type: 'coinrush', name: 'Coin Rush', activity: 'coinrush',
    blurb: 'Coins everywhere for two minutes. Grab them.',
    description: `For one hour, coins are scattered on the roads around the ${area.replace(/, .*$/, '')}. Ride there and collect as many as you can in two minutes. Every coin is yours; collect 40 for a bonus.`,
    place: area, start: at(day, hour), end: at(day, hour, 90),
    rewards: { join: { xp: 20 }, done: { coins: 150, xp: 100 } },
    rules: ['timelimit', 'noracing'], timeLimit: 120, cover: 'ride',
    ...opts,
  });
}

function sunsetRide(id: string, day: Date, opts: Partial<Draft> = {}): CampusEvent {
  const spot = pick(SCENIC, 'sunset:' + id);
  return official({
    id, type: 'sunset', name: 'Sunset Ride', activity: 'sunset',
    blurb: 'Ride to a scenic spot and watch the sun go down.',
    description: `Golden hour on campus. Ride to the ${spot.replace('University of Ghana ', '')} and watch the sunset. A photo of the moment is saved for you. No traffic, no rush.`,
    place: spot, start: at(day, 17), end: at(day, 19),
    rewards: { join: { xp: 20 }, done: { coins: 100, xp: 80 } },
    rules: ['sunset', 'noracing'], cover: 'ev-sunset', timed: 'sunset-rush',
    ...opts,
  });
}

function nightRush(id: string, day: Date): CampusEvent {
  return official({
    id, type: 'night', name: 'Night Rush',
    blurb: 'The campus after dark. Double coins on the Night Circuit.',
    description: 'Every night from 7 pm to 5 am the campus lights come on. Ride the Night Circuit while it is live for double coins and a chance at the Neon bike, or take a calm night ride to the Night Market.',
    place: 'Night Market', start: at(day, 19), end: at(addDays(day, 1), 5),
    rewards: { join: { xp: 20 }, done: { xp: 80 } },
    rules: ['night'], cover: 'ev-night', timed: 'night-rush', activity: 'timed',
  });
}

function photoHunt(id: string, day: Date, from: number, to: number, opts: Partial<Draft> = {}): CampusEvent {
  const stops = pick(PHOTO_SETS, 'photo:' + id);
  return official({
    id, type: 'photohunt', name: 'Campus Photo Hunt', activity: 'photohunt',
    blurb: `Find and photograph ${stops.length} campus places.`,
    description: 'Ride to every place on the list. When you reach one, a photo is taken and it is ticked off. Your progress is kept all day, so you can do it in more than one ride.',
    place: stops[0], start: at(day, from), end: at(day, to),
    rewards: { join: { xp: 20 }, done: { coins: 400, xp: 200 } },
    stops, cover: 'lm-balme',
    ...opts,
  });
}

function explorer(id: string, day: Date, from: number, to: number, opts: Partial<Draft> = {}): CampusEvent {
  const stops = pick(EXPLORER_SETS, 'explore:' + id);
  return official({
    id, type: 'explorer', name: 'Campus Explorer', activity: 'explorer',
    blurb: `Discover ${stops.length} places on campus.`,
    description: 'Explore a part of campus you may not know. Reach every place on the list to finish; each one unlocks its spot on your map.',
    place: stops[0], start: at(day, from), end: at(day, to),
    rewards: { join: { xp: 20 }, done: { coins: 300, xp: 250 } },
    stops, cover: 'mode-explore',
    ...opts,
  });
}

function space(id: string, day: Date, type: EventType, name: string, place: string, from: [number, number], to: [number, number], blurb: string, description: string, opts: Partial<Draft> = {}): CampusEvent {
  return official({
    id, type, name, blurb, description, place,
    start: at(day, ...from), end: to[0] >= 24 ? at(addDays(day, 1), to[0] - 24, to[1]) : at(day, ...to),
    rewards: { join: { xp: 50 }, done: { coins: 200, xp: 150 } },
    ...opts,
  });
}

const GAMES_NIGHT = 'Gather at the SRC Union Building for the Campus Quiz and Target Tap. Scores go on the event leaderboard; the best of the night win bragging rights and coins.';

// ---------- the weekly programme ----------
function dailyEvents(day: Date): CampusEvent[] {
  const k = dayKey(day);
  const dow = day.getDay(); // 0 Sunday
  const list: CampusEvent[] = [
    dow === 0
      ? coinRush(`rainrush:${k}`, day, 15, { type: 'rain', name: 'Rain Rush', blurb: 'Coins on wet roads. Mind the puddles.', rules: ['rain', 'timelimit', 'noracing'], cover: 'type-explorer' })
      : coinRush(`coinrush:${k}`, day, 12),
    sunsetRide(`sunset:${k}`, day),
    nightRush(`night:${k}`, day),
  ];
  if (dow === 1) list.push(explorer(`explorer:${k}`, day, 7, 22));
  if (dow === 2) list.push(official({
    id: `diamond:${k}`, type: 'diamondrush', name: 'Diamond Rush',
    blurb: 'Three rare diamonds on the road for one hour.',
    description: 'Rare diamonds appear on the roads for one hour only. Ride out and grab them: each diamond you pick up is yours to keep.',
    place: 'Legon Main Entrance', start: at(day, 18), end: at(day, 19),
    rewards: { join: { xp: 30 }, done: { xp: 150 } }, rules: ['sunset'], cover: 'lm-gate',
  }));
  if (dow === 3) list.push(photoHunt(`photo:${k}`, day, 8, 20));
  if (dow === 4) list.push(space(`games:${k}`, day, 'games', 'Games Night', 'SRC Union Building', [20, 0], [22, 0], 'Campus Quiz and Target Tap, live.', GAMES_NIGHT, { cover: 'mode-match' }));
  if (dow === 5) list.push(space(`jams:${k}`, day, 'social', 'Botanical Jams', 'University of Ghana Botanical Gardens', [20, 0], [23, 0], 'Music under the trees. Ride in, park, hang out.', 'Friday night at the Botanical Gardens. Ride there, park your bike and enter the jam: say hi, dance, send emotes, play a quick game. All interactions between riders are opt-in.', { cover: 'together' }));
  if (dow === 6) list.push(treasureHunt(`hunt:${k}`, day, 'The Lost Diamond'));
  return list;
}

/** Hall Week and the weekly prize race: Monday to Sunday */
function weekEvents(monday: Date): CampusEvent[] {
  const k = dayKey(monday);
  const end = at(addDays(monday, 7), 0) - 1;
  return [
    official({ id: `hallweek:${k}`, type: 'hall', activity: 'hallweek', name: 'Hall Week', blurb: 'Every kilometre counts for your hall.', description: 'Ride for your hall between Monday and Sunday. Reach the weekly goal for a coin reward, and see how your hall ranks.', place: 'Commonwealth Hall', start: at(monday, 0), end, rewards: {}, cover: 'ev-hall', opens: 0 }),
    official({ id: `prize:${k}`, type: 'special', activity: 'prize', name: 'Weekly Prize Race', blurb: 'Free to enter. The three fastest win cash prizes.', description: 'One race all week, free entry, everyone on the same bike. Results are checked on the server.', place: 'Legon Main Entrance', start: at(monday, 0), end, rewards: {}, cover: 'race', opens: 0 }),
  ];
}

// ---------- seasonal series ----------
interface SeriesDef {
  id: string;
  name: string;
  blurb: string;
  cover: string;
  /** first day of the series in a given year, or null if it doesn't run that year */
  first: (year: number) => Date | null;
  days: ((day: Date, sid: string, n: number, of: number) => CampusEvent)[];
}

const firstWeekday = (y: number, m: number, dow: number) => { const d = new Date(y, m, 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d; };
const lastWeekday = (y: number, m: number, dow: number) => { const d = new Date(y, m + 1, 0); while (d.getDay() !== dow) d.setDate(d.getDate() - 1); return d; };
const ser = (id: string, name: string, day: number, of: number) => ({ series: { id, name, day, of } });

export const SERIES: SeriesDef[] = [
  {
    id: 'freshers', name: 'Freshers Week', cover: 'ob-uni',
    blurb: 'Seven days to find your way around Legon.',
    // the first full week of October, when new students arrive
    first: (y) => firstWeekday(y, 9, 1),
    days: [
      (d, s, n, of) => explorer(`${s}:1`, d, 8, 22, { name: 'Welcome Ride', blurb: 'The places every fresher needs, in one ride.', stops: TOUR_STOPS.slice(0, 5), rewards: { join: { xp: 50 }, done: { coins: 300, xp: 250 } }, cover: 'ob-welcome', ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => treasureHunt(`${s}:2`, d, 'Freshers Treasure Hunt', { ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => space(`${s}:3`, d, 'games', 'Freshers Games Night', 'SRC Union Building', [19, 0], [22, 0], 'Quiz about your new campus, and Target Tap.', GAMES_NIGHT, { cover: 'mode-match', ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => space(`${s}:4`, d, 'hall', 'Hall Competition', 'Athletic Oval', [17, 0], [21, 0], 'Halls go head to head. Every score is a hall point.', 'Represent your hall: play the mini-games at the Athletic Oval and every score adds hall points.', { rewards: { join: { xp: 50 }, done: { coins: 200, xp: 150 }, hall: 50 }, rules: ['teams'], cover: 'ev-hall', ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => space(`${s}:5`, d, 'party', 'Freshers Party', 'SRC Union Building', [20, 0], [24 + 1, 0], 'Meet your year group. Music and dancing.', 'The welcome party: ride in, park, and meet other freshers. Dance, wave, play. Every interaction between riders is opt-in.', { cover: 'ev-night', ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => sunsetRide(`${s}:6`, d, { name: 'Freshers Sunset Ride', ...ser(s, 'Freshers Week', n, of) }),
      (d, s, n, of) => space(`${s}:7`, d, 'festival', 'Freshers Grand Finale', 'Athletic Oval', [16, 0], [22, 0], 'The week ends big at the Athletic Oval.', 'Everything at once: games, music and the Freshers Week rewards. Take part to earn the Freshers jersey.', { rewards: { join: { xp: 100 }, done: { coins: 500, xp: 300, items: ['ev-jersey-freshers', 'badge-freshers'] } }, cover: 'halls', ...ser(s, 'Freshers Week', n, of) }),
    ],
  },
  {
    id: 'independence', name: 'Independence Ride', cover: 'about',
    blurb: 'Ghana\'s Independence Day, 6 March.',
    first: (y) => new Date(y, 2, 6),
    days: [
      (d, s, n, of) => explorer(`${s}:1`, d, 6, 20, { type: 'seasonal', name: 'Independence Ride', blurb: 'Red, gold and green across campus.', description: 'Celebrate Independence Day with a ride past the campus landmarks. Finish it for the Black Star bike decal and the Independence badge.', stops: ['Legon Main Entrance', 'Great Hall', 'Balme Library Fountain', 'Athletic Oval'], rewards: { join: { xp: 60 }, done: { coins: 600, xp: 300, items: ['ev-decal-ghana', 'badge-independence'] } }, cover: 'about', ...ser(s, 'Independence Ride', n, of) }),
    ],
  },
  {
    id: 'valentine', name: 'Valentine on Campus', cover: 'type-social',
    blurb: 'Photo spots, paired rides and a jam. Everything is opt-in.',
    first: (y) => new Date(y, 1, 14),
    days: [
      (d, s, n, of) => sunsetRide(`${s}:1`, d, { type: 'seasonal', name: 'Valentine Sunset Ride', blurb: 'Golden hour with someone, or on your own.', ...ser(s, 'Valentine on Campus', n, of) }),
      (d, s, n, of) => space(`${s}:2`, d, 'seasonal', 'Valentine Jam', 'University of Ghana Botanical Gardens', [19, 0], [23, 0], 'Music under the trees. Hearts are opt-in, 18+.', 'A relaxed evening at the Botanical Gardens. Send waves and high-fives; hearts are only for riders 18 and over who both accept. Block, mute and report are always one tap away.', { rewards: { join: { xp: 50 }, done: { coins: 200, xp: 150, items: ['badge-valentine'] } }, cover: 'type-social', ...ser(s, 'Valentine on Campus', n, of) }),
    ],
  },
  {
    id: 'graduation', name: 'Graduation Fest', cover: 'lm-hall',
    blurb: 'Congratulations, graduates. Photos, a party and limited items.',
    // congregation season: the last Thursday of July for three days
    first: (y) => lastWeekday(y, 6, 4),
    days: [
      (d, s, n, of) => photoHunt(`${s}:1`, d, 8, 20, { name: 'Graduation Photo Hunt', stops: ['Great Hall', 'The Balme Library', 'Legon Main Entrance', 'Balme Library Fountain'], ...ser(s, 'Graduation Fest', n, of) }),
      (d, s, n, of) => space(`${s}:2`, d, 'festival', 'Graduation Party', 'Great Hall', [18, 0], [23, 0], 'Celebrate on Legon Hill.', 'Graduates, friends and family: gather at the Great Hall. Earn the graduation sash.', { rewards: { join: { xp: 80 }, done: { coins: 300, xp: 200, items: ['ev-sash-graduation', 'badge-graduation'] } }, cover: 'lm-hall', ...ser(s, 'Graduation Fest', n, of) }),
      (d, s, n, of) => sunsetRide(`${s}:3`, d, { name: 'Graduation Sunset Ride', ...ser(s, 'Graduation Fest', n, of) }),
    ],
  },
  {
    id: 'christmas', name: 'Christmas on Campus', cover: 'ev-night',
    blurb: 'Lights, gifts and games, 21 to 25 December.',
    first: (y) => new Date(y, 11, 21),
    days: [
      (d, s, n, of) => explorer(`${s}:1`, d, 18, 23, { type: 'seasonal', name: 'Christmas Lights Ride', blurb: 'The campus lit up at night.', rules: ['night', 'noracing'], cover: 'ev-night', ...ser(s, 'Christmas on Campus', n, of) }),
      (d, s, n, of) => treasureHunt(`${s}:2`, d, 'Christmas Gift Hunt', { type: 'seasonal', rewards: { join: { xp: 50 }, done: { coins: 1000, diamonds: 1, xp: 300, items: ['ev-bell-jingle'] } }, ...ser(s, 'Christmas on Campus', n, of) }),
      (d, s, n, of) => space(`${s}:3`, d, 'games', 'Christmas Games', 'SRC Union Building', [18, 0], [22, 0], 'The Christmas quiz and Target Tap.', GAMES_NIGHT, { ...ser(s, 'Christmas on Campus', n, of) }),
      (d, s, n, of) => space(`${s}:4`, d, 'party', 'Christmas Eve Party', 'Great Hall', [19, 0], [24 + 1, 0], 'Music and lights on Legon Hill.', 'Christmas Eve on Legon Hill. Ride in, park, celebrate.', { rewards: { join: { xp: 60 }, done: { coins: 300, xp: 150, items: ['badge-christmas'] } }, cover: 'ev-night', ...ser(s, 'Christmas on Campus', n, of) }),
      (d, s, n, of) => coinRush(`${s}:5`, d, 10, { type: 'seasonal', name: 'Christmas Coin Rush', rewards: { join: { xp: 30 }, done: { coins: 300, xp: 150, items: ['badge-christmas'] } }, ...ser(s, 'Christmas on Campus', n, of) }),
    ],
  },
];

/** Hall Wars: the third week of every month (the Monday between the 15th and 21st) */
function hallWars(year: number, month: number): SeriesInfo | null {
  const mon = firstWeekday(year, month, 1);
  mon.setDate(mon.getDate() + 14);
  const id = `hallwars-${dayKey(mon)}`;
  const name = 'Hall Wars';
  const s = (n: number) => ({ series: { id, name, day: n, of: 4 } });
  const hall = { rules: ['teams'] as RuleId[] };
  const days = [
    treasureHunt(`${id}:1`, mon, 'Hall Wars: Treasure Hunt', { type: 'hall', rewards: { join: { xp: 50 }, done: { coins: 800, xp: 250 }, hall: 100 }, ...hall, ...s(1) }),
    space(`${id}:2`, addDays(mon, 2), 'hall', 'Hall Wars: Quiz Night', 'SRC Union Building', [19, 0], [22, 0], 'Every correct answer is a point for your hall.', 'Halls compete in the Campus Quiz and Target Tap. Scores add up for your hall.', { rewards: { join: { xp: 50 }, done: { coins: 200, xp: 150 }, hall: 50 }, cover: 'ev-hall', ...hall, ...s(2) }),
    coinRush(`${id}:3`, addDays(mon, 4), 17, { type: 'hall', name: 'Hall Wars: Coin Rush', rewards: { join: { xp: 30 }, done: { coins: 150, xp: 100 }, hall: 50 }, ...hall, ...s(3) }),
    space(`${id}:4`, addDays(mon, 6), 'hall', 'Hall Wars: Finale', 'Athletic Oval', [16, 0], [20, 0], 'The last day. Bring your whole hall.', 'The final day of Hall Wars at the Athletic Oval. Play, score and see which hall takes the week.', { rewards: { join: { xp: 80 }, done: { coins: 300, xp: 200 }, hall: 100 }, cover: 'halls', ...hall, ...s(4) }),
  ];
  return { id, name, blurb: 'Halls compete all week: every activity earns hall points.', cover: 'ev-hall', start: days[0].start, end: days[3].end, days };
}

function seriesBetween(from: number, to: number): SeriesInfo[] {
  const out: SeriesInfo[] = [];
  const y0 = new Date(from).getFullYear(), y1 = new Date(to).getFullYear();
  for (let y = y0 - 1; y <= y1; y++) {
    for (const def of SERIES) {
      const first = def.first(y);
      if (!first) continue;
      const sid = `${def.id}-${y}`;
      const days = def.days.map((mk, i) => mk(addDays(first, i), sid, i + 1, def.days.length));
      const start = Math.min(...days.map((e) => e.start)), end = Math.max(...days.map((e) => e.end));
      if (end < from || start > to) continue;
      out.push({ id: sid, name: def.days.length > 1 ? `${def.name} ${y}` : def.name, blurb: def.blurb, cover: def.cover, start, end, days });
    }
  }
  const d = new Date(from);
  for (let m = 0; m < 3; m++) {
    const hw = hallWars(d.getFullYear(), d.getMonth() + m);
    if (hw && hw.end >= from && hw.start <= to) out.push(hw);
  }
  return out.sort((a, b) => a.start - b.start);
}

let cache: { at: number; events: CampusEvent[]; series: SeriesInfo[] } | null = null;
/** the official calendar from yesterday to two weeks ahead, plus series up to two months ahead */
export function officialCalendar(t = now()) {
  if (cache && Math.abs(cache.at - t) < 60e3) return cache;
  const today = new Date(t);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const events: CampusEvent[] = [];
  for (let i = -1; i <= 14; i++) events.push(...dailyEvents(addDays(base, i)));
  const monday = addDays(base, -((base.getDay() + 6) % 7));
  events.push(...weekEvents(monday), ...weekEvents(addDays(monday, 7)));
  const series = seriesBetween(t - DAY, t + 60 * DAY);
  for (const s of series) events.push(...s.days);
  cache = { at: t, events, series };
  return cache;
}

// ---------- status ----------
export function statusOf(e: CampusEvent, t = now()): Status {
  if (e.cancelled) return 'cancelled';
  if (t >= e.end) return 'completed';
  if (t >= e.start) return e.end - t <= Math.min(30 * MIN, (e.end - e.start) * 0.25) ? 'ending' : 'live';
  if (e.start - t <= 60 * MIN) return 'soon';
  const opens = e.createdAt ?? e.start - DAY;
  if (t >= opens && t <= (e.regDeadline ?? e.end)) return 'open';
  return 'upcoming';
}
export const STATUS_LABEL: Record<Status, string> = {
  upcoming: 'Upcoming', open: 'Registration open', soon: 'Starting soon', live: 'Live now', ending: 'Ending soon', completed: 'Completed', cancelled: 'Cancelled',
};
export const isOn = (s: Status) => s === 'live' || s === 'ending';

/** the timed race event (Sunset Rush / Night Rush) behind an event, and whether it is live */
export function timedOf(e: CampusEvent) {
  const def = e.timed ? EVENTS.find((x) => x.id === e.timed) : undefined;
  return def ? { def, live: eventStatus(def, new Date(now())).live } : null;
}

// ---------- words for times ----------
const hm = (t: number) => {
  const d = new Date(t);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
};
export function whenText(e: CampusEvent, t = now()) {
  const s = new Date(e.start), today = new Date(t);
  const days = Math.round((new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY);
  if (e.end - e.start >= 5 * DAY) return `Until ${new Date(e.end).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  const day = days === 0 ? (s.getHours() >= 18 ? 'Tonight' : 'Today') : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${hm(e.start)}`;
}
export const rangeText = (e: CampusEvent) => `${new Date(e.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${hm(e.start)} to ${hm(e.end)}`;
export function countdown(ms: number) {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.round(h / 24)} days`;
}
export { hm as hourText };
