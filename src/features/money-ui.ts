// Money screens: Buy coins (Paystack), the free Weekly prize race, the prize Wallet (cash out to
// Mobile Money) and the prize and payment terms. While Paystack isn't set up, each one says "Coming soon".
// main.ts calls initMoney() once, afterLaunch() when sign-in is restored, and afterRace() when a ride ends.
import * as cloud from '../cloud';
import { CAMPUS_LOOP, RACES, raceRoute, type Route } from '../game/routes';
import type { Game, GhostRun } from '../game/Game';
import { hallById } from '../data/campus';
import { saveProfile } from '../state';
import { icons } from '../ui/icons';
import { H, clock, esc, fmt, on, screen } from './host';
import * as money from './money';
import './money.css';

const svg = (d: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const mi = {
  wallet: svg('<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  receipt: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>'),
  podium: svg('<path d="M9 21V9h6v12M3 21v-7h6M15 21v-5h6v5M2 21h20"/><path d="M12 3.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.6l2-.3z"/>'),
  clockI: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  x: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  soon: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M4.5 4.5l2 2"/>'),
};

const PLACE = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' });

/** a race id as a ridable route */
function routeFor(id: string): Route | null {
  if (id === CAMPUS_LOOP.id) return CAMPUS_LOOP;
  const def = RACES.find((r) => r.id === id);
  return def ? raceRoute(def) : null;
}
const routeName = (id: string) => (id === CAMPUS_LOOP.id ? CAMPUS_LOOP.name : RACES.find((r) => r.id === id)?.name ?? id);

const set = (sel: string, html: string) => {
  const el = H().app.querySelector<HTMLElement>(sel);
  if (el) el.innerHTML = html;
  return el;
};
const spinner = (text: string) => `<div class="mn-loading"><span class="mn-spin"></span><span class="muted small">${esc(text)}</span></div>`;

function comingSoon(title: string, text: string, icon: string) {
  return `<div class="card mn-soon">
    <div class="mn-soon-ico">${icon}</div>
    <span class="badge gold">${mi.clockI} Coming soon</span>
    <h3>${esc(title)}</h3>
    <p class="muted small">${text}</p>
  </div>`;
}

function signInCard(why: string) {
  return `<div class="card stack mn-signin" style="gap:8px">
    <div class="row">${icons.lock}<b>Sign in first</b></div>
    <p class="muted small">${esc(why)}</p>
    <button class="btn btn-primary" data-mn-signin>Go to sign in</button>
  </div>`;
}
const bindSignIn = () => on('[data-mn-signin]', 'click', () => H().home('you'));

/** a short note that floats over any screen for a few seconds */
export function notice(html: string, kind: 'ok' | 'bad' | 'info' = 'info', ms = 7000) {
  document.querySelector('.mn-notice')?.remove();
  const el = document.createElement('div');
  el.className = `mn-notice light-ui ${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.appendChild(el);
  el.addEventListener('click', () => el.remove());
  setTimeout(() => el.remove(), ms);
}

const termsLink = '<button class="btn btn-link mn-terms-link" data-mn-terms>Prize and payment terms</button>';
function bindTerms(back: () => void) {
  on('[data-mn-terms]', 'click', () => termsScreen(back));
}

// ===================== Buy coins =====================

type PayState = { ref: string; status: 'checking' | 'paid' | 'pending' | 'failed'; coins?: number };

const PREVIEW: money.Bundle[] = [
  { id: 'coins-500', coins: 500, price: 500, label: 'Pocket' },
  { id: 'coins-1200', coins: 1200, price: 1000, label: 'Saddle bag', tag: '+20% coins' },
  { id: 'coins-3000', coins: 3000, price: 2000, label: 'Backpack', tag: 'Popular' },
  { id: 'coins-8000', coins: 8000, price: 5000, label: 'Treasure chest', tag: 'Best value' },
];

function bundleCard(b: money.Bundle, action: string) {
  return `<div class="card mn-bundle">
    ${b.tag ? `<span class="mn-tag">${esc(b.tag)}</span>` : ''}
    <div class="mn-coins">${icons.coin}<b>${fmt(b.coins)}</b></div>
    <p class="muted small">${esc(b.label)}</p>
    ${action}
  </div>`;
}

function payStateHtml(s: PayState) {
  if (s.status === 'checking') return `<div class="card mn-pay">${spinner('Checking your payment with Paystack…')}</div>`;
  if (s.status === 'paid') return `<div class="card mn-pay ok"><div class="mn-pay-ico">${icons.check}</div><div><b>Payment received</b><p class="muted small">${s.coins ? `${fmt(s.coins)} Rush Coins added to your account.` : 'Your coins are in your account.'} Thank you!</p></div></div>`;
  if (s.status === 'pending') return `<div class="card mn-pay"><div class="mn-pay-ico">${mi.clockI}</div><div><b>Waiting for your payment</b><p class="muted small">If you approved it on your phone, it can take a minute to confirm. Your coins are added as soon as it does, even if you close the game.</p><button class="btn btn-ghost btn-sm" data-mn-recheck>Check again</button></div></div>`;
  return `<div class="card mn-pay bad"><div class="mn-pay-ico">${mi.x}</div><div><b>Payment didn't go through</b><p class="muted small">No money was taken for coins. You can try again below.</p></div></div>`;
}

export function buyCoinsScreen(back: () => void = () => H().home(), pay?: PayState) {
  const p = H().profile();
  const on_ = money.moneyOn();
  screen(`
    <div class="row"><div><p class="kicker">Shop</p><h1 class="title">Buy Rush Coins</h1></div><span class="grow"></span><span class="chip">${icons.coin} <span class="mn-balance">${fmt(p.coins)}</span></span></div>
    ${on_ && money.testMode() ? '<p class="mn-test">Test mode: no real money is taken.</p>' : ''}
    <div id="mnPay">${pay ? payStateHtml(pay) : ''}</div>
    ${on_
      ? `<div id="mnBundles">${spinner('Loading bundles…')}</div>`
      : `${comingSoon('Coin bundles are coming soon', 'Soon you can top up Rush Coins with MTN MoMo, Telecel Cash, AirtelTigo Money or a bank card. Until then, earn coins by riding, racing and finishing challenges.', mi.cash)}
         <div class="mn-bundles soon">${PREVIEW.map((b) => bundleCard(b, `<button class="btn btn-ghost btn-sm" disabled>${money.ghs(b.price)}</button>`)).join('')}</div>`}
    <div class="card mn-fine">
      <p class="small">${icons.shield} Payments are handled by <b>Paystack</b>: Mobile Money (MTN, Telecel, AirtelTigo) or card. LEGONRUSH never sees your PIN or card number.</p>
      <p class="small muted">Rush Coins are for the game only. They can't be cashed out, swapped for money or used in prize races, which are free for everyone.</p>
      ${termsLink}
    </div>`, back, 'mn-screen');
  bindTerms(() => buyCoinsScreen(back));
  on('[data-mn-recheck]', 'click', () => pay && void checkPayment(pay.ref, back));
  if (on_) void loadBundles(back);
}

async function loadBundles(back: () => void) {
  const r = await money.bundles();
  if (!H().app.querySelector('#mnBundles')) return;
  if (!r.ok || !r.enabled) {
    set('#mnBundles', r.ok || r.code === 'not_ready'
      ? comingSoon('Coin bundles are coming soon', 'Payments are being set up. Check back soon.', mi.cash)
      : `<div class="card"><p class="muted small">${esc(r.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`);
    on('[data-mn-retry]', 'click', () => buyCoinsScreen(back));
    return;
  }
  const signedIn = !!cloud.account;
  set('#mnBundles', `
    ${signedIn ? '' : signInCard('Coins you buy are saved to your account, so you need one to buy them.')}
    <div class="mn-bundles">${r.bundles.map((b) => bundleCard(b, `<button class="btn btn-primary btn-sm" data-mn-buy="${esc(b.id)}" ${signedIn ? '' : 'disabled'}>${money.ghs(b.price)}</button>`)).join('')}</div>
    <p class="mn-error" id="mnErr" hidden></p>`);
  bindSignIn();
  on('[data-mn-buy]', 'click', async (_, el) => {
    const btn = el as HTMLButtonElement;
    H().app.querySelectorAll<HTMLButtonElement>('[data-mn-buy]').forEach((b) => (b.disabled = true));
    btn.innerHTML = '<span class="mn-spin sm"></span> Opening…';
    const c = await money.checkout(btn.dataset.mnBuy!);
    if (c.ok) {
      try {
        sessionStorage.setItem('legonrush.pay', c.reference);
      } catch {
        /* the reference also comes back in the URL */
      }
      location.assign(c.authorization_url);
      return;
    }
    const err = set('#mnErr', esc(c.message));
    if (err) err.hidden = false;
    loadBundles(back);
  });
}

/** coins from confirmed payments go into the rider's progress, once */
async function collectCoins() {
  const r = await money.claimCoins();
  if (!r.ok || !r.coins) return 0;
  const p = H().profile();
  p.coins += r.coins;
  saveProfile(p);
  H().app.querySelectorAll('.mn-balance, .coin-count').forEach((el) => (el.textContent = fmt(p.coins)));
  return r.coins;
}

async function checkPayment(ref: string, back: () => void) {
  set('#mnPay', payStateHtml({ ref, status: 'checking' }));
  const v = await money.verifyPayment(ref);
  const status = v.ok ? v.status : 'pending';
  const coins = status === 'paid' ? await collectCoins() : 0;
  if (!H().app.querySelector('#mnPay')) return;
  buyCoinsScreen(back, { ref, status, coins });
}

// ===================== Weekly prize race =====================

/** the card on the Events tab */
export function prizeCardHtml() {
  return `<button class="card selectable mn-prize-card" data-money-open="prize" data-money-back="events">
    <div class="row"><h3>${mi.podium} WEEKLY PRIZE RACE</h3><span class="grow"></span><span class="badge gold">${money.moneyOn() ? 'Free entry' : 'Coming soon'}</span></div>
    <p class="muted small">Ride one race all week. The three fastest riders win cash prizes, paid to Mobile Money. Free to enter.</p>
  </button>`;
}

function rulesHtml(ev?: money.PrizeEvent) {
  const n = ev?.prizes.filter((x) => x > 0).length || 3;
  return `<div class="card mn-rules">
    <h3>${icons.flag} How it works</h3>
    <ol>
      <li><b>Free to enter.</b> No purchase needed. Everyone rides the same City bike with no upgrades, helmets or energy drinks, on Normal, in clear weather: nothing you own or buy helps.</li>
      <li>Have an account and press <b>Ride the prize race</b> on this screen. Ride as often as you like; your best time counts.</li>
      <li>Every result is <b>checked by our server</b> against the recording of your ride. Results that don't add up don't count.</li>
      <li>When the week ends (Sunday 23:59, Ghana time) the top ${n} win. Ties go to whoever set the time first.</li>
      <li>Prizes go to your <b>Wallet</b>, and you cash out to MTN MoMo, Telecel Cash or AirtelTigo Money.</li>
      <li>Under 18? You can race, but a parent or guardian must agree before you cash out.</li>
      <li>Cheating, bots or shared accounts mean disqualification and no prize.</li>
    </ol>
    ${termsLink}
  </div>`;
}

function prizesHtml(prizes: number[]) {
  const top = prizes.slice(0, 3);
  return `<div class="mn-podium">${top.map((x, i) => `<div class="mn-step p${i + 1}"><span>${PLACE[i]}</span><b>${money.ghs(x)}</b></div>`).join('')}</div>
    ${prizes.length > 3 ? `<p class="muted small" style="text-align:center">${prizes.slice(3).map((x, i) => `${PLACE[i + 3]}: ${money.ghs(x)}`).join(' · ')}</p>` : ''}`;
}

function timeLeft(end: string) {
  const ms = Date.parse(end) - Date.now();
  if (ms <= 0) return 'Ended';
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3);
  return d ? `${d} day${d === 1 ? '' : 's'} ${h} h left` : h ? `${h} h left` : `${Math.max(1, Math.round(ms / 60e3))} min left`;
}

