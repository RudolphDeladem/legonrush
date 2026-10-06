// Dating: strictly opt-in and 18+ (from the rider's date of birth). Only riders who switched it
// on see each other, a like stays private until it's mutual, and only then can they message or
// start a Date vibe ride. Minimal info is shown: first name, age, interests, hall if they show it.
import { saveProfile, type Gender } from '../../state';
import { fx } from '../icons';
import { H, esc, screen } from '../host';
import * as vb from '../vibe';
import * as api from './api';
import { changed, remember, social, syncNow } from './local';
import type { Card, DatingCard } from './model';
import { chatWith } from './chat';
import { inviteToRide, reportSheet } from './people';
import { act, avatar, bindSignIn, ci, empty, hallName, loading, problemBox, sheet, sheetHead, toast } from './ui';

export const INTERESTS = ['Cycling', 'Music', 'Gaming', 'Sports', 'Events', 'Exploring campus', 'Food', 'Movies', 'Fashion', 'Faith', 'Tech', 'Books'];
const back = () => H().home('social');

export function datingScreen(from: () => void = back, tab: 'discover' | 'matches' = 'discover') {
  const p = H().profile();
  const s = social(p);
  const check = vb.dateCheck(p);
  const head = `<div class="cm-head cm-date-head"><span class="cm-head-ico">${ci.heart}</span><div><h1 class="title">Dating</h1><p class="muted">Meet someone on campus, at your pace.</p></div>${s.dating.on && check === 'ok' ? `<button class="icon-btn cm-mini" id="cmDateSet" aria-label="Dating settings">${ci.gear}</button>` : ''}</div>`;
  if (check === 'young') {
    screen(`${head}${empty(ci.lock, 'Dating is for riders 18 and over', 'You can still make friends, find riding buddies and join crews.')}`, from, 'cm-screen cm-date');
    return;
  }
  if (!api.signedIn()) {
    screen(`${head}${empty(ci.heart, 'Sign in to use Dating', 'Dating needs an account so everyone stays accountable. It stays off until you switch it on.', '<button class="btn btn-primary btn-sm" data-cm-signin>Sign in</button>')}`, from, 'cm-screen cm-date');
    bindSignIn(H().app);
    return;
  }
  if (check === 'unknown' || !s.dating.on) return optIn(from, head);
  screen(`${head}
    <div class="seg wide cm-tabs"><button data-tab="discover" class="${tab === 'discover' ? 'on' : ''}">Discover</button><button data-tab="matches" class="${tab === 'matches' ? 'on' : ''}">Connections</button></div>
    <p class="cm-safety-tip">${fx.shield} ${vb.SAFETY_TIP} Likes stay private until you both connect.</p>
    <div id="cmDate"></div>`, from, 'cm-screen cm-date');
  const app = H().app;
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => datingScreen(from, b.dataset.tab as 'discover' | 'matches')));
  app.querySelector('#cmDateSet')?.addEventListener('click', () => prefsSheet(() => datingScreen(from, tab)));
  const box = app.querySelector<HTMLElement>('#cmDate')!;
  void syncNow(p).then(() => (tab === 'discover' ? discover(box, from) : matches(box, from)));
}

