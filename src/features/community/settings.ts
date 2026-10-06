// Social status, privacy, notification choices and the blocked list. Saved on the phone (in the
// profile) and on the server, whose functions apply them to every list, search and message.
import { fx } from '../icons';
import { H, esc, screen } from '../host';
import * as vb from '../vibe';
import * as api from './api';
import { changed, social } from './local';
import type { NotifyGroup, Privacy, SocialStatus } from './model';
import { blockedList } from './people';
import { STATUSES, ci, sheet, sheetHead, toast } from './ui';

/** pick your statuses (several can go together; Not looking clears the rest) */
export function statusSheet(done: () => void) {
  const p = H().profile();
  const s = social(p);
  const picked = new Set<SocialStatus>(s.statuses);
  const adult = vb.dateCheck(p) === 'ok';
  const sh = sheet(`${sheetHead('Your social status')}
    <p class="muted small">Tell riders what kind of connection you're open to. You can pick more than one.</p>
    <div class="cm-status-pick">${STATUSES.map(([id, ico, label, text]) => {
      const off = id === 'dating' && !adult;
      return `<button class="cm-status-opt ${id}${picked.has(id) ? ' on' : ''}" data-s="${id}" ${off ? 'disabled' : ''}><span class="cm-st-ico">${ico}</span><span><b>${label}</b><small>${off ? 'For riders 18+. Add your birthday in Dating.' : text}</small></span><i class="cm-tick">${ci.check}</i></button>`;
    }).join('')}</div>
    <label class="cm-switch"><span><b>Show my status</b><small>Off: you can still use Community, but your status isn't shown and you're not listed in Find your people.</small></span><input type="checkbox" id="cmShowSt" ${s.showStatus ? 'checked' : ''}><i></i></label>
    <button class="btn btn-primary" id="cmStSave">Save</button>`);
  sh.el.querySelectorAll<HTMLElement>('[data-s]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.s as SocialStatus;
    if (picked.has(id)) picked.delete(id);
    else {
      if (id === 'none') picked.clear(); else picked.delete('none');
      picked.add(id);
    }
    sh.el.querySelectorAll<HTMLElement>('[data-s]').forEach((x) => x.classList.toggle('on', picked.has(x.dataset.s as SocialStatus)));
  }));
  sh.el.querySelector('#cmStSave')!.addEventListener('click', () => {
    // Dating status only goes with Dating switched on: send them there to set it up
    if (picked.has('dating') && !s.dating.on) {
      picked.delete('dating');
      toast(`${ci.heart} Turn on Dating first to show you're open to it`, [['Set up Dating', async () => (await import('./dating')).datingScreen(), true]]);
    }
    s.statuses = [...picked];
    s.showStatus = sh.el.querySelector<HTMLInputElement>('#cmShowSt')!.checked;
    changed(p);
    sh.close();
    done();
  });
}

