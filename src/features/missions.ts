// Campus missions: timed errands on real Explore routes. Delivery from the Night Market,
// Lecture rush to your department, a library book back to Balme, and escorting a slow friend.
import { HALL_PLACE, HALLS, bikeById, hallById } from '../data/campus';
import { placeByName, type Place } from '../game/campusmap';
import { routeThrough, type Route } from '../game/routes';
import type { HudState, Rival } from '../game/Game';
import { LANES } from '../game/world';
import { seeded, track, type Difficulty, type Profile, type RideResult } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { H, clock, esc, fmt, on, screen } from './host';

export type MissionId = 'delivery' | 'lecture' | 'library' | 'escort';

export interface CampusMission {
  id: MissionId;
  title: string;
  icon: string;
  blurb: string;
  reward: number;
}

export const CAMPUS_MISSIONS: CampusMission[] = [
  { id: 'delivery', title: 'Food delivery', icon: fx.box, blurb: 'Pick up an order at the Night Market and get it to a hall while it is still hot.', reward: 300 },
  { id: 'lecture', title: 'Lecture rush', icon: icons.grad, blurb: 'You overslept. Reach your department before the 8:00 am lecture starts.', reward: 250 },
  { id: 'library', title: 'Library return', icon: icons.book, blurb: 'Return a library book to the Balme Library before the late fine starts.', reward: 200 },
  { id: 'escort', title: 'Escort a friend', icon: fx.friends, blurb: 'Your friend rides slowly. See them home to their hall: arrive together.', reward: 300 },
];

/** A mission ready to ride: the route, the time limit and what the HUD shows. */
export interface MissionRun {
  id: MissionId;
  title: string;
  brief: string;
  route: Route;
  /** seconds of riding allowed */
  limit: number;
  reward: number;
  /** a clock on the HUD: game time in minutes after midnight at the start and at the deadline */
  clock?: { start: number; end: number };
  /** escort: your friend, and how many seconds ahead of them you may arrive */
  friend?: Rival;
  friendTime?: number;
  slack?: number;
}

/** Department (from sign-up) to its building on the campus map. */
const DEPT_PLACE: [RegExp, string][] = [
  [/^Computer Science$/, 'Computer Science Dept'],
  [/^Mathematics$/, 'Mathematics Dept'],
  [/^Physics$/, 'Physics Department, University of Ghana'],
  [/^Chemistry$/, 'Chemistry Department, University of Ghana'],
  [/^Statistics/, 'Statistics'],
  [/^Earth Science$/, 'Earth Science'],
  [/^Animal Biology/, 'Department of Animal Biology and Conservation Science'],
  [/^Plant and Environmental/, 'Department of Plant and Environmental Biology'],
  [/^Biochemistry/, 'Department of Biochemistry'],
  [/^Marine/, 'Department of Marine and Fisheries Sciences'],
  [/^Nutrition/, 'Department of Nutrition and Food Sciences'],
  [/^Biomedical Engineering$/, 'Biomedical Engineering Department'],
  [/Engineering$/, 'School of Engineering Sciences'],
  [/^Agricultural Economics/, 'Department of Agriculture Economics and Agribusiness'],
  [/^Animal Science$/, 'Department Of Animal Science'],
  [/^Crop Science$/, 'Department Of Crop Science'],
  [/^Soil Science$/, 'Soil Science'],
  [/^Family and Consumer/, 'Department of Family and Consumer Sciences Annex, FCOS'],
  [/^Agricultural Extension$/, 'Faculty of Agriculture'],
  [/^Pharmacy$/, 'School of Pharmacy'],
  [/^(Nursing|Midwifery)$/, 'School Of Nursing and Midwifery'],
  [/^Public Health$/, 'School of Public Health'],
  [/^(Medicine|Dentistry|Medical|Physiotherapy|Radiography|Dietetics|Occupational|Physician)/, 'College of Health Sciences'],
  [/^Modern Languages$/, 'Department of Modern Languages'],
  [/^Philosophy/, 'Department Of Philosophy and Classics'],
  [/^Study of Religions$/, 'Department for the Study of Religions'],
  [/^African Studies$/, 'Institute of Africa Studies'],
  [/^(Theatre Arts|Dance Studies)$/, 'School of Performing Arts'],
  [/^Music$/, 'Department of Music'],
  [/^Economics$/, 'Department of Economics, University of Ghana'],
  [/^Geography/, 'Department of Geography and Resource Development, Legon'],
  [/^History$/, "Dep't of History"],
  [/^Political Science$/, 'Political Science Department'],
  [/^Psychology$/, 'Psychology Department'],
  [/^Sociology$/, "Dep't of Sociology"],
  [/^Social Work$/, 'Social Work Department'],
  [/^Archaeology/, 'Department of Archaeology'],
  [/^Law$/, 'School of Law'],
  [/^(Accounting|Finance|Marketing|Operations|Organisation|Public Administration)/, 'University of Ghana Business School'],
  [/^Communication Studies$/, 'School of Communication Studies'],
  [/^Information Studies$/, 'Information Studies Department'],
  [/^Teacher Education$/, 'Department of Teacher Education'],
  [/^Educational Studies/, 'Department of Educational Studies and Leadership (DESL)'],
  [/^Distance Education$/, 'Distance Education Center'],
];