/** explain, ask for the birthday if needed, choose preferences, switch it on */
function optIn(from: () => void, head: string) {
  const p = H().profile();
  const s = social(p);
  const check = vb.dateCheck(p);
  const prefs = vb.loadPrefs(p);
  const genders: Gender[] = s.dating.genders.length ? [...s.dating.genders] : prefs.who === 'anyone' ? [] : [prefs.who];
  const interests = new Set(s.dating.interests);
  let min = s.dating.ageMin, max = s.dating.ageMax;
  const ages = Array.from({ length: 23 }, (_, i) => 18 + i);
  screen(`${head}
    <div class="card stack cm-date-intro">
      <b>${ci.heart} How Dating works here</b>
      <ul class="cm-points">
        <li>${ci.check} It's off until you switch it on, and you can switch it off any time.</li>
        <li>${ci.check} Only riders aged 18+ who also switched it on can see you.</li>
        <li>${ci.check} Others see just your first name, age, interests and hall (if you show it).</li>
        <li>${ci.check} Likes are private. You can only message once you both connect.</li>
        <li>${ci.check} Block, report or unmatch anyone, any time.</li>
      </ul>
    </div>
    ${check === 'unknown' ? `<form class="card stack" id="cmDob"><b>Your date of birth</b><p class="muted small">Asked once to confirm you're 18+. Never shown to anyone.</p><div class="row"><input class="cm-input" id="cmDobIn" type="date" max="${new Date().toISOString().slice(0, 10)}" required><button class="btn btn-ghost btn-sm">Save</button></div><p class="cm-err" hidden></p></form>` : `
    <div class="card stack cm-form">
      <b class="cm-label">I'd like to meet</b>
      <div class="seg wide" id="cmGen"><button data-v="female" class="${genders.length === 1 && genders[0] === 'female' ? 'on' : ''}">Women</button><button data-v="male" class="${genders.length === 1 && genders[0] === 'male' ? 'on' : ''}">Men</button><button data-v="any" class="${genders.length !== 1 ? 'on' : ''}">Both</button></div>
      <b class="cm-label">Age range</b>
      <div class="row cm-ages"><select class="cm-input" id="cmMin">${ages.map((a) => `<option ${a === min ? 'selected' : ''}>${a}</option>`).join('')}</select><span>to</span><select class="cm-input" id="cmMax">${ages.map((a) => `<option ${a === max ? 'selected' : ''} value="${a}">${a === 40 ? '40+' : a}</option>`).join('')}</select></div>
      <b class="cm-label">Interests <small class="muted">(up to 6)</small></b>
      <div class="cm-chips" id="cmInt">${INTERESTS.map((x) => `<button class="chip-btn${interests.has(x) ? ' on' : ''}" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <label class="cm-check"><input type="checkbox" id="cmShowStatus" checked> Show "Open to dating" on my profile (only to other Dating riders)</label>
      <button class="btn btn-primary" id="cmDateOn">${ci.heart} ${s.dating.on ? 'Save preferences' : 'Turn on Dating'}</button>
    </div>`}`, from, 'cm-screen cm-date');
  const app = H().app;
  app.querySelector('#cmDob')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = app.querySelector<HTMLInputElement>('#cmDobIn')!.value;
    const age = vb.ageOf(v);
    const note = app.querySelector<HTMLElement>('#cmDob .cm-err')!;
    if (age === null || age < 5) { note.hidden = false; note.textContent = 'Enter your real date of birth.'; return; }
    p.about.dob = v;
    saveProfile(p);
    changed(p);
    datingScreen(from);
  });
  app.querySelectorAll<HTMLElement>('#cmGen button').forEach((b) => b.addEventListener('click', () => {
    genders.splice(0, genders.length, ...(b.dataset.v === 'any' ? [] : [b.dataset.v as Gender]));
    app.querySelectorAll('#cmGen button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  app.querySelectorAll<HTMLElement>('#cmInt button').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v!;
    if (interests.has(v)) interests.delete(v); else if (interests.size < 6) interests.add(v);
    b.classList.toggle('on', interests.has(v));
  }));
  app.querySelector('#cmMin')?.addEventListener('change', (e) => { min = Number((e.target as HTMLSelectElement).value); });
  app.querySelector('#cmMax')?.addEventListener('change', (e) => { max = Number((e.target as HTMLSelectElement).value); });
  app.querySelector('#cmDateOn')?.addEventListener('click', async (e) => {
    if (min > max) [min, max] = [max, min];
    s.dating = { on: true, ageMin: min, ageMax: max === 40 ? 99 : max, genders: [...genders], interests: [...interests] };
    const show = app.querySelector<HTMLInputElement>('#cmShowStatus')!.checked;
    if (show && !s.statuses.includes('dating')) s.statuses = [...s.statuses.filter((x) => x !== 'none'), 'dating'];
    (e.currentTarget as HTMLButtonElement).disabled = true;
    changed(p);
    await syncNow(p);
    if (!social(p).dating.on) { toast(`${fx.info} Dating couldn't be switched on. Check your date of birth.`); return datingScreen(from); }
    toast(`${ci.heart} Dating is on. Only other Dating riders can see you.`);
    datingScreen(from);
  });
}

