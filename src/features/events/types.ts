// The shapes of the Events system. An "event" here is one dated occurrence: the daily Sunset Ride
// on 5 October is one event, the one on 6 October another.
import type { Reward } from '../inventory';

/** what kind of event it is (what the card and filters say) */
export type EventType =
  | 'treasure' | 'coinrush' | 'diamondrush' | 'photohunt' | 'explorer' | 'sunset' | 'night' | 'rain'
  | 'social' | 'party' | 'games' | 'festival' | 'hall' | 'sports' | 'seasonal' | 'gathering' | 'special';

/** what you actually do at it */
export type Activity =
  /** hot/cold treasure hunt while riding where you like */
  | 'hunt'
  /** coins scattered around the event area for a time limit */
  | 'coinrush'
  /** rare diamonds on the road for a limited time */
  | 'diamondrush'
  /** reach a list of places; a photo is taken at each */
  | 'photohunt'
  /** reach a list of places */
  | 'explorer'
  /** ride to a scenic spot at sunset */
  | 'sunset'
  /** the daily timed race events (Sunset Rush, Night Rush): double coins and a bike */
  | 'timed'
  /** ride there, park, enter the event space: people, chat, emotes, mini-games */
  | 'space'
  /** the free weekly prize race (features/money-ui.ts) */
  | 'prize'
  /** Hall Week: kilometres for your hall */
  | 'hallweek';

export type RuleId = 'night' | 'sunset' | 'rain' | 'fog' | 'nominimap' | 'noboost' | 'nohelmet' | 'timelimit' | 'noracing' | 'teams' | 'hidden';

export type Status = 'upcoming' | 'open' | 'soon' | 'live' | 'ending' | 'completed' | 'cancelled';

export interface EventRewards {
  /** for taking part */
  join?: Reward;
  /** for completing the activity (finding the treasure, every stop, arriving for the sunset) */
  done?: Reward;
  /** community and admin events: the winner and the top three (paid by the server) */
  winner?: Reward;
  top3?: Reward;
  /** hall points for the Hall Championship */
  hall?: number;
}

export interface CampusEvent {
  /** unique: 'off:<series>:<date>' for official schedule events, 'db:<id>' for events from the server */
  key: string;
  source: 'official' | 'admin' | 'community';
  type: EventType;
  activity: Activity;
  name: string;
  /** one line for the card */
  blurb: string;
  description: string;
  /** a photo name in public/photos (without .webp) */
  cover: string;
  host: string;
  /** a place name on the campus map */
  place: string;
  start: number;
  end: number;
  /** registration closes; defaults to the end */
  regDeadline?: number;
  /** null: unlimited */
  capacity: number | null;
  /** coins to join; 0 is free */
  fee: number;
  rewards: EventRewards;
  rules: RuleId[];
  /** seconds, with the timelimit rule */
  timeLimit?: number;
  series?: { id: string; name: string; day: number; of: number };
  cancelled?: boolean;
  createdAt?: number;
  /** photo hunt / explorer stops */
  stops?: string[];
  /** treasure hunt: where it is hidden and the clues */
  spot?: string;
  clues?: string[];
  /** activity 'timed': which daily timed event (src/data/events.ts) */
  timed?: string;
  /** people registered, from the server; undefined when unknown (never guessed) */
  joinedCount?: number;
  /** server events: the creator's account id */
  ownerId?: string;
}

export interface SeriesInfo {
  id: string;
  name: string;
  blurb: string;
  cover: string;
  start: number;
  end: number;
  days: CampusEvent[];
}
