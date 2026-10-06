// Small building blocks shared by the Community screens: line icons, avatars, person rows,
// bottom sheets, empty states and friendly words.
import { hallById } from '../../data/campus';
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { esc, H } from '../host';
import * as api from './api';
import type { Card, SocialStatus, Reaction } from './model';

const svg = (d: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** Community's extra line icons (same style as ui/icons.ts) */
export const ci = {
  search: fx.search,
  users: fx.friends,
  userPlus: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6"/>'),
  userCheck: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 11l2 2 4-4"/>'),
  userClock: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.5 0 2.9.5 4 1.3"/><circle cx="18" cy="16" r="4"/><path d="M18 14.5V16l1 1"/>'),
  chat: icons.chat,
  heart: icons.heart,
  bike: icons.bike,
  party: svg('<path d="M4 20l5-14 9 9z"/><path d="M14 4v2M19 9h2M17 5l1.5-1.5M9 6l9 9"/>'),
  trophy: icons.trophy,
  moon: icons.moon,
  bell: icons.bell,
  shield: fx.shield,
  flag: svg('<path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  mute: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  block: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
  leave: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  lock: icons.lock,
  crown: icons.crown,
  hall: icons.pillars,
  grad: icons.grad,
  book: icons.book,
  pin: icons.pin,
  gear: icons.gear,
  send: icons.send,
  check: icons.check,
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  star: icons.star,
  flame: icons.flame,
  smile: icons.smile,
  thumb: svg('<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/>'),
  clap: svg('<path d="M8.5 13.5l-2.7-4.7a1.4 1.4 0 0 1 2.4-1.4l3.3 5.6M9.5 9.5L7.6 6.2a1.4 1.4 0 0 1 2.4-1.4l3.6 6.2M13 9.8l-1.6-2.7a1.4 1.4 0 0 1 2.4-1.4l3 5.2c1.9 3.3.8 7.5-2.5 9.4s-7.5.8-9.4-2.5l-1.9-3.3a1.4 1.4 0 0 1 2.4-1.4l1.5 2.6"/><path d="M17 3l.5 1.6M20.5 5l-1.4.9M14.5 2.5l.1 1.5"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  map: icons.map,
  calendar: fx.calendar,
  medal: fx.medal,
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
};

/** crew logos riders can pick: an icon on a colour */
export const CREW_LOGOS: Record<string, string> = {
  bike: icons.bike, moon: icons.moon, flame: icons.flame, bolt: icons.bolt, star: icons.star, crown: icons.crown,
  shield: fx.shield, target: icons.target, compass: icons.compass, sun: icons.sun, music: icons.music, trophy: icons.trophy,
};
export const CREW_COLORS = ['#ffd21f', '#1b2a57', '#c8102e', '#1f8a3b', '#e08a1e', '#6d28d9', '#0e7490', '#db2777', '#111827'];

export const STATUSES: [SocialStatus, string, string, string][] = [
  ['friends', ci.users, 'Friends', 'Looking to make friends'],
  ['buddies', ci.bike, 'Riding buddies', 'Looking for people to ride with'],
  ['social', ci.party, 'Socializing', 'Meeting people and joining in'],
  ['compete', ci.trophy, 'Competition', 'Looking for people to race'],
  ['dating', ci.heart, 'Dating', 'Open to meeting someone (18+)'],
  ['none', ci.moon, 'Not looking', 'Not looking for new connections'],
];
export const statusInfo = (s: SocialStatus) => STATUSES.find((x) => x[0] === s)!;

export const REACTIONS: [Reaction, string, string][] = [
  ['like', ci.thumb, 'Like'], ['fire', ci.flame, 'Fire'], ['laugh', ci.smile, 'Laugh'], ['clap', ci.clap, 'Clap'], ['ride', ci.bike, 'Ride'],
];

export const hallName = (id?: string | null) => (id && id !== 'none' ? hallById(id).name : '');
export const hallColor = (id?: string | null) => (id && id !== 'none' ? hallById(id).color : '#c3cad8');
export const handle = (c: { name: string; username?: string | null }) => (c.username ? `@${c.username}` : c.name);

/** a round avatar: the first letter on the rider's hall colour (or grey when their hall is hidden) */
export function avatar(c: { name: string; hall?: string | null }, size: 'xs' | 'sm' | 'md' | 'lg' = 'sm', dot = false) {
  return `<span class="cm-av ${size}" style="--c:${hallColor(c.hall)}">${esc((c.name || '?').slice(0, 1).toUpperCase())}${dot ? '<i class="cm-dot"></i>' : ''}</span>`;
}

/** "Level 12 · Commonwealth Hall · Computer Science" (only what they show) */
export function cardLine(c: Card, withCourse = true) {
  return [c.level ? `Level ${c.level}` : '', hallName(c.hall), withCourse ? c.course ?? '' : '', c.year ? `Level ${c.year}` : ''].filter(Boolean).map(esc).join(' · ');
}

export function statusChips(list: SocialStatus[] | undefined, max = 3) {
  const s = (list ?? []).filter((x) => x !== 'none').slice(0, max);
  return s.length ? `<span class="cm-tags">${s.map((x) => { const [, ico, label] = statusInfo(x); return `<span class="cm-tag ${x}">${ico}${label}</span>`; }).join('')}</span>` : '';
}

/** one person in a list; tap opens them (data-person) */
export function personRow(c: Card, extra = '', sub?: string) {
  return `<div class="cm-person" data-person="${esc(c.id)}">
    ${avatar(c, 'sm', !!extra && extra.includes('cm-online'))}
    <span class="cm-p-main"><b>${esc(handle(c))}</b><small>${sub ?? cardLine(c)}</small>${c.reason ? `<small class="cm-reason">${ci.sparkle}${esc(c.reason)}</small>` : ''}${statusChips(c.statuses, 2)}</span>
    ${extra}
  </div>`;
}

export function empty(icon: string, title: string, text: string, action = '') {
  return `<div class="cm-empty"><span class="cm-empty-ico">${icon}</span><b>${title}</b><p>${text}</p>${action}</div>`;
}

/** the right empty state for a failed call: sign in, offline, being set up */
export function problemBox(e: unknown, retryId = '') {
  const p = api.problemOf(e);
  if (p === 'signin') return empty(ci.users, 'Sign in to connect', 'Make friends, join crews and message riders with a free account. Your progress comes with you.', '<button class="btn btn-primary btn-sm" data-cm-signin>Sign in or create an account</button>');
  if (p === 'offline') return empty(icons.wifiOff, "You're offline", 'Community needs a connection. Solo rides still work.', retryId ? `<button class="btn btn-ghost btn-sm" id="${retryId}">Try again</button>` : '');
  if (p === 'setup') return empty(icons.gear, 'Community is being set up', 'Friends, crews and messages switch on as soon as the campus server is ready. Riders Online already works.');
  return empty(fx.info, "Couldn't load this", api.problemText(e), retryId ? `<button class="btn btn-ghost btn-sm" id="${retryId}">Try again</button>` : '');
}

export function loading(rows = 3) {
  return `<div class="cm-skel">${'<div class="cm-skel-row"><i></i><span><b></b><small></small></span></div>'.repeat(rows)}</div>`;
}

export function timeAgo(iso: string | number) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** a bottom sheet (a centred card on computers); returns its element and close() */
export function sheet(html: string, cls = '') {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in cm-overlay';
  ov.innerHTML = `<div class="sheet light-ui cm-sheet ${cls}" role="dialog">${html}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov || (e.target as HTMLElement).closest('[data-close]')) close(); });
  return { el: ov.querySelector<HTMLElement>('.sheet')!, close };
}

export const sheetHead = (title: string) => `<div class="cm-sheet-head"><h2>${title}</h2><button class="icon-btn cm-x" data-close aria-label="Close">${ci.x}</button></div>`;

export function toast(html: string, actions: [string, () => void, boolean?][] = [], ms?: number) {
  try { H().toast(html, actions, ms); } catch { /* host not ready */ }
}

/** wires [data-cm-signin] buttons */
export function bindSignIn(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-cm-signin]').forEach((b) => b.addEventListener('click', () => H().signIn()));
}

/** runs an action from a button: disables it while waiting, and says what went wrong */
export async function act<T>(btn: HTMLElement | null, fn: () => Promise<T>): Promise<T | undefined> {
  if (btn) (btn as HTMLButtonElement).disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(`${fx.info} ${esc(api.problemText(e))}`);
    return undefined;
  } finally {
    if (btn) (btn as HTMLButtonElement).disabled = false;
  }
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
