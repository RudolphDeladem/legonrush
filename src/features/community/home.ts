// The Community tab: "Who is around me, who do I know, and who can I connect with?"
// Organised like campus life: your hall, course and level, friends, riding buddies, crew, then
// discovery (Find your people, People you may know), the feed, Vibe Ride, messages and crews.
import * as live from '../../live';
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { H, esc, fmt } from '../host';
import * as vb from '../vibe';
import * as api from './api';
import { known, remember, social, syncNow } from './local';
import type { Card, Home, Notification } from './model';
import { chatRow, chatsScreen, openChat } from './chat';
import { bindCrews, crewCard, crewsScreen, createCrewScreen, openCrew } from './crews';
import { datingScreen } from './dating';
import { bindPosts, composer, feedScreen, postHtml } from './feed';
import { badgesHtml, boardsScreen, checkSocialBadges, courseScreen, hallScreen } from './groups';
import { friendsScreen, onlineScreen, openPerson, peopleScreen, type Category } from './people';
import { lobbyState, onlineNow } from './presence';
import { privacyScreen, statusSheet } from './settings';
import { avatar, bindSignIn, ci, empty, hallName, loading, plural, problemBox, sheet, sheetHead, statusChips, statusInfo, timeAgo } from './ui';

let last: Home | null = null;
let lastFor = '';
const here = () => H().home('social');

const FIND: [Category | 'dating', string, string, string][] = [
  ['friends_status', ci.users, 'Friends', 'Looking for friendship'],
  ['buddies', ci.bike, 'Riding buddies', 'Looking for ride partners'],
  ['social', ci.party, 'Social', 'Into social activities'],
  ['compete', ci.trophy, 'Competitors', 'Up for a race'],
  ['dating', ci.heart, 'Dating', '18+ and opted in'],
];

const onlineText = () => {
  const st = lobbyState();
  return st === 'on' ? `<b>${fmt(onlineNow().length + 1)}</b> riders online` : st === 'off' ? 'Riders online unavailable' : 'Finding riders online…';
};

