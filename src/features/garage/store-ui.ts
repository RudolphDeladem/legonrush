// Store screens: the storefront (featured, drops, daily free item, categories, search), product pages
// with the 3D preview, and the admins' store controls.
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import { HALLS, hallById } from '../../data/campus';
import { saveProfile, type Profile } from '../../state';
import { H, esc, fmt } from '../host';
import { fx } from '../icons';
import { buyCoinsScreen } from '../money-ui';
import {
  BIKE_ITEMS, CLASSES, ITEMS, MAX_LEVEL, RARITIES, RARITY, SLOTS, SOURCES, bikeLook, bundleValue, item,
  type BikeClass, type Item, type Kind, type Rarity,
} from './catalog';
import { bikeSvg, itemArt } from './art';
import {
  applyItem, baseStats, buyable, count, owned, partBonus, priceOf, progress, rarityOf, ratingOf, status, statsFor, styleFor,
  toggleWish, wished, type Status,
} from './garage';
import { buy, claimDaily, claimStarter, kindName } from './buy';
import { mountStage, stageControls, unmountStage } from './preview';
import { addRotation, isAdmin, loadStore, overrides, removeRotation, saveOverride, scheduled, trending, wish, type Slot } from './remote';
import { countdown, localDay, rotation, seasonState } from './rotation';
import { bindCommon, card, page, priceHtml, rarityChip, ratingHtml, statBars, statusHtml, tabsHtml, unlockHtml, wallet } from './ui';
import { bikeDetail, compareScreen } from './screens';

export type Cat = 'featured' | 'bikes' | 'parts' | 'cosmetics' | 'rider' | 'gear' | 'bundles' | 'events' | 'hall' | 'currency';
export const CATS: [Cat, string][] = [
  ['featured', 'Featured'], ['bikes', 'Bikes'], ['parts', 'Parts'], ['cosmetics', 'Cosmetics'], ['rider', 'Rider'], ['gear', 'Ride gear'],
  ['bundles', 'Bundles'], ['events', 'Event shop'], ['hall', 'Hall shop'], ['currency', 'Currency'],
];
const COS_SUB: [string, string, Kind[]][] = [
  ['paint', 'Paint', ['paint']], ['finish', 'Finishes', ['finish']], ['decal', 'Decals', ['decal']], ['wheel', 'Wheels & tyres', ['wheel', 'tyre']],
  ['bars', 'Bars & saddles', ['bars', 'seat', 'grips']], ['light', 'Lights', ['light']], ['acc', 'Accessories', ['acc', 'bell']],
];
export const store = { cat: 'featured' as Cat, sub: 'all', q: '', sort: 'featured', rar: 'all' as Rarity | 'all', hideOwned: false };

const P = () => H().profile();
const backToStore = () => H().home('store');
const artFor = (p: Profile, it: Item) => (it.kind === 'bike' && owned(p, it.id) ? bikeSvg(styleFor(p, it.id.slice(5))) : itemArt(it));
const sub = (it: Item) => it.kind === 'bike' ? `${CLASSES[it.cls!].name} · Rating ${ratingOf(it.stats!)}`
  : it.kind === 'part' ? esc(Object.entries(it.bonus ?? {}).map(([k, v]) => `+${v} ${k === 'accel' ? 'Accel.' : k[0].toUpperCase() + k.slice(1)}`).join(' ') || 'Stock')
  : it.kind === 'bundle' ? `${(it.contains ?? []).length} items` : esc(kindName(it));

// ---------- the storefront ----------

/** the Store tab's page */
export function storeHtml(p: Profile) {
  return `<div class="gx gx-store">
    <div class="gx-head"><h1 class="title">Store</h1><span class="grow"></span>${wallet(p, false)}</div>
    <p class="gx-tag">Ride better. Look better. Stand out.</p>
    <div class="gx-searchrow">
      <label class="gx-search">${fx.search}<input id="stSearch" type="search" autocomplete="off" placeholder="Search bikes, helmets, decals, wheels…" value="${esc(store.q)}" aria-label="Search the store"></label>
      <button class="btn btn-ghost btn-sm gx-admin-btn" id="stAdmin" hidden>${icons.sliders} Admin</button>
    </div>
    <div class="gx-cats">${tabsHtml(CATS, store.q ? '' : store.cat, 'data-cat')}</div>
    <div id="stBody">${store.q ? searchHtml(p) : catHtml(p)}</div>
  </div>`;
}

