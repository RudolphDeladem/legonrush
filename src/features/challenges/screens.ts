// Challenge screens: the details page (with creator controls), joining, entering a code, the
// leaderboard and the riders list.
import { icons } from '../../ui/icons';
import { routeMap } from '../../ui/mapview';
import { hallById, bikeById } from '../../data/campus';
import { H, esc, fmt, on, screen } from '../host';
import * as api from './api';
import { all, find, isCreator, joinChallenge, joined, leaveChallenge, refresh, setReminders } from './data';
import { cleanCode, chRoute, formatOf, accessOf, kmOf, maxPoolOf, phaseOf, poolOf, prizeSplit, raceTime, regOpen, templateOf, timeText, whenText, countdown, type Challenge } from './model';
import { accessChip, byline, chCard, copy, entryText, fmtTile, ic, linkOf, ridersText, shareText, statusBadge, ticker, empty } from './view';
import { attemptsLeft, ordinal, rideChallenge } from './ride';
import { lobbyScreen } from './lobby';
import { kindOf, photoOf } from './kinds';
import { createScreen } from './create';

const toTab = () => H().home('challenges');
let stopTick: (() => void) | null = null;
/** every screen here starts by stopping the last one's countdown */
function show(body: string, back: () => void, cls = '') {
  stopTick?.();
  screen(body, back, `chx-screen ${cls}`);
  stopTick = ticker(H().app);
}

const DIFF = ['', 'Easy', 'Moderate', 'Hard', 'Very hard', 'Extreme'];

function infoGrid(c: Challenge) {
  const r = chRoute(c.route);
  const pool = poolOf(c);
  const split = c.entryFee > 0 ? prizeSplit(pool || maxPoolOf(c), c.prize) : [];
  const cell = (icon: string, label: string, value: string) => `<div class="chx-cell"><span class="chx-cell-ico">${ic(icon)}</span><span><small>${label}</small><b>${value}</b></span></div>`;
  return `<div class="chx-grid">
    ${cell('pin', 'Route', `${esc(c.clues?.length ? `Hidden · ${r?.line ?? ''}` : r?.name ?? c.route)}`)}
    ${cell('flag', 'Distance', `${kmOf(c.route)} · ${DIFF[r?.difficulty ?? 2]}`)}
    ${cell(formatOf(c.format).icon, 'Format', `${esc(formatOf(c.format).name)}${c.attempts > 1 ? ` · best of ${c.attempts}` : c.attempts === 0 && c.format !== 'live_race' ? ' · ride often' : ''}`)}
    ${cell('clock', c.startNow ? 'Start' : phaseOf(c) === 'live' ? 'Started' : 'Starts', c.startNow && c.status !== 'live' ? 'When riders are ready' : esc(whenText(c.startsAt)))}
    ${cell('lock', 'Registration closes', c.regClosesAt >= c.endsAt ? 'When it ends' : esc(whenText(c.regClosesAt)))}
    ${cell('events', 'Ends', esc(whenText(c.endsAt)))}
    ${cell('social', 'Riders', ridersText(c))}
    ${cell('coin', 'Entry', c.entryFee > 0 ? `${fmt(c.entryFee)} coins` : 'Free')}
    ${c.entryFee > 0 ? cell('trophy', 'Prize pool', `${fmt(pool)} coins${pool < maxPoolOf(c) ? ` <small>(up to ${fmt(maxPoolOf(c))})</small>` : ''}`) : ''}
    ${cell(accessOf(c.access).icon, 'Access', accessChip(c).replace(/<[^>]+>/g, '').trim())}
  </div>
  ${split.length ? `<div class="chx-prizes">${split.map((v, i) => `<span><i class="p${i + 1}">${ordinal(i + 1)}</i>${fmt(v)} ${icons.coin}</span>`).join('')}<small class="muted">${esc(templateOf(c.prize).name)} · worked out from the riders who join. Coins only.</small></div>` : ''}`;
}