export function render() {
  const p = H().profile();
  const s = social(p);
  const signed = api.signedIn();
  const h = signed && lastFor === api.myId() ? last : null;
  const shown = s.statuses.filter((x) => x !== 'none');
  return `<div class="cm">
    <header class="cm-top">
      <h1 class="title">Community</h1>
      <div class="cm-top-acts">
        <button class="icon-btn" id="cmNotif" aria-label="Community notifications">${ci.bell}${h?.notifications ? `<i class="dot-badge">${h.notifications}</i>` : ''}</button>
        <button class="icon-btn" id="cmMsgs" aria-label="Messages">${ci.chat}${h?.unread ? `<i class="dot-badge">${h.unread}</i>` : ''}</button>
        <button class="icon-btn" id="cmPrivacy" aria-label="Privacy and safety">${ci.shield}</button>
      </div>
      <p class="muted cm-top-sub">Connect with riders. Find your people.</p>
    </header>
    <form class="cm-search" id="cmSearch"><span>${ci.search}</span><input id="cmSearchIn" type="search" maxlength="30" autocomplete="off" placeholder="Search riders by name or @username"></form>
    <div class="cm-strip">
      <button class="cm-pill online${lobbyState() === 'on' ? '' : ' off'}" id="cmOnline"><i class="cm-dot"></i><span id="cmOnlineN">${onlineText()}</span><em>View</em></button>
      <button class="cm-pill status" id="cmStatus">${shown.length ? `${shown.map((x) => statusInfo(x)[1]).join('')}<span>${shown.map((x) => statusInfo(x)[2]).join(' · ')}${s.showStatus ? '' : ' (hidden)'}</span>` : s.statuses.includes('none') ? `${ci.moon}<span>Not looking</span>` : `${ci.plus}<span>Set your social status</span>`}<em>Edit</em></button>
    </div>
    <div class="cm-grid">
      <div class="cm-col">
        <section class="cm-card cm-circle" id="cmCircle">${circleHtml(h)}</section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${ci.sparkle} Find your people</h2></div>
          <p class="muted small">Only riders who chose that kind of connection show up.</p>
          <div class="cm-find">${FIND.map(([id, ico, t, x]) => `<button class="cm-find-t ${id}" data-find="${id}"><span>${ico}</span><b>${t}</b><small>${x}</small></button>`).join('')}</div>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${ci.users} People you may know</h2>${signed ? '<button class="btn btn-link" id="cmMoreSuggest">View more</button>' : ''}</div>
          <div id="cmSuggest" class="cm-suggest">${signed ? (h ? suggestHtml(h.suggest) : loading(2)) : signInBox('See people from your hall and course', 'Sign in to get suggestions, with the reason for each one.')}</div>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${icons.bolt} Community feed</h2>${signed ? `<button class="btn btn-ghost btn-sm" id="cmPost">${ci.edit} Post</button><button class="btn btn-link" id="cmFeedAll">View all</button>` : ''}</div>
          <div id="cmFeedPrev" class="cm-feed">${signed ? (h ? feedPrevHtml(h) : loading(2)) : signInBox('Wins, PBs and events from your people', 'Sign in to see the feed and react.')}</div>
        </section>
      </div>
      <div class="cm-col">
        <section class="cm-card cm-vibe">
          <div class="cm-sec-head"><h2>${ci.heart} Vibe Ride</h2></div>
          <p class="muted small">Ride together and enjoy the campus. Invites always need the other rider to accept.</p>
          <p class="small cm-vibe-prefs">${esc(vb.prefsSummary(vb.loadPrefs(p)))}</p>
          <div class="two"><button class="btn btn-primary" id="cmVibeFind">Find a rider</button><button class="btn btn-ghost" id="cmVibeNew">Private ride</button></div>
          <form class="row cm-code" id="cmVibeCode"><input class="code-in" id="cmCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Got a code?"><button class="btn btn-ghost btn-sm">Join</button></form>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${ci.chat} Messages</h2>${signed ? `<button class="btn btn-link" id="cmChatsAll">View all</button>` : ''}</div>
          <div id="cmChatsPrev" class="cm-list">${signed ? (h ? chatsPrevHtml(h) : loading(2)) : signInBox('Chat with friends and your crew', 'Sign in to send messages.')}</div>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${ci.shield} Crews</h2>${signed ? `<button class="btn btn-link" id="cmCrewsAll">Explore</button>` : ''}</div>
          <div id="cmCrewsPrev" class="cm-list">${signed ? (h ? crewsPrevHtml(h) : loading(2)) : signInBox('Join a riding crew', 'Sign in to join or start a crew.')}</div>
        </section>
        <section class="cm-card cm-date-card-home">
          <div class="cm-sec-head"><h2>${ci.heart} Dating</h2></div>
          <p class="muted small">${s.dating.on ? `You're open to dating.${h?.matches ? ` ${plural(h.matches, 'connection')}.` : ''}` : 'Opt-in and 18+. Only people who switched it on see each other, and chat opens only when you both connect.'}</p>
          <button class="btn btn-ghost" id="cmDating">${s.dating.on ? 'Discover' : 'Learn more'}</button>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${ci.chart} Leaderboards</h2><button class="btn btn-link" id="cmBoards">View all</button></div>
          <div class="cm-board-links">
            <button data-board="riders">${icons.trophy}Top riders</button><button data-board="active">${icons.bike}Most active</button>
            <button data-board="crews">${ci.shield}Top crews</button><button data-board="halls">${ci.hall}Halls</button>
          </div>
        </section>
        <section class="cm-card">
          <div class="cm-sec-head"><h2>${fx.medal} Social badges</h2></div>
          <div class="cm-badges">${badgesHtml(p)}</div>
        </section>
      </div>
    </div>
  </div>`;
}

const signInBox = (title: string, text: string) => `<div class="cm-signin"><b>${title}</b><p class="muted small">${text}</p><button class="btn btn-primary btn-sm" data-cm-signin>Sign in</button></div>`;

function circleHtml(h: Home | null) {
  const p = H().profile();
  const s = social(p);
  const row = (id: string, ico: string, label: string, value: string, sub: string, disabled = false) =>
    `<button class="cm-circle-row" data-circle="${id}" ${disabled ? 'disabled' : ''}><span class="cm-ci">${ico}</span><span class="cm-p-main"><small>${label}</small><b>${value}</b></span><span class="cm-circle-n">${sub}</span>${disabled ? '' : icons.arrow}</button>`;
  const crew = h?.crew;
  return `<div class="cm-sec-head"><h2>Your Campus Circle</h2></div>
    ${row('hall', ci.hall, 'Your hall', p.hall !== 'none' ? esc(hallName(p.hall)) : 'No hall chosen', h ? plural(h.hall.members, 'member') : '', p.hall === 'none')}
    ${row('course', ci.grad, 'Your course', p.department ? esc(p.department) : 'Add your programme', h?.course ? plural(h.course.members, 'member') : '', !p.department)}
    ${s.level ? row('level', ci.book, 'Your level', `Level ${esc(s.level)}`, h?.level ? plural(h.level.members, 'rider') : '') : ''}
    ${row('friends', ci.users, 'Your friends', h ? plural(h.friends, 'friend') : api.signedIn() ? '…' : 'Sign in to add friends', h?.requests ? `<em class="cm-count">${h.requests} new</em>` : h ? `${h.followers} followers` : '')}
    ${row('buddies', ci.bike, 'Your riding buddies', h ? plural(h.buddies, 'rider') : `${social(p).counts.rodeWith.length} ridden with`, '')}
    ${row('crew', ci.shield, 'Your crew', crew ? esc(crew.name) : 'Join or start a crew', crew ? plural(crew.members, 'member') : '')}`;
}

function suggestHtml(list: Card[]) {
  if (!list.length) return empty(ci.users, 'No suggestions yet', 'As riders from your hall and course join and choose to be found, they show up here with the reason why.');
  const on = new Set(onlineNow().map((o) => o.key));
  return list.slice(0, 8).map((c) => `<button class="cm-sug" data-sug="${esc(c.id)}">
    ${avatar(c, 'md', on.has(c.id))}
    <b>${esc(c.username ? `@${c.username}` : c.name)}</b>
    <small>${esc(hallName(c.hall) || c.course || (c.level ? `Level ${c.level}` : ''))}</small>
    ${statusChips(c.statuses, 1)}
    ${c.reason ? `<span class="cm-why-chip">${esc(c.reason)}</span>` : ''}
  </button>`).join('');
}

function feedPrevHtml(h: Home) {
  return h.feed.length ? h.feed.slice(0, 3).map((x) => postHtml(x)).join('') : empty(icons.bolt, 'Your feed is quiet', 'Wins, personal bests and events from friends, people you follow and your hall show up here. Share something to get it going.');
}

function chatsPrevHtml(h: Home) {
  return h.chats.length ? h.chats.slice(0, 3).map(chatRow).join('') : `<p class="muted small">No messages yet. Open a rider's profile and tap Message.</p>`;
}

