// Campus Life: places on campus that are always open to hang out at. Ride there, park, and the
// place is full of people: real riders who are there right now, plus students (bots) who keep it
// lively. Each place has its own look, music and things to do.
import type { PartyStyle } from '../../audio';
import { HALL_PLACE, hallById } from '../../data/campus';
import { placeByName } from '../../game/campusmap';
import type { CampusEvent } from '../events/types';

export type Theme = 'market' | 'jam' | 'square' | 'garden' | 'hall';

export interface Venue {
  id: string;
  name: string;
  /** a place name on the campus map */
  place: string;
  theme: Theme;
  style: PartyStyle;
  /** one line for the card */
  blurb: string;
  /** what you can do there, for the card */
  things: string[];
  /** busiest hours (24h, Accra time) */
  peak: [number, number];
  /** fewest and most people at once */
  crowd: [number, number];
  cover: string;
  /** hall hangouts: the hall's colour */
  color?: string;
  /** DJ air horn now and then */
  horn?: boolean;
  /** what the stalls sell (ids in FOOD) */
  menu?: string[];
  /** sold only here */
  special?: MenuItem;
  /** free food in these hours (Accra time), paid by a sponsor */
  sponsor?: { by: string; item: string; hours: [number, number] };
}

// ---------- food and drinks ----------
export interface MenuItem { id: string; name: string; price: number; emoji: string; drink?: boolean }
export const FOOD: Record<string, MenuItem> = Object.fromEntries(([
  ['jollof', 'Jollof & chicken', 40, '🍛'],
  ['waakye', 'Waakye', 35, '🍲'],
  ['kelewele', 'Kelewele', 20, '🍠'],
  ['burger', 'Burger', 50, '🍔'],
  ['pizza', 'Pizza slice', 35, '🍕'],
  ['indomie', 'Indomie & egg', 25, '🍜'],
  ['shawarma', 'Shawarma', 45, '🌯'],
  ['khebab', 'Khebab', 15, '🍢'],
  ['friedrice', 'Fried rice', 35, '🍚'],
  ['popcorn', 'Popcorn', 10, '🍿'],
  ['soda', 'Soft drink', 15, '🥤', true],
  ['malt', 'Malt', 15, '🍾', true],
  ['sobolo', 'Sobolo', 10, '🧃', true],
  ['water', 'Water', 5, '💧', true],
  ['coconut', 'Fresh coconut', 12, '🥥', true],
  ['icecream', 'Ice cream', 20, '🍦'],
] as const).map(([id, name, price, emoji, drink]) => [id, { id, name, price, emoji, drink: !!drink }]));

const MENUS: Record<Theme, string[]> = {
  market: ['jollof', 'waakye', 'kelewele', 'indomie', 'khebab', 'friedrice', 'shawarma', 'soda', 'malt', 'sobolo', 'water'],
  jam: ['burger', 'pizza', 'shawarma', 'khebab', 'soda', 'malt', 'sobolo', 'water'],
  square: ['pizza', 'kelewele', 'popcorn', 'icecream', 'soda', 'sobolo', 'water'],
  garden: ['popcorn', 'kelewele', 'icecream', 'coconut', 'sobolo', 'water'],
  hall: ['jollof', 'pizza', 'burger', 'friedrice', 'soda', 'malt', 'sobolo', 'water'],
};
export const menuOf = (v: Venue): MenuItem[] => [...(v.special ? [v.special] : []), ...(v.menu ?? MENUS[v.theme]).map((id) => FOOD[id]).filter(Boolean)];
const inHours = ([a, b]: [number, number], h: number) => (a <= b ? h >= a && h < b : h >= a || h < b);
/** the sponsored free item, while it's free */
export const freeNow = (v: Venue, t = Date.now()) => (v.sponsor && inHours(v.sponsor.hours, accraHour(t)) ? { by: v.sponsor.by, item: v.special?.id === v.sponsor.item ? v.special : FOOD[v.sponsor.item] } : null);

