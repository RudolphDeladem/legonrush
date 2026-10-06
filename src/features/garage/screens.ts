// Garage screens: bikes, bike details, compare, customize, upgrades, parts, loadouts, collection and item details.
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import type { Profile } from '../../state';
import { H, esc, fmt } from '../host';
import { fx } from '../icons';
import {
  BIKE_ITEMS, CLASSES, DECAL_GROUPS, ITEMS, MAX_LEVEL, RARITY, SLOTS, STATS, bikeItem, bikeLook, item,
  type BikeClass, type Item, type Kind, type PartSlot,
} from './catalog';
import { bikeSvg, itemArt } from './art';
import {
  applyItem, baseStats, buyable, clearLoadout, collectionCounts, count, equipBike, equipped, fitPart, fittedPart, owned,
  palette, partBonus, partLevel, partsFor, priceOf, rarityOf, ratingOf, resetLook, saveLoadout, sell, sellValue, setColor,
  status, statsFor, styleFor, touch, upgradeCost, upgradePart, useLoadout,
} from './garage';
import { buy, kindName } from './buy';
import { mountStage, stageControls, stageFlash } from './preview';
import { card, page, priceHtml, rarityChip, ratingHtml, sheet, statBars, statusHtml, tabsHtml, unlockHtml } from './ui';
import type { BikeStyle } from '../../game/models';

const P = () => H().profile();
const toGarage = () => H().home('garage');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const bikeName = (id: string) => bikeItem(id).name;
const bikeArt = (p: Profile, it: Item) => bikeSvg(owned(p, it.id) ? styleFor(p, it.id.slice(5)) : bikeLook(it));
const bonusText = (b: Partial<Record<string, number>>) => Object.entries(b).filter(([, v]) => v).map(([k, v]) => `+${Math.round(v! * 10) / 10} ${STATS.find((s) => s.id === k)!.name}`).join(' · ') || 'No bonus';
export const storeLink = (id: string) => void import('./store-ui').then((m) => m.productPage(id, () => H().home('garage')));

// ---------- bikes ----------

let bikeFilter: 'all' | 'owned' | 'locked' | BikeClass = 'all';
export function bikesScreen(back: () => void = toGarage) {
  const p = P();
  const list = BIKE_ITEMS.filter((b) => bikeFilter === 'all' || (bikeFilter === 'owned' ? owned(p, b.id) : bikeFilter === 'locked' ? !owned(p, b.id) : b.cls === bikeFilter))
    .sort((a, b) => Number(owned(p, b.id)) - Number(owned(p, a.id)) || RARITY[a.rarity].rank - RARITY[b.rarity].rank);
  const n = BIKE_ITEMS.filter((b) => owned(p, b.id)).length;
  page({
    kicker: 'Garage', title: 'Bikes', back,
    body: `<p class="muted">${n} of ${BIKE_ITEMS.length} bikes owned. Each type rides differently: pick the one that suits the ride.</p>
      ${tabsHtml([['all', 'All'], ['owned', 'Owned'], ['locked', 'Locked'], ...(Object.keys(CLASSES) as BikeClass[]).map((c) => [c, CLASSES[c].name] as [string, string])], bikeFilter, 'data-bf')}
      <div class="gx-grid-cards">${list.map((b) => card(p, b, { art: bikeArt(p, b), sub: `${CLASSES[b.cls!].name} · Rating ${ratingOf(owned(p, b.id) ? statsFor(p, b.id.slice(5)) : b.stats!)}`, attr: `data-bike="${b.id.slice(5)}"` })).join('')}</div>`,
  });
  on('[data-bf]', (el) => { bikeFilter = el.dataset.bf as typeof bikeFilter; bikesScreen(back); });
  on('[data-bike]', (el) => bikeDetail(el.dataset.bike!, () => bikesScreen(back)));
}