export function prizeRaceScreen(back: () => void = () => H().home('events')) {
  const on_ = money.moneyOn();
  screen(`
    <p class="kicker">Events</p>
    <h1 class="title">Weekly prize race</h1>
    ${on_ ? `<div id="mnPrize">${spinner('Loading this week\'s race…')}</div>`
      : `${comingSoon('Weekly prize race: coming soon', 'Each week, one race with cash prizes for the three fastest riders, paid to Mobile Money. Free to enter. Get practising on the races in the Race tab.', mi.podium)}
         ${prizesHtml([20000, 10000, 5000])}`}
    ${rulesHtml()}`, back, 'mn-screen');
  bindTerms(() => prizeRaceScreen(back));
  if (on_) void loadPrize(back);
}

async function loadPrize(back: () => void) {
  const r = await money.prizeWeek();
  if (!H().app.querySelector('#mnPrize')) return;
  if (!r.ok) {
    set('#mnPrize', r.code === 'not_ready'
      ? comingSoon('Weekly prize race: coming soon', 'Prize races are being set up. Check back soon.', mi.podium)
      : `<div class="card"><p class="muted small">${esc(r.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`);
    on('[data-mn-retry]', 'click', () => prizeRaceScreen(back));
    return;
  }
  const ev = r.event;
  if (!ev) {
    set('#mnPrize', `<div class="card mn-soon"><div class="mn-soon-ico">${mi.podium}</div><h3>No prize race this week</h3><p class="muted small">A new one starts on Monday. Keep practising on the races in the Race tab.</p></div>`);
    return;
  }
  const route = routeFor(ev.route);
  const mine = r.mine ?? [];
  const best = mine.filter((m) => m.accepted).reduce((b, m) => Math.min(b, m.time), Infinity);
  set('#mnPrize', `
    <div class="card mn-event">
      <div class="row"><span class="badge gold">${icons.flag} Live</span><span class="grow"></span><span class="muted small">${mi.clockI} ${esc(timeLeft(ev.ends_at))}</span></div>
      <h2>${esc(ev.title)}</h2>
      <p class="muted small">Route: <b>${esc(routeName(ev.route))}</b> · ${(ev.route_length / 1000).toFixed(1)} km · ends ${esc(DAY.format(new Date(ev.ends_at)))}</p>
      ${ev.sponsor ? `<p class="mn-sponsor">Prizes by <b>${esc(ev.sponsor)}</b></p>` : ''}
      ${prizesHtml(ev.prizes)}
      ${cloud.account
        ? route ? '<button class="btn btn-primary" id="mnRide">Ride the prize race</button>' : '<p class="mn-error">Update the game to ride this week\'s race.</p>'
        : signInCard('Prize races need an account, so we know who to pay.')}
      <p class="mn-error" id="mnErr" hidden></p>
    </div>
    ${cloud.account ? `<div class="card mn-mine">
      <h3>${icons.target} Your week</h3>
      ${r.my_place ? `<p>You're <b>${PLACE[r.my_place - 1] ?? `#${r.my_place}`}</b> of ${r.riders} with <b>${clock(best)}</b>.</p>` : '<p class="muted small">No accepted time yet. Ride the race to get on the board.</p>'}
      ${mine.length ? `<div class="mn-tries">${mine.map((m) => `<div class="mn-try ${m.accepted ? 'ok' : 'bad'}">${m.accepted ? icons.check : mi.x}<span>${clock(m.time)}</span><small>${m.accepted ? 'Accepted' : esc(m.reason ?? 'Not accepted')}</small></div>`).join('')}</div>` : ''}
    </div>` : ''}
    <div class="card board mn-board">
      <div class="row"><h3>${icons.trophy} Leaderboard</h3><span class="grow"></span><span class="muted small">${r.riders} rider${r.riders === 1 ? '' : 's'}</span></div>
      ${r.board.length
        ? r.board.map((x) => `<div class="board-row${x.me ? ' me' : ''}${x.place <= ev.prizes.length ? ' prize' : ''}"><span class="rank">${x.place}</span><span class="hall-swatch" style="background:${hallById(x.hall).color}"></span><span class="grow">${esc(x.name)}<small>${x.username ? `@${esc(x.username)} · ` : ''}${esc(hallById(x.hall).short)}</small></span><b>${clock(x.best)}</b>${ev.prizes[x.place - 1] ? `<em class="mn-win">${money.ghs(ev.prizes[x.place - 1])}</em>` : ''}</div>`).join('')
        : '<p class="muted small">No times yet this week. Be the first!</p>'}
    </div>`);
  bindSignIn();
  on('#mnRide', 'click', async (_, el) => {
    const btn = el as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<span class="mn-spin sm"></span> Getting your start ticket…';
    const t = await money.startPrizeRide(ev.route);
    if (!t.ok) {
      btn.disabled = false;
      btn.textContent = 'Ride the prize race';
      const err = set('#mnErr', esc(t.message));
      if (err) err.hidden = false;
      return;
    }
    H().play(route!, {});
  });
}

/** true while the ride about to start (or under way) on this route is a prize ride */
export const isPrizeRide = (routeId: string) => money.prizeTicketFor(routeId);
/** the bike every prize ride uses, whatever the rider owns */
export const PRIZE_BIKE = 'city';

/**
 * A level field for prize rides, so nothing bought can help win money: no upgrades, energy drinks,
 * repair kits or helmets, Normal difficulty and clear weather. Call after the ride's own setup.
 */
export function levelField(game: Pick<Game, 'setUpgrades' | 'setRideItems' | 'setDifficulty' | 'setWeather' | 'setGear'>, brakes: number) {
  game.setUpgrades({ speed: 0, grip: 0, boost: 0 });
  game.setRideItems({ energy: false, repairKits: 0 });
  game.setDifficulty('normal');
  game.setWeather('clear');
  game.setGear(0, brakes);
}

/** Call when any ride ends: sends a prize ride's result for checking and says what happened. */
export function afterRace(route: Route, r: { finished: boolean; time: number }, run: GhostRun) {
  if (!money.prizeTicketFor(route.id)) return;
  if (!r.finished) {
    void money.submitPrizeRide(route, r, run);
    notice(`${icons.flag} <span>Prize race: only finished rides count. Try again from the Weekly prize race screen.</span>`, 'info');
    return;
  }
  notice(`<span class="mn-spin sm"></span> <span>Checking your prize race time…</span>`, 'info', 30000);
  void money.submitPrizeRide(route, r, run).then((v) => {
    if (!v) return;
    if (!v.ok) return notice(`${mi.x} <span>Prize race: ${esc(v.message)}</span>`, 'bad', 9000);
    if (v.accepted) notice(`${icons.check} <span><b>Prize race time accepted: ${clock(v.time)}.</b> You're ${PLACE[v.place - 1] ?? `#${v.place}`} of ${v.riders} this week.</span>`, 'ok', 9000);
    else notice(`${mi.x} <span><b>Prize race time not accepted.</b> ${esc(v.message)}</span>`, 'bad', 10000);
  });
}

// ===================== Wallet =====================

const NET_NAME: Record<string, string> = Object.fromEntries(money.NETWORKS.map((n) => [n.id, n.name]));
const STATUS: Record<money.PayoutRow['status'], string> = { pending: 'Waiting for approval', processing: 'On its way', sent: 'Sent', failed: 'Failed, money returned' };

export function walletScreen(back: () => void = () => H().home('you')) {
  const on_ = money.moneyOn();
  screen(`
    <p class="kicker">You</p>
    <h1 class="title">Wallet</h1>
    ${!on_ ? `${comingSoon('Prize wallet: coming soon', 'When weekly prize races start, the money you win lands here and you can cash it out to your Mobile Money.', mi.wallet)}
      <div class="card mn-balance-card soon"><span class="muted small">Prize money</span><b>GHS 0</b></div>`
      : cloud.account ? `<div id="mnWallet">${spinner('Loading your wallet…')}</div>`
      : signInCard('Your wallet holds prize money, so it belongs to your account.')}
    <div class="card mn-fine">
      <p class="small">${mi.wallet} Only prize money from weekly prize races goes in your wallet. Rush Coins, bought or earned, have no cash value and can't be cashed out.</p>
      ${termsLink}
    </div>`, back, 'mn-screen');
  bindSignIn();
  bindTerms(() => walletScreen(back));
  if (on_ && cloud.account) void loadWallet(back);
}

async function loadWallet(back: () => void, result?: { ok: boolean; message: string }) {
  const r = await money.wallet();
  if (!H().app.querySelector('#mnWallet')) return;
  if (!r.ok) {
    set('#mnWallet', r.code === 'not_ready'
      ? comingSoon('Prize wallet: coming soon', 'Cash-outs are being set up. Check back soon.', mi.wallet)
      : `<div class="card"><p class="muted small">${esc(r.message)}</p><button class="btn btn-ghost btn-sm" data-mn-retry>Try again</button></div>`);
    on('[data-mn-retry]', 'click', () => walletScreen(back));
    return;
  }
  const open = r.payouts.find((x) => x.status === 'pending' || x.status === 'processing');
  const canCash = !open && r.balance >= r.min;
  set('#mnWallet', `
    ${result ? `<div class="card mn-pay ${result.ok ? 'ok' : 'bad'}" id="mnResult"><div class="mn-pay-ico">${result.ok ? icons.check : mi.x}</div><div><b>${result.ok ? 'Cash-out requested' : 'Cash-out failed'}</b><p class="muted small">${esc(result.message)}</p></div></div>` : ''}
    <div class="card mn-balance-card"><span class="muted small">Prize money</span><b>${money.ghs(r.balance)}</b>
      <small class="muted">${r.balance ? `You can cash out from ${money.ghs(r.min)}.` : 'Win a weekly prize race to fill it.'}</small></div>
    ${open ? `<div class="card mn-open"><div class="row">${mi.clockI}<b>${money.ghs(open.amount_pesewas)} to ${esc(NET_NAME[open.network] ?? open.network)} ${esc(open.momo_number)}</b></div><p class="muted small">${STATUS[open.status]}. ${open.status === 'pending' ? 'Prize cash-outs are checked by hand, usually within 2 working days.' : 'It should arrive in a few minutes.'}</p></div>` : ''}
    ${canCash ? cashForm(r) : ''}
    <div class="card mn-history">
      <h3>${mi.receipt} History</h3>
      ${r.history.length ? r.history.map((h) => `<div class="mn-hrow"><span class="grow">${esc(h.note ?? h.kind)}<small>${esc(DATE.format(new Date(h.created_at)))}</small></span><b class="${h.amount_pesewas >= 0 ? 'plus' : 'minus'}">${h.amount_pesewas >= 0 ? '+' : '−'}${money.ghs(Math.abs(h.amount_pesewas))}</b></div>`).join('')
        : '<p class="muted small">Nothing yet.</p>'}
      ${r.payouts.length ? `<h4>Cash-outs</h4>${r.payouts.map((x) => `<div class="mn-hrow"><span class="grow">${esc(NET_NAME[x.network] ?? x.network)} ${esc(x.momo_number)}<small>${esc(DATE.format(new Date(x.created_at)))}${x.failure_reason ? ` · ${esc(x.failure_reason)}` : ''}</small></span><span class="mn-status ${x.status}">${STATUS[x.status]}</span><b>${money.ghs(x.amount_pesewas)}</b></div>`).join('')}` : ''}
    </div>`);
  if (canCash) bindCashForm(r, back);
}

function cashForm(w: money.Wallet) {
  return `<form class="card stack mn-cash" id="mnCash" novalidate>
    <h3>${mi.phone} Cash out to Mobile Money</h3>
    <div class="field"><label for="mnAmt">Amount (GHS)</label><input id="mnAmt" inputmode="decimal" value="${(w.balance / 100).toFixed(2)}" autocomplete="off"></div>
    <div class="field"><label>Network</label><div class="mn-nets">${money.NETWORKS.map((n, i) => `<button type="button" class="chip-btn${i === 0 ? ' on' : ''}" data-net="${n.id}">${esc(n.name)}</button>`).join('')}</div></div>
    <div class="field"><label for="mnNum">Mobile Money number</label><input id="mnNum" type="tel" inputmode="tel" placeholder="024 123 4567" autocomplete="tel"></div>
    <div class="field"><label for="mnName">Name on the Mobile Money account</label><input id="mnName" autocomplete="name" placeholder="As registered with your network"></div>
    <label class="mn-check"><input type="checkbox" id="mnAdult"> <span>I am 18 or older, or my parent or guardian agrees to this cash-out.</span></label>
    <p class="mn-error" id="mnErr" hidden></p>
    <div id="mnConfirm"></div>
    <button class="btn btn-primary" id="mnGo">Continue</button>
  </form>`;
}

/** '024 123 4567' and '+233 24 123 4567' both become '0241234567'; null when it isn't a Ghana mobile number */
export function momoNumber(s: string) {
  const d = s.replace(/[^0-9]/g, '');
  const local = d.startsWith('233') ? '0' + d.slice(3) : d;
  return /^0[25][0-9]{8}$/.test(local) ? local : null;
}

function bindCashForm(w: money.Wallet, back: () => void) {
  const app = H().app;
  let net: string = money.NETWORKS[0].id;
  const q = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)!;
  const err = (m: string) => {
    const e = q<HTMLElement>('#mnErr');
    e.textContent = m;
    e.hidden = !m;
  };
  const form = q<HTMLFormElement>('#mnCash');
  const reset = () => {
    q<HTMLElement>('#mnConfirm').innerHTML = '';
    q<HTMLButtonElement>('#mnGo').hidden = false;
  };
  on('[data-net]', 'click', (_, el) => {
    net = el.dataset.net!;
    app.querySelectorAll('[data-net]').forEach((b) => b.classList.toggle('on', b === el));
    reset();
  });
  form.addEventListener('input', reset);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err('');
    const amount = Math.round(Number(q<HTMLInputElement>('#mnAmt').value.replace(/[^0-9.]/g, '')) * 100);
    const number = momoNumber(q<HTMLInputElement>('#mnNum').value);
    const name = q<HTMLInputElement>('#mnName').value.trim();
    if (!amount || amount < w.min) return err(`The smallest cash-out is ${money.ghs(w.min)}.`);
    if (amount > w.balance) return err(`You have ${money.ghs(w.balance)} in your wallet.`);
    if (!number) return err('Enter a Ghana Mobile Money number, like 024 123 4567.');
    if (name.length < 3) return err('Enter the name on the Mobile Money account.');
    if (!q<HTMLInputElement>('#mnAdult').checked) return err('Tick the box to confirm your age, or that a parent or guardian agrees.');
    q<HTMLButtonElement>('#mnGo').hidden = true;
    q<HTMLElement>('#mnConfirm').innerHTML = `<div class="mn-confirm">
      <p>Send <b>${money.ghs(amount)}</b> to <b>${esc(NET_NAME[net])} ${esc(number.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'))}</b> (${esc(name)})?</p>
      <p class="muted small">Check the number: money sent to the wrong number may not come back.</p>
      <div class="two"><button type="button" class="btn btn-ghost" id="mnEdit">Edit</button><button type="button" class="btn btn-primary" id="mnSend">Cash out</button></div>
    </div>`;
    on('#mnEdit', 'click', reset);
    on('#mnSend', 'click', async (_, el) => {
      (el as HTMLButtonElement).disabled = true;
      el.innerHTML = '<span class="mn-spin sm"></span> Sending…';
      const r = await money.cashOut({ amount, network: net, number, name, adult: true });
      set('#mnWallet', spinner('Updating your wallet…'));
      await loadWallet(back, r.ok ? { ok: true, message: r.message } : { ok: false, message: r.message });
    });
  });
}

