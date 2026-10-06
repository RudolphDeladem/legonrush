// Campus groups: the hall and course community pages, Community leaderboards and the social badges.
import * as cloud from '../../cloud';
import { HALLS, hallById } from '../../data/campus';
import { saveProfile, type Profile } from '../../state';
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { H, esc, fmt, screen } from '../host';
import * as api from './api';
import { known, social } from './local';
import { bindCrews, boardRows, crewCard } from './crews';
import { loadFeed } from './feed';
import { bindPeople, openPerson, peopleScreen } from './people';
import { onlineNow } from './presence';
import { bindSignIn, ci, empty, loading, personRow, plural, problemBox, toast } from './ui';

const back = () => H().home('social');

// ---------- hall and course pages ----------

export function hallScreen(hallId: string, from: () => void = back) {
  const h = hallById(hallId);
  const p = H().profile();
  const mine = p.hall === hallId;
  const online = onlineNow().filter((o) => o.state.hall === hallId).length + (mine ? 1 : 0);
  screen(`
    <div class="cm-group-hero" style="--c:${h.color}">
      <span class="cm-group-ico">${ci.hall}</span>
      <div><p class="kicker">${mine ? 'Your hall' : 'Hall community'}</p><h1 class="title">${esc(h.name)}</h1><p class="cm-group-nick">${esc(h.short)}</p></div>
    </div>
    <div class="cm-group-stats">
      <span><b id="cmMembers">–</b>members</span>
      <span><b><i class="cm-dot"></i>${online}</b>online</span>
      <span><b id="cmRank">–</b>this week</span>
      <span><b id="cmKm">–</b>km this week</span>
    </div>
    <div class="cm-pv-acts">
      <button class="cm-act" data-go="challenges">${icons.flag}<span>Hall challenges</span></button>
      <button class="cm-act" data-go="events">${fx.calendar}<span>Hall events</span></button>
      <button class="cm-act" id="cmHallBoard">${ci.chart}<span>Hall standings</span></button>
    </div>
    <h2 class="cm-h2">${ci.users} Hall mates</h2>
    <div id="cmMates" class="cm-list">${loading(3)}</div>
    <h2 class="cm-h2">${icons.bolt} Hall feed</h2>
    <div id="cmGroupFeed" class="cm-feed">${loading(2)}</div>
    <h2 class="cm-h2">${ci.shield} Hall crews</h2>
    <div id="cmGroupCrews" class="cm-list"></div>`, from, 'cm-screen');
  const app = H().app;
  const again = () => hallScreen(hallId, from);
  app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => H().home(b.dataset.go === 'events' ? 'events' : 'race')));
  app.querySelector('#cmHallBoard')!.addEventListener('click', () => boardsScreen('halls', again));
  void cloud.hallStandings().then((rows) => {
    const i = rows.findIndex((r) => r.hall === hallId);
    app.querySelector('#cmRank')!.textContent = i >= 0 ? `#${i + 1}` : '–';
    app.querySelector('#cmKm')!.textContent = i >= 0 ? fmt(rows[i].km) : '0';
  }).catch(() => undefined);
  void fillGroup('hall', hallId, again);
}

export function courseScreen(course: string, from: () => void = back) {
  const online = onlineNow().filter((o) => o.state.department === course).length + 1;
  screen(`
    <div class="cm-group-hero course">
      <span class="cm-group-ico">${ci.grad}</span>
      <div><p class="kicker">Your course</p><h1 class="title">${esc(course)}</h1></div>
    </div>
    <div class="cm-group-stats">
      <span><b id="cmMembers">–</b>members</span>
      <span><b><i class="cm-dot"></i>${online}</b>online</span>
      <span><b id="cmRank">–</b>this week</span>
      <span><b id="cmKm">–</b>km this week</span>
    </div>
    <div class="cm-pv-acts">
      <button class="cm-act" id="cmLevelMates">${ci.book}<span>Level mates</span></button>
      <button class="cm-act" data-go="challenges">${icons.flag}<span>Course challenges</span></button>
      <button class="cm-act" id="cmDeptBoard">${ci.chart}<span>Departments</span></button>
    </div>
    <h2 class="cm-h2">${ci.users} Course mates</h2>
    <div id="cmMates" class="cm-list">${loading(3)}</div>
    <h2 class="cm-h2">${icons.bolt} Course activity</h2>
    <div id="cmGroupFeed" class="cm-feed">${loading(2)}</div>
    <h2 class="cm-h2">${ci.shield} Course crews</h2>
    <div id="cmGroupCrews" class="cm-list"></div>`, from, 'cm-screen');
  const app = H().app;
  const again = () => courseScreen(course, from);
  app.querySelector('[data-go]')!.addEventListener('click', () => H().home('race'));
  app.querySelector('#cmLevelMates')!.addEventListener('click', () => peopleScreen('level', again));
  app.querySelector('#cmDeptBoard')!.addEventListener('click', () => boardsScreen('depts', again));
  void cloud.departmentStandings().then((rows) => {
    const i = rows.findIndex((r) => r.department === course);
    app.querySelector('#cmRank')!.textContent = i >= 0 ? `#${i + 1}` : '–';
    app.querySelector('#cmKm')!.textContent = i >= 0 ? fmt(rows[i].km) : '0';
  }).catch(() => undefined);
  void fillGroup('course', course, again);
}

