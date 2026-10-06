// Create a challenge: a short wizard (route, name, format, who can join, entry and prize, when),
// then the creation fee. The same screens edit a challenge until someone joins.
import { icons } from '../../ui/icons';
import { routeMap } from '../../ui/mapview';
import { hallById } from '../../data/campus';
import { loadGhost } from '../../state';
import { H, esc, fmt, on, screen } from '../host';
import { spend, grant } from '../inventory';
import { postActivity } from '../activity';
import * as api from './api';
import { refresh, find } from './data';
import {
  ACCESS, CH_ROUTES, EXPIRY, FORMATS, PRIZE_TEMPLATES, RIDER_LIMITS, chRoute, formatOf, accessOf, prizeSplit, raceTime, whenText, kmOf,
  type Access, type Challenge, type Format,
} from './model';
import { ic, linkOf, shareText, copy } from './view';
import { detailScreen, joinScreen } from './screens';

interface Draft {
  step: number;
  route: string;
  name: string;
  description: string;
  format: Format;
  attempts: number;
  access: Access;
  maxRiders: number;
  paid: boolean;
  entryFee: number;
  prize: string;
  startNow: boolean;
  date: string;
  time: string;
  /** minutes before the start that registration closes; -1 = when it ends */
  closeBefore: number;
  expiryH: number;
}

const STEPS = ['Route', 'Name', 'Format', 'Riders', 'Entry', 'Schedule', 'Review'];
const DIFF = ['', 'Easy', 'Moderate', 'Hard', 'Very hard', 'Extreme'];
const stars = (n: number) => `<span class="chx-diff" aria-label="Difficulty ${n} of 5">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

function newDraft(): Draft {
  const t = new Date(Date.now() + 2 * 3600e3);
  t.setMinutes(t.getMinutes() < 30 ? 30 : 60, 0, 0);
  return {
    step: 0, route: 'engineering-run', name: '', description: '', format: 'time_trial', attempts: 3, access: 'open', maxRiders: 10,
    paid: false, entryFee: 100, prize: 'top3', startNow: false, date: t.toLocaleDateString('en-CA'), time: t.toTimeString().slice(0, 5),
    closeBefore: 10, expiryH: 24,
  };
}
function fromChallenge(c: Challenge): Draft {
  const d = new Date(c.startsAt);
  const close = c.regClosesAt >= c.endsAt ? -1 : Math.round((c.startsAt - c.regClosesAt) / 60e3);
  return {
    step: 0, route: c.route, name: c.name, description: c.description, format: c.format, attempts: c.attempts || 3, access: c.access, maxRiders: c.maxRiders,
    paid: c.entryFee > 0, entryFee: c.entryFee || 100, prize: c.prize, startNow: c.startNow, date: d.toLocaleDateString('en-CA'), time: d.toTimeString().slice(0, 5),
    closeBefore: close, expiryH: Math.round((c.endsAt - c.startsAt) / 3600e3) || 24,
  };
}

/** the times a draft works out to */
function timesOf(d: Draft) {
  const startsAt = d.startNow ? Date.now() : new Date(`${d.date}T${d.time}`).getTime();
  const endsAt = startsAt + d.expiryH * 3600e3;
  const trial = d.format !== 'live_race';
  // "Start now": open until it ends (a live race closes when it starts in the lobby)
  const regClosesAt = d.closeBefore < 0 || d.startNow ? endsAt : startsAt - d.closeBefore * 60e3;
  return { startsAt, endsAt, regClosesAt };
}

function problems(d: Draft, step: number): string | null {
  const cfg = api.local().config;
  if (step === 0 && cfg.disabledRoutes.includes(d.route)) return 'That route is closed for challenges right now.';
  if (step === 1) {
    if (d.name.trim().length < 3) return 'Give your challenge a name (at least 3 letters).';
    if (d.name.trim().length > 40) return 'Keep the name to 40 letters.';
  }
  if (step === 2) {
    if (cfg.disabledFormats.includes(d.format) || formatOf(d.format).soon) return `${formatOf(d.format).name} isn't available yet.`;
    if (d.format === 'ghost' && !loadGhost(d.route)) return `Ghost challenges race your recorded run. Ride ${chRoute(d.route)!.name} once first, then come back.`;
  }
  if (step === 3 && d.access === 'hall' && (!H().profile().hall || H().profile().hall === 'none')) return 'Pick your hall in your profile to make a Hall only challenge.';
  if (step === 4 && d.paid) {
    if (d.entryFee < cfg.entryMin || d.entryFee > cfg.entryMax) return `Entry fees go from ${fmt(cfg.entryMin)} to ${fmt(cfg.entryMax)} coins.`;
    if (d.entryFee * d.maxRiders > cfg.maxPool) return `The prize pool can be at most ${fmt(cfg.maxPool)} coins. Lower the fee or the rider limit.`;
  }
  if (step === 5 && !d.startNow) {
    const t = timesOf(d);
    if (!Number.isFinite(t.startsAt)) return 'Pick a date and a time.';
    if (t.startsAt < Date.now() + 5 * 60e3) return 'Pick a start at least 5 minutes from now, or choose Start now.';
    if (t.startsAt > Date.now() + 30 * 86400e3) return 'Challenges can be scheduled up to 30 days ahead.';
    if (t.regClosesAt <= Date.now()) return 'Registration would already be closed. Close it later, or start later.';
  }
  return null;
}

