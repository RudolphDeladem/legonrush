// An event's page: cover, host, when and where (mini map + Ride there), entry, capacity, rules,
// rewards, Join / Leave / Share, and the way in to the activity itself.
import { H, esc, fmt, screen } from '../host';
import { icons } from '../../ui/icons';
import { placeByName, searchPlaces } from '../../game/campusmap';
import { campusOverview } from '../../ui/mapview';
import { homePlace } from '../missions';
import * as cloud from '../../cloud';
import type { CampusEvent } from './types';
import { TYPES, RULES, coverUrl, placeLabel, LOCATIONS } from './catalog';
import { now, rangeText, statusOf, isOn, timedOf, countdown, hourText } from './schedule';
import { eventByKey, isJoined, isDone, join, joinBlock, leave, seriesById, refresh } from './store';
import { statusBadge, officialBadge, rewardsList, eventCard } from './ui';
import { HEAT, heatOf, photos, playCoinRush, playDiamondRush, playHunt, playState, playStops, playThere, playTimed, routeThere, setBack } from './play';
import { spaceOpen, spaceScreen } from './space';
import { isAdmin, cancelEvent } from './cloud';

const toEvents = () => H().home('events');
setBack((key) => eventDetail(key));

export function eventDetail(key: string, back: () => void = toEvents) {
  const e = eventByKey(key);
  if (!e) return missing(back);
  const h = H();
  const p = h.profile();
  const st = statusOf(e);
  const t = TYPES[e.type];
  const joined = isJoined(p, e.key);
  const on = isOn(st);
  const host = e.source === 'community' ? `Hosted by ${esc(e.host)}` : `${officialBadge()} <span class="muted small">Hosted by LEGONRUSH</span>`;
  const capacity = e.capacity === null ? 'Unlimited' : `${fmt(e.capacity)} riders`;
  const counted = e.joinedCount !== undefined && e.joinedCount > 0 ? `${fmt(e.joinedCount)} joined` : '';
  const rewards = rewardsList(e);
  const mine = photos(e.key);

  screen(`
    <div class="ev-hero" style="background-image:linear-gradient(180deg,rgba(11,21,48,0) 30%,rgba(11,21,48,.85)),url('${coverUrl(e.cover)}')">
      <div class="row">${statusBadge(st)}<span class="grow"></span>${e.series ? `<span class="ev-chip-dark">Day ${e.series.day} of ${e.series.of}</span>` : ''}</div>
      <div class="grow"></div>
      <p class="ev-hero-type">${t.icon}${esc(t.label)}${e.series ? ` · ${esc(e.series.name)}` : ''}</p>
      <h1 class="ev-hero-title">${esc(e.name)}</h1>
    </div>
    <div class="row ev-host">${host}</div>
    <div class="ev-facts">
      <div>${icons.clock}<span><small>When</small><b>${esc(rangeText(e))}</b>${on ? `<em class="ev-hot">Ends in ${countdown(e.end - now())}</em>` : st === 'soon' || st === 'open' || st === 'upcoming' ? `<em>Starts in ${countdown(e.start - now())}</em>` : ''}</span></div>
      <div>${icons.pin}<span><small>Where</small><b>${esc(placeLabel(e.place))}</b></span></div>
      <div>${icons.ticket}<span><small>Entry</small><b>${e.fee ? `${icons.coin} ${fmt(e.fee)} Rush Coins to join` : 'Free'}</b></span></div>
      <div>${icons.users}<span><small>Capacity</small><b>${capacity}</b>${counted ? `<em>${counted}</em>` : ''}</span></div>
    </div>
    <div id="evAction" class="stack"></div>
    <div class="card stack" style="gap:8px">
      <b>About this event</b>
      <p class="ev-desc">${esc(e.description || e.blurb)}</p>
      ${e.rules.length ? `<div class="ev-rules">${e.rules.map((r) => `<span class="ev-rule" title="${esc(RULES[r].hint)}">${RULES[r].icon}${esc(RULES[r].label)}</span>`).join('')}</div>` : ''}
    </div>
    ${rewards.length ? `<div class="card stack" style="gap:6px"><b>${icons.trophy} Rewards</b>${rewards.map(([k, v]) => `<div class="ev-rw"><span class="muted small">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      ${e.source === 'community' && e.fee ? '<p class="muted small">Entry fees go into the prize pool, paid out by LEGONRUSH after the event.</p>' : ''}</div>` : ''}
    ${mine.length ? `<div class="card stack" style="gap:8px"><b>${icons.camera} Your photos</b><div class="ev-photos">${mine.map((x) => `<figure><img src="${x.url}" alt="${esc(placeLabel(x.place))}"><figcaption>${esc(placeLabel(x.place))}</figcaption></figure>`).join('')}</div></div>` : ''}
    ${e.series ? seriesStrip(e) : ''}
    <div class="card stack" style="gap:8px">
      <div class="row"><b>${icons.map} Location</b><span class="grow"></span><span class="muted small">${esc(placeLabel(e.place))}</span></div>
      <canvas class="ev-minimap" id="evMap" width="640" height="340" aria-label="Map of ${esc(placeLabel(e.place))}"></canvas>
      ${routeThere(e) ? `<button class="btn btn-ghost" id="evRide">${icons.bike} Ride there from ${esc(placeLabel(homePlace(p).name))}</button>` : ''}
    </div>
    <div class="two"><button class="btn btn-ghost" id="evShare">${icons.share} Share</button>${joined && e.start > now() ? `<button class="btn btn-ghost" id="evLeave">Leave event</button>` : `<button class="btn btn-ghost" id="evHome">${icons.events} All events</button>`}</div>
    <p class="muted small" id="evShareNote" hidden></p>
    <div id="evAdmin"></div>
  `, back, 'ev-detail');

  drawMap(e);
  renderAction(e, back);
  const $ = (s: string) => h.app.querySelector<HTMLElement>(s);
  $('#evRide')?.addEventListener('click', () => rideThere(e, back));
  $('#evHome')?.addEventListener('click', toEvents);
  $('#evShare')?.addEventListener('click', () => h.share(`${e.name} on LEGONRUSH: ${rangeText(e)} at ${placeLabel(e.place)}`, `${location.origin}${import.meta.env.BASE_URL}play/?ev=${encodeURIComponent(e.key)}`, $('#evShareNote')!));
  $('#evLeave')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = e.fee ? 'Tap again: your fee is refunded' : 'Tap again to leave'; return; }
    b.disabled = true;
    const ok = await leave(p, e);
    if (!ok) { b.textContent = 'Couldn\'t leave. Try again online.'; b.disabled = false; return; }
    eventDetail(e.key, back);
  });
  h.app.querySelectorAll<HTMLElement>('.ev-days [data-ev]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.ev !== e.key) eventDetail(b.dataset.ev!, back); }));
  h.app.querySelector('[data-series-open]')?.addEventListener('click', () => seriesScreen(e.series!.id, () => eventDetail(e.key, back)));
  // admins and the creator can cancel a server event
  if (e.source !== 'official' && st !== 'cancelled' && st !== 'completed') {
    void isAdmin().then((admin) => {
      if (!(admin || (e.ownerId && e.ownerId === cloud.account?.id)) || !$('#evAdmin')) return;
      $('#evAdmin')!.innerHTML = `<button class="btn btn-link ev-danger" id="evCancel">${admin ? 'Admin: ' : ''}Cancel this event</button>`;
      $('#evCancel')!.addEventListener('click', async (ev) => {
        const b = ev.currentTarget as HTMLButtonElement;
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to cancel. Everyone who paid is refunded.'; return; }
        b.disabled = true;
        const ok = await cancelEvent(e.key.slice(3));
        if (ok) { await refresh(true); eventDetail(e.key, back); } else { b.textContent = 'Couldn\'t cancel. Try again online.'; b.disabled = false; }
      });
    });
  }
}

function missing(back: () => void) {
  screen(`<div class="ev-empty-card"><span class="ev-empty-ico">${icons.events}</span><b>This event isn't here any more</b><p class="muted small">It may have ended or been removed.</p><button class="btn btn-primary" id="evAll">See what's on</button></div>`, back);
  H().app.querySelector('#evAll')?.addEventListener('click', toEvents);
}

function drawMap(e: CampusEvent) {
  const c = H().app.querySelector<HTMLCanvasElement>('#evMap');
  const pl = placeByName(e.place);
  if (!c || !pl) return;
  const home = homePlace(H().profile());
  const near = Math.hypot(home.x - pl.x, home.z - pl.z) < 1600;
  const around = near ? [pl, home] : [pl, { x: pl.x - 350, z: pl.z - 250 }, { x: pl.x + 350, z: pl.z + 250 }];
  try {
    const m = campusOverview(c, around);
    m.draw([...(near && home !== pl ? [{ x: home.x, z: home.z, color: '#1a73e8', label: 'You' }] : []), { x: pl.x, z: pl.z, color: '#ea4335', label: placeLabel(e.place) }]);
  } catch { /* the map is a nice-to-have */ }
}

function seriesStrip(e: CampusEvent) {
  const s = seriesById(e.series!.id);
  if (!s) return '';
  return `<div class="card stack" style="gap:8px"><div class="row"><b>${icons.events} ${esc(s.name)}</b><span class="grow"></span><button class="btn btn-link" data-series-open>Full schedule</button></div>
    <ol class="ev-days">${s.days.map((d) => `<li><button class="${d.key === e.key ? 'on' : ''}${statusOf(d) === 'completed' ? ' past' : ''}" data-ev="${esc(d.key)}"><span>Day ${d.series!.day}</span><b>${esc(d.name)}</b><small>${esc(new Date(d.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</small></button></li>`).join('')}</ol></div>`;
}

export function seriesScreen(id: string, back: () => void = toEvents) {
  const s = seriesById(id);
  if (!s) return missing(back);
  const p = H().profile();
  screen(`
    <div class="ev-hero short" style="background-image:linear-gradient(180deg,rgba(11,21,48,0) 20%,rgba(11,21,48,.85)),url('${coverUrl(s.cover)}')">
      <div class="row">${officialBadge(true)}</div><div class="grow"></div>
      <p class="ev-hero-type">${icons.events}Event series · ${s.days.length} ${s.days.length === 1 ? 'day' : 'days'}</p>
      <h1 class="ev-hero-title">${esc(s.name)}</h1>
    </div>
    <p class="muted">${esc(s.blurb)}</p>
    <div class="ev-grid">${s.days.map((d) => eventCard(d, { joined: isJoined(p, d.key) })).join('')}</div>
  `, back, 'ev-detail');
  H().app.querySelectorAll<HTMLElement>('[data-ev]').forEach((b) => b.addEventListener('click', () => eventDetail(b.dataset.ev!, () => seriesScreen(id, back))));
}

// ---------- the action area ----------
function renderAction(e: CampusEvent, back: () => void) {
  const h = H();
  const p = h.profile();
  const box = h.app.querySelector<HTMLElement>('#evAction');
  if (!box) return;
  const st = statusOf(e);
  const joined = isJoined(p, e.key);
  const on = isOn(st);
  const done = isDone(p, e.key);
  const block = joined ? null : joinBlock(p, e);
  let html = '';

  if (st === 'cancelled') html = `<div class="ev-note bad">${icons.close} This event was cancelled. Entry fees are refunded to everyone who paid.</div>`;
  else if (st === 'completed') html = `<div class="ev-note">${icons.check} This event has ended.${done ? ' You completed it.' : ''}</div>`;
  else if (!joined && e.fee) {
    html = `<button class="btn btn-primary ev-cta" id="evJoin" ${block ? 'disabled' : ''}>${icons.coin} Join for ${fmt(e.fee)} Rush Coins</button>${block ? `<p class="ev-note bad">${esc(block)}</p>` : `<p class="muted small">The fee is taken when you join. Leave before it starts for a refund.</p>`}`;
  } else if (!joined && !on) {
    html = `<button class="btn btn-primary ev-cta" id="evJoin" ${block ? 'disabled' : ''}>${icons.plus} Join event</button>${block ? `<p class="ev-note bad">${esc(block)}</p>` : `<p class="muted small">We'll remind you 30 minutes before it starts, and when it starts.</p>`}`;
  } else if (!on) {
    html = `<div class="ev-note good">${icons.check} You're in. It starts ${esc(hourText(e.start))}${new Date(e.start).toDateString() === new Date(now()).toDateString() ? ' today' : ` on ${new Date(e.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`}. We'll remind you.</div>`;
  } else {
    html = playArea(e, done);
  }
  box.innerHTML = html;
  box.querySelector('#evJoin')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.textContent = 'Joining…';
    const r = await join(p, e);
    if (!r.ok) { b.disabled = false; b.textContent = 'Try again'; box.insertAdjacentHTML('beforeend', `<p class="ev-note bad">${esc(r.error)}</p>`); return; }
    eventDetail(e.key, back);
  });
  bindPlay(e, box, back);
}

function playArea(e: CampusEvent, done: boolean) {
  const doneNote = done ? `<p class="ev-note good">${icons.check} Completed. You can still play for fun.</p>` : '';
  switch (e.activity) {
    case 'hunt': return huntPanel(e);
    case 'coinrush': {
      const st = playState(e.key);
      return `${doneNote}<button class="btn btn-primary ev-cta" data-go="coinrush">${icons.coin} Start ${esc(e.name)}</button><p class="muted small">${Math.round((e.timeLimit ?? 120) / 60)} minutes around the ${esc(placeLabel(e.place))}.${st.haul ? ` Your best: ${st.haul} coins.` : ''}</p>`;
    }
    case 'diamondrush': {
      const got = playState(e.key).gems ?? 0;
      return `${doneNote}<button class="btn btn-primary ev-cta" data-go="diamondrush">${icons.diamond} Start Diamond Rush</button><p class="muted small">${got ? `You have collected ${got} of 3.` : 'Three diamonds on the road. Each one you grab is yours.'}</p>`;
    }
    case 'photohunt':
    case 'explorer': {
      const got = playState(e.key).got ?? [];
      const stops = e.stops ?? [];
      return `<div class="card stack" style="gap:8px"><b>${e.activity === 'photohunt' ? icons.camera : icons.compass} ${got.length} of ${stops.length} places</b>
        <ul class="ev-checklist">${stops.map((s) => `<li class="${got.includes(s) ? 'on' : ''}">${got.includes(s) ? icons.check : icons.pin}${esc(placeLabel(s))}</li>`).join('')}</ul>
        ${got.length < stops.length ? `<button class="btn btn-primary ev-cta" data-go="stops">${icons.bike} Ride to the ${got.length ? 'rest' : 'places'}</button>` : `<p class="ev-note good">${icons.check} All done!</p>`}</div>`;
    }
    case 'sunset': {
      const tm = timedOf(e);
      return `${doneNote}<button class="btn btn-primary ev-cta" data-go="there">${icons.sunrise} Ride to the sunset spot</button>
        ${tm ? `<button class="btn btn-ghost" data-go="timed">${icons.flag} Or race the ${esc(tm.def.name)}${tm.live ? ' for double coins' : ''}</button>` : ''}`;
    }
    case 'timed': {
      const tm = timedOf(e);
      return `${doneNote}<button class="btn btn-primary ev-cta" data-go="timed">${icons.moon} Ride the Night Circuit${tm?.live ? ' · double coins' : ''}</button>
        <button class="btn btn-ghost" data-go="there">${icons.bike} Calm night ride to the ${esc(placeLabel(e.place))}</button>
        <p class="muted small">Finish the Night Circuit while it is live for a chance at the ${esc(tm?.def.prize === 'neon' ? 'Neon' : 'prize')} bike.</p>`;
    }
    case 'space':
      return spaceOpen(e)
        ? `${doneNote}<button class="btn btn-primary ev-cta" data-go="there">${icons.bike} Ride there</button><button class="btn btn-ghost" data-go="enter">${icons.sparkle} Enter without riding</button>
           <p class="muted small">Ride to ${esc(placeLabel(e.place))}, park your bike and walk in. Riding there counts for your passport too.</p>`
        : `<p class="ev-note">Doors open 15 minutes before the start.</p>`;
    default:
      return '';
  }
}

function bindPlay(e: CampusEvent, box: HTMLElement, back: () => void) {
  const fail = () => box.insertAdjacentHTML('beforeend', `<p class="ev-note bad">This ride couldn't be built from here. Try another place.</p>`);
  const autoJoin = () => { if (!isJoined(H().profile(), e.key) && !e.fee) void join(H().profile(), e); };
  box.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => {
    autoJoin();
    const g = b.dataset.go;
    const ok = g === 'coinrush' ? playCoinRush(e) : g === 'diamondrush' ? playDiamondRush(e) : g === 'stops' ? playStops(e) : g === 'timed' ? playTimed(e)
      : g === 'there' ? rideThere(e, back) : g === 'enter' ? (spaceScreen(e, () => eventDetail(e.key, back)), true) : false;
    if (!ok) fail();
  }));
  // treasure hunt: pick where to ride
  const input = box.querySelector<HTMLInputElement>('#huntTo');
  const list = box.querySelector<HTMLElement>('#huntList');
  const go = box.querySelector<HTMLButtonElement>('#huntGo');
  let target = '';
  const choose = (name: string) => {
    target = name;
    if (go) { go.disabled = false; go.innerHTML = `${icons.bike} Ride to ${esc(placeLabel(name))}`; }
    box.querySelectorAll('[data-hunt]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.hunt === name));
    if (input) input.value = placeLabel(name);
    if (list) list.innerHTML = '';
  };
  box.querySelectorAll<HTMLElement>('[data-hunt]').forEach((b) => b.addEventListener('click', () => choose(b.dataset.hunt!)));
  input?.addEventListener('input', () => {
    const q = input.value.trim();
    if (!list) return;
    list.innerHTML = q.length < 2 ? '' : searchPlaces(q, 6).map((m) => `<li><button data-pick="${esc(m.place.name)}">${icons.pin}${esc(m.place.name)}${m.alias ? ` <small class="muted">${esc(m.alias)}</small>` : ''}</button></li>`).join('');
    list.querySelectorAll<HTMLElement>('[data-pick]').forEach((x) => x.addEventListener('click', () => choose(x.dataset.pick!)));
  });
  go?.addEventListener('click', () => {
    if (!target) return;
    autoJoin();
    if (!playHunt(e, target)) fail();
  });
}

function huntPanel(e: CampusEvent) {
  const st = playState(e.key);
  if (st.found) return `<div class="ev-note good">${icons.diamond} You found the treasure! It was at the ${esc(placeLabel(e.spot ?? ''))}.</div>`;
  const clues = e.clues ?? [];
  const shown = Math.min(clues.length, (st.rides ?? 0) + 1);
  const heat = st.best !== undefined ? heatOf(st.best) : null;
  return `<div class="card stack ev-hunt" style="gap:10px">
    <div class="row"><b>${icons.diamond} The hunt is on</b><span class="grow"></span>${heat ? `<span class="ev-heat ${heat[2]}">${heat[1]}</span>` : ''}</div>
    <ol class="ev-clues">${clues.slice(0, shown).map((c, i) => `<li><small>Clue ${i + 1}</small>${esc(c)}</li>`).join('')}${shown < clues.length ? `<li class="locked"><small>Clue ${shown + 1}</small>Revealed after your next ride</li>` : ''}</ol>
    <div class="ev-heat-scale">${[...HEAT].reverse().map(([, l, c]) => `<span class="ev-heat ${c}">${l}</span>`).join('')}</div>
    <b class="small">Where will you ride?</b>
    <div class="ev-chips">${LOCATIONS.slice(0, 10).map(([n, l]) => `<button class="chip" data-hunt="${esc(n)}">${esc(l)}</button>`).join('')}</div>
    <div class="field"><input id="huntTo" placeholder="Or search any place on campus" autocomplete="off"></div>
    <ul class="ev-suggest" id="huntList"></ul>
    <button class="btn btn-primary ev-cta" id="huntGo" disabled>${icons.bike} Choose a place</button>
    <p class="muted small">The meter says how close you are while you ride. When it says Treasure nearby, it's on the road ahead: steer into it.</p>
  </div>`;
}

/** Ride there: social events end with Park bike and enter event */
function rideThere(e: CampusEvent, back: () => void) {
  return playThere(e, () => {
    if (spaceOpen(e)) spaceScreen(e, () => eventDetail(e.key, back));
    else eventDetail(e.key, back);
  });
}
