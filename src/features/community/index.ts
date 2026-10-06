// Community: the social layer of LEGONRUSH. The tab lives in src/tabs/community.ts; this file
// starts the background parts (activity sender, live notifications, map pins) and holds the
// small hooks main.ts calls (presence privacy, Vibe Ride invite privacy, riders you rode with).
import type { Profile } from '../../state';
import { showSystem } from '../notify';
import { registerPinSource, type Pin } from '../pins';
import { H, esc } from '../host';
import * as api from './api';
import { chatWith } from './chat';
import { flushActivity, startActivity } from './feed';
import { isFriend, rodeWith as rodeLocal, social } from './local';
import { notifIcon, openNotification } from './home';
import { openPerson, setOpenChat } from './people';
import { onlineNow } from './presence';
import { ci, toast } from './ui';
import './community.css';

export { maskPresence } from './presence';
export { allowVibeInvite } from './local';
export { registerCrewAction } from './crews';
export { setChallengeHook } from './people';
export { render, bind } from './home';

let started = false;
/** call once at start-up */
export function initCommunity() {
  if (started) return;
  started = true;
  startActivity();
  setOpenChat((c) => void chatWith(c));

  // riders who chose "show me on map", where they are riding now; friends get their own pin
  registerPinSource('community', () => onlineNow()
    .filter((o) => o.state.map && o.state.place)
    .map((o): Pin => ({
      id: `cm-${o.key}`, kind: isFriend(o.key) ? 'friend' : 'rider', place: String(o.state.place), live: true,
      title: o.state.name, sub: `${isFriend(o.key) ? 'Friend · ' : ''}Riding to ${o.state.place}`,
      open: () => void openPerson(o.key, { id: o.key, name: o.state.name, hall: o.state.hall, level: o.state.level }),
    })));

  // live notifications and messages, wherever the rider is in the app
  api.onLive((e) => {
    let p: Profile;
    try { p = H().profile(); } catch { return; }
    const notify = social(p).notify;
    if (e.type === 'notification') {
      const n = e.n;
      // Vibe Ride invites use the app's own invite card (Accept / Not now)
      if (n.kind === 'vibe_invite' && n.ref && n.actor) {
        if (notify.vibe) H().vibe.notice(n.ref, { id: n.actor, name: n.text.replace(/ wants to ride with you$/, ''), hall: 'none' });
        return;
      }
      const group = n.kind.startsWith('friend') || n.kind === 'follow' ? 'friends' : n.kind.startsWith('crew') ? 'crews' : n.kind.startsWith('dating') ? 'dating' : n.kind === 'react' ? 'feed' : null;
      if (group && !notify[group]) return;
      toast(`${notifIcon(n)} ${esc(n.text)}`, [['Open', () => openNotification(n), true]]);
      if (document.hidden) showSystem({ id: `cm-${n.id}`, title: 'LEGONRUSH', body: n.text, at: Date.now() });
    }
    if (e.type === 'message' && e.msg.sender !== api.myId() && notify.messages) {
      // the open chat shows it already
      if (H().app.querySelector('.cm-chat-screen')) return;
      toast(`${ci.chat} New message: ${esc(e.msg.text.slice(0, 60))}`, [['Open', async () => (await import('./chat')).chatsScreen(), true]], 8000);
      if (document.hidden) showSystem({ id: `cm-m-${e.msg.id}`, title: 'New message on LEGONRUSH', body: e.msg.text.slice(0, 80), at: Date.now() });
    }
  });

  // signed in: connect live updates and send any activity that waited
  const kick = () => { if (api.signedIn()) { void api.connectLive(); void flushActivity(); } };
  setTimeout(kick, 4000);
  setTimeout(kick, 15000);
  addEventListener('online', kick);
}

/** main.ts: after a Vibe Ride with someone (for "You rode together" and the Riding buddies badge) */
export function rodeWith(p: Profile, partnerId: string) {
  rodeLocal(p, partnerId);
  if (api.signedIn() && /^[0-9a-f-]{36}$/.test(partnerId)) void api.rodeWith(partnerId).catch(() => undefined);
}
