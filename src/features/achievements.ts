// Badges, places visited and the campus guide (Fresher tour facts).
import { HALL_PLACE } from '../data/campus';
import { FACTS, factFor, type Fact } from '../data/facts';
import { saveProfile, type Profile } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { H, bar, esc, fmt, screen } from './host';
import { CAMPUS_MISSIONS } from './missions';

export interface Badge {
  id: string;
  icon: string;
  name: string;
  text: string;
  /** progress towards it, and the goal */
  progress: (p: Profile) => number;
  goal: number;
}

const HALL_NAMES = [...new Set(Object.values(HALL_PLACE))];
const km = (p: Profile) => p.totalDistance / 1000;
const st = (p: Profile, k: keyof Profile['stats']) => p.stats?.[k] ?? 0;

export const BADGES: Badge[] = [
  { id: 'first-ride', icon: icons.bike, name: 'First pedal', text: 'Finish your first ride.', goal: 1, progress: (p) => p.finishes },
  { id: 'km10', icon: icons.flag, name: 'First 10 km', text: 'Ride 10 km in total.', goal: 10, progress: km },
  { id: 'km50', icon: icons.flag, name: '50 km club', text: 'Ride 50 km in total.', goal: 50, progress: km },
  { id: 'km100', icon: icons.crown, name: 'Century', text: 'Ride 100 km in total.', goal: 100, progress: km },
  { id: 'night', icon: icons.moon, name: 'Night rider', text: 'Ride 5 km after dark (7 pm to 5 am, or the Night Circuit).', goal: 5, progress: (p) => st(p, 'nightKm') },
  { id: 'explorer', icon: icons.compass, name: 'Explorer', text: 'Ride to 10 places in Explore.', goal: 10, progress: (p) => st(p, 'arrivals') },
  { id: 'halls', icon: icons.bed, name: 'Hall hopper', text: 'Ride to every hall of residence.', goal: HALL_NAMES.length, progress: (p) => HALL_NAMES.filter((n) => p.visited?.includes(n)).length },
  { id: 'expert', icon: icons.grad, name: 'Campus expert', text: 'Unlock every landmark in the campus guide.', goal: FACTS.length, progress: (p) => FACTS.filter((f) => p.visited?.includes(f.place)).length },
  { id: 'racer', icon: icons.trophy, name: 'Race winner', text: 'Win 5 races against other riders.', goal: 5, progress: (p) => p.wins },
  { id: 'races', icon: icons.race, name: 'Regular racer', text: 'Finish 25 races.', goal: 25, progress: (p) => st(p, 'races') },
  { id: 'daredevil', icon: icons.bolt, name: 'Daredevil', text: 'Have 50 near misses.', goal: 50, progress: (p) => st(p, 'nearMiss') },
  { id: 'airtime', icon: icons.star, name: 'Airtime', text: 'Jump 100 times.', goal: 100, progress: (p) => st(p, 'jumps') },
  { id: 'treasure', icon: fx.chest, name: 'Treasure hunter', text: 'Find 10 treasures.', goal: 10, progress: (p) => st(p, 'treasure') },
  { id: 'courier', icon: fx.box, name: 'Campus courier', text: 'Complete every campus mission.', goal: CAMPUS_MISSIONS.length, progress: (p) => CAMPUS_MISSIONS.filter((m) => p.missionBest?.[m.id] !== undefined).length },
  { id: 'streak', icon: icons.flame, name: 'On fire', text: 'Clear all daily challenges 7 days in a row.', goal: 7, progress: (p) => p.dailyStreak?.count ?? 0 },
  { id: 'challenger', icon: icons.target, name: 'Challenger', text: 'Claim 20 challenges.', goal: 20, progress: (p) => st(p, 'challenges') },
  { id: 'tuned', icon: fx.wrench, name: 'Fully tuned', text: 'Take one bike upgrade to level 3.', goal: 3, progress: (p) => Math.max(0, ...Object.values(p.gear?.upgrades ?? {})) },
  { id: 'rich', icon: icons.coin, name: 'Coin collector', text: 'Hold 5,000 Rush Coins at once.', goal: 5000, progress: (p) => p.coins },
];

