// Pieces shared by the Garage and Store screens: wallet, rarity, prices, status chips, stat bars, pages and sheets.
import { icons } from '../../ui/icons';
import type { Profile } from '../../state';
import { H, esc, fmt } from '../host';
import { buyCoinsScreen } from '../money-ui';
import { RARITY, STATS, SOURCES, type Item, type Price, type Rarity, type Stats } from './catalog';
import { priceOf, progress, rarityOf, status, type Status } from './garage';
import { unmountStage } from './preview';
import { seasonState } from './rotation';
import './garage.css';

/** coins and diamonds; inside the menu shell the top bar already shows coins */
export const wallet = (p: Profile, coins = true) => `<div class="gx-wallet">
  ${coins ? `<button class="gx-pill" data-gx-coins aria-label="Rush Coins: ${fmt(p.coins)}">${icons.coin}<b>${fmt(p.coins)}</b></button>` : ''}
  <button class="gx-pill" data-gx-diamonds aria-label="Diamonds: ${fmt(p.diamonds ?? 0)}">${icons.diamond}<b>${fmt(p.diamonds ?? 0)}</b></button>
</div>`;

export const rarityChip = (r: Rarity) => `<span class="gx-rar" style="--rar:${RARITY[r].color}"><i></i>${RARITY[r].name}</span>`;

export function priceHtml(price: Price | undefined, cls = '') {
  if (!price || (!price.coins && !price.diamonds)) return `<span class="gx-price free ${cls}">Free</span>`;
  return `<span class="gx-price ${cls}">${price.coins ? `${icons.coin}${fmt(price.coins)}` : ''}${price.diamonds ? `${icons.diamond}${fmt(price.diamonds)}` : ''}</span>`;
}

/** what a card says about owning or getting an item */
export function statusHtml(p: Profile, it: Item, s: Status = status(p, it)) {
  if (s === 'equipped') return `<span class="gx-state on">${icons.check} Equipped</span>`;
  if (s === 'owned') return `<span class="gx-state own">${icons.check} Owned</span>`;
  if (s === 'soon') return `<span class="gx-state lock">${icons.lock} Coming soon</span>`;
  if (s === 'gone') {
    const ss = seasonState(it);
    return `<span class="gx-state lock">${icons.lock} ${ss.starts ? `Back ${ss.starts.toLocaleDateString('en-GB', { month: 'short' })}` : 'Not in store now'}</span>`;
  }
  if (s === 'locked') {
    const pr = progress(p, it);
    return `<span class="gx-state lock">${icons.lock} ${pr ? `${fmt(pr[0])}/${fmt(pr[1])}` : esc(SOURCES[it.unlock?.source ?? 'event'])}</span>`;
  }
  return `${s === 'limited' ? `<span class="gx-state lim">${icons.flame} Limited</span>` : ''}${priceHtml(priceOf(it))}`;
}

/** how to get a locked item, with progress when the game counts it */
export function unlockHtml(p: Profile, it: Item) {
  if (!it.unlock) return '';
  const pr = progress(p, it);
  return `<div class="gx-unlock"><span class="gx-src">${esc(SOURCES[it.unlock.source])}</span><b>${esc(it.unlock.text)}</b>${pr ? `<div class="gx-prog"><i style="width:${(pr[0] / pr[1]) * 100}%"></i></div><small>${fmt(pr[0])} of ${fmt(pr[1])}</small>` : ''}</div>`;
}

/** stat bars 0..100; with `vs`, shows the change from another bike (green up, red down) */
export function statBars(s: Stats, vs?: Stats, only?: (keyof Stats)[]) {
  return `<div class="gx-bars">${STATS.filter((x) => !only || only.includes(x.id)).map((x) => {
    const d = vs ? s[x.id] - vs[x.id] : 0;
    return `<div class="gx-bar" title="${esc(x.text)}"><span>${x.name}</span>
      <div class="gx-track"><i style="width:${s[x.id]}%"></i>${vs && d < 0 ? `<em class="down" style="left:${s[x.id]}%;width:${-d}%"></em>` : ''}${vs && d > 0 ? `<em class="up" style="left:${vs[x.id]}%;width:${d}%"></em>` : ''}</div>
      <b>${s[x.id]}</b>${vs ? `<small class="${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}">${d > 0 ? `+${d}` : d < 0 ? d : '='}</small>` : ''}</div>`;
  }).join('')}</div>`;
}