function catHtml(p: Profile): string {
  switch (store.cat) {
    case 'featured': return featuredHtml(p);
    case 'bikes': return gridHtml(p, BIKE_ITEMS, [['all', 'All'], ...(Object.keys(CLASSES) as BikeClass[]).map((c) => [c, CLASSES[c].name] as [string, string])], (it, s) => s === 'all' || it.cls === s);
    case 'parts': return `<p class="muted small">Performance parts change how your bike rides. Fit them and level them up in Garage › Upgrades.</p>` + gridHtml(p, ITEMS.filter((i) => i.kind === 'part' && !i.free), [['all', 'All'], ...SLOTS.map((s) => [s.id, s.name] as [string, string])], (it, s) => s === 'all' || it.slot === s);
    case 'cosmetics': return `<p class="muted small">${icons.sparkle} Cosmetics change how your bike looks. No performance advantage.</p>` + gridHtml(p, ITEMS.filter((i) => COS_SUB.some(([, , k]) => k.includes(i.kind)) && !i.free), [['all', 'All'], ...COS_SUB.map(([id, n]) => [id, n] as [string, string])], (it, s) => s === 'all' || COS_SUB.find(([id]) => id === s)![2].includes(it.kind));
    case 'rider': return `<p class="muted small">Helmets and jerseys for your rider. Shoes, emotes and profile frames are coming later.</p>` + gridHtml(p, ITEMS.filter((i) => i.kind === 'rider' || i.kind === 'jersey'), [['all', 'All'], ['helmet', 'Helmets'], ['jersey', 'Jerseys & jackets'], ['hall', 'Hall jerseys']], (it, s) => s === 'all' || (s === 'helmet' ? !!it.rider?.helmet : s === 'hall' ? it.kind === 'jersey' : it.kind === 'rider' && !it.rider?.helmet));
    case 'gear': return gearHtml(p);
    case 'bundles': return bundlesHtml(p);
    case 'events': return eventsHtml(p);
    case 'hall': return hallHtml(p);
    case 'currency': return currencyHtml(p);
  }
}

const row = (title: string, icon: string, items: string, extra = '') => items ? `<section class="gx-sec"><h2 class="gx-h2">${icon} ${title}${extra}</h2><div class="gx-row-scroll">${items}</div></section>` : '';
const timer = (d: Date) => `<span class="gx-timer" data-countdown="${d.toISOString()}">${countdown(d)}</span>`;

function featuredHtml(p: Profile) {
  const r = rotation();
  const f = r.featured;
  const inside = (f.contains ?? []).map((id) => item(id)!).filter(Boolean);
  const lead = f.kind === 'bike' ? f : inside.find((x) => x.kind === 'bike');
  const save = f.kind === 'bundle' ? bundleValue(f) - (priceOf(f)?.coins ?? 0) : 0;
  const claimed = p.garage.daily === localDay();
  const gift = r.daily;
  const giftItem = gift.item ? item(gift.item) : undefined;
  const starter = !p.garage.starter ? `<div class="card gx-starter"><span class="gx-ico">${icons.gift}</span><span class="grow"><b>First Ride bundle: free</b><small class="muted">Crash helmets, a decal and 300 Rush Coins to get you going. Nothing in the store is needed to enjoy the game.</small></span><button class="btn btn-primary btn-sm" data-starter>Claim</button></div>` : '';
  const earn = ITEMS.filter((i) => i.unlock?.check && !owned(p, i.id) && !priceOf(i)).map((i) => [i, progress(p, i)!] as const).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).slice(0, 8);
  const wish = p.garage.wishlist.map((id) => item(id)).filter((x): x is Item => !!x);
  return `${starter}
    <button class="gx-banner" data-item="${f.id}" style="--rar:${RARITY[rarityOf(f)].color}">
      <div class="gx-banner-txt">
        <span class="gx-kick">${icons.flame} Featured${f.dropOnly ? ' · limited' : ''} · ends in ${timer(r.featuredEnds)}</span>
        <b>${esc(f.name)}</b>
        <span class="gx-incl">${inside.length ? inside.map((x) => esc(x.name)).join(' · ') : esc(f.blurb)}</span>
        <span class="gx-banner-price">${priceHtml(priceOf(f), 'big')}${save > 0 ? `<em>Save ${icons.coin}${fmt(save)}</em>` : ''}</span>
        <span class="btn btn-primary btn-sm">View collection</span>
      </div>
      <div class="gx-banner-art">${lead ? bikeSvg(bikeLook(lead)) : f.kind === 'bundle' ? bikeSvg(styleFor(p, p.bike, wornBy(inside))) : itemArt(f)}</div>
    </button>
    <div class="gx-duo">
      <div class="card gx-daily">
        <div class="row"><b>${icons.gift} Daily free item</b><span class="grow"></span>${claimed ? `<span class="muted small">Next in ${timer(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1))}</span>` : ''}</div>
        <div class="gx-daily-in"><span class="gx-daily-art">${giftItem ? itemArt(giftItem) : gift.coins ? `<span class="gx-ico">${icons.coin}</span>` : `<span class="gx-ico">${gift.gear?.helmets ? icons.helmet : fx.cup}</span>`}</span>
          <span class="grow"><b>${esc(gift.name)}</b><small class="muted">${claimed ? 'Claimed today' : 'Free today'}</small></span>
          ${claimed ? `<span class="gx-state on">${icons.check} Claimed</span>` : '<button class="btn btn-primary btn-sm" data-daily>Claim</button>'}</div>
      </div>
      <button class="card gx-drop" data-item="${r.drop.id}" style="--rar:${RARITY[rarityOf(r.drop)].color}">
        <div class="row"><b>${icons.bolt} Drop live</b><span class="grow"></span>${timer(r.dropEnds)}</div>
        <div class="gx-daily-in"><span class="gx-daily-art">${artFor(p, r.drop)}</span>
          <span class="grow"><b>${esc(r.drop.name)}</b>${rarityChip(rarityOf(r.drop))}<small class="muted">Only today</small></span>
          <span>${statusHtml(p, r.drop)}</span></div>
      </button>
    </div>
    ${row('New arrivals', icons.sparkle, r.fresh.map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join(''))}
    ${row('Ending soon', fx.hourglass, r.ending.slice(0, 8).map((e) => card(p, e.item, { art: artFor(p, e.item), sub: `Ends in ${timer(e.ends)}` })).join(''))}
    ${row('Bundles', fx.box, ITEMS.filter((i) => i.kind === 'bundle' && i.id !== 'bundle:first-ride' && status(p, i) !== 'gone').map((it) => card(p, it, { art: itemArt(it), sub: bundleSave(it) })).join(''))}
    ${row('Earn by playing', icons.trophy, earn.map(([it]) => card(p, it, { art: artFor(p, it), sub: esc(it.unlock!.text) })).join(''))}
    ${row('Your wishlist', icons.heart, wish.map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join(''))}
    <div id="stTrend"></div>
    <p class="muted small gx-fine">Rush Coins and Diamonds are for the game only: they can't be cashed out. The store never sells a win: skill matters most, and prize races use the same plain bike for everyone.</p>`;
}
/** the look a set of cosmetics gives your bike */
const wornBy = (items: Item[]) => Object.assign({}, ...items.map((x) => (x.kind === 'paint' ? { primary: x.color, secondary: x.color } : x.style ?? {})));
const bundleSave = (it: Item) => {
  const s = bundleValue(it) - (priceOf(it)?.coins ?? 0);
  return s > 0 ? `Save ${fmt(s)} coins` : `${(it.contains ?? []).length} items`;
};

