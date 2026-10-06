// The event space: after "Park bike and enter event", or walking into a Campus Life hangout.
// The place itself, in 3D on the real campus: a crowd of people (real riders who are here right
// now, plus students who keep it lively), a sound system, and things to do: dance, sit, eat,
// wave, take photos, chat. Real presence runs on a Realtime channel per event (?fakelive in
// development). Interactions with real riders are always asked first (accept or decline), with
// mute, block and report one tap away. Mini-games with a leaderboard sit in the panel.
import * as live from '../../live';
import * as cloud from '../../cloud';
import { H, esc } from '../host';
import { icons } from '../../ui/icons';
import { sfx, startParty, stopParty, unlockAudio } from '../../audio';
import { buzz } from '../../ui/feedback';
import { REPORT_REASONS, block, isBlocked, maskText, saveReport, dateCheck } from '../vibe';
import type { CampusEvent } from './types';
import { complete, takePart, rewardText } from './store';
import { statusOf, isOn } from './schedule';
import { placeLabel } from './catalog';
import { GAMES, playGame, type GameId } from './games';
import * as srv from './cloud';
import { grant } from '../inventory';
import { HALL_PLACE, hallById } from '../../data/campus';
import { placeByName } from '../../game/campusmap';
import { buildHangout, type Act, type Person } from '../life/world';
import { crowdNow, skyNow, venueById, type Theme, type Venue } from '../life/venues';
import { replyTo } from '../life/bots';

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
export const spaceOpen = (e: CampusEvent) => e.key.startsWith('life:') || isOn(statusOf(e)) || (statusOf(e) === 'soon' && e.start - Date.now() < 15 * 60e3);

/** what a scheduled event looks and sounds like when you walk in */
function venueOf(e: CampusEvent): Venue {
  const hallId = H().profile().hall;
  if (e.key.startsWith('life:')) { const v = venueById(e.key.slice(5), hallId); if (v) return v; }
  const theme: Theme = e.type === 'hall' ? 'hall' : ['party', 'festival', 'seasonal', 'special'].includes(e.type) ? 'jam' : e.place === 'Night Market' ? 'market' : 'square';
  const hall = Object.entries(HALL_PLACE).find(([, pl]) => pl === e.place)?.[0];
  const n = Math.max(10, Math.min(30, (e.joinedCount ?? 0) + 12));
  return {
    id: e.key, name: e.name, place: placeByName(e.place) ? e.place : 'Athletic Oval', theme,
    style: theme === 'jam' ? 'amapiano' : theme === 'square' ? 'highlife' : 'afrobeats',
    blurb: e.blurb, things: [], peak: [0, 24], crowd: [n, n], cover: e.cover, horn: theme === 'jam',
    color: theme === 'hall' ? hallById(hall ?? H().profile().hall).color : undefined,
  };
}

const ACT_LABEL: Partial<Record<Act, string>> = { dance: 'Dancing', sit: 'Sitting', eat: 'Eating', chat: 'Chatting', photo: 'Taking photos', pose: 'Posing', dj: 'On the decks', vendor: 'Selling food' };