// ---------- what's on stage ----------
export type ShowKind = 'dj' | 'live' | 'dance' | 'karaoke' | 'openmic' | 'comedy' | 'acoustic' | 'movie' | 'poetry';
export const SHOW: Record<ShowKind, { label: string; emoji: string; line: string }> = {
  dj: { label: 'DJ set', emoji: '🎧', line: 'Spinning Afrobeats and Amapiano. Request a song!' },
  live: { label: 'Live band', emoji: '🎸', line: 'A campus band playing highlife and Afrobeats live.' },
  dance: { label: 'Dance crew', emoji: '💃', line: 'The dance crew is showing off new moves. Join in!' },
  karaoke: { label: 'Karaoke', emoji: '🎤', line: 'Grab the mic and sing your favourite song.' },
  openmic: { label: 'Open mic', emoji: '🎙️', line: 'Campus artists, rappers and singers take turns.' },
  comedy: { label: 'Comedy night', emoji: '😂', line: 'Stand-up about hall life, lecturers and trotro rides.' },
  acoustic: { label: 'Acoustic session', emoji: '🪕', line: 'Guitar, soft voices and good vibes.' },
  movie: { label: 'Movie screening', emoji: '🎬', line: 'A Ghanaian classic on the big screen under the stars.' },
  poetry: { label: 'Spoken word', emoji: '📜', line: 'Poets from across campus sharing their words.' },
};
const LINEUP: Record<Theme, ShowKind[]> = {
  market: ['dj', 'live', 'comedy', 'dj', 'karaoke'],
  jam: ['dj', 'dance', 'dj', 'live', 'dj'],
  square: ['openmic', 'dj', 'acoustic', 'comedy'],
  garden: ['acoustic', 'poetry', 'acoustic'],
  hall: ['dj', 'karaoke', 'dance', 'dj', 'live'],
};
const STAGE_NAMES = ['Kofi Beatz', 'Ama Vibes', 'Nii Spinz', 'Efya Jnr', 'Kwesi Keys', 'Sena Soul', 'Yaw Flow', 'Abena Blaze', 'Mawuli Mix', 'Naa Melody', 'Fiifi Bounce', 'Lamisi Sings'];
const CREWS = ['Legon Movers', 'Vandal Steps', 'Volta Queens', 'Sarbah Groove', 'Akuafo Feet'];
/** who's performing at a venue this hour (the same for everyone) */
export function showNow(v: Venue, t = Date.now()) {
  const hour = Math.floor(t / 3600e3);
  let seed = hour;
  for (const c of v.id) seed = (seed * 31 + c.charCodeAt(0)) % 100003;
  const night = skyNow(t) === 'night';
  let kind = LINEUP[v.theme][hour % LINEUP[v.theme].length];
  if (v.theme === 'garden' && night) kind = 'movie';
  const who = kind === 'dance' ? CREWS[seed % CREWS.length] : kind === 'dj' ? `DJ ${STAGE_NAMES[seed % STAGE_NAMES.length].split(' ')[0]}` : kind === 'movie' ? 'Campus Cinema' : STAGE_NAMES[seed % STAGE_NAMES.length];
  const ends = (hour + 1) * 3600e3;
  return { kind, who, ...SHOW[kind], ends, next: SHOW[LINEUP[v.theme][(hour + 1) % LINEUP[v.theme].length]].label };
}

const BASE: Venue[] = [
  { id: 'night-market', name: 'Night Market', place: 'Night Market', theme: 'market', style: 'afrobeats', blurb: 'Food stalls, music and friends till late.', things: ['Eat', 'Chill', 'Dance', 'Photos'], peak: [18, 24], crowd: [22, 72], cover: 'ev-night', special: { id: 'nm-special', name: 'Night Market khebab platter', price: 30, emoji: '🍢' }, sponsor: { by: 'Rush Cola', item: 'soda', hours: [19, 21] } },
  { id: 'campus-jam', name: 'Campus Jam', place: 'Athletic Oval', theme: 'jam', style: 'amapiano', blurb: 'DJ, sound system and a dance floor at the Oval.', things: ['Dance', 'DJ', 'Photo wall', 'Meet people'], peak: [19, 24], crowd: [30, 110], cover: 'together', horn: true, special: { id: 'jam-smoothie', name: 'Campus Jam smoothie', price: 25, emoji: '🍹', drink: true }, sponsor: { by: 'Legon Bites', item: 'burger', hours: [20, 22] } },
  { id: 'banking-square', name: 'Banking Square meetup', place: 'University of Ghana banking square', theme: 'square', style: 'highlife', blurb: 'Meet up between the banks and the Night Market.', things: ['Meet', 'Chat', 'Sit', 'Photos'], peak: [10, 18], crowd: [12, 40], cover: 'type-social' },
  { id: 'balme', name: 'Balme Hangout', place: 'Balme Library Fountain', theme: 'square', style: 'chill', blurb: 'Chill by the fountain before or after the library.', things: ['Sit', 'Study talk', 'Photos'], peak: [9, 20], crowd: [10, 32], cover: 'lm-balme', sponsor: { by: 'Balme Friends', item: 'water', hours: [9, 12] } },
  { id: 'cc', name: 'CC lunch hangout', place: 'Central Cafeteria, CC', theme: 'market', style: 'highlife', blurb: 'Lunch, gist and course mates in the middle of the halls.', things: ['Eat', 'Gist', 'Meet people'], peak: [11, 16], crowd: [18, 56], cover: 'type-social', sponsor: { by: 'CC Kitchen', item: 'jollof', hours: [12, 14] } },
  { id: 'bush-canteen', name: 'Bush Canteen chill', place: 'Bush Canteen (near Department of Music)', theme: 'market', style: 'chill', blurb: 'Shady benches, local food and slow afternoons.', things: ['Eat', 'Chill', 'Chat'], peak: [12, 18], crowd: [12, 40], cover: 'ev-night' },
  { id: 'pent', name: 'Pent Nights', place: 'Pent Food Court', theme: 'jam', style: 'amapiano', blurb: 'Late food and a speaker that never stops at Pent.', things: ['Dance', 'Eat', 'Meet people'], peak: [19, 24], crowd: [18, 64], cover: 'together', special: { id: 'pent-wings', name: 'Pent spicy wings', price: 40, emoji: '🍗' } },
  { id: 'src-union', name: 'SRC Union hangout', place: 'SRC Union Building', theme: 'square', style: 'afrobeats', blurb: 'Where clubs, freshers and everybody else meet.', things: ['Meet', 'Chat', 'Clubs', 'Photos'], peak: [13, 22], crowd: [14, 48], cover: 'type-social', sponsor: { by: 'SRC', item: 'sobolo', hours: [14, 16] } },
  { id: 'ish-mixer', name: 'ISH mixer', place: 'International Students Hostel 1, ISH 1', theme: 'square', style: 'afrobeats', blurb: 'Meet students from all over the world.', things: ['Meet people', 'Chat', 'Dance'], peak: [18, 24], crowd: [14, 46], cover: 'together' },
  { id: 'great-hall', name: 'Sunset on Legon Hill', place: 'Great Hall', theme: 'garden', style: 'chill', blurb: 'The best view on campus as the sun goes down.', things: ['Sunset photos', 'Chill', 'Talk'], peak: [16, 20], crowd: [10, 36], cover: 'ev-sunset' },
  { id: 'gardens', name: 'Sunset at the Gardens', place: 'University of Ghana Botanical Gardens', theme: 'garden', style: 'chill', blurb: 'Picnic mats, soft music and the sunset.', things: ['Picnic', 'Sunset photos', 'Chill'], peak: [16, 20], crowd: [8, 30], cover: 'ev-sunset', sponsor: { by: 'Campus Cinema', item: 'popcorn', hours: [19, 22] } },
];