// ===================== Terms =====================

export function termsScreen(back: () => void) {
  screen(`
    <p class="kicker">LEGONRUSH</p>
    <h1 class="title">Prize and payment terms</h1>
    <div class="card mn-terms">
      <h3>Weekly prize races</h3>
      <ul>
        <li><b>No purchase necessary.</b> Prize races are free to enter. Buying coins, bikes or upgrades does not improve your chances: every prize ride uses the same standard bike and settings, and results are judged on time only.</li>
        <li>Prizes are paid by LEGONRUSH and, when named, by the week's sponsor. The prize table is shown on the race screen before you ride.</li>
        <li>You need a LEGONRUSH account. One account per person. Only results sent from the Weekly prize race screen while the week is open count.</li>
        <li>Each result is checked by our server against the recording of the ride. We can refuse any result that doesn't match what the game allows, and may review winning rides before paying.</li>
        <li>The fastest accepted time per rider counts. If two riders tie, the one who set the time first ranks higher. Results are final when the week closes, Sunday 23:59 Ghana time.</li>
        <li>Cheating, modified games, bots, automated tools, sharing accounts or riding for someone else means disqualification, loss of prizes and possibly the account.</li>
      </ul>
      <h3>Wallet and cash-outs</h3>
      <ul>
        <li>Prize money is credited to your Wallet in Ghana cedis and can be cashed out to MTN MoMo, Telecel Cash or AirtelTigo Money in your own name.</li>
        <li>Riders under 18 may race, but need a parent or guardian's permission to cash out. We may ask for proof of identity or permission before paying.</li>
        <li>There is a minimum cash-out amount and one cash-out at a time. If a cash-out fails, the money goes back to your Wallet.</li>
        <li>Unclaimed prize money stays in your Wallet. You are responsible for entering the right number.</li>
      </ul>
      <h3>Buying Rush Coins</h3>
      <ul>
        <li>Payments are processed by Paystack. Prices are in Ghana cedis and shown before you pay.</li>
        <li><b>Rush Coins have no cash value.</b> They can't be cashed out, refunded for money, transferred or sold, and they are never prize money.</li>
        <li>Coins are added once Paystack confirms the payment. If you paid and didn't get your coins, contact us with the payment reference.</li>
      </ul>
      <p class="muted small">LEGONRUSH may change or cancel a prize race for a fair reason (for example a bug or fraud), announcing it in the game. Questions: contact LEGONRUSH through the game's social pages.</p>
    </div>`, back, 'mn-screen');
}

