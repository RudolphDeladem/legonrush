// Garage tab: everything about your bike in one place. "My garage" is the bike you ride in 3D, its
// stats, today's free item, what you're close to unlocking and the way into bikes, customizing,
// upgrades, parts, loadouts and your collection. "Shop" is where you get new things (it used to be a
// separate Store tab; links to 'store' open it here).
import { registerTab } from './registry';
import { H, esc } from '../features/host';
import { icons } from '../ui/icons';
import { fx } from '../features/icons';
import { CLASSES, ITEMS, RARITY, SLOTS, bikeItem, type Item } from '../features/garage/catalog';
import { collectionCounts, fittedPart, owned, partLevel, priceOf, progress, ratingOf, statsFor, styleFor, syncUnlocks, syncGear, upgradeCost } from '../features/garage/garage';
import { mountStage, stageControls, unmountStage } from '../features/garage/preview';
import { bindCommon, rarityChip, ratingHtml, statBars, wallet } from '../features/garage/ui';
import { bikesScreen, collectionScreen, customizeScreen, loadoutsScreen, partsScreen, upgradesScreen } from '../features/garage/screens';
import { bindStore, storeHtml, store, type Cat } from '../features/garage/store-ui';
import { claimDaily } from '../features/garage/buy';
import { itemArt } from '../features/garage/art';
import { localDay, rotation } from '../features/garage/rotation';
import { notice } from '../features/money-ui';

let view: 'mine' | 'shop' = 'mine';
/** what the next Garage render shows (main.ts sends 'store' links here as 'shop') */
export function setGarageView(v: 'mine' | 'shop') { view = v; }

/** opens the Garage's shop at a category */
export function openStore(cat: Cat = 'featured', q = '') {
  store.cat = cat;
  store.sub = 'all';
  store.q = q;
  H().home('store');
}

/** the earnable item the rider is closest to */
function nextUnlock(): { it: Item; at: number; goal: number } | null {
  const p = H().profile();
  const list = ITEMS.filter((i) => i.unlock?.check && !owned(p, i.id) && !priceOf(i))
    .map((it) => { const [at, goal] = progress(p, it)!; return { it, at: Math.min(at, goal), goal }; })
    .filter((x) => x.goal > 0 && x.at < x.goal)
    .sort((a, b) => b.at / b.goal - a.at / a.goal);
  return list[0] ?? null;
}

function mine() {
  const p = H().profile();
  const it = bikeItem(p.bike);
  const s = statsFor(p);
  const c = collectionCounts(p);
  const upgradable = SLOTS.filter((x) => { const part = fittedPart(p, p.bike, x.id); const lv = partLevel(p, part.id); return lv < 5 && p.coins >= upgradeCost(part, lv); }).length;
  const saved = p.garage.loadouts.filter(Boolean).length;
  const brake = fittedPart(p, p.bike, 'brakes');
  const r = rotation();
  const claimed = p.garage.daily === localDay();
  const giftItem = r.daily.item ? ITEMS.find((x) => x.id === r.daily.item) : undefined;
  const nu = nextUnlock();
  const tile = (id: string, icon: string, label: string, sub: string, dot = '') => `<button class="gx-tile" data-open="${id}"><span class="gx-tile-ico">${icon}</span><b>${label}</b><small>${sub}</small>${dot}</button>`;
  return `<div class="gx-layout">
      <section class="gx-stage big" data-stage>
        ${stageControls()}
        <div class="gx-plate">
          <span class="gx-eq">${icons.check} Equipped</span>
          <h2>${esc(it.name)}</h2>
          <p>${rarityChip(it.rarity)} <span>${CLASSES[it.cls!].name} bike</span></p>
        </div>
        ${ratingHtml(ratingOf(s))}
      </section>
      <div class="gx-side">
        <div class="gx-today">
          <div class="card gx-mini">
            <span class="gx-mini-art">${giftItem ? itemArt(giftItem) : `<span class="gx-ico">${r.daily.coins ? icons.coin : icons.gift}</span>`}</span>
            <span class="grow"><small>Free today</small><b>${esc(r.daily.name)}</b></span>
            ${claimed ? `<span class="gx-state on">${icons.check} Claimed</span>` : `<button class="btn btn-primary btn-sm" data-gdaily>Claim</button>`}
          </div>
          ${nu ? `<button class="card gx-mini" data-shopq="${esc(nu.it.name)}">
            <span class="gx-mini-art">${itemArt(nu.it)}</span>
            <span class="grow"><small>Almost yours</small><b>${esc(nu.it.name)}</b><span class="gx-prog"><i style="width:${Math.round((nu.at / nu.goal) * 100)}%"></i></span><small>${esc(nu.it.unlock!.text)}</small></span>
          </button>` : ''}
        </div>
        <div class="card gx-statcard">
          <div class="row"><b>Performance</b><span class="grow"></span><button class="btn btn-link" data-open="upgrades">${fx.wrench} Upgrade${upgradable ? ` · ${upgradable} ready` : ''}</button></div>
          ${statBars(s)}
        </div>
        <div class="gx-tiles">
          ${tile('bikes', icons.bike, 'Bikes', `${c.bikes} of ${c.bikesTotal} owned`)}
          ${tile('customize', fx.palette, 'Customize', 'Colours, decals, lights')}
          ${tile('upgrades', fx.wrench, 'Upgrades', upgradable ? `${upgradable} ready to upgrade` : 'Levels I to V', upgradable ? `<em class="fx-dot">${upgradable}</em>` : '')}
          ${tile('parts', icons.cog, 'Parts', 'Your parts box')}
          ${tile('loadouts', icons.layers, 'Loadouts', saved ? `${saved} of 3 saved` : 'Save 3 setups')}
          ${tile('collection', fx.medal, 'Collection', `${c.items} of ${c.itemsTotal} items`)}
        </div>
        <div class="card gx-gearcard">
          <div class="row"><b>Ride gear</b><span class="grow"></span><button class="btn btn-link" data-shopcat="gear">Get more ${icons.arrow}</button></div>
          <div class="gx-gear-have">
            <span>${icons.helmet} <b>${p.gear.helmets}</b> helmets</span>
            <span>${fx.wrench} <b>${p.gear.repairKits}</b> repair kits</span>
            <span>${fx.cup} <b>${p.gear.energy}</b> drinks</span>
            <span>${icons.brake} ${esc(brake.name)}</span>
          </div>
        </div>
        <button class="card gx-shoplink" data-shopcat="featured">
          <span class="gx-tile-ico">${icons.shop}</span>
          <span class="grow"><b>This week in the shop</b><small class="muted">${esc(r.featured.name)} · drop: ${esc(r.drop.name)}</small></span>${icons.arrow}
        </button>
      </div>
    </div>`;
}

