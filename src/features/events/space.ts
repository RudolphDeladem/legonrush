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
import * as srv from './cloud';
import { HALL_PLACE, hallById } from '../../data/campus';
import { placeByName } from '../../game/campusmap';
import { buildHangout, type Act, type Person } from '../life/world';
import { crowdNow, freeNow, menuOf, showNow, skyNow, venueById, type MenuItem, type Theme, type Venue } from '../life/venues';
import { grant, spend } from '../inventory';
import { GAMES, playGame, type GameId } from './games';
import type { PartyStyle } from '../../audio';
import { chatBack, introFor, lineFor, QUICK_FLIRT, QUICK_SAY, replyTo } from '../life/bots';

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
type Ask = 'hi' | 'highfive' | 'dance' | 'photo' | 'heart' | 'kiss';
const ASKS: { id: Ask; label: string; icon: string; did: string; adult?: boolean }[] = [
  { id: 'hi', label: 'Say hi', icon: icons.hand, did: 'said hi' },
  { id: 'highfive', label: 'High five', icon: icons.highfive, did: 'high-fived' },
  { id: 'dance', label: 'Dance together', icon: icons.dance, did: 'danced together' },
  { id: 'photo', label: 'Take a photo together', icon: icons.camera, did: 'took a photo together' },
  { id: 'heart', label: 'Send a heart', icon: icons.heart, did: 'shared a heart', adult: true },
  { id: 'kiss', label: 'Kiss', icon: icons.heartFill, did: 'shared a kiss', adult: true },
];

// once-a-day things per place: the free sponsored food, the giveaway, the mini-game prize
const DAILY_KEY = 'legonrush.life.daily.v1';
const today = () => new Date().toDateString();
const dailyDone = (k: string) => { try { return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}')[k] === today(); } catch { return false; } };
const dailySet = (k: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}') as Record<string, string>;
    for (const x of Object.keys(all)) if (all[x] !== today()) delete all[x];
    all[k] = today();
    localStorage.setItem(DAILY_KEY, JSON.stringify(all));
  } catch { /* blocked */ }
};
const GENRES: { id: PartyStyle; label: string; line: string }[] = [
  { id: 'afrobeats', label: 'Afrobeats', line: 'Afrobeats coming up!' },
  { id: 'amapiano', label: 'Amapiano', line: 'Amapiano! Log drum, let’s go!' },
  { id: 'highlife', label: 'Highlife', line: 'A highlife classic for the old souls!' },
  { id: 'chill', label: 'Chill vibes', line: 'Slowing it down a bit. Enjoy.' },
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
  const n = Math.max(24, Math.min(90, (e.joinedCount ?? 0) * 2 + 30));
  const big = ['party', 'festival', 'seasonal', 'special'].includes(e.type);
  return {
    id: e.key, name: e.name, place: placeByName(e.place) ? e.place : 'Athletic Oval', theme,
    style: theme === 'jam' ? 'amapiano' : theme === 'square' ? 'highlife' : 'afrobeats',
    blurb: e.blurb, things: [], peak: [0, 24], crowd: [n, n], cover: e.cover, horn: theme === 'jam',
    color: theme === 'hall' ? hallById(hall ?? H().profile().hall).color : undefined,
    // special events: the food is on the host
    sponsor: big ? { by: e.host || 'the host', item: theme === 'jam' ? 'burger' : 'jollof', hours: [0, 24] } : undefined,
  };
}

const ACT_LABEL: Partial<Record<Act, string>> = { dance: 'Dancing', sit: 'Sitting', eat: 'Eating', chat: 'Chatting', photo: 'Taking photos', pose: 'Posing', dj: 'On the decks', vendor: 'Selling food', sing: 'On stage', crew: 'On stage' };