/** the rating dial */
export const ratingHtml = (n: number, label = 'Rating') => `<div class="gx-rating" style="--r:${n}"><b>${n}</b><small>${label}</small></div>`;

/**
 * A full page (not inside the menu shell) with a back button. With stage: true it has a see-through box
 * where the 3D bike shows; put the stage HTML in `stage`.
 */
export function page(o: { title: string; kicker?: string; body: string; back: () => void; stage?: string; cls?: string; head?: string }) {
  unmountStage();
  const h = H();
  h.showcase();
  h.app.innerHTML = `
    <div class="screen gx-page fade-in ${o.stage ? 'has-stage' : ''} ${o.cls ?? ''}">
      <div class="gx-page-in">
        <header class="gx-top">
          <button class="gx-back" id="gxBack" aria-label="Back">‹</button>
          <p class="kicker grow">${o.kicker ?? ''}</p>
          ${o.head ?? wallet(h.profile())}
          <h1 class="title">${o.title}</h1>
        </header>
        ${o.stage ? `<section class="gx-stage" data-stage>${o.stage}</section>` : ''}
        <div class="gx-body">${o.body}</div>
      </div>
    </div>`;
  h.app.querySelector('#gxBack')!.addEventListener('click', o.back);
  h.onBack(o.back);
  bindCommon(h.app, o.back);
  return h.app.querySelector<HTMLElement>('.gx-page')!;
}

/** buttons every garage/store page has (the diamonds pill explains diamonds) */
export function bindCommon(root: HTMLElement, back: () => void = () => H().home('store')) {
  root.querySelectorAll<HTMLElement>('[data-gx-diamonds]').forEach((el) => el.addEventListener('click', () => diamondsSheet()));
  root.querySelectorAll<HTMLElement>('[data-gx-coins]').forEach((el) => el.addEventListener('click', () => buyCoinsScreen(back)));
}

export function diamondsSheet() {
  const p = H().profile();
  sheet(`<div class="gx-sheet-head">${icons.diamond}<h2>Diamonds</h2></div>
    <p>You have <b>${fmt(p.diamonds ?? 0)}</b>. Diamonds are the rare currency, for special items like chrome paint and the Diamond Series bike.</p>
    <p class="muted small">Earn them from treasure hunts, events and challenges. Buying diamonds is coming soon. Like Rush Coins, they are for the game only and can't be cashed out.</p>
    <button class="btn btn-primary" data-close>Got it</button>`);
}

/** a bottom sheet (centred on computers); returns it and a close function */
export function sheet(html: string, cls = '', onClose?: () => void) {
  document.querySelector('.gx-sheet-ov')?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay gx-sheet-ov fade-in';
  ov.innerHTML = `<div class="sheet light-ui gx-sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  const close = () => {
    if (!ov.isConnected) return;
    ov.remove();
    removeEventListener('keydown', esc_);
    onClose?.();
  };
  const esc_ = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', esc_);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  return { el: ov.querySelector<HTMLElement>('.gx-sheet')!, close };
}

/** a product card for grids and rows */
export function card(p: Profile, it: Item, opts: { art: string; sub?: string; attr?: string; badge?: string } ) {
  const r = rarityOf(it);
  return `<button class="gx-card" style="--rar:${RARITY[r].color}" ${opts.attr ?? `data-item="${it.id}"`}>
    <div class="gx-art">${opts.art}${opts.badge ?? ''}</div>
    <div class="gx-card-b">
      ${rarityChip(r)}
      <b class="gx-name">${esc(it.name)}</b>
      ${opts.sub ? `<small class="muted">${opts.sub}</small>` : ''}
      <div class="gx-card-s">${statusHtml(p, it)}</div>
    </div>
  </button>`;
}

/** a pill of category tabs */
export const tabsHtml = (list: [string, string][], on: string, attr = 'data-tab') =>
  `<div class="gx-tabs" role="tablist">${list.map(([id, label]) => `<button role="tab" aria-selected="${id === on}" class="${id === on ? 'on' : ''}" ${attr}="${id}">${label}</button>`).join('')}</div>`;
