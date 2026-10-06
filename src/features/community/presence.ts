// Who is online, from the campus lobby's live presence (main.ts runs the lobby), and what this
// rider shows there. Presence is broadcast to everyone in the lobby, so privacy is applied before
// sending: hidden hall/programme are blanked, "show online" off keeps you out of the lists while
// you're just browsing or riding solo, and your ride's place is only shared with "show me on map".
import type { Profile } from '../../state';
import * as vb from '../vibe';
import { H, type OnlinePeer } from '../host';
import { social } from './local';

interface Presence { status: string; name: string; hall: string; department: string; place?: string; map?: boolean; hidden?: boolean }

export function maskPresence<S extends Presence>(s: S, p: Profile | null): S {
  if (!p) return s;
  const pr = social(p).privacy;
  const out: S = { ...s };
  if (!pr.showHall) out.hall = 'none';
  if (!pr.showCourse) out.department = '';
  if (pr.showMap && s.place && s.status === 'riding') out.map = true;
  else { delete out.place; delete out.map; }
  // matching (Vibe Ride, Quick Match) needs a name; otherwise "show online" off means not listed
  if (!pr.showOnline && (s.status === 'menu' || s.status === 'riding')) return { ...out, name: '', hidden: true };
  return out;
}

/** riders online now (not you, not anyone you blocked) */
export function onlineNow(): OnlinePeer[] {
  try {
    return H().online().filter((o) => o.state?.name && !vb.isBlocked(o.key));
  } catch {
    return [];
  }
}
export const lobbyState = () => { try { return H().onlineState(); } catch { return 'off' as const; } };
/** signed-in riders' keys are their account ids; guests are "d-…" device ids */
export const isAccount = (key: string) => /^[0-9a-f-]{36}$/.test(key);
export const onlineById = (id: string) => onlineNow().find((o) => o.key === id);

export type Doing = 'online' | 'riding' | 'racing' | 'event';
/** what a rider in the lobby is doing now */
export function doing(o: OnlinePeer | undefined): Doing | null {
  if (!o) return null;
  const s = o.state.status;
  if (o.state.event) return 'event';
  if (s === 'riding' || s === 'room' || s === 'vibe') return 'riding';
  if (s === 'match') return 'racing';
  return 'online';
}
export const DOING_TEXT: Record<Doing, string> = { online: 'Online', riding: 'Riding', racing: 'Racing', event: 'At an event' };
