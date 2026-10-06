// What the feature screens need from the app shell (main.ts). main.ts calls initFeatures() once.
import type { Profile, Settings } from '../state';
import type { Route } from '../game/routes';
import type { MissionRun } from './missions';
import type { GhostRun, HudState } from '../game/Game';
import type { Challenge } from '../game/rivals';
import type { Channel } from '../live';
import type { RideResult } from '../state';
import type { TabId } from '../tabs/registry';
import './features.css';

/** Race Challenges (features/challenges): what a challenge ride adds to the normal ride */
export interface ChallengeRide {
  /** paid challenges are a level field, like the prize race: same bike, no upgrades or shop items, clear weather */
  levelField?: boolean;
  /** a small extra HUD panel; returns a function called every HUD frame */
  hud?: (hud: HTMLElement) => (h: HudState) => void;
  /** after the ride is scored: records the result and returns HTML for the results screen */
  after: (r: RideResult, run: GhostRun, rivals: { name: string; time: number }[]) => string;
  /** the main button on the results screen */
  next?: { label: string; run: () => void };
  /** leaving the ride from the pause menu */
  leave: () => void;
}

export interface RideExtras {
  mission?: MissionRun;
  treasure?: { count: number; seed: number };
  /** a recorded run to race (ghost challenges) */
  challenge?: Challenge;
  /** riding with people right now (a live challenge race) */
  live?: { ch: Channel; kind: 'race'; riders: { id: string; name: string; jersey: string }[] };
  challengeRide?: ChallengeRide;
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
  home: (tab?: TabId | 'ride' | 'race' | 'social') => void;
  explore: (from?: string, to?: string) => void;
  garage: () => void;
  share: (text: string, url: string, note: HTMLElement) => void;
  /** Quick Match: instant matchmaking */
  quickMatch: () => void;
  /** this rider's id for live channels (account id, or this device's id) */
  myId: () => string;
  /** the route leaderboards screen */
  board: (routeId: string, back: () => void) => void;
  /** a small message at the top of the screen */
  toast: (html: string) => void;
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