async function discover(box: HTMLElement, from: () => void) {
  box.innerHTML = loading(2);
  let list: DatingCard[];
  try { list = await api.datingDiscover(); } catch (e) { box.innerHTML = problemBox(e, 'cmRetry'); bindSignIn(box); box.querySelector('#cmRetry')?.addEventListener('click', () => void discover(box, from)); return; }
  const show = () => {
    const d = list[0];
    if (!d) { box.innerHTML = empty(ci.heart, "You're all caught up", 'New people show up here as more riders switch Dating on. Try widening your age range.', '<button class="btn btn-ghost btn-sm" id="cmDatePrefs">Change preferences</button>'); box.querySelector('#cmDatePrefs')?.addEventListener('click', () => prefsSheet(() => datingScreen(from))); return; }
    const shared = new Set(d.shared ?? []);
    box.innerHTML = `<div class="cm-date-card">
      ${avatar({ name: d.name, hall: d.hall }, 'lg')}
      <h2>${esc(d.name)}${d.age ? `, ${d.age}` : ''}</h2>
      <p class="muted">${[d.level ? `Level ${d.level}` : '', esc(hallName(d.hall))].filter(Boolean).join(' · ')}</p>
      ${d.interests?.length ? `<div class="cm-chips center">${d.interests.map((x) => `<span class="cm-tag${shared.has(x) ? ' shared' : ''}">${esc(x)}</span>`).join('')}</div>` : ''}
      ${shared.size ? `<p class="cm-reason">${ci.sparkle} You both like ${[...shared].map(esc).join(', ')}</p>` : ''}
      <div class="cm-date-acts">
        <button class="btn btn-ghost" id="cmPass">${ci.x} Pass</button>
        <button class="btn btn-primary" id="cmLike">${ci.heart} Connect</button>
      </div>
      <button class="btn btn-link small" id="cmDateRep">${ci.flag} Report</button>
    </div>`;
    box.querySelector('#cmPass')!.addEventListener('click', async (e) => { if ((await act(e.currentTarget as HTMLElement, () => api.datingAnswer(d.id, 'pass'))) !== undefined) { list.shift(); show(); } });
    box.querySelector('#cmLike')!.addEventListener('click', async (e) => {
      const r = await act(e.currentTarget as HTMLElement, () => api.datingAnswer(d.id, 'like'));
      if (!r) return;
      list.shift();
      if (r === 'match') matched(d, from); else toast(`${ci.heart} Sent. If ${esc(d.name)} connects too, you'll both be told.`);
      show();
    });
    box.querySelector('#cmDateRep')!.addEventListener('click', () => reportSheet({ id: d.id, name: d.name }, 'user', null, { where: 'dating' }));
  };
  show();
}

function matched(d: DatingCard, from: () => void) {
  remember({});
  const s = sheet(`<div class="cm-match">${ci.heart}<h2>You and ${esc(d.name)} connected</h2><p class="muted">You can message each other now, or start a Date vibe ride.</p>
    <button class="btn btn-primary" id="cmMsg">${ci.chat} Say hi</button><button class="btn btn-ghost" id="cmRide">${ci.bike} Invite to Vibe Ride</button><button class="btn btn-link" data-close>Later</button></div>`, 'cm-match-sheet');
  const c = { id: d.id, name: d.name, hall: d.hall } as Card;
  s.el.querySelector('#cmMsg')!.addEventListener('click', () => { s.close(); void chatWith(c, () => datingScreen(from, 'matches')); });
  s.el.querySelector('#cmRide')!.addEventListener('click', () => { s.close(); void inviteToRide(c); });
}

