// Riding a challenge: the attempt ticket, the small HUD panel (time, checkpoints, attempt), and
// what happens at the finish (personal best, bonus, posting the time, the next button).
import type { HudState } from '../../game/Game';
import type { RideExtras, ChallengeRide } from '../host';
import { H, esc, fmt } from '../host';
import { icons } from '../../ui/icons';
import { grant } from '../inventory';
import { postActivity } from '../activity';
import * as api from './api';
import { chRoute, paceRun, phaseOf, raceTime, formatOf, type Challenge } from './model';
import { boardScreen, detailScreen } from './screens';

const CHECKPOINTS = 5;

/** attempts used and allowed, e.g. "Attempt 2 of 3"; '' when unlimited */
export function attemptText(c: Challenge, used: number) {
  return c.attempts > 1 ? `Attempt ${Math.min(c.attempts, used + 1)} of ${c.attempts}` : '';
}
export const attemptsLeft = (c: Challenge) => (c.attempts > 0 ? Math.max(0, c.attempts - (api.mine(c.id)?.attempts ?? 0)) : Infinity);

/** Starts a ride for a challenge. Live races pass their channel from the lobby. */
export async function rideChallenge(c: Challenge, live?: RideExtras['live']) {
  const def = chRoute(c.route);
  if (!def) return H().toast('This route is not in your version of the game. Update LEGONRUSH.');
  if (attemptsLeft(c) <= 0) return H().toast('You have used all your attempts for this challenge.');
  let ticket: string | null = null;
  if (api.online()) {
    if (c.official) await api.ensureOfficial(c);
    const t = await api.startAttempt(c.id);
    if (t.ok) ticket = t.data;
    // paid challenges only count with a ticket; free ones can be ridden offline and kept on the phone
    else if (c.entryFee > 0 || ['attempts', 'closed', 'join', 'banned'].includes(t.code)) return H().toast(esc(t.message));
  }
  const ghost = c.format === 'ghost' ? (c.ghost ?? paceRun(c.route)) : null;
  const route = def.build();
  H().play(route, {
    challenge: ghost ? { routeId: route.id, name: ghost.name, time: ghost.time, run: ghost.run } : undefined,
    live,
    challengeRide: hooks(c, ticket),
  });
}

function hooks(c: Challenge, ticket: string | null): ChallengeRide {
  const used = api.mine(c.id)?.attempts ?? 0;
  return {
    levelField: c.entryFee > 0,
    hud: (hud) => hudPanel(hud, c, used),
    after: (r, run, rivals) => finish(c, ticket, r, run, rivals),
    get next() {
      // decided after the ride, when attempts and the clock have moved on
      if (c.format === 'live_race') return { label: 'Back to the challenge', run: () => detailScreen(c) };
      if (phaseOf(c) === 'live' && attemptsLeft(c) > 0) {
        const n = (api.mine(c.id)?.attempts ?? 0) + 1;
        return { label: c.attempts > 1 ? `Attempt ${n} of ${c.attempts}` : 'Ride again', run: () => void rideChallenge(c) };
      }
      return { label: 'Challenge leaderboard', run: () => boardScreen(c) };
    },
    leave: () => detailScreen(c),
  };
}

function hudPanel(hud: HTMLElement, c: Challenge, used: number) {
  const el = document.createElement('div');
  el.className = 'chx-hud';
  const at = attemptText(c, used);
  el.innerHTML = `<span class="chx-hud-ico">${icons.flag}</span><span class="grow"><small>${esc(c.name.toUpperCase())}${at ? ` · ${at.toUpperCase()}` : ''}</small><b id="chxClock">0:00.0</b></span><span class="chx-cp"><small>CHECKPOINT</small><b id="chxCp">0/${CHECKPOINTS}</b></span>`;
  hud.appendChild(el);
  const clockEl = el.querySelector<HTMLElement>('#chxClock')!;
  const cpEl = el.querySelector<HTMLElement>('#chxCp')!;
  let t = 0, last = 0, cp = 0;
  return (h: HudState) => {
    const now = performance.now();
    // ride time the way the game counts it: frames are capped at 1/20 s
    if (!h.countdown && last && h.distance < h.routeLength) t += Math.min(0.05, (now - last) / 1000);
    last = now;
    clockEl.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    const got = Math.min(CHECKPOINTS, Math.floor((h.distance / Math.max(1, h.routeLength)) * CHECKPOINTS + 1e-6));
    if (got !== cp) {
      cp = got;
      cpEl.textContent = `${cp}/${CHECKPOINTS}`;
      el.classList.remove('cp-hit');
      void el.offsetWidth;
      el.classList.add('cp-hit');
    }
  };
}

