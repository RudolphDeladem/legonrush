// The Community tab, in DELA's design: a hero over the campus photo, then four parts so the page
// stays clean: Feed (Latest from Campus: news plus rider posts), Discover (riders online, your
// circles, all riders), Messages (chats list and the open chat) and Leaderboard. It stands on its
// own: nothing here links to Vibe Ride.
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { H, esc, fmt } from '../host';
import * as api from './api';
import { known, remember, social, syncNow } from './local';
import type { Card, Chat, Home, Notification } from './model';
import { chatRow, chatsScreen, mountChat, openChat } from './chat';
import { crewsScreen, openCrew } from './crews';
import { datingScreen } from './dating';
import { bindPosts, composer, feedScreen, postHtml } from './feed';
import { NEWS_CATS, campusNews, isLiked, toggleLike, type News, type NewsCat } from './news';
import { badgesHtml, boardTabsHtml, checkSocialBadges, courseScreen, fillBoard, hallScreen, type BoardTab } from './groups';
import { friendsScreen, onlineScreen, openPerson, peopleScreen, type Category } from './people';
import { lobbyState, onlineNow } from './presence';
import { privacyScreen, statusSheet } from './settings';
import { avatar, bindSignIn, ci, empty, hallName, handle, loading, plural, problemBox, sheet, sheetHead, statusChips, statusInfo, timeAgo, toast } from './ui';

let last: Home | null = null;
let lastFor = '';
const here = () => H().home('social');

type Part = 'feed' | 'discover' | 'messages' | 'leaderboard';
const ui = { part: 'feed' as Part, cat: 'all' as NewsCat | 'all' | 'riders', chat: 0, chatFilter: 'all' as 'all' | 'dm' | 'crew', chatQ: '', board: 'riders' as BoardTab };
const PARTS: [Part, string, string, string, string][] = [
  ['feed', 'Feed', ci.edit, 'Find your people', 'Ride together. Compete together. Live campus together.'],
  ['discover', 'Discover', ci.users, 'Discover', 'Find and connect with riders on campus.'],
  ['messages', 'Messages', ci.chat, 'Messages', 'Chat with riders, hall mates, course mates and your crews.'],
  ['leaderboard', 'Leaderboard', ci.trophy, 'Leaderboard', 'See who is leading across campus.'],
];

const FIND: [Category | 'dating', string, string, string][] = [
  ['friends_status', ci.users, 'Friends', 'Looking for friendship'],
  ['buddies', ci.bike, 'Riding buddies', 'Looking for ride partners'],
  ['social', ci.party, 'Social', 'Into social activities'],
  ['compete', ci.trophy, 'Competitors', 'Up for a race'],
  ['dating', ci.heart, 'Dating', '18+ and opted in'],
];

const photo = (n: string) => `${import.meta.env.BASE_URL}photos/${n}.webp`;
const signInBox = (title: string, text: string) => `<div class="cm-signin"><b>${title}</b><p class="muted small">${text}</p><button class="btn btn-primary btn-sm" data-cm-signin>Sign in</button></div>`;

export function render() {
  const signed = api.signedIn();
  const h = signed && lastFor === api.myId() ? last : null;
  const part = PARTS.find((x) => x[0] === ui.part)!;
  return `<div class="cm cm2" id="cm2" style="--cm-banner:url('${photo('challenges-banner')}');--cm-banner-sm:url('${photo('challenges-banner-sm')}')">
    <section class="cm-hero">
      <div class="cm-hero-card">
        <p class="cm-kick"><span>${ci.users}</span>Community</p>
        <h1>${part[3]}</h1>
        <p>${part[4]}</p>
      </div>
      <div class="cm-hero-acts">
        <button class="icon-btn" id="cmNotif" aria-label="Community notifications">${ci.bell}${h?.notifications ? `<i class="dot-badge">${h.notifications}</i>` : ''}</button>
        <button class="icon-btn" id="cmPrivacy" aria-label="Privacy and safety">${ci.shield}</button>
      </div>
    </section>
    <nav class="cm-parts" role="tablist">${PARTS.map(([id, l, ico]) => `<button role="tab" class="${ui.part === id ? 'on' : ''}" data-part="${id}">${ico}<span>${l}</span>${id === 'messages' && h?.unread ? `<i class="dot-badge">${h.unread}</i>` : ''}</button>`).join('')}</nav>
    <div id="cmPart">${partHtml(h)}</div>
  </div>`;
}

