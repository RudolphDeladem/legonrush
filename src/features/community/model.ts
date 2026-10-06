// Community: the shapes shared by the screens, the server calls and the saved profile.
// Kept free of runtime imports so state.ts can use newSocial() without a cycle.
import type { Gender } from '../../state';

export type SocialStatus = 'friends' | 'dating' | 'buddies' | 'social' | 'compete' | 'none';
export type FindMe = 'everyone' | 'fof' | 'hall' | 'course' | 'nobody';
export type MessageMe = 'everyone' | 'friends' | 'connections' | 'nobody';
export type RequestsFrom = 'everyone' | 'shared' | 'nobody';
export type VibeFrom = 'everyone' | 'friends' | 'dating' | 'nobody';
export type ActivityShare = 'everyone' | 'friends' | 'off';
export type NotifyGroup = 'friends' | 'messages' | 'crews' | 'vibe' | 'dating' | 'feed';

export interface Privacy {
  findMe: FindMe;
  messageMe: MessageMe;
  requests: RequestsFrom;
  vibeInvites: VibeFrom;
  showOnline: boolean;
  showHall: boolean;
  showCourse: boolean;
  /** academic level: optional, hidden unless the rider adds it and turns this on */
  showLevel: boolean;
  showMap: boolean;
  activity: ActivityShare;
}

export interface DatingPrefs {
  on: boolean;
  ageMin: number;
  ageMax: number;
  /** who they'd like to meet; empty = anyone */
  genders: Gender[];
  interests: string[];
}

/** what the rider chose in Community; the server keeps the copy other riders' views follow */
export interface SocialSettings {
  statuses: SocialStatus[];
  showStatus: boolean;
  privacy: Privacy;
  dating: DatingPrefs;
  /** optional academic level ('100'...'800'), never asked at sign-up */
  level: string;
  notify: Record<NotifyGroup, boolean>;
  /** social badge counters (this phone and the account) */
  counts: { posts: number; reactions: number; messages: number; events: number; rodeWith: string[]; met: string[] };
  /** when the choices last changed (ms): the newer copy wins between devices */
  updatedAt: number;
}

/** conservative defaults: findable by your hall, messages and Vibe Ride invites from friends only */
export const newSocial = (): SocialSettings => ({
  statuses: [],
  showStatus: true,
  privacy: {
    findMe: 'hall', messageMe: 'friends', requests: 'shared', vibeInvites: 'friends',
    showOnline: true, showHall: true, showCourse: false, showLevel: false, showMap: false, activity: 'friends',
  },
  dating: { on: false, ageMin: 18, ageMax: 30, genders: [], interests: [] },
  level: '',
  notify: { friends: true, messages: true, crews: true, vibe: true, dating: true, feed: true },
  counts: { posts: 0, reactions: 0, messages: 0, events: 0, rodeWith: [], met: [] },
  updatedAt: 0,
});

export function normalizeSocial(s?: Partial<SocialSettings>): SocialSettings {
  const d = newSocial();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d, ...s,
    statuses: Array.isArray(s.statuses) ? s.statuses : [],
    privacy: { ...d.privacy, ...s.privacy },
    dating: { ...d.dating, ...s.dating },
    notify: { ...d.notify, ...s.notify },
    counts: { ...d.counts, ...s.counts },
  };
}

// ---------- what the server sends ----------

/** another rider, with only what their privacy lets you see */
export interface Card {
  id: string;
  name: string;
  username?: string;
  level?: number;
  km?: number;
  gender?: Gender;
  look?: { skin?: string; jersey?: string };
  hall?: string;
  course?: string;
  year?: string;
  statuses?: SocialStatus[];
  rel?: 'self' | 'friend' | 'sent' | 'received';
  following?: boolean;
  followers?: number;
  /** they allow "show me on map" / "show online status" */
  map?: boolean;
  online?: boolean;
  /** why they're suggested */
  reason?: string;
  // from community_card (a full profile)
  can_message?: boolean;
  can_request?: boolean;
  can_vibe?: boolean;
  muted?: boolean;
  match?: boolean;
  mutual?: number;
  friends?: number;
  crew?: { id: number; name: string; logo: string; color: string } | null;
}

export type Reaction = 'like' | 'fire' | 'laugh' | 'clap' | 'ride';
export interface Post {
  id: number;
  kind: 'text' | 'activity' | 'ride' | 'event' | 'challenge' | 'achievement';
  akind?: string;
  text: string;
  ref?: string;
  audience: 'public' | 'friends' | 'hall' | 'crew';
  at: string;
  author: { id: string; name: string; username?: string; hall?: string };
  reactions: Partial<Record<Reaction, number>>;
  mine?: Reaction | null;
}

export interface Crew {
  id: number;
  name: string;
  logo: string;
  color: string;
  description: string;
  public: boolean;
  min_level: number;
  members: number;
  km?: number;
  leader?: { id: string; name: string };
  my?: { role: 'leader' | 'member'; status: 'member' | 'pending' } | null;
  conversation?: number;
  pending?: Card[];
}

export interface Chat {
  id: number;
  kind: 'dm' | 'crew';
  last_at: string;
  muted?: boolean;
  other?: Card;
  crew?: { id: number; name: string; logo: string; color: string; members: number };
  last?: { text: string; mine: boolean; name: string; at: string };
  unread: number;
}

export interface Msg {
  id: number;
  from: string;
  name: string;
  text: string;
  at: string;
  mine: boolean;
  reactions: Record<string, number>;
  my_reaction?: string | null;
  /** still sending */
  pending?: boolean;
}

export interface DatingCard {
  id: string;
  name: string;
  age?: number;
  gender?: Gender;
  level?: number;
  hall?: string;
  interests?: string[];
  shared?: string[];
  match?: boolean;
}

export interface Notification {
  id: number;
  kind: string;
  actor?: string;
  ref?: string;
  text: string;
  read: boolean;
  at: string;
}

export interface BoardRow { id: string | number; name: string; username?: string; hall?: string; value: number; me?: boolean; mine?: boolean; logo?: string; color?: string; members?: number }

export interface Home {
  settings: Record<string, unknown> & { adult?: boolean };
  friends: number;
  friend_ids?: string[];
  match_ids?: string[];
  followers: number;
  following: number;
  requests: number;
  buddies: number;
  hall: { id: string; members: number };
  course?: { name: string; members: number } | null;
  level?: { name: string; members: number } | null;
  crew?: Crew | null;
  crews: Crew[];
  suggest: Card[];
  feed: Post[];
  chats: Chat[];
  unread: number;
  notifications: number;
  matches: number;
}