/** your department's building, or JQB (a lecture block everyone uses) */
export function departmentPlace(dept: string): Place | undefined {
  const name = DEPT_PLACE.find(([re]) => re.test(dept))?.[1];
  return (name && placeByName(name)) || placeByName('Jones Quartey Building, JQB');
}

/** your hall's place, or the Main Gate for non-residents */
export const homePlace = (p: Profile) => placeByName(HALL_PLACE[p.hall] ?? '') ?? placeByName('Legon Main Entrance')!;

const TIME_SCALE: Record<Difficulty, number> = { easy: 1.3, normal: 1, hard: 0.85 };
const FRIENDS = ['Kojo', 'Ama', 'Yaw', 'Akosua', 'Esi', 'Kofi', 'Abena', 'Selorm', 'Naa', 'Elikem'];

/** a slow friend: rides like you would, a little slower */
function friendRun(route: Route, bikeSpeed: number, pace: number) {
  const d: number[] = [], x: number[] = [];
  const base = 15 + bikeSpeed * 1.1;
  let dist = 0, v = 0, t = 0;
  for (; dist < route.length + 40 && t < 1500; t += 0.1) {
    const progress = dist / route.length;
    const target = (base + Math.max(0, Math.min(1, progress * 1.3 - 0.1)) * 6) * pace;
    v += Math.sign(target - v) * Math.min(Math.abs(target - v), 0.6);
    dist += v * 0.1;
    d.push(Math.round(dist * 100) / 100);
    x.push(LANES[0]);
  }
  const finish = d.findIndex((v) => v >= route.length);
  return { run: { step: 0.1, d, x }, time: (finish < 0 ? d.length : finish) * 0.1 };
}

