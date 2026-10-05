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
