// Events: the campus "what's happening" hub. Separate from races (beat riders) and challenges
// (beat a target): an event is something happening somewhere on campus.
import { H, esc } from '../host';
import { registerPinSource, type Pin } from '../pins';
import { notice } from '../money-ui';
import { allEvents, collectServerRewards } from './store';
import { isOn, now, statusOf } from './schedule';
import { TYPES, placeLabel } from './catalog';
import { eventDetail } from './detail';
import { passportScreen } from './passport';
import './events.css';

export { passportCardHtml, passportScreen } from './passport';
export { eventDetail, seriesScreen } from './detail';
export { createWizard } from './wizard';
export { EVENT_ITEMS, eventItem } from './catalog';

let ready = false;
/** once: map pins, the passport card's tap, ?ev= links, and server payouts */
export function initEvents() {
  if (ready) return;
  ready = true;

  // events happening now or later today show on the campus map (a treasure hunt shows where it starts, never the treasure)
  registerPinSource('events', (): Pin[] => {
    const t = now();
    const end = new Date(t); end.setHours(23, 59, 59);
    return allEvents()
      .filter((e) => e.activity !== 'prize' && e.activity !== 'hallweek' && statusOf(e, t) !== 'cancelled' && e.end > t && e.start < end.getTime())
      .map((e) => ({
        id: `event:${e.key}`,
        kind: e.type === 'treasure' || e.activity === 'hunt' ? 'treasure' : 'event',
        place: e.place,
        title: e.name,
        sub: `${TYPES[e.type].label} · ${isOn(statusOf(e, t)) ? 'Live now' : new Date(e.start).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })} · ${placeLabel(e.place)}`,
        live: isOn(statusOf(e, t)),
        open: () => eventDetail(e.key, () => H().home('map')),
      }));
  });

  // the passport card works wherever it is shown
  document.addEventListener('click', (ev) => {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-ev-passport]');
    if (!card) return;
    const back = card.dataset.evPassport === 'events' ? 'events' : 'you';
    passportScreen(() => H().home(back));
  });

  // opened from a shared event link: once the menu is up, go to Events (which opens the event)
  if (new URLSearchParams(location.search).has('ev')) {
    let tries = 0;
    const wait = setInterval(() => {
      if (++tries > 40) return clearInterval(wait);
      if (!document.querySelector('#app .home')) return;
      clearInterval(wait);
      H().home('events');
    }, 750);
  }
}

let paidCheck = 0;
/** prize-pool winnings and refunds from the server, added once each (signed-in riders) */
export async function claimPayouts() {
  if (Date.now() - paidCheck < 5 * 60e3) return;
  paidCheck = Date.now();
  const lines = await collectServerRewards(H().profile());
  if (lines.length) notice(`<b>Event rewards</b><br>${lines.map(esc).join('<br>')}`, 'ok', 9000);
}

/** a shared link (?ev=<key>) opens that event the first time Events is shown */
let linkUsed = false;
export function openLinkedEvent(): boolean {
  if (linkUsed) return false;
  linkUsed = true;
  const key = new URLSearchParams(location.search).get('ev');
  if (!key || !allEvents().some((e) => e.key === key)) return false;
  eventDetail(key);
  return true;
}
