// Feature screens and ride hooks: challenges, badges, shop extras, campus missions,
// treasure hunt, campus guide, favourites and the profile card.
import { TOUR_STOPS, type Route } from '../game/routes';
import { MISSIONS, WEEKLY_MISSIONS, saveProfile, thisWeek, todayMissions, type Profile, type RideResult } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { H } from './host';
import { badgeToast, checkBadges, factCard, visitPlaces, achievementsScreen, BADGES } from './achievements';
import { challengesScreen } from './challenges';
import { finishMission, missionsScreen, type MissionRun } from './missions';
import { treasureScreen } from './treasure';
import { profileCardScreen } from './profilecard';

export { initFeatures, type FeatureHost, type RideExtras } from './host';
export { challengesScreen } from './challenges';
export { achievementsScreen, checkBadges, BADGES } from './achievements';
export { missionsScreen, missionHud, buildMission, CAMPUS_MISSIONS, type MissionRun } from './missions';
export { levelsScreen, playLevel, LEVELS, unlockedLevel } from './levels';
export { treasureScreen, treasureFound, treasureSeed, treasureWeek } from './treasure';
export { profileCardScreen, drawProfileCard } from './profilecard';
export { rideSetup, useRideItems, bikePaint, gearCards, shopSections, bindShop } from './shop';
export { exploreSearchHtml, exploreModesHtml, favButtonHtml, bindFavButton, favouritePlaces } from './favourites';
export { track } from '../state';

/**
 * Call once a solo ride has been scored (after applyRide): scores a mission, unlocks the places
 * reached and their campus-guide facts, and any new badges. Saves. Returns HTML for the results screen.
 */
export function afterRide(p: Profile, route: Route, r: Pick<RideResult, 'finished' | 'time'>, mission?: MissionRun) {
  let html = '';
  if (mission) html += finishMission(p, mission, r).html;
  if (route.kind === 'explore' && r.finished) {
    const names = route.id === 'freshers-tour' ? [...TOUR_STOPS] : [route.to.name];
    if (mission?.id === 'delivery') names.push('Night Market');
    const fresh = visitPlaces(p, names);
    const shown = new Set<string>();
    for (const n of [route.to.name, ...fresh.map((f) => f.place)]) {
      if (shown.has(n)) continue;
      shown.add(n);
      html += factCard(n, fresh.some((f) => f.place === n));
    }
  }
  saveProfile(p);
  html += badgeToast(checkBadges(p));
  return html;
}

/** small counts for the You tab buttons */
function counts(p: Profile) {
  const day = todayMissions(p), week = thisWeek(p);
  const ready = [...MISSIONS.filter((x) => !day.claimed.includes(x.id) && x.progress(day) >= x.goal), ...WEEKLY_MISSIONS.filter((x) => !week.claimed.includes(x.id) && x.progress(week as never) >= x.goal)].length;
  checkBadges(p);
  return { ready, badges: BADGES.filter((b) => p.badges.includes(b.id)).length };
}

/** the feature buttons for the You tab */
export function youLinksHtml(p: Profile) {
  const c = counts(p);
  const b = (id: string, icon: string, label: string, extra = '') => `<button class="fx-link" data-fx-open="${id}"><span class="fx-ico">${icon}</span><span>${label}</span>${extra}</button>`;
  return `<div class="fx-links">
    ${b('challenges', icons.target, 'Daily goals', c.ready ? `<em class="fx-dot">${c.ready}</em>` : '')}
    ${b('badges', fx.medal, 'Badges', `<small>${c.badges}/${BADGES.length}</small>`)}
    ${b('missions', fx.box, 'Missions')}
    ${b('treasure', fx.chest, 'Treasure')}
    ${b('guide', icons.book, 'Campus guide')}
    ${b('card', fx.card, 'Profile card')}
  </div>`;
}

/** wires buttons made by youLinksHtml (or any [data-fx-open]); back returns to where they were */
export function bindFeatureLinks(back: () => void) {
  H().app.querySelectorAll<HTMLElement>('[data-fx-open]').forEach((el) => el.addEventListener('click', () => {
    const id = el.dataset.fxOpen;
    if (id === 'challenges') challengesScreen(back);
    if (id === 'badges') achievementsScreen(back);
    if (id === 'guide') { achievementsScreen(back); H().app.querySelector('#guide')?.scrollIntoView(); }
    if (id === 'missions') missionsScreen(back);
    if (id === 'treasure') treasureScreen(back);
    if (id === 'card') profileCardScreen(back);
  }));
}
