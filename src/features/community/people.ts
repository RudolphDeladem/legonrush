// People: a rider's profile sheet (friend, follow, message, ride, challenge, safety), the people
// lists (Find your people, hall/course/level mates, search), Friends and Riders Online.
import * as live from '../../live';
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { H, esc, screen } from '../host';
import * as vb from '../vibe';
import * as api from './api';
import { blockLocal, isFriend, known, met, remember, social, unblockLocal } from './local';
import type { Card } from './model';
import { DOING_TEXT, doing, isAccount, lobbyState, onlineById, onlineNow } from './presence';
import { CREW_LOGOS, act, avatar, bindSignIn, cardLine, ci, empty, handle, hallName, loading, personRow, plural, problemBox, sheet, sheetHead, statusChips, toast } from './ui';

/** set by other screens: open a private chat with someone (chat.ts) */
let openChatWith: ((c: Card) => void) | null = null;
export const setOpenChat = (fn: (c: Card) => void) => { openChatWith = fn; };
/** the Challenges system can take over "Challenge" (e.g. pick a race and send it); until then it opens the Challenges tab */
let challengeHook: ((who: { id: string; name: string }) => void) | null = null;
export const setChallengeHook = (fn: (who: { id: string; name: string }) => void) => { challengeHook = fn; };

const back = () => H().home('social');

// ---------- the person sheet ----------

/** Opens a rider. id is their account id (or a guest's device key from the lobby). */
export async function openPerson(id: string, hint?: Partial<Card>, after?: () => void) {
  const peer = onlineById(id);
  const base: Card = { id, name: hint?.name ?? peer?.state.name ?? 'Rider', ...hint } as Card;
  const s = sheet(`<div class="cm-pv">${personHead(base, peer)}<div class="cm-pv-body">${isAccount(id) && api.signedIn() ? loading(2) : ''}</div></div>`, 'cm-person-sheet');
  const body = s.el.querySelector<HTMLElement>('.cm-pv-body')!;
  // guests in the lobby, or you're not signed in: what presence shows, plus Vibe Ride and block
  if (!isAccount(id) || !api.signedIn()) {
    body.innerHTML = `
      ${peer ? `<button class="btn btn-primary" data-act="vibe">${ci.heart} Invite to Vibe Ride</button>` : ''}
      ${!api.signedIn() ? `<p class="muted small">Sign in to add friends, follow and message riders.</p><button class="btn btn-ghost btn-sm" data-cm-signin>Sign in</button>` : '<p class="muted small">This rider is playing as a guest, so only Vibe Ride is available.</p>'}
      ${safetyRow(base, false)}`;
    bindSignIn(body);
    bindActions(s, base, after);
    return;
  }
  try {
    const c = await api.card(id);
    if (!c) { body.innerHTML = empty(ci.eyeOff, 'Not available', "This rider's privacy settings keep their profile private."); return; }
    met(H().profile(), id);
    s.el.querySelector('.cm-pv-head')!.outerHTML = personHead(c, peer);
    body.innerHTML = personBody(c, !!peer);
    bindActions(s, c, after);
  } catch (e) {
    body.innerHTML = problemBox(e);
    bindSignIn(body);
  }
}

function personHead(c: Card, peer = onlineById(c.id)) {
  const d = doing(peer);
  return `<div class="cm-pv-head">
    ${avatar(c, 'lg', !!d)}
    <div class="cm-pv-id">
      <h2>${esc(c.name)}</h2>
      ${c.username ? `<p class="muted">@${esc(c.username)}</p>` : ''}
      <p class="cm-pv-line">${cardLine(c) || (peer ? `Level ${peer.state.level}` : '')}</p>
      ${d ? `<p class="cm-live">${'<i class="cm-dot"></i>'}${DOING_TEXT[d]}</p>` : ''}
    </div>
    <button class="icon-btn cm-x" data-close aria-label="Close">${ci.x}</button>
  </div>`;
}

function friendButton(c: Card) {
  if (c.rel === 'friend') return `<button class="btn btn-ghost" data-act="unfriend">${ci.userCheck} Friends</button>`;
  if (c.rel === 'sent') return `<button class="btn btn-ghost" data-act="cancel">${ci.userClock} Requested</button>`;
  if (c.rel === 'received') return `<button class="btn btn-primary" data-act="accept">${ci.userCheck} Accept request</button>`;
  if (c.can_request === false) return `<button class="btn btn-ghost" disabled title="Their settings only allow requests from people they share a connection with">${ci.lock} Requests closed</button>`;
  return `<button class="btn btn-primary" data-act="add">${ci.userPlus} Add friend</button>`;
}