export function bikeDetail(id: string, back: () => void = toGarage) {
  const p = P();
  const it = bikeItem(id);
  const mine = owned(p, it.id);
  const s = mine ? statsFor(p, id) : baseStats(id);
  const st = status(p, it);
  const sv = sellValue(p, it);
  const el = page({
    kicker: `${RARITY[rarityOf(it)].name} · ${CLASSES[it.cls!].name} bike`, title: esc(it.name), back,
    stage: `${stageControls()}${ratingHtml(ratingOf(s))}`,
    body: `<div class="gx-cols">
      <div class="card stack">
        <p>${esc(it.blurb)}</p>
        <p class="muted small">${esc(CLASSES[it.cls!].text)}</p>
        ${statBars(s)}
        ${mine ? '' : '<p class="muted small">Stats shown with stock parts. Parts you own can be fitted after.</p>'}
      </div>
      <div class="card stack">
        <div class="row">${rarityChip(rarityOf(it))}<span class="grow"></span>${statusHtml(p, it, st)}</div>
        ${mine ? `
          ${p.bike === id ? `<button class="btn btn-ghost" disabled>${icons.check} Equipped</button>` : `<button class="btn btn-primary" data-act="equip">${icons.bike} Equip</button>`}
          <div class="two"><button class="btn btn-ghost" data-act="customize">${fx.palette} Customize</button><button class="btn btn-ghost" data-act="upgrade">${fx.wrench} Upgrade</button></div>`
        : buyable(st) ? `<button class="btn btn-primary" data-act="buy">Buy · ${priceHtml(priceOf(it))}</button>` : unlockHtml(p, it) || `<p class="muted small">${it.season ? `On sale during ${esc(it.season.name)}.` : 'Not in the store right now.'}</p>`}
        ${p.bike === id ? '' : `<button class="btn btn-ghost" data-act="compare">${icons.compare} Compare with ${esc(bikeName(p.bike))}</button>`}
        ${!mine && buyable(st) ? `<button class="btn btn-link" data-act="store">Open in Store</button>` : ''}
        ${sv ? `<button class="btn btn-link" data-act="sell">Sell for ${fmt(sv)} coins</button>` : ''}
      </div>
    </div>`,
  });
  mountStage(el.querySelector('[data-stage]')!, mine ? styleFor(p, id) : bikeLook(it));
  const again = () => bikeDetail(id, back);
  on('[data-act]', (b) => {
    const a = b.dataset.act;
    if (a === 'equip') { equipBike(p, id); H().bike3d.refresh(); sfx.coin(); again(); }
    if (a === 'customize') customizeScreen(id, again);
    if (a === 'upgrade') upgradesScreen(id, again);
    if (a === 'compare') compareScreen(id, again);
    if (a === 'buy') buy(p, it.id, again, { garage: again });
    if (a === 'store') storeLink(it.id);
    if (a === 'sell') sellSheet(p, it, again);
  });
}

export function compareScreen(id: string, back: () => void) {
  const p = P();
  const a = bikeItem(p.bike), b = bikeItem(id);
  const sa = statsFor(p, p.bike);
  const sb = owned(p, b.id) ? statsFor(p, id) : baseStats(id);
  const ra = ratingOf(sa), rb = ratingOf(sb);
  const up = STATS.filter((x) => sb[x.id] > sa[x.id]).length, down = STATS.filter((x) => sb[x.id] < sa[x.id]).length;
  page({
    kicker: 'Compare', title: `${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)}`, back,
    body: `<div class="gx-vs">
        <div class="card gx-vs-card"><small class="muted">Current bike</small>${bikeSvg(styleFor(p, p.bike))}<b>${esc(a.name)}</b>${ratingHtml(ra)}</div>
        <div class="card gx-vs-card"><small class="muted">${owned(p, b.id) ? 'Your' : 'New'} bike</small>${bikeArt(p, b)}<b>${esc(b.name)}</b>${ratingHtml(rb)}</div>
      </div>
      <div class="card stack">
        <div class="row"><b>${esc(b.name)} compared with ${esc(a.name)}</b></div>
        ${statBars(sb, sa)}
        <p class="muted small"><span class="gx-key up"></span> Better: ${up} &nbsp; <span class="gx-key down"></span> Worse: ${down} &nbsp; <span class="gx-key same"></span> Same: ${STATS.length - up - down}</p>
      </div>
      ${owned(p, b.id) ? `<button class="btn btn-primary" id="eq">${icons.bike} Equip ${esc(b.name)}</button>` : `<button class="btn btn-primary" id="get">${buyable(status(p, b)) ? `Buy · ${priceHtml(priceOf(b))}` : 'How to get it'}</button>`}`,
  });
  H().app.querySelector('#eq')?.addEventListener('click', () => { equipBike(p, id); H().bike3d.refresh(); sfx.coin(); toGarage(); });
  H().app.querySelector('#get')?.addEventListener('click', () => (buyable(status(p, b)) ? buy(p, b.id, () => compareScreen(id, back)) : bikeDetail(id, back)));
}