async function fillGroup(kind: 'hall' | 'course', ref: string, again: () => void) {
  const app = H().app;
  const mates = app.querySelector<HTMLElement>('#cmMates')!;
  const feed = app.querySelector<HTMLElement>('#cmGroupFeed')!;
  const crews = app.querySelector<HTMLElement>('#cmGroupCrews')!;
  try {
    const g = await api.group(kind, ref);
    app.querySelector('#cmMembers')!.textContent = fmt(g.members);
    const on = new Set(onlineNow().map((o) => o.key));
    const people = [...g.people].sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)));
    mates.innerHTML = people.length ? people.slice(0, 12).map((c) => personRow(c, on.has(c.id) ? '<span class="cm-online"><i class="cm-dot"></i></span>' : '')).join('') + (people.length > 12 ? `<button class="btn btn-link" id="cmAllMates">See all ${people.length}</button>` : '')
      : empty(ci.users, kind === 'hall' ? 'No hall mates to show yet' : 'No course mates to show yet', `Riders appear here when they choose to show their ${kind}. Invite yours to LEGONRUSH!`);
    bindPeople(mates, people, again);
    mates.querySelector('#cmAllMates')?.addEventListener('click', () => peopleScreen(kind, again));
    void loadFeed(feed, kind, ref, again, 10);
    crews.innerHTML = g.crews.length ? g.crews.map(crewCard).join('') : `<p class="muted small">No crews here yet. Start one from Crews.</p>`;
    bindCrews(crews);
  } catch (e) {
    mates.innerHTML = problemBox(e, 'cmRetry');
    bindSignIn(mates);
    mates.querySelector('#cmRetry')?.addEventListener('click', again);
    feed.innerHTML = '';
    crews.innerHTML = '';
  }
}

// ---------- leaderboards ----------

export type BoardTab = api.BoardKind | 'crews' | 'halls' | 'depts';
const BOARDS: [BoardTab, string, string, string, (v: number) => string][] = [
  ['riders', 'Top riders', icons.trophy, 'Most XP from racing and riding.', (v) => `${fmt(v)} XP`],
  ['active', 'Most active', icons.bike, 'Most kilometres in the last 7 days.', (v) => `${fmt(v)} km`],
  ['social', 'Most social', ci.users, 'Most friends on LEGONRUSH.', (v) => plural(v, 'friend')],
  ['events', 'Event regulars', fx.calendar, 'Most events joined in 30 days (shared activity).', (v) => plural(v, 'event')],
  ['challenges', 'Challenge champions', fx.medal, 'Most challenge wins in 30 days (shared activity).', (v) => plural(v, 'win')],
  ['contributors', 'Contributors', ci.chat, 'Posts and reactions in the last 30 days.', (v) => plural(v, 'point')],
  ['crews', 'Top crews', ci.shield, "Crews by their members' distance.", (v) => `${fmt(v)} km`],
  ['halls', 'Halls', ci.hall, 'Hall Week: kilometres since Monday.', (v) => `${fmt(v)} km`],
  ['depts', 'Departments', ci.grad, 'Kilometres since Monday by programme.', (v) => `${fmt(v)} km`],
];