export function spaceScreen(e: CampusEvent, back: () => void) {
  const h = H();
  const p = h.profile();
  const me = myKey();
  const adult = dateCheck(p) === 'ok';
  const venue = venueOf(e);
  let ch: live.Channel | null = null;
  let peers: live.Peer<PeerState>[] = [];
  const msgs: Msg[] = [{ k: '', name: '', text: `Welcome to ${e.name}. Tap someone to say hi. Be kind: block, mute and report are one tap away.`, at: Date.now(), sys: true }];
  const roomScores = new Map<string, { name: string; score: number; me?: boolean }>();
  let musicOn = true;
  let gone = false;
  let lastSend = 0;
  const pending = new Map<string, { to: string; kind: Ask; timer: number }>();
  const answered = new Set<string>();

  const first = takePart(p, e);
  const stayTimer = window.setTimeout(() => complete(p, e), 3 * 60e3);

  // ---------- the place ----------
  const sky = skyNow();
  const world = buildHangout(venue, { name: p.name, hall: hallById(p.hall).short, skin: p.look.skin, shirt: p.look.jersey || hallById(p.hall).color, female: p.gender === 'female' }, crowdNow(venue), sky === 'night');
  h.showcase();
  h.world.enter(world);
  h.world.time(sky);
  unlockAudio();
  startParty(venue.style, { people: world.count(), horn: venue.horn });
  const hasFood = venue.theme === 'market' || venue.theme === 'hall' || venue.theme === 'jam';

  h.app.innerHTML = `
    <div class="life fade-in">
      <div class="life-touch" id="lifeTouch"></div>
      <div class="life-top">
        <button class="life-round" id="evLeave" aria-label="Leave">${icons.arrow}</button>
        <div class="life-title"><small>${icons.pin} ${esc(placeLabel(venue.place))}</small><b>${esc(e.name)}</b></div>
        <span class="life-here"><i class="ev-dot"></i><span id="lifeHere"></span></span>
        <button class="life-round on" id="evMusic" aria-label="Music">${icons.music}<span class="ev-eq on" id="evEq" aria-hidden="true"><i></i><i></i><i></i></span></button>
      </div>
      <div class="ev-floats life-floats" id="evFloats"></div>
      <p class="life-toast" id="lifeToast"${first ? '' : ' hidden'}>${first ? `${icons.stamp} Passport stamped${rewardText(first) ? ` · ${esc(rewardText(first))}` : ''}` : ''}</p>
      <p class="life-hint" id="lifeHint">Tap the ground to walk. Tap a person to meet them. Drag to look around.</p>
      <div class="life-acts">
        <button data-act="dance">${icons.dance}<span>Dance</span></button>
        <button data-act="wave">${icons.hand}<span>Wave</span></button>
        <button data-act="sit">${icons.seat}<span>Sit</span></button>
        ${hasFood ? `<button data-act="eat">${icons.food}<span>Eat</span></button>` : ''}
        <button data-act="photo">${icons.camera}<span>Photo</span></button>
        <button data-panel="chat">${icons.chat}<span>Chat</span><i class="life-badge" id="lifeUnread" hidden></i></button>
        <button data-panel="people">${icons.users}<span>People</span></button>
        <button data-panel="games">${icons.target}<span>Games</span></button>
      </div>
      <div class="life-panel light-ui" id="lifePanel" hidden>
        <div class="row life-panel-h"><div class="seg" id="lifeTabs"><button data-tab="chat" class="on">Chat</button><button data-tab="people">People</button><button data-tab="games">Games</button></div><span class="grow"></span><button class="btn btn-link" id="lifeClose" aria-label="Close">${icons.close}</button></div>
        <div data-pane="chat" class="ev-chat">
          <div class="row"><span class="muted small">Event chat</span><span class="grow"></span><span class="muted small" id="evConn">Connecting…</span></div>
          <div class="ev-log" id="evLog"></div>
          <form class="chat-form" id="evForm"><input id="evSay" maxlength="160" autocomplete="off" placeholder="Say something…" aria-label="Message"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form>
        </div>
        <div data-pane="people" class="stack" style="gap:10px" hidden>
          <div class="ev-emotes">${EMOTES.map((x) => `<button class="ev-emote" data-emote="${x.id}">${x.icon}<span>${x.label}</span></button>`).join('')}</div>
          <div class="row"><b>${icons.users} Who's here</b><span class="grow"></span><span class="muted small" id="evHereN"></span></div>
          <div class="life-list" id="evPeople"></div>
        </div>
        <div data-pane="games" class="stack" style="gap:10px" hidden>
          <div class="ev-games">${GAMES.map((g) => `<div class="ev-game-card"><span class="ev-gico">${g.icon}</span><div class="grow"><b>${g.name}</b><p class="muted small">${g.blurb}</p></div><button class="btn btn-primary btn-sm" data-play="${g.id}">Play</button></div>`).join('')}</div>
          <div class="seg wide" id="evBoardTabs">${GAMES.map((g, i) => `<button data-board="${g.id}" class="${i ? '' : 'on'}">${g.name}</button>`).join('')}</div>
          <ol class="ev-board" id="evBoard"></ol>
        </div>
      </div>
    </div>`;
  h.onBack(() => leave());
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => h.app.querySelector<T>(s);
  const lifeEl = $('.life')!;
  lifeEl.insertBefore(world.labels, lifeEl.children[1]);
  const log = $('#evLog')!;
  const floats = $('#evFloats')!;
  const panel = $('#lifePanel')!;
  let unread = 0;
  setTimeout(() => { const t = $('#lifeToast'); if (t) t.hidden = true; }, 5000);
  setTimeout(() => { const t = $('#lifeHint'); if (t) t.classList.add('gone'); }, 7000);

  const nameOf = (k: string) => (k === me ? 'You' : peers.find((x) => x.key === k)?.state.name ?? world.people().find((x) => x.key === k)?.name ?? 'Someone');
  const hidden = (k: string) => isBlocked(k) || muted().includes(k);

  function drawLog() {
    log.innerHTML = msgs.filter((m) => m.sys || !hidden(m.k)).slice(-60).map((m) => m.sys
      ? `<p class="ev-sys">${esc(m.text)}</p>`
      : `<p class="ev-msg${m.k === me ? ' me' : ''}"><button class="ev-who" data-person="${esc(m.k)}" style="--c:${colorOf(m.k)}">${esc(m.k === me ? 'You' : m.name)}</button> ${esc(m.text)}</p>`).join('');
    log.scrollTop = log.scrollHeight;
  }
  const bump = () => { if (panel.hidden || panel.dataset.tab !== 'chat') { unread++; const b = $('#lifeUnread')!; b.hidden = false; b.textContent = String(Math.min(9, unread)); } };
  function drawPeople() {
    const real = peers.filter((x) => !isBlocked(x.key));
    $('#evHereN')!.textContent = `${world.count()} here${ch ? ` · ${real.length + 1} live` : ''}`;
    const people = world.people().filter((x) => x.bot);
    const row = (k: string, name: string, sub: string, liveNow: boolean) => `<button class="life-row" data-person="${esc(k)}"><span class="ev-person big" style="--c:${colorOf(k)}"><i>${initial(name)}</i></span><span class="grow"><b>${esc(name)}</b><small class="muted">${esc(sub)}</small></span>${liveNow ? '<span class="badge gold">Rider</span>' : ''}</button>`;
    $('#evPeople')!.innerHTML = `<div class="life-row me"><span class="ev-person big me" style="--c:${colorOf(me)}"><i>${initial(p.name)}</i></span><span class="grow"><b>You</b><small class="muted">${esc(ACT_LABEL[world.me.act] ?? 'Hanging out')}</small></span></div>`
      + real.map((x) => row(x.key, x.state.name, 'Riding LEGONRUSH now', true)).join('')
      + people.map((x) => row(x.key, x.name, `${x.hall ? `${x.hall} · ` : ''}${ACT_LABEL[x.act] ?? 'Hanging out'}`, false)).join('')
      + (ch ? '' : `<p class="muted small">${icons.wifiOff} Can't reach live riders right now. Everyone here is still around, and scores post when you're back online.</p>`);
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
  const drawHere = () => { const el = $('#lifeHere'); if (el) el.textContent = `${world.count()} here`; };
  drawHere();
  const hereTimer = window.setInterval(() => {
    world.setCrowd(crowdNow(venue));
    drawHere();
    if (!panel.hidden && panel.dataset.tab === 'people') drawPeople();
  }, 2500);

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
    if (id === 'wave' || id === 'highfive') world.doAct('wave');
    if (id === 'dance') world.doAct('dance');
    buzz(8);
    ch?.send('emote', { k: me, name: p.name, e: id });
  };

  // ---------- interactions with real riders (always asked first) ----------
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
    note(`You and ${nameOf(other)} ${k.did}.`);
    if (kind === 'dance') world.doAct('dance');
    else world.doAct('wave');
    world.peerGesture(other, kind === 'highfive' ? 'highfive' : 'wave');
    if (kind === 'photo') setTimeout(takePhoto, 900);
    sfx.coin();
  }
  const note = (text: string) => { msgs.push({ k: '', name: '', text, at: Date.now(), sys: true }); drawLog(); };
  const toast = (html: string, ms = 2600) => {
    const t = $('#lifeToast');
    if (!t) return;
    t.innerHTML = html;
    t.hidden = false;
    clearTimeout(Number(t.dataset.t));
    t.dataset.t = String(window.setTimeout(() => { t.hidden = true; }, ms));
  };

  // ---------- a person ----------
  function botSheet(b: Person) {
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    const staff = b.act === 'vendor' || b.act === 'dj';
    ov.innerHTML = `<div class="sheet light-ui ev-person-sheet">
      <div class="row"><span class="ev-person big" style="--c:${colorOf(b.key)}"><i>${initial(b.name)}</i></span><div class="grow"><h2 class="title" style="font-size:24px;margin:0">${esc(b.name)}</h2><small class="muted">${esc([b.hall, ACT_LABEL[b.act]].filter(Boolean).join(' · '))}</small></div><button class="btn btn-link" data-close>${icons.close}</button></div>
      ${staff ? `<p class="muted small">${b.act === 'dj' ? 'Running the music tonight.' : 'Serving food. Tap Eat to get something.'}</p>` : ''}
      <div class="ev-asks">${ASKS.filter((a) => !a.adult).map((a) => `<button class="ev-emote" data-ask="${a.id}">${a.icon}<span>${a.label}</span></button>`).join('')}</div>
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t === ov || t.closest('[data-close]')) return ov.remove();
      const a = t.closest<HTMLElement>('[data-ask]')?.dataset.ask as Ask | undefined;
      if (!a) return;
      ov.remove();
      toast(`${icons.hand} Asking ${esc(b.name.split(' ')[0])}…`, 1800);
      void world.askBot(b, a).then((yes) => {
        if (gone) return;
        if (!yes) return toast(`${esc(b.name.split(' ')[0])} said maybe later`);
        const k = ASKS.find((x) => x.id === a)!;
        floatEmote(a, `You & ${b.name.split(' ')[0]}`);
        toast(`${k.icon} You and ${esc(b.name.split(' ')[0])} ${k.did}`);
        sfx.coin();
        if (a === 'photo') setTimeout(takePhoto, 1600);
      });
    });
  }
  function personSheet(k: string) {
    if (k === me) return;
    if (k.startsWith('bot:')) { const b = world.people().find((x) => x.key === k); if (b) botSheet(b); return; }
    const them = peers.find((x) => x.key === k);
    const name = them?.state.name ?? msgs.find((m) => m.k === k)?.name ?? 'Rider';
    const isMuted = muted().includes(k);
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    const canHeart = adult && !!them?.state.adult;
    ov.innerHTML = `<div class="sheet light-ui ev-person-sheet">
      <div class="row"><span class="ev-person big" style="--c:${colorOf(k)}"><i>${initial(name)}</i></span><h2 class="title" style="font-size:24px">${esc(name)}</h2><span class="grow"></span><button class="btn btn-link" data-close>${icons.close}</button></div>
      ${them ? `<div class="ev-asks">${ASKS.filter((a) => !a.adult || canHeart).map((a) => `<button class="ev-emote" data-ask="${a.id}">${a.icon}<span>${a.label}</span></button>`).join('')}</div>
      <p class="muted small">${esc(name)} gets a request and chooses to accept or decline.${adult ? '' : ' Hearts are for riders 18 and over.'}</p>` : `<p class="muted small">${esc(name)} has left.</p>`}
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
      if (act === 'block') { block(k, name); world.setPeer(k, name, null); close(); drawPeople(); drawLog(); note(`You blocked ${name}. You won't see them again.`); return; }
      const r = t.closest<HTMLElement>('[data-reason]')?.dataset.reason;
      if (r) {
        const lines = msgs.filter((m) => m.k === k).slice(-20).map((m) => m.text);
        saveReport({ id: k, name, reason: r, code: e.key, lines, at: Date.now() });
        void srv.reportRider({ eventKey: e.key, who: k, name, reason: r, lines });
        ov.querySelector('.ev-reasons')!.innerHTML = `<p class="ev-note good">${icons.check} Thanks. Your report was sent for review. You can block ${esc(name)} too.</p>`;
      }
    });
  }

  // ---------- photos ----------
  function takePhoto() {
    if (gone) return;
    let url = '';
    try { url = world.selfie(() => h.world.capture()); } catch { return toast('Couldn’t take the photo on this phone.'); }
    sfx.coin();
    buzz(15);
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    const file = `legonrush-${venue.id.replace(/[^a-z0-9-]/gi, '')}.png`;
    ov.innerHTML = `<div class="sheet light-ui life-photo">
      <img src="${url}" alt="Your photo at ${esc(e.name)}">
      <div class="two"><a class="btn btn-ghost" href="${url}" download="${file}">Save</a><button class="btn btn-primary" data-share>Share</button></div>
      <button class="btn btn-link" data-close>Close</button></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', async (ev) => {
      const t = ev.target as HTMLElement;
      if (t === ov || t.closest('[data-close]')) return ov.remove();
      if (t.closest('[data-share]')) {
        try {
          const blob = await (await fetch(url)).blob();
          const f = new File([blob], file, { type: 'image/png' });
          if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text: `At ${e.name} on LEGONRUSH` });
          else (ov.querySelector('a[download]') as HTMLAnchorElement).click();
        } catch { /* cancelled */ }
      }
    });
  }

  // ---------- connect ----------
  const connEl = $('#evConn')!;
  let lastPos = '';
  const posTimer = window.setInterval(() => {
    if (!ch) return;
    const s = world.state();
    const key = JSON.stringify(s);
    if (key === lastPos) return;
    lastPos = key;
    ch.send('pos', { k: me, name: p.name.slice(0, 24), ...s });
  }, 500);
  void live.join(`ev:${e.key}`, me, { name: p.name.slice(0, 24), adult, since: Date.now() }).then((c) => {
    if (gone) { c?.leave(); return; }
    ch = c;
    connEl.textContent = c ? 'Live' : 'Offline';
    connEl.classList.toggle('on', !!c);
    if (!c) return drawPeople();
    c.onPeers((list) => {
      const before = new Set(peers.map((x) => x.key));
      peers = list.filter((x) => x.state && typeof x.state.name === 'string');
      const now = new Set(peers.map((x) => x.key));
      for (const x of peers) if (!before.has(x.key) && !hidden(x.key)) { if (before.size) note(`${x.state.name} arrived.`); world.setPeer(x.key, x.state.name, { x: 0, z: 0, yaw: 0, act: 'idle' }); lastPos = ''; }
      for (const k of before) if (!now.has(k)) world.setPeer(k, '', null);
      drawPeople();
      drawHere();
    });
    c.on('pos', (m: { k: string; name: string; x: number; z: number; yaw: number; act: Act }) => {
      if (typeof m?.k !== 'string' || hidden(m.k) || !peers.some((x) => x.key === m.k)) return;
      if (![m.x, m.z, m.yaw].every(Number.isFinite)) return;
      world.setPeer(m.k, String(m.name).slice(0, 24), { x: m.x, z: m.z, yaw: m.yaw, act: (['idle', 'walk', 'dance', 'sit', 'eat', 'photo', 'pose', 'chat'] as Act[]).includes(m.act) ? m.act : 'idle' });
    });
    c.on('chat', (m: Msg) => {
      if (typeof m?.text !== 'string' || typeof m.k !== 'string') return;
      const text = maskText(m.text.slice(0, 160));
      msgs.push({ k: m.k, name: String(m.name).slice(0, 24), text, at: Date.now() });
      if (!hidden(m.k)) { world.speak(m.k, text); bump(); }
      drawLog();
    });
    c.on('emote', (m: { k: string; name: string; e: Emote }) => {
      if (hidden(m.k) || !EMOTES.some((x) => x.id === m.e)) return;
      floatEmote(m.e, String(m.name).slice(0, 18));
      world.peerGesture(m.k, m.e === 'highfive' ? 'highfive' : 'wave');
    });
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
  void drawBoard(boardGame);

  // ---------- walking, looking, tapping people ----------
  const touch = $('#lifeTouch')!;
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let pinch = 0;
  touch.addEventListener('pointerdown', (ev) => {
    touch.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY, t: performance.now() });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  touch.addEventListener('pointermove', (ev) => {
    const q = pts.get(ev.pointerId);
    if (!q) return;
    if (pts.size === 2) {
      q.x = ev.clientX; q.y = ev.clientY;
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) world.zoom(pinch / d);
      pinch = d;
      return;
    }
    world.drag(ev.clientX - q.x, ev.clientY - q.y);
    q.x = ev.clientX; q.y = ev.clientY;
  });
  const up = (ev: PointerEvent) => {
    const q = pts.get(ev.pointerId);
    pts.delete(ev.pointerId);
    if (!q || pts.size) return;
    if (Math.hypot(ev.clientX - q.sx, ev.clientY - q.sy) < 10 && performance.now() - q.t < 450) {
      const who = world.tap(ev.clientX, ev.clientY);
      if (who) personSheet(who.key);
    }
  };
  touch.addEventListener('pointerup', up);
  touch.addEventListener('pointercancel', (ev) => pts.delete(ev.pointerId));
  touch.addEventListener('wheel', (ev) => { ev.preventDefault(); world.zoom(ev.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  const typing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
  const keyDown = (ev: KeyboardEvent) => { if (!typing() && /^(w|a|s|d|arrow(up|down|left|right))$/.test(ev.key.toLowerCase())) { world.keys.add(ev.key.toLowerCase()); ev.preventDefault(); } };
  const keyUp = (ev: KeyboardEvent) => world.keys.delete(ev.key.toLowerCase());
  addEventListener('keydown', keyDown);
  addEventListener('keyup', keyUp);

  // ---------- buttons ----------
  h.app.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act as 'dance' | 'wave' | 'sit' | 'eat' | 'photo';
    if (a === 'photo') return takePhoto();
    if (a === 'dance' && world.me.act === 'dance') { world.doAct('stop'); return; }
    world.doAct(a);
    if (a === 'wave') ch?.send('emote', { k: me, name: p.name, e: 'wave' });
    if (a === 'eat') toast(`${icons.food} Getting something to eat…`);
    buzz(8);
  }));
  const openPanel = (tab: string) => {
    panel.hidden = false;
    panel.dataset.tab = tab;
    panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    panel.querySelectorAll<HTMLElement>('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== tab; });
    if (tab === 'chat') { unread = 0; $('#lifeUnread')!.hidden = true; log.scrollTop = log.scrollHeight; }
    if (tab === 'people') drawPeople();
  };
  h.app.querySelectorAll<HTMLElement>('[data-panel]').forEach((b) => b.addEventListener('click', () => (!panel.hidden && panel.dataset.tab === b.dataset.panel ? (panel.hidden = true) : openPanel(b.dataset.panel!))));
  panel.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.tab!)));
  $('#lifeClose')!.addEventListener('click', () => { panel.hidden = true; });
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
    world.speak('me', text);
    drawLog();
    ch?.send('chat', { k: me, name: p.name.slice(0, 24), text });
    // someone standing near you answers now and then
    const b = world.nearestBot();
    const r = b && replyTo(text, Math.random);
    if (b && r) setTimeout(() => { if (gone) return; world.speak(b.key, r); msgs.push({ k: b.key, name: b.name, text: r, at: Date.now() }); drawLog(); }, 1200 + Math.random() * 1500);
  });
  $('#evMusic')!.addEventListener('click', () => {
    musicOn = !musicOn;
    if (musicOn) startParty(venue.style, { people: world.count(), horn: venue.horn }); else stopParty();
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
    clearInterval(hereTimer);
    clearInterval(posTimer);
    for (const x of pending.values()) clearTimeout(x.timer);
    h.app.removeEventListener('click', onPerson);
    removeEventListener('keydown', keyDown);
    removeEventListener('keyup', keyUp);
    ch?.leave();
    stopParty();
    h.world.exit();
    world.dispose();
    back();
  }
}