// ---------- customize ----------

type CTab = 'colours' | 'finish' | 'decals' | 'wheels' | 'parts' | 'lights' | 'extras' | 'rider';
let cTab: CTab = 'colours';
let cSlot: 'primary' | 'secondary' | 'accent' = 'primary';
let decalGroup = 'All';
export function customizeScreen(bikeId = P().bike, back: () => void = toGarage) {
  const p = P();
  if (!owned(p, 'bike:' + bikeId)) bikeId = p.bike;
  const s = styleFor(p, bikeId);
  const opt = (it: Item, active: boolean) => {
    const own = owned(p, it.id);
    const st = status(p, it);
    return `<button class="gx-opt${active ? ' on' : ''}${own ? '' : ' locked'}" data-opt="${it.id}" style="--rar:${RARITY[rarityOf(it)].color}" aria-pressed="${active}">
      <span class="gx-opt-art">${itemArt(it)}</span><b>${esc(it.name)}</b>
      <small>${active ? `${icons.check} On` : own ? 'Owned' : buyable(st) ? priceHtml(priceOf(it)) : `${icons.lock} ${st === 'gone' ? 'Not on sale' : 'Locked'}`}</small></button>`;
  };
  const kinds: Record<CTab, Kind[]> = { colours: ['paint'], finish: ['finish'], decals: ['decal'], wheels: ['wheel', 'tyre'], parts: ['bars', 'seat', 'grips'], lights: ['light'], extras: ['acc', 'bell'], rider: ['rider', 'jersey'] };
  const isOn = (it: Item) => it.kind === 'paint' ? s[cSlot].toLowerCase() === it.color!.toLowerCase() : it.kind === 'light' ? (it.id === 'light:none' ? !s.light : s.light.toLowerCase() === (it.style!.light ?? '').toLowerCase() && s.glow === it.style!.glow) : equipped(p, it, bikeId);
  let options = ITEMS.filter((i) => kinds[cTab].includes(i.kind));
  if (cTab === 'decals' && decalGroup !== 'All') options = options.filter((i) => i.collection === decalGroup.toLowerCase());
  // owned first, then what you can buy, then the rest
  const rank = (it: Item) => (owned(p, it.id) ? 0 : buyable(status(p, it)) ? 1 : 2);
  options.sort((a, b) => rank(a) - rank(b));
  const pal = palette(p, bikeId);
  let body = '';
  if (cTab === 'colours') {
    body = `${tabsHtml([['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent']], cSlot, 'data-slot')}
      <p class="muted small">${cSlot === 'primary' ? 'The main frame.' : cSlot === 'secondary' ? 'Fork and rear stays (and the bag on a rack).' : 'Rims, hubs, grips, pedals and chain.'}</p>
      <div class="gx-colors">${pal.map((c) => `<button class="gx-color${s[cSlot].toLowerCase() === c.color.toLowerCase() ? ' on' : ''}" data-color="${c.color}" aria-label="${esc(c.name)}"><i style="background:${c.color}"></i><small>${esc(c.name)}</small></button>`).join('')}</div>
      <h3 class="gx-h3">More colours</h3>
      <div class="gx-opts">${options.filter((i) => !owned(p, i.id)).map((i) => opt(i, false)).join('')}</div>
      <button class="btn btn-link" id="reset">Back to the original design</button>`;
  } else {
    body = `${cTab === 'decals' ? tabsHtml(['All', ...DECAL_GROUPS].map((g) => [g, g]), decalGroup, 'data-dg') : ''}
      ${cTab === 'rider' ? '<p class="muted small">Helmets and jerseys for your rider. Body, skin and other accessories are in Profile › Dress rider.</p>' : ''}
      ${cTab === 'wheels' ? '<p class="muted small">Wheel looks are cosmetic. Faster wheels are performance parts, in Upgrades.</p>' : ''}
      <div class="gx-opts">${options.map((i) => opt(i, isOn(i))).join('')}</div>`;
  }
  const TABS: [CTab, string][] = [['colours', 'Colours'], ['finish', 'Finish'], ['decals', 'Decals'], ['wheels', 'Wheels'], ['parts', 'Bars & saddle'], ['lights', 'Lights'], ['extras', 'Accessories'], ['rider', 'Rider']];
  const el = page({
    kicker: `Customize · ${esc(bikeName(bikeId))}`, title: 'Customize', back, cls: 'gx-custom',
    stage: stageControls({ angles: true }),
    body: `<p class="muted small gx-note">${icons.sparkle} Looks only: customizing never changes performance. Saved for this bike.</p>
      ${tabsHtml(TABS, cTab, 'data-ct')}
      <div class="gx-cbody">${body}</div>
      <div class="gx-try" id="try" hidden></div>`,
  });
  const stage = el.querySelector<HTMLElement>('[data-stage]')!;
  const restyle = mountStage(stage, s);
  if (cTab === 'rider') stage.querySelector<HTMLElement>('[data-gx-rider]:not(.on)')?.click();
  const again = () => {
    const y = el.scrollTop;
    customizeScreen(bikeId, back);
    H().app.querySelector('.gx-page')!.scrollTop = y;
  };
  on('[data-ct]', (b) => { cTab = b.dataset.ct as CTab; again(); });
  on('[data-slot]', (b) => { cSlot = b.dataset.slot as typeof cSlot; again(); });
  on('[data-dg]', (b) => { decalGroup = b.dataset.dg!; again(); });
  on('[data-color]', (b) => { setColor(p, bikeId, cSlot, b.dataset.color!); syncRide(p, bikeId); again(); });
  H().app.querySelector('#reset')?.addEventListener('click', () => { resetLook(p, bikeId); syncRide(p, bikeId); again(); });
  on('[data-opt]', (b) => {
    const it = item(b.dataset.opt!)!;
    if (owned(p, it.id)) {
      applyItem(p, it.id, bikeId, cSlot);
      syncRide(p, bikeId);
      sfx.coin();
      return again();
    }
    // try it on before buying
    const tryPanel = H().app.querySelector<HTMLElement>('#try')!;
    const draft: Partial<BikeStyle> = it.kind === 'paint' ? { [cSlot]: it.color } : { ...it.style };
    if (it.rider) H().bike3d.refresh({ ...p, look: { ...p.look, ...(it.rider.helmet ? { helmet: it.rider.helmet, accessories: [...new Set([...p.look.accessories, 'helmet' as const])] } : { outfit: it.rider.outfit ?? p.look.outfit, jersey: it.rider.jersey ?? p.look.jersey }) } });
    else restyle(styleFor(p, bikeId, draft));
    const st = status(p, it);
    tryPanel.hidden = false;
    tryPanel.innerHTML = `<span class="gx-try-art">${itemArt(it)}</span><span class="grow"><small>Previewing</small><b>${esc(it.name)}</b>${buyable(st) ? '' : `<small>${esc(it.unlock?.text ?? (it.season ? `On sale during ${it.season.name}` : 'Not in the store right now'))}</small>`}</span>
      ${buyable(st) ? `<button class="btn btn-primary btn-sm" id="tryBuy">${priceHtml(priceOf(it))}</button>` : ''}<button class="btn btn-ghost btn-sm" id="tryOff" aria-label="Stop preview">${icons.close}</button>`;
    tryPanel.querySelector('#tryBuy')?.addEventListener('click', () => buy(p, it.id, () => { applyItem(p, it.id, bikeId, cSlot); syncRide(p, bikeId); again(); }, { garage: again }));
    tryPanel.querySelector('#tryOff')!.addEventListener('click', () => { tryPanel.hidden = true; H().bike3d.refresh(); restyle(styleFor(p, bikeId)); });
  });
}
/** the bike being ridden also shows on the menus behind; keep it in step */
const syncRide = (p: Profile, bikeId: string) => { if (bikeId === p.bike) H().bike3d.refresh(); };