/** after the ride is scored: remember it, pay the official bonus, post the time; HTML for the results screen */
function finish(c: Challenge, ticket: string | null, r: { finished: boolean; time: number }, run: { step: number; d: number[]; x: number[] }, rivals: { name: string; time: number }[]) {
  const p = H().profile();
  const s = api.local();
  const m = (s.mine[c.id] ??= { id: c.id, joinedAt: Date.now(), attempts: 0, paid: 0, snap: c });
  m.snap = { ...c, joined: true };
  m.attempts++;
  const prev = m.best;
  const pb = r.finished && (prev === undefined || r.time < prev);
  if (pb) { m.prev = prev; m.best = r.time; }
  let bonus = 0;
  if (c.official && r.finished && !m.bonus) {
    m.bonus = true;
    bonus = s.config.officialBonus;
    grant(p, { coins: bonus, xp: 100 });
  }
  api.saveLocal();
  if (pb && prev !== undefined) postActivity({ kind: 'pb', text: `${p.name} set a new personal best in ${c.name}: ${raceTime(r.time)}`, ref: c.id });
  // a live race won outright
  const won = c.format === 'live_race' && r.finished && rivals.length > 0 && rivals.every((v) => v.time > r.time);
  if (won) postActivity({ kind: 'challenge_win', text: `${p.name} won ${c.name}`, ref: c.id });

  // the server's answer fills in a moment later
  const status = !r.finished ? 'Only finished rides go on the leaderboard.'
    : ticket ? 'Posting your time…'
    : api.online() ? 'Your time is saved on this phone. It could not be posted (no connection).'
    : 'Your time is saved on this phone. Sign in to put it on the leaderboard.';
  if (ticket) {
    void api.submit(c, ticket, { time: r.time, finished: r.finished, trace: run }).then((res) => {
      const el = document.getElementById('chxStatus');
      let text: string;
      if (!res.ok) text = res.message;
      else if (!res.data.accepted) text = `Not counted: ${res.data.reason ?? 'the ride did not pass the checks.'}`;
      else {
        text = res.data.place ? `On the leaderboard: <b>${ordinal(res.data.place)}</b> of ${res.data.riders}.` : 'Your time is on the leaderboard.';
        m.place = res.data.place;
        api.saveLocal();
      }
      if (el) el.innerHTML = text;
    });
  }
  const at = c.attempts > 1 ? `Attempt ${Math.min(m.attempts, c.attempts)} of ${c.attempts}` : formatOf(c.format).name;
  return `<div class="card chx-result">
    <div class="row"><span class="chx-tile">${icons.flag}</span><span class="grow"><b>${esc(c.name)}</b><small class="muted">${esc(at)}</small></span></div>
    ${pb && prev !== undefined ? `<div class="chx-pb">${icons.flame}<span><b>New personal best!</b><span>Previous ${raceTime(prev)} → New ${raceTime(r.time)}</span></span></div>`
      : r.finished && m.best !== undefined ? `<div class="reward-row"><span>Your best</span><b>${raceTime(m.best)}</b></div>` : ''}
    ${bonus ? `<div class="reward-row"><span>Challenge bonus</span><b>+${fmt(bonus)} ${icons.coin} · +100 XP</b></div>` : ''}
    ${c.entryFee > 0 ? `<div class="reward-row"><span>Prize pool</span><b>Paid when it ends</b></div>` : ''}
    <p class="muted small" id="chxStatus">${status}</p>
    <button class="btn btn-ghost btn-sm" data-chx-board="${esc(c.id)}">${icons.trophy} Challenge leaderboard</button>
  </div>`;
}
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
