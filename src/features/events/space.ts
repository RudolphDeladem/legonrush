// The event space: after "Park bike and enter event". Who's here (real presence on a Realtime
// channel per event; ?fakelive in development), event chat with mute/block/report, emotes, opt-in
// interactions (request, then accept or decline), music, and the mini-games with a leaderboard.
import * as live from '../../live';
import * as cloud from '../../cloud';
import { H, esc, screen } from '../host';
import { icons } from '../../ui/icons';
import { music, sfx } from '../../audio';
import { buzz } from '../../ui/feedback';
import { REPORT_REASONS, block, isBlocked, maskText, saveReport, dateCheck } from '../vibe';
import type { CampusEvent } from './types';
import { complete, takePart, rewardText } from './store';
import { statusOf, isOn } from './schedule';
import { coverUrl, placeLabel } from './catalog';
import { GAMES, playGame, type GameId } from './games';
import * as srv from './cloud';
import { grant } from '../inventory';

const DEVICE_KEY = 'legonrush.device.v1';
function myKey() {
  if (cloud.account) return cloud.account.id;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = `d-${crypto.randomUUID()}`));
    return id;
  } catch {
    return `d-${Math.random().toString(36).slice(2)}`;
  }
}

type Emote = 'wave' | 'highfive' | 'dance' | 'heart' | 'laugh';
const EMOTES: { id: Emote; label: string; icon: string }[] = [
  { id: 'wave', label: 'Wave', icon: icons.hand },
  { id: 'highfive', label: 'High five', icon: icons.highfive },
  { id: 'dance', label: 'Dance', icon: icons.dance },
  { id: 'laugh', label: 'Laugh', icon: icons.smile },
  { id: 'heart', label: 'Heart', icon: icons.heart },
];
type Ask = 'hi' | 'highfive' | 'dance' | 'photo' | 'heart';
const ASKS: { id: Ask; label: string; icon: string; did: string; adult?: boolean }[] = [
  { id: 'hi', label: 'Say hi', icon: icons.hand, did: 'said hi' },
  { id: 'highfive', label: 'High five', icon: icons.highfive, did: 'high-fived' },
  { id: 'dance', label: 'Dance together', icon: icons.dance, did: 'danced together' },
  { id: 'photo', label: 'Take a photo together', icon: icons.camera, did: 'took a photo together' },
  { id: 'heart', label: 'Send a heart', icon: icons.heart, did: 'shared a heart', adult: true },
];

interface PeerState { name: string; adult: boolean; since: number }
interface Msg { k: string; name: string; text: string; at: number; sys?: boolean }

const MUTE_KEY = 'legonrush.events.muted.v1';
const muted = (): string[] => { try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '[]'); } catch { return []; } };
const setMuted = (ids: string[]) => { try { localStorage.setItem(MUTE_KEY, JSON.stringify(ids.slice(-200))); } catch { /* blocked */ } };

const colorOf = (k: string) => `hsl(${[...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)} 60% 58%)`;
const initial = (n: string) => esc((n.trim()[0] ?? '?').toUpperCase());

/** a space where people gather: only open while the event is on (doors open 15 minutes early) */
export const spaceOpen = (e: CampusEvent) => isOn(statusOf(e)) || (statusOf(e) === 'soon' && e.start - Date.now() < 15 * 60e3);