/** the big clock at the top of a challenge */
function clockBox(c: Challenge) {
  const ph = phaseOf(c);
  const now = Date.now();
  if (ph === 'cancelled') return `<div class="chx-clock off"><small>Cancelled</small><b>This challenge was cancelled</b>${c.entryFee ? '<span>Entry fees are refunded.</span>' : ''}</div>`;
  if (ph === 'ended') return `<div class="chx-clock off"><small>Challenge ended</small><b>${esc(whenText(c.endsAt))}</b><span>The leaderboard stays open.</span></div>`;
  if (ph === 'live') return c.format === 'live_race'
    ? `<div class="chx-clock live"><small><i></i>Live now</small><b>Started <span data-up="${c.startsAt}">${countdown(now - c.startsAt)}</span> ago</b><span>${regOpen(c) ? 'Riders can still join.' : 'Race in progress.'}</span></div>`
    : `<div class="chx-clock live"><small><i></i>Open now</small><b>Ends in <span data-cd="${c.endsAt}" data-zero="Ended">${countdown(c.endsAt - now)}</span></b><span>Ride any time before then.</span></div>`;
  if (c.startNow) return `<div class="chx-clock soon"><small>Start now</small><b>Starts when everyone is ready</b><span>Open the lobby and press Ready.</span></div>`;
  return `<div class="chx-clock ${ph}"><small>Starts in</small><b data-cd="${c.startsAt}">${countdown(c.startsAt - now)}</b><span>${esc(whenText(c.startsAt))}${c.regClosesAt < c.startsAt ? ` · registration closes ${timeText(c.regClosesAt)}` : ''}</span></div>`;
}

