// Crews: rider-made riding groups with a logo, a crew feed, a group chat, members and a
// leaderboard. Creating one costs coins (config: crew_create_coins, default 2,000).
import { levelFor } from '../../state';
import { icons } from '../../ui/icons';
import { spend } from '../inventory';
import { fx } from '../icons';
import { H, esc, fmt, screen } from '../host';
import * as api from './api';
import { known, remember } from './local';
import type { BoardRow, Crew } from './model';
import { openChat } from './chat';
import { loadFeed } from './feed';
import { bindPeople, openPerson, reportSheet } from './people';
import { CREW_COLORS, CREW_LOGOS, act, bindSignIn, ci, empty, loading, personRow, plural, problemBox, sheet, sheetHead, toast } from './ui';

const back = () => H().home('social');

/** extra crew activities other systems can add (crew challenges, crew events) */
export interface CrewAction { id: string; label: string; icon: string; run: (crew: Crew) => void }
const actions: CrewAction[] = [];
export function registerCrewAction(a: CrewAction) {
  if (!actions.some((x) => x.id === a.id)) actions.push(a);
}

export const crewLogo = (c: Pick<Crew, 'logo' | 'color'>, size: 'xs' | 'sm' | 'md' | 'lg' = 'md') =>
  `<span class="cm-logo ${size}" style="--c:${esc(c.color)}">${CREW_LOGOS[c.logo] ?? CREW_LOGOS.bike}</span>`;

export function crewCard(c: Crew) {
  return `<button class="cm-crew" data-crew="${c.id}">
    ${crewLogo(c)}
    <span class="cm-p-main"><b>${esc(c.name)}</b><small>${plural(c.members, 'member')} · ${c.public ? 'Public' : 'Private'}${c.min_level ? ` · Level ${c.min_level}+` : ''}</small>${c.description ? `<small class="cm-crew-desc">${esc(c.description)}</small>` : ''}</span>
    ${c.my?.status === 'member' ? '<span class="badge gold">Your crew</span>' : c.my?.status === 'pending' ? '<span class="badge">Requested</span>' : icons.arrow}
  </button>`;
}

export function bindCrews(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-crew]').forEach((el) => el.addEventListener('click', () => openCrew(Number(el.dataset.crew))));
}

// ---------- explore crews ----------

