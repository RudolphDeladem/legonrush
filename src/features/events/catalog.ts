// Event types, covers, locations, rules and the event reward items (titles, badges, cosmetics).
import { icons } from '../../ui/icons';
import type { Activity, EventType, RuleId } from './types';

export type FilterId = 'all' | 'live' | 'today' | 'upcoming' | 'treasure' | 'social' | 'games' | 'hall' | 'free';

export interface TypeMeta {
  label: string;
  icon: string;
  /** which filter chip it belongs to */
  group: 'treasure' | 'social' | 'games' | 'hall' | 'ride';
  /** what a community event of this type does */
  activity: Activity;
  cover: string;
  /** shown in the creation wizard */
  wizard: boolean;
  hint: string;
}

export const TYPES: Record<EventType, TypeMeta> = {
  treasure: { label: 'Treasure Hunt', icon: icons.diamond, group: 'treasure', activity: 'hunt', cover: 'lm-aerial', wizard: false, hint: 'Hide a treasure; riders follow clues and a hot/cold meter.' },
  social: { label: 'Social / Jam', icon: icons.music, group: 'social', activity: 'space', cover: 'together', wizard: true, hint: 'Ride there, park, hang out: chat, emotes, music.' },
  games: { label: 'Mini-Game', icon: icons.target, group: 'games', activity: 'space', cover: 'mode-match', wizard: false, hint: 'Campus Quiz and Target Tap with an event leaderboard.' },
  festival: { label: 'Campus Festival', icon: icons.sparkle, group: 'social', activity: 'space', cover: 'halls', wizard: true, hint: 'A big gathering with games and things to do.' },
  hall: { label: 'Hall Event', icon: icons.pillars, group: 'hall', activity: 'space', cover: 'ev-hall', wizard: true, hint: 'For your hall: games and hall points.' },
  explorer: { label: 'Exploration', icon: icons.compass, group: 'ride', activity: 'explorer', cover: 'mode-explore', wizard: false, hint: 'Reach a list of campus places.' },
  party: { label: 'Party', icon: icons.sparkle, group: 'social', activity: 'space', cover: 'ev-night', wizard: true, hint: 'Music, dancing and emotes.' },
  sports: { label: 'Sports Activity', icon: icons.ball, group: 'games', activity: 'space', cover: 'race', wizard: false, hint: 'Skill games at a sports spot.' },
  seasonal: { label: 'Seasonal Event', icon: icons.star, group: 'social', activity: 'space', cover: 'about', wizard: true, hint: 'Christmas, Valentine, Independence and more.' },
  gathering: { label: 'Community Gathering', icon: icons.users, group: 'social', activity: 'space', cover: 'type-social', wizard: true, hint: 'Meet riders: a club, a course, a crew.' },
  special: { label: 'Special Event', icon: icons.megaphone, group: 'social', activity: 'space', cover: 'hero', wizard: true, hint: 'Anything else worth gathering for.' },
  // official-only kinds
  coinrush: { label: 'Coin Rush', icon: icons.coin, group: 'treasure', activity: 'coinrush', cover: 'ride', wizard: false, hint: '' },
  diamondrush: { label: 'Diamond Rush', icon: icons.diamond, group: 'treasure', activity: 'diamondrush', cover: 'lm-gate', wizard: false, hint: '' },
  photohunt: { label: 'Photo Hunt', icon: icons.camera, group: 'ride', activity: 'photohunt', cover: 'lm-balme', wizard: false, hint: '' },
  sunset: { label: 'Sunset Ride', icon: icons.sunrise, group: 'ride', activity: 'sunset', cover: 'ev-sunset', wizard: false, hint: '' },
  night: { label: 'Night Rush', icon: icons.moon, group: 'ride', activity: 'timed', cover: 'ev-night', wizard: false, hint: '' },
  rain: { label: 'Rain Rush', icon: icons.rain, group: 'ride', activity: 'coinrush', cover: 'type-explorer', wizard: false, hint: '' },
};