export function detailScreen(c0: Challenge, back: () => void = toTab) {
  const c = find(c0.id) ?? c0;
  const ph = phaseOf(c);
  const mine = joined(c);
  const creator = isCreator(c);
  const m = api.mine(c.id);
  const left = attemptsLeft(c);
  const canRide = (ph === 'live') && c.format !== 'live_race' && (mine || (c.official && c.entryFee === 0)) && left > 0;
  let primary = '';
  if (ph === 'ended' || ph === 'cancelled') primary = `<button class="btn btn-primary" id="cxBoard">${icons.trophy} See results</button>`;
  else if (c.format === 'live_race' && mine) primary = `<button class="btn btn-primary" id="cxLobby">${icons.flag} Open the lobby</button>`;
  else if (canRide) primary = `<button class="btn btn-primary" id="cxRide">${icons.bike} ${m?.attempts ? 'Ride again' : 'Ride now'}${c.attempts > 1 ? ` · attempt ${m ? m.attempts + 1 : 1} of ${c.attempts}` : ''}</button>`;
  else if (!mine && regOpen(c)) primary = `<button class="btn btn-primary" id="cxJoin">Join challenge${c.entryFee ? ` · ${fmt(c.entryFee)} ${icons.coin}` : ''}</button>`;
  else if (mine && ph !== 'live') primary = `<div class="chx-note">${icons.check} You're registered. ${c.format === 'live_race' ? 'Open the lobby before the start.' : `It opens ${esc(whenText(c.startsAt))}.`}</div>`;
  else if (mine && left <= 0) primary = `<div class="chx-note">${icons.check} You've used all ${c.attempts} attempts. Your best: ${m?.best ? raceTime(m.best) : '—'}</div>`;
  else if (ph === 'live' && c.format === 'live_race') primary = `<div class="chx-note">${icons.flag} Race in progress. Check the leaderboard when it ends.</div>`;
  else primary = `<div class="chx-note">${icons.lock} Registration is closed.</div>`;

  show(`
    <div class="chx-hero-photo" style="background-image:url('${photoOf(c)}')"></div>
    <p class="kicker">${ic(kindOf(c).icon)} ${esc(kindOf(c).name)} · ${esc(formatOf(c.format).name)}${c.official ? ' · Official' : ''}</p>
    <h1 class="title">${esc(c.name)}</h1>
    <p class="chx-by">${byline(c)}${c.code ? ` · <span class="chx-code">${esc(c.code)}</span>` : ''}</p>
    ${clockBox(c)}
    ${c.description ? `<p class="chx-desc">${esc(c.description)}</p>` : ''}
    ${c.clues?.length ? `<div class="card chx-clues"><b>${icons.search} Clues</b><ol>${c.clues.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p class="muted small">Work it out first. The ride shows the way once you start, and the clock is running.</p></div>` : ''}
    ${primary}
    ${m?.best ? `<div class="card chx-mine-best"><span class="chx-tile">${icons.trophy}</span><span class="grow"><small class="muted">Your best</small><b>${raceTime(m.best)}</b></span>${m.place ? `<span class="badge gold">${ordinal(m.place)} place</span>` : ''}${c.attempts > 0 ? `<span class="muted small">${m.attempts}/${c.attempts} tries</span>` : ''}</div>` : ''}
    <div class="card chx-info">${infoGrid(c)}</div>
    ${c.clues?.length ? '' : `<div class="card chx-map"><canvas id="cxMap" width="720" height="360" aria-label="Route map"></canvas><p class="muted small">${esc(chRoute(c.route)?.line ?? '')}</p></div>`}
    <div class="chx-actions">
      <button class="btn btn-ghost" id="cxBoard2">${icons.trophy} Leaderboard</button>
      <button class="btn btn-ghost" id="cxShare">${icons.send} Share</button>
      ${c.code ? `<button class="btn btn-ghost" id="cxCode">${icons.copy} Copy code</button>` : ''}
      <button class="btn btn-ghost" id="cxLink">${icons.link} Copy link</button>
    </div>
    <p class="muted small chx-copied" id="cxNote" hidden></p>
    ${mine && ph !== 'ended' && ph !== 'cancelled' && c.startsAt > Date.now() ? `<label class="chx-toggle"><input type="checkbox" id="cxRemind" ${api.local().remind ? 'checked' : ''}><span>${icons.bell} Remind me the day before, 30 minutes before and at the start</span></label>` : ''}
    ${creator ? creatorPanel(c) : ''}
    ${mine && !creator && (ph === 'upcoming' || ph === 'soon') ? `<button class="btn btn-link" id="cxLeave">Leave this challenge${m?.paid ? ` (refund ${fmt(m.paid)} coins)` : ''}</button>` : ''}
    ${!c.official && !creator ? `<button class="btn btn-link chx-report" id="cxReport">${icons.alert} Report this challenge</button>` : ''}
  `, back);
  const note = H().app.querySelector<HTMLElement>('#cxNote');
  setTimeout(() => {
    const cv = H().app.querySelector<HTMLCanvasElement>('#cxMap');
    if (cv) try { routeMap(cv, chRoute(c.route)!.build()); } catch { cv.remove(); }
  }, 60);
  const again = () => detailScreen(c, back);
  on('#cxJoin', 'click', () => joinScreen(c, again));
  on('#cxLobby', 'click', () => lobbyScreen(c, again));
  on('#cxRide', 'click', () => void rideChallenge(c));
  on('#cxBoard', 'click', () => boardScreen(c, again));
  on('#cxBoard2', 'click', () => boardScreen(c, again));
  on('#cxShare', 'click', () => H().share(shareText(c), linkOf(c), note!));
  on('#cxCode', 'click', () => copy(c.code, note, `Code ${c.code} copied`));
  on('#cxLink', 'click', () => copy(linkOf(c), note, 'Link copied'));
  on('#cxRemind', 'change', (_, el) => {
    const s = api.local();
    s.remind = (el as HTMLInputElement).checked;
    api.saveLocal();
    setReminders(c);
  });
  on('#cxLeave', 'click', async (_, el) => {
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Tap again to leave'; return; }
    const r = await leaveChallenge(c);
    if (!r.ok) return H().toast(esc(r.message));
    H().toast('You left the challenge.');
    again();
  });
  on('#cxReport', 'click', () => reportSheet(c));
  if (creator) bindCreator(c, again);
  // fresh numbers from the server, then redraw if anything changed
  if (!c.official && api.online()) void api.getOne(c.id).then((r) => {
    if (!r.ok || !r.data || !H().app.querySelector('#cxMap')) return;
    const n = r.data;
    if (n.riders !== c.riders || n.status !== c.status || n.regClosesAt !== c.regClosesAt) {
      const s = api.local();
      s.cache = [...s.cache.filter((x) => x.id !== n.id), n];
      if (s.mine[n.id]) s.mine[n.id].snap = n;
      api.saveLocal();
      detailScreen(n, back);
    }
  });
}

// ---------- creator controls ----------

function creatorPanel(c: Challenge) {
  const ph = phaseOf(c);
  const over = ph === 'ended' || ph === 'cancelled';
  const others = Math.max(0, c.riders - 1);
  return `<div class="card chx-creator stack">
    <div class="row"><b>${icons.gear} Your challenge</b><span class="grow"></span><span class="badge">${others} rider${others === 1 ? '' : 's'} joined</span></div>
    ${over ? '' : `
    <div class="chx-actions">
      ${others === 0 && ph !== 'live' ? `<button class="btn btn-ghost btn-sm" id="cxEdit">${icons.gear} Edit</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="cxInvite">${icons.mail} Invite riders</button>
      <button class="btn btn-ghost btn-sm" id="cxRiders">${icons.social} Riders</button>
      ${regOpen(c) && c.regClosesAt > Date.now() ? `<button class="btn btn-ghost btn-sm" id="cxClose">${icons.lock} Close registration</button>` : ''}
      ${c.format === 'live_race' && c.startNow ? `<button class="btn btn-ghost btn-sm" id="cxStart">${icons.flag} Start from the lobby</button>` : ''}
    </div>
    <div id="cxInviteBox" hidden class="stack chx-invite">
      <div class="field"><label for="cxUsers">Usernames, separated by commas</label><input id="cxUsers" autocapitalize="off" autocomplete="off" placeholder="@kofi, @ama"></div>
      <button class="btn btn-primary btn-sm" id="cxSendInv">${icons.send} Send invitations</button>
    </div>
    <p class="muted small">${others > 0 ? 'Riders have joined, so the route, time and fees are locked.' : 'You can edit everything until someone joins.'}</p>
    ${ph === 'live' && c.format === 'live_race' ? '' : `<button class="btn btn-link chx-danger" id="cxCancel">${icons.ban} Cancel challenge${c.entryFee && others ? ' (entry fees refunded)' : ''}</button>`}`}
    <button class="btn btn-ghost btn-sm" id="cxStats">${icons.trophy} Results and stats</button>
  </div>`;
}

function bindCreator(c: Challenge, again: () => void) {
  on('#cxEdit', 'click', () => createScreen(again, c));
  on('#cxInvite', 'click', () => { const b = H().app.querySelector<HTMLElement>('#cxInviteBox')!; b.hidden = !b.hidden; });
  on('#cxSendInv', 'click', async (_, el) => {
    const names = (H().app.querySelector<HTMLInputElement>('#cxUsers')!.value).split(/[\s,]+/).map((s) => s.replace(/^@/, '').trim()).filter((s) => /^[A-Za-z0-9_.]{2,20}$/.test(s));
    if (!names.length) return H().toast('Type at least one username.');
    (el as HTMLButtonElement).disabled = true;
    const r = await api.invite(c.id, names.slice(0, 20));
    H().toast(r.ok ? `${icons.check} Invited ${r.data} rider${r.data === 1 ? '' : 's'}. They'll see it in their Invitations.` : esc(r.message));
    (el as HTMLButtonElement).disabled = false;
  });
  on('#cxRiders', 'click', () => ridersScreen(c, again));
  on('#cxStats', 'click', () => boardScreen(c, again));
  on('#cxStart', 'click', () => lobbyScreen(c, again));
  on('#cxClose', 'click', async () => {
    const r = await api.closeRegistration(c.id);
    if (!r.ok) return H().toast(esc(r.message));
    H().toast(`${icons.lock} Registration closed.`);
    await refresh(true);
    detailScreen(find(c.id) ?? { ...c, regClosesAt: Date.now() });
  });
  on('#cxCancel', 'click', async (_, el) => {
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.innerHTML = `${icons.ban} Tap again to cancel. This can't be undone.`; return; }
    const r = await api.cancel(c.id);
    if (!r.ok) return H().toast(esc(r.message));
    H().toast('Challenge cancelled. Riders who paid get their coins back.');
    await refresh(true);
    detailScreen(find(c.id) ?? { ...c, status: 'cancelled' });
  });
}