function sortList(p: Profile, list: Item[]) {
  const val = (it: Item) => (priceOf(it)?.coins ?? 0) + (priceOf(it)?.diamonds ?? 0) * 25;
  const avail = (s: Status) => ({ limited: 0, available: 1, owned: 2, equipped: 2, locked: 3, soon: 4, gone: 5 })[s];
  const by: Record<string, (a: Item, b: Item) => number> = {
    featured: (a, b) => avail(status(p, a)) - avail(status(p, b)) || RARITY[a.rarity].rank - RARITY[b.rarity].rank,
    newest: (a, b) => (b.added ?? '').localeCompare(a.added ?? ''),
    cheap: (a, b) => (val(a) || 1e9) - (val(b) || 1e9),
    rating: (a, b) => (b.stats ? ratingOf(b.stats) : RARITY[b.rarity].rank) - (a.stats ? ratingOf(a.stats) : RARITY[a.rarity].rank),
    rarity: (a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank,
    ending: (a, b) => Number(!a.season && !a.dropOnly) - Number(!b.season && !b.dropOnly),
  };
  return [...list].sort(by[store.sort] ?? by.featured);
}

function filtersHtml() {
  return `<div class="gx-filters">
    <label><span>Sort</span><select id="stSort">${[['featured', 'Featured'], ['newest', 'Newest'], ['cheap', 'Cheapest'], ['rating', 'Highest rated'], ['rarity', 'Rarest'], ['ending', 'Ending soon']].map(([v, n]) => `<option value="${v}"${store.sort === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <label><span>Rarity</span><select id="stRar"><option value="all">All</option>${RARITIES.map((r) => `<option value="${r}"${store.rar === r ? ' selected' : ''}>${RARITY[r].name}</option>`).join('')}</select></label>
    <label class="gx-check"><input type="checkbox" id="stOwned"${store.hideOwned ? ' checked' : ''}> Hide owned</label>
  </div>`;
}

function gridHtml(p: Profile, all: Item[], subs: [string, string][], match: (it: Item, s: string) => boolean) {
  const s = subs.some(([id]) => id === store.sub) ? store.sub : 'all';
  let list = all.filter((it) => match(it, s) && (store.rar === 'all' || rarityOf(it) === store.rar) && !(store.hideOwned && owned(p, it.id)));
  list = sortList(p, list);
  return `${tabsHtml(subs, s, 'data-sub')}${filtersHtml()}
    <div class="gx-grid-cards">${list.map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join('') || '<p class="muted">Nothing matches these filters.</p>'}</div>`;
}

function searchHtml(p: Profile) {
  const words = store.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (it: Item) => `${it.name} ${it.blurb} ${kindName(it)} ${it.collection ?? ''} ${it.cls ? CLASSES[it.cls].name : ''} ${RARITY[it.rarity].name} ${it.slot ?? ''}`.toLowerCase();
  const list = sortList(p, ITEMS.filter((it) => it.id !== 'bundle:first-ride' && words.every((w) => hay(it).includes(w))));
  return `<p class="muted small">${list.length} result${list.length === 1 ? '' : 's'} for “${esc(store.q)}”</p>
    <div class="gx-grid-cards">${list.map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join('') || `<div class="card"><b>Nothing found</b><p class="muted small">Try “helmet”, “wheels”, “decal” or a bike type like “MTB”.</p></div>`}</div>`;
}

function gearHtml(p: Profile) {
  const g = p.gear;
  const list = ITEMS.filter((i) => i.kind === 'gear');
  return `<p class="muted small">Ride gear is used up on rides. Prize races never use it.</p>
    <div class="gx-gear-have card"><span>${icons.helmet} <b>${g.helmets}</b> helmets</span><span>${fx.wrench} <b>${g.repairKits}</b> repair kits</span><span>${fx.cup} <b>${g.energy}</b> energy drinks</span>
      <button class="fx-toggle${g.energyOn ? ' on' : ''}" id="stEnergy" aria-pressed="${g.energyOn}">${g.energyOn ? 'Drinks: use on rides' : 'Drinks: saving them'}</button></div>
    <div class="stack">${list.map((it) => `<div class="card gx-gear-row"><span class="gx-row-art">${itemArt(it)}</span><span class="grow"><b>${esc(it.name)}</b><small class="muted">${esc(it.blurb)}</small><small>You have ${count(p, it.id)}</small></span>
      <button class="btn btn-primary btn-sm" data-buy="${it.id}">${priceHtml(priceOf(it))}</button></div>`).join('')}</div>
    <button class="card gx-link-card" data-cat="parts">${icons.brake}<span class="grow"><b>Brakes are parts now</b><small class="muted">Rim and disc brakes are in Parts, and fit to each bike in the Garage.</small></span>${icons.arrow}</button>`;
}

function bundlesHtml(p: Profile) {
  const list = ITEMS.filter((i) => i.kind === 'bundle');
  return `<div class="stack">${list.map((it) => {
    const st = status(p, it);
    const inside = (it.contains ?? []).map((id) => item(id)!).filter(Boolean);
    const free = it.id === 'bundle:first-ride';
    return `<div class="card gx-bundle" style="--rar:${RARITY[rarityOf(it)].color}">
      <div class="gx-bundle-art">${itemArt(it)}</div>
      <div class="grow stack" style="gap:6px">
        <div class="row gx-wrap">${rarityChip(rarityOf(it))}${it.dropOnly ? `<span class="gx-state lim">${icons.flame} Limited</span>` : ''}</div>
        <b>${esc(it.name)}</b><p class="muted small">${esc(it.blurb)}</p>
        <ul class="gx-incl-list">${inside.map((x) => `<li>${owned(p, x.id) ? icons.check : '•'} ${esc(x.name)}${owned(p, x.id) ? ' <small class="muted">(owned)</small>' : ''}</li>`).join('')}${it.coins ? `<li>• ${fmt(it.coins)} Rush Coins</li>` : ''}</ul>
        ${free ? '' : `<p class="small">Worth ${icons.coin}${fmt(bundleValue(it))} on their own · <b class="gx-save">${bundleSave(it)}</b></p>`}
      </div>
      <div class="gx-bundle-buy">${free ? (p.garage.starter ? `<span class="gx-state on">${icons.check} Claimed</span>` : '<button class="btn btn-primary btn-sm" data-starter>Claim free</button>') : st === 'owned' ? `<span class="gx-state on">${icons.check} Owned</span>` : buyable(st) ? `<button class="btn btn-primary btn-sm" data-item="${it.id}">${priceHtml(priceOf(it))}</button>` : '<span class="gx-state lock">Back another week</span>'}</div>
    </div>`;
  }).join('')}</div>`;
}

function eventsHtml(p: Profile) {
  const seasonal = ITEMS.filter((i) => i.season);
  const live = seasonal.filter((i) => seasonState(i).on);
  const later = seasonal.filter((i) => !seasonState(i).on);
  const rewards = ITEMS.filter((i) => i.unlock?.source === 'event' || i.collection === 'events');
  const names = [...new Set(live.map((i) => i.season!.name))];
  const ends = live[0] ? seasonState(live[0]).ends : undefined;
  return `${live.length ? `<div class="card gx-season"><span class="gx-kick">${icons.events} ${esc(names.join(' & '))} shop</span><b>On now${ends ? ` · ends in ${timer(ends)}` : ''}</b><p class="muted small">After the event these leave the store until next year.</p></div>
      <div class="gx-grid-cards">${live.map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join('')}</div>` : '<div class="card"><b>No event shop open right now</b><p class="muted small">Freshers, Independence and Christmas each bring their own items.</p></div>'}
    ${row('Event rewards', icons.trophy, rewards.map((it) => card(p, it, { art: artFor(p, it), sub: esc(it.unlock?.text ?? '') })).join(''))}
    ${row('Coming back later', fx.calendar, later.map((it) => card(p, it, { art: artFor(p, it), sub: `${esc(it.season!.name)}` })).join(''))}`;
}

function hallHtml(p: Profile) {
  const mine = p.hall !== 'none' ? hallById(p.hall) : null;
  const of = (h: string) => ITEMS.filter((i) => i.hall === h);
  return `${mine ? `<div class="card gx-season" style="--hall:${mine.color}"><span class="gx-kick">${icons.home} Your hall</span><b>${esc(mine.name)} collection</b><p class="muted small">Your hall's jersey and decal are free. Your hall's bike edition unlocks when you complete Hall Week once (ride 10 km for your hall in a week).</p></div>
      <div class="gx-grid-cards">${of(mine.id).map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join('')}</div>` : '<div class="card"><b>Pick your hall in Profile</b><p class="muted small">Hall riders get their hall’s jersey and decal free, and can unlock the hall’s bike edition.</p></div>'}
    ${HALLS.filter((h) => h.id !== 'none' && h.id !== p.hall).map((h) => row(esc(h.name), `<span class="gx-dot" style="background:${h.color}"></span>`, of(h.id).map((it) => card(p, it, { art: artFor(p, it), sub: sub(it) })).join(''))).join('')}`;
}

function currencyHtml(p: Profile) {
  return `<div class="gx-cur">
    <div class="card stack"><div class="row">${icons.coin}<b>Rush Coins</b><span class="grow"></span><b>${fmt(p.coins)}</b></div>
      <p class="muted small">For bikes, upgrades, cosmetics, ride gear and event entries. Earn them on every ride, from challenges, missions and the daily reward.</p>
      <button class="btn btn-primary" id="stCoins">${icons.coin} Buy Rush Coins</button></div>
    <div class="card stack"><div class="row">${icons.diamond}<b>Diamonds</b><span class="grow"></span><b>${fmt(p.diamonds ?? 0)}</b></div>
      <p class="muted small">The rare currency, for special items like chrome paint and the Diamond Series. Earn them from treasure hunts, events and challenges.</p>
      <button class="btn btn-ghost" disabled>Buying diamonds: coming soon</button></div>
  </div>
  <p class="muted small gx-fine">Rush Coins and Diamonds are game currency only. They can't be cashed out or traded.</p>`;
}

/** wires the Store tab; returns a cleanup */
export function bindStore(root: HTMLElement): () => void {
  const p = P();
  const redraw = () => {
    const body = root.querySelector<HTMLElement>('#stBody');
    if (!body) return;
    body.innerHTML = store.q ? searchHtml(p) : catHtml(p);
    root.querySelectorAll('.gx-cats [data-cat]').forEach((b) => { const on = !store.q && (b as HTMLElement).dataset.cat === store.cat; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    root.querySelectorAll<HTMLElement>('.gx-wallet').forEach((w) => { w.outerHTML = wallet(p, false); });
    root.querySelectorAll<HTMLElement>('.coin-count').forEach((c) => { c.textContent = fmt(p.coins); });
    bindCommon(root);
    bindBody();
  };
  const bindBody = () => {
    const q = <T extends HTMLElement>(s: string) => root.querySelectorAll<T>(s);
    q('#stBody [data-item]').forEach((el) => el.addEventListener('click', () => productPage(el.dataset.item!, backToStore)));
    q('#stBody [data-sub]').forEach((el) => el.addEventListener('click', () => { store.sub = el.dataset.sub!; redraw(); }));
    q('#stBody [data-cat]').forEach((el) => el.addEventListener('click', () => { store.cat = el.dataset.cat as Cat; store.sub = 'all'; redraw(); }));
    q('#stBody [data-buy]').forEach((el) => el.addEventListener('click', () => buy(p, el.dataset.buy!, redraw)));
    q('#stBody [data-starter]').forEach((el) => el.addEventListener('click', () => claimStarter(p, redraw)));
    q('#stBody [data-daily]').forEach((el) => el.addEventListener('click', () => {
      const got = claimDaily(p);
      if (got) import('../money-ui').then((m) => m.notice(`${icons.gift} <b>Claimed:</b> ${esc(got)}`, 'ok', 4000));
      redraw();
    }));
    root.querySelector('#stSort')?.addEventListener('change', (e) => { store.sort = (e.target as HTMLSelectElement).value; redraw(); });
    root.querySelector('#stRar')?.addEventListener('change', (e) => { store.rar = (e.target as HTMLSelectElement).value as Rarity | 'all'; redraw(); });
    root.querySelector('#stOwned')?.addEventListener('change', (e) => { store.hideOwned = (e.target as HTMLInputElement).checked; redraw(); });
    root.querySelector('#stEnergy')?.addEventListener('click', () => { p.gear.energyOn = !p.gear.energyOn; saveProfile(p); redraw(); });
    root.querySelector('#stCoins')?.addEventListener('click', () => buyCoinsScreen(backToStore));
    void fillTrending(root);
  };
  root.querySelectorAll<HTMLElement>('.gx-cats [data-cat]').forEach((el) => el.addEventListener('click', () => {
    store.cat = el.dataset.cat as Cat;
    store.sub = 'all';
    store.q = '';
    const s = root.querySelector<HTMLInputElement>('#stSearch');
    if (s) s.value = '';
    redraw();
  }));
  let t = 0;
  root.querySelector('#stSearch')?.addEventListener('input', (e) => {
    clearTimeout(t);
    t = window.setTimeout(() => { store.q = (e.target as HTMLInputElement).value.trim(); redraw(); }, 160);
  });
  bindBody();
  const tick = startTicker();
  // admins' overrides arrive in the background; redraw if anything changed
  void loadStore().then((changed) => { if (changed && root.isConnected) redraw(); });
  void isAdmin().then((yes) => {
    const b = root.querySelector<HTMLElement>('#stAdmin');
    if (!yes || !b) return;
    b.hidden = false;
    b.addEventListener('click', () => adminScreen());
  });
  return () => { clearInterval(tick); clearTimeout(t); };
}

/** "Trending among riders": real wishlist counts when the backend has them */
async function fillTrending(root: HTMLElement) {
  const el = root.querySelector<HTMLElement>('#stTrend');
  if (!el) return;
  const rows = (await trending()).filter((r) => item(r.item_id) && r.riders >= 3);
  if (!rows.length || !el.isConnected) return;
  const p = P();
  el.innerHTML = row('Trending among riders', icons.flame, rows.map((r) => card(p, item(r.item_id)!, { art: artFor(p, item(r.item_id)!), sub: `${fmt(r.riders)} riders want this` })).join(''));
  el.querySelectorAll<HTMLElement>('[data-item]').forEach((b) => b.addEventListener('click', () => productPage(b.dataset.item!, backToStore)));
}

/** keeps every countdown on screen ticking */
function startTicker() {
  const tick = window.setInterval(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-countdown]');
    if (!els.length) return;
    const now = Date.now();
    els.forEach((el) => { el.textContent = countdown(new Date(el.dataset.countdown!), now); });
  }, 1000);
  return tick;
}

// ---------- product page ----------

export function productPage(id: string, back: () => void = backToStore) {
  const p = P();
  const it = item(id);
  if (!it) return back();
  const st = status(p, it);
  const r = rarityOf(it);
  const isBike = it.kind === 'bike';
  const inside = (it.contains ?? []).map((x) => item(x)!).filter(Boolean);
  const leadBike = isBike ? it : inside.find((x) => x.kind === 'bike');
  const visual = !it.gear && it.kind !== 'bell';
  const riderItem = !!it.rider;
  const ends = st === 'limited' ? (it.season ? seasonState(it).ends : it.dropOnly ? (rotation().drop.id === it.id ? rotation().dropEnds : rotation().featuredEnds) : undefined) : undefined;
  let info = '';
  if (isBike) {
    const s = owned(p, it.id) ? statsFor(p, it.id.slice(5)) : baseStats(it.id.slice(5));
    const mine = statsFor(p, p.bike);
    info = `<div class="row"><b>Performance</b><span class="grow"></span>${p.bike === it.id.slice(5) ? '' : `<small class="muted">Compared with your ${esc(item('bike:' + p.bike)?.name ?? '')}</small>`}</div>
      ${statBars(s, p.bike === it.id.slice(5) ? undefined : mine)}
      <p class="muted small">${esc(CLASSES[it.cls!].text)}</p>`;
  } else if (it.kind === 'part') {
    info = `<b>What it changes</b>
      <table class="gx-lvtable"><tr><th>Level</th><th>Bonus</th></tr>${[1, 3, MAX_LEVEL].map((lv) => `<tr><td>${['', 'I', 'II', 'III', 'IV', 'V'][lv]}</td><td>${Object.entries(partBonus(it, lv)).filter(([, v]) => v).map(([k, v]) => `+${Math.round(v! * 10) / 10} ${k}`).join(', ') || 'none'}</td></tr>`).join('')}</table>
      <p class="muted small">${esc(SLOTS.find((s) => s.id === it.slot)!.name)} part. Parts add at most +20 to any stat.</p>`;
  } else if (it.kind === 'bundle') {
    const save = bundleValue(it) - (priceOf(it)?.coins ?? 0);
    info = `<b>Includes</b><ul class="gx-incl-list">${inside.map((x) => `<li><span>${owned(p, x.id) ? icons.check : '•'} ${esc(x.name)}</span><small class="muted">${x.price?.coins ? `${icons.coin}${fmt(x.price.coins)}` : ''}</small></li>`).join('')}${it.coins ? `<li><span>• ${fmt(it.coins)} Rush Coins</span></li>` : ''}</ul>
      ${save > 0 ? `<p>Individual value ${icons.coin}${fmt(bundleValue(it))} · <b class="gx-save">Save ${fmt(save)} coins</b></p>` : ''}`;
  } else if (it.gear) {
    info = `<p>You have <b>${count(p, it.id)}</b>.</p>`;
  } else {
    info = `<p class="gx-cosmetic">${icons.sparkle} <b>Cosmetic</b> · No performance advantage.</p>`;
  }
  const wishOn = wished(p, it.id);
  const primary = it.id === 'bundle:first-ride'
    ? (p.garage.starter ? `<span class="gx-state on">${icons.check} Claimed</span>` : '<button class="btn btn-primary" data-act="starter">Claim free</button>')
    : st === 'equipped' ? `<button class="btn btn-ghost" disabled>${icons.check} Equipped</button>`
    : st === 'owned' ? (it.kind === 'bundle' ? `<button class="btn btn-ghost" disabled>${icons.check} Owned</button>` : `<button class="btn btn-primary" data-act="equip">${isBike ? 'Equip' : it.kind === 'part' ? 'Fit to my bike' : 'Use it'}</button>`)
    : buyable(st) ? `<button class="btn btn-primary" data-act="buy">${icons.cart} Buy now</button>`
    : '';
  const el = page({
    kicker: `${RARITY[r].name} · ${esc(kindName(it))}`, title: esc(it.name), back,
    stage: visual ? `${stageControls({ rider: riderItem ? true : undefined })}${isBike ? ratingHtml(ratingOf(it.stats!)) : ''}` : undefined,
    body: `<div class="gx-cols">
      <div class="card stack">
        <div class="row gx-wrap">${rarityChip(r)}${it.collection ? `<span class="badge">${esc(it.collection.replace(/-/g, ' '))}</span>` : ''}${it.unlock ? `<span class="badge">${esc(SOURCES[it.unlock.source])}</span>` : ''}</div>
        <p>${esc(it.blurb)}</p>
        ${info}
        ${!visual ? `<div class="gx-flat-art">${itemArt(it)}</div>` : ''}
      </div>
      <div class="card stack gx-buybox">
        ${st === 'locked' || st === 'soon' ? unlockHtml(p, it) || `<p class="muted">${esc(it.unlock?.text ?? 'Not in the store')}</p>` : ''}
        ${st === 'gone' ? `<p class="muted">${it.season ? `Back for ${esc(it.season.name)}${seasonState(it).starts ? ` (${seasonState(it).starts!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})` : ''}.` : 'Not in the store right now. Add it to your wishlist to keep an eye on it.'}</p>` : ''}
        ${buyable(st) || st === 'owned' || st === 'equipped' ? `<div class="gx-pricebig">${buyable(st) ? priceHtml(priceOf(it), 'big') : statusHtml(p, it, st)}</div>` : ''}
        ${ends ? `<p class="gx-lim">${icons.flame} Available for ${timer(ends)}</p>` : ''}
        ${buyable(st) ? `<p class="muted small">Your balance: ${priceHtml({ coins: p.coins })} ${priceOf(it)?.diamonds ? priceHtml({ diamonds: p.diamonds ?? 0 }) : ''}</p>` : ''}
        ${primary}
        <div class="two">
          ${it.gear || it.kind === 'bundle' ? '' : `<button class="btn btn-ghost" data-act="wish" aria-pressed="${wishOn}">${wishOn ? icons.heartFill : icons.heart} ${wishOn ? 'On wishlist' : 'Wishlist'}</button>`}
          ${isBike ? `<button class="btn btn-ghost" data-act="compare">${icons.compare} Compare</button>` : ''}
        </div>
        ${isBike && owned(p, it.id) ? `<button class="btn btn-link" data-act="garage">Open in Garage</button>` : ''}
      </div>
    </div>`,
  });
  const stage = el.querySelector<HTMLElement>('[data-stage]');
  if (stage) {
    const look = leadBike ? (owned(p, leadBike.id) ? styleFor(p, leadBike.id.slice(5)) : bikeLook(leadBike))
      : it.kind === 'paint' ? styleFor(p, p.bike, { primary: it.color! })
      : it.style ? styleFor(p, p.bike, it.style)
      : it.kind === 'part' || riderItem ? styleFor(p)
      : styleFor(p, p.bike, wornBy(inside));
    mountStage(stage, look);
    if (riderItem) {
      H().bike3d.refresh({ ...p, look: { ...p.look, ...(it.rider!.helmet ? { helmet: it.rider!.helmet, accessories: [...new Set([...p.look.accessories, 'helmet' as const])] } : { outfit: it.rider!.outfit ?? p.look.outfit, jersey: it.rider!.jersey ?? p.look.jersey }) } });
      H().bike3d.style(look);
      if (!stage.querySelector('[data-gx-rider].on')) stage.querySelector<HTMLElement>('[data-gx-rider]')?.click();
    }
  } else unmountStage();
  const again = () => productPage(id, back);
  el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'buy') buy(p, it.id, again, { garage: () => H().home('garage') });
    if (a === 'starter') claimStarter(p, again);
    if (a === 'equip') { applyItem(p, it.id); H().bike3d.refresh(); sfx.coin(); again(); }
    if (a === 'wish') { const onNow = toggleWish(p, it.id); void wish(it.id, onNow); again(); }
    if (a === 'compare') compareScreen(it.id.slice(5), again);
    if (a === 'garage') bikeDetail(it.id.slice(5), again);
  }));
  const tick = startTicker();
  const stopTick = () => { if (!el.isConnected) { clearInterval(tick); clearInterval(watch); } };
  const watch = window.setInterval(stopTick, 2000);
}

