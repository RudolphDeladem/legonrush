// Buying: confirm with the balance before and after, a friendly "not enough coins" that points to
// gameplay first, and "purchase complete" with what to do next. Spending goes through inventory.spend().
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import type { Profile } from '../../state';
import { postActivity } from '../activity';
import { spend } from '../inventory';
import { H, esc, fmt } from '../host';
import { buyCoinsScreen } from '../money-ui';
import { CLASSES, RARITY, item, type Item } from './catalog';
import { itemArt } from './art';
import { applyItem, buyable, count, give, priceOf, rarityOf, status, touch } from './garage';
import { logPurchase } from './remote';
import { priceHtml, rarityChip, sheet } from './ui';
import { localDay, rotation } from './rotation';

export const kindName = (it: Item) => it.kind === 'bike' ? `${CLASSES[it.cls!].name} bike`
  : ({ part: 'Performance part', paint: 'Paint colour', finish: 'Paint finish', decal: 'Decal', wheel: 'Wheel design', tyre: 'Tyres', bars: 'Handlebars', seat: 'Saddle', grips: 'Grips & pedals', light: 'Lights', acc: 'Accessory', bell: 'Bell', rider: 'Rider item', jersey: 'Hall jersey', gear: 'Ride gear', bundle: 'Bundle' } as Record<string, string>)[it.kind] ?? 'Item';

/** what owning it does, in one line */
export function gotText(it: Item) {
  if (it.gear) return 'added to your ride gear';
  if (it.kind === 'bundle') return 'added to your Garage';
  if (it.kind === 'part') return 'added to Garage › Parts';
  if (it.kind === 'bike') return 'added to your Garage';
  if (it.kind === 'rider' || it.kind === 'jersey') return 'added to Garage › Customize › Rider';
  return 'added to Garage › Customize';
}

/**
 * Buy an item: shows the confirm sheet, spends, adds it and shows what's next.
 * after() runs once the sheet is closed after a purchase (to redraw the page).
 */
export function buy(p: Profile, id: string, after: () => void, next?: { garage?: () => void }) {
  const it = item(id);
  if (!it) return;
  const s = status(p, it);
  // the free starter bundle and the free daily item are claimed, not bought
  if (it.id === 'bundle:first-ride') return claimStarter(p, after);
  if (!buyable(s)) return;
  const price = priceOf(it) ?? {};
  const coins = price.coins ?? 0, dia = price.diamonds ?? 0;
  const shortC = Math.max(0, coins - p.coins), shortD = Math.max(0, dia - (p.diamonds ?? 0));
  const head = `<div class="gx-buy-head"><div class="gx-buy-art" style="--rar:${RARITY[rarityOf(it)].color}">${itemArt(it)}</div><div><b>${esc(it.name)}</b><span>${rarityChip(rarityOf(it))} ${esc(kindName(it))}</span></div></div>`;
  if (shortC || shortD) {
    const { el, close } = sheet(`<h2 class="gx-sheet-title">${shortC ? 'Not enough Rush Coins' : 'Not enough diamonds'}</h2>
      ${head}
      <div class="gx-ledger">
        <div><span>You need</span><b>${priceHtml(shortC ? { coins } : { diamonds: dia })}</b></div>
        <div><span>You have</span><b>${priceHtml(shortC ? { coins: p.coins } : { diamonds: p.diamonds ?? 0 })}</b></div>
        <div class="short"><span>You're short</span><b>${priceHtml(shortC ? { coins: shortC } : { diamonds: shortD })}</b></div>
      </div>
      <p class="muted small">${shortC ? 'Rides, races, daily challenges and missions all pay coins.' : 'Diamonds come from treasure hunts, events and challenges. Buying diamonds is coming soon.'}</p>
      <button class="btn btn-primary" data-go="challenges">${icons.target} Earn ${shortC ? 'coins' : 'diamonds'}: challenges</button>
      <button class="btn btn-ghost" data-go="missions">${icons.map} View missions</button>
      ${shortC ? '<button class="btn btn-link" data-go="coins">Buy Rush Coins</button>' : ''}
      <button class="btn btn-link" data-close>Cancel</button>`);
    el.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => {
      close();
      const go = b.dataset.go;
      if (go === 'challenges') H().home('challenges');
      else if (go === 'missions') void import('../missions').then((m) => m.missionsScreen(() => H().home('store')));
      else buyCoinsScreen(() => H().home('store'));
    }));
    return;
  }
  const { el, close } = sheet(`<h2 class="gx-sheet-title">Confirm purchase</h2>
    ${head}
    <div class="gx-ledger">
      <div><span>Price</span><b>${priceHtml(price)}</b></div>
      <div><span>Your balance</span><b>${priceHtml(coins ? { coins: p.coins } : { diamonds: p.diamonds ?? 0 })}</b></div>
      <div class="after"><span>After purchase</span><b>${priceHtml(coins ? { coins: p.coins - coins } : { diamonds: (p.diamonds ?? 0) - dia })}</b></div>
    </div>
    ${it.gear ? `<p class="muted small">You have ${count(p, it.id)} now.</p>` : ''}
    <div class="gx-sheet-row"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="gxConfirm">Confirm purchase</button></div>`);
  el.querySelector('#gxConfirm')!.addEventListener('click', () => {
    if (!buyable(status(p, it)) || !spend(p, price)) return close();
    give(p, it.id);
    touch(p);
    void logPurchase(it.id, price);
    if (it.kind === 'bike' && RARITY[it.rarity].rank >= 3) postActivity({ kind: 'badge', text: `got the ${RARITY[it.rarity].name} ${it.name}`, ref: it.id });
    if (RARITY[it.rarity].rank >= 2 || it.kind === 'bike') sfx.finish(); else sfx.coin();
    done(p, it, close, after, next);
  });
}