// ===================== hooks for main.ts =====================

/** the Wallet, Weekly prize race and Buy coins buttons for the You tab */
export function youMoneyHtml() {
  const b = (id: string, icon: string, label: string, extra = '') => `<button class="fx-link" data-money-open="${id}" data-money-back="you"><span class="fx-ico">${icon}</span><span>${label}</span>${extra}</button>`;
  return `<div class="fx-links mn-links">
    ${b('wallet', mi.wallet, 'Wallet')}
    ${b('prize', mi.podium, 'Prize race')}
    ${b('coins', icons.coin, 'Buy coins')}
  </div>`;
}

/** a Buy coins button for the garage header */
export const shopBuyHtml = () => `<button class="btn btn-ghost btn-sm mn-buy-btn" data-money-open="coins" data-money-back="garage">${icons.coin} Buy coins</button>`;

let ready = false;
/** Once: the coin pill on every menu and any [data-money-open] button open the money screens. */
export function initMoney() {
  if (ready) return;
  ready = true;
  H().app.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const pill = t.closest('.coin-pill');
    const el = t.closest<HTMLElement>('[data-money-open]');
    if (!pill && !el) return;
    const where = el?.dataset.moneyBack;
    const back = where === 'garage' ? () => H().garage() : where === 'you' || where === 'events' ? () => H().home(where) : () => H().home();
    const what = el?.dataset.moneyOpen ?? 'coins';
    if (what === 'wallet') walletScreen(back);
    else if (what === 'prize') prizeRaceScreen(back);
    else buyCoinsScreen(back);
  });
}

/** Back from Paystack (?reference=...), or coins confirmed while away: add them. Call after sign-in is restored. */
export async function afterLaunch() {
  const url = new URL(location.href);
  let ref = url.searchParams.get('reference') ?? url.searchParams.get('trxref');
  if (ref || url.searchParams.has('paid')) {
    for (const k of ['reference', 'trxref', 'paid']) url.searchParams.delete(k);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  try {
    ref ??= sessionStorage.getItem('legonrush.pay');
    sessionStorage.removeItem('legonrush.pay');
  } catch {
    /* fine */
  }
  if (!money.moneyOn() || !cloud.account) return;
  if (ref && /^[A-Za-z0-9_.=-]{6,80}$/.test(ref)) {
    // wait for the splash screen to hand over to the menus
    for (let i = 0; i < 40 && (H().app.querySelector('.splash') || !H().app.firstElementChild); i++) await new Promise((r) => setTimeout(r, 150));
    buyCoinsScreen(() => H().home(), { ref, status: 'checking' });
    return checkPayment(ref, () => H().home());
  }
  const n = await collectCoins();
  if (n) notice(`${icons.coin} <span><b>+${fmt(n)} Rush Coins</b> from your purchase. Thank you!</span>`, 'ok');
}
