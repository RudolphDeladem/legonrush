// Vibe Ride extras: match preferences, safety (Date vibe age gate, block, report, chat filter),
// the warmer chat (icebreakers, sweet replies, gifts) and the ride memory card.
// main.ts owns the live channels and the room; this file holds the rules and the pieces it draws.
import { saveProfile, type Gender, type Profile, type RiderType } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { H, esc, on, screen } from './host';
import { HALLS } from '../data/campus';
import { DEPARTMENTS } from '../data/departments';
import './vibe.css';

// ---------- preferences ----------

export type VibeWho = 'anyone' | 'male' | 'female' | 'other';
/** what the ride is for; 'any' lets the system find someone faster */
export type VibeMood = 'any' | 'ride' | 'friends' | 'social' | 'date';
export interface VibePrefs {
  who: VibeWho;
  /** a hall id, or 'any' */
  hall: string;
  /** a department name, or 'any' */
  dept: string;
  mood: VibeMood;
}

const PREFS_KEY = 'legonrush.vibeprefs.v2';
const DEFAULT_PREFS: VibePrefs = { who: 'anyone', hall: 'any', dept: 'any', mood: 'any' };

export const WHO_OPTS: [VibeWho, string][] = [['anyone', 'Any'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other / Prefer not to say']];
export const MOODS: [VibeMood, string, string, string][] = [
  ['any', icons.sparkle, 'Any', 'Find someone faster.'],
  ['ride', icons.bike, 'Just Ride', 'Easy company, no pressure.'],
  ['friends', fx.friends, 'Make Friends', 'Chat and meet someone new.'],
  ['social', icons.chat, 'Social', 'Hang out and talk while you ride.'],
  ['date', icons.heart, 'Dating', '18+ only. Matches other Dating riders.'],
];
export const MOOD_LINE: Record<VibeMood, string> = { any: 'Open to anything', ride: 'Here to just ride', friends: 'Here to make friends', social: 'Here to socialise', date: 'Here for dating' };
const RIDER_TYPE: Record<RiderType, string> = { racer: 'Racer', explorer: 'Explorer', social: 'Social Rider', speedster: 'Speedster', chill: 'Chill Rider' };
export const riderTypeName = (t?: RiderType | '') => (t ? RIDER_TYPE[t] : 'Rider');

/** the last choice on this phone; Dating falls back to Any if the rider can't pick it */
export function loadPrefs(p?: Profile): VibePrefs {
  let v: Partial<VibePrefs> = {};
  try { v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; } catch { /* private mode */ }
  const prefs: VibePrefs = {
    who: WHO_OPTS.some(([w]) => w === v.who) ? v.who! : DEFAULT_PREFS.who,
    hall: typeof v.hall === 'string' && v.hall ? v.hall : 'any',
    dept: typeof v.dept === 'string' && v.dept ? v.dept : 'any',
    mood: MOODS.some(([m]) => m === v.mood) ? v.mood! : DEFAULT_PREFS.mood,
  };
  if (prefs.mood === 'date' && p && dateCheck(p) !== 'ok') prefs.mood = 'any';
  return prefs;
}

export function savePrefs(prefs: VibePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

export function prefsSummary(prefs: VibePrefs, hallName: (id: string) => string = (x) => x) {
  return [
    prefs.who === 'anyone' ? 'Anyone' : WHO_OPTS.find((w) => w[0] === prefs.who)![1],
    prefs.hall === 'any' ? '' : hallName(prefs.hall),
    prefs.dept === 'any' ? '' : prefs.dept,
    MOODS.find((m) => m[0] === prefs.mood)![2],
  ].filter(Boolean).join(' · ');
}

// ---------- age ----------

/** whole years since a YYYY-MM-DD birthday, or null if it isn't one */
export function ageOf(dob: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age >= 0 && age < 120 ? age : null;
}

/** can this rider pick Dating: 18 or over, under 18, or no birthday yet */
export function dateCheck(p: Profile): 'ok' | 'young' | 'unknown' {
  const age = ageOf(p.about.dob);
  return age === null ? 'unknown' : age >= 18 ? 'ok' : 'young';
}

// ---------- matching ----------

/** what riders looking for a Vibe Ride share in the lobby */
export interface Seeker {
  id: string;
  hall: string;
  department: string;
  gender?: Gender;
  riderType?: RiderType | '';
  who?: VibeWho;
  /** the hall and department they want, or 'any' */
  wantHall?: string;
  wantDept?: string;
  mood?: VibeMood;
}

/** does a's filter let b through */
function accepts(a: Seeker, b: Seeker) {
  const who = a.who ?? 'anyone';
  if (who === 'other' ? b.gender === 'male' || b.gender === 'female' : who !== 'anyone' && b.gender !== who) return false;
  if (a.wantHall && a.wantHall !== 'any' && a.wantHall !== b.hall) return false;
  if (a.wantDept && a.wantDept !== 'any' && a.wantDept !== b.department) return false;
  return true;
}

/** the vibes fit: Dating only meets Dating; Any meets every other vibe; otherwise the same vibe */
function moodsFit(a: VibeMood = 'any', b: VibeMood = 'any') {
  if (a === 'date' || b === 'date') return a === b;
  return a === 'any' || b === 'any' || a === b;
}

/** Two riders match only if both filters let the other through, the vibes fit, and you haven't blocked them. */
export function fits(me: Seeker, them: Seeker) {
  return me.id !== them.id && !isBlocked(them.id) && moodsFit(me.mood, them.mood) && accepts(me, them) && accepts(them, me);
}

/** the room's vibe once two riders meet */
export const roomMood = (a: VibeMood = 'any', b: VibeMood = 'any'): VibeMood => (a !== 'any' ? a : b !== 'any' ? b : 'ride');

/** how well two riders fit, 60–99%: same hall, same department, same vibe, same rider type, close in level */
export function matchScore(me: Seeker & { level?: number }, them: Seeker & { level?: number }) {
  let s = 62;
  if (me.hall && me.hall === them.hall) s += 10;
  if (me.department && me.department === them.department) s += 10;
  if (me.mood && me.mood === them.mood && me.mood !== 'any') s += 8;
  if (me.riderType && me.riderType === them.riderType) s += 5;
  if (me.level && them.level) s += Math.max(0, 4 - Math.abs(me.level - them.level));
  // a little spread so two riders who share nothing still differ
  const h = [...(me.id + them.id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % 5;
  return Math.min(99, s + h);
}

/** "Explorer · Volta Hall · Here to make friends" */
export function vibeLine(s: Pick<Seeker, 'riderType' | 'mood'>, hallName: string) {
  return [s.riderType ? RIDER_TYPE[s.riderType] : '', hallName, s.mood ? MOOD_LINE[s.mood] : ''].filter(Boolean).join(' · ');
}

// ---------- block and report (kept on this phone) ----------

const BLOCK_KEY = 'legonrush.blocked.v1';
const REPORT_KEY = 'legonrush.reports.v1';
interface Blocked { id: string; name: string; at: number }
export interface Report { id: string; name: string; reason: string; code: string; lines: string[]; at: number }

const readList = <T>(key: string): T[] => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeList = (key: string, v: unknown[]) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
};

export const blockedList = () => readList<Blocked>(BLOCK_KEY);
export const isBlocked = (id: string) => blockedList().some((b) => b.id === id);
export function block(id: string, name: string) {
  if (!isBlocked(id)) writeList(BLOCK_KEY, [...blockedList(), { id, name, at: Date.now() }]);
}
export function saveReport(r: Report) {
  writeList(REPORT_KEY, [...readList<Report>(REPORT_KEY), r].slice(-50));
}

export const REPORT_REASONS = ['Rude or abusive', 'Asked for money or PINs', 'Sexual or unwanted messages', 'Seems under 18', 'Fake profile or spam', 'Something else'];

/** Report / Block sheet. onReport gets the reason; onBlock blocks and leaves. */
export function safetySheet(name: string, o: { onReport: (reason: string) => void; onBlock: () => void; onLeave: () => void }) {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui vx-sheet">
    <div class="row"><h2 class="title" style="font-size:22px">${fx.shield} Safety</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    <p class="muted small">${SAFETY_TIP}</p>
    <div class="vx-safety-acts">
      <button class="btn btn-ghost" data-act="leave">${icons.arrow} Leave the ride</button>
      <button class="btn btn-ghost vx-danger" data-act="block">${icons.lock} Block ${esc(name)}</button>
    </div>
    <b class="vx-label">Report ${esc(name)}</b>
    <div class="vx-reasons">${REPORT_REASONS.map((r) => `<button class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  ov.querySelector('[data-act="leave"]')!.addEventListener('click', () => { close(); o.onLeave(); });
  ov.querySelector('[data-act="block"]')!.addEventListener('click', () => {
    const b = ov.querySelector<HTMLElement>('[data-act="block"]')!;
    if (b.dataset.sure) { close(); o.onBlock(); return; }
    b.dataset.sure = '1';
    b.innerHTML = `${icons.lock} Tap again to block. You won't be matched again.`;
  });
  ov.querySelectorAll<HTMLElement>('[data-reason]').forEach((b) => b.addEventListener('click', () => {
    o.onReport(b.dataset.reason!);
    ov.querySelector('.vx-reasons')!.innerHTML = `<p class="vx-thanks">${icons.check} Thanks. Your report is saved and sent for review. You can block ${esc(name)} too.</p>`;
  }));
}

// ---------- chat ----------

export const SAFETY_TIP = 'Meet in public places on campus. Never share money or PINs.';

const PHONE = /\+?\d(?:[\s\-.()]*\d){6,}/g;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|gh|me|io|co|ly|app|link|xyz|info|biz|to|gg)\b(?:\/\S*)?/gi;
/** Date vibe chat hides phone numbers and links */
export const maskText = (t: string) => t.replace(LINK, '[link hidden]').replace(PHONE, '[number hidden]');

export const ICEBREAKERS = [
  'Favourite spot on campus?',
  'Waakye or jollof?',
  'Night Market or Bush Canteen?',
  'Best hall on campus? Be honest.',
  'What are you studying?',
  'Sunrise or sunset rides?',
  'Song on repeat right now?',
  'Banku or fufu?',
  'Where should we ride to next?',
];
const DATE_ICEBREAKERS = ['Perfect evening on campus looks like…?', 'First thing you loved about Legon?'];
export const icebreakers = (mood: VibeMood) => (mood === 'date' ? [...DATE_ICEBREAKERS, ...ICEBREAKERS] : ICEBREAKERS);

export const sweetReplies = (mood: VibeMood) => mood === 'date'
  ? ["You're sweet", 'That made me smile', 'Same here!', 'Tell me more', 'Sunset ride with me?', 'Haha I like that']
  : ['Haha nice', 'Same here!', "Let's ride!", 'Tell me more', 'Where to next?', 'Good vibes'];

const vsvg = (d: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const vIcons = {
  rose: vsvg('<path d="M12 11c-3 0-4.5-2-4.5-4.5 1.5.5 2.5 0 3-1.5.8 1 2.2 1 3 0 .5 1.5 1.5 2 3 1.5C16.5 9 15 11 12 11z"/><path d="M12 11v10M12 17c-2.5 0-4-1.5-4.5-3.5 2.5 0 4 1 4.5 3.5zM12 15c1.5-2 3-2.5 4.5-2.5-.5 2-2 3-4.5 2.5z"/>'),
  choc: vsvg('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M6 9h12M6 15h12M12 3v18"/>'),
  coffee: vsvg('<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3c-.8 1 .8 2 0 3M11.5 3c-.8 1 .8 2 0 3"/>'),
  sunset: vsvg('<path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 7v3M5.5 10.5l1.8 1.3M18.5 10.5l-1.8 1.3M8 21h8"/>'),
  ice: vsvg('<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8.5c-.9-1-2.6-.6-2.6.8 0 1.4 2.6 2.7 2.6 2.7s2.6-1.3 2.6-2.7c0-1.4-1.7-1.8-2.6-.8z"/>'),
  laugh: vsvg('<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5h9a4.5 4.5 0 0 1-9 0zM8.5 9l1.5-1M15.5 9L14 8"/>'),
  like: vsvg('<path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2 3l-.5 3H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/>'),
  ticks: '<svg class="i" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5l4.5 4.5L16 7M12 16l1 1L22.5 7"/></svg>',
};

export interface Gift { id: string; name: string; cost: number; icon: string; line: string }
export const GIFTS: Gift[] = [
  { id: 'rose', name: 'A rose', cost: 20, icon: vIcons.rose, line: 'sent you a rose' },
  { id: 'choc', name: 'Chocolate', cost: 40, icon: vIcons.choc, line: 'sent you chocolate' },
  { id: 'coffee', name: 'Coffee at Night Market', cost: 60, icon: vIcons.coffee, line: 'bought you a coffee at Night Market' },
  { id: 'sunset', name: 'A sunset ride', cost: 100, icon: vIcons.sunset, line: 'gifted you a sunset ride' },
];
export const giftById = (id: string) => GIFTS.find((g) => g.id === id);

/** pick a gift; onSend gets it once you can pay. Paying is done here. */
export function giftSheet(partner: string, onSend: (g: Gift) => void) {
  const p = H().profile();
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui vx-sheet">
    <div class="row"><h2 class="title" style="font-size:22px">Send ${esc(partner)} a gift</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    <p class="muted small">You have ${icons.coin} <b>${p.coins.toLocaleString('en-GB')}</b> coins.</p>
    <div class="vx-gifts">${GIFTS.map((g) => `<button class="vx-gift" data-g="${g.id}" ${p.coins < g.cost ? 'disabled' : ''}><span class="vx-gift-ico">${g.icon}</span><b>${esc(g.name)}</b><small>${icons.coin} ${g.cost}</small></button>`).join('')}</div>
    <p class="muted small vx-note" hidden></p>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  ov.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => b.addEventListener('click', () => {
    const g = giftById(b.dataset.g!)!;
    const prof = H().profile();
    if (prof.coins < g.cost) return;
    prof.coins -= g.cost;
    saveProfile(prof);
    close();
    onSend(g);
  }));
}

/** the gift floats up big for both riders */
export function giftBurst(g: Gift, text: string) {
  document.querySelector('.vx-burst')?.remove();
  const el = document.createElement('div');
  el.className = 'vx-burst';
  el.innerHTML = `<div class="vx-burst-glow"></div>${Array.from({ length: 7 }, (_, i) => `<i style="--x:${(i - 3) * 34}px;--d:${(i % 3) * 0.18}s">${icons.heart}</i>`).join('')}<div class="vx-burst-card"><span class="vx-burst-ico">${g.icon}</span><b>${esc(text)}</b></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** a small floating icon for quick reactions */
export function floatIcon(svg: string) {
  const el = document.createElement('div');
  el.className = 'vx-float';
  el.innerHTML = svg;
  el.style.left = `${30 + Math.random() * 40}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------- the Vibe Ride screens: ready, preferences ----------

const photoUrl = (n: string) => `${import.meta.env.BASE_URL}photos/${n}.webp`;
const hallLabel = (id: string) => HALLS.find((h) => h.id === id)?.name ?? id;

/** Vibe Ride, opened from Home: "Ready to meet someone?", then preferences, then the search. */
export function vibeSetup(o: { find: (p: VibePrefs) => void; create: () => void; join: (code: string) => void; back: () => void }, step: 'ready' | 'prefs' = 'ready') {
  if (step === 'prefs') return vibePrefs(o);
  const prefs = loadPrefs(H().profile());
  screen(`
    <p class="kicker">${icons.heart} Vibe Ride</p>
    <div class="vx-hero" style="--vx-img:url('${photoUrl('mode-vibe')}')">
      <div class="vx-hero-txt">
        <h1>Ready to meet someone?</h1>
        <p>Find a rider online and start a spontaneous ride around campus.</p>
        <button class="btn btn-primary" id="vxGo">Find My Vibe →</button>
      </div>
    </div>
    <p class="vx-tagline">Meet someone. Match instantly. Ride together.</p>
    <div class="vx-steps">
      <div><span>1</span><b>Set your preferences</b><small>${esc(prefsSummary(prefs, hallLabel))}</small></div>
      <div><span>2</span><b>Get a live match</b><small>Someone online right now, not a list of profiles.</small></div>
      <div><span>3</span><b>Ride together</b><small>No race, no winner. Ride, chat and stop whenever you like.</small></div>
    </div>
    <button class="btn btn-link" id="vxPrefs">${icons.gear} Change preferences</button>
    <details class="card vx-friend">
      <summary><b>Ride with someone you know</b><small>Create a private ride, or join with a code</small></summary>
      <div class="stack" style="gap:10px;margin-top:10px">
        <button class="btn btn-ghost" id="vxNew">Create a private ride</button>
        <div class="row"><input class="code-in" id="vxCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Got a code?"><button class="btn btn-ghost btn-sm" id="vxJoin">Join</button></div>
      </div>
    </details>`, o.back, 'vibe-warm vx-setup');
  on('#vxGo', 'click', () => vibePrefs(o));
  on('#vxPrefs', 'click', () => vibePrefs(o));
  on('#vxNew', 'click', () => o.create());
  on('#vxJoin', 'click', () => {
    const code = (H().app.querySelector<HTMLInputElement>('#vxCode')!.value || '').trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) o.join(code);
  });
}

function vibePrefs(o: Parameters<typeof vibeSetup>[0]) {
  const p = H().profile();
  const prefs = loadPrefs(p);
  const check = dateCheck(p);
  const moodNote = check === 'young' ? 'Dating is for riders 18 and over.' : check === 'unknown' ? '18+. Add your date of birth below to unlock it.' : '';
  const opt = (v: string, l: string, cur: string) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  screen(`
    <p class="kicker">${icons.heart} Vibe Ride</p>
    <h1 class="title">Set your preferences</h1>
    <p class="muted">Choose who you'd like to be matched with. You only meet riders whose choices fit yours too.</p>
    <div class="card stack vx-prefs" style="gap:10px">
      <b class="vx-label">Gender</b>
      <div class="vx-chips" id="vxWho">${WHO_OPTS.map(([v, l]) => `<button data-v="${v}" class="${v === prefs.who ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="vx-label" for="vxHall">Hall</label>
      <select class="vx-select" id="vxHall">${opt('any', 'Any Hall', prefs.hall)}${HALLS.filter((h) => h.id !== 'none').map((h) => opt(h.id, h.name, prefs.hall)).join('')}</select>
      <label class="vx-label" for="vxDept">Department</label>
      <select class="vx-select" id="vxDept">${opt('any', 'Any Department', prefs.dept)}${DEPARTMENTS.map((g) => `<optgroup label="${esc(g.college)}">${g.departments.map((d) => opt(d, d, prefs.dept)).join('')}</optgroup>`).join('')}</select>
      <b class="vx-label">Connection type</b>
      <div class="vx-moods" id="vxMood">${MOODS.map(([v, ico, t, x]) => {
        const off = v === 'date' && check !== 'ok';
        return `<button class="vx-mood ${v === prefs.mood ? 'on' : ''} ${v === 'date' ? 'date' : ''}" data-v="${v}" ${off ? 'disabled aria-disabled="true"' : ''}><span class="vx-mood-ico">${ico}</span><span><b>${t}</b><small>${off ? moodNote : x}</small></span></button>`;
      }).join('')}</div>
      ${check === 'unknown' ? `<form class="vx-dob" id="vxDob"><label for="vxDobIn" class="muted small">Date of birth (asked once, kept on your profile)</label><div class="row"><input id="vxDobIn" type="date" max="${new Date().toISOString().slice(0, 10)}" required><button class="btn btn-ghost btn-sm">Save</button></div><p class="muted small vx-note" hidden></p></form>` : ''}
      <p class="vx-tip" id="vxTip" ${prefs.mood === 'date' ? '' : 'hidden'}>${fx.shield} ${SAFETY_TIP}</p>
      <button class="btn btn-primary" id="vxFind">Find My Vibe →</button>
    </div>`, () => vibeSetup(o), 'vibe-warm vx-setup');
  const app = H().app;
  on('#vxWho button', 'click', (_, el) => {
    prefs.who = el.dataset.v as VibeWho;
    app.querySelectorAll('#vxWho button').forEach((b) => b.classList.toggle('on', b === el));
    savePrefs(prefs);
  });
  on('#vxHall', 'change', (_, el) => { prefs.hall = (el as HTMLSelectElement).value; savePrefs(prefs); });
  on('#vxDept', 'change', (_, el) => { prefs.dept = (el as HTMLSelectElement).value; savePrefs(prefs); });
  on('#vxMood button', 'click', (_, el) => {
    if ((el as HTMLButtonElement).disabled) return;
    prefs.mood = el.dataset.v as VibeMood;
    app.querySelectorAll('#vxMood button').forEach((b) => b.classList.toggle('on', b === el));
    app.querySelector<HTMLElement>('#vxTip')!.hidden = prefs.mood !== 'date';
    savePrefs(prefs);
  });
  on('#vxDob', 'submit', (e) => {
    e.preventDefault();
    const v = app.querySelector<HTMLInputElement>('#vxDobIn')!.value;
    const age = ageOf(v);
    const note = app.querySelector<HTMLElement>('#vxDob .vx-note')!;
    if (age === null || age < 5) { note.hidden = false; note.textContent = 'Enter your real date of birth.'; return; }
    p.about.dob = v;
    saveProfile(p);
    if (age >= 18) savePrefs({ ...prefs, mood: 'date' });
    vibePrefs(o);
  });
  on('#vxFind', 'click', () => { savePrefs(prefs); o.find({ ...prefs }); });
}

// ---------- the match: "We found your vibe!", Start or Skip ----------

export interface PreviewRider { name: string; hallName: string; hallColor: string; department?: string; riderType?: RiderType | ''; mood?: VibeMood; level?: number; score: number }

/** Shows the matched rider before joining. Returns a function that switches it to "waiting for them". */
export function matchPreview(r: PreviewRider, o: { accept: () => void; skip: () => void }) {
  const app = H().app;
  H().showcase();
  app.innerHTML = `
    <div class="screen scrim fade-in vibe-warm vx-preview ${r.mood === 'date' ? 'date' : ''}">
      <div class="grow"></div>
      <div class="wrap stack center-text">
        <p class="kicker">${icons.heart} Vibe Ride</p>
        <h2 class="vx-found">We found your vibe!</h2>
        <div class="vx-match-card">
          <span class="avatar vx-avatar" style="background:${r.hallColor}">${esc(r.name.slice(0, 1).toUpperCase())}</span>
          <h1 class="title">${esc(r.name)}</h1>
          <p class="vx-mline">${esc(r.hallName)}</p>
          ${r.department ? `<p class="vx-mline muted">${esc(r.department)}</p>` : ''}
          <div class="vx-mchips"><span>${icons.bike} ${esc(riderTypeName(r.riderType))}</span><span class="on"><i class="vx-dot"></i> Online</span>${r.mood && r.mood !== 'any' ? `<span>${esc(MOOD_LINE[r.mood])}</span>` : ''}</div>
          <p class="vx-score"><b>${r.score}%</b> Match</p>
        </div>
        ${r.mood === 'date' ? `<p class="vx-tip">${fx.shield} ${SAFETY_TIP}</p>` : ''}
        <p class="muted small" id="vxWait">If you both accept, you ride together.</p>
        <button class="btn btn-primary" id="vxAccept">Start Vibe Ride →</button>
        <button class="btn btn-ghost" id="vxSkip">Skip →</button>
      </div>
    </div>`;
  on('#vxAccept', 'click', () => o.accept());
  on('#vxSkip', 'click', () => o.skip());
  H().onBack(() => o.skip());
  return () => {
    const w = app.querySelector<HTMLElement>('#vxWait');
    if (w) w.textContent = `Waiting for ${r.name} to accept…`;
    const a = app.querySelector<HTMLButtonElement>('#vxAccept');
    if (a) { a.disabled = true; a.textContent = 'Accepted'; }
  };
}

// ---------- ride memory ----------

export interface Memory { me: string; them: string; from: string; to: string; km: number; sunset: boolean; at: number; photo?: string }

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/** draws the shareable memory card (portrait JPEG data URL) */
export async function drawMemory(m: Memory): Promise<string> {
  const W = 720, Hh = 900;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, Hh);
  bg.addColorStop(0, '#fff6ef');
  bg.addColorStop(1, '#ffe3e6');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, Hh);
  // the photo, or a soft sunset if there isn't one
  const ph = { x: 40, y: 40, w: W - 80, h: 470 };
  g.save();
  g.beginPath();
  g.roundRect(ph.x, ph.y, ph.w, ph.h, 28);
  g.clip();
  const img = m.photo ? await loadImg(m.photo) : null;
  if (img) {
    const s = Math.max(ph.w / img.width, ph.h / img.height);
    g.drawImage(img, ph.x + (ph.w - img.width * s) / 2, ph.y + (ph.h - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const sky = g.createLinearGradient(0, ph.y, 0, ph.y + ph.h);
    sky.addColorStop(0, '#2b3f7a');
    sky.addColorStop(1, '#ff9a4a');
    g.fillStyle = sky;
    g.fillRect(ph.x, ph.y, ph.w, ph.h);
    g.fillStyle = '#ffd27a';
    g.beginPath();
    g.arc(W / 2, ph.y + ph.h - 40, 90, Math.PI, 0);
    g.fill();
  }
  g.restore();
  const font = (w: number, s: number) => `${w} ${s}px Sora, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#c2416b';
  g.font = font(800, 22);
  g.fillText(m.sunset ? 'A SUNSET RIDE MEMORY' : 'A RIDE MEMORY', W / 2, 570);
  g.fillStyle = '#0b1530';
  g.font = font(800, 48);
  const names = `${m.me} & ${m.them}`;
  let size = 48;
  while (g.measureText(names).width > W - 80 && size > 26) { size -= 2; g.font = font(800, size); }
  g.fillText(names, W / 2, 630);
  g.fillStyle = '#475467';
  g.font = font(600, 26);
  const route = `${m.from} → ${m.to}`;
  size = 26;
  while (g.measureText(route).width > W - 80 && size > 16) { size -= 1; g.font = font(600, size); }
  g.fillText(route, W / 2, 680);
  g.fillStyle = '#8a6500';
  g.font = font(800, 40);
  g.fillText(`${m.km.toFixed(1)} km together`, W / 2, 752);
  g.fillStyle = '#667085';
  g.font = font(500, 22);
  g.fillText(new Date(m.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 796);
  g.fillStyle = '#0b1530';
  g.font = font(900, 26);
  g.fillText('LEGONRUSH', W / 2, 858);
  return c.toDataURL('image/jpeg', 0.86);
}

/** the memory card sheet: picture, Share and Save */
export async function memorySheet(m: Memory) {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui vx-sheet vx-memory"><div class="row"><h2 class="title" style="font-size:22px">Your ride memory</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div><div class="vx-mem-img"><p class="muted small">Making your card…</p></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  const url = await drawMemory(m);
  const box = ov.querySelector<HTMLElement>('.vx-mem-img')!;
  box.innerHTML = `<img src="${url}" alt="Ride memory with ${esc(m.them)}"><div class="two"><button class="btn btn-primary" data-share>${fx.share} Share</button><a class="btn btn-ghost" download="legonrush-ride-memory.jpg" href="${url}">${fx.download} Save</a></div>`;
  box.querySelector('[data-share]')!.addEventListener('click', async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'legonrush-ride-memory.jpg', { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) return void (await navigator.share({ files: [file], text: `Rode with ${m.them} on LEGONRUSH` }));
    } catch { /* cancelled or not supported */ }
    box.querySelector<HTMLAnchorElement>('a[download]')!.click();
  });
}