export function crewsScreen(from: () => void = back) {
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.shield}</span><div><h1 class="title">Crews</h1><p class="muted">Riding groups made by riders. Ride together, chat and climb the crew leaderboard.</p></div></div>
    <div id="cmMine"></div>
    <label class="cm-search"><span>${ci.search}</span><input id="cmCrewQ" type="search" maxlength="28" placeholder="Search crews"></label>
    <div id="cmCrewList" class="cm-list">${loading(3)}</div>
    <button class="btn btn-ghost" id="cmCrewBoard">${ci.chart} Crew leaderboard</button>`, from, 'cm-screen');
  const app = H().app;
  const again = () => crewsScreen(from);
  const list = app.querySelector<HTMLElement>('#cmCrewList')!;
  const mine = app.querySelector<HTMLElement>('#cmMine')!;
  app.querySelector('#cmCrewBoard')!.addEventListener('click', () => crewBoardScreen(again));
  const load = async (q = '') => {
    try {
      const rows = await api.crews(q);
      const my = rows.find((c) => c.my?.status === 'member');
      if (!q) {
        remember({ crew: my?.id ?? null });
        mine.innerHTML = my ? `<b class="cm-label">Your crew</b>${crewCard(my)}` : createCta();
        bindCrews(mine);
        mine.querySelector('#cmCreate')?.addEventListener('click', () => createCrewScreen(again));
      }
      const others = rows.filter((c) => c !== my);
      list.innerHTML = others.length ? `<b class="cm-label">${q ? 'Results' : 'Crews on campus'}</b>${others.map(crewCard).join('')}` : empty(ci.shield, q ? 'No crews found' : 'No crews yet', q ? 'Try another name.' : 'Be the first: start a crew for your hall, your course or your night riders.');
      bindCrews(list);
    } catch (e) {
      mine.innerHTML = '';
      list.innerHTML = problemBox(e, 'cmRetry');
      bindSignIn(list);
      list.querySelector('#cmRetry')?.addEventListener('click', again);
    }
  };
  let t = 0;
  app.querySelector<HTMLInputElement>('#cmCrewQ')!.addEventListener('input', (e) => { clearTimeout(t); t = window.setTimeout(() => void load((e.target as HTMLInputElement).value.trim()), 350); });
  void load();
}

const createCta = () => `<div class="cm-cta">${ci.shield}<span><b>Start your own crew</b><small>Pick a name and logo, invite your people.</small></span><button class="btn btn-primary btn-sm" id="cmCreate">Create</button></div>`;

// ---------- create ----------

export async function createCrewScreen(from: () => void = () => crewsScreen()) {
  const p = H().profile();
  if (!api.signedIn()) { H().signIn(); return; }
  const fee = await api.configNumber('crew_create_coins', api.CREW_FEE_DEFAULT);
  let logo = 'bike', color = CREW_COLORS[0], isPublic = true;
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.plus}</span><div><h1 class="title">Create a crew</h1><p class="muted">Costs ${icons.coin} <b>${fmt(fee)}</b> coins. That keeps crews real and spam-free.</p></div></div>
    <div class="card stack cm-form">
      <div class="cm-crew-preview" id="cmPrev">${crewLogo({ logo, color }, 'lg')}<b id="cmPrevName">Your crew</b></div>
      <label class="cm-label" for="cmCrewName">Crew name</label>
      <input class="cm-input" id="cmCrewName" maxlength="28" placeholder="Legon Night Riders" autocomplete="off">
      <b class="cm-label">Logo</b>
      <div class="cm-logos" id="cmLogos">${Object.keys(CREW_LOGOS).map((k) => `<button data-logo="${k}" class="${k === logo ? 'on' : ''}" aria-label="${k}">${CREW_LOGOS[k]}</button>`).join('')}</div>
      <div class="cm-colors" id="cmColors">${CREW_COLORS.map((c) => `<button data-color="${c}" class="${c === color ? 'on' : ''}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <label class="cm-label" for="cmCrewDesc">Description</label>
      <textarea class="cm-input" id="cmCrewDesc" maxlength="200" rows="2" placeholder="Evening rides around the Night Market. All levels welcome."></textarea>
      <b class="cm-label">Who can join</b>
      <div class="seg wide" id="cmPub"><button data-v="1" class="on">${ci.globe} Anyone</button><button data-v="0">${ci.lock} By request</button></div>
      <label class="cm-label" for="cmMinLv">Minimum level <small class="muted">(optional)</small></label>
      <select class="cm-input" id="cmMinLv">${[0, 2, 5, 10, 15, 20].map((n) => `<option value="${n}">${n ? `Level ${n}+` : 'Any level'}</option>`).join('')}</select>
      <p class="cm-err" id="cmErr" hidden></p>
      <button class="btn btn-primary" id="cmCreateGo">Create crew · ${icons.coin} ${fmt(fee)}</button>
      ${p.coins < fee ? `<p class="muted small">You have ${fmt(p.coins)} coins. Ride, race and finish challenges to earn more.</p>` : ''}
    </div>`, from, 'cm-screen');
  const app = H().app;
  const prev = () => { app.querySelector('#cmPrev')!.innerHTML = `${crewLogo({ logo, color }, 'lg')}<b id="cmPrevName">${esc(app.querySelector<HTMLInputElement>('#cmCrewName')!.value.trim() || 'Your crew')}</b>`; };
  app.querySelector('#cmCrewName')!.addEventListener('input', prev);
  app.querySelectorAll<HTMLElement>('[data-logo]').forEach((b) => b.addEventListener('click', () => { logo = b.dataset.logo!; app.querySelectorAll('[data-logo]').forEach((x) => x.classList.toggle('on', x === b)); prev(); }));
  app.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.color!; app.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); prev(); }));
  app.querySelectorAll<HTMLElement>('#cmPub button').forEach((b) => b.addEventListener('click', () => { isPublic = b.dataset.v === '1'; app.querySelectorAll('#cmPub button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const go = app.querySelector<HTMLButtonElement>('#cmCreateGo')!;
  const err = app.querySelector<HTMLElement>('#cmErr')!;
  const say = (t: string) => { err.hidden = false; err.textContent = t; };
  go.disabled = p.coins < fee;
  go.addEventListener('click', async () => {
    const name = app.querySelector<HTMLInputElement>('#cmCrewName')!.value.trim().replace(/\s+/g, ' ');
    if (!/^[A-Za-z0-9 '&.-]{3,28}$/.test(name)) return say('Use 3 to 28 letters, numbers and spaces.');
    if (p.coins < fee) return say(`You need ${fmt(fee)} coins.`);
    go.disabled = true;
    try {
      const r = await api.createCrew({ name, logo, color, description: app.querySelector<HTMLTextAreaElement>('#cmCrewDesc')!.value.trim(), public: isPublic, minLevel: Number(app.querySelector<HTMLSelectElement>('#cmMinLv')!.value) });
      // the server took the fee from the saved coins; take it on this phone too
      spend(p, { coins: Math.min(p.coins, r.fee) });
      remember({ crew: r.id });
      toast(`${ci.shield} <b>${esc(name)}</b> is live. Invite your people!`);
      openCrew(r.id, () => crewsScreen(back));
    } catch (e) {
      go.disabled = false;
      say(api.problemText(e));
    }
  });
}

// ---------- one crew ----------

type CrewTab = 'feed' | 'members' | 'board';
export function openCrew(id: number, from: () => void = () => crewsScreen(), tab: CrewTab = 'feed') {
  screen(`<div id="cmCrew">${loading(3)}</div>`, from, 'cm-screen');
  const box = H().app.querySelector<HTMLElement>('#cmCrew')!;
  const again = (t: CrewTab = tab) => openCrew(id, from, t);
  void (async () => {
    let c: Crew | null;
    try { c = await api.crew(id); } catch (e) { box.innerHTML = problemBox(e, 'cmRetry'); bindSignIn(box); box.querySelector('#cmRetry')?.addEventListener('click', () => again()); return; }
    if (!c) { box.innerHTML = empty(ci.shield, 'Crew not found', 'It may have been closed.'); return; }
    const member = c.my?.status === 'member';
    const leader = c.my?.role === 'leader' && member;
    if (member) remember({ crew: c.id });
    const p = H().profile();
    box.innerHTML = `
      <div class="cm-crew-hero" style="--c:${esc(c.color)}">
        ${crewLogo(c, 'lg')}
        <div><h1 class="title">${esc(c.name)}</h1><p>${plural(c.members, 'member')} · ${c.public ? `${ci.globe} Public` : `${ci.lock} By request`}${c.min_level ? ` · Level ${c.min_level}+` : ''}</p>
        ${c.leader ? `<p class="small">${ci.crown} Led by ${esc(c.leader.name)}</p>` : ''}</div>
      </div>
      ${c.description ? `<p class="cm-crew-about">${esc(c.description)}</p>` : ''}
      <div class="cm-crew-stats"><span><b>${fmt(Number(c.km ?? 0))}</b>km ridden</span><span><b>${c.members}</b>members</span></div>
      ${member ? `<div class="cm-pv-acts">
          <button class="cm-act" id="cmCrewChat">${ci.chat}<span>Crew chat</span></button>
          <button class="cm-act" id="cmCrewRide">${icons.bike}<span>Plan a ride</span></button>
          ${actions.map((a) => `<button class="cm-act" data-crew-act="${esc(a.id)}">${a.icon}<span>${esc(a.label)}</span></button>`).join('')}
        </div>`
        : c.my?.status === 'pending' ? `<button class="btn btn-ghost" disabled>${ci.userClock} Request sent</button>`
        : known().crew ? `<p class="muted small">${fx.info} You're in another crew. Leave it to join this one.</p>`
        : levelFor(p.xp) < c.min_level ? `<button class="btn btn-ghost" disabled>Reach level ${c.min_level} to join</button>`
        : `<button class="btn btn-primary" id="cmJoin">${c.public ? 'Join crew' : 'Ask to join'}</button>`}
      ${leader && c.pending?.length ? `<div class="card stack cm-pending"><b>${ci.userPlus} Join requests</b>${c.pending.map((x) => personRow(x, `<span class="cm-row-acts"><button class="btn btn-primary btn-sm" data-ok="${esc(x.id)}">Accept</button><button class="btn btn-ghost btn-sm" data-no="${esc(x.id)}">Decline</button></span>`)).join('')}</div>` : ''}
      <div class="seg wide cm-tabs">${([['feed', 'Feed'], ['members', 'Members'], ['board', 'Leaderboard']] as [CrewTab, string][]).map(([t, l]) => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="cmCrewTab"></div>
      <div class="cm-safety">
        ${member ? `<button class="btn btn-link cm-danger" id="cmLeave">${ci.leave} Leave crew</button>` : ''}
        ${!member ? `<button class="btn btn-link" id="cmReportCrew">${ci.flag} Report crew</button>` : ''}
      </div>`;
    const tabBox = box.querySelector<HTMLElement>('#cmCrewTab')!;
    box.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => again(b.dataset.tab as CrewTab)));
    box.querySelector('#cmJoin')?.addEventListener('click', async (e) => {
      const r = await act(e.currentTarget as HTMLElement, () => api.joinCrew(id));
      if (r === 'member') { remember({ crew: id }); toast(`${ci.shield} Welcome to <b>${esc(c!.name)}</b>!`); }
      if (r === 'pending') toast(`${ci.userClock} Request sent to the crew leader`);
      if (r) again();
    });
    box.querySelector('#cmCrewChat')?.addEventListener('click', () => {
      if (c!.conversation) openChat({ id: c!.conversation, kind: 'crew', crew: { id: c!.id, name: c!.name, logo: c!.logo, color: c!.color, members: c!.members }, unread: 0, last_at: '' }, () => again());
    });
    box.querySelector('#cmCrewRide')?.addEventListener('click', () => planRide(c!));
    box.querySelectorAll<HTMLElement>('[data-crew-act]').forEach((b) => b.addEventListener('click', () => actions.find((a) => a.id === b.dataset.crewAct)?.run(c!)));
    box.querySelectorAll<HTMLElement>('[data-ok],[data-no]').forEach((b) => b.addEventListener('click', async () => {
      const user = b.dataset.ok ?? b.dataset.no!;
      if ((await act(b, () => api.answerCrew(id, user, !!b.dataset.ok))) !== undefined) again();
    }));
    box.querySelector('#cmLeave')?.addEventListener('click', async (e) => {
      const b = e.currentTarget as HTMLElement;
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = `${ci.leave} Tap again to leave ${esc(c!.name)}${leader && c!.members > 1 ? ' (the longest-standing member becomes leader)' : leader ? ' (the crew closes)' : ''}`; return; }
      if ((await act(b, () => api.leaveCrew(id))) !== undefined) { remember({ crew: null }); toast(`You left ${esc(c!.name)}`); crewsScreen(back); }
    });
    box.querySelector('#cmReportCrew')?.addEventListener('click', () => reportSheet({ id: c!.leader?.id ?? '', name: c!.name }, 'crew', String(c!.id)));

    if (tab === 'feed') {
      if (!member) tabBox.innerHTML = empty(ci.lock, 'Crew feed is for members', 'Join to see what the crew is up to.');
      else void loadFeed(tabBox, 'crew', String(id), () => again('feed'));
    }
    if (tab === 'members') {
      tabBox.innerHTML = loading(4);
      try {
        const rows = await api.people('crew', String(id), 60);
        tabBox.innerHTML = rows.length ? rows.map((x) => personRow(x, leader && x.id !== api.myId() ? `<button class="icon-btn cm-mini" data-kick="${esc(x.id)}" aria-label="Remove from crew">${ci.x}</button>` : x.id === c!.leader?.id ? `<span class="badge gold">${ci.crown} Leader</span>` : '')).join('')
          : empty(ci.lock, 'Members are private', 'Join this crew to see who rides with it.');
        bindPeople(tabBox, rows, () => again('members'));
        tabBox.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
          if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = 'Remove?'; b.classList.add('cm-sure'); return; }
          if ((await act(b, () => api.answerCrew(id, b.dataset.kick!, false))) !== undefined) again('members');
        }));
      } catch (e) { tabBox.innerHTML = problemBox(e); }
    }
    if (tab === 'board') void memberBoard(tabBox, id);
  })();
}

const METRICS: [api.CrewMetric, string, (v: number) => string][] = [
  ['km', 'Distance', (v) => `${fmt(v)} km`], ['xp', 'XP', (v) => `${fmt(v)} XP`], ['wins', 'Wins', (v) => plural(v, 'win')], ['events', 'Events', (v) => plural(v, 'event')], ['challenges', 'Challenges', (v) => plural(v, 'challenge')],
];

async function memberBoard(box: HTMLElement, id: number, metric: api.CrewMetric = 'km') {
  box.innerHTML = `<div class="cm-chips cm-scroll">${METRICS.map(([m, l]) => `<button class="chip-btn${m === metric ? ' on' : ''}" data-m="${m}">${l}</button>`).join('')}</div><div class="cm-board">${loading(3)}</div>`;
  box.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => void memberBoard(box, id, b.dataset.m as api.CrewMetric)));
  const list = box.querySelector<HTMLElement>('.cm-board')!;
  try {
    const rows = await api.crewBoard(metric, id);
    list.innerHTML = rows.length ? boardRows(rows, METRICS.find((m) => m[0] === metric)![2]) : empty(ci.chart, 'No scores yet', 'Ride together to get the crew on the board.');
    list.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => el.addEventListener('click', () => void openPerson(el.dataset.row!, rows.find((r) => String(r.id) === el.dataset.row) as never)));
  } catch (e) { list.innerHTML = problemBox(e); }
}

export function boardRows(rows: BoardRow[], show: (v: number) => string, crews = false) {
  return rows.map((r, i) => `<div class="cm-board-row${r.me || r.mine ? ' me' : ''}" ${crews ? `data-crew="${r.id}"` : `data-row="${esc(String(r.id))}"`}>
    <span class="cm-rank ${i < 3 ? `top${i + 1}` : ''}">${i + 1}</span>
    ${crews ? crewLogo({ logo: r.logo ?? 'bike', color: r.color ?? '#ffd21f' }, 'xs') : ''}
    <span class="cm-p-main"><b>${esc(r.username ? `@${r.username}` : r.name)}</b>${crews && r.members ? `<small>${plural(r.members, 'member')}</small>` : ''}</span>
    <b class="cm-val">${show(Number(r.value))}</b>
  </div>`).join('');
}

export function crewBoardScreen(from: () => void = () => crewsScreen(), metric: api.CrewMetric = 'km') {
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.chart}</span><div><h1 class="title">Top crews</h1><p class="muted">Crews ranked by their members' riding. Wins, events and challenges count the last 30 days of shared activity.</p></div></div>
    <div class="cm-chips cm-scroll">${METRICS.map(([m, l]) => `<button class="chip-btn${m === metric ? ' on' : ''}" data-m="${m}">${l}</button>`).join('')}</div>
    <div id="cmBoard" class="cm-board">${loading(4)}</div>`, from, 'cm-screen');
  const app = H().app;
  app.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => crewBoardScreen(from, b.dataset.m as api.CrewMetric)));
  const box = app.querySelector<HTMLElement>('#cmBoard')!;
  void api.crewBoard(metric).then((rows) => {
    box.innerHTML = rows.length ? boardRows(rows, METRICS.find((m) => m[0] === metric)![2], true) : empty(ci.shield, 'No crews yet', 'Create the first crew on campus.');
    bindCrews(box);
  }).catch((e) => { box.innerHTML = problemBox(e); bindSignIn(box); });
}