async function matches(box: HTMLElement, from: () => void) {
  box.innerHTML = loading(3);
  try {
    const list = await api.datingMatches();
    remember({ matches: list.map((m) => m.id) });
    box.innerHTML = list.length ? list.map((d) => `<div class="cm-person" data-id="${esc(d.id)}">${avatar({ name: d.name, hall: d.hall })}<span class="cm-p-main"><b>${esc(d.name)}${d.age ? `, ${d.age}` : ''}</b><small>${(d.interests ?? []).slice(0, 3).map(esc).join(' · ')}</small></span>
      <span class="cm-row-acts"><button class="icon-btn cm-mini" data-msg="${esc(d.id)}" aria-label="Message">${ci.chat}</button><button class="icon-btn cm-mini" data-ride="${esc(d.id)}" aria-label="Vibe Ride">${ci.bike}</button><button class="icon-btn cm-mini" data-more="${esc(d.id)}" aria-label="More">${ci.more}</button></span></div>`).join('')
      : empty(ci.heart, 'No connections yet', 'When you and someone both tap Connect, they show up here.');
    const find = (id: string) => list.find((x) => x.id === id)!;
    box.querySelectorAll<HTMLElement>('[data-msg]').forEach((b) => b.addEventListener('click', () => { const d = find(b.dataset.msg!); void chatWith({ id: d.id, name: d.name, hall: d.hall } as Card, () => datingScreen(from, 'matches')); }));
    box.querySelectorAll<HTMLElement>('[data-ride]').forEach((b) => b.addEventListener('click', () => { const d = find(b.dataset.ride!); void inviteToRide({ id: d.id, name: d.name }); }));
    box.querySelectorAll<HTMLElement>('[data-more]').forEach((b) => b.addEventListener('click', () => {
      const d = find(b.dataset.more!);
      const s = sheet(`${sheetHead(esc(d.name))}<button class="btn btn-ghost" data-a="unmatch">${ci.x} Unmatch</button><button class="btn btn-ghost" data-a="report">${ci.flag} Report</button><button class="btn btn-ghost cm-danger" data-a="block">${ci.block} Block</button>`);
      s.el.querySelectorAll<HTMLElement>('[data-a]').forEach((x) => x.addEventListener('click', async () => {
        const a = x.dataset.a;
        if (a === 'report') { s.close(); return reportSheet({ id: d.id, name: d.name }, 'user', null, { where: 'dating' }); }
        if (a === 'block') { vb.block(d.id, d.name); if ((await act(x, () => api.toggle(d.id, 'block', true))) !== undefined) { s.close(); void matches(box, from); } }
        if (a === 'unmatch' && (await act(x, () => api.datingAnswer(d.id, 'unmatch'))) !== undefined) { s.close(); void matches(box, from); }
      }));
    }));
  } catch (e) {
    box.innerHTML = problemBox(e);
  }
}

/** change dating preferences, or switch dating off */
export function prefsSheet(done: () => void) {
  const p = H().profile();
  const s = social(p);
  const sh = sheet(`${sheetHead(`${ci.heart} Dating settings`)}
    <p class="muted small">Interested in: <b>${s.dating.genders.length === 1 ? (s.dating.genders[0] === 'female' ? 'Women' : 'Men') : 'Both'}</b> · Ages <b>${s.dating.ageMin}–${s.dating.ageMax >= 99 ? '40+' : s.dating.ageMax}</b></p>
    <button class="btn btn-ghost" data-a="edit">${ci.edit} Change preferences</button>
    <button class="btn btn-ghost cm-danger" data-a="off">${ci.moon} Turn off Dating</button>
    <p class="muted small">Turning it off hides you from Dating straight away. Your connections stay until you unmatch.</p>`);
  sh.el.querySelector('[data-a="edit"]')!.addEventListener('click', () => { sh.close(); optIn(done, `<div class="cm-head"><span class="cm-head-ico">${ci.heart}</span><div><h1 class="title">Dating preferences</h1></div></div>`); });
  sh.el.querySelector('[data-a="off"]')!.addEventListener('click', async () => {
    s.dating.on = false;
    s.statuses = s.statuses.filter((x) => x !== 'dating');
    changed(p);
    await syncNow(p);
    sh.close();
    toast(`${ci.moon} Dating is off. You're hidden from Dating.`);
    done();
  });
}
