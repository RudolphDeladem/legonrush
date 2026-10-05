// Garage shop extras: repair kits, energy drinks, bike upgrades, paint, bells, lights and hall jerseys.
// garageScreen() in main.ts shows shopSections() and calls bindShop().
import { HALLS, bikeById, hallById } from '../data/campus';
import { SHOP, saveProfile, type Profile, type Upgrade } from '../state';
import { icons } from '../ui/icons';
import { sfx } from '../audio';
import { fx } from './icons';
import { esc, fmt, on } from './host';

/** What the next ride starts with. The lead passes these to Game.setUpgrades / setRideItems. */
export function rideSetup(p: Profile) {
  const g = p.gear;
  return {
    upgrades: { ...g.upgrades } as Record<Upgrade, number>,
    /** drink one energy drink this ride (longer boost) */
    energy: g.energyOn && g.energy > 0,
    repairKits: g.repairKits,
    /** cosmetics: bell id ('' none) and light colour ('' none) */
    bell: g.bell,
    light: SHOP.lights.find((l) => l.id === g.light)?.color ?? '',
  };
}

/** Uses up what a ride consumed: the energy drink it started with and the repair kits it used. Saves. */
export function useRideItems(p: Profile, used: { energy?: boolean; repairKits?: number }) {
  if (used.energy) p.gear.energy = Math.max(0, p.gear.energy - 1);
  if (used.repairKits) p.gear.repairKits = Math.max(0, p.gear.repairKits - used.repairKits);
  saveProfile(p);
}

/** the bike's colour with any paint job fitted */
export const bikePaint = (p: Profile) => SHOP.paints.find((x) => x.id === p.gear.paint)?.color ?? bikeById(p.bike).color;

const price = (n: number, p: Profile, attr: string) => `<button class="btn btn-primary btn-sm" ${attr} ${p.coins < n ? 'disabled' : ''}>${fmt(n)} ${icons.coin}</button>`;
const pips = (lv: number) => `<span class="fx-pips">${[1, 2, 3].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</span>`;
const UP_ICON: Record<Upgrade, string> = { speed: fx.speed, grip: fx.grip, boost: icons.bolt };

/** consumables: goes inside the Ride gear grid */
export function gearCards(p: Profile) {
  const g = p.gear;
  return `
    <div class="card gear-card">
      <div class="gear-ico">${fx.wrench}</div>
      <div class="grow"><h3>Repair kit</h3><p class="muted small">Fixes your bike after a crash when you have no helmet left, so the ride goes on.</p><p class="gear-have">You have <b>${g.repairKits}</b></p></div>
      <div class="gear-buy">${price(SHOP.repairKit.price, p, 'data-fx-buy="repair"')}</div>
    </div>
    <div class="card gear-card">
      <div class="gear-ico">${fx.cup}</div>
      <div class="grow"><h3>Energy drink</h3><p class="muted small">Your boost lasts longer for one ride. One is used when a ride starts.</p>
        <p class="gear-have">You have <b>${g.energy}</b> · <button class="fx-toggle${g.energyOn ? ' on' : ''}" data-fx-energy aria-pressed="${g.energyOn}">${g.energyOn ? 'Use on rides' : 'Saving them'}</button></p></div>
      <div class="gear-buy">${price(SHOP.energy.price, p, 'data-fx-buy="energy"')}</div>
    </div>`;
}

/** upgrades, paint, bells, lights and jerseys: goes after the Ride gear grid */
export function shopSections(p: Profile) {
  const g = p.gear;
  const hall = hallById(p.hall);
  const bike = bikeById(p.bike);
  return `
    <h2 class="shop-h">${fx.wrench} Upgrades</h2>
    <p class="muted small">Upgrades stay with you on every bike.</p>
    <div class="gear-grid">${SHOP.upgrades.map((u) => {
      const lv = g.upgrades[u.id] ?? 0;
      return `<div class="card gear-card${lv >= 3 ? ' owned' : ''}">
        <div class="gear-ico">${UP_ICON[u.id]}</div>
        <div class="grow"><h3>${esc(u.name)} ${pips(lv)}</h3><p class="muted small">${esc(u.text)}</p><p class="gear-have">Level <b>${lv}</b> of 3</p></div>
        <div class="gear-buy">${lv >= 3 ? `<span class="badge gold">${icons.check} Maxed</span>` : price(u.prices[lv], p, `data-fx-up="${u.id}"`)}</div>
      </div>`;
    }).join('')}</div>

    <h2 class="shop-h">${fx.palette} Bike colours</h2>
    <div class="fx-swatches">
      <button class="fx-swatch${g.paint ? '' : ' on'}" data-fx-paint=""><i style="background:${bike.color}"></i><b>${esc(bike.name)} colour</b><small>${g.paint ? 'Free' : 'Fitted'}</small></button>
      ${SHOP.paints.map((x) => {
        const own = g.paints.includes(x.id);
        return `<button class="fx-swatch${g.paint === x.id ? ' on' : ''}" data-fx-paint="${x.id}" ${!own && p.coins < x.price ? 'disabled' : ''}><i style="background:${x.color}"></i><b>${esc(x.name)}</b><small>${g.paint === x.id ? 'Fitted' : own ? 'Fit' : `${fmt(x.price)} ${icons.coin}`}</small></button>`;
      }).join('')}
    </div>

    <h2 class="shop-h">${icons.bell} Bell &amp; light</h2>
    <div class="gear-grid">
      ${SHOP.bells.map((x) => cosmetic(p, 'bell', x.id, icons.bell, x.name, x.text, x.price)).join('')}
      ${SHOP.lights.map((x) => cosmetic(p, 'light', x.id, fx.bulb, x.name, x.text, x.price, x.color)).join('')}
    </div>

    <h2 class="shop-h">${fx.shirt} Hall jerseys</h2>
    <p class="muted small">Ride in any hall's colours. Your own hall's jersey is free.</p>
    <div class="fx-swatches">${HALLS.filter((h) => h.id !== 'none').map((h) => {
      const own = h.id === p.hall || g.jerseys.includes(h.id);
      const worn = (p.look.jersey || hall.color) === h.color;
      return `<button class="fx-swatch jersey${worn ? ' on' : ''}" data-fx-jersey="${h.id}" ${!own && p.coins < SHOP.jersey.price ? 'disabled' : ''}><i style="background:${h.color}">${fx.shirt}</i><b>${esc(h.name)}</b><small>${worn ? 'Wearing' : own ? 'Wear' : `${fmt(SHOP.jersey.price)} ${icons.coin}`}</small></button>`;
    }).join('')}</div>`;
}