export const FILTERS: [FilterId, string][] = [
  ['all', 'All'], ['live', 'Live now'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['social', 'Parties & jams'], ['hall', 'Hall'], ['free', 'Free'],
];

export type SortId = 'soon' | 'popular' | 'reward' | 'closest' | 'free' | 'recent';
export const SORTS: [SortId, string][] = [
  ['soon', 'Starting soon'], ['popular', 'Most popular'], ['reward', 'Highest reward'], ['closest', 'Closest'], ['free', 'Free first'], ['recent', 'Recently added'],
];

/** photos riders can pick as a cover (public/photos) */
export const COVERS: [string, string][] = [
  ['together', 'Riding together'], ['ev-night', 'Night ride'], ['ev-sunset', 'Sunset'], ['ev-hall', 'Hall crowd'], ['halls', 'Hall colours'],
  ['lm-aerial', 'Campus from above'], ['about', 'Legon Hill'], ['lm-balme', 'Balme Library'], ['lm-gate', 'Main Gate'], ['lm-tower', 'The tower'],
  ['mode-explore', 'Explore'], ['type-social', 'Friends'], ['race', 'Sprint'], ['ready', 'Golden hour'], ['hero', 'The pack'], ['world', 'Campus road'],
];
export const coverUrl = (id: string) => `${import.meta.env.BASE_URL}photos/${COVERS.some(([c]) => c === id) || /^[a-z-]+$/.test(id) ? id : 'together'}.webp`;

/** well-known places for events, in the order the wizard offers them (names on the campus map) */
export const LOCATIONS: [string, string][] = [
  ['Athletic Oval', 'Athletic Oval'],
  ['University of Ghana Botanical Gardens', 'Botanical Gardens'],
  ['Balme Library Fountain', 'Balme Fountain (University Square)'],
  ['Great Hall', 'Great Hall'],
  ['The Balme Library', 'Balme Library'],
  ['Legon Main Entrance', 'Main Gate'],
  ['Night Market', 'Night Market'],
  ['Kuffour Quadrangle', 'Kuffour Quadrangle'],
  ['SRC Union Building', 'SRC Union Building'],
  ['University of Ghana Sports Directorate', 'Sports Directorate'],
  ['School of Engineering Sciences', 'Engineering'],
  ['Commonwealth Hall', 'Commonwealth Hall'],
  ['Legon Hall', 'Legon Hall'],
  ['Akuafo Hall Main', 'Akuafo Hall'],
  ['Volta Hall', 'Volta Hall'],
  ['Mensah Sarbah Hall', 'Mensah Sarbah Hall'],
  ['Central Cafeteria, CC', 'Central Cafeteria'],
];
export const placeLabel = (name: string) => LOCATIONS.find(([n]) => n === name)?.[1] ?? name.replace(/, [A-Z0-9 ]+$/, '').split(' (')[0];

export interface RuleMeta { label: string; icon: string; hint: string; ride: boolean }
export const RULES: Record<RuleId, RuleMeta> = {
  night: { label: 'Night mode', icon: icons.moon, hint: 'The campus after dark', ride: true },
  sunset: { label: 'Golden hour', icon: icons.sunrise, hint: 'Sunset light', ride: true },
  rain: { label: 'Rain', icon: icons.rain, hint: 'Wet, slippery roads', ride: true },
  fog: { label: 'Fog', icon: icons.fog, hint: 'You can only see a short way', ride: true },
  nominimap: { label: 'No minimap', icon: icons.map, hint: 'Find your own way', ride: true },
  noboost: { label: 'No boost', icon: icons.bolt, hint: 'Pedal power only', ride: true },
  nohelmet: { label: 'No helmet', icon: icons.helmet, hint: 'Helmets stay at home', ride: true },
  timelimit: { label: 'Time limit', icon: icons.clock, hint: 'Beat the clock', ride: true },
  noracing: { label: 'No racing', icon: icons.flag, hint: 'Ride calm: no traffic to dodge', ride: true },
  teams: { label: 'Team mode', icon: icons.users, hint: 'Scores add up for your hall', ride: false },
  hidden: { label: 'Hidden objectives', icon: icons.eye, hint: 'Some goals are revealed on the day', ride: false },
};
/** rules a creator can pick in the wizard */
export const WIZARD_RULES: RuleId[] = ['night', 'rain', 'fog', 'nominimap', 'noboost', 'nohelmet', 'timelimit', 'noracing', 'teams', 'hidden'];

// ---------- event reward items ----------
// Items go into profile.items via inventory.grant(). Titles and badges are shown by the Profile,
// cosmetics by the Garage (ids start with "ev-").
export interface EventItem { id: string; name: string; kind: 'title' | 'badge' | 'cosmetic'; icon: string; note: string }
export const EVENT_ITEMS: EventItem[] = [
  { id: 'title-treasure-hunter', name: 'Treasure Hunter', kind: 'title', icon: icons.diamond, note: 'Found treasure, coins and diamonds at events' },
  { id: 'title-campus-explorer', name: 'Campus Explorer', kind: 'title', icon: icons.compass, note: 'Photo Hunt, Campus Explorer and a Sunset Ride' },
  { id: 'title-night-rider', name: 'Night Rider', kind: 'title', icon: icons.moon, note: 'Three Night Rush events' },
  { id: 'title-life-of-the-party', name: 'Life of the Party', kind: 'title', icon: icons.sparkle, note: 'A jam, a party and a games night' },
  { id: 'title-freshers-champion', name: 'Freshers Champion', kind: 'title', icon: icons.grad, note: 'Five days of Freshers Week' },
  { id: 'title-hall-hero', name: 'Hall Hero', kind: 'title', icon: icons.pillars, note: 'Three Hall Wars events for your hall' },
  { id: 'badge-passport-complete', name: 'Full Passport', kind: 'badge', icon: icons.stamp, note: 'A stamp of every kind' },
  { id: 'badge-independence', name: 'Independence Rider', kind: 'badge', icon: icons.flagGh, note: 'Rode on Independence Day, 6 March' },
  { id: 'badge-christmas', name: 'Christmas on Campus', kind: 'badge', icon: icons.tree, note: 'Took part in Christmas on Campus' },
  { id: 'badge-valentine', name: 'Valentine on Campus', kind: 'badge', icon: icons.heart, note: 'Took part in Valentine on Campus' },
  { id: 'badge-graduation', name: 'Graduation Fest', kind: 'badge', icon: icons.grad, note: 'Took part in Graduation Fest' },
  { id: 'badge-freshers', name: 'Freshers Week', kind: 'badge', icon: icons.grad, note: 'Took part in Freshers Week' },
  { id: 'badge-games-night', name: 'Quiz Whizz', kind: 'badge', icon: icons.help, note: 'Full marks in a Campus Quiz' },
  { id: 'ev-decal-ghana', name: 'Black Star decal', kind: 'cosmetic', icon: icons.flagGh, note: 'Bike decal from the Independence Ride' },
  { id: 'ev-bell-jingle', name: 'Jingle bell', kind: 'cosmetic', icon: icons.bell, note: 'Bell from Christmas on Campus' },
  { id: 'ev-jersey-freshers', name: 'Freshers jersey', kind: 'cosmetic', icon: icons.grad, note: 'Jersey from Freshers Week' },
  { id: 'ev-sash-graduation', name: 'Graduation sash', kind: 'cosmetic', icon: icons.grad, note: 'From Graduation Fest' },
];
export const eventItem = (id: string) => EVENT_ITEMS.find((i) => i.id === id);

/** the reward menu creators pick from (community events pay these from the entry pool, admins from nothing) */
export const REWARD_MENU = {
  xp: [0, 50, 100, 250, 500],
  coins: [0, 200, 500, 1000, 2000, 5000],
  diamonds: [0, 1, 2, 5],
};