function reportSheet(c: Challenge) {
  const reasons = ['Offensive name or description', 'Spam or scam', 'Cheating', 'Something else'];
  const sh = document.createElement('div');
  sh.className = 'overlay sheet-overlay fade-in';
  sh.innerHTML = `<div class="sheet light-ui chx-sheet" role="dialog" aria-label="Report"><div class="row"><h2 class="title" style="font-size:22px">Report challenge</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    <p class="muted small">Admins review every report. The creator isn't told who reported it.</p>
    <div class="stack">${reasons.map((r) => `<button class="btn btn-ghost" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>`;
  document.body.appendChild(sh);
  sh.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-reason]');
    if (b) {
      sh.remove();
      if (!api.online()) return H().toast('Sign in to report challenges.');
      const r = await api.report(c.id, b.dataset.reason!);
      H().toast(r.ok ? 'Thanks. An admin will take a look.' : esc(r.message));
      return;
    }
    if (e.target === sh || (e.target as HTMLElement).closest('[data-close]')) sh.remove();
  });
}

// ---------- joining ----------

export function joinScreen(c: Challenge, back: () => void = () => detailScreen(c)) {
  const p = H().profile();
  const r = chRoute(c.route);
  const short = c.entryFee > p.coins;
  const needAccount = !c.official && !api.online();
  const pool = poolOf(c) + c.entryFee;
  show(`
    <p class="kicker">${icons.flag} Join challenge</p>
    <h1 class="title">${esc(c.name)}</h1>
    <div class="card chx-confirm">
      <div class="chx-confirm-row"><span>Created by</span><b>${c.official ? 'LEGONRUSH (official)' : esc(c.creator?.username ? '@' + c.creator.username : c.creator?.name ?? 'A rider')}</b></div>
      <div class="chx-confirm-row"><span>${icons.pin} Route</span><b>${esc(r?.name ?? c.route)} · ${kmOf(c.route)}</b></div>
      <div class="chx-confirm-row"><span>${ic(formatOf(c.format).icon)} Format</span><b>${esc(formatOf(c.format).name)}${c.attempts > 1 ? ` · best of ${c.attempts}` : ''}</b></div>
      <div class="chx-confirm-row"><span>${icons.clock} ${phaseOf(c) === 'live' ? 'Open until' : 'Starts'}</span><b>${c.startNow ? 'When everyone is ready' : esc(whenText(phaseOf(c) === 'live' ? c.endsAt : c.startsAt))}</b></div>
      <div class="chx-confirm-row"><span>${icons.social} Riders</span><b>${ridersText(c)}</b></div>
      <div class="chx-confirm-row"><span>${icons.coin} Entry</span><b>${c.entryFee ? `${fmt(c.entryFee)} coins` : 'Free'}</b></div>
      ${c.entryFee ? `<div class="chx-confirm-row"><span>${icons.trophy} Prize pool</span><b>${fmt(pool)} coins with you</b></div>` : ''}
      <div class="chx-confirm-row"><span>${ic(accessOf(c.access).icon)} Access</span><b>${accessChip(c).replace(/<[^>]+>/g, '').trim()}</b></div>
    </div>
    ${c.entryFee ? `<p class="muted small">${icons.shield} Paid challenges are a level field: everyone rides the City bike with no upgrades or shop items, and every result is checked. Leave before the start for a full refund.</p>` : ''}
    ${short ? `<div class="chx-warn">${icons.close}<span><b>Not enough Rush Coins</b>You need ${fmt(c.entryFee)} ${icons.coin} to join. Your balance: ${fmt(p.coins)} ${icons.coin}</span></div>` : ''}
    ${needAccount ? `<div class="chx-warn">${icons.user}<span><b>Sign in to join</b>Rider challenges need an account, so your place and prize are saved.</span></div>` : ''}
    <button class="btn btn-primary" id="cxDo" ${short || needAccount ? 'disabled' : ''}>Join challenge${c.entryFee ? ` · ${fmt(c.entryFee)} ${icons.coin}` : ''}</button>
    <p class="muted small chx-balance">${icons.coin} Your balance: ${fmt(p.coins)}${c.entryFee && !short ? ` → ${fmt(p.coins - c.entryFee)} after joining` : ''}</p>
  `, back);
  on('#cxDo', 'click', async (_, el) => {
    (el as HTMLButtonElement).disabled = true;
    el.textContent = 'Joining…';
    const res = await joinChallenge(c);
    if (!res.ok) {
      (el as HTMLButtonElement).disabled = false;
      el.innerHTML = `Join challenge${c.entryFee ? ` · ${fmt(c.entryFee)} ${icons.coin}` : ''}`;
      return H().toast(esc(res.message));
    }
    joinedScreen(find(c.id) ?? { ...c, joined: true });
  });
}

function joinedScreen(c: Challenge) {
  const ph = phaseOf(c);
  show(`
    <div class="chx-done">
      <span class="chx-done-ico">${icons.check}</span>
      <h1 class="title">You're in!</h1>
      <p class="muted">${esc(c.name)} · ${ph === 'live' ? (c.format === 'live_race' ? 'racing now' : 'open now') : esc(whenText(c.startsAt))}</p>
    </div>
    ${ph !== 'live' && api.local().remind ? `<p class="muted small">${icons.bell} We'll remind you the day before, 30 minutes before and when it starts.</p>` : ''}
    ${c.format === 'live_race' ? `<button class="btn btn-primary" id="cxGo">${icons.flag} Open the lobby</button>` : ph === 'live' ? `<button class="btn btn-primary" id="cxGo">${icons.bike} Ride now</button>` : ''}
    <button class="btn btn-ghost" id="cxShare">${icons.send} Invite friends</button>
    <button class="btn btn-ghost" id="cxBack">Back to the challenge</button>
    <p class="muted small" id="cxNote" hidden></p>
  `, () => detailScreen(c));
  on('#cxGo', 'click', () => (c.format === 'live_race' ? lobbyScreen(c) : void rideChallenge(c)));
  on('#cxShare', 'click', () => H().share(shareText(c), linkOf(c), H().app.querySelector('#cxNote')!));
  on('#cxBack', 'click', () => detailScreen(c));
}

// ---------- codes and links ----------

export function codeScreen(back: () => void = toTab, prefill = '') {
  show(`
    <p class="kicker">${icons.key} Private challenge</p>
    <h1 class="title">Enter a code</h1>
    <p class="muted">Private challenges don't show up in search. Type the code a friend sent you, or paste their invite link.</p>
    <div class="field"><label for="cxCodeIn">Challenge code</label><input id="cxCodeIn" class="chx-code-in" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="LR-7K29X" value="${esc(prefill)}"></div>
    <button class="btn btn-primary" id="cxFind">${icons.search} Find challenge</button>
    <div id="cxFound"></div>
  `, back);
  const input = H().app.querySelector<HTMLInputElement>('#cxCodeIn')!;
  const box = H().app.querySelector<HTMLElement>('#cxFound')!;
  const go = async () => {
    const code = cleanCode(input.value);
    if (!code) { box.innerHTML = `<p class="chx-bad small">That doesn't look like a challenge code. Codes look like LR-7K29X.</p>`; return; }
    box.innerHTML = '<p class="muted small">Looking…</p>';
    const local = all().find((c) => c.code === code);
    const r = local ? { ok: true as const, data: local } : await api.byCode(code);
    if (!r.ok) { box.innerHTML = `<p class="chx-bad small">${esc(r.message)}</p>`; return; }
    if (!r.data) { box.innerHTML = `<p class="chx-bad small">No challenge with the code ${esc(code)}. Check it with your friend.</p>`; return; }
    const c = r.data;
    box.innerHTML = `<p class="kicker" style="margin-top:6px">${icons.check} Challenge found</p>`;
    const card = document.createElement('div');
    card.innerHTML = chCard(c);
    box.appendChild(card.firstElementChild!);
    box.querySelector('[data-chx-open]')!.addEventListener('click', () => detailScreen(c, () => codeScreen(back, code)));
  };
  on('#cxFind', 'click', () => void go());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void go(); });
  if (prefill) void go();
  else setTimeout(() => input.focus(), 50);
}