function crewsPrevHtml(h: Home) {
  const mine = h.crew ? `${crewCard(h.crew)}` : `<div class="cm-cta">${ci.shield}<span><b>Start a crew</b><small>Your own riding group, chat and leaderboard.</small></span><button class="btn btn-primary btn-sm" id="cmCrewNew">Create</button></div>`;
  const others = h.crews.filter((c) => c.id !== h.crew?.id).slice(0, h.crew ? 2 : 3);
  return mine + (others.length ? `<b class="cm-label">Popular on campus</b>${others.map(crewCard).join('')}` : '');
}

// ---------- binding ----------

export function bind(root: HTMLElement) {
  const p = H().profile();
  let alive = true;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  bindSignIn(root);
  checkSocialBadges(p);

  $('#cmSearch')!.addEventListener('submit', (e) => { e.preventDefault(); peopleScreen('search', here, $<HTMLInputElement>('#cmSearchIn')!.value.trim()); });
  let st = 0;
  $('#cmSearchIn')!.addEventListener('input', (e) => {
    clearTimeout(st);
    const v = (e.target as HTMLInputElement).value.trim();
    if (v.replace(/^@/, '').length >= 2) st = window.setTimeout(() => peopleScreen('search', here, v), 700);
  });
  $('#cmOnline')!.addEventListener('click', () => onlineScreen(here));
  $('#cmStatus')!.addEventListener('click', () => statusSheet(here));
  $('#cmPrivacy')!.addEventListener('click', () => privacyScreen(here));
  $('#cmNotif')!.addEventListener('click', () => notificationsSheet());
  $('#cmMsgs')!.addEventListener('click', () => (api.signedIn() ? chatsScreen(here) : H().signIn()));
  root.querySelectorAll<HTMLElement>('[data-find]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.find!;
    if (!api.signedIn()) return H().signIn();
    if (id === 'dating') datingScreen(here); else peopleScreen(id as Category, here);
  }));
  $('#cmMoreSuggest')?.addEventListener('click', () => peopleScreen('suggest', here));
  $('#cmPost')?.addEventListener('click', () => composer(here));
  $('#cmFeedAll')?.addEventListener('click', () => feedScreen('home', here));
  $('#cmChatsAll')?.addEventListener('click', () => chatsScreen(here));
  $('#cmCrewsAll')?.addEventListener('click', () => crewsScreen(here));
  $('#cmDating')!.addEventListener('click', () => datingScreen(here));
  $('#cmBoards')!.addEventListener('click', () => boardsScreen('riders', here));
  root.querySelectorAll<HTMLElement>('[data-board]').forEach((b) => b.addEventListener('click', () => boardsScreen(b.dataset.board as 'riders', here)));
  $('#cmVibeFind')!.addEventListener('click', () => H().vibe.setup());
  $('#cmVibeNew')!.addEventListener('click', () => H().vibe.room(live.newCode(), true));
  $('#cmVibeCode')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = ($<HTMLInputElement>('#cmCode')!.value || '').trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) H().vibe.room(code, false);
  });

  const bindData = () => {
    root.querySelectorAll<HTMLElement>('[data-circle]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.circle;
      if (id === 'hall') hallScreen(p.hall, here);
      if (id === 'course') courseScreen(p.department, here);
      if (id === 'level') peopleScreen('level', here);
      if (id === 'friends') { if (api.signedIn()) friendsScreen(last?.requests ? 'requests' : 'friends', here); else H().signIn(); }
      if (id === 'buddies') { if (api.signedIn()) peopleScreen('buddies', here); else H().signIn(); }
      if (id === 'crew') { if (!api.signedIn()) H().signIn(); else if (last?.crew) openCrew(last.crew.id, here); else crewsScreen(here); }
    }));
    root.querySelectorAll<HTMLElement>('[data-sug]').forEach((b) => b.addEventListener('click', () => {
      const c = last?.suggest.find((x) => x.id === b.dataset.sug);
      void openPerson(b.dataset.sug!, c, () => void load());
    }));
    const feed = $('#cmFeedPrev');
    if (feed && last) bindPosts(feed, last.feed, () => void load());
    root.querySelectorAll<HTMLElement>('#cmChatsPrev [data-chat]').forEach((el) => el.addEventListener('click', () => {
      const c = last?.chats.find((x) => x.id === Number(el.dataset.chat));
      if (c) openChat(c, here);
    }));
    const crews = $('#cmCrewsPrev');
    if (crews) bindCrews(crews);
    $('#cmCrewNew')?.addEventListener('click', () => void createCrewScreen(here));
  };
  bindData();

  const load = async () => {
    if (!api.signedIn()) return;
    await syncNow(p);
    try {
      const h = await api.home();
      if (!alive) return;
      last = h;
      lastFor = api.myId();
      // who your friends and connections are, for live privacy checks (Vibe Ride invites, map pins)
      remember({ requests: h.requests, crew: h.crew?.id ?? null, friends: h.friend_ids ?? known().friends, matches: h.match_ids ?? known().matches });
      $('#cmCircle')!.innerHTML = circleHtml(h);
      $('#cmSuggest')!.innerHTML = suggestHtml(h.suggest);
      $('#cmFeedPrev')!.innerHTML = feedPrevHtml(h);
      $('#cmChatsPrev')!.innerHTML = chatsPrevHtml(h);
      $('#cmCrewsPrev')!.innerHTML = crewsPrevHtml(h);
      $('#cmNotif')!.innerHTML = `${ci.bell}${h.notifications ? `<i class="dot-badge">${h.notifications}</i>` : ''}`;
      $('#cmMsgs')!.innerHTML = `${ci.chat}${h.unread ? `<i class="dot-badge">${h.unread}</i>` : ''}`;
      bindData();
      checkSocialBadges(p);
      const badges = $('.cm-badges');
      if (badges) badges.innerHTML = badgesHtml(p);
    } catch (e) {
      if (!alive) return;
      for (const id of ['#cmSuggest', '#cmFeedPrev', '#cmChatsPrev', '#cmCrewsPrev']) {
        const box = $(id);
        if (box) box.innerHTML = id === '#cmSuggest' ? problemBox(e, 'cmHomeRetry') : `<p class="muted small">${esc(api.problemText(e))}</p>`;
      }
      bindSignIn(root);
      $('#cmHomeRetry')?.addEventListener('click', () => void load());
    }
  };
  void load();

  const stopOnline = H().watchOnline(() => { const n = $('#cmOnlineN'); if (n) n.innerHTML = onlineText(); $('#cmOnline')?.classList.toggle('off', lobbyState() !== 'on'); });
  const stopLive = api.onLive((e) => { if (e.type === 'message' || e.type === 'notification') void load(); });
  return () => { alive = false; stopOnline(); stopLive(); };
}