/** Unlocks any badges the rider has now earned; returns the new ones. Saves when something changed. */
export function checkBadges(p: Profile): Badge[] {
  p.badges ??= [];
  const fresh = BADGES.filter((b) => !p.badges.includes(b.id) && b.progress(p) >= b.goal);
  if (fresh.length) {
    p.badges.push(...fresh.map((b) => b.id));
    saveProfile(p);
  }
  return fresh;
}

/** Marks places as visited. Returns the landmark facts that were unlocked for the first time. Does not save. */
export function visitPlaces(p: Profile, names: string[]): Fact[] {
  p.visited ??= [];
  const fresh: Fact[] = [];
  for (const n of names) {
    if (p.visited.includes(n)) continue;
    p.visited.push(n);
    const f = factFor(n);
    if (f) fresh.push(f);
  }
  return fresh;
}

/** the fact card for a place you just reached, if it is a landmark in the guide */
export function factCard(place: string, isNew: boolean) {
  const f = factFor(place);
  if (!f) return '';
  return `<div class="card fx-fact">
    <div class="row"><span class="fx-ico">${icons.book}</span><b class="grow">${esc(f.title)}</b>${isNew ? '<span class="badge gold">Unlocked</span>' : ''}</div>
    <p class="small">${esc(f.text)}</p>
  </div>`;
}

export function badgeToast(b: Badge[]) {
  return b.map((x) => `<div class="levelup fx-newbadge"><span class="fx-ico">${x.icon}</span> New badge: <b>${esc(x.name)}</b></div>`).join('');
}

export function achievementsScreen(back: () => void = () => H().home('you')) {
  const p = H().profile();
  checkBadges(p);
  const got = BADGES.filter((b) => p.badges.includes(b.id)).length;
  const known = FACTS.filter((f) => p.visited?.includes(f.place));
  screen(`
    <p class="kicker">${fx.medal} Achievements</p>
    <h1 class="title">Badges</h1>
    <div class="card"><div class="row"><b>${got} of ${BADGES.length} badges</b></div>${bar(got, BADGES.length)}</div>
    <div class="fx-badges">${BADGES.map((b) => {
      const on = p.badges.includes(b.id);
      const prog = Math.min(b.goal, b.progress(p));
      return `<div class="fx-badge${on ? ' on' : ''}">
        <span class="fx-medal">${b.icon}</span>
        <b>${esc(b.name)}</b>
        <small class="muted">${esc(b.text)}</small>
        ${on ? `<span class="badge gold">${icons.check} Earned</span>` : `${bar(prog, b.goal)}<small class="muted">${Number.isInteger(prog) ? fmt(prog) : prog.toFixed(1)} / ${fmt(b.goal)}</small>`}
      </div>`;
    }).join('')}</div>
    <h2 class="shop-h" id="guide">${icons.book} Campus guide</h2>
    <p class="muted small">Ride to a landmark in Explore, on the Freshers' Tour or on a campus mission to unlock its story. Unlock all ${FACTS.length} to earn Campus expert. ${known.length} unlocked so far.</p>
    <div class="fx-guide">${FACTS.map((f) => {
      const on = p.visited?.includes(f.place);
      return `<button class="card fx-fact${on ? '' : ' locked'}" data-place="${esc(f.place)}">
        <div class="row"><span class="fx-ico">${on ? icons.book : icons.lock}</span><b class="grow">${esc(f.title)}</b>${on ? '' : `<span class="small muted">Ride there ${icons.arrow}</span>`}</div>
        ${on ? `<p class="small">${esc(f.text)}</p>` : ''}
      </button>`;
    }).join('')}</div>
  `, back);
  H().app.querySelectorAll<HTMLElement>('.fx-fact.locked[data-place]').forEach((el) => el.addEventListener('click', () => H().explore(undefined, el.dataset.place!)));
}