/** minutes after midnight as a 12-hour clock, like 7:50 am */
const mins = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(Math.floor(m % 60)).padStart(2, '0')} ${m >= 720 ? 'pm' : 'am'}`;

/** Builds today's version of a mission for this rider. */
export function buildMission(p: Profile, id: MissionId, difficulty: Difficulty = 'normal', day = new Date().toLocaleDateString('en-CA')): MissionRun | null {
  const def = CAMPUS_MISSIONS.find((m) => m.id === id)!;
  const rnd = seeded(`${id}:${day}:${p.hall}`);
  let start = homePlace(p);
  const otherHall = () => {
    const halls = HALLS.filter((h) => h.id !== 'none' && HALL_PLACE[h.id] !== start.name);
    return halls[Math.floor(rnd() * halls.length)];
  };
  let stops: Place[] = [];
  let brief = '';
  let clockTimes: MissionRun['clock'];
  let friend: Rival | undefined, friendTime: number | undefined;
  if (id === 'delivery') {
    const to = otherHall();
    const market = placeByName('Night Market')!;
    if (start === market) start = placeByName('Legon Main Entrance')!;
    stops = [start, market, placeByName(HALL_PLACE[to.id])!];
    brief = `Pick up the order at the Night Market, then deliver it to ${to.name}.`;
  } else if (id === 'lecture') {
    const dept = departmentPlace(p.department)!;
    if (dept === start) start = placeByName('Legon Main Entrance')!;
    stops = [start, dept];
    clockTimes = { start: 7 * 60 + 50, end: 8 * 60 };
    brief = `Lecture at ${mins(clockTimes.end)} at ${dept.name}. It is ${mins(clockTimes.start)} now.`;
  } else if (id === 'library') {
    const balme = placeByName('The Balme Library')!;
    if (start === balme) start = placeByName('Legon Main Entrance')!;
    stops = [start, balme];
    clockTimes = { start: 16 * 60 + 50, end: 17 * 60 };
    brief = `The book is due at the Balme Library at ${mins(clockTimes.end)}. It is ${mins(clockTimes.start)} now.`;
  } else {
    const to = otherHall();
    const name = FRIENDS[Math.floor(rnd() * FRIENDS.length)];
    stops = [start, placeByName(HALL_PLACE[to.id])!];
    brief = `${name} is new on a bike. Ride with them to ${to.name} and arrive together.`;
    friend = { run: { step: 0.1, d: [], x: [] }, name, color: hallById(to.id).color, ghostly: false };
  }
  if (stops.some((s) => !s)) return null;
  const route = routeThrough(stops, { id: `mission-${id}`, name: def.title, kind: 'explore', difficulty: 1 });
  if (!route) return null;
  for (const s of route.steps) if (s.turn === 'stop' && id === 'delivery') s.text = 'Pick up the order at the Night Market';
  const bikeSpeed = bikeById(p.bike).speed;
  if (friend) {
    const f = friendRun(route, bikeSpeed, 0.93);
    friend.run = f.run;
    friendTime = f.time;
  }
  // about 16 m/s on average, plus a little time to get going; easier or harder with the setting
  const base = (route.length / 16 + 12) * TIME_SCALE[difficulty];
  const limit = Math.round(friendTime ? Math.max(base, friendTime + 15) : base);
  return { id, title: def.title, brief, route, limit, reward: def.reward, clock: clockTimes, friend, friendTime, slack: friend ? 12 : undefined };
}

/** HUD for a mission ride: the countdown and, for an escort, how far ahead of your friend you are.
 *  Returns the per-frame update to call from game.onHud. */
export function missionHud(hud: HTMLElement, m: MissionRun) {
  const el = document.createElement('div');
  el.className = 'fx-mhud';
  el.innerHTML = `<span class="fx-ico">${CAMPUS_MISSIONS.find((x) => x.id === m.id)!.icon}</span><span class="grow"><small>${esc(m.title.toUpperCase())}</small><b id="fxClock"></b></span><span class="fx-mnote" id="fxNote"></span>`;
  hud.appendChild(el);
  const clockEl = el.querySelector<HTMLElement>('#fxClock')!;
  const note = el.querySelector<HTMLElement>('#fxNote')!;
  let t = 0, last = 0;
  return (h: HudState) => {
    const now = performance.now();
    // count ride time the way the game does: frames are capped at 1/20 s
    if (!h.countdown && last && h.distance < h.routeLength) t += Math.min(0.05, (now - last) / 1000);
    last = now;
    const left = m.limit - t;
    el.classList.toggle('late', left < 0);
    el.classList.toggle('soon', left >= 0 && left < 10);
    if (m.clock) {
      const at = m.clock.start + (t / m.limit) * (m.clock.end - m.clock.start);
      clockEl.textContent = `${mins(Math.floor(at))} · ${left >= 0 ? `due ${mins(m.clock.end)}` : 'late!'}`;
    } else clockEl.textContent = left >= 0 ? clock(left) : `Late ${clock(-left)}`;
    if (m.friend) {
      const ahead = h.ghostGap !== null && h.ghostGap < -(m.slack ?? 12) * 0.6;
      note.textContent = ahead ? `Wait for ${m.friend.name}!` : '';
    } else note.textContent = '';
  };
}

export interface MissionOutcome {
  passed: boolean;
  html: string;
  bonus: number;
}

/** Scores a finished mission ride: pays the reward and records the best time. Does not save. */
export function finishMission(p: Profile, m: MissionRun, r: Pick<RideResult, 'finished' | 'time'>): MissionOutcome {
  let passed = r.finished && r.time <= m.limit;
  let why = !r.finished ? 'You did not make it there.' : r.time > m.limit ? `${clock(r.time - m.limit)} too late.` : '';
  if (passed && m.friend && m.friendTime !== undefined && m.friendTime - r.time > (m.slack ?? 12)) {
    passed = false;
    why = `You left ${m.friend.name} behind: they arrived ${Math.round(m.friendTime - r.time)} s after you.`;
  }
  let bonus = 0;
  if (passed) {
    bonus = m.reward;
    p.coins += bonus;
    track(p, 'missions');
    const prev = p.missionBest[m.id];
    if (prev === undefined || r.time < prev) p.missionBest[m.id] = r.time;
  }
  const html = `<div class="card fx-outcome ${passed ? 'pass' : 'fail'}">
    <div class="row"><span class="fx-ico">${passed ? icons.check : fx.hourglass}</span><b class="grow">${esc(m.title)}: ${passed ? 'mission complete' : 'mission failed'}</b>${passed ? `<span class="badge gold">+${fmt(bonus)} ${icons.coin}</span>` : ''}</div>
    <p class="small muted">${passed ? `Done in ${clock(r.time)} with ${clock(m.limit - r.time)} to spare.` : esc(why)}</p>
  </div>`;
  return { passed, html, bonus };
}

export function missionsScreen(back: () => void = () => H().explore()) {
  const h = H();
  const p = h.profile();
  const runs = CAMPUS_MISSIONS.map((def) => ({ def, run: buildMission(p, def.id, h.settings.difficulty) }));
  screen(`
    <p class="kicker">${icons.target} Missions</p>
    <h1 class="title">Campus missions</h1>
    <p class="muted">Real errands on real campus roads, against the clock. New destinations every day.</p>
    <div class="fx-missions">${runs.map(({ def, run }) => {
      const best = p.missionBest?.[def.id];
      return `<div class="card fx-mission">
        <div class="row"><span class="fx-big-ico">${def.icon}</span><div class="grow"><h3>${esc(def.title)}</h3><p class="muted small">${esc(def.blurb)}</p></div></div>
        ${run ? `<p class="small">${esc(run.brief)}</p>
        <div class="fx-meta"><span>${fx.timer} ${clock(run.limit)}</span><span>${fx.route} ${(run.route.length / 1000).toFixed(1)} km</span><span>${icons.coin} ${fmt(def.reward)}</span>${best !== undefined ? `<span>${icons.trophy} Best ${clock(best)}</span>` : ''}</div>
        <button class="btn btn-primary" data-mission="${def.id}">Start mission</button>` : '<p class="muted small">This mission is not available from your hall yet.</p>'}
      </div>`;
    }).join('')}</div>
    <p class="muted small">Timers follow the difficulty in Settings (now ${esc(h.settings.difficulty ?? 'normal')}).${p.gear.brakes ? '' : ' Brakes from the Garage help you wait for a slow friend.'}</p>
  `, back);
  on('[data-mission]', 'click', (_, el) => {
    const run = runs.find((x) => x.def.id === el.dataset.mission)?.run;
    if (run) h.play(run.route, { mission: run });
  });
}