/** your hall's hangout (Legon Hall for non-residents) */
export function hallVenue(hallId: string): Venue {
  const h = hallById(HALL_PLACE[hallId] && placeByName(HALL_PLACE[hallId]) ? hallId : 'legon');
  return { id: `hall-${h.id}`, name: `${h.name} Party`, place: HALL_PLACE[h.id], theme: 'hall', style: 'afrobeats', blurb: `Decorations, a DJ, food and ${h.short} people.`, things: ['Hall vibes', 'Dance', 'Food', 'Photos'], peak: [17, 24], crowd: [20, 80], cover: 'ev-hall', color: h.color, special: { id: 'hall-punch', name: `${h.short} hall punch`, price: 15, emoji: '🍹', drink: true }, sponsor: { by: `${h.short} JCR`, item: 'jollof', hours: [19, 21] } };
}

export function venues(hallId: string): Venue[] {
  return [...BASE, hallVenue(hallId)].filter((v) => placeByName(v.place));
}
export const venueById = (id: string, hallId: string) => venues(hallId).find((v) => v.id === id) ?? (id.startsWith('hall-') ? hallVenue(id.slice(5)) : undefined);

/** the hour in Accra (GMT all year) */
export const accraHour = (t = Date.now()) => { const d = new Date(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };

/** what the sky looks like there now */
export const skyNow = (t = Date.now()): 'day' | 'sunset' | 'night' => { const h = accraHour(t); return h >= 6 && h < 17.25 ? 'day' : h >= 17.25 && h < 18.6 ? 'sunset' : 'night'; };

/** how full a place is (0..1) at an hour: busiest in its peak hours, quiet in the small hours */
function busy(v: Venue, h: number) {
  const [a, b] = v.peak;
  const inPeak = a <= b ? h >= a && h < b : h >= a || h < b;
  if (inPeak) return 1;
  const gap = Math.min(Math.abs(h - a), Math.abs(h - b), Math.abs(h + 24 - a), Math.abs(h - 24 - b));
  const late = h >= 1 && h < 6 ? 0.3 : 1;
  return Math.max(0.2, (1 - gap / 8) * late);
}

/**
 * About how many people are there now. Same number for everyone (it moves in 5-minute steps),
 * so two riders at the same place see the same crowd size.
 */
export function crowdNow(v: Venue, t = Date.now()) {
  const slot = Math.floor(t / 300e3);
  let seed = slot * 31;
  for (const c of v.id) seed = (seed * 33 + c.charCodeAt(0)) % 100003;
  const wobble = ((seed % 1000) / 1000 - 0.5) * 6;
  const [lo, hi] = v.crowd;
  return Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * busy(v, accraHour(t)) + wobble)));
}

/** the venue as an always-live event, so the event space (chat, games, passport) works there */
export function venueEvent(v: Venue): CampusEvent {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return {
    key: `life:${v.id}`, source: 'official', type: v.theme === 'hall' ? 'hall' : 'social', activity: 'space',
    name: v.name, blurb: v.blurb, description: v.blurb, cover: v.cover, host: 'Campus Life', place: v.place,
    start: day.getTime(), end: day.getTime() + 86400e3, capacity: null, fee: 0, rewards: {}, rules: [],
  };
}
