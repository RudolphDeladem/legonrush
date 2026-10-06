// What the feature screens need from the app shell (main.ts). main.ts calls initFeatures() once.
import type { Profile, Settings } from '../state';
import type { Route } from '../game/routes';
import type { MissionRun } from './missions';
import './features.css';

export interface RideExtras {
  mission?: MissionRun;
  treasure?: { count: number; seed: number };
}

export interface FeatureHost {
  app: HTMLElement;
  profile: () => Profile;
  settings: Settings;
  /** history back button: what the phone's back button does on this screen */
  onBack: (fn: (() => void) | null) => void;
  /** show the 3D campus behind menus */
  showcase: () => void;
  play: (route: Route, extras: RideExtras) => void;
  home: (tab?: 'home' | 'ride' | 'race' | 'events' | 'social' | 'you') => void;
  explore: (from?: string, to?: string) => void;
  garage: () => void;
  share: (text: string, url: string, note: HTMLElement) => void;
  // ---- COMMUNITY hooks (src/features/community) ----
  /** riders in this campus's lobby right now (live presence), and whether the lobby is connected */
  online: () => OnlinePeer[];
  onlineState: () => 'connecting' | 'on' | 'off';
  /** runs fn whenever who is online changes; returns a stop function */
  watchOnline: (fn: () => void) => () => void;
  /** Vibe Ride, opened from Community */
  vibe: {
    /** the Vibe Ride preferences screen (find a rider / private ride) */
    setup: () => void;
    /** open a ride room by code, as its host or a guest */
    room: (code: string, host: boolean) => void;
    /** invite someone in the lobby (they must accept) */
    inviteOnline: (key: string) => void;
    /** show an invite that arrived through Community (Accept / Not now) */
    notice: (code: string, from: { id: string; name: string; hall: string }) => void;
  };
  /** the sign-in screen, returning to where the rider was */
  signIn: () => void;
  /** a message at the top of the screen with up to two buttons */
  toast: (html: string, actions?: [string, () => void, boolean?][], ms?: number) => void;
}

/** someone in the campus lobby, as main.ts tracks them */
export interface OnlinePeer {
  key: string;
  state: { id: string; name: string; hall: string; department: string; level: number; status: string; place?: string; map?: boolean; event?: string; at: number };
}

let host: FeatureHost | null = null;
export function initFeatures(h: FeatureHost) {
  host = h;
}
export const H = () => {
  if (!host) throw new Error('initFeatures() was not called');
  return host;
};

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
export const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function on(sel: string, ev: string, fn: (e: Event, el: HTMLElement) => void) {
  H().app.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
}

/** a full-page feature screen with a back link */
export function screen(body: string, back: () => void, cls = '') {
  const h = H();
  h.showcase();
  h.app.innerHTML = `
    <div class="screen solid fade-in fx-screen ${cls}">
      <div class="wrap stack">
        <button class="btn btn-link back" id="fxBack">← Back</button>
        ${body}
      </div>
    </div>`;
  on('#fxBack', 'click', back);
  h.onBack(back);
}

export function bar(got: number, goal: number) {
  return `<div class="xpbar"><div style="width:${Math.min(100, (got / goal) * 100)}%"></div></div>`;
}