function partHtml(h: Home | null) {
  if (ui.part === 'discover') return discoverHtml(h);
  if (ui.part === 'messages') return messagesHtml(h);
  if (ui.part === 'leaderboard') return leaderboardHtml();
  return feedHtml(h);
}

// ---------- Feed ----------

function feedHtml(h: Home | null) {
  const signed = api.signedIn();
  const chip = (id: string, label: string) => `<button class="chip-btn${ui.cat === id ? ' on' : ''}" data-cat="${id}">${label}</button>`;
  const news = ui.cat === 'riders' ? [] : campusNews().filter((n) => ui.cat === 'all' || n.cat === ui.cat);
  const posts = ui.cat === 'all' || ui.cat === 'riders' ? h?.feed ?? [] : [];
  // one list, newest first: news cards and rider posts
  const items: [number, string][] = [
    ...news.map((n) => [n.at, newsCard(n)] as [number, string]),
    ...posts.map((x) => [new Date(x.at).getTime(), `<div class="cm-postwrap">${postHtml(x)}</div>`] as [number, string]),
  ].sort((a, b) => b[0] - a[0]);
  return `<section class="cm-panel">
    <div class="cm-feed-top">
      <div class="grow"><h2 class="cm-h">Latest from Campus</h2><p class="muted">News, stories and updates from the LEGONRUSH community.</p></div>
      <button class="btn btn-primary cm-create" id="cmPost">${ci.plus} Create Post</button>
    </div>
    <div class="cm-chips cm-scroll">${chip('all', 'All')}${NEWS_CATS.map(([id, l]) => chip(id, l)).join('')}${chip('riders', 'Riders')}</div>
    <div class="cm-news" id="cmFeedList">
      ${items.map(([, x]) => x).join('')}
      ${ui.cat === 'riders' && !signed ? signInBox('Posts from riders', 'Sign in to see what riders share, react and post your own.') : ''}
      ${ui.cat === 'riders' && signed && !posts.length ? (h ? empty(icons.bolt, 'No rider posts yet', 'Wins, personal bests and rides from your people show up here. Post something to start it off.') : loading(2)) : ''}
    </div>
    ${signed ? `<button class="btn btn-link" id="cmFeedAll">See all rider posts ${icons.arrow}</button>` : ''}
  </section>`;
}

function newsCard(n: News) {
  const on = isLiked(n.id);
  return `<article class="cm-newscard" data-news="${esc(n.id)}">
    <button class="cm-news-img" data-news-go style="background-image:url('${photo(n.photo)}')" aria-label="${esc(n.goLabel)}"></button>
    <div class="cm-news-body">
      <span class="cm-tag t-${n.cat}">${NEWS_CATS.find(([c]) => c === n.cat)![1]}</span>
      <button class="cm-news-title" data-news-go>${esc(n.title)}</button>
      <p>${esc(n.text)}</p>
      <div class="cm-news-foot">
        <span class="cm-news-by"><span class="cm-lr">LR</span>${esc(n.author)} · ${esc(n.when ?? timeAgo(n.at))}</span>
        <span class="grow"></span>
        <button class="cm-like${on ? ' on' : ''}" data-like aria-pressed="${on}" aria-label="Like">${ci.heart}</button>
        <button class="cm-share" data-share aria-label="Share">${ci.send}</button>
      </div>
    </div>
  </article>`;
}

// ---------- Discover ----------

const onlineText = () => {
  const st = lobbyState();
  return st === 'on' ? `${fmt(onlineNow().length)} online now` : st === 'off' ? 'Online riders unavailable' : 'Finding riders online…';
};