export function spaceScreen(e: CampusEvent, back: () => void) {
  const h = H();
  const p = h.profile();
  const me = myKey();
  const adult = dateCheck(p) === 'ok';
  let ch: live.Channel | null = null;
  let peers: live.Peer<PeerState>[] = [];
  const msgs: Msg[] = [{ k: '', name: '', text: `Welcome to ${e.name}. Be kind: block, mute and report are one tap away.`, at: Date.now(), sys: true }];
  const roomScores = new Map<string, { name: string; score: number; me?: boolean }>();
  let musicOn = false;
  let gone = false;
  let lastSend = 0;
  const pending = new Map<string, { to: string; kind: Ask; timer: number }>();
  const answered = new Set<string>();

  const first = takePart(p, e);
  const stayTimer = window.setTimeout(() => complete(p, e), 3 * 60e3);

  screen(`
    <div class="ev-space">
      <div class="ev-space-main stack">
        <div class="ev-stage" style="background-image:linear-gradient(180deg,rgba(11,21,48,.15),rgba(11,21,48,.75)),url('${coverUrl(e.cover)}')">
          <div class="row"><span class="ev-badge live"><i></i>Live now</span><span class="grow"></span><button class="ev-round" id="evMusic" aria-label="Music">${icons.music}</button></div>
          <div class="grow"></div>
          <p class="ev-stage-place">${icons.pin} ${esc(placeLabel(e.place))}</p>
          <h1 class="ev-stage-title">${esc(e.name)}</h1>
          <div class="ev-eq" id="evEq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="ev-floats" id="evFloats"></div>
        </div>
        ${first ? `<p class="ev-note good">${icons.stamp} Passport stamped${rewardText(first) ? ` · ${esc(rewardText(first))}` : ''}</p>` : ''}
        <div class="ev-emotes">${EMOTES.map((x) => `<button class="ev-emote" data-emote="${x.id}">${x.icon}<span>${x.label}</span></button>`).join('')}</div>
        <div class="card stack" style="gap:10px">
          <div class="row"><b>${icons.users} Who's here</b><span class="grow"></span><span class="muted small" id="evHereN"></span></div>
          <div class="ev-people" id="evPeople"></div>
          <p class="muted small">Tap someone to say hi, high-five or dance. They choose whether to accept.</p>
        </div>
        <div class="card stack" style="gap:10px">
          <b>${icons.target} Play</b>
          <div class="ev-games">${GAMES.map((g) => `<div class="ev-game-card"><span class="ev-gico">${g.icon}</span><div class="grow"><b>${g.name}</b><p class="muted small">${g.blurb}</p></div><button class="btn btn-primary btn-sm" data-play="${g.id}">Play</button></div>`).join('')}</div>
          <div class="seg wide" id="evBoardTabs">${GAMES.map((g, i) => `<button data-board="${g.id}" class="${i ? '' : 'on'}">${g.name}</button>`).join('')}</div>
          <ol class="ev-board" id="evBoard"></ol>
        </div>
      </div>
      <div class="card ev-chat">
        <div class="row"><b>${icons.chat} Event chat</b><span class="grow"></span><span class="muted small" id="evConn">Connecting…</span></div>
        <div class="ev-log" id="evLog"></div>
        <form class="chat-form" id="evForm"><input id="evSay" maxlength="160" autocomplete="off" placeholder="Say something…" aria-label="Message"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form>
      </div>
      <button class="btn btn-ghost" id="evLeave">${icons.arrow} Leave event</button>
    </div>`, () => leave(), 'ev-space-screen');

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => h.app.querySelector<T>(s);
  const log = $('#evLog')!;
  const floats = $('#evFloats')!;

  const nameOf = (k: string) => (k === me ? 'You' : peers.find((x) => x.key === k)?.state.name ?? 'Someone');
  const hidden = (k: string) => isBlocked(k) || muted().includes(k);

  function drawLog() {
    log.innerHTML = msgs.filter((m) => m.sys || !hidden(m.k)).slice(-60).map((m) => m.sys
      ? `<p class="ev-sys">${esc(m.text)}</p>`
      : `<p class="ev-msg${m.k === me ? ' me' : ''}"><button class="ev-who" data-person="${esc(m.k)}" style="--c:${colorOf(m.k)}">${esc(m.k === me ? 'You' : m.name)}</button> ${esc(m.text)}</p>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  function drawPeople() {
    const list = peers.filter((x) => !isBlocked(x.key));
    $('#evHereN')!.textContent = ch ? `${list.length + 1} here` : '';
    const people = $('#evPeople')!;
    if (!ch) { people.innerHTML = `<p class="muted small">${icons.wifiOff} Can't connect to the live event right now. You can still play; your scores post when you're back online.</p>`; return; }
    people.innerHTML = `<span class="ev-person me" style="--c:${colorOf(me)}"><i>${initial(p.name)}</i><span>You</span></span>`
      + (list.length ? list.map((x) => `<button class="ev-person" data-person="${esc(x.key)}" style="--c:${colorOf(x.key)}"><i>${initial(x.state.name)}</i><span>${esc(x.state.name)}</span></button>`).join('')
        : `<span class="muted small ev-alone">You're the first one here. Riders appear as they arrive.</span>`);
  }
  async function drawBoard(game: GameId) {
    const el = $('#evBoard');
    if (!el) return;
    const server = await srv.leaderboard(e.key, game);
    if (gone) return;
    const rows = new Map<string, { name: string; score: number; me?: boolean }>();
    for (const r of server ?? []) rows.set(r.me ? me : r.name, r);
    for (const [k, r] of roomScores) if (k.endsWith(':' + game)) { const id = k.slice(0, -game.length - 1); const prev = rows.get(id); if (!prev || prev.score < r.score) rows.set(id, r); }
    const list = [...rows.values()].sort((a, b) => b.score - a.score).slice(0, 10);
    el.innerHTML = list.length
      ? list.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="ev-rank">${i + 1}</span><span class="grow">${esc(r.me ? 'You' : r.name)}</span><b>${r.score}</b></li>`).join('')
      : `<li class="muted small ev-empty">No scores yet. Play to set the first one.</li>`;
  }
  let boardGame: GameId = 'quiz';

  // ---------- emotes ----------
  function floatEmote(id: Emote | Ask, who: string) {
    const icon = EMOTES.find((x) => x.id === id)?.icon ?? ASKS.find((x) => x.id === id)?.icon ?? icons.sparkle;
    const el = document.createElement('div');
    el.className = `ev-float e-${id}`;
    el.style.left = `${12 + Math.random() * 70}%`;
    el.innerHTML = `${icon}<small>${esc(who)}</small>`;
    floats.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
  const emote = (id: Emote) => {
    if (Date.now() - lastSend < 700) return;
    lastSend = Date.now();
    floatEmote(id, 'You');
    buzz(8);
    ch?.send('emote', { k: me, name: p.name, e: id });
  };

  // ---------- interactions (always asked first) ----------
  function ask(to: string, kind: Ask) {
    const them = peers.find((x) => x.key === to);
    if (!ch || !them) return;
    if ([...pending.values()].some((x) => x.to === to)) return note(`Waiting for ${them.state.name} to answer…`);
    const id = `${me}:${Date.now()}`;
    ch.send('ask', { id, from: me, name: p.name, to, kind });
    pending.set(id, { to, kind, timer: window.setTimeout(() => { pending.delete(id); note(`${them.state.name} didn't answer.`); }, 20000) });
    note(`Asked ${them.state.name}. Waiting for them to accept…`);
  }
  function incoming(m: { id: string; from: string; name: string; to: string; kind: Ask }) {
    if (m.to !== me || answered.has(m.id) || hidden(m.from)) return;
    const kind = ASKS.find((x) => x.id === m.kind);
    if (!kind) return;
    // hearts only between adults who both opted in
    if (kind.adult && !adult) return ch?.send('answer', { id: m.id, from: me, to: m.from, ok: false });
    answered.add(m.id);
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    ov.innerHTML = `<div class="sheet light-ui ev-ask"><span class="ev-ask-ico" style="--c:${colorOf(m.from)}">${kind.icon}</span>
      <h2 class="title" style="font-size:24px">${esc(String(m.name).slice(0, 24))} wants to ${kind.label.toLowerCase()}</h2>
      <p class="muted small">Nothing happens unless you accept.</p>
      <div class="two"><button class="btn btn-ghost" data-a="no">Decline</button><button class="btn btn-primary" data-a="yes">Accept</button></div>
      <button class="btn btn-link" data-a="block">Block ${esc(String(m.name).slice(0, 24))}</button></div>`;
    document.body.appendChild(ov);
    const close = (ok: boolean) => { clearTimeout(t); ov.remove(); ch?.send('answer', { id: m.id, from: me, to: m.from, ok }); if (ok) did(m.from, m.kind); };
    const t = window.setTimeout(() => close(false), 20000);
    ov.querySelector('[data-a="yes"]')!.addEventListener('click', () => close(true));
    ov.querySelector('[data-a="no"]')!.addEventListener('click', () => close(false));
    ov.querySelector('[data-a="block"]')!.addEventListener('click', () => { close(false); block(m.from, m.name); drawPeople(); drawLog(); });
    sfx.lane();
    buzz([20, 40, 20]);
  }
  function did(other: string, kind: Ask) {
    const k = ASKS.find((x) => x.id === kind)!;
    floatEmote(kind, `You & ${nameOf(other)}`);
    msgs.push({ k: '', name: '', text: `You and ${nameOf(other)} ${k.did}.`, at: Date.now(), sys: true });
    drawLog();
    sfx.coin();
  }
  const note = (text: string) => { msgs.push({ k: '', name: '', text, at: Date.now(), sys: true }); drawLog(); };

  // ---------- a person ----------
  function personSheet(k: string) {
    if (k === me) return;
    const them = peers.find((x) => x.key === k);
    const name = them?.state.name ?? msgs.find((m) => m.k === k)?.name ?? 'Rider';
    const isMuted = muted().includes(k);
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    const canHeart = adult && !!them?.state.adult;
    ov.innerHTML = `<div class="sheet light-ui ev-person-sheet">
      <div class="row"><span class="ev-person big" style="--c:${colorOf(k)}"><i>${initial(name)}</i></span><h2 class="title" style="font-size:24px">${esc(name)}</h2><span class="grow"></span><button class="btn btn-link" data-close>${icons.close}</button></div>
      ${them ? `<div class="ev-asks">${ASKS.filter((a) => !a.adult || canHeart).map((a) => `<button class="ev-emote" data-ask="${a.id}">${a.icon}<span>${a.label}</span></button>`).join('')}</div>
      <p class="muted small">${esc(name)} gets a request and chooses to accept or decline.${adult ? '' : ' Hearts are for riders 18 and over.'}</p>` : `<p class="muted small">${esc(name)} has left the event.</p>`}
      <div class="two"><button class="btn btn-ghost" data-act="mute">${isMuted ? 'Unmute' : 'Mute'}</button><button class="btn btn-ghost vx-danger" data-act="block">${icons.lock} Block</button></div>
      <b class="small">Report ${esc(name)}</b>
      <div class="ev-reasons">${REPORT_REASONS.map((r) => `<button class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t === ov || t.closest('[data-close]')) return close();
      const a = t.closest<HTMLElement>('[data-ask]');
      if (a) { close(); ask(k, a.dataset.ask as Ask); return; }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'mute') { setMuted(isMuted ? muted().filter((x) => x !== k) : [...muted(), k]); close(); drawLog(); return; }
      if (act === 'block') { block(k, name); close(); drawPeople(); drawLog(); note(`You blocked ${name}. You won't see them again.`); return; }
      const r = t.closest<HTMLElement>('[data-reason]')?.dataset.reason;
      if (r) {
        const lines = msgs.filter((m) => m.k === k).slice(-20).map((m) => m.text);
        saveReport({ id: k, name, reason: r, code: e.key, lines, at: Date.now() });
        void srv.reportRider({ eventKey: e.key, who: k, name, reason: r, lines });
        ov.querySelector('.ev-reasons')!.innerHTML = `<p class="ev-note good">${icons.check} Thanks. Your report was sent for review. You can block ${esc(name)} too.</p>`;
      }
    });
  }

  // ---------- connect ----------
  const connEl = $('#evConn')!;
  void live.join(`ev:${e.key}`, me, { name: p.name.slice(0, 24), adult, since: Date.now() }).then((c) => {
    if (gone) { c?.leave(); return; }
    ch = c;
    connEl.textContent = c ? 'Live' : 'Offline';
    connEl.classList.toggle('on', !!c);
    if (!c) return drawPeople();
    c.onPeers((list) => {
      const before = new Set(peers.map((x) => x.key));
      peers = list.filter((x) => x.state && typeof x.state.name === 'string');
      for (const x of peers) if (!before.has(x.key) && !hidden(x.key) && before.size) note(`${x.state.name} arrived.`);
      drawPeople();
    });
    c.on('chat', (m: Msg) => {
      if (typeof m?.text !== 'string' || typeof m.k !== 'string') return;
      msgs.push({ k: m.k, name: String(m.name).slice(0, 24), text: maskText(m.text.slice(0, 160)), at: Date.now() });
      drawLog();
    });
    c.on('emote', (m: { k: string; name: string; e: Emote }) => { if (!hidden(m.k) && EMOTES.some((x) => x.id === m.e)) floatEmote(m.e, String(m.name).slice(0, 18)); });
    c.on('ask', incoming);
    c.on('answer', (m: { id: string; from: string; to: string; ok: boolean }) => {
      const pend = pending.get(m.id);
      if (m.to !== me || !pend) return;
      clearTimeout(pend.timer);
      pending.delete(m.id);
      if (m.ok) did(m.from, pend.kind);
      else note(`${nameOf(m.from)} said no thanks.`);
    });
    c.on('score', (m: { k: string; name: string; game: GameId; score: number }) => {
      const g = GAMES.find((x) => x.id === m.game);
      if (!g || !(m.score >= 0 && m.score <= g.max) || hidden(m.k)) return;
      const key = `${m.k}:${m.game}`;
      if ((roomScores.get(key)?.score ?? -1) < m.score) roomScores.set(key, { name: String(m.name).slice(0, 24), score: Math.round(m.score) });
      note(`${String(m.name).slice(0, 24)} scored ${Math.round(m.score)} in ${g.name}.`);
      if (boardGame === m.game) void drawBoard(boardGame);
    });
  });

  drawLog();
  drawPeople();
  void drawBoard(boardGame);

  // ---------- buttons ----------
  h.app.querySelectorAll<HTMLElement>('[data-emote]').forEach((b) => b.addEventListener('click', () => emote(b.dataset.emote as Emote)));
  h.app.addEventListener('click', onPerson);
  function onPerson(ev: Event) {
    const k = (ev.target as HTMLElement).closest<HTMLElement>('[data-person]')?.dataset.person;
    if (k) personSheet(k);
  }
  const form = $<HTMLFormElement>('#evForm')!;
  const input = $<HTMLInputElement>('#evSay')!;
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = maskText(input.value.trim().slice(0, 160));
    if (!text) return;
    if (Date.now() - lastSend < 1000) return;
    lastSend = Date.now();
    input.value = '';
    msgs.push({ k: me, name: p.name, text, at: Date.now() });
    drawLog();
    ch?.send('chat', { k: me, name: p.name.slice(0, 24), text });
  });
  $('#evMusic')!.addEventListener('click', () => {
    musicOn = !musicOn;
    music(musicOn);
    $('#evMusic')!.classList.toggle('on', musicOn);
    $('#evEq')!.classList.toggle('on', musicOn);
  });
  h.app.querySelectorAll<HTMLElement>('[data-board]').forEach((b) => b.addEventListener('click', () => {
    boardGame = b.dataset.board as GameId;
    h.app.querySelectorAll('[data-board]').forEach((x) => x.classList.toggle('on', x === b));
    void drawBoard(boardGame);
  }));
  h.app.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const game = b.dataset.play as GameId;
    playGame(game, (score, detail) => {
      if (score === null || gone) return;
      roomScores.set(`${me}:${game}`, { name: p.name, score, me: true });
      ch?.send('score', { k: me, name: p.name.slice(0, 24), game, score });
      void srv.submitScore(e.key, game, score);
      const got = complete(p, e);
      if (game === 'quiz' && detail.startsWith('6 of 6') && !p.items['badge-games-night']) grant(p, { items: ['badge-games-night'] });
      note(`You scored ${score} in ${GAMES.find((g) => g.id === game)!.name} (${detail}).${got ? ` Event complete: ${rewardText(got)}.` : ''}`);
      boardGame = game;
      h.app.querySelectorAll('[data-board]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.board === game));
      void drawBoard(game);
    });
  }));
  $('#evLeave')!.addEventListener('click', () => leave());

  function leave() {
    if (gone) return;
    gone = true;
    clearTimeout(stayTimer);
    for (const x of pending.values()) clearTimeout(x.timer);
    h.app.removeEventListener('click', onPerson);
    ch?.leave();
    if (musicOn) music(false);
    back();
  }
}