registerTab('garage', {
  render() {
    const p = H().profile();
    return `<div class="gx gx-home gx-merged">
      <div class="gx-head"><h1 class="title">Garage</h1><span class="grow"></span>${wallet(p, false)}</div>
      <p class="gx-tag">Your bike, your style, your setup, and everything you can get next.</p>
      <div class="seg wide gx-views" role="tablist">
        <button class="${view === 'mine' ? 'on' : ''}" data-gview="mine" role="tab">${icons.bike} My garage</button>
        <button class="${view === 'shop' ? 'on' : ''}" data-gview="shop" role="tab">${icons.shop} Shop</button>
      </div>
      ${view === 'mine' ? mine() : storeHtml(p, true)}
    </div>`;
  },
  bind(root) {
    const p = H().profile();
    const back = () => H().home('garage');
    root.querySelectorAll<HTMLElement>('[data-gview]').forEach((el) => el.addEventListener('click', () => {
      if (view === el.dataset.gview) return;
      view = el.dataset.gview as 'mine' | 'shop';
      if (view === 'shop') { store.q = ''; }
      H().home('garage');
    }));
    if (view === 'shop') {
      unmountStage();
      bindCommon(root, back);
      return bindStore(root);
    }
    syncGear(p);
    // anything earned since last time (explorer bikes, treasure parts, hall editions...)
    const fresh = syncUnlocks(p);
    if (fresh.length) notice(`${icons.trophy} <b>Unlocked:</b> ${fresh.map((x) => `<span style="color:${RARITY[x.rarity].color}">${esc(x.name)}</span>`).join(', ')}. Find ${fresh.length > 1 ? 'them' : 'it'} in your collection.`, 'ok', 6000);
    mountStage(root.querySelector<HTMLElement>('[data-stage]')!, styleFor(p));
    bindCommon(root, back);
    root.querySelector('[data-gdaily]')?.addEventListener('click', () => {
      const got = claimDaily(p);
      if (got) notice(`${icons.gift} <b>Claimed:</b> ${esc(got)}`, 'ok', 4000);
      H().home('garage');
    });
    root.querySelectorAll<HTMLElement>('[data-shopcat]').forEach((el) => el.addEventListener('click', () => openStore(el.dataset.shopcat as Cat)));
    root.querySelectorAll<HTMLElement>('[data-shopq]').forEach((el) => el.addEventListener('click', () => openStore('featured', el.dataset.shopq)));
    root.querySelectorAll<HTMLElement>('[data-open]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.open;
      if (id === 'bikes') bikesScreen(back);
      if (id === 'customize') customizeScreen(p.bike, back);
      if (id === 'upgrades') upgradesScreen(p.bike, back);
      if (id === 'parts') partsScreen(back);
      if (id === 'loadouts') loadoutsScreen(back);
      if (id === 'collection') collectionScreen(back);
    }));
    return () => unmountStage();
  },
});