function personBody(c: Card, online: boolean) {
  const stats = [
    c.friends !== undefined ? `<span><b>${c.friends}</b>Friends</span>` : '',
    `<span><b>${c.followers ?? 0}</b>Followers</span>`,
    c.km !== undefined ? `<span><b>${Math.round(Number(c.km))}</b>km ridden</span>` : '',
  ].join('');
  return `
    ${statusChips(c.statuses, 5)}
    <div class="cm-pv-stats">${stats}</div>
    ${c.mutual ? `<p class="cm-reason">${ci.users} ${plural(c.mutual, 'mutual friend')}</p>` : ''}
    ${c.crew ? `<button class="cm-crew-chip" data-crew="${c.crew.id}"><span class="cm-logo xs" style="--c:${esc(c.crew.color)}">${CREW_LOGOS[c.crew.logo] ?? ''}</span>${esc(c.crew.name)}</button>` : ''}
    ${c.rel === 'received' ? `<div class="two">${friendButton(c)}<button class="btn btn-ghost" data-act="decline">Decline</button></div>` : `<div class="two">${friendButton(c)}<button class="btn btn-ghost" data-act="follow">${c.following ? `${ci.check} Following` : `${ci.plus} Follow`}</button></div>`}
    <div class="cm-pv-acts">
      <button class="cm-act" data-act="message" ${c.can_message ? '' : 'disabled'}>${ci.chat}<span>Message</span></button>
      <button class="cm-act" data-act="vibe" ${c.can_vibe || (online && isFriend(c.id)) ? '' : 'disabled'}>${ci.heart}<span>Vibe Ride</span></button>
      <button class="cm-act" data-act="challenge">${icons.flag}<span>Challenge</span></button>
    </div>
    ${!c.can_message || !c.can_vibe ? `<p class="muted small cm-why">${ci.lock} ${!c.can_message && !c.can_vibe ? 'Messages and Vibe Ride invites' : !c.can_message ? 'Messages' : 'Vibe Ride invites'} follow ${esc(c.name)}'s privacy settings.</p>` : ''}
    ${safetyRow(c, true)}`;
}

function safetyRow(c: Card, signed: boolean) {
  return `<div class="cm-safety">
    ${signed ? `<button class="btn btn-link" data-act="mute">${ci.mute} ${c.muted ? 'Unmute' : 'Mute'}</button><button class="btn btn-link" data-act="hide">${ci.eyeOff} Hide</button>` : ''}
    <button class="btn btn-link" data-act="report">${ci.flag} Report</button>
    <button class="btn btn-link cm-danger" data-act="block">${ci.block} Block</button>
  </div>`;
}

function bindActions(s: { el: HTMLElement; close: () => void }, c: Card, after?: () => void) {
  const refresh = () => { s.close(); void openPerson(c.id, c, after); after?.(); };
  bindSignIn(s.el);
  s.el.querySelector('[data-crew]')?.addEventListener('click', async () => {
    s.close();
    const { openCrew } = await import('./crews');
    openCrew(Number((s.el.querySelector('[data-crew]') as HTMLElement).dataset.crew));
  });
  s.el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.act!;
    if (a === 'add' || a === 'accept') {
      const r = await act(b, () => api.friend(c.id, a === 'add' ? 'request' : 'accept'));
      if (r === 'friend') { remember({ friends: [...new Set([...known().friends, c.id])] }); toast(`${ci.userCheck} You and <b>${esc(c.name)}</b> are friends now`); }
      if (r === 'sent') toast(`${ci.userPlus} Friend request sent to <b>${esc(c.name)}</b>`);
      if (r) refresh();
    }
    if (a === 'decline' || a === 'cancel') { if (await act(b, () => api.friend(c.id, 'decline'))) refresh(); }
    if (a === 'unfriend') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = 'Tap again to unfriend'; return; }
      if (await act(b, () => api.friend(c.id, 'remove'))) { remember({ friends: known().friends.filter((x) => x !== c.id) }); refresh(); }
    }
    if (a === 'follow') { if ((await act(b, () => api.toggle(c.id, 'follow', !c.following))) !== undefined) refresh(); }
    if (a === 'mute') {
      if ((await act(b, () => api.toggle(c.id, 'mute', !c.muted))) !== undefined) { toast(c.muted ? `Unmuted ${esc(c.name)}` : `${ci.mute} Muted ${esc(c.name)}. Their posts and messages are hidden.`); refresh(); }
    }
    if (a === 'hide') {
      if ((await act(b, () => api.toggle(c.id, 'hide', true))) !== undefined) { s.close(); toast(`${ci.eyeOff} ${esc(c.name)} won't be suggested to you again`); after?.(); }
    }
    if (a === 'block') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = `${ci.block} Tap again to block ${esc(c.name)}`; return; }
      blockLocal(c.id, c.name);
      if (isAccount(c.id) && api.signedIn()) await act(b, () => api.toggle(c.id, 'block', true));
      s.close();
      toast(`${ci.block} You blocked ${esc(c.name)}. They can't contact you or see you in Community.`);
      after?.();
    }
    if (a === 'report') { s.close(); reportSheet(c, 'user', null); }
    if (a === 'message') { s.close(); openChatWith?.(c); }
    if (a === 'vibe') { s.close(); void inviteToRide(c); }
    if (a === 'challenge') {
      s.close();
      if (challengeHook) challengeHook({ id: c.id, name: c.name });
      else { H().home('race'); toast(`${icons.flag} Pick a race, then send ${esc(c.name)} the challenge link`); }
    }
  }));
}