function cosmetic(p: Profile, kind: 'bell' | 'light', id: string, icon: string, name: string, text: string, cost: number, color?: string) {
  const owned = kind === 'bell' ? p.gear.bells : p.gear.lights;
  const fitted = p.gear[kind] === id;
  const action = fitted ? `<button class="btn btn-ghost btn-sm" data-fx-cos="${kind}:">Take off</button>`
    : owned.includes(id) ? `<button class="btn btn-ghost btn-sm" data-fx-cos="${kind}:${id}">Fit</button>`
    : price(cost, p, `data-fx-cos="${kind}:${id}"`);
  return `<div class="card gear-card${fitted ? ' owned' : ''}">
    <div class="gear-ico"${color ? ` style="color:${color === '#fff6d8' ? 'var(--ink)' : color}"` : ''}>${icon}</div>
    <div class="grow"><h3>${esc(name)}</h3><p class="muted small">${esc(text)}</p>${fitted ? `<p class="gear-have">${icons.check} Fitted</p>` : ''}</div>
    <div class="gear-buy">${action}</div>
  </div>`;
}

/** Wires the shop buttons; rerender redraws the garage. */
export function bindShop(p: Profile, rerender: () => void) {
  const pay = (n: number) => {
    if (p.coins < n) return false;
    p.coins -= n;
    return true;
  };
  const done = (big = false) => {
    saveProfile(p);
    if (big) sfx.finish(); else sfx.coin();
    rerender();
  };
  on('[data-fx-buy]', 'click', (_, el) => {
    const what = el.dataset.fxBuy;
    if (what === 'repair' && pay(SHOP.repairKit.price)) { p.gear.repairKits++; done(); }
    if (what === 'energy' && pay(SHOP.energy.price)) { p.gear.energy++; done(); }
  });
  on('[data-fx-energy]', 'click', () => { p.gear.energyOn = !p.gear.energyOn; saveProfile(p); rerender(); });
  on('[data-fx-up]', 'click', (_, el) => {
    const u = SHOP.upgrades.find((x) => x.id === el.dataset.fxUp)!;
    const lv = p.gear.upgrades[u.id] ?? 0;
    if (lv >= 3 || !pay(u.prices[lv])) return;
    p.gear.upgrades[u.id] = lv + 1;
    done(true);
  });
  on('[data-fx-paint]', 'click', (_, el) => {
    const id = el.dataset.fxPaint!;
    const x = SHOP.paints.find((c) => c.id === id);
    if (x && !p.gear.paints.includes(id)) {
      if (!pay(x.price)) return;
      p.gear.paints.push(id);
    }
    p.gear.paint = id;
    done(!!x);
  });
  on('[data-fx-cos]', 'click', (_, el) => {
    const [kind, id] = el.dataset.fxCos!.split(':') as ['bell' | 'light', string];
    const list = kind === 'bell' ? p.gear.bells : p.gear.lights;
    const item = (kind === 'bell' ? SHOP.bells : SHOP.lights).find((x) => x.id === id);
    if (item && !list.includes(id)) {
      if (!pay(item.price)) return;
      list.push(id);
    }
    p.gear[kind] = id;
    done();
  });
  on('[data-fx-jersey]', 'click', (_, el) => {
    const h = hallById(el.dataset.fxJersey!);
    if (h.id !== p.hall && !p.gear.jerseys.includes(h.id)) {
      if (!pay(SHOP.jersey.price)) return;
      p.gear.jerseys.push(h.id);
    }
    p.look = { ...p.look, jersey: h.id === p.hall ? '' : h.color, outfit: p.look.outfit === 'hoodie' ? 'jersey' : p.look.outfit };
    done();
  });
}
