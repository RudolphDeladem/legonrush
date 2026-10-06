// The lobby before a live challenge race: who is here and ready (live presence), the countdown,
// and the start. Uses the same live channels as Quick Match (src/live.ts); the race itself is the
// normal live race ride, with the challenge's HUD panel and result posting on top.
import * as live from '../../live';
import { icons } from '../../ui/icons';
import { hallById } from '../../data/campus';
import { levelFor } from '../../state';
import { H, esc, on, screen } from '../host';
import * as api from './api';
import { isCreator } from './data';
import { countdown, dayDiff, phaseOf, timeText, whenText, type Challenge } from './model';

/** "4:00 PM today", "9:00 AM tomorrow", "Saturday at 5:00 PM" */
const atText = (t: number) => { const d = dayDiff(t); return d === 0 ? `${timeText(t)} today` : d === 1 ? `${timeText(t)} tomorrow` : whenText(t).replace(' · ', ' at '); };
import { riderRow, detailScreen } from './screens';
import { rideChallenge } from './ride';

interface LobbyState { id: string; name: string; username: string; level: number; hall: string; bike: string; jersey: string; ready: boolean }
interface GoMsg { riders: { id: string; name: string; jersey: string }[]; at: number }

/** how long after the start time a missing "go" makes a ready rider start on their own */
const GO_WAIT = 8000;

