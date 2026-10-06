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
}

const BASE: Venue[] = [
  { id: 'night-market', name: 'Night Market', place: 'Night Market', theme: 'market', style: 'afrobeats', blurb: 'Food stalls, music and friends till late.', things: ['Eat', 'Chill', 'Dance', 'Photos'], peak: [18, 24], crowd: [9, 30], cover: 'ev-night' },
  { id: 'campus-jam', name: 'Campus Jam', place: 'Athletic Oval', theme: 'jam', style: 'amapiano', blurb: 'DJ, sound system and a dance floor at the Oval.', things: ['Dance', 'DJ', 'Photo wall', 'Meet people'], peak: [19, 24], crowd: [7, 34], cover: 'together', horn: true },
  { id: 'banking-square', name: 'Banking Square meetup', place: 'University of Ghana banking square', theme: 'square', style: 'highlife', blurb: 'Meet up between the banks and the Night Market.', things: ['Meet', 'Chat', 'Sit', 'Photos'], peak: [10, 18], crowd: [6, 22], cover: 'type-social' },
  { id: 'balme', name: 'Balme Hangout', place: 'Balme Library Fountain', theme: 'square', style: 'chill', blurb: 'Chill by the fountain before or after the library.', things: ['Sit', 'Study talk', 'Photos'], peak: [9, 20], crowd: [5, 18], cover: 'lm-balme' },
  { id: 'gardens', name: 'Sunset at the Gardens', place: 'University of Ghana Botanical Gardens', theme: 'garden', style: 'chill', blurb: 'Picnic mats, soft music and the sunset.', things: ['Picnic', 'Sunset photos', 'Chill'], peak: [16, 20], crowd: [4, 20], cover: 'ev-sunset' },
];

/** your hall's hangout (Legon Hall for non-residents) */
export function hallVenue(hallId: string): Venue {
  const h = hallById(HALL_PLACE[hallId] && placeByName(HALL_PLACE[hallId]) ? hallId : 'legon');
  return { id: `hall-${h.id}`, name: `${h.name} hangout`, place: HALL_PLACE[h.id], theme: 'hall', style: 'afrobeats', blurb: `Hall music, banners and ${h.short} people.`, things: ['Hall vibes', 'Dance', 'Merch', 'Photos'], peak: [17, 23], crowd: [6, 26], cover: 'ev-hall', color: h.color };
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
  const late = h >= 1 && h < 6 ? 0.15 : 1;
  return Math.max(0.12, (1 - gap / 7) * late);
}

/**
 * About how many people are there now. Same number for everyone (it moves in 5-minute steps),
 * so two riders at the same place see the same crowd size.
 */
export function crowdNow(v: Venue, t = Date.now()) {
  const slot = Math.floor(t / 300e3);
  let seed = slot * 31;
  for (const c of v.id) seed = (seed * 33 + c.charCodeAt(0)) % 100003;
  const wobble = ((seed % 1000) / 1000 - 0.5) * 4;
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