function done(p: Profile, it: Item, close: () => void, after: () => void, next?: { garage?: () => void }) {
  close();
  const canEquip = !it.gear && it.kind !== 'bundle';
  let leaving = false;
  const toGarage = () => { leaving = true; close2(); (next?.garage ?? (() => H().home('garage')))(); };
  const { el, close: close2 } = sheet(`<div class="gx-done">${icons.check}</div>
    <h2 class="gx-sheet-title center">Purchase complete</h2>
    <p class="center"><b>${esc(it.name)}</b> has been ${gotText(it)}${it.gear ? ` (you have ${count(p, it.id)})` : ''}.</p>
    ${canEquip ? `<button class="btn btn-primary" id="gxEquip">${it.kind === 'bike' ? 'Ride it now' : it.kind === 'part' ? 'Fit it to my bike' : 'Use it now'}</button>` : ''}
    ${it.gear ? '' : `<button class="btn btn-ghost" id="gxGarage">${icons.garage} View in Garage</button>`}
    <button class="btn btn-link" data-close>Continue shopping</button>`, '', () => { if (!leaving) after(); });
  el.querySelector('#gxEquip')?.addEventListener('click', () => {
    applyItem(p, it.id);
    H().bike3d.refresh();
    toGarage();
  });
  el.querySelector('#gxGarage')?.addEventListener('click', toGarage);
}

/** the free First Ride bundle, once per rider */
export function claimStarter(p: Profile, after: () => void) {
  if (p.garage.starter) return;
  p.garage.starter = true;
  give(p, 'bundle:first-ride');
  touch(p);
  sfx.finish();
  const it = item('bundle:first-ride')!;
  sheet(`<div class="gx-done">${icons.gift}</div><h2 class="gx-sheet-title center">Welcome gift claimed</h2>
    <p class="center">${(it.contains ?? []).map((x) => esc(item(x)?.name ?? x)).join(', ')} and ${fmt(it.coins ?? 0)} Rush Coins are yours.</p>
    <button class="btn btn-primary" data-close>Nice</button>`);
  after();
}

/** the store's free daily item: once a day */
export function claimDaily(p: Profile) {
  const today = localDay();
  if (p.garage.daily === today) return null;
  const gift = rotation().daily;
  let got = gift.name;
  if (gift.item && !count(p, gift.item)) give(p, gift.item);
  else if (gift.item) { p.coins += 50; got = `50 Rush Coins (you already own the ${gift.name})`; }
  if (gift.coins) p.coins += gift.coins;
  if (gift.gear) { p.gear.helmets += gift.gear.helmets ?? 0; p.gear.energy += gift.gear.energy ?? 0; p.gear.repairKits += gift.gear.repairKits ?? 0; }
  p.garage.daily = today;
  touch(p);
  sfx.coin();
  return got;
}

/** price line used by product pages */
export const priceLine = (it: Item) => priceHtml(priceOf(it), 'big');