// ---------- upgrades and parts ----------

export function upgradesScreen(bikeId = P().bike, back: () => void = toGarage) {
  const p = P();
  if (!owned(p, 'bike:' + bikeId)) bikeId = p.bike;
  const s = statsFor(p, bikeId);
  const rows = SLOTS.map((slot) => {
    const it = fittedPart(p, bikeId, slot.id);
    const lv = partLevel(p, it.id);
    const cost = lv < MAX_LEVEL ? upgradeCost(it, lv) : 0;
    const choices = partsFor(slot.id).filter((x) => owned(p, x.id)).length;
    return `<div class="card gx-up" style="--rar:${RARITY[it.rarity].color}">
      <div class="gx-up-ico">${itemArt(it)}</div>
      <div class="grow">
        <div class="row gx-wrap"><b>${slot.name}</b><span class="muted small">${esc(slot.improves)}</span></div>
        <div class="gx-up-name">${esc(it.name)} ${rarityChip(it.rarity)}</div>
        <div class="gx-lv" aria-label="Level ${lv} of ${MAX_LEVEL}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= lv ? 'on' : ''}">${ROMAN[i]}</i>`).join('')}</div>
        <small class="muted">${bonusText(partBonus(it, lv))}${lv < MAX_LEVEL ? ` → next: ${bonusText(partBonus(it, lv + 1))}` : ''}</small>
      </div>
      <div class="gx-up-act">
        ${lv < MAX_LEVEL ? `<button class="btn btn-primary btn-sm" data-up="${it.id}" ${p.coins < cost ? 'disabled' : ''}>${ROMAN[lv + 1]} · ${icons.coin}${fmt(cost)}</button>` : `<span class="badge gold">${icons.check} Max</span>`}
        <button class="btn btn-ghost btn-sm" data-swap="${slot.id}">Change${choices > 1 ? ` (${choices})` : ''}</button>
      </div>
    </div>`;
  }).join('');
  const el = page({
    kicker: `Upgrades · ${esc(bikeName(bikeId))}`, title: 'Upgrades', back,
    stage: `${stageControls({ rider: false })}${ratingHtml(ratingOf(s))}`,
    body: `<div class="gx-cols">
      <div class="card stack"><div class="row"><b>Performance</b><span class="grow"></span><span class="muted small">Rating ${ratingOf(s)}</span></div>${statBars(s)}
        <p class="muted small">Parts level up from I to V and stay with you when you swap them between bikes. Parts can add at most +20 to any stat, so riding well still matters most. Prize races always use the same plain bike for everyone.</p></div>
      <div class="stack">${rows}</div>
    </div>`,
  });
  mountStage(el.querySelector('[data-stage]')!, styleFor(p, bikeId));
  on('[data-up]', (b) => {
    const id = b.dataset.up!;
    const lv = upgradePart(p, id, (c) => { if (p.coins < c) return false; p.coins -= c; return true; });
    if (!lv) return;
    sfx.finish();
    upgradesScreen(bikeId, back);
    stageFlash(H().app.querySelector('[data-stage]'), 'Upgrade complete', `${item(id)!.name} → level ${ROMAN[lv]}`);
  });
  on('[data-swap]', (b) => partPicker(p, bikeId, b.dataset.swap as PartSlot, () => upgradesScreen(bikeId, back)));
}

/** choose which part goes in a slot */
function partPicker(p: Profile, bikeId: string, slot: PartSlot, done: () => void) {
  const cur = fittedPart(p, bikeId, slot);
  const list = partsFor(slot);
  const { el, close } = sheet(`<h2 class="gx-sheet-title">${esc(SLOTS.find((s) => s.id === slot)!.name)}</h2>
    <p class="muted small">${esc(SLOTS.find((s) => s.id === slot)!.improves)}. Fitted to ${esc(bikeName(bikeId))}.</p>
    <div class="stack gx-pick">${list.map((it) => {
      const own = owned(p, it.id);
      const lv = partLevel(p, it.id);
      const st = status(p, it);
      return `<button class="gx-row${cur.id === it.id ? ' on' : ''}" data-part="${it.id}" style="--rar:${RARITY[it.rarity].color}">
        <span class="gx-row-art">${itemArt(it)}</span>
        <span class="grow"><b>${esc(it.name)}</b> ${rarityChip(it.rarity)}<small>${own ? `Level ${ROMAN[lv]} · ${bonusText(partBonus(it, lv))}` : bonusText(it.bonus ?? {})}</small></span>
        <span>${cur.id === it.id ? `<span class="gx-state on">${icons.check} Fitted</span>` : own ? '<span class="gx-state own">Fit</span>' : statusHtml(p, it, st)}</span>
      </button>`;
    }).join('')}</div>
    <button class="btn btn-link" data-close>Close</button>`);
  el.querySelectorAll<HTMLElement>('[data-part]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.part!;
    if (owned(p, id)) { fitPart(p, bikeId, id); sfx.coin(); close(); done(); }
    else { close(); storeLink(id); }
  }));
}

type PTab = PartSlot | 'all';
let pTab: PTab = 'all';
export function partsScreen(back: () => void = toGarage) {
  const p = P();
  const counts = SLOTS.map((s) => [s, partsFor(s.id).filter((x) => owned(p, x.id)).length, partsFor(s.id).length] as const);
  const list = ITEMS.filter((i) => i.kind === 'part' && (pTab === 'all' || i.slot === pTab));
  page({
    kicker: 'Garage', title: 'Parts', back,
    body: `<div class="gx-counts">${counts.map(([s, n, of]) => `<button class="gx-count${pTab === s.id ? ' on' : ''}" data-pt="${s.id}"><b>${n}<small>/${of}</small></b><span>${s.name}</span></button>`).join('')}</div>
      ${tabsHtml([['all', 'All parts'], ...SLOTS.map((s) => [s.id, s.name] as [string, string])], pTab, 'data-pt')}
      <div class="stack">${list.map((it) => {
        const own = owned(p, it.id);
        const lv = partLevel(p, it.id);
        const on = SLOTS.some((s) => fittedPart(p, p.bike, s.id).id === it.id);
        return `<button class="gx-row" data-item="${it.id}" style="--rar:${RARITY[it.rarity].color}">
          <span class="gx-row-art">${itemArt(it)}</span>
          <span class="grow"><b>${esc(it.name)}</b> ${rarityChip(it.rarity)}<small>${esc(SLOTS.find((s) => s.id === it.slot)!.name)} · ${own ? `Level ${ROMAN[lv]} · ${bonusText(partBonus(it, lv))}` : bonusText(it.bonus ?? {})}</small>
            <small class="muted">${own ? (on ? `Fitted to ${esc(bikeName(p.bike))}` : 'In your parts box') : it.unlock ? esc(it.unlock.text) : 'In the Store'}</small></span>
          <span>${on ? `<span class="gx-state on">${icons.check} Equipped</span>` : statusHtml(p, it)}</span>
        </button>`;
      }).join('')}</div>
      <p class="muted small">Parts you find on the Map, in treasure hunts and events land here too.</p>`,
  });
  on('[data-pt]', (b) => { pTab = b.dataset.pt as PTab; partsScreen(back); });
  on('[data-item]', (b) => itemSheet(b.dataset.item!, () => partsScreen(back)));
}

// ---------- loadouts ----------

const SUGGEST = ['Race', 'Explore', 'Vibe'];
export function loadoutsScreen(back: () => void = toGarage) {
  const p = P();
  const slots = p.garage.loadouts;
  page({
    kicker: 'Garage', title: 'Loadouts', back,
    body: `<p class="muted">Save a bike and its parts as a setup, then switch in one tap: a race setup, an explore setup, a Vibe Ride setup.</p>
      <div class="gx-loadouts">${slots.map((l, i) => {
        if (!l) return `<div class="card gx-lo empty"><small class="muted">Setup ${i + 1}</small><b>Empty</b><p class="muted small">Save what you ride now (${esc(bikeName(p.bike))}) here.</p><button class="btn btn-ghost" data-save="${i}">${icons.plus} Save current setup</button></div>`;
        const ok = owned(p, 'bike:' + l.bike);
        const s = ok ? statsFor(p, l.bike, l.parts) : baseStats(l.bike);
        const active = p.bike === l.bike && SLOTS.every((x) => fittedPart(p, p.bike, x.id).id === fittedPart(p, l.bike, x.id, l.parts).id);
        return `<div class="card gx-lo${active ? ' on' : ''}">
          <div class="row"><small class="muted">Setup ${i + 1}</small><span class="grow"></span>${active ? `<span class="gx-state on">${icons.check} In use</span>` : ''}</div>
          <b class="gx-lo-name">${esc(l.name)}</b>
          ${bikeSvg(styleFor(p, l.bike))}
          <p class="small"><b>${esc(bikeName(l.bike))}</b> · Rating ${ratingOf(s)}</p>
          <p class="muted small">${SLOTS.map((x) => fittedPart(p, l.bike, x.id, l.parts)).filter((x) => !x.free).map((x) => esc(x.name)).join(', ') || 'Stock parts'}</p>
          <div class="two">${active ? '' : `<button class="btn btn-primary btn-sm" data-use="${i}" ${ok ? '' : 'disabled'}>Use</button>`}<button class="btn btn-ghost btn-sm" data-save="${i}">Save here</button></div>
          <div class="row"><button class="btn btn-link" data-rename="${i}">Rename</button><span class="grow"></span><button class="btn btn-link" data-clear="${i}">Clear</button></div>
        </div>`;
      }).join('')}</div>`,
  });
  const again = () => loadoutsScreen(back);
  on('[data-save]', (b) => {
    const i = Number(b.dataset.save);
    saveLoadout(p, i, slots[i]?.name ?? SUGGEST[i]);
    sfx.coin();
    again();
  });
  on('[data-use]', (b) => { if (useLoadout(p, Number(b.dataset.use))) { H().bike3d.refresh(); sfx.coin(); } again(); });
  on('[data-clear]', (b) => { clearLoadout(p, Number(b.dataset.clear)); again(); });
  on('[data-rename]', (b) => {
    const i = Number(b.dataset.rename);
    const { el, close } = sheet(`<h2 class="gx-sheet-title">Name this setup</h2>
      <div class="field"><input id="loName" maxlength="18" value="${esc(slots[i]?.name ?? '')}" aria-label="Setup name"></div>
      <div class="chips-row">${SUGGEST.concat('Hill', 'Night').map((s) => `<button class="chip-btn" data-sug="${s}">${s}</button>`).join('')}</div>
      <div class="gx-sheet-row"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="loOk">Save</button></div>`);
    const input = el.querySelector<HTMLInputElement>('#loName')!;
    el.querySelectorAll<HTMLElement>('[data-sug]').forEach((x) => x.addEventListener('click', () => { input.value = x.dataset.sug!; }));
    el.querySelector('#loOk')!.addEventListener('click', () => {
      const l = slots[i];
      if (l) { l.name = input.value.trim().slice(0, 18) || l.name; touch(p); }
      close();
      again();
    });
  });
}

// ---------- collection ----------

type Group = { id: string; name: string; kinds: Kind[] };
const GROUPS: Group[] = [
  { id: 'bike', name: 'Bikes', kinds: ['bike'] },
  { id: 'part', name: 'Parts', kinds: ['part'] },
  { id: 'paint', name: 'Paint & finish', kinds: ['paint', 'finish'] },
  { id: 'decal', name: 'Decals', kinds: ['decal'] },
  { id: 'look', name: 'Wheels, bars & saddles', kinds: ['wheel', 'tyre', 'bars', 'seat', 'grips'] },
  { id: 'extra', name: 'Lights & accessories', kinds: ['light', 'acc', 'bell'] },
  { id: 'rider', name: 'Rider', kinds: ['rider', 'jersey'] },
];
let colGroup = 'bike';
export function collectionScreen(back: () => void = toGarage) {
  const p = P();
  const c = collectionCounts(p);
  const g = GROUPS.find((x) => x.id === colGroup) ?? GROUPS[0];
  const list = ITEMS.filter((i) => g.kinds.includes(i.kind)).sort((a, b) => Number(owned(p, b.id)) - Number(owned(p, a.id)) || RARITY[a.rarity].rank - RARITY[b.rarity].rank);
  const own = list.filter((i) => owned(p, i.id)).length;
  page({
    kicker: 'Garage', title: 'My collection', back,
    body: `<div class="card gx-colhead">
        <div><b>${c.bikes} / ${c.bikesTotal}</b><span>Bikes owned</span></div>
        <div><b>${c.items} / ${c.itemsTotal}</b><span>Items collected</span></div>
        <div class="gx-prog big"><i style="width:${(c.items / c.itemsTotal) * 100}%"></i></div>
      </div>
      ${tabsHtml(GROUPS.map((x) => [x.id, x.name]), colGroup, 'data-cg')}
      <p class="muted small">${own} of ${list.length} ${esc(g.name.toLowerCase())}. Locked items say how to get them.</p>
      <div class="gx-grid-cards small">${list.map((it) => card(p, it, { art: it.kind === 'bike' ? bikeArt(p, it) : itemArt(it), sub: owned(p, it.id) ? undefined : esc(it.unlock?.text ?? (it.season ? `On sale during ${it.season.name}` : it.dropOnly ? 'Limited drops only' : 'In the Store')) })).join('')}</div>
      <p class="muted small">Trading items between riders isn't available, on purpose: it keeps the game fair and safe from scams. You can sell items you bought back for coins.</p>`,
  });
  on('[data-cg]', (b) => { colGroup = b.dataset.cg!; collectionScreen(back); });
  on('[data-item]', (b) => itemSheet(b.dataset.item!, () => collectionScreen(back)));
}

