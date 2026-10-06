// Community on this phone: the rider's choices (kept in the profile so they follow the account),
// a small cache of who their friends and matches are (so live features can check privacy
// instantly), and sending the choices to the server.
import { saveProfile, type Profile } from '../../state';
import * as vb from '../vibe';
import { H } from '../host';
import * as api from './api';
import { normalizeSocial, type SocialSettings } from './model';

export const social = (p: Profile): SocialSettings => (p.social = normalizeSocial(p.social));

// ---------- the server copy ----------

/** what the server stores (supabase/sql/30-community.sql, community_save_settings) */
export function payload(p: Profile) {
  const s = social(p);
  const pr = s.privacy;
  return {
    campus: H().settings.campus || 'ug', hall: p.hall || 'none', course: p.department || '', level: s.level || '', dob: p.about.dob || '', gender: p.gender,
    statuses: s.statuses, show_status: s.showStatus, find_me: pr.findMe, message_me: pr.messageMe, requests_from: pr.requests, vibe_from: pr.vibeInvites,
    show_online: pr.showOnline, show_hall: pr.showHall, show_course: pr.showCourse, show_level: pr.showLevel, show_map: pr.showMap, activity: pr.activity,
    dating_on: s.dating.on, dating_min: s.dating.ageMin, dating_max: s.dating.ageMax, dating_genders: s.dating.genders, interests: s.dating.interests, notify: s.notify,
  };
}

let syncTimer = 0;
let syncedKey = '';
/** saves a change on the phone now and on the server a moment later */
export function changed(p: Profile) {
  social(p).updatedAt = Date.now();
  saveProfile(p);
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncNow(p), 600);
}

/** sends the choices if the server's copy may be older (first open per session, or after a change) */
export async function syncNow(p: Profile) {
  if (!api.signedIn()) return;
  const body = payload(p);
  const key = JSON.stringify(body);
  if (key === syncedKey) return;
  try {
    const res = await api.saveSettings(body);
    syncedKey = key;
    // the server may have refused something (Dating without a birthday that says 18+)
    const s = social(p);
    if (res && res.dating_on === false && s.dating.on) { s.dating.on = false; s.statuses = s.statuses.filter((x) => x !== 'dating'); saveProfile(p); }
  } catch {
    /* offline or not set up yet: sent next time */
  }
}

// ---------- who is who (cached) ----------

interface Cache { friends: string[]; matches: string[]; requests: number; crew: number | null; at: number }
const CACHE_KEY = 'legonrush.community.v1';
let cache: Cache = (() => {
  try { return { friends: [], matches: [], requests: 0, crew: null, at: 0, ...JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') }; } catch { return { friends: [], matches: [], requests: 0, crew: null, at: 0 }; }
})();
export const known = () => cache;
export function remember(patch: Partial<Cache>) {
  cache = { ...cache, ...patch, at: Date.now() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}
export const isFriend = (id: string) => cache.friends.includes(id);

/** a block also keeps them out of Vibe Ride matching on this phone */
export function blockLocal(id: string, name: string) {
  vb.block(id, name);
  remember({ friends: cache.friends.filter((x) => x !== id), matches: cache.matches.filter((x) => x !== id) });
}
export function unblockLocal(id: string) {
  try {
    const list = vb.blockedList().filter((b) => b.id !== id);
    localStorage.setItem('legonrush.blocked.v1', JSON.stringify(list));
  } catch { /* private mode */ }
}

// ---------- counting for the social badges ----------
export function count(p: Profile, k: 'posts' | 'reactions' | 'messages' | 'events', n = 1) {
  social(p).counts[k] += n;
  saveProfile(p);
}
export function met(p: Profile, id: string) {
  const c = social(p).counts;
  if (id && !c.met.includes(id)) { c.met = [...c.met, id].slice(-200); saveProfile(p); }
}
export function rodeWith(p: Profile, id: string) {
  const c = social(p).counts;
  if (id && !c.rodeWith.includes(id)) { c.rodeWith = [...c.rodeWith, id].slice(-200); saveProfile(p); }
  met(p, id);
}
