// The Community feed: game activity from every system (postActivity), short text posts and
// ride results, with reactions. Kept game-focused: no links, no photos, 280 characters.
import { RACES } from '../../game/routes';
import { icons } from '../../ui/icons';
import { setActivitySender, type Activity } from '../activity';
import { fx } from '../icons';
import { H, clock, esc, screen } from '../host';
import * as api from './api';
import { count, known, social } from './local';
import type { Post, Reaction } from './model';
import { openPerson, reportSheet } from './people';
import { REACTIONS, act, avatar, bindSignIn, ci, empty, handle, loading, problemBox, sheet, sheetHead, timeAgo, toast } from './ui';

const AKIND_ICON: Record<string, string> = {
  race_win: icons.trophy, pb: icons.flame, treasure: fx.chest, event_join: fx.calendar, event_done: fx.calendar, challenge_new: icons.flag,
  challenge_win: fx.medal, badge: fx.medal, km: icons.bike, hall: icons.pillars, post: icons.chat,
};
const KIND_ICON: Record<Post['kind'], string> = { text: icons.chat, activity: icons.bolt, ride: icons.bike, event: fx.calendar, challenge: icons.flag, achievement: fx.medal };
const AUDIENCE: Record<Post['audience'], [string, string]> = { public: [ci.globe, 'Everyone'], friends: [ci.users, 'Friends'], hall: [ci.hall, 'Hall'], crew: [ci.shield, 'Crew'] };

// ---------- activity from the rest of the game ----------

