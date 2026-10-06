// Challenge types. Each type is one entry here: its name, icon, photo, the button on its card and a
// line about how it plays. Every type rides through the same challenge system (routes, formats,
// joining, codes, leaderboards), so a new type is a new entry plus, if it needs one, a new route in
// model.ts CH_ROUTES and a slot in the official schedule. Nothing else has to change.
import type { Challenge } from './model';

export interface ChallengeKind {
  id: string;
  name: string;
  icon: string;
  /** public/photos/<photo>.webp, the picture on the card */
  photo: string;
  /** the yellow button on the card while it can be joined */
  cta: string;
  line: string;
  /** the grey line under the name on cards; the route's line when missing */
  sub?: string;
}

export const CH_KINDS: ChallengeKind[] = [
  { id: 'daily', name: 'Daily race', icon: 'flag', photo: 'race', cta: 'Join Challenge', line: 'Live races every hour. Everyone in the lobby starts together.' },
  { id: 'time', name: 'Time challenge', icon: 'clock', photo: 'sc-day', cta: 'Join Challenge', line: 'Ride the route as often as you like. Fastest time wins.' },
  { id: 'weekly', name: 'Weekly challenge', icon: 'events', photo: 'mode-challenge', cta: 'Join Challenge', line: 'The big ones, once a week.' },
  { id: 'treasure', name: 'Treasure hunt', icon: 'search', photo: 'sc-quiz', cta: 'Start Hunt', sub: "Find today's hidden location", line: "Read the clues and find today's hidden place on campus." },
  { id: 'distance', name: 'Distance challenge', icon: 'bike', photo: 'lm-aerial', cta: 'Join Challenge', line: 'A long ride across campus. Finish it, then finish it faster.' },
  { id: 'location', name: 'Location challenge', icon: 'pin', photo: 'lm-balme', cta: 'Join Challenge', sub: 'Visit 5 locations', line: 'Reach every place on the list in one ride.' },
  { id: 'skill', name: 'Skills challenge', icon: 'bolt', photo: 'ride', cta: 'Join Challenge', sub: 'Obstacles & precision', line: 'Tight corners and heavy traffic. Precision beats speed.' },
  { id: 'hall', name: 'Hall challenge', icon: 'pillars', photo: 'hall-tile', cta: 'View Challenge', line: 'For riders from one hall.' },
  { id: 'interhall', name: 'Inter-hall challenge', icon: 'shield', photo: 'halls', cta: 'View Challenge', sub: 'Represent your hall', line: 'Your time counts for your hall against every other hall.' },
  { id: 'special', name: 'Limited time', icon: 'star', photo: 'sc-sunset', cta: 'Join Challenge', line: 'Only open for a short window.' },
  { id: 'player', name: 'Rider challenge', icon: 'user', photo: 'together', cta: 'Join Challenge', line: 'Made by a rider: their route, their rules.' },
];

/** adds a type (or replaces one with the same id) */
export function registerKind(k: ChallengeKind) {
  const i = CH_KINDS.findIndex((x) => x.id === k.id);
  if (i >= 0) CH_KINDS[i] = k; else CH_KINDS.push(k);
}

/** the type of a challenge: official ones say; rider-made ones are rider or hall challenges */
export function kindOf(c: Challenge): ChallengeKind {
  const id = c.kind ?? (c.official ? 'time' : c.access === 'hall' ? 'hall' : 'player');
  return CH_KINDS.find((k) => k.id === id) ?? CH_KINDS.find((k) => k.id === 'player')!;
}
export const photoUrl = (name: string) => `${import.meta.env.BASE_URL}photos/${name}.webp`;
export const photoOf = (c: Challenge) => photoUrl(c.photo ?? kindOf(c).photo);