function discoverHtml(h: Home | null) {
  const p = H().profile();
  const s = social(p);
  const signed = api.signedIn();
  const shown = s.statuses.filter((x) => x !== 'none');
  const online = onlineNow().slice(0, 12);
  const circle = (id: string, ico: string, label: string, sub: string) => `<button class="cm-circ" data-circle="${id}"><span class="cm-circ-ico">${ico}</span><span class="grow"><b>${label}</b><small>${sub}</small></span><span class="cm-circ-go">${icons.arrow}</span></button>`;
  return `<form class="cm-search" id="cmSearch"><span>${ci.search}</span><input id="cmSearchIn" type="search" maxlength="30" autocomplete="off" placeholder="Search riders by name or @username"><button class="cm-status-btn" type="button" id="cmStatus" title="Your social status">${shown.length ? shown.map((x) => statusInfo(x)[1]).join('') : ci.plus}<span>${shown.length ? 'Status' : 'Set status'}</span></button></form>
    <section class="cm-panel">
      <div class="cm-sec-top"><h2 class="cm-h">Riders Online <small class="cm-live"><i class="cm-dot"></i><span id="cmOnlineN">${onlineText()}</span></small></h2><button class="cm-all" id="cmOnline">View all ${icons.arrow}</button></div>
      ${online.length ? `<div class="cm-rail" id="cmOnlineRail">${online.map((o) => `<button class="cm-rider" data-online="${esc(o.key)}">${avatar({ name: o.state.name, hall: o.state.hall }, 'lg', true)}<b>${esc(o.state.name)}</b><small>${esc(hallName(o.state.hall) || o.state.department || `Level ${o.state.level}`)}</small><span class="cm-rider-chip">${o.state.place ? `${ci.pin} ${esc(String(o.state.place))}` : `${ci.bike} Level ${o.state.level}`}</span></button>`).join('')}</div>` : `<p class="muted small cm-quiet">No one else is online right now. Riders who are on campus show up here.</p>`}
    </section>
    <section class="cm-panel">
      <div class="cm-sec-top"><div><h2 class="cm-h">Your Circles</h2><p class="muted small">Find people with similar interests.</p></div></div>
      <div class="cm-circs">
        ${circle('hall', ci.hall, 'Hall Mates', p.hall !== 'none' ? (h ? plural(h.hall.members, 'member') : esc(hallName(p.hall))) : 'Choose your hall')}
        ${circle('course', ci.grad, 'Course Mates', p.department ? (h?.course ? plural(h.course.members, 'member') : esc(p.department)) : 'Add your programme')}
        ${circle('buddies', ci.bike, 'Riding Buddies', h ? plural(h.buddies, 'rider') : `${s.counts.rodeWith.length} ridden with`)}
        ${circle('crew', ci.shield, 'Crews', h?.crew ? esc(h.crew.name) : h ? `${plural(h.crews.length, 'crew')} on campus` : 'Join or start one')}
        ${circle('friends', ci.users, 'Friends', h ? `${plural(h.friends, 'friend')}${h.requests ? ` · ${h.requests} new` : ''}` : signed ? '…' : 'Sign in to add friends')}
      </div>
      <div class="cm-find">${FIND.map(([id, ico, t, x]) => `<button class="cm-find-t ${id}" data-find="${id}"><span>${ico}</span><b>${t}</b><small>${x}</small></button>`).join('')}</div>
    </section>
    <section class="cm-panel">
      <div class="cm-sec-top"><h2 class="cm-h">All Riders <small class="muted">People from your hall, course and rides</small></h2>${signed ? `<button class="cm-all" id="cmMoreSuggest">View all ${icons.arrow}</button>` : ''}</div>
      <div id="cmSuggest" class="cm-riders">${signed ? (h ? suggestHtml(h.suggest) : loading(2)) : signInBox('Find riders from your hall and course', 'Sign in to see suggestions, with the reason for each one, and add friends.')}</div>
    </section>`;
}

