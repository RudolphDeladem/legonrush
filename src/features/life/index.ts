// Campus Life on the Events tab and the map: the hangouts that are always open, how many people
// are there now, and the way in (ride there and park, or walk straight in).
import { H, esc } from '../host';
import { icons } from '../../ui/icons';
import { registerPinSource } from '../pins';
import { coverUrl } from '../events/catalog';
import { playThere } from '../events/play';
import { spaceScreen } from '../events/space';
import { crowdNow, freeNow, showNow, skyNow, venueById, venueEvent, venues, type Theme, type Venue } from './venues';

const ICON: Record<Theme, string> = { market: icons.food, jam: icons.music, square: icons.users, garden: icons.sunrise, hall: icons.pillars };

/** walk straight in */
export function enterVenue(v: Venue, back: () => void) {
  spaceScreen(venueEvent(v), back);
}
/** ride there on the real roads, park, then go in */
export function rideToVenue(v: Venue, back: () => void) {
  const e = venueEvent(v);
  if (!playThere(e, () => spaceScreen(e, back))) spaceScreen(e, back);
}

/**
 * "Live now" on the Events tab: the Campus Life places are always open, so there is always
 * somewhere to go. `liveCards` are scheduled social events that are on right now; they come first.
 */
export function campusLifeHtml(liveCards = '', liveCount = 0) {
  const list = venues(H().profile().hall).map((v) => ({ v, n: crowdNow(v), free: freeNow(v), show: showNow(v) })).sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0) || b.n - a.n);
  const night = skyNow() === 'night';
  return `<section class="ev-sec life-sec"><div class="ev-sec-h"><h2><i class="ev-dot"></i>Live now</h2><span class="muted small">${list.length + liveCount} places · ${night ? 'tonight on campus' : 'happening now'}</span></div>
    <p class="muted small life-sec-sub">Always something on. Ride there, park your bike and hang out: music, food, people and things to do.</p>
    <div class="ev-rail">${liveCards}${list.map(({ v, n, free, show }) => `
      <article class="life-card" style="background-image:linear-gradient(180deg,rgba(8,14,32,.05) 20%,rgba(8,14,32,.85)),url('${coverUrl(v.cover)}')">
        <div class="row" style="gap:6px;flex-wrap:wrap"><span class="life-count"><i class="ev-dot"></i>${n} here</span>${free ? '<span class="life-count free">FREE FOOD</span>' : ''}</div>
        <div class="grow"></div>
        <h3>${ICON[v.theme]} ${esc(v.name)}</h3>
        <p class="life-onstage">${show.emoji} ${esc(show.who)} · ${esc(show.label)}</p>
        <p>${esc(v.blurb)}</p>
        <div class="life-things">${v.things.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <div class="row" style="gap:6px"><button class="btn btn-primary btn-sm" data-life-ride="${esc(v.id)}">${icons.bike} Ride here</button><button class="btn btn-ghost btn-sm" data-life-go="${esc(v.id)}">Walk in</button></div>
      </article>`).join('')}</div></section>`;
}

/** handles the Campus Life buttons inside root; returns true when it took the click */
export function campusLifeClick(t: HTMLElement, back: () => void) {
  const ride = t.closest<HTMLElement>('[data-life-ride]')?.dataset.lifeRide;
  const go = t.closest<HTMLElement>('[data-life-go]')?.dataset.lifeGo;
  const v = venueById(ride ?? go ?? '', H().profile().hall);
  if (!v) return false;
  if (ride) rideToVenue(v, back); else enterVenue(v, back);
  return true;
}

registerPinSource('campus-life', () => venues(H().profile().hall).map((v) => ({
  id: `life:${v.id}`, kind: 'event' as const, place: v.place, title: v.name, sub: `${crowdNow(v)} here now · Campus Life`, live: true,
  open: () => rideToVenue(v, () => H().home('events')),
})));