/** Vibe Ride invite: live through the lobby if they're online, or left for them to accept later */
export async function inviteToRide(c: Pick<Card, 'id' | 'name'>) {
  const p = H().profile();
  if (p.guest) return toast('Create your rider first, so people know who they are riding with.');
  if (onlineById(c.id)) return H().vibe.inviteOnline(c.id);
  if (!isAccount(c.id)) return toast(`${esc(c.name)} isn't online right now.`);
  const code = live.newCode();
  const ok = await act(null, () => api.vibeInvite(c.id, code));
  if (ok === undefined) return;
  toast(`${ci.heart} Invite sent. The ride starts when ${esc(c.name)} accepts.`);
  H().vibe.room(code, true);
}

export function reportSheet(c: Pick<Card, 'id' | 'name'>, kind: 'user' | 'post' | 'message' | 'crew', target: string | null, context?: unknown) {
  const s = sheet(`${sheetHead(`${ci.flag} Report ${esc(c.name)}`)}
    <p class="muted small">Reports go to the LEGONRUSH team for review. ${esc(c.name)} isn't told who reported them.</p>
    <div class="cm-reasons">${vb.REPORT_REASONS.map((r) => `<button class="chip-btn" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <textarea class="cm-input" id="cmRepText" maxlength="500" rows="3" placeholder="What happened? (optional)"></textarea>
    <label class="cm-check"><input type="checkbox" id="cmRepBlock" checked> Also block ${esc(c.name)}</label>
    <button class="btn btn-primary" id="cmRepSend" disabled>Send report</button>`);
  let reason = '';
  s.el.querySelectorAll<HTMLElement>('[data-reason]').forEach((b) => b.addEventListener('click', () => {
    reason = b.dataset.reason!;
    s.el.querySelectorAll('[data-reason]').forEach((x) => x.classList.toggle('on', x === b));
    (s.el.querySelector('#cmRepSend') as HTMLButtonElement).disabled = false;
  }));
  s.el.querySelector('#cmRepSend')!.addEventListener('click', async (e) => {
    const details = (s.el.querySelector('#cmRepText') as HTMLTextAreaElement).value.trim();
    const alsoBlock = (s.el.querySelector('#cmRepBlock') as HTMLInputElement).checked;
    // kept on the phone too, so nothing is lost offline
    vb.saveReport({ id: c.id, name: c.name, reason, code: kind, lines: details ? [details] : [], at: Date.now() });
    if (api.signedIn() && isAccount(c.id)) await act(e.currentTarget as HTMLElement, () => api.report(c.id, kind, target, reason, details, context));
    if (alsoBlock) { blockLocal(c.id, c.name); if (api.signedIn() && isAccount(c.id)) void api.toggle(c.id, 'block', true).catch(() => undefined); }
    s.el.innerHTML = `${sheetHead('Thanks for telling us')}<p class="cm-thanks">${ci.check} Your report was sent for review.${alsoBlock ? ` ${esc(c.name)} is blocked.` : ''}</p><button class="btn btn-ghost" data-close>Done</button>`;
  });
}

// ---------- people lists ----------

export type Category = 'friends_status' | 'buddies' | 'social' | 'compete' | 'hall' | 'course' | 'level' | 'search' | 'suggest';
const CATS: Record<Category, [string, string, string]> = {
  friends_status: [ci.users, 'Looking for friends', 'Riders who set their status to Friends.'],
  buddies: [ci.bike, 'Riding buddies', 'Riders looking for people to ride with. Invite one to a Vibe Ride.'],
  social: [ci.party, 'Socializing', 'Riders who want to meet people and join activities.'],
  compete: [ci.trophy, 'Competitors', 'Riders looking for a race. Send them a challenge.'],
  hall: [ci.hall, 'Hall mates', 'Riders from your hall who show their hall.'],
  course: [ci.grad, 'Course mates', 'Riders on your programme who show it.'],
  level: [ci.book, 'Level mates', 'Riders in your programme and year who chose to show their level.'],
  search: [ci.search, 'Search riders', 'Find riders by name or @username. You only see people whose privacy allows it.'],
  suggest: [ci.sparkle, 'People you may know', 'Suggested from your hall, course, rides and friends, with the reason shown.'],
};

/** a list of people for a category, with the "only people who opted in" promise spelled out */
export function peopleScreen(cat: Category, from: () => void = back, query = '') {
  const [ico, title, text] = CATS[cat];
  const p = H().profile();
  const s = social(p);
  const myStatusMissing = ['friends_status', 'buddies', 'social', 'compete'].includes(cat) && !s.statuses.includes(cat === 'friends_status' ? 'friends' : (cat as never));
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ico}</span><div><h1 class="title">${title}</h1><p class="muted">${text}</p></div></div>
    ${cat === 'search' ? `<label class="cm-search"><span>${ci.search}</span><input id="cmQ" type="search" maxlength="30" autocomplete="off" placeholder="Name or @username" value="${esc(query)}"></label>` : ''}
    ${myStatusMissing ? `<div class="cm-note">${fx.info}<span>Want them to find you too? Add <b>${title}</b> to your status.</span><button class="btn btn-ghost btn-sm" id="cmSetStatus">Set status</button></div>` : ''}
    <div id="cmList" class="cm-list">${cat === 'search' && query.length < 2 ? '' : loading(4)}</div>`, from, 'cm-screen');
  const app = H().app;
  const list = app.querySelector<HTMLElement>('#cmList')!;
  app.querySelector('#cmSetStatus')?.addEventListener('click', async () => (await import('./settings')).statusSheet(() => peopleScreen(cat, from, query)));
  const load = async (q = query) => {
    if (cat === 'search' && q.replace(/^@/, '').length < 2) { list.innerHTML = `<p class="muted small">Type at least 2 letters.</p>`; return; }
    list.innerHTML = loading(4);
    try {
      const rows = await api.people(cat === 'hall' || cat === 'course' ? cat : cat, cat === 'search' ? q.replace(/^@/, '') : cat === 'course' ? p.department : '');
      list.innerHTML = rows.length ? rows.map((c) => personRow(c, onlineExtra(c.id))).join('') : emptyFor(cat);
      bindPeople(list, rows, () => void load(q));
    } catch (e) {
      list.innerHTML = problemBox(e, 'cmRetry');
      bindSignIn(list);
      list.querySelector('#cmRetry')?.addEventListener('click', () => void load(q));
    }
  };
  const q = app.querySelector<HTMLInputElement>('#cmQ');
  if (q) {
    let t = 0;
    q.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => void load(q.value.trim()), 350); });
    if (!query) q.focus();
  }
  void load();
}