// ---------- leaderboard and riders ----------

export function boardScreen(c0: Challenge, back: () => void = () => detailScreen(c0)) {
  const c = find(c0.id) ?? c0;
  const m = api.mine(c.id);
  const creator = isCreator(c);
  show(`
    <p class="kicker">${icons.trophy} Leaderboard</p>
    <h1 class="title">${esc(c.name)}</h1>
    <p class="chx-by">${esc(chRoute(c.route)?.name ?? '')} · ${esc(formatOf(c.format).name)} · ${statusBadge(c)}</p>
    ${m?.best ? `<div class="card chx-mine-best"><span class="chx-tile">${icons.bike}</span><span class="grow"><small class="muted">Your best</small><b>${raceTime(m.best)}</b>${m.prev ? `<small class="muted">Before that: ${raceTime(m.prev)}</small>` : ''}</span>${m.place ? `<span class="badge gold">${ordinal(m.place)}</span>` : ''}</div>` : ''}
    ${creator ? '<div class="card chx-stats" id="cxStatsBox"><p class="muted small">Loading stats…</p></div>' : ''}
    <div class="card chx-board" id="cxBoardBox"><p class="muted small">Loading…</p></div>
  `, back);
  const box = H().app.querySelector<HTMLElement>('#cxBoardBox')!;
  if (!api.online()) {
    box.innerHTML = empty('trophy', 'Sign in to see the leaderboard', m?.best ? `Your best here is ${raceTime(m.best)}. Sign in so it counts and you can see everyone else's times.` : "Sign in to post your times and see everyone else's.");
    return;
  }
  void api.board(c.id).then((r) => {
    if (!r.ok) { box.innerHTML = empty('wifiOff', "Couldn't load the leaderboard", esc(r.message)); return; }
    if (!r.data.length) { box.innerHTML = empty('flag', 'No times yet', phaseOf(c) === 'ended' ? 'Nobody finished this one.' : 'Be the first on the board.'); return; }
    box.innerHTML = `<div class="chx-brow head"><span>#</span><span>Rider</span><span>Hall</span><span>Tries</span><span>Time</span></div>` + r.data.slice(0, 100).map((b) => `
      <div class="chx-brow${b.me ? ' me' : ''}${b.rank <= 3 ? ` top p${b.rank}` : ''}">
        <span class="rk">${b.rank}</span>
        <span class="who"><b>${esc(b.name)}</b>${b.username ? `<small>@${esc(b.username)}</small>` : ''}${b.me ? `<small class="pb">${m?.best && Math.abs(m.best - b.best) < 0.01 ? 'Your personal best' : 'You'}</small>` : ''}</span>
        <span class="hall">${esc(hallById(b.hall).short)}</span>
        <span class="tries">${b.attempts}</span>
        <b class="tm">${raceTime(b.best)}</b>
      </div>`).join('');
  });
  if (creator) void api.stats(c.id).then((r) => {
    const el = H().app.querySelector<HTMLElement>('#cxStatsBox');
    if (!el) return;
    if (!r.ok) { el.innerHTML = `<p class="muted small">${esc(r.message)}</p>`; return; }
    const s = r.data;
    el.innerHTML = `<b>${icons.gear} Creator stats</b><div class="chx-statgrid">
      <span><small>Participants</small><b>${s.participants}</b></span>
      <span><small>Finished</small><b>${s.finishers}</b></span>
      <span><small>Average time</small><b>${s.average ? raceTime(s.average) : '—'}</b></span>
      <span><small>Fastest</small><b>${s.fastest ? raceTime(s.fastest) : '—'}</b></span></div>
      <p class="muted small">The top 10 are at the top of the leaderboard below.</p>`;
  });
}

