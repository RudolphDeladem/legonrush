// Messages: private chats and crew group chats. Text, emoji and quick reactions, live through
// Supabase Realtime (with a gentle poll as a fallback). The server checks "who can message me",
// blocks and mutes on every send and read.
import { fx } from '../icons';
import { H, esc, screen } from '../host';
import * as vb from '../vibe';
import * as api from './api';
import { count, met } from './local';
import type { Card, Chat, Msg } from './model';
import { openPerson, reportSheet } from './people';
import { CREW_LOGOS, act, avatar, bindSignIn, ci, empty, handle, loading, problemBox, sheet, sheetHead, timeAgo, toast } from './ui';

const QUICK = ['❤️', '😂', '🔥', '👏', '👍', '🚲'];
const EMOJI = ['😀', '😂', '😍', '😎', '🙏', '👍', '👏', '🔥', '💯', '🚲', '🏆', '🎉', '❤️', '😅', '🤝', '👀'];
const back = () => H().home('social');

export function chatsScreen(from: () => void = back) {
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.chat}</span><div><h1 class="title">Messages</h1><p class="muted">Private chats and your crew's group chat.</p></div></div>
    <div id="cmChats" class="cm-list">${loading(4)}</div>`, from, 'cm-screen');
  const box = H().app.querySelector<HTMLElement>('#cmChats')!;
  const again = () => chatsScreen(from);
  const load = async () => {
    try {
      const list = await api.chats();
      box.innerHTML = list.length ? list.map(chatRow).join('') : empty(ci.chat, 'No messages yet', "Open a rider's profile and tap Message. Who can message whom follows everyone's privacy settings.", '<button class="btn btn-primary btn-sm" id="cmFindFriends">Find people</button>');
      box.querySelector('#cmFindFriends')?.addEventListener('click', async () => (await import('./people')).friendsScreen('friends', again));
      box.querySelectorAll<HTMLElement>('[data-chat]').forEach((el) => el.addEventListener('click', () => {
        const c = list.find((x) => x.id === Number(el.dataset.chat))!;
        openChat(c, again);
      }));
    } catch (e) {
      box.innerHTML = problemBox(e, 'cmRetry');
      bindSignIn(box);
      box.querySelector('#cmRetry')?.addEventListener('click', again);
    }
  };
  void load();
  const stop = api.onLive((e) => {
    if (!H().app.contains(box)) return stop();
    if (e.type === 'message') void load();
  });
}

export function chatRow(c: Chat) {
  const title = c.kind === 'crew' ? c.crew?.name ?? 'Crew' : handle(c.other ?? { name: 'Rider' });
  const pic = c.kind === 'crew' ? `<span class="cm-logo sm" style="--c:${esc(c.crew?.color ?? '#ffd21f')}">${CREW_LOGOS[c.crew?.logo ?? 'bike'] ?? ''}</span>` : avatar(c.other ?? { name: '?' }, 'sm');
  const last = c.last ? `${c.last.mine ? 'You: ' : c.kind === 'crew' ? `${esc(c.last.name)}: ` : ''}${esc(c.last.text)}` : c.kind === 'crew' ? 'Say hi to your crew' : 'No messages yet';
  return `<button class="cm-chat-row${c.unread ? ' unread' : ''}" data-chat="${c.id}">
    ${pic}
    <span class="cm-p-main"><b>${esc(title)}${c.muted ? ` ${ci.mute}` : ''}</b><small>${last}</small></span>
    <span class="cm-chat-side"><small>${c.last ? timeAgo(c.last.at) : ''}</small>${c.unread ? `<em class="cm-count">${c.unread > 99 ? '99+' : c.unread}</em>` : ''}</span>
  </button>`;
}

/** a private chat with someone (opened from their profile) */
export async function chatWith(c: Card, from?: () => void) {
  const id = await act(null, () => api.openChat(c.id));
  if (id === undefined) return;
  met(H().profile(), c.id);
  openChat({ id, kind: 'dm', other: c, unread: 0, last_at: new Date().toISOString() }, from);
}

/** the chat itself */
export function openChat(c: Chat, from: () => void = () => chatsScreen()) {
  const title = c.kind === 'crew' ? c.crew?.name ?? 'Crew' : c.other?.name ?? 'Rider';
  screen(`
    <div class="cm-chat-head">
      ${c.kind === 'crew' ? `<span class="cm-logo sm" style="--c:${esc(c.crew?.color ?? '#ffd21f')}">${CREW_LOGOS[c.crew?.logo ?? 'bike'] ?? ''}</span>` : avatar(c.other ?? { name: '?' }, 'sm')}
      <button class="cm-p-main" id="cmChatWho"><b>${esc(title)}</b><small>${c.kind === 'crew' ? `Crew chat · ${c.crew?.members ?? ''} members` : c.other?.username ? `@${esc(c.other.username)}` : 'Private chat'}</small></button>
      <button class="icon-btn cm-mini" id="cmChatMenu" aria-label="Chat options">${ci.more}</button>
    </div>
    <div class="cm-thread" id="cmThread">${loading(3)}</div>
    <div class="cm-emoji" id="cmEmoji" hidden>${EMOJI.map((e) => `<button data-emoji="${e}">${e}</button>`).join('')}</div>
    <form class="cm-say" id="cmSay">
      <button type="button" class="icon-btn cm-mini" id="cmEmojiBtn" aria-label="Emoji">${ci.smile}</button>
      <input id="cmSayIn" maxlength="500" autocomplete="off" placeholder="Message ${esc(title)}…">
      <button class="btn btn-primary btn-sm" aria-label="Send">${ci.send}</button>
    </form>`, () => { stop(); clearInterval(poll); from(); }, 'cm-screen cm-chat-screen');
  const app = H().app;
  const thread = app.querySelector<HTMLElement>('#cmThread')!;
  const input = app.querySelector<HTMLInputElement>('#cmSayIn')!;
  let msgs: Msg[] = [];
  let tempId = -1;
  const p = H().profile();

  const draw = (scroll = true) => {
    if (!msgs.length) {
      thread.innerHTML = `<p class="cm-safety-tip">${fx.shield} Be kind. Never share money, PINs or passwords. Report anything that feels wrong.</p>${empty(ci.chat, 'Say hi', c.kind === 'crew' ? 'Plan your next crew ride here.' : 'Start with a ride idea: "Balme Library at sunset?"')}`;
      return;
    }
    let lastDay = '';
    thread.innerHTML = `<p class="cm-safety-tip">${fx.shield} Be kind. Never share money, PINs or passwords.</p>` + msgs.map((m) => {
      const day = new Date(m.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const sep = day !== lastDay ? `<p class="cm-day">${day}</p>` : '';
      lastDay = day;
      const reacts = Object.entries(m.reactions ?? {}).filter(([, n]) => n > 0);
      return `${sep}<div class="cm-msg${m.mine ? ' me' : ''}${m.pending ? ' pending' : ''}" data-msg="${m.id}">
        ${!m.mine && c.kind === 'crew' ? `<b>${esc(m.name)}</b>` : ''}
        <span class="cm-msg-text">${esc(m.text)}</span>
        <small>${new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${m.pending ? ' · sending' : ''}</small>
        ${reacts.length ? `<span class="cm-msg-reacts">${reacts.map(([e, n]) => `<i class="${m.my_reaction === e ? 'on' : ''}">${e}${n > 1 ? n : ''}</i>`).join('')}</span>` : ''}
      </div>`;
    }).join('');
    if (scroll) thread.scrollTop = thread.scrollHeight;
    thread.querySelectorAll<HTMLElement>('[data-msg]').forEach((el) => el.addEventListener('click', () => {
      const m = msgs.find((x) => x.id === Number(el.dataset.msg));
      if (m && m.id > 0) reactBar(el, m);
    }));
  };

  const reactBar = (el: HTMLElement, m: Msg) => {
    thread.querySelector('.cm-react-bar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'cm-react-bar';
    bar.innerHTML = QUICK.map((e) => `<button data-q="${e}" class="${m.my_reaction === e ? 'on' : ''}">${e}</button>`).join('') + (m.mine ? '' : `<button data-q="report" aria-label="Report">${ci.flag}</button>`);
    el.after(bar);
    bar.querySelectorAll<HTMLElement>('[data-q]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const q = b.dataset.q!;
      bar.remove();
      if (q === 'report') return reportSheet({ id: m.from, name: m.name }, 'message', String(m.id), { text: m.text, conversation: c.id });
      const next = m.my_reaction === q ? null : q;
      if (m.my_reaction) m.reactions[m.my_reaction] = Math.max(0, (m.reactions[m.my_reaction] ?? 1) - 1);
      if (next) m.reactions[next] = (m.reactions[next] ?? 0) + 1;
      m.my_reaction = next;
      draw(false);
      try { await api.reactMsg(m.id, next); } catch (e) { toast(`${fx.info} ${esc(api.problemText(e))}`); }
    }));
  };

  const load = async (first = false) => {
    try {
      const fresh = await api.messages(c.id);
      const pending = msgs.filter((m) => m.pending);
      const changed = JSON.stringify(fresh.map((m) => [m.id, m.reactions])) !== JSON.stringify(msgs.filter((m) => !m.pending).map((m) => [m.id, m.reactions]));
      msgs = [...fresh, ...pending];
      if (first || changed) draw();
      void api.markChat(c.id, 'read').catch(() => undefined);
    } catch (e) {
      if (first) { thread.innerHTML = problemBox(e, 'cmRetry'); bindSignIn(thread); thread.querySelector('#cmRetry')?.addEventListener('click', () => void load(true)); }
    }
  };
  void load(true);
  const stop = api.onLive((e) => {
    if (!H().app.contains(thread)) { stop(); clearInterval(poll); return; }
    if ((e.type === 'message' || e.type === 'reaction') && e.conv === c.id) void load();
  });
  // a gentle poll in case live updates can't connect on this network
  const poll = window.setInterval(() => { if (!H().app.contains(thread)) { clearInterval(poll); stop(); return; } if (!document.hidden) void load(); }, 15000);

  app.querySelector('#cmSay')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, 500);
    if (!text) return;
    input.value = '';
    const temp: Msg = { id: tempId--, from: api.myId(), name: p.name, text, at: new Date().toISOString(), mine: true, reactions: {}, pending: true };
    msgs.push(temp);
    draw();
    try {
      const id = await api.send(c.id, text);
      temp.id = id;
      temp.pending = false;
      count(p, 'messages');
      draw();
    } catch (err) {
      msgs = msgs.filter((m) => m !== temp);
      draw();
      input.value = text;
      toast(`${fx.info} ${esc(api.problemText(err))}`);
    }
  });
  app.querySelector('#cmEmojiBtn')!.addEventListener('click', () => { const box = app.querySelector<HTMLElement>('#cmEmoji')!; box.hidden = !box.hidden; });
  app.querySelectorAll<HTMLElement>('[data-emoji]').forEach((b) => b.addEventListener('click', () => { input.value += b.dataset.emoji; input.focus(); }));
  app.querySelector('#cmChatWho')!.addEventListener('click', async () => {
    if (c.kind === 'dm' && c.other) void openPerson(c.other.id, c.other);
    if (c.kind === 'crew' && c.crew) (await import('./crews')).openCrew(c.crew.id);
  });
  app.querySelector('#cmChatMenu')!.addEventListener('click', () => chatMenu(c, () => { stop(); clearInterval(poll); from(); }));
}

function chatMenu(c: Chat, leave: () => void) {
  const name = c.kind === 'crew' ? c.crew?.name ?? 'crew' : c.other?.name ?? 'rider';
  const s = sheet(`${sheetHead(esc(name))}
    <button class="btn btn-ghost" data-a="mute">${ci.mute} ${c.muted ? 'Unmute' : 'Mute'} this chat</button>
    ${c.kind === 'dm' && c.other ? `<button class="btn btn-ghost" data-a="report">${ci.flag} Report ${esc(name)}</button><button class="btn btn-ghost cm-danger" data-a="block">${ci.block} Block ${esc(name)}</button>` : ''}
    <button class="btn btn-ghost cm-danger" data-a="leave">${ci.leave} ${c.kind === 'crew' ? 'Leave the crew' : 'Leave this chat'}</button>`);
  s.el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    if (a === 'mute' && (await act(b, () => api.markChat(c.id, c.muted ? 'unmute' : 'mute'))) !== undefined) { c.muted = !c.muted; s.close(); toast(c.muted ? `${ci.mute} Chat muted` : 'Chat unmuted'); }
    if (a === 'report' && c.other) { s.close(); reportSheet(c.other, 'user', String(c.id)); }
    if (a === 'block' && c.other) {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = `${ci.block} Tap again to block`; return; }
      vb.block(c.other.id, c.other.name);
      if ((await act(b, () => api.toggle(c.other!.id, 'block', true))) !== undefined) { s.close(); leave(); }
    }
    if (a === 'leave') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.innerHTML = `${ci.leave} Tap again to leave`; return; }
      if ((await act(b, () => api.markChat(c.id, 'leave'))) !== undefined) { s.close(); leave(); }
    }
  }));
}