function emptyFor(cat: Category) {
  const [ico, title] = CATS[cat];
  if (cat === 'search') return empty(ci.search, 'No riders found', 'Check the spelling, or they may have chosen not to be found.');
  if (cat === 'level') return empty(ico, 'No level mates yet', 'Level mates show up when riders on your programme add their level and choose to show it.');
  return empty(ico, `No ${title.toLowerCase()} yet`, 'This is where they will show up as more riders join and choose to be found. Invite your friends to LEGONRUSH!');
}

const onlineExtra = (id: string) => (onlineById(id) ? '<span class="cm-online"><i class="cm-dot"></i></span>' : '');

/** wires [data-person] rows */
export function bindPeople(root: HTMLElement, rows: Card[], after?: () => void) {
  root.querySelectorAll<HTMLElement>('[data-person]').forEach((el) => el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const c = rows.find((r) => r.id === el.dataset.person);
    void openPerson(el.dataset.person!, c, after);
  }));
}

// ---------- friends ----------

type FriendsTab = 'friends' | 'requests' | 'following' | 'followers';
export function friendsScreen(tab: FriendsTab = 'friends', from: () => void = back) {
  const tabs: [FriendsTab, string][] = [['friends', 'Friends'], ['requests', 'Requests'], ['following', 'Following'], ['followers', 'Followers']];
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.users}</span><div><h1 class="title">Friends</h1><p class="muted">Confirmed friends, requests and the riders you follow.</p></div></div>
    <div class="seg wide cm-tabs">${tabs.map(([id, l]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${l}${id === 'requests' && known().requests ? ` <em class="cm-count">${known().requests}</em>` : ''}</button>`).join('')}</div>
    <div id="cmList" class="cm-list">${loading(4)}</div>`, from, 'cm-screen');
  const app = H().app;
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => friendsScreen(b.dataset.tab as FriendsTab, from)));
  const list = app.querySelector<HTMLElement>('#cmList')!;
  const again = () => friendsScreen(tab, from);
  void (async () => {
    try {
      const rows = await api.people(tab);
      if (tab === 'friends') remember({ friends: rows.map((r) => r.id) });
      if (tab === 'requests') remember({ requests: rows.length });
      if (!rows.length) {
        list.innerHTML = tab === 'friends' ? empty(ci.users, 'No friends yet', 'Find people from your hall and course, or ride with someone and add them after.', '<button class="btn btn-primary btn-sm" id="cmFind">Find people</button>')
          : tab === 'requests' ? empty(ci.userPlus, 'No requests', 'When someone wants to be your friend, it shows up here.')
          : tab === 'following' ? empty(ci.star, 'Not following anyone', 'Follow riders to see their activity in your feed.')
          : empty(ci.star, 'No followers yet', 'Riders who follow you see your shared activity.');
        list.querySelector('#cmFind')?.addEventListener('click', () => peopleScreen('suggest', again));
        return;
      }
      if (tab === 'requests') {
        list.innerHTML = rows.map((c) => personRow(c, `<span class="cm-row-acts"><button class="btn btn-primary btn-sm" data-yes="${esc(c.id)}">Accept</button><button class="btn btn-ghost btn-sm" data-no="${esc(c.id)}">Decline</button><button class="icon-btn cm-mini" data-blk="${esc(c.id)}" aria-label="Block">${ci.block}</button></span>`, `${esc(handle(c))} wants to be your friend`)).join('');
        list.querySelectorAll<HTMLElement>('[data-yes]').forEach((b) => b.addEventListener('click', async () => { if (await act(b, () => api.friend(b.dataset.yes!, 'accept'))) { remember({ friends: [...known().friends, b.dataset.yes!], requests: Math.max(0, known().requests - 1) }); again(); } }));
        list.querySelectorAll<HTMLElement>('[data-no]').forEach((b) => b.addEventListener('click', async () => { if (await act(b, () => api.friend(b.dataset.no!, 'decline'))) { remember({ requests: Math.max(0, known().requests - 1) }); again(); } }));
        list.querySelectorAll<HTMLElement>('[data-blk]').forEach((b) => b.addEventListener('click', async () => {
          const c = rows.find((r) => r.id === b.dataset.blk)!;
          blockLocal(c.id, c.name);
          if (await act(b, () => api.toggle(c.id, 'block', true)) !== undefined) { toast(`${ci.block} Blocked ${esc(c.name)}`); again(); }
        }));
      } else if (tab === 'friends') {
        list.innerHTML = groupByDoing(rows);
      } else {
        list.innerHTML = rows.map((c) => personRow(c, onlineExtra(c.id))).join('');
      }
      bindPeople(list, rows, again);
    } catch (e) {
      list.innerHTML = problemBox(e, 'cmRetry');
      bindSignIn(list);
      list.querySelector('#cmRetry')?.addEventListener('click', again);
    }
  })();
}