function suggestHtml(list: Card[]) {
  if (!list.length) return empty(ci.users, 'No suggestions yet', 'As riders from your hall and course join and choose to be found, they show up here with the reason why.');
  const on = new Set(onlineNow().map((o) => o.key));
  return list.slice(0, 12).map((c) => `<div class="cm-rcard">
    <button class="cm-rcard-who" data-sug="${esc(c.id)}">${avatar(c, 'md', on.has(c.id))}<span><b>${esc(c.name)}</b><small>${esc(c.course || hallName(c.hall) || (c.level ? `Level ${c.level}` : ''))}</small>${c.reason ? `<em>${esc(c.reason)}</em>` : statusChips(c.statuses, 1)}</span></button>
    <button class="cm-add" data-add="${esc(c.id)}"${c.rel === 'sent' ? ' disabled' : ''}>${c.rel === 'friend' ? `${ci.userCheck} Friends` : c.rel === 'sent' ? `${ci.userClock} Sent` : `${ci.userPlus} Add`}</button>
  </div>`).join('');
}

// ---------- Messages ----------

function messagesHtml(h: Home | null) {
  if (!api.signedIn()) return `<section class="cm-panel">${signInBox('Chat with riders, hall mates and your crew', 'Sign in to send messages. Who can message you follows your privacy settings.')}</section>`;
  const f = (id: typeof ui.chatFilter, l: string) => `<button class="chip-btn${ui.chatFilter === id ? ' on' : ''}" data-cf="${id}">${l}</button>`;
  return `<section class="cm-msgs">
    <div class="cm-panel cm-msgs-list">
      <div class="cm-sec-top"><h2 class="cm-h">Messages</h2><button class="icon-btn cm-new" id="cmNewChat" aria-label="New message">${ci.edit}</button></div>
      <div class="cm-chips">${f('all', 'All')}${f('dm', 'Direct')}${f('crew', 'Crews')}</div>
      <label class="cm-search sm"><span>${ci.search}</span><input id="cmChatQ" type="search" autocomplete="off" placeholder="Search conversations…" value="${esc(ui.chatQ)}"></label>
      <div id="cmChatList" class="cm-list">${h ? chatListHtml(h.chats) : loading(4)}</div>
    </div>
    <div class="cm-panel cm-msgs-pane" id="cmPane">${h && current(h) ? '' : `<div class="cm-pane-empty">${ci.chat}<b>Your messages</b><p class="muted small">Pick a chat on the left, or open a rider's profile and tap Message.</p></div>`}</div>
  </section>`;
}
const chatTitle = (c: Chat) => (c.kind === 'crew' ? c.crew?.name ?? 'Crew' : handle(c.other ?? { name: 'Rider' }));
function chatListHtml(chats: Chat[]) {
  const q = ui.chatQ.trim().toLowerCase();
  const list = chats.filter((c) => (ui.chatFilter === 'all' || c.kind === ui.chatFilter) && (!q || `${chatTitle(c)} ${c.other?.name ?? ''} ${c.last?.text ?? ''}`.toLowerCase().includes(q)));
  if (!chats.length) return empty(ci.chat, 'No messages yet', "Find someone in Discover, open their profile and tap Message.", '<button class="btn btn-primary btn-sm" data-part="discover">Find people</button>');
  return list.length ? list.map((c) => chatRow(c).replace('class="cm-chat-row', `class="cm-chat-row${c.id === ui.chat ? ' sel' : ''}`)).join('') : `<p class="muted small cm-quiet">No chats match.</p>`;
}
const current = (h: Home) => h.chats.find((c) => c.id === ui.chat) ?? null;
const wide = () => matchMedia('(min-width: 900px)').matches;

// ---------- Leaderboard ----------

function leaderboardHtml() {
  const p = H().profile();
  return `<section class="cm-panel">${boardTabsHtml(ui.board)}<div id="cmBoard" class="cm-board"></div></section>
    <section class="cm-panel"><div class="cm-sec-top"><h2 class="cm-h">Social badges</h2></div><div class="cm-badges">${badgesHtml(p)}</div></section>`;
}

// ---------- binding ----------

