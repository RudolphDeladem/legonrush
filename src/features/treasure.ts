// Weekly treasure hunt: gold chests hidden along this week's route. The game places them
// (Game.setTreasure(count, seed)) and reports each find (onTreasure -> treasureFound).
import { placeByName, type Place } from '../game/campusmap';
import { exploreRoute } from '../game/routes';
import { saveProfile, seeded, track, weekId, type Profile } from '../state';
import { icons } from '../ui/icons';
import { sfx } from '../audio';
import { fx } from './icons';
import { H, bar, esc, fmt, on, screen } from './host';
import { homePlace } from './missions';

export const TREASURE_GOAL = 5;
export const TREASURE_REWARD = 600;
/** chests placed on one hunt ride */
export const TREASURE_PER_RIDE = 3;

const HUNT_SPOTS = ['The Balme Library', 'Great Hall', 'Night Market', 'Sports Complex', 'University of Ghana Hospital', 'Jones Quartey Building, JQB', 'University of Ghana Registry', 'School of Law', 'Athletic Oval', 'University of Ghana Business School', 'Central Cafeteria, CC', 'Legon Main Entrance'];

/** this week's number for placing the treasure: the same for every rider */
export function treasureSeed(week = weekId()) {
  return Math.floor(seeded('treasure:' + week)() * 2 ** 31);
}

/** this week's hunt progress, reset on Monday */
export function treasureWeek(p: Profile) {
  const week = weekId();
  if (p.treasure?.week !== week) p.treasure = { week, found: 0, claimed: false };
  return p.treasure;
}

/** Call from Game.onTreasure: counts a find for the hunt, the challenges and the badges. Does not save. */
export function treasureFound(p: Profile, n = 1) {
  treasureWeek(p).found += n;
  track(p, 'treasure', n);
}

/** where this week's chests are hidden: on the way from your hall to a landmark */
export function huntRoute(p: Profile) {
  const rnd = seeded('hunt:' + weekId());
  const from = homePlace(p);
  // a hunt worth the ride: somewhere at least 700 m away (as the crow flies)
  const all = HUNT_SPOTS.map((n) => placeByName(n)).filter((q): q is Place => !!q && q !== from);
  const far = all.filter((q) => Math.hypot(q.x - from.x, q.z - from.z) > 700);
  const spots = far.length ? far : all;
  const to = spots[Math.floor(rnd() * spots.length)];
  return to ? exploreRoute(from, to) : null;
}

export function treasureScreen(back: () => void = () => H().home('you')) {
  const h = H();
  const p = h.profile();
  const t = treasureWeek(p);
  const route = huntRoute(p);
  const now = new Date();
  const daysLeft = 7 - ((now.getDay() + 6) % 7);
  screen(`
    <p class="kicker">${fx.chest} Treasure hunt</p>
    <h1 class="title">This week's treasure</h1>
    <div class="card fx-treasure">
      <span class="fx-big-ico">${fx.chest}</span>
      <div class="grow"><b>${Math.min(t.found, TREASURE_GOAL)} of ${TREASURE_GOAL} found</b>${bar(t.found, TREASURE_GOAL)}
      <p class="muted small">${t.claimed ? `Reward claimed. A new hunt starts on Monday.` : `Find ${TREASURE_GOAL} chests by Sunday for <b>${fmt(TREASURE_REWARD)}</b> coins. ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`}</p></div>
    </div>
    ${t.found >= TREASURE_GOAL && !t.claimed ? `<button class="btn btn-primary" id="fxClaim">Claim ${fmt(TREASURE_REWARD)} coins</button>` : ''}
    ${route ? `<div class="card stack" style="gap:8px">
      <div class="row"><span class="fx-ico">${icons.map}</span><b class="grow">Hidden on the way to ${esc(route.to.name)}</b></div>
      <p class="muted small">${TREASURE_PER_RIDE} gold chests lie along the road from ${esc(route.from.name)}, ${(route.length / 1000).toFixed(1)} km. Ride through a chest to pick it up. Every rider hunts the same spots this week.</p>
      <button class="btn btn-primary" id="fxHunt">Start the hunt</button>
    </div>` : '<p class="muted small">No hunt route from your hall this week.</p>'}
    <p class="muted small">Chests you find also count for your challenges and the Treasure hunter badge.</p>
  `, back);
  on('#fxHunt', 'click', () => route && h.play(route, { treasure: { count: TREASURE_PER_RIDE, seed: treasureSeed() } }));
  on('#fxClaim', 'click', () => {
    if (t.claimed || t.found < TREASURE_GOAL) return;
    t.claimed = true;
    p.coins += TREASURE_REWARD;
    saveProfile(p);
    sfx.finish();
    treasureScreen(back);
  });
}