export function boardsScreen(tab: BoardTab = 'riders', from: () => void = back) {
  const b = BOARDS.find((x) => x[0] === tab)!;
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.chart}</span><div><h1 class="title">Leaderboards</h1><p class="muted">Not every board is about speed.</p></div></div>
    <div class="cm-chips cm-scroll cm-board-tabs">${BOARDS.map(([id, l, ico]) => `<button class="chip-btn${id === tab ? ' on' : ''}" data-b="${id}">${ico} ${l}</button>`).join('')}</div>
    <p class="muted small">${b[3]}</p>
    <div id="cmBoard" class="cm-board">${loading(5)}</div>`, from, 'cm-screen');
  const app = H().app;
  app.querySelectorAll<HTMLElement>('[data-b]').forEach((x) => x.addEventListener('click', () => boardsScreen(x.dataset.b as BoardTab, from)));
  fillBoard(app.querySelector<HTMLElement>('#cmBoard')!, tab, () => boardsScreen(tab, from));
}

/** the board tabs as chips, and the line about the chosen board (for the Community tab's Leaderboard) */
export const boardTabsHtml = (tab: BoardTab) => `<div class="cm-chips cm-scroll cm-board-tabs">${BOARDS.map(([id, l, ico]) => `<button class="chip-btn${id === tab ? ' on' : ''}" data-b="${id}">${ico} ${l}</button>`).join('')}</div>
  <p class="muted small">${BOARDS.find((x) => x[0] === tab)![3]}</p>`;

/** fills box with one leaderboard */
export function fillBoard(box: HTMLElement, tab: BoardTab, again: () => void) {
  const b = BOARDS.find((x) => x[0] === tab)!;
  box.innerHTML = loading(5);
  const p = H().profile();
  void (async () => {
    try {
      if (tab === 'halls' || tab === 'depts') {
        const rows = tab === 'halls' ? await cloud.hallStandings() : await cloud.departmentStandings();
        const list = rows.map((r) => {
          const name = 'hall' in r ? hallById(r.hall).name : r.department;
          const me = 'hall' in r ? r.hall === p.hall : r.department === p.department;
          return { id: name, name, value: r.km, me, members: r.riders };
        });
        box.innerHTML = list.length ? boardRows(list, b[4]) : empty(ci.hall, 'No rides this week yet', 'Ride for your hall to put it on the board.');
        if (tab === 'halls') box.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => el.addEventListener('click', () => {
          const h = HALLS.find((x) => x.name === el.dataset.row);
          if (h) hallScreen(h.id, again);
        }));
        return;
      }
      if (tab === 'crews') {
        const rows = await api.crewBoard('km');
        box.innerHTML = rows.length ? boardRows(rows, b[4], true) : empty(ci.shield, 'No crews yet', 'Create the first crew on campus.');
        bindCrews(box);
        return;
      }
      const rows = await api.board(tab);
      box.innerHTML = rows.length ? boardRows(rows, b[4]) : empty(b[2], 'Nobody here yet', 'This board fills up as riders play and share.');
      box.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => el.addEventListener('click', () => void openPerson(el.dataset.row!, rows.find((r) => String(r.id) === el.dataset.row) as never)));
    } catch (e) {
      box.innerHTML = problemBox(e, 'cmRetry');
      bindSignIn(box);
      box.querySelector('#cmRetry')?.addEventListener('click', again);
    }
  })();
}

// ---------- social badges ----------

interface SocialBadge { id: string; icon: string; title: string; text: string; goal: number; got: (p: Profile) => number; soon?: string }
export const SOCIAL_BADGES: SocialBadge[] = [
  { id: 'social-first', icon: ci.userPlus, title: 'First connection', text: 'Make your first friend.', goal: 1, got: () => known().friends.length },
  { id: 'social-butterfly', icon: ci.party, title: 'Social butterfly', text: 'Attend 10 events.', goal: 10, got: (p) => social(p).counts.events },
  { id: 'social-connector', icon: ci.globe, title: 'Campus connector', text: 'Interact with 50 different riders.', goal: 50, got: (p) => social(p).counts.met.length },
  { id: 'social-crew', icon: ci.shield, title: 'Crew champion', text: 'Win 10 crew challenges.', goal: 10, got: (p) => (p.stats as Record<string, number>).crewWins ?? 0, soon: 'Crew challenges are coming with Challenges.' },
  { id: 'social-hall', icon: ci.hall, title: 'Hall hero', text: 'Earn 1,000 Hall Points (10 per km ridden for your hall).', goal: 1000, got: (p) => (p.hall === 'none' ? 0 : Math.floor((p.totalDistance / 1000) * 10)) },
  { id: 'social-regular', icon: ci.chat, title: 'Community regular', text: 'Post, react or message 25 times.', goal: 25, got: (p) => { const c = social(p).counts; return c.posts + c.reactions + c.messages; } },
];

/** unlocks any social badge just earned (kept in profile.badges with a "social-" id) */
export function checkSocialBadges(p: Profile) {
  const fresh = SOCIAL_BADGES.filter((b) => !p.badges.includes(b.id) && b.got(p) >= b.goal);
  if (!fresh.length) return;
  p.badges = [...p.badges, ...fresh.map((b) => b.id)];
  saveProfile(p);
  for (const b of fresh) toast(`${fx.medal} Badge unlocked: <b>${esc(b.title)}</b>`);
}

export function badgesHtml(p: Profile) {
  return SOCIAL_BADGES.map((b) => {
    const got = Math.min(b.goal, b.got(p));
    const done = p.badges.includes(b.id) || got >= b.goal;
    return `<div class="cm-badge${done ? ' done' : ''}" title="${esc(b.soon ?? b.text)}">
      <span class="cm-badge-ico">${b.icon}</span>
      <b>${esc(b.title)}</b>
      <small>${esc(b.text)}</small>
      <span class="cm-bar"><i style="width:${(got / b.goal) * 100}%"></i></span>
      <small class="cm-badge-n">${done ? `${ci.check} Unlocked` : b.soon && !got ? esc(b.soon) : `${fmt(got)} / ${fmt(b.goal)}`}</small>
    </div>`;
  }).join('');
}