export function ridersScreen(c: Challenge, back: () => void = () => detailScreen(c)) {
  show(`
    <p class="kicker">${icons.social} Riders</p>
    <h1 class="title">${esc(c.name)}</h1>
    <div class="card" id="cxRidersBox"><p class="muted small">Loading…</p></div>
  `, back);
  const box = H().app.querySelector<HTMLElement>('#cxRidersBox')!;
  void api.entries(c.id).then((r) => {
    if (!r.ok) { box.innerHTML = empty('wifiOff', "Couldn't load the riders", esc(r.message)); return; }
    box.innerHTML = r.data.length ? r.data.map((e) => riderRow(e)).join('') : empty('social', 'Nobody yet', 'Share the code to get riders in.');
  });
}

export function riderRow(e: { name: string; username?: string | null; hall: string; bike: string; level: number; me?: boolean }, status = '') {
  const h = hallById(e.hall);
  return `<div class="chx-rider${e.me ? ' me' : ''}">
    <span class="chx-av" style="background:${h.color}">${esc(e.name.slice(0, 1).toUpperCase())}</span>
    <span class="grow"><b>${esc(e.username ? '@' + e.username : e.name)}${e.me ? ' (you)' : ''}</b><small>Lv.${e.level} · ${esc(h.short)} · ${esc(bikeById(e.bike).name)} bike</small></span>
    ${status}
  </div>`;
}
export { entryText, fmtTile };