// ---------- one item ----------

/** details for any item: what it does, where it comes from, equip / sell / get it */
export function itemSheet(id: string, redraw: () => void) {
  const p = P();
  const it = item(id);
  if (!it) return;
  if (it.kind === 'bike') return bikeDetail(id.slice(5), redraw);
  const own = owned(p, it.id);
  const st = status(p, it);
  const sv = sellValue(p, it);
  const on2 = equipped(p, it);
  const perf = it.kind === 'part' ? `<p><b>${bonusText(partBonus(it, own ? partLevel(p, it.id) : 1))}</b>${own ? ` at level ${ROMAN[partLevel(p, it.id)]}` : ' at level I'}, up to ${bonusText(partBonus(it, MAX_LEVEL))} at level V.</p>`
    : it.gear ? '' : '<p class="muted small">Cosmetic: no performance advantage.</p>';
  const { el, close } = sheet(`<div class="gx-buy-head"><div class="gx-buy-art" style="--rar:${RARITY[rarityOf(it)].color}">${itemArt(it)}</div><div><b>${esc(it.name)}</b><span>${rarityChip(rarityOf(it))} ${esc(kindName(it))}</span></div></div>
    <p>${esc(it.blurb)}</p>${perf}
    ${own ? `<p class="small">${statusHtml(p, it, st)}</p>` : it.unlock ? unlockHtml(p, it) : `<p class="small">${statusHtml(p, it, st)}</p>`}
    ${own && !it.gear ? `<button class="btn btn-primary" id="isUse">${it.kind === 'part' ? (on2 ? `${icons.check} Fitted` : `Fit to ${esc(bikeName(p.bike))}`) : on2 ? (it.kind === 'decal' || it.kind === 'bell' || it.kind === 'acc' ? 'Take off' : `${icons.check} In use`) : 'Use on my bike'}</button>` : ''}
    ${!own && buyable(st) ? `<button class="btn btn-primary" id="isBuy">Buy · ${priceHtml(priceOf(it))}</button>` : ''}
    ${sv ? `<button class="btn btn-ghost" id="isSell">Sell for ${icons.coin}${fmt(sv)}</button>` : ''}
    <button class="btn btn-link" data-close>Close</button>`);
  el.querySelector('#isUse')?.addEventListener('click', () => {
    if (it.kind === 'part' && on2) return;
    if (on2 && !['decal', 'bell', 'acc'].includes(it.kind)) return;
    applyItem(p, it.id);
    H().bike3d.refresh();
    sfx.coin();
    close();
    redraw();
  });
  el.querySelector('#isBuy')?.addEventListener('click', () => buy(p, it.id, redraw));
  el.querySelector('#isSell')?.addEventListener('click', () => sellSheet(p, it, redraw));
}

function sellSheet(p: Profile, it: Item, redraw: () => void) {
  const v = sellValue(p, it);
  const { el, close } = sheet(`<h2 class="gx-sheet-title">Sell ${esc(it.name)}?</h2>
    <p>You get <b>${icons.coin} ${fmt(v)}</b> (a third of the price). Buying it again later costs the full price${it.kind === 'part' ? ', and its upgrade levels are lost' : ''}.</p>
    <p class="muted small">Selling to other riders isn't possible: there is no trading, to keep the game fair.</p>
    <div class="gx-sheet-row"><button class="btn btn-ghost" data-close>Keep it</button><button class="btn btn-primary" id="sellOk">Sell</button></div>`);
  el.querySelector('#sellOk')!.addEventListener('click', () => {
    if (sell(p, it.id)) { sfx.coin(); H().bike3d.refresh(); }
    close();
    redraw();
  });
}

function on(sel: string, fn: (el: HTMLElement) => void) {
  H().app.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
}
export { count };