// ---------- admin ----------

/** store controls for LEGONRUSH admins (is_admin): schedule featured / drops / daily items and change prices */
export async function adminScreen() {
  if (!(await isAdmin())) return backToStore();
  await loadStore(true);
  const rows = scheduled();
  const ov = overrides();
  const opts = ITEMS.map((i) => `<option value="${i.id}">${esc(i.name)} (${i.id})</option>`).join('');
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  page({
    kicker: 'Admin', title: 'Store controls', back: backToStore,
    body: `<div class="card stack">
        <b>Schedule</b><p class="muted small">Scheduled items replace the automatic featured collection, limited drop or daily free item while they run. "Ending soon" adds an item to that row.</p>
        <div class="gx-admin-form">
          <label>Slot<select id="adSlot"><option value="featured">Featured</option><option value="drop">Limited drop</option><option value="daily">Daily free item</option><option value="ending">Ending soon</option></select></label>
          <label>Item<select id="adItem">${opts}</select></label>
          <label>Starts<input type="datetime-local" id="adFrom" value="${local(now)}"></label>
          <label>Ends<input type="datetime-local" id="adTo" value="${local(new Date(now.getTime() + 7 * 864e5))}"></label>
          <button class="btn btn-primary btn-sm" id="adAdd">Add</button>
        </div>
        <div class="stack">${rows.map((r) => `<div class="row gx-admin-row"><b>${esc(r.slot)}</b><span class="grow">${esc(item(r.item_id)?.name ?? r.item_id)}<small class="muted"> ${new Date(r.starts_at).toLocaleString('en-GB')} → ${new Date(r.ends_at).toLocaleString('en-GB')}</small></span><button class="btn btn-link" data-del="${r.id}">Remove</button></div>`).join('') || '<p class="muted small">Nothing scheduled: the store rotates on its own.</p>'}</div>
      </div>
      <div class="card stack">
        <b>Prices and availability</b><p class="muted small">Leave a price empty to use the game's own. Switched-off items can't be bought.</p>
        <div class="gx-admin-form">
          <label>Item<select id="ovItem">${opts}</select></label>
          <label>Coins<input type="number" min="0" id="ovCoins"></label>
          <label>Diamonds<input type="number" min="0" id="ovDia"></label>
          <label class="gx-check"><input type="checkbox" id="ovOff"> Switched off</label>
          <button class="btn btn-primary btn-sm" id="ovSave">Save</button>
        </div>
        <div class="stack">${ov.map((o) => `<div class="row gx-admin-row"><span class="grow">${esc(item(o.id)?.name ?? o.id)}</span><small>${o.price_coins != null ? `${fmt(o.price_coins)} coins ` : ''}${o.price_diamonds != null ? `${fmt(o.price_diamonds)} diamonds ` : ''}${o.disabled ? 'off' : ''}</small></div>`).join('') || '<p class="muted small">No changes.</p>'}</div>
      </div>
      <p class="muted small" id="adNote"></p>`,
  });
  const app = H().app;
  const note = (t: string) => { app.querySelector('#adNote')!.textContent = t; };
  const val = (s: string) => (app.querySelector(s) as HTMLInputElement).value;
  app.querySelector('#adAdd')!.addEventListener('click', async () => {
    try {
      await addRotation({ slot: val('#adSlot') as Slot, item_id: val('#adItem'), starts_at: new Date(val('#adFrom')).toISOString(), ends_at: new Date(val('#adTo')).toISOString() });
      void adminScreen();
    } catch (e) { note(`Couldn't save: ${(e as Error).message}`); }
  });
  app.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await removeRotation(Number(b.dataset.del)); void adminScreen(); } catch (e) { note(`Couldn't remove: ${(e as Error).message}`); }
  }));
  app.querySelector('#ovSave')!.addEventListener('click', async () => {
    const n = (s: string) => (val(s) === '' ? null : Math.max(0, Math.round(Number(val(s)))));
    try {
      await saveOverride({ id: val('#ovItem'), price_coins: n('#ovCoins'), price_diamonds: n('#ovDia'), disabled: (app.querySelector('#ovOff') as HTMLInputElement).checked, rarity: null, name: null });
      void adminScreen();
    } catch (e) { note(`Couldn't save: ${(e as Error).message}`); }
  });
}