/** friends sorted into Online / Riding / Racing / In a Vibe Ride / At events / Offline */
function groupByDoing(rows: Card[]) {
  const groups = new Map<string, Card[]>();
  const order = ['Riding', 'Racing', 'In a Vibe Ride', 'At an event', 'Online', 'Offline'];
  for (const c of rows) {
    const d = doing(onlineById(c.id));
    const k = d ? DOING_TEXT[d] : 'Offline';
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return order.filter((k) => groups.has(k)).map((k) => `<p class="cm-group">${k !== 'Offline' ? '<i class="cm-dot"></i>' : ''}${k} <span>${groups.get(k)!.length}</span></p>${groups.get(k)!.map((c) => personRow(c, k !== 'Offline' ? '<span class="cm-online"><i class="cm-dot"></i></span>' : '')).join('')}`).join('');
}

// ---------- riders online ----------

export function onlineScreen(from: () => void = back) {
  const draw = () => {
    const list = onlineNow();
    const st = lobbyState();
    const box = H().app.querySelector<HTMLElement>('#cmList');
    const n = H().app.querySelector<HTMLElement>('#cmOnlineN');
    if (n) n.textContent = st === 'on' ? `${plural(list.length + 1, 'rider')} online on this campus, including you` : st === 'off' ? 'Offline' : 'Connecting…';
    if (!box) return;
    if (st === 'off') { box.innerHTML = empty(icons.wifiOff, 'Live riders unavailable', 'Riders online show here when you are connected.'); return; }
    if (!list.length) { box.innerHTML = empty(ci.users, st === 'on' ? "You're the only one here" : 'Looking for riders…', st === 'on' ? 'Invite a friend to Vibe Ride, or check back soon.' : ''); return; }
    box.innerHTML = list.map((o) => {
      const d = doing(o)!;
      const c: Card = { id: o.key, name: o.state.name, hall: o.state.hall, level: o.state.level } as Card;
      return personRow(c, `<span class="cm-row-acts"><button class="btn btn-ghost btn-sm" data-ride="${esc(o.key)}">${ci.heart} Ride</button></span>`, `<span class="cm-live-t"><i class="cm-dot"></i>${DOING_TEXT[d]}</span> · Level ${o.state.level}${hallName(o.state.hall) ? ` · ${esc(hallName(o.state.hall))}` : ''}`);
    }).join('');
    box.querySelectorAll<HTMLElement>('[data-ride]').forEach((b) => b.addEventListener('click', () => {
      const o = list.find((x) => x.key === b.dataset.ride)!;
      void inviteToRide({ id: o.key, name: o.state.name });
    }));
    bindPeople(box, list.map((o) => ({ id: o.key, name: o.state.name, hall: o.state.hall, level: o.state.level }) as Card));
  };
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.users}</span><div><h1 class="title">Riders online</h1><p class="muted"><i class="cm-dot"></i> <span id="cmOnlineN"></span></p></div></div>
    <p class="muted small">${fx.info} Riders who turned off "Show online status" aren't listed. Invites to ride need the other rider to accept.</p>
    <div id="cmList" class="cm-list"></div>`, from, 'cm-screen');
  draw();
  const stop = H().watchOnline(() => { if (H().app.querySelector('.cm-screen #cmOnlineN')) draw(); else stop(); });
}

// ---------- blocked list (privacy screen) ----------
export async function blockedList(box: HTMLElement) {
  const local = vb.blockedList();
  let rows: Card[] = [];
  if (api.signedIn()) { try { rows = await api.people('blocked'); } catch { /* local list only */ } }
  const all = [...rows.map((r) => ({ id: r.id, name: r.name })), ...local.filter((l) => !rows.some((r) => r.id === l.id)).map((l) => ({ id: l.id, name: l.name }))];
  box.innerHTML = all.length ? all.map((b) => `<div class="cm-person">${avatar({ name: b.name })}<span class="cm-p-main"><b>${esc(b.name)}</b></span><button class="btn btn-ghost btn-sm" data-unblock="${esc(b.id)}">Unblock</button></div>`).join('') : '<p class="muted small">You haven\'t blocked anyone.</p>';
  box.querySelectorAll<HTMLElement>('[data-unblock]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.unblock!;
    unblockLocal(id);
    if (api.signedIn() && isAccount(id)) await act(b, () => api.toggle(id, 'block', false));
    void blockedList(box);
  }));
}