export function bind(root: HTMLElement) {
  const p = H().profile();
  let alive = true;
  let stopChat = () => {};
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  checkSocialBadges(p);
  const redraw = () => {
    const el = $('#cm2');
    if (!el) return;
    stopChat();
    stopChat = () => {};
    el.outerHTML = render();
    wire();
  };

  const wire = () => {
    bindSignIn(root);
    $('#cmNotif')?.addEventListener('click', () => notificationsSheet());
    $('#cmPrivacy')?.addEventListener('click', () => privacyScreen(here));
    root.querySelectorAll<HTMLElement>('[data-part]').forEach((b) => b.addEventListener('click', () => { ui.part = b.dataset.part as Part; redraw(); }));
    if (ui.part === 'feed') wireFeed();
    if (ui.part === 'discover') wireDiscover();
    if (ui.part === 'messages') wireMessages();
    if (ui.part === 'leaderboard') wireBoard();
  };

  const wireFeed = () => {
    root.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { ui.cat = b.dataset.cat as typeof ui.cat; redraw(); }));
    $('#cmPost')?.addEventListener('click', () => (api.signedIn() ? composer(here) : H().signIn()));
    $('#cmFeedAll')?.addEventListener('click', () => feedScreen('home', here));
    const news = campusNews();
    root.querySelectorAll<HTMLElement>('[data-news]').forEach((card) => {
      const n = news.find((x) => x.id === card.dataset.news);
      if (!n) return;
      card.querySelectorAll('[data-news-go]').forEach((b) => b.addEventListener('click', () => n.go()));
      card.querySelector('[data-like]')!.addEventListener('click', (e) => { const on = toggleLike(n.id); const b = e.currentTarget as HTMLElement; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      card.querySelector('[data-share]')!.addEventListener('click', () => {
        const note = document.createElement('span');
        H().share(`${n.title} · LEGONRUSH`, `${location.origin}${import.meta.env.BASE_URL}play/`, note);
      });
    });
    const list = $('#cmFeedList');
    if (list && last) bindPosts(list, last.feed, () => void load());
  };

  const wireDiscover = () => {
    $('#cmSearch')?.addEventListener('submit', (e) => { e.preventDefault(); peopleScreen('search', here, $<HTMLInputElement>('#cmSearchIn')!.value.trim()); });
    let st = 0;
    $('#cmSearchIn')?.addEventListener('input', (e) => {
      clearTimeout(st);
      const v = (e.target as HTMLInputElement).value.trim();
      if (v.replace(/^@/, '').length >= 2) st = window.setTimeout(() => peopleScreen('search', here, v), 900);
    });
    $('#cmStatus')?.addEventListener('click', () => statusSheet(here));
    $('#cmOnline')?.addEventListener('click', () => onlineScreen(here));
    root.querySelectorAll<HTMLElement>('[data-online]').forEach((b) => b.addEventListener('click', () => {
      const o = onlineNow().find((x) => x.key === b.dataset.online);
      if (o) void openPerson(o.key, { id: o.key, name: o.state.name, hall: o.state.hall, level: o.state.level });
    }));
    root.querySelectorAll<HTMLElement>('[data-find]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.find!;
      if (!api.signedIn()) return H().signIn();
      if (id === 'dating') datingScreen(here); else peopleScreen(id as Category, here);
    }));
    root.querySelectorAll<HTMLElement>('[data-circle]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.circle;
      if (id === 'hall') { if (p.hall !== 'none') hallScreen(p.hall, here); else H().signIn(); }
      if (id === 'course') { if (p.department) courseScreen(p.department, here); else H().signIn(); }
      if (id === 'friends') { if (api.signedIn()) friendsScreen(last?.requests ? 'requests' : 'friends', here); else H().signIn(); }
      if (id === 'buddies') { if (api.signedIn()) peopleScreen('buddies', here); else H().signIn(); }
      if (id === 'crew') { if (!api.signedIn()) H().signIn(); else if (last?.crew) openCrew(last.crew.id, here); else crewsScreen(here); }
    }));
    $('#cmMoreSuggest')?.addEventListener('click', () => peopleScreen('suggest', here));
    root.querySelectorAll<HTMLElement>('[data-sug]').forEach((b) => b.addEventListener('click', () => {
      const c = last?.suggest.find((x) => x.id === b.dataset.sug);
      void openPerson(b.dataset.sug!, c, () => void load());
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      const c = last?.suggest.find((x) => x.id === b.dataset.add);
      if (!c || c.rel === 'friend') return void (c && openPerson(c.id, c));
      b.disabled = true;
      try {
        const r = await api.friend(c.id, c.rel === 'received' ? 'accept' : 'request');
        c.rel = r === 'friend' ? 'friend' : 'sent';
        b.innerHTML = r === 'friend' ? `${ci.userCheck} Friends` : `${ci.userClock} Sent`;
      } catch (e) { b.disabled = false; toast(esc(api.problemText(e))); }
    }));
  };

  const showChat = (c: Chat) => {
    ui.chat = c.id;
    if (!wide()) return openChat(c, here);
    root.querySelectorAll('.cm-chat-row').forEach((r) => r.classList.toggle('sel', (r as HTMLElement).dataset.chat === String(c.id)));
    const pane = $('#cmPane');
    if (!pane) return;
    stopChat();
    stopChat = mountChat(c, pane, () => { ui.chat = 0; void load(); });
    c.unread = 0;
  };
  const wireMessages = () => {
    const list = $('#cmChatList');
    const fillList = () => {
      if (!list || !last) return;
      list.innerHTML = chatListHtml(last.chats);
      list.querySelectorAll<HTMLElement>('[data-chat]').forEach((el) => el.addEventListener('click', () => { const c = last?.chats.find((x) => x.id === Number(el.dataset.chat)); if (c) showChat(c); }));
      list.querySelectorAll<HTMLElement>('[data-part]').forEach((b) => b.addEventListener('click', () => { ui.part = 'discover'; redraw(); }));
    };
    fillList();
    root.querySelectorAll<HTMLElement>('[data-cf]').forEach((b) => b.addEventListener('click', () => {
      ui.chatFilter = b.dataset.cf as typeof ui.chatFilter;
      root.querySelectorAll('[data-cf]').forEach((x) => x.classList.toggle('on', x === b));
      fillList();
    }));
    $('#cmChatQ')?.addEventListener('input', (e) => { ui.chatQ = (e.target as HTMLInputElement).value; fillList(); });
    $('#cmNewChat')?.addEventListener('click', () => friendsScreen('friends', here));
    const c = last && current(last);
    if (c && wide()) showChat(c);
    else if (last?.chats.length && wide() && !ui.chat) showChat(last.chats[0]);
  };

  const wireBoard = () => {
    root.querySelectorAll<HTMLElement>('[data-b]').forEach((x) => x.addEventListener('click', () => { ui.board = x.dataset.b as BoardTab; redraw(); }));
    const box = $('#cmBoard');
    if (box) fillBoard(box, ui.board, redraw);
  };

  const load = async () => {
    if (!api.signedIn()) return;
    await syncNow(p);
    try {
      const h = await api.home();
      if (!alive) return;
      const firstChat = !last && ui.part === 'messages';
      last = h;
      lastFor = api.myId();
      // who your friends and connections are, for live privacy checks (map pins)
      remember({ requests: h.requests, crew: h.crew?.id ?? null, friends: h.friend_ids ?? known().friends, matches: h.match_ids ?? known().matches });
      checkSocialBadges(p);
      // the open chat keeps running; everything else redraws with the fresh data
      if (ui.part === 'messages' && !firstChat && $('#cmPane .cm-thread')) {
        const list = $('#cmChatList');
        if (list) { list.innerHTML = chatListHtml(h.chats); list.querySelectorAll<HTMLElement>('[data-chat]').forEach((el) => el.addEventListener('click', () => { const c = h.chats.find((x) => x.id === Number(el.dataset.chat)); if (c) showChat(c); })); }
        return;
      }
      redraw();
    } catch (e) {
      if (!alive) return;
      for (const id of ['#cmSuggest', '#cmChatList']) {
        const box = $(id);
        if (box) box.innerHTML = problemBox(e, 'cmHomeRetry');
      }
      bindSignIn(root);
      $('#cmHomeRetry')?.addEventListener('click', () => void load());
    }
  };
  wire();
  void load();

  const stopOnline = H().watchOnline(() => {
    if (ui.part !== 'discover') return;
    const n = $('#cmOnlineN');
    if (n) n.textContent = onlineText();
  });
  const stopLive = api.onLive((e) => { if (e.type === 'notification' || e.type === 'message') void load(); });
  return () => { alive = false; stopChat(); stopOnline(); stopLive(); };
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