/** a crew ride: where and when, sent to the crew chat */
function planRide(c: Crew) {
  const spots = ['Great Hall', 'The Balme Library', 'Night Market', 'Legon Main Entrance', 'Sports Complex', 'Athletic Oval', 'Commonwealth Hall', 'Akuafo Hall'];
  const s = sheet(`${sheetHead(`${icons.bike} Plan a crew ride`)}
    <b class="cm-label">Meet at</b>
    <div class="cm-chips" id="cmSpot">${spots.map((x, i) => `<button class="chip-btn${i === 0 ? ' on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <b class="cm-label">When</b>
    <div class="seg wide" id="cmWhen"><button data-v="now" class="on">Now</button><button data-v="tonight">Tonight 7pm</button><button data-v="tomorrow">Tomorrow 5pm</button></div>
    <button class="btn btn-primary" id="cmRideGo">Send to the crew chat</button>`);
  let spot = spots[0], when = 'now';
  s.el.querySelectorAll<HTMLElement>('#cmSpot button').forEach((b) => b.addEventListener('click', () => { spot = b.dataset.v!; s.el.querySelectorAll('#cmSpot button').forEach((x) => x.classList.toggle('on', x === b)); }));
  s.el.querySelectorAll<HTMLElement>('#cmWhen button').forEach((b) => b.addEventListener('click', () => { when = b.dataset.v!; s.el.querySelectorAll('#cmWhen button').forEach((x) => x.classList.toggle('on', x === b)); }));
  s.el.querySelector('#cmRideGo')!.addEventListener('click', async (e) => {
    if (!c.conversation) return;
    const text = `Crew ride: meet at ${spot} ${when === 'now' ? 'now' : when === 'tonight' ? 'tonight at 7pm' : 'tomorrow at 5pm'}. Who's in? 🚲`;
    if ((await act(e.currentTarget as HTMLElement, () => api.send(c.conversation!, text))) !== undefined) {
      s.close();
      toast(`${ci.check} Sent to ${esc(c.name)}`);
    }
  });
}