export async function lobbyScreen(c: Challenge, back: () => void = () => detailScreen(c)) {
  const h = H();
  const p = h.profile();
  const me = h.myId();
  const state: LobbyState = { id: me, name: p.name, username: p.username, level: levelFor(p.xp), hall: p.hall, bike: p.bike, jersey: p.look?.jersey || hallById(p.hall).color, ready: false };
  // until the live channel connects (or when offline), a stand-in where only you are here
  const offline: live.Channel = { send: () => {}, on: () => {}, onPeers: () => {}, track: () => {}, peers: () => [], leave: () => {} };
  let lobby: live.Channel = offline;
  let started = false;
  let leaving = false;
  let timer = 0;
  let retry = 0;
  let entries: api.Entry[] = [];
  let soloOffered = false;
  const leave = () => {
    leaving = true;
    clearInterval(timer);
    clearTimeout(retry);
    if (!started) lobby.leave();
    back();
  };
  screen(`
    <p class="kicker">${icons.flag} Lobby</p>
    <h1 class="title">${esc(c.name)}</h1>
    <div class="chx-lobby-clock" id="lbClock"></div>
    <p class="chx-net small" id="lbNet">Connecting to the lobby…</p>
    <div class="card chx-lobby">
      <div class="row"><b>Riders</b><span class="grow"></span><span class="muted small" id="lbCount"></span></div>
      <div id="lbRiders"></div>
    </div>
    <button class="btn btn-primary chx-ready" id="lbReady">Ready</button>
    ${isCreator(c) && c.startNow ? `<button class="btn btn-ghost" id="lbStart" disabled>${icons.flag} Start the race now</button>` : ''}
    <p class="muted small chx-rules" id="lbRules">${c.startNow
      ? `${icons.flag} Starts when every registered rider is here and ready (at least 2)${isCreator(c) ? ', or when you press Start' : ', or when the creator starts it'}.`
      : `${icons.clock} At ${esc(atText(c.startsAt))}, every rider who is here and ready starts together. Riders who aren't ready miss the race.`}
      Stay on this screen until the start.</p>
  `, leave, 'chx-screen');
  const $ = (id: string) => h.app.querySelector<HTMLElement>('#' + id);
  const root = $('lbRiders')!;
  const net = $('lbNet')!;

  const loadEntries = async () => {
    if (c.official || !api.online()) return;
    const r = await api.entries(c.id);
    if (r.ok) { entries = r.data; draw(); }
  };
  void loadEntries();

  const readyGroup = () => {
    const peers = lobby.peers().map((x) => x.state as LobbyState).filter((s) => s?.ready);
    return [...(state.ready ? [state] : []), ...peers].sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  const draw = () => {
    if (!root.isConnected) return;
    const peers = new Map(lobby.peers().map((x) => [x.key, x.state as LobbyState]));
    const rows: { s: LobbyState | api.Entry; here: boolean; ready: boolean; me: boolean }[] = [{ s: state, here: true, ready: state.ready, me: true }];
    for (const [k, s] of peers) if (k !== me && s?.name) rows.push({ s, here: true, ready: !!s.ready, me: false });
    for (const e of entries) if (e.id !== me && !peers.has(e.id)) rows.push({ s: e, here: false, ready: false, me: false });
    rows.sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.here) - Number(a.here));
    root.innerHTML = rows.map((r, i) => riderRow({ ...(r.s as LobbyState), me: r.me }, `<span class="chx-rd ${r.ready ? 'on' : r.here ? '' : 'away'}">${r.ready ? `${icons.check} Ready` : r.here ? 'Not ready' : 'Not here yet'}</span>`).replace('<span class="chx-av"', `<span class="chx-pos">${i + 1}</span><span class="chx-av"`)).join('');
    const ready = rows.filter((r) => r.ready).length;
    $('lbCount')!.textContent = `${ready} of ${rows.length} ready`;
    const startBtn = h.app.querySelector<HTMLButtonElement>('#lbStart');
    if (startBtn) startBtn.disabled = ready < 2 || started || lobby === offline;
  };

  // the live channel; tries again every few seconds while offline
  const connect = async () => {
    const ch = await live.join(`chal:${c.id}`, me, { ...state });
    if (leaving || started) { ch?.leave(); return; }
    if (!ch) {
      net.className = 'chx-net small bad';
      net.innerHTML = `${icons.wifiOff} Can't reach the live lobby. Check your connection; trying again…`;
      retry = window.setTimeout(() => void connect(), 8000);
      return;
    }
    lobby = ch;
    net.className = 'chx-net small ok';
    net.innerHTML = `<i class="dot live"></i> Live lobby: riders here see you${state.ready ? ' as ready' : ''}.`;
    ch.on('go', (m: GoMsg) => begin(m));
    ch.onPeers(() => { draw(); void loadEntries(); });
    draw();
  };

  const readyBtn = h.app.querySelector<HTMLButtonElement>('#lbReady')!;
  const setReady = (on: boolean) => {
    state.ready = on;
    lobby.track({ ...state });
    readyBtn.classList.toggle('on', on);
    readyBtn.innerHTML = on ? `${icons.check} Ready · tap to undo` : 'Ready';
    draw();
  };
  readyBtn.addEventListener('click', () => setReady(!state.ready));

  // the start
  const begin = (m: GoMsg) => {
    if (started || !m.riders.some((r) => r.id === me)) return;
    started = true;
    clearInterval(timer);
    readyBtn.disabled = true;
    const others = m.riders.filter((r) => r.id !== me);
    const clock = $('lbClock')!;
    clock.className = 'chx-lobby-clock go';
    clock.innerHTML = `<small>${others.length + 1 === readyGroup().length ? 'All riders ready' : 'Starting'}</small><b>GET READY</b>`;
    setTimeout(() => void rideChallenge(c, { ch: lobby, kind: 'race', riders: others }), Math.max(800, Math.min(4000, m.at - Date.now())));
  };
  const sendGo = () => {
    const group = readyGroup();
    if (group.length < 2) return false;
    const m: GoMsg = { riders: group.map((g) => ({ id: g.id, name: g.name, jersey: g.jersey })), at: Date.now() + 2500 };
    lobby.send('go', m as unknown as Record<string, unknown>);
    begin(m);
    return true;
  };
  on('#lbStart', 'click', () => {
    if (sendGo()) void api.startNow(c.id);
  });

  const soloOffer = (why: string) => {
    if (soloOffered) return;
    soloOffered = true;
    const clock = $('lbClock')!;
    clock.className = 'chx-lobby-clock';
    clock.innerHTML = `<small>${why}</small><b>Ride it on your own?</b><span>Your time still goes on the leaderboard.</span><button class="btn btn-primary btn-sm" id="lbSolo">${icons.bike} Ride solo</button>`;
    on('#lbSolo', 'click', () => { started = true; clearInterval(timer); lobby.leave(); void rideChallenge(c); });
  };

  const tick = () => {
    if (!root.isConnected) { if (!started) { clearInterval(timer); clearTimeout(retry); leaving = true; lobby.leave(); } return; }
    if (started || soloOffered) return;
    const now = Date.now();
    const clock = $('lbClock')!;
    const ph = phaseOf(c, now);
    if (ph === 'ended' || ph === 'cancelled') {
      clock.className = 'chx-lobby-clock';
      clock.innerHTML = `<small>${ph === 'cancelled' ? 'Cancelled' : 'Ended'}</small><b>This race is over</b>`;
      readyBtn.disabled = true;
      return;
    }
    if (c.startNow) {
      const group = readyGroup();
      const registered = Math.max(entries.length, group.length);
      clock.className = 'chx-lobby-clock soon';
      clock.innerHTML = `<small>Start now</small><b>${group.length >= 2 && group.length >= registered ? 'All riders ready' : 'Waiting for riders'}</b><span>${group.length} ready${entries.length ? ` of ${entries.length} registered` : ''}</span>`;
      // everyone registered is here and ready: the first of them starts it
      if (group.length >= 2 && group.length >= registered && group[0].id === me) sendGo();
      return;
    }
    const ms = c.startsAt - now;
    if (ms > 0) {
      const s = Math.ceil(ms / 1000);
      clock.className = `chx-lobby-clock${s <= 60 ? ' final' : ' soon'}`;
      clock.innerHTML = s <= 60
        ? `<small>Starts in</small><b>${s}</b><span>seconds${state.ready ? '' : ' · press Ready!'}</span>`
        : `<small>Starts in</small><b>${countdown(ms)}</b><span>${s <= 300 ? `Starts in ${Math.ceil(s / 60)} minutes` : esc(whenText(c.startsAt))}</span>`;
      return;
    }
    // start time: the ready rider whose id sorts first starts everyone
    clock.className = 'chx-lobby-clock final';
    clock.innerHTML = '<small>Starting…</small><b>GO TIME</b>';
    if (!state.ready) {
      if (ms < -GO_WAIT) { clock.innerHTML = '<small>The race has started</small><b>You weren\'t ready</b><span>Check the leaderboard when it ends.</span>'; readyBtn.disabled = true; clearInterval(timer); }
      return;
    }
    const group = readyGroup();
    if (group[0]?.id === me) {
      // a few seconds' grace for late Ready taps
      if (!sendGo() && ms < -5000) soloOffer('Nobody else is ready');
    } else if (ms < -GO_WAIT) soloOffer("The race didn't start");
  };
  timer = window.setInterval(tick, 500);
  tick();
  draw();
  void connect();
}