// ---------- notifications ----------

export async function notificationsSheet() {
  const s = sheet(`${sheetHead(`${ci.bell} Notifications`)}<div id="cmNotifs" class="cm-list">${api.signedIn() ? loading(3) : ''}</div>`);
  const box = s.el.querySelector<HTMLElement>('#cmNotifs')!;
  if (!api.signedIn()) {
    box.innerHTML = empty(ci.bell, 'Sign in for notifications', 'Friend requests, messages, crew news and Vibe Ride invites show up here.', '<button class="btn btn-primary btn-sm" data-cm-signin>Sign in</button>');
    bindSignIn(box);
    return;
  }
  try {
    const list = await api.notifications();
    box.innerHTML = list.length ? list.map((n) => `<button class="cm-notif${n.read ? '' : ' new'}" data-n="${n.id}"><span class="cm-ci">${notifIcon(n)}</span><span class="cm-p-main"><b>${esc(n.text)}</b><small>${timeAgo(n.at)}</small></span></button>`).join('')
      : empty(ci.bell, 'All caught up', 'Friend requests, crew news and new connections show up here.');
    box.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => b.addEventListener('click', () => { s.close(); openNotification(list.find((n) => n.id === Number(b.dataset.n))!); }));
    if (list.some((n) => !n.read)) void api.readNotifications().catch(() => undefined);
  } catch (e) {
    box.innerHTML = problemBox(e);
  }
}

export function notifIcon(n: Notification) {
  const k = n.kind;
  return k.startsWith('friend') ? ci.userPlus : k === 'follow' ? ci.star : k.startsWith('crew') ? ci.shield : k.startsWith('dating') || k.startsWith('vibe') ? ci.heart : k === 'react' ? icons.flame : ci.bell;
}

export function openNotification(n: Notification) {
  const k = n.kind;
  if (k === 'friend_request') return friendsScreen('requests', here);
  if ((k === 'friend_accept' || k === 'follow') && n.actor) return void openPerson(n.actor);
  if (k.startsWith('crew') && n.ref) return openCrew(Number(n.ref), here);
  if (k === 'dating_match') return datingScreen(here, 'matches');
  if (k === 'react') return feedScreen('home', here);
  if (k === 'vibe_invite' && n.ref) return H().vibe.room(n.ref, false);
  here();
}
