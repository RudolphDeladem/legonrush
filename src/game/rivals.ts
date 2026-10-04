// Rivals that need no server: friends' runs shared as links, and bot riders.
import type { GhostRun, Rival } from './Game';
import type { Route } from './routes';
import { LANES } from './world';

const STEP = 0.5;

export interface Challenge {
  routeId: string;
  name: string;
  time: number;
  run: GhostRun;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Packs a run into a short text for a link: every 0.5 s, the distance gained (0.25 m units) and the lane offset. */
export function encodeChallenge(c: Challenge): string {
  const g = c.run;
  const n = Math.floor(((g.d.length - 1) * g.step) / STEP) + 1;
  const bytes = new Uint8Array(n * 2);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const i = Math.min(g.d.length - 1, Math.round((k * STEP) / g.step));
    const q = Math.min(255, Math.max(0, Math.round((g.d[i] - prev) / 0.25)));
    prev += q * 0.25;
    bytes[2 * k] = q;
    bytes[2 * k + 1] = Math.max(0, Math.min(8, Math.round((g.x[i] + 2.4) / 0.6)));
  }
  return [c.routeId, encodeURIComponent(c.name.slice(0, 18)), Math.round(c.time * 100), b64(bytes)].join('~');
}

export function decodeChallenge(s: string): Challenge | null {
  try {
    const [routeId, name, time, data] = s.split('~');
    const bytes = unb64(data);
    if (!routeId || bytes.length < 4) return null;
    const d: number[] = [], x: number[] = [];
    let acc = 0;
    for (let k = 0; k + 1 < bytes.length; k += 2) {
      acc += bytes[k] * 0.25;
      d.push(acc);
      x.push(bytes[k + 1] * 0.6 - 2.4);
    }
    return { routeId, name: decodeURIComponent(name) || 'A friend', time: Number(time) / 100, run: { step: STEP, d, x } };
  } catch {
    return null;
  }
}

const BOT_NAMES = ['Kojo', 'Ama', 'Yaw', 'Akosua', 'Kwame', 'Esi', 'Kofi', 'Abena', 'Kwesi', 'Adwoa', 'Selorm', 'Elikem', 'Naa', 'Nii'];
const BOT_COLORS = ['#ff7a59', '#7bd88f', '#c792ea', '#ffcb6b'];

/** Bot riders for Quick Match: one a little slower than a typical rider, one about even, one faster. */
export function botRivals(route: Route, count = 3): Rival[] {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const paces = [0.9, 1.0, 1.1].slice(0, count);
  return paces.map((pace, i) => {
    const d: number[] = [], x: number[] = [];
    let dist = 0, v = 0, lane = 1, laneX = 0, nextSwitch = 2 + Math.random() * 3;
    const base = (16.5 + route.difficulty * 0.6) * pace * (0.97 + Math.random() * 0.06);
    for (let t = 0; dist < route.length + 40 && t < 1200; t += 0.1) {
      const progress = dist / route.length;
      const target = base * (1 + 0.28 * Math.min(1, progress * 1.3)) * (1 + 0.05 * Math.sin(t * 0.7 + i));
      v += Math.sign(target - v) * Math.min(Math.abs(target - v), 8 * 0.1);
      dist += v * 0.1;
      if (t > nextSwitch) {
        lane = Math.max(0, Math.min(2, lane + (Math.random() < 0.5 ? -1 : 1)));
        nextSwitch = t + 2 + Math.random() * 4;
      }
      laneX += Math.sign(LANES[lane] - laneX) * Math.min(Math.abs(LANES[lane] - laneX), 1.2);
      d.push(Math.round(dist * 100) / 100);
      x.push(Math.round(laneX * 100) / 100);
    }
    return { run: { step: 0.1, d, x }, name: `${names[i]} (bot)`, color: BOT_COLORS[i % BOT_COLORS.length], ghostly: false };
  });
}
