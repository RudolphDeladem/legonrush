// Favourite places and the "Where do you want to go?" search for the Explore picker.
import { placeByName, type Place } from '../game/campusmap';
import { HALL_PLACE } from '../data/campus';
import { saveProfile, type Profile } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { esc } from './host';
import { departmentPlace } from './missions';
import { treasureWeek, TREASURE_GOAL } from './treasure';

export interface Favourite {
  label: string;
  icon: string;
  place: Place;
  /** saved by the rider (can be removed), not your hall or department */
  saved: boolean;
}

export function favouritePlaces(p: Profile): Favourite[] {
  const out: Favourite[] = [];
  const hall = placeByName(HALL_PLACE[p.hall] ?? '');
  if (hall) out.push({ label: 'My hall', icon: icons.bed, place: hall, saved: false });
  const dept = p.department && departmentPlace(p.department);
  if (dept) out.push({ label: 'My department', icon: icons.grad, place: dept, saved: false });
  for (const n of p.favourites ?? []) {
    const place = placeByName(n);
    if (place && !out.some((f) => f.place === place)) out.push({ label: n.replace(/^The |, .*$/g, ''), icon: fx.starFill, place, saved: true });
  }
  return out;
}

export const isFavourite = (p: Profile, name: string) => (p.favourites ?? []).includes(name);

export function toggleFavourite(p: Profile, name: string) {
  p.favourites ??= [];
  const i = p.favourites.indexOf(name);
  if (i >= 0) p.favourites.splice(i, 1);
  else p.favourites.push(name);
  saveProfile(p);
  return i < 0;
}

/** the big search box and the favourites row, for the top of the Explore picker */
export function exploreSearchHtml(p: Profile) {
  const favs = favouritePlaces(p);
  return `
    <div class="field picker fx-search"><label for="fxWhere" class="sr-only">Where do you want to go?</label>
      <span class="fx-search-ico">${fx.search}</span><input id="fxWhere" type="search" autocomplete="off" spellcheck="false" placeholder="Where do you want to go?"><ul class="suggest" id="fxWhereList" hidden></ul></div>
    ${favs.length ? `<div class="fx-favs" id="fxFavs">${favs.map((f) => `<button class="chip fx-fav" data-fav="${esc(f.place.name)}">${f.icon}<span><small>${esc(f.label)}</small>${f.saved ? '' : esc(f.place.name.replace(/^The |, .*$/g, ''))}</span></button>`).join('')}</div>` : ''}`;
}

/** Missions and treasure hunt entry cards, for the Explore picker */
export function exploreModesHtml(p: Profile) {
  const t = treasureWeek(p);
  return `<div class="fx-modes">
    <button class="card selectable fx-modecard" id="fxMissions"><span class="fx-big-ico">${fx.box}</span><span class="grow"><b>Campus missions</b><small class="muted">Deliveries, lecture rush and more, against the clock.</small></span>${icons.arrow}</button>
    <button class="card selectable fx-modecard" id="fxTreasure"><span class="fx-big-ico">${fx.chest}</span><span class="grow"><b>Treasure hunt</b><small class="muted">${Math.min(t.found, TREASURE_GOAL)} of ${TREASURE_GOAL} found this week</small></span>${icons.arrow}</button>
  </div>`;
}

/** a star button to save the destination as a favourite (goes in the route preview) */
export function favButtonHtml(p: Profile, place: Place) {
  const on = isFavourite(p, place.name);
  return `<button class="btn btn-ghost btn-sm fx-star${on ? ' on' : ''}" data-star="${esc(place.name)}" aria-pressed="${on}">${on ? fx.starFill : icons.star} ${on ? 'Saved' : 'Save place'}</button>`;
}

/** wires the star button inside root */
export function bindFavButton(root: HTMLElement, p: Profile) {
  root.querySelectorAll<HTMLElement>('[data-star]').forEach((b) => b.addEventListener('click', () => {
    const on = toggleFavourite(p, b.dataset.star!);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `${on ? fx.starFill : icons.star} ${on ? 'Saved' : 'Save place'}`;
  }));
}