const OUT_KEY = 'legonrush.activity.out.v1';
const readOut = (): Activity[] => { try { const v = JSON.parse(localStorage.getItem(OUT_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeOut = (a: Activity[]) => { try { localStorage.setItem(OUT_KEY, JSON.stringify(a.slice(-30))); } catch { /* private mode */ } };

let flushing = false;
/** sends waiting activity (kept on the phone while offline or signed out, for up to 3 days) */
export async function flushActivity() {
  if (flushing || !api.signedIn() || !navigator.onLine) return;
  flushing = true;
  try {
    let items = readOut().filter((a) => Date.now() - (a.at ?? 0) < 3 * 86400e3);
    while (items.length) {
      const a = items[0];
      try {
        await api.post(a.kind === 'post' ? 'text' : 'activity', a.text.slice(0, 280), { akind: a.kind, ref: a.ref });
      } catch (e) {
        const p = api.problemOf(e);
        if (p === 'offline' || p === 'setup' || p === 'signin' || p === 'rate') break;
      }
      items = items.slice(1);
      writeOut(items);
    }
  } finally {
    flushing = false;
  }
}

/** the real sender for features/activity.ts: respects "Show my activity" */
export function startActivity() {
  setActivitySender((a) => {
    let p;
    try { p = H().profile(); } catch { p = null; }
    if (p && (a.kind === 'event_join' || a.kind === 'event_done')) count(p, 'events');
    if (p && social(p).privacy.activity === 'off' && a.kind !== 'post') return;
    writeOut([...readOut(), a]);
    void flushActivity();
  });
  addEventListener('online', () => void flushActivity());
}

// ---------- posts ----------

export function postHtml(x: Post, compact = false) {
  const me = api.myId();
  const icon = x.akind ? AKIND_ICON[x.akind] ?? KIND_ICON[x.kind] : KIND_ICON[x.kind];
  const [aIco, aText] = AUDIENCE[x.audience] ?? AUDIENCE.friends;
  const reacts = REACTIONS.map(([k, ico, label]) => {
    const n = x.reactions?.[k] ?? 0;
    return `<button class="cm-react${x.mine === k ? ' on' : ''}" data-react="${k}" aria-label="${label}" title="${label}">${ico}${n ? `<span>${n}</span>` : ''}</button>`;
  }).join('');
  return `<article class="cm-post ${x.kind}" data-post="${x.id}">
    <header>
      <button class="cm-post-who" data-person="${esc(x.author.id)}">${avatar(x.author, 'xs')}<b>${esc(handle(x.author))}</b></button>
      <span class="cm-post-meta">${aIco}<span class="sr">${aText}</span> · ${timeAgo(x.at)}</span>
      ${compact ? '' : `<button class="icon-btn cm-mini" data-menu aria-label="More">${ci.more}</button>`}
    </header>
    <p class="cm-post-text">${x.kind !== 'text' ? `<span class="cm-post-ico">${icon}</span>` : ''}${esc(x.text)}</p>
    ${compact ? '' : `<footer class="cm-reacts">${reacts}</footer>`}
    ${x.author.id === me && compact ? '' : ''}
  </article>`;
}

/** wires reactions, author taps and the … menu inside root */
export function bindPosts(root: HTMLElement, posts: Post[], again: () => void) {
  root.querySelectorAll<HTMLElement>('.cm-post').forEach((el) => {
    const x = posts.find((p) => p.id === Number(el.dataset.post));
    if (!x) return;
    el.querySelector('[data-person]')?.addEventListener('click', () => void openPerson(x.author.id, { id: x.author.id, name: x.author.name, username: x.author.username, hall: x.author.hall }));
    el.querySelectorAll<HTMLElement>('[data-react]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.react as Reaction;
      const was = x.mine ?? null;
      const next = was === k ? null : k;
      // show it at once; the server follows
      if (was) x.reactions[was] = Math.max(0, (x.reactions[was] ?? 1) - 1);
      if (next) x.reactions[next] = (x.reactions[next] ?? 0) + 1;
      x.mine = next;
      el.outerHTML = postHtml(x);
      bindPosts(root, posts, again);
      try {
        await api.react(x.id, next);
        if (next && !was) count(H().profile(), 'reactions');
      } catch (e) {
        toast(`${fx.info} ${esc(api.problemText(e))}`);
      }
    }));
    el.querySelector('[data-menu]')?.addEventListener('click', () => postMenu(x, again));
  });
}

function postMenu(x: Post, again: () => void) {
  const mine = x.author.id === api.myId();
  const s = sheet(`${sheetHead('Post')}
    <p class="muted small">${esc(x.text)}</p>
    ${mine ? `<button class="btn btn-ghost cm-danger" data-a="delete">${ci.trash} Delete post</button>` : `
      <button class="btn btn-ghost" data-a="person">${ci.users} View ${esc(x.author.name)}</button>
      <button class="btn btn-ghost" data-a="mute">${ci.mute} Mute ${esc(x.author.name)}</button>
      <button class="btn btn-ghost" data-a="report">${ci.flag} Report post</button>`}`);
  s.el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    if (a === 'delete' && (await act(b, () => api.deletePost(x.id))) !== undefined) { s.close(); again(); }
    if (a === 'person') { s.close(); void openPerson(x.author.id, { id: x.author.id, name: x.author.name }); }
    if (a === 'mute' && (await act(b, () => api.toggle(x.author.id, 'mute', true))) !== undefined) { s.close(); toast(`${ci.mute} Muted ${esc(x.author.name)}`); again(); }
    if (a === 'report') { s.close(); reportSheet({ id: x.author.id, name: x.author.name }, 'post', String(x.id), { text: x.text }); }
  }));
}

