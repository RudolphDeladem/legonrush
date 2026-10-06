// Garage tab: "what I own and how I use it". The bike you ride in 3D, its stats, and the way into
// bikes, customizing, upgrades, parts, loadouts and your collection. Buying lives in the Store tab.
import { registerTab } from './registry';
import { H, esc } from '../features/host';
import { icons } from '../ui/icons';
import { fx } from '../features/icons';
import { CLASSES, RARITY, SLOTS, bikeItem } from '../features/garage/catalog';
import { collectionCounts, fittedPart, partLevel, ratingOf, statsFor, styleFor, syncUnlocks, syncGear, upgradeCost } from '../features/garage/garage';
import { mountStage, stageControls, unmountStage } from '../features/garage/preview';
import { bindCommon, rarityChip, ratingHtml, statBars, wallet } from '../features/garage/ui';
import { bikesScreen, collectionScreen, customizeScreen, loadoutsScreen, partsScreen, upgradesScreen } from '../features/garage/screens';
import { openStore } from './store';
import { notice } from '../features/money-ui';

registerTab('garage', {
  render() {
    const p = H().profile();
    const it = bikeItem(p.bike);
    const s = statsFor(p);
    const c = collectionCounts(p);
    const upgradable = SLOTS.filter((x) => { const part = fittedPart(p, p.bike, x.id); const lv = partLevel(p, part.id); return lv < 5 && p.coins >= upgradeCost(part, lv); }).length;
    const saved = p.garage.loadouts.filter(Boolean).length;
    const brake = fittedPart(p, p.bike, 'brakes');
    const tile = (id: string, icon: string, label: string, sub: string, dot = '') => `<button class="gx-tile" data-open="${id}"><span class="gx-tile-ico">${icon}</span><b>${label}</b><small>${sub}</small>${dot}</button>`;
    return `<div class="gx gx-home">
      <div class="gx-head"><h1 class="title">Garage</h1><span class="grow"></span>${wallet(p, false)}</div>
      <p class="gx-tag">Your bike. Your style. Your setup.</p>
      <div class="gx-layout">
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
          <div class="card gx-statcard">
            <div class="row"><b>Performance</b><span class="grow"></span><button class="btn btn-link" data-open="upgrades">${fx.wrench} Upgrade</button></div>
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
          <button class="card gx-shoplink" data-open="store">
            <span class="gx-tile-ico">${icons.shop}</span>
            <span class="grow"><b>Garage shop</b><small class="muted">New bikes, parts and cosmetics in the Store</small></span>${icons.arrow}
          </button>
          <div class="card gx-gearcard">
            <div class="row"><b>Ride gear</b><span class="grow"></span><button class="btn btn-link" data-open="gear">Get more ${icons.arrow}</button></div>
            <div class="gx-gear-have">
              <span>${icons.helmet} <b>${p.gear.helmets}</b> helmets</span>
              <span>${fx.wrench} <b>${p.gear.repairKits}</b> repair kits</span>
              <span>${fx.cup} <b>${p.gear.energy}</b> drinks</span>
              <span>${icons.brake} ${esc(brake.name)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  },
  bind(root) {
    const p = H().profile();
    syncGear(p);
    // anything earned since last time (explorer bikes, treasure parts, hall editions...)
    const fresh = syncUnlocks(p);
    if (fresh.length) notice(`${icons.trophy} <b>Unlocked:</b> ${fresh.map((x) => `<span style="color:${RARITY[x.rarity].color}">${esc(x.name)}</span>`).join(', ')}. Find ${fresh.length > 1 ? 'them' : 'it'} in your collection.`, 'ok', 6000);
    mountStage(root.querySelector<HTMLElement>('[data-stage]')!, styleFor(p));
    bindCommon(root, () => H().home('garage'));
    const back = () => H().home('garage');
    root.querySelectorAll<HTMLElement>('[data-open]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.open;
      if (id === 'bikes') bikesScreen(back);
      if (id === 'customize') customizeScreen(p.bike, back);
      if (id === 'upgrades') upgradesScreen(p.bike, back);
      if (id === 'parts') partsScreen(back);
      if (id === 'loadouts') loadoutsScreen(back);
      if (id === 'collection') collectionScreen(back);
      if (id === 'store') openStore('featured');
      if (id === 'gear') openStore('gear');
    }));
    return () => unmountStage();
  },
});
