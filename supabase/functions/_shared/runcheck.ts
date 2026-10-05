// Anti-cheat for prize races: is this recorded ride something a real rider could have done in the game?
// The game records the rider's road distance (d, metres) and sideways offset (x, metres) every 0.1 s
// of ride time (Game.lastRun). Pure code with no Deno APIs, so it can be tested anywhere.

/** race lengths in metres as the game builds them (src/game/routes.ts); prize_events.route_length wins */
export const ROUTE_LENGTHS: Record<string, number> = {
  'limann-great-hall': 2576,
  'engineering-run': 2422,
  'sunset-route': 2643,
  'night-circuit': 2945,
};

/**
 * Prize rides use the City bike (speed 3) with no upgrades (src/features/money-ui.ts levelField), so the
 * fastest the game allows, in m/s, is: base 15 + 3 x 1.1 = 18.3, +6 late in a race = 24.3, x1.45 boost,
 * x1.06 pedal rhythm, x1.07 drafting = 40.0. A little headroom on top.
 * IF THE GAME'S SPEEDS CHANGE (src/game/Game.ts baseSpeed / frame), UPDATE THESE OR HONEST RIDES GET REFUSED.
 */
export const MAX_SPEED = 43;
/** fastest without boost: 24.3 x 1.06 x 1.07 = 27.6, plus headroom */
export const MAX_CRUISE = 29;
/** a boost lasts at most ~7 s and needs a full meter; over a race, boosting can't be most of the time */
export const MAX_BOOST_SHARE = 0.5;
/** the whole race can't average more than this, m/s */
export const MAX_AVERAGE = 40;
const STEP = 0.1;
const ROAD_HALF = 3.8;

export interface RunClaim {
  route: string;
  /** finish time in seconds, as the game showed it */
  time: number;
  finished: boolean;
  /** route length the game used, metres */
  length: number;
  trace: { step: number; d: number[]; x: number[] };
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Checks a claimed prize-race result against its recording. `expectedLength` comes from the server. */
export function checkRun(c: RunClaim, expectedLength: number): Verdict {
  const no = (reason: string): Verdict => ({ ok: false, reason });
  const t = c.trace;
  if (!c.finished) return no('not_finished');
  if (typeof c.time !== 'number' || !Number.isFinite(c.time) || c.time < 20 || c.time > 3600) return no('bad_time');
  if (!t || t.step !== STEP || !Array.isArray(t.d) || !Array.isArray(t.x) || t.d.length !== t.x.length) return no('bad_trace');
  if (!t.d.every((v) => typeof v === 'number' && Number.isFinite(v)) || !t.x.every((v) => typeof v === 'number' && Number.isFinite(v))) return no('bad_trace');
  // route length: the game and the server must agree on the race
  if (Math.abs(c.length - expectedLength) > Math.max(15, expectedLength * 0.01)) return no('route_length');
  // one sample per 0.1 s of ride time, starting at time 0
  const n = t.d.length;
  if (Math.abs((n - 1) * STEP - c.time) > 0.35) return no('sample_count');
  // starts on the start line and reaches the finish (the last sample can be up to one step short of it:
  // the clock stops on the frame that crosses the line)
  if (t.d[0] > 5) return no('bad_start');
  const last = t.d[n - 1];
  if (last < expectedLength - 10 || last > expectedLength + 31) return no('not_at_finish');
  let boosted = 0;
  for (let i = 1; i < n; i++) {
    const step = t.d[i] - t.d[i - 1];
    // never rides backwards (values are rounded to 1 cm)
    if (step < -0.02) return no('backwards');
    // frames are at most 0.05 s, so samples are 0.05..0.15 s apart in practice
    if (step > MAX_SPEED * 0.16) return no('too_fast');
    if (Math.abs(t.x[i]) > ROAD_HALF + 0.2) return no('off_road');
  }
  // every 1-second window: under the top speed, and count the time above cruising speed
  for (let i = 10; i < n; i++) {
    const v = (t.d[i] - t.d[i - 10]) / (10 * STEP);
    if (v > MAX_SPEED * 1.08) return no('too_fast');
    if (v > MAX_CRUISE) boosted++;
  }
  if (n > 20 && boosted / (n - 10) > MAX_BOOST_SHARE) return no('too_much_boost');
  if (expectedLength / c.time > MAX_AVERAGE) return no('too_fast');
  // a real rider steers: a perfectly straight line the whole way is a script
  const xs = new Set(t.x.map((v) => Math.round(v * 10)));
  if (n > 200 && xs.size < 3) return no('no_steering');
  return { ok: true };
}

/** plain words for each reason, shown to the rider */
export const REASONS: Record<string, string> = {
  not_finished: 'Only finished races count.',
  bad_time: 'That time is outside what the race allows.',
  bad_trace: 'The ride recording was missing or damaged.',
  route_length: 'Your game has a different version of this route. Update the game and ride again.',
  sample_count: 'The ride recording does not match your time.',
  bad_start: 'The ride did not start on the start line.',
  not_at_finish: 'The ride recording does not reach the finish.',
  backwards: 'The ride recording goes backwards.',
  too_fast: 'Faster than the game allows.',
  off_road: 'The ride recording leaves the road.',
  too_much_boost: 'More boost than the game gives.',
  no_steering: 'The ride recording looks automated.',
  ticket: 'Start the race from the Weekly prize race screen while signed in.',
  too_quick: 'The result arrived sooner than the race could have been ridden.',
  closed: 'This week\'s prize race has ended.',
  rate: 'Too many results in a short time. Try again later.',
};