const seg = <T extends string>(key: string, opts: [T, string][], value: T) =>
  `<div class="seg wide cm-seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const sw = (key: string, title: string, text: string, on: boolean) =>
  `<label class="cm-switch"><span><b>${title}</b><small>${text}</small></span><input type="checkbox" data-sw="${key}" ${on ? 'checked' : ''}><i></i></label>`;

export function privacyScreen(from: () => void = () => H().home('social')) {
  const p = H().profile();
  const s = social(p);
  const pr = s.privacy;
  const levels = ['', '100', '200', '300', '400', '500', '600'];
  screen(`
    <div class="cm-head"><span class="cm-head-ico">${ci.shield}</span><div><h1 class="title">Privacy &amp; safety</h1><p class="muted">You decide who finds you and what they see. These apply everywhere in LEGONRUSH.</p></div></div>
    ${api.signedIn() ? '' : `<div class="cm-note">${fx.info}<span>You're playing as a guest. These choices are saved on this phone and apply to Riders Online.</span></div>`}
    <section class="card stack cm-form">
      <b class="cm-label">Who can find me?</b>
      ${seg<Privacy['findMe']>('findMe', [['everyone', 'Everyone'], ['fof', 'Friends of friends'], ['hall', 'Same hall'], ['course', 'Same course'], ['nobody', 'Nobody']], pr.findMe)}
      <b class="cm-label">Who can message me?</b>
      ${seg<Privacy['messageMe']>('messageMe', [['everyone', 'Everyone'], ['friends', 'Friends'], ['connections', 'Connections'], ['nobody', 'Nobody']], pr.messageMe)}
      <p class="muted small">Connections: friends, crew mates and Dating connections.</p>
      <b class="cm-label">Who can send me friend requests?</b>
      ${seg<Privacy['requests']>('requests', [['everyone', 'Everyone'], ['shared', 'Shared connections'], ['nobody', 'Nobody']], pr.requests)}
      <b class="cm-label">Who sees my game activity?</b>
      ${seg<Privacy['activity']>('activity', [['everyone', 'Everyone'], ['friends', 'Friends'], ['off', 'Nobody']], pr.activity)}
    </section>
    <section class="card stack cm-form">
      ${sw('showOnline', 'Show online status', 'Appear in Riders Online and as online to friends.', pr.showOnline)}
      ${sw('showHall', 'Show my hall', 'Your hall on your profile, hall mates and leaderboards.', pr.showHall)}
      ${sw('showCourse', 'Show my course', 'Your programme on your profile and course mates.', pr.showCourse)}
      ${sw('showStatus', 'Show my social status', 'Friends, riding buddies, competition… on your profile.', s.showStatus)}
      ${sw('showMap', 'Show me on the map', 'While you ride, others can see roughly where on campus.', pr.showMap)}
      ${sw('showLevel', 'Show my academic level', 'Optional: lets level mates on your course find you.', pr.showLevel)}
      <div class="cm-level-row" ${pr.showLevel ? '' : 'hidden'}><label class="cm-label" for="cmLevel">My level</label><select class="cm-input" id="cmLevel">${levels.map((l) => `<option value="${l}" ${l === s.level ? 'selected' : ''}>${l ? `Level ${l}` : 'Not set'}</option>`).join('')}</select></div>
    </section>
    <section class="card stack cm-form">
      <b class="cm-label">${ci.bell} Notifications</b>
      ${(([['friends', 'Friends', 'Requests, accepts and follows'], ['messages', 'Messages', 'New private and crew messages'], ['crews', 'Crews', 'Join requests and crew news'], ['dating', 'Dating', 'New connections'], ['feed', 'Reactions', 'When someone reacts to your post']]) as [NotifyGroup, string, string][]).map(([k, t, x]) => sw(`n:${k}`, t, x, s.notify[k])).join('')}
    </section>
    <section class="card stack cm-form">
      <b class="cm-label">${ci.block} Blocked riders</b>
      <p class="muted small">Blocked riders can't find you, message you, invite you or see your posts.</p>
      <div id="cmBlocked" class="cm-list"></div>
    </section>
    <p class="muted small">${fx.shield} ${esc(vb.SAFETY_TIP)} To report someone, open their profile and tap Report.</p>`, from, 'cm-screen');
  const app = H().app;
  app.querySelectorAll<HTMLElement>('.cm-seg').forEach((g) => g.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => {
    (pr as unknown as Record<string, string>)[g.dataset.key!] = b.dataset.v!;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    changed(p);
  })));
  app.querySelectorAll<HTMLInputElement>('[data-sw]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.sw!;
    if (k.startsWith('n:')) s.notify[k.slice(2) as NotifyGroup] = el.checked;
    else if (k === 'showStatus') s.showStatus = el.checked;
    else (pr as unknown as Record<string, boolean>)[k] = el.checked;
    if (k === 'showLevel') app.querySelector<HTMLElement>('.cm-level-row')!.hidden = !el.checked;
    changed(p);
  }));
  app.querySelector('#cmLevel')?.addEventListener('change', (e) => { s.level = (e.target as HTMLSelectElement).value; changed(p); });
  void blockedList(app.querySelector<HTMLElement>('#cmBlocked')!);
}