export function createScreen(back: () => void = () => H().home('challenges'), editing?: Challenge, draft?: Draft) {
  const d = draft ?? (editing ? fromChallenge(editing) : newDraft());
  const p = H().profile();
  const cfg = api.local().config;
  const step = d.step;
  const redraw = () => createScreen(back, editing, d);
  const next = () => {
    const bad = problems(d, step);
    if (bad) { const el = H().app.querySelector<HTMLElement>('#cwErr'); if (el) { el.hidden = false; el.textContent = bad; } return; }
    d.step = Math.min(STEPS.length - 1, step + 1);
    redraw();
  };
  const prev = () => { if (step === 0) back(); else { d.step--; redraw(); } };

  let body = '';
  if (step === 0) {
    body = `<h2 class="chx-step-h">Pick a route</h2>
      <div class="chx-routes">${CH_ROUTES.map((r) => {
        const off = cfg.disabledRoutes.includes(r.id);
        const best = p.bestTimes[r.id];
        return `<button class="chx-route${d.route === r.id ? ' on' : ''}" data-route="${r.id}" ${off ? 'disabled' : ''}>
          <span class="grow"><b>${esc(r.name)}</b><small>${esc(r.line)}</small>
          <span class="chx-route-meta"><span>${kmOf(r.id)}</span><span>${stars(r.difficulty)} ${DIFF[r.difficulty]}</span><span>${best ? `${icons.trophy} Your best ${raceTime(best)}` : 'No time yet'}</span></span></span>
          ${off ? '<span class="badge">Closed</span>' : d.route === r.id ? `<span class="chx-check">${icons.check}</span>` : ''}
        </button>`;
      }).join('')}</div>
      <div class="card chx-map"><canvas id="cwMap" width="720" height="320" aria-label="Route preview"></canvas><p class="muted small">${esc(chRoute(d.route)!.line)} · ${kmOf(d.route)} · ${DIFF[chRoute(d.route)!.difficulty]}</p></div>`;
  } else if (step === 1) {
    const best = p.bestTimes[d.route];
    const r = chRoute(d.route)!;
    const ideas = [best ? `Beat My ${r.name} Time` : `${r.name} Showdown`, `${r.name} Sprint`, `${hallById(p.hall).short} ${r.name} Challenge`];
    body = `<h2 class="chx-step-h">Name your challenge</h2>
      <div class="field"><label for="cwName">Challenge name</label><input id="cwName" maxlength="40" autocomplete="off" value="${esc(d.name)}" placeholder="${esc(ideas[0])}"></div>
      <div class="chx-chips">${ideas.map((n) => `<button class="chip-btn" data-idea="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="field"><label for="cwDesc">Description (optional)</label><textarea id="cwDesc" maxlength="160" rows="3" placeholder="${best ? `I got ${raceTime(best)}. Think you can beat me?` : 'Tell riders what this is about.'}">${esc(d.description)}</textarea></div>
      <p class="muted small">Keep it friendly. Names and descriptions can be reported and removed.</p>`;
  } else if (step === 2) {
    body = `<h2 class="chx-step-h">Choose a format</h2>
      <div class="chx-opts">${FORMATS.map((f) => {
        const off = f.soon || cfg.disabledFormats.includes(f.id);
        return `<button class="chx-opt${d.format === f.id ? ' on' : ''}" data-format="${f.id}" ${off ? 'disabled' : ''}><span class="chx-tile f-${f.id}">${ic(f.icon)}</span><span class="grow"><b>${esc(f.name)}</b><small>${esc(f.line)}</small></span>${off ? `<span class="badge">${f.soon ? 'Coming soon' : 'Off'}</span>` : ''}</button>`;
      }).join('')}</div>
      ${d.format === 'best_of' ? `<div class="field"><label>Attempts per rider</label><div class="chx-chips">${[2, 3, 5].map((n) => `<button class="chip-btn${d.attempts === n ? ' on' : ''}" data-attempts="${n}">${n} attempts</button>`).join('')}</div><p class="muted small">Best time counts.</p></div>` : ''}
      ${d.format === 'ghost' ? `<p class="muted small">${icons.ghost} ${loadGhost(d.route) ? `Riders race your best recorded run on ${esc(chRoute(d.route)!.name)} (${raceTime(loadGhost(d.route)!.time)}).` : `You haven't recorded a run on ${esc(chRoute(d.route)!.name)} yet. Ride it once first.`}</p>` : ''}
      ${d.format === 'live_race' ? `<p class="muted small">${icons.flag} Everyone waits in the lobby and starts together. Up to 10 riders.</p>` : ''}`;
  } else if (step === 3) {
    body = `<h2 class="chx-step-h">Who can join?</h2>
      <div class="chx-opts">${ACCESS.map((a) => `<button class="chx-opt${d.access === a.id ? ' on' : ''}" data-access="${a.id}"><span class="chx-tile">${ic(a.icon)}</span><span class="grow"><b>${esc(a.id === 'hall' ? `${hallById(p.hall).short} only` : a.name)}</b><small>${esc(a.line)}</small></span></button>`).join('')}</div>
      <div class="field"><label>Player limit</label><div class="chx-chips">${RIDER_LIMITS.filter((n) => n <= cfg.maxRiders).map((n) => `<button class="chip-btn${d.maxRiders === n ? ' on' : ''}" data-limit="${n}">${n} riders</button>`).join('')}</div><p class="muted small">Up to ${cfg.maxRiders} riders, you included.</p></div>`;
  } else if (step === 4) {
    const fees = [50, 100, 200, 500, 1000].filter((f) => f >= cfg.entryMin && f <= cfg.entryMax);
    const pool = d.entryFee * d.maxRiders;
    const split = prizeSplit(pool, d.prize);
    body = `<h2 class="chx-step-h">Entry fee</h2>
      <div class="seg wide"><button class="${d.paid ? '' : 'on'}" data-paid="0">Free</button><button class="${d.paid ? 'on' : ''}" data-paid="1">${icons.coin} Paid</button></div>
      ${d.paid ? `
        <div class="field"><label>Coins to join</label><div class="chx-chips">${fees.map((f) => `<button class="chip-btn${d.entryFee === f ? ' on' : ''}" data-fee="${f}" ${f * d.maxRiders > cfg.maxPool ? 'disabled' : ''}>${icons.coin} ${fmt(f)}</button>`).join('')}</div></div>
        <h2 class="chx-step-h">Prize pool</h2>
        <div class="chx-opts">${PRIZE_TEMPLATES.map((t) => `<button class="chx-opt${d.prize === t.id ? ' on' : ''}" data-prize="${t.id}"><span class="grow"><b>${esc(t.name)}</b><small>${t.split.map((s, i) => `${['1st', '2nd', '3rd'][i]} ${s}%`).join(' · ')}</small></span></button>`).join('')}</div>
        <div class="card chx-pool">
          <p class="small">${d.maxRiders} riders × ${fmt(d.entryFee)} ${icons.coin} = <b>${fmt(pool)} ${icons.coin}</b> prize pool when full</p>
          <div class="chx-prizes">${split.map((v, i) => `<span><i class="p${i + 1}">${['1st', '2nd', '3rd'][i]}</i>${fmt(v)} ${icons.coin}</span>`).join('')}</div>
          <p class="muted small">Worked out automatically from the riders who actually join. If fewer than 2 riders finish, everyone gets their entry back. Coins only, never cash.</p>
        </div>
        <p class="muted small">${icons.shield} Paid challenges are a level field: everyone rides the City bike with no upgrades, and results are checked on the server.</p>`
      : '<p class="muted small">Free to join. Riders still get coins and XP for riding, and the leaderboard.</p>'}`;
  } else if (step === 5) {
    const trial = d.format !== 'live_race';
    const closeOpts: [number, string][] = trial ? [[-1, 'When it ends'], [0, 'At the start'], [60, '1 hour before']] : [[0, 'At the start'], [5, '5 min before'], [10, '10 min before'], [30, '30 min before']];
    if (!closeOpts.some(([v]) => v === d.closeBefore)) d.closeBefore = closeOpts[0][0];
    body = `<h2 class="chx-step-h">When?</h2>
      <div class="seg wide"><button class="${d.startNow ? 'on' : ''}" data-now="1">${icons.bolt} Start now</button><button class="${d.startNow ? '' : 'on'}" data-now="0">${icons.events} Schedule for later</button></div>
      ${d.startNow
        ? `<p class="muted small">${trial ? 'Opens as soon as you create it.' : 'The race starts in the lobby once riders have joined and everyone is ready.'}</p>`
        : `<div class="two"><div class="field"><label for="cwDate">Date</label><input type="date" id="cwDate" value="${d.date}" min="${new Date().toLocaleDateString('en-CA')}"></div><div class="field"><label for="cwTime">Time</label><input type="time" id="cwTime" value="${d.time}" step="300"></div></div>
          <div class="field"><label>Registration closes</label><div class="chx-chips">${closeOpts.map(([v, n]) => `<button class="chip-btn${d.closeBefore === v ? ' on' : ''}" data-close="${v}">${n}</button>`).join('')}</div></div>`}
      <div class="field"><label>${trial ? 'Open for' : 'Expires after'}</label><div class="chx-chips">${EXPIRY.map((e) => `<button class="chip-btn${d.expiryH === e.h ? ' on' : ''}" data-exp="${e.h}">${e.name}</button>`).join('')}</div>
      <p class="muted small">${trial ? 'Riders can ride it any time in this window. After that: Challenge ended, and the leaderboard stays.' : 'If the race hasn\'t started by then, it ends. The leaderboard stays.'}</p></div>`;
  } else {
    const t = timesOf(d);
    const fee = editing ? 0 : cfg.creationFee;
    const short = fee > p.coins;
    const row = (k: string, v: string) => `<div class="chx-confirm-row"><span>${k}</span><b>${v}</b></div>`;
    body = `<h2 class="chx-step-h">Check and create</h2>
      <div class="card chx-confirm">
        ${row('Name', esc(d.name))}
        ${row(`${icons.pin} Route`, `${esc(chRoute(d.route)!.name)} · ${kmOf(d.route)}`)}
        ${row('Format', `${esc(formatOf(d.format).name)}${d.format === 'best_of' ? ` · ${d.attempts} attempts` : ''}`)}
        ${row('Access', esc(d.access === 'hall' ? `${hallById(p.hall).short} only` : accessOf(d.access).name))}
        ${row('Riders', `Up to ${d.maxRiders}`)}
        ${row('Entry', d.paid ? `${fmt(d.entryFee)} coins · ${esc(PRIZE_TEMPLATES.find((x) => x.id === d.prize)!.name)}` : 'Free')}
        ${row('Starts', d.startNow ? (d.format === 'live_race' ? 'When everyone is ready' : 'Now') : esc(whenText(t.startsAt)))}
        ${d.startNow ? '' : row('Registration closes', t.regClosesAt >= t.endsAt ? 'When it ends' : esc(whenText(t.regClosesAt)))}
        ${row('Ends', esc(EXPIRY.find((e) => e.h === d.expiryH)!.name) + ' after the start')}
      </div>
      ${editing ? '' : `<div class="card chx-fee${short ? ' short' : ''}">
        <div class="row"><span class="grow"><small class="muted">Challenge creation fee</small><b>${icons.coin} ${fmt(fee)} Rush Coins</b></span></div>
        ${short ? `<div class="chx-warn">${icons.close}<span><b>Not enough Rush Coins</b>You need ${fmt(fee)} ${icons.coin} to create a challenge. Your balance: ${fmt(p.coins)} ${icons.coin}</span></div>` : `<p class="muted small">Your balance: ${fmt(p.coins)} → ${fmt(p.coins - fee)}. The fee keeps spam away; it isn't part of the prize pool.</p>`}
      </div>`}
      ${api.online() ? '' : `<div class="chx-warn">${icons.user}<span><b>Sign in to create challenges</b>Rider challenges live online so others can find and join them.</span></div>`}`;
  }

  screen(`
    <p class="kicker">${icons.plus} ${editing ? 'Edit challenge' : 'Create a challenge'}</p>
    <div class="chx-steps" aria-label="Step ${step + 1} of ${STEPS.length}">${STEPS.map((s, i) => `<span class="${i < step ? 'done' : i === step ? 'on' : ''}"><i>${i < step ? icons.check : i + 1}</i><em>${s}</em></span>`).join('')}</div>
    ${body}
    <p class="chx-bad small" id="cwErr" hidden></p>
    <div class="chx-wiz-foot">
      <button class="btn btn-ghost" id="cwPrev">${step === 0 ? 'Cancel' : 'Back'}</button>
      ${step < STEPS.length - 1
        ? `<button class="btn btn-primary" id="cwNext">Next ${icons.arrow}</button>`
        : `<button class="btn btn-primary" id="cwMake" ${(!editing && cfg.creationFee > p.coins) || !api.online() ? 'disabled' : ''}>${editing ? 'Save changes' : `Create for ${fmt(cfg.creationFee)} ${icons.coin}`}</button>`}
    </div>
  `, prev, 'chx-screen chx-wizard');

  // step inputs
  on('[data-route]', 'click', (_, el) => { d.route = el.dataset.route!; redraw(); });
  if (step === 0) setTimeout(() => { const cv = H().app.querySelector<HTMLCanvasElement>('#cwMap'); if (cv) try { routeMap(cv, chRoute(d.route)!.build()); } catch { cv.remove(); } }, 40);
  const nameIn = H().app.querySelector<HTMLInputElement>('#cwName');
  nameIn?.addEventListener('input', () => (d.name = nameIn.value));
  const descIn = H().app.querySelector<HTMLTextAreaElement>('#cwDesc');
  descIn?.addEventListener('input', () => (d.description = descIn.value));
  on('[data-idea]', 'click', (_, el) => { d.name = el.dataset.idea!; if (nameIn) nameIn.value = d.name; });
  on('[data-format]', 'click', (_, el) => { d.format = el.dataset.format as Format; redraw(); });
  on('[data-attempts]', 'click', (_, el) => { d.attempts = Number(el.dataset.attempts); redraw(); });
  on('[data-access]', 'click', (_, el) => { d.access = el.dataset.access as Access; redraw(); });
  on('[data-limit]', 'click', (_, el) => { d.maxRiders = Number(el.dataset.limit); redraw(); });
  on('[data-paid]', 'click', (_, el) => { d.paid = el.dataset.paid === '1'; if (d.paid && d.entryFee * d.maxRiders > cfg.maxPool) d.entryFee = cfg.entryMin; redraw(); });
  on('[data-fee]', 'click', (_, el) => { d.entryFee = Number(el.dataset.fee); redraw(); });
  on('[data-prize]', 'click', (_, el) => { d.prize = el.dataset.prize!; redraw(); });
  on('[data-now]', 'click', (_, el) => { d.startNow = el.dataset.now === '1'; redraw(); });
  on('[data-close]', 'click', (_, el) => { d.closeBefore = Number(el.dataset.close); redraw(); });
  on('[data-exp]', 'click', (_, el) => { d.expiryH = Number(el.dataset.exp); redraw(); });
  const dateIn = H().app.querySelector<HTMLInputElement>('#cwDate');
  dateIn?.addEventListener('change', () => (d.date = dateIn.value));
  const timeIn = H().app.querySelector<HTMLInputElement>('#cwTime');
  timeIn?.addEventListener('change', () => (d.time = timeIn.value));
  on('#cwPrev', 'click', prev);
  on('#cwNext', 'click', next);
  on('#cwMake', 'click', (_, el) => void make(d, editing, el as HTMLButtonElement, back));
}

async function make(d: Draft, editing: Challenge | undefined, btn: HTMLButtonElement, back: () => void) {
  for (let s = 0; s < STEPS.length - 1; s++) {
    const bad = problems(d, s);
    if (bad) { d.step = s; createScreen(back, editing, d); const el = H().app.querySelector<HTMLElement>('#cwErr'); if (el) { el.hidden = false; el.textContent = bad; } return; }
  }
  const p = H().profile();
  const cfg = api.local().config;
  const t = timesOf(d);
  const ghost = d.format === 'ghost' ? loadGhost(d.route) : null;
  const input: api.NewChallenge = {
    name: d.name.trim(), description: d.description.trim(), route: d.route, format: d.format,
    attempts: d.format === 'best_of' ? d.attempts : d.format === 'live_race' ? 1 : 0,
    access: d.access, hall: d.access === 'hall' ? p.hall : null, maxRiders: d.maxRiders, entryFee: d.paid ? d.entryFee : 0, prize: d.prize,
    startsAt: t.startsAt, regClosesAt: t.regClosesAt, endsAt: t.endsAt, startNow: d.startNow,
    ghost: ghost ? { name: p.name, time: ghost.time, run: { step: ghost.step, d: ghost.d, x: ghost.x } } : null,
  };
  btn.disabled = true;
  btn.textContent = editing ? 'Saving…' : 'Creating…';
  if (editing) {
    const r = await api.update(editing.id, input);
    if (!r.ok) { btn.disabled = false; btn.textContent = 'Save changes'; return H().toast(esc(r.message)); }
    await refresh(true);
    H().toast(`${icons.check} Saved.`);
    return detailScreen(find(r.data.id) ?? r.data);
  }
  // the fee leaves first; if the server says no, it comes straight back
  if (!spend(p, { coins: cfg.creationFee })) { btn.disabled = false; return H().toast(`You need ${fmt(cfg.creationFee)} coins to create a challenge.`); }
  const r = await api.create(input);
  if (!r.ok) {
    grant(p, { coins: cfg.creationFee });
    btn.disabled = false;
    btn.innerHTML = `Create challenge · ${fmt(cfg.creationFee)} ${icons.coin}`;
    return H().toast(esc(r.message));
  }
  const c = r.data;
  // the creator is in from the start of a free challenge; a paid one they join (and pay) like everyone
  const s = api.local();
  if (c.entryFee === 0) s.mine[c.id] = { id: c.id, joinedAt: Date.now(), attempts: 0, paid: 0, snap: { ...c, joined: true } };
  s.cache = [...s.cache.filter((x) => x.id !== c.id), { ...c, joined: c.entryFee === 0 }];
  api.saveLocal();
  if (c.access === 'open' || c.access === 'hall') postActivity({ kind: 'challenge_new', text: `${p.name} created ${c.name} on ${chRoute(c.route)!.name}`, ref: c.id });
  createdScreen(c);
}

function createdScreen(c: Challenge) {
  screen(`
    <div class="chx-done">
      <span class="chx-done-ico">${icons.flag}</span>
      <p class="kicker">Challenge created</p>
      <h1 class="title">${esc(c.name)}</h1>
      <p class="muted">${esc(chRoute(c.route)!.name)} · ${c.startNow ? (c.format === 'live_race' ? 'starts when riders are ready' : 'open now') : esc(whenText(c.startsAt))}</p>
      <div class="chx-bigcode"><small>Challenge code</small><b>${esc(c.code)}</b></div>
    </div>
    ${c.entryFee ? `<button class="btn btn-primary" id="cdJoin">Join your challenge · ${fmt(c.entryFee)} ${icons.coin}</button><p class="muted small">You made it; to race for the prize pool you pay the entry like everyone else.</p>` : ''}
    <button class="btn ${c.entryFee ? 'btn-ghost' : 'btn-primary'}" id="cdShare">${icons.send} Share with friends</button>
    <div class="two"><button class="btn btn-ghost" id="cdCode">${icons.copy} Copy code</button><button class="btn btn-ghost" id="cdLink">${icons.link} Copy link</button></div>
    <p class="muted small" id="cdNote" hidden></p>
    <button class="btn btn-ghost" id="cdOpen">Open challenge ${icons.arrow}</button>
  `, () => H().home('challenges'), 'chx-screen');
  const note = H().app.querySelector<HTMLElement>('#cdNote');
  on('#cdShare', 'click', () => H().share(shareText(c), linkOf(c), note!));
  on('#cdCode', 'click', () => copy(c.code, note, `Code ${c.code} copied`));
  on('#cdLink', 'click', () => copy(linkOf(c), note, 'Link copied'));
  on('#cdOpen', 'click', () => detailScreen(c));
  on('#cdJoin', 'click', () => joinScreen(c, () => createdScreen(c)));
}