export function spaceScreen(e: CampusEvent, back: () => void) {
  const h = H();
  const p = h.profile();
  const me = myKey();
  const adult = dateCheck(p) === 'ok';
  const venue = venueOf(e);
  let ch: live.Channel | null = null;
  let peers: live.Peer<PeerState>[] = [];
  const msgs: Msg[] = [{ k: '', name: '', text: `Welcome to ${e.name}. Tap someone to say hi. Be kind: block, mute and report are one tap away.`, at: Date.now(), sys: true }];
  let musicOn = true;
  let gone = false;
  let lastSend = 0;
  const pending = new Map<string, { to: string; kind: Ask; timer: number }>();
  const answered = new Set<string>();

  const first = takePart(p, e);
  const stayTimer = window.setTimeout(() => complete(p, e), 3 * 60e3);

  // ---------- the place ----------
  const sky = skyNow();
  const show = showNow(venue);
  const world = buildHangout(venue, { name: p.name, hall: hallById(p.hall).short, skin: p.look.skin, shirt: p.look.jersey || hallById(p.hall).color, female: p.gender === 'female' }, crowdNow(venue), sky === 'night', show);
  let style: PartyStyle = ['acoustic', 'poetry', 'movie', 'comedy'].includes(show.kind) ? 'chill' : show.kind === 'live' ? 'highlife' : venue.style;
  const menu = menuOf(venue);
  const free = freeNow(venue);
  h.showcase();
  h.world.enter(world);
  h.world.time(sky);
  unlockAudio();
  startParty(style, { people: world.count(), horn: venue.horn });

  h.app.innerHTML = `
    <div class="life fade-in">
      <div class="life-touch" id="lifeTouch"></div>
      <div class="life-top">
        <button class="life-round" id="evLeave" aria-label="Leave">${icons.arrow}</button>
        <div class="life-title"><small>${icons.pin} ${esc(placeLabel(venue.place))}</small><b>${esc(e.name)}</b></div>
        <span class="life-here"><i class="ev-dot"></i><span id="lifeHere"></span></span>
        <button class="life-round on" id="evMusic" aria-label="Music">${icons.music}<span class="ev-eq on" id="evEq" aria-hidden="true"><i></i><i></i><i></i></span></button>
      </div>
      <div class="life-pills">
        <button class="life-pill stage" id="lifeStage"><i>${show.emoji}</i><span><small>Now on stage</small><b>${esc(show.who)} · ${esc(show.label)}</b></span></button>
        ${free ? `<button class="life-pill free" id="lifeFree"><i>${free.item.emoji}</i><span><small>Free food</small><b>${esc(free.item.name)} by ${esc(free.by)}</b></span></button>` : ''}
      </div>
      <div class="ev-floats life-floats" id="evFloats"></div>
      <button class="life-near" id="lifeNear" hidden></button>
      <p class="life-toast" id="lifeToast"${first ? '' : ' hidden'}>${first ? `${icons.stamp} Passport stamped${rewardText(first) ? ` · ${esc(rewardText(first))}` : ''}` : ''}</p>
      <p class="life-hint" id="lifeHint">Tap the ground to walk. Tap anyone to say hi, or tap Meet. Drag to look around.</p>
      <div class="life-acts">
        <button data-act="meet">${icons.users}<span>Meet</span></button>
        <button data-act="dance">${icons.dance}<span>Dance</span></button>
        <button data-act="food">${icons.food}<span>Food</span></button>
        <button data-act="stage">${icons.music}<span>Stage</span></button>
        <button data-act="photo">${icons.camera}<span>Photo</span></button>
        <button data-panel="chat">${icons.chat}<span>Chat</span><i class="life-badge" id="lifeUnread" hidden></i></button>
        <button data-act="more">${icons.grid}<span>More</span></button>
      </div>
      <div class="life-panel light-ui" id="lifePanel" hidden>
        <div class="row life-panel-h"><div class="seg" id="lifeTabs"><button data-tab="chat" class="on">Chat</button><button data-tab="people">People here</button></div><span class="grow"></span><button class="btn btn-link" id="lifeClose" aria-label="Close">${icons.close}</button></div>
        <div data-pane="chat" class="ev-chat">
          <div class="row"><span class="muted small">Event chat</span><span class="grow"></span><span class="muted small" id="evConn">Connecting…</span></div>
          <div class="ev-log" id="evLog"></div>
          <div class="ev-quick" id="evQuick">${[...QUICK_SAY, ...(adult ? QUICK_FLIRT : [])].map((q) => `<button type="button" data-say="${esc(q)}">${esc(q)}</button>`).join('')}</div>
          <form class="chat-form" id="evForm"><input id="evSay" maxlength="160" autocomplete="off" placeholder="Say something…" aria-label="Message"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form>
        </div>
        <div data-pane="people" class="stack" style="gap:10px" hidden>
          <div class="ev-emotes">${EMOTES.map((x) => `<button class="ev-emote" data-emote="${x.id}">${x.icon}<span>${x.label}</span></button>`).join('')}</div>
          <div class="row"><b>${icons.users} Who's here</b><span class="grow"></span><span class="muted small" id="evHereN"></span></div>
          <div class="life-list" id="evPeople"></div>
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
    else if (kind === 'kiss') { world.me.gesture = 'kiss'; world.me.gestureT = 1.6; }
    else world.doAct('wave');
    world.peerGesture(other, kind === 'highfive' ? 'highfive' : kind === 'kiss' ? 'kiss' : 'wave');
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
    const staff = b.act === 'vendor' || b.act === 'dj' || b.act === 'sing' || b.act === 'crew';
    ov.innerHTML = `<div class="sheet light-ui ev-person-sheet">
      <div class="row"><span class="ev-person big" style="--c:${colorOf(b.key)}"><i>${initial(b.name)}</i></span><div class="grow"><h2 class="title" style="font-size:24px;margin:0">${esc(b.name)}</h2><small class="muted">${esc([b.hall, ACT_LABEL[b.act]].filter(Boolean).join(' · '))}</small></div><button class="btn btn-link" data-close>${icons.close}</button></div>
      ${staff ? `<p class="muted small">${b.act === 'vendor' ? 'Serving food and drinks.' : 'On stage right now.'}</p><button class="btn btn-primary" data-staff>${b.act === 'vendor' ? `${icons.food} See the menu` : `${icons.music} Request a song`}</button>` : `<div class="ev-asks life-inter">
        <button class="ev-emote" data-ask="hi">${icons.hand}<span>Wave</span></button>
        <button class="ev-emote" data-talk="chat">${icons.chat}<span>Talk</span></button>
        <button class="ev-emote" data-ask="dance">${icons.dance}<span>Dance together</span></button>
        <button class="ev-emote" data-ask="photo">${icons.camera}<span>Take photo</span></button>
        <button class="ev-emote" data-ask="highfive">${icons.highfive}<span>High five</span></button>
        ${adult ? `<button class="ev-emote" data-talk="flirt">${icons.heart}<span>Flirt</span></button><button class="ev-emote" data-ask="kiss">${icons.heartFill}<span>Kiss</span></button>` : ''}
      </div>
      <p class="muted small">${adult ? `A kiss only happens if ${esc(b.name.split(' ')[0])} says yes.` : 'Be friendly. Flirting is for riders 18 and over.'}</p>`}
    </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t === ov || t.closest('[data-close]')) return ov.remove();
      if (t.closest('[data-staff]')) { ov.remove(); return b.act === 'vendor' ? foodSheet() : stageSheet(); }
      const talk = t.closest<HTMLElement>('[data-talk]')?.dataset.talk;
      if (talk) {
        ov.remove();
        if (!world.meetSomeone(b)) return toast(`${esc(b.name.split(' ')[0])} is busy right now`);
        partner = b;
        lastMeet = Date.now();
        openPanel('chat');
        if (talk === 'flirt') { void world.askBot(b, 'flirt'); send(QUICK_FLIRT[(Math.random() * QUICK_FLIRT.length) | 0]); }
        else setTimeout(() => { if (!gone) botSays(b, introFor(b, venue.theme, Math.random)); }, 1400);
        return;
      }
      const a = t.closest<HTMLElement>('[data-ask]')?.dataset.ask as Ask | undefined;
      if (!a || (ASKS.find((x) => x.id === a)?.adult && !adult)) return;
      ov.remove();
      partner = b;
      toast(`${a === 'kiss' ? icons.heart : icons.hand} Asking ${esc(b.name.split(' ')[0])}…`, 1800);
      void world.askBot(b, a).then((yes) => {
        if (gone) return;
        if (!yes) return toast(a === 'kiss' ? `${esc(b.name.split(' ')[0])} wants to take it slow. Keep talking!` : `${esc(b.name.split(' ')[0])} said maybe later`);
        const k = ASKS.find((x) => x.id === a)!;
        floatEmote(a, `You & ${b.name.split(' ')[0]}`);
        toast(`${k.icon} You and ${esc(b.name.split(' ')[0])} ${k.did}`);
        sfx.coin();
        if (a === 'photo') setTimeout(takePhoto, 1600);
        if (a === 'kiss') setTimeout(() => { if (!gone) for (let i = 0; i < 3; i++) setTimeout(() => floatEmote('heart', ''), i * 250); }, 900);
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
      ${them ? `<div class="ev-asks"><button class="ev-emote" data-talkto>${icons.chat}<span>Talk</span></button>${ASKS.filter((a) => !a.adult || canHeart).map((a) => `<button class="ev-emote" data-ask="${a.id}">${a.icon}<span>${a.label}</span></button>`).join('')}</div>
      <p class="muted small">${esc(name)} gets a request and chooses to accept or decline.${adult ? '' : ' Hearts and kisses are for riders 18 and over.'}</p>` : `<p class="muted small">${esc(name)} has left.</p>`}
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
      if (t.closest('[data-talkto]')) { close(); openPanel('chat'); input.value = `@${name.split(' ')[0]} `; input.focus(); return; }
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

  // ---------- meeting people ----------
  /** who you're talking with: the last person who came over or answered you */
  let partner: Person | null = null;
  let lastMeet = Date.now();
  function meet(asked: boolean) {
    const b = world.meetSomeone();
    if (!b) { if (asked) toast('Everyone is busy right now. Try walking over to a group.'); return; }
    lastMeet = Date.now();
    partner = b;
    if (asked) toast(`${icons.users} ${esc(b.name.split(' ')[0])} is coming over`, 2200);
    setTimeout(() => {
      if (gone) return;
      const line = introFor(b, venue.theme, Math.random);
      world.speak(b.key, line);
      msgs.push({ k: b.key, name: b.name, text: line, at: Date.now() });
      drawLog();
      bump();
      if (!asked) toast(`${icons.chat} ${esc(b.name.split(' ')[0])} came over to say hi. Reply in Chat.`, 3500);
    }, 2600);
  }
  // after a little while someone comes over by themselves, then every minute or so
  let meetTimer = window.setTimeout(function again() {
    if (gone) return;
    if (Date.now() - lastMeet > 40e3 && panel.hidden) meet(false);
    meetTimer = window.setTimeout(again, 45e3 + Math.random() * 30e3);
  }, 14e3);

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
  });

  drawLog();

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
  $('.life-acts')!.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => doAct(b.dataset.act!)));
  function doAct(a: string) {
    if (a === 'photo') return takePhoto();
    if (a === 'meet') return meet(true);
    if (a === 'food') return foodSheet();
    if (a === 'stage') return stageSheet();
    if (a === 'more') return moreSheet();
    if (a === 'people') return openPanel('people');
    if (a === 'games') return gamesSheet();
    if (a === 'giveaway') return giveaway();
    if (a === 'dance' && world.me.act === 'dance') { world.doAct('stop'); return; }
    if (a !== 'dance' && a !== 'wave' && a !== 'sit') return;
    world.doAct(a);
    if (a === 'wave') ch?.send('emote', { k: me, name: p.name, e: 'wave' });
    buzz(8);
  }
  $('#lifeStage')!.addEventListener('click', () => stageSheet());
  $('#lifeFree')?.addEventListener('click', () => foodSheet());

  // ---------- sheets ----------
  function sheet(html: string, cls = '') {
    const ov = document.createElement('div');
    ov.className = 'overlay sheet-overlay fade-in';
    ov.innerHTML = `<div class="sheet light-ui life-sheet ${cls}">${html}</div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => { const t = ev.target as HTMLElement; if (t === ov || t.closest('[data-close]')) ov.remove(); });
    return ov;
  }
  const head = (title: string, sub = '') => `<div class="row"><div class="grow"><h2 class="title" style="font-size:24px;margin:0">${title}</h2>${sub ? `<small class="muted">${sub}</small>` : ''}</div><button class="btn btn-link" data-close aria-label="Close">${icons.close}</button></div>`;

  // food and drinks: pay in Rush Coins, or free while a sponsor is paying
  function foodSheet() {
    const freeId = free && !dailyDone(`free:${venue.id}`) ? free.item.id : '';
    const vend = world.staff('vendor');
    const row = (m: MenuItem) => {
      const isFree = m.id === freeId;
      return `<button class="life-food${isFree ? ' free' : ''}" data-buy="${esc(m.id)}"><i>${m.emoji}</i><span class="grow"><b>${esc(m.name)}</b>${m.id === venue.special?.id ? `<small class="life-only">Only at ${esc(venue.name)}</small>` : ''}</span>${isFree ? '<em>FREE</em>' : `<span class="life-price">${icons.coin}${m.price}</span>`}</button>`;
    };
    const foods = menu.filter((m) => !m.drink), drinks = menu.filter((m) => m.drink);
    const ov = sheet(`${head(`${icons.food} Food & drinks`, `${vend ? `${esc(vend.name.split(' ')[0])} is serving · ` : ''}You have ${icons.coin}<b id="lifeCoins">${p.coins}</b>`)}
      ${free ? `<p class="life-banner free">${free.item.emoji} <b>FREE ${esc(free.item.name.toUpperCase())}</b> by ${esc(free.by)}${freeId ? '. One each, while it lasts!' : '. You’ve had yours today.'}</p>` : ''}
      <b class="small">Food</b><div class="life-menu">${foods.map(row).join('')}</div>
      <b class="small">Drinks</b><div class="life-menu">${drinks.map(row).join('')}</div>`, 'life-food-sheet');
    ov.addEventListener('click', (ev) => {
      const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-buy]')?.dataset.buy;
      const m = menu.find((x) => x.id === id);
      if (!m) return;
      const isFree = m.id === freeId;
      if (!isFree && !spend(p, { coins: m.price })) { toast(`${icons.coin} Not enough coins for ${esc(m.name)}. Ride or race to earn more.`); return; }
      if (isFree) dailySet(`free:${venue.id}`);
      ov.remove();
      world.doAct(m.drink ? 'drink' : 'eat');
      sfx.coin();
      buzz(10);
      toast(`${m.emoji} ${isFree ? `Free ${esc(m.name)}, thanks to ${esc(free!.by)}!` : `${esc(m.name)} · ${m.price} coins`}`);
      note(isFree ? `You got a free ${m.name} from ${free!.by}.` : `You bought ${m.name} for ${m.price} coins.`);
      if (vend) world.speak(vend.key, ['Enjoy! 😋', 'Thank you, come again!', `One ${m.name}, coming up!`, 'Chop well o!'][(Math.random() * 4) | 0]);
    });
  }

  // the stage: who's on, what's next, and request a song
  let lastRequest = 0;
  function stageSheet() {
    const perf = world.staff('stage');
    const canRequest = show.kind === 'dj' || show.kind === 'live' || show.kind === 'karaoke' || show.kind === 'dance';
    const mins = Math.max(1, Math.round((show.ends - Date.now()) / 60e3));
    const ov = sheet(`${head(`${show.emoji} ${esc(show.label)}`, `Now on stage · ${mins} min left`)}
      <div class="life-stage-card"><b>${esc(show.who)}</b><p class="muted small">${esc(show.line)}</p><small class="muted">Up next: ${esc(show.next)}</small></div>
      ${perf ? `<button class="btn btn-ghost" data-go>${icons.walk} Walk to the stage</button>` : ''}
      ${canRequest ? `<b class="small">Request a song</b><div class="life-genres">${GENRES.map((g) => `<button class="chip${g.id === style ? ' on' : ''}" data-genre="${g.id}">${esc(g.label)}</button>`).join('')}</div>` : ''}
      <button class="btn btn-primary" data-cheer>${icons.sparkle} Cheer</button>`);
    ov.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('[data-go]') && perf) { ov.remove(); world.walkTo(perf.x, perf.z, 3); return; }
      if (t.closest('[data-cheer]')) { ov.remove(); world.cheer(); floatEmote('heart', 'The crowd'); sfx.coin(); if (perf) world.speak(perf.key, ['Make some noise! 🙌', 'Legon, I see you!', 'Thank you! 🔥'][(Math.random() * 3) | 0]); return; }
      const g = GENRES.find((x) => x.id === t.closest<HTMLElement>('[data-genre]')?.dataset.genre);
      if (!g) return;
      ov.remove();
      if (Date.now() - lastRequest < 30e3) { toast(`${icons.clock} One request at a time. Try again in a bit.`); return; }
      lastRequest = Date.now();
      toast(`${icons.music} You asked for ${esc(g.label)}`, 2000);
      setTimeout(() => {
        if (gone) return;
        style = g.id;
        if (musicOn) startParty(style, { people: world.count(), horn: venue.horn });
        world.cheer();
        if (perf) world.speak(perf.key, `${g.line} This one’s for ${p.name.split(' ')[0]}!`);
        note(`${perf?.name ?? 'The DJ'} played your ${g.label} request.`);
        floatEmote('dance', 'Everyone');
      }, 2500);
    });
  }

  function moreSheet() {
    const items: [string, string, string][] = [
      ['wave', icons.hand, 'Wave'], ['sit', icons.seat, 'Sit down'], ['people', icons.users, 'People here'],
      ['games', icons.target, 'Mini-games'], ['giveaway', icons.gift, dailyDone(`give:${venue.id}`) ? 'Giveaway (collected)' : 'Giveaway'],
    ];
    const ov = sheet(`${head('More to do')}<div class="ev-asks">${items.map(([id, ic, l]) => `<button class="ev-emote" data-more="${id}">${ic}<span>${esc(l)}</span></button>`).join('')}</div>`);
    ov.addEventListener('click', (ev) => { const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-more]')?.dataset.more; if (a) { ov.remove(); doAct(a); } });
  }

  function giveaway() {
    if (dailyDone(`give:${venue.id}`)) return toast(`${icons.gift} You already collected today's giveaway here. Come back tomorrow!`);
    dailySet(`give:${venue.id}`);
    const coins = 20 + Math.floor(Math.random() * 7) * 10;
    grant(p, { coins, xp: 20 });
    world.doAct('wave');
    sfx.coin();
    buzz([20, 30, 20]);
    floatEmote('heart', `+${coins} coins`);
    const ov = sheet(`<div class="life-gift"><span>🎁</span><h2 class="title" style="font-size:26px">Giveaway!</h2><p>You got <b>${coins} Rush Coins</b> and <b>20 XP</b> at ${esc(venue.name)}.</p><button class="btn btn-primary" data-close>Nice!</button></div>`);
    void ov;
  }

  function gamesSheet() {
    const ov = sheet(`${head(`${icons.target} Mini-games`, 'Play while you hang out. Your first game here each day pays coins.')}${GAMES.map((g) => `<button class="life-food" data-game="${g.id}"><i>${g.icon}</i><span class="grow"><b>${esc(g.name)}</b><small class="muted">${esc(g.blurb)}</small></span></button>`).join('')}`);
    ov.addEventListener('click', (ev) => {
      const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-game]')?.dataset.game as GameId | undefined;
      if (!id) return;
      ov.remove();
      playGame(id, (score) => {
        if (gone || score === null) return;
        const k = `game:${venue.id}`;
        const coins = dailyDone(k) ? 0 : Math.min(60, Math.round(score / 30));
        if (coins) { dailySet(k); grant(p, { coins }); }
        toast(`${icons.target} ${score} points${coins ? ` · +${coins} coins` : ''}`, 3200);
        note(`You scored ${score} in ${GAMES.find((g) => g.id === id)!.name}.`);
      });
    });
  }

  // walking up to someone: a little prompt to interact
  const nearEl = $('#lifeNear')!;
  let nearKey = '';
  const nearTimer = window.setInterval(() => {
    const c = world.closest();
    const show2 = c && c.d < 2.3 && !(c.p.act === 'vendor' && c.d > 2);
    const k = show2 ? c!.p.key : '';
    if (k === nearKey) return;
    nearKey = k;
    nearEl.hidden = !k;
    if (!k) return;
    const q = c!.p;
    const what = q.act === 'vendor' ? `${icons.food} Buy food from ${esc(q.name.split(' ')[0])}` : q.act === 'dj' || q.act === 'sing' || q.act === 'crew' ? `${icons.music} ${esc(q.name)}: request a song` : `${icons.hand} ${esc(q.name.split(' ')[0])} · Wave, talk, dance…`;
    nearEl.innerHTML = what;
  }, 400);
  nearEl.addEventListener('click', () => {
    const q = world.closest()?.p;
    if (!q) return;
    if (q.act === 'vendor') return foodSheet();
    if (q.act === 'dj' || q.act === 'sing' || q.act === 'crew') return stageSheet();
    personSheet(q.key);
  });
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
    if (send(input.value)) input.value = '';
  });
  $('#evQuick')!.addEventListener('click', (ev) => {
    const q = (ev.target as HTMLElement).closest<HTMLElement>('[data-say]')?.dataset.say;
    if (q) send(q);
  });
  function send(raw: string) {
    const text = maskText(raw.trim().slice(0, 160));
    if (!text) return false;
    if (Date.now() - lastSend < 1000) return false;
    lastSend = Date.now();
    msgs.push({ k: me, name: p.name, text, at: Date.now() });
    world.speak('me', text);
    drawLog();
    ch?.send('chat', { k: me, name: p.name.slice(0, 24), text });
    // whoever you're talking with answers (or someone standing near you)
    const near = world.nearestBot();
    const b = partner && world.people().includes(partner) && Math.hypot(partner.x - world.me.x, partner.z - world.me.z) < 6 ? partner : near;
    if (b) partner = b;
    const r = b && replyTo(text, Math.random, b);
    if (b && r) setTimeout(() => { if (!gone) botSays(b, r); }, 1200 + Math.random() * 1500);
    return true;
  }
  function botSays(b: Person, text: string) {
    world.speak(b.key, text);
    msgs.push({ k: b.key, name: b.name, text, at: Date.now() });
    drawLog();
    bump();
  }
  // the crowd talks in the chat too: someone says something every little while and others answer
  let chatTimer = window.setTimeout(function again() {
    if (gone) return;
    const crowd = world.people().filter((x) => x.bot && !x.bike && !['vendor', 'dj', 'sing', 'crew'].includes(x.act) && x !== partner);
    const a = crowd[(Math.random() * crowd.length) | 0];
    if (a) {
      const line = lineFor(venue.theme, Math.random);
      botSays(a, line);
      const b = crowd[(Math.random() * crowd.length) | 0];
      if (b && b !== a && Math.random() < 0.55) setTimeout(() => { if (!gone) botSays(b, chatBack(line, Math.random)); }, 2000 + Math.random() * 3000);
    }
    chatTimer = window.setTimeout(again, 9e3 + Math.random() * 14e3);
  }, 5e3);
  $('#evMusic')!.addEventListener('click', () => {
    musicOn = !musicOn;
    if (musicOn) startParty(style, { people: world.count(), horn: venue.horn }); else stopParty();
    $('#evMusic')!.classList.toggle('on', musicOn);
    $('#evEq')!.classList.toggle('on', musicOn);
  });
  $('#evLeave')!.addEventListener('click', () => leave());

  function leave() {
    if (gone) return;
    gone = true;
    clearTimeout(stayTimer);
    clearInterval(hereTimer);
    clearInterval(posTimer);
    clearInterval(nearTimer);
    clearTimeout(meetTimer);
    clearTimeout(chatTimer);
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