/** write a post: a short text, or one of your race results */
export function composer(done: () => void, opts: { audience?: Post['audience'] } = {}) {
  const p = H().profile();
  const results = RACES.filter((r) => p.bestTimes[r.id]).map((r) => [r.id, `${r.name} — ${clock(p.bestTimes[r.id])}`] as const);
  const hasCrew = !!known().crew;
  let audience: Post['audience'] = opts.audience ?? 'friends';
  let kind: Post['kind'] = 'text';
  const auds: Post['audience'][] = ['public', 'friends', ...(p.hall !== 'none' ? ['hall' as const] : []), ...(hasCrew ? ['crew' as const] : [])];
  const s = sheet(`${sheetHead('Share with the campus')}
    <textarea class="cm-input" id="cmPostText" maxlength="280" rows="3" placeholder="How was the ride?"></textarea>
    <div class="cm-count-row"><span class="muted small" id="cmPostLeft">280</span></div>
    ${results.length ? `<b class="cm-label">Or share a result</b><div class="cm-chips">${results.slice(0, 6).map(([id, t]) => `<button class="chip-btn" data-result="${esc(id)}">${icons.bike} ${esc(t)}</button>`).join('')}</div>` : ''}
    <b class="cm-label">Who can see it</b>
    <div class="seg wide" id="cmAud">${auds.map((a) => `<button data-v="${a}" class="${a === audience ? 'on' : ''}">${AUDIENCE[a][0]} ${AUDIENCE[a][1]}</button>`).join('')}</div>
    <p class="muted small">Keep it about riding and campus life. No phone numbers or links.</p>
    <button class="btn btn-primary" id="cmPostGo" disabled>Post</button>`, 'cm-compose');
  const text = s.el.querySelector<HTMLTextAreaElement>('#cmPostText')!;
  const go = s.el.querySelector<HTMLButtonElement>('#cmPostGo')!;
  const sync = () => { s.el.querySelector('#cmPostLeft')!.textContent = String(280 - text.value.length); go.disabled = !text.value.trim(); };
  text.addEventListener('input', () => { kind = 'text'; s.el.querySelectorAll('[data-result]').forEach((x) => x.classList.remove('on')); sync(); });
  s.el.querySelectorAll<HTMLElement>('[data-result]').forEach((b) => b.addEventListener('click', () => {
    text.value = results.find((r) => r[0] === b.dataset.result)![1];
    kind = 'ride';
    s.el.querySelectorAll('[data-result]').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  }));
  s.el.querySelectorAll<HTMLElement>('#cmAud button').forEach((b) => b.addEventListener('click', () => {
    audience = b.dataset.v as Post['audience'];
    s.el.querySelectorAll('#cmAud button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  go.addEventListener('click', async () => {
    // numbers and links stay out of the feed, like in Date vibe chat
    const clean = text.value.trim().replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').replace(/\+?\d(?:[\s\-.()]*\d){6,}/g, '').slice(0, 280);
    if (!clean) return;
    const id = await act(go, () => api.post(kind, clean, { audience }));
    if (id === undefined) return;
    count(p, 'posts');
    s.close();
    toast(`${ci.check} Posted`);
    done();
  });
  text.focus();
}

// ---------- the feed screen ----------

type Scope = 'home' | 'friends' | 'hall' | 'crew';
export function feedScreen(scope: Scope = 'home', from: () => void = () => H().home('social')) {
  const p = H().profile();
  const crew = known().crew;
  const tabs: [Scope, string][] = [['home', 'For you'], ['friends', 'Friends'], ...(p.hall !== 'none' ? [['hall', 'Hall'] as [Scope, string]] : []), ...(crew ? [['crew', 'Crew'] as [Scope, string]] : [])];
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${icons.bolt}</span><div><h1 class="title">Community feed</h1><p class="muted">Wins, personal bests, events and rides from your people.</p></div>
      <button class="btn btn-primary btn-sm cm-head-btn" id="cmCompose">${ci.edit} Post</button></div>
    <div class="seg wide cm-tabs">${tabs.map(([id, l]) => `<button data-tab="${id}" class="${id === scope ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="cmFeed" class="cm-feed">${loading(3)}</div>`, from, 'cm-screen');
  const app = H().app;
  const again = () => feedScreen(scope, from);
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => feedScreen(b.dataset.tab as Scope, from)));
  app.querySelector('#cmCompose')!.addEventListener('click', () => (api.signedIn() ? composer(again, { audience: scope === 'hall' ? 'hall' : scope === 'crew' ? 'crew' : 'friends' }) : H().signIn()));
  void loadFeed(app.querySelector<HTMLElement>('#cmFeed')!, scope === 'hall' ? 'hall' : scope, scope === 'hall' ? p.hall : scope === 'crew' ? String(crew) : null, again);
}

/** fills box with a feed; used by the feed screen, hall/course pages and crews */
export async function loadFeed(box: HTMLElement, scope: api.FeedScope, ref: string | null, again: () => void, limit = 20) {
  box.innerHTML = loading(3);
  try {
    const posts = await api.feed(scope, ref, null, limit);
    box.innerHTML = posts.length ? posts.map((x) => postHtml(x)).join('') : empty(icons.bolt, 'Nothing here yet', 'Wins, personal bests and events show up here as riders share them. Post something to start it off!');
    bindPosts(box, posts, again);
  } catch (e) {
    box.innerHTML = problemBox(e, 'cmFeedRetry');
    bindSignIn(box);
    box.querySelector('#cmFeedRetry')?.addEventListener('click', again);
  }
}
