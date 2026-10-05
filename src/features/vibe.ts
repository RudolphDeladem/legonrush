// Vibe Ride extras: match preferences, safety (Date vibe age gate, block, report, chat filter),
// the warmer chat (icebreakers, sweet replies, gifts) and the ride memory card.
// main.ts owns the live channels and the room; this file holds the rules and the pieces it draws.
import { saveProfile, type Gender, type Profile, type RiderType } from '../state';
import { icons } from '../ui/icons';
import { fx } from './icons';
import { H, esc, on, screen } from './host';
import './vibe.css';

// ---------- preferences ----------

export type VibeWho = 'anyone' | 'male' | 'female';
export type VibeFrom = 'anyone' | 'hall' | 'dept';
export type VibeMood = 'ride' | 'friends' | 'date';
export interface VibePrefs {
  who: VibeWho;
  from: VibeFrom;
  mood: VibeMood;
}

const PREFS_KEY = 'legonrush.vibeprefs.v1';
const DEFAULT_PREFS: VibePrefs = { who: 'anyone', from: 'anyone', mood: 'ride' };

const MOODS: [VibeMood, string, string, string][] = [
  ['ride', icons.bike, 'Just ride', 'Easy company, no pressure.'],
  ['friends', fx.friends, 'Make friends', 'Chat and meet someone new.'],
  ['date', icons.heart, 'Date vibe', '18+ only. Matches other Date vibe riders.'],
];
export const MOOD_LINE: Record<VibeMood, string> = { ride: 'Here to just ride', friends: 'Here to make friends', date: 'Here for a date vibe' };
const RIDER_TYPE: Record<RiderType, string> = { racer: 'Racer', explorer: 'Explorer', social: 'Social Rider', speedster: 'Speedster', chill: 'Chill Rider' };

/** the last choice on this phone; Date vibe falls back to Just ride if the rider can't pick it */
export function loadPrefs(p?: Profile): VibePrefs {
  let v: Partial<VibePrefs> = {};
  try { v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; } catch { /* private mode */ }
  const prefs: VibePrefs = {
    who: (['anyone', 'male', 'female'] as const).includes(v.who as VibeWho) ? v.who! : DEFAULT_PREFS.who,
    from: (['anyone', 'hall', 'dept'] as const).includes(v.from as VibeFrom) ? v.from! : DEFAULT_PREFS.from,
    mood: (['ride', 'friends', 'date'] as const).includes(v.mood as VibeMood) ? v.mood! : DEFAULT_PREFS.mood,
  };
  if (prefs.mood === 'date' && p && dateCheck(p) !== 'ok') prefs.mood = 'ride';
  return prefs;
}

export function savePrefs(prefs: VibePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

export function prefsSummary(prefs: VibePrefs) {
  const who = { anyone: 'Anyone', male: 'Male riders', female: 'Female riders' }[prefs.who];
  const from = { anyone: '', hall: ' from my hall', dept: ' from my department' }[prefs.from];
  return `${who}${from} · ${MOODS.find((m) => m[0] === prefs.mood)![2]}`;
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

/** can this rider pick Date vibe: 18 or over, under 18, or no birthday yet */
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
  /** from where: anyone, their hall or their department */
  want?: VibeFrom;
  who?: VibeWho;
  mood?: VibeMood;
}

/** does a's filter let b through */
function accepts(a: Seeker, b: Seeker) {
  const who = a.who ?? 'anyone';
  const from = a.want ?? 'anyone';
  if (who !== 'anyone' && b.gender !== who) return false;
  if (from === 'hall' && a.hall !== b.hall) return false;
  if (from === 'dept' && (!a.department || a.department !== b.department)) return false;
  return true;
}

/** Two riders match only if both filters let the other through, Date vibe only meets Date vibe, and you haven't blocked them. */
export function fits(me: Seeker, them: Seeker) {
  return me.id !== them.id && !isBlocked(them.id) && (me.mood === 'date') === (them.mood === 'date') && accepts(me, them) && accepts(them, me);
}

/** the room's vibe once two riders meet: Date vibe only when both chose it */
export const roomMood = (a?: VibeMood, b?: VibeMood): VibeMood =>
  a === 'date' && b === 'date' ? 'date' : a === 'friends' || b === 'friends' ? 'friends' : 'ride';

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

// ---------- the setup screen: preferences, or invite a friend ----------

const seg = <T extends string>(id: string, opts: [T, string][], value: T) =>
  `<div class="seg wide" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;

/** Preferences before searching, with Invite a friend as the other way in. */
export function vibeSetup(o: { find: (p: VibePrefs) => void; create: () => void; join: (code: string) => void; back: () => void }) {
  const p = H().profile();
  const prefs = loadPrefs(p);
  const check = dateCheck(p);
  const moodNote = check === 'young' ? 'Date vibe is for riders 18 and over.' : check === 'unknown' ? 'Date vibe is 18+. Add your date of birth to unlock it.' : '';
  screen(`
    <p class="kicker">${icons.heart} Vibe Ride</p>
    <h1 class="title">Find your ride</h1>
    <p class="muted">Tell us who you'd like to ride with. You only meet riders whose choices fit yours too.</p>
    <div class="card stack vx-prefs" style="gap:10px">
      <b class="vx-label">Ride with</b>
      ${seg<VibeWho>('vxWho', [['anyone', 'Anyone'], ['male', 'Male'], ['female', 'Female']], prefs.who)}
      <b class="vx-label">From</b>
      ${seg<VibeFrom>('vxFrom', [['anyone', 'Anyone'], ['hall', 'My hall'], ['dept', 'My department']], prefs.from)}
      ${prefs.from === 'dept' && !p.department ? '<p class="muted small">Add your department in your profile to match by department.</p>' : ''}
      <b class="vx-label">Vibe</b>
      <div class="vx-moods" id="vxMood">${MOODS.map(([v, ico, t, x]) => {
        const off = v === 'date' && check !== 'ok';
        return `<button class="vx-mood ${v === prefs.mood ? 'on' : ''} ${v === 'date' ? 'date' : ''}" data-v="${v}" ${off ? 'disabled aria-disabled="true"' : ''}><span class="vx-mood-ico">${ico}</span><span><b>${t}</b><small>${off ? moodNote : x}</small></span></button>`;
      }).join('')}</div>
      ${check === 'unknown' ? `<form class="vx-dob" id="vxDob"><label for="vxDobIn" class="muted small">Date of birth (asked once, kept on your profile)</label><div class="row"><input id="vxDobIn" type="date" max="${new Date().toISOString().slice(0, 10)}" required><button class="btn btn-ghost btn-sm">Save</button></div><p class="muted small vx-note" hidden></p></form>` : ''}
      <p class="vx-tip" id="vxTip" ${prefs.mood === 'date' ? '' : 'hidden'}>${fx.shield} ${SAFETY_TIP}</p>
      <button class="btn btn-primary" id="vxFind">Find a rider</button>
    </div>
    <p class="vx-or"><span>or</span></p>
    <div class="card stack" style="gap:10px">
      <b>Invite a friend</b>
      <p class="muted small">Create a private ride and share the link or code on Snapchat, WhatsApp or anywhere.</p>
      <button class="btn btn-ghost" id="vxNew">Create a private ride</button>
      <div class="row"><input class="code-in" id="vxCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Got a code?"><button class="btn btn-ghost btn-sm" id="vxJoin">Join</button></div>
    </div>`, o.back, 'vibe-warm vx-setup');
  const app = H().app;
  const pickSeg = (id: string, key: 'who' | 'from') => on(`#${id} button`, 'click', (_, el) => {
    (prefs as unknown as Record<string, string>)[key] = el.dataset.v!;
    app.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b === el));
    savePrefs(prefs);
  });
  pickSeg('vxWho', 'who');
  pickSeg('vxFrom', 'from');
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
    vibeSetup(o);
  });
  on('#vxFind', 'click', () => { savePrefs(prefs); o.find({ ...prefs }); });
  on('#vxNew', 'click', () => o.create());
  on('#vxJoin', 'click', () => {
    const code = (app.querySelector<HTMLInputElement>('#vxCode')!.value || '').trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) o.join(code);
  });
}

// ---------- the match preview: who they are, Accept or Skip ----------

export interface PreviewRider { name: string; hallName: string; hallColor: string; riderType?: RiderType | ''; mood?: VibeMood; level?: number }

/** Shows the matched rider before joining. Returns a function that switches it to "waiting for them". */
export function matchPreview(r: PreviewRider, o: { accept: () => void; skip: () => void }) {
  const app = H().app;
  H().showcase();
  app.innerHTML = `
    <div class="screen scrim fade-in vibe-warm vx-preview ${r.mood === 'date' ? 'date' : ''}">
      <div class="grow"></div>
      <div class="wrap stack center-text">
        <p class="kicker">${icons.heart} We found someone</p>
        <div class="vx-match-card">
          <span class="avatar vx-avatar" style="background:${r.hallColor}">${esc(r.name.slice(0, 1).toUpperCase())}</span>
          <h1 class="title">${esc(r.name)}</h1>
          <p class="vx-vline">${esc(vibeLine(r, r.hallName))}</p>
          ${r.level ? `<span class="badge gold">Level ${r.level}</span>` : ''}
        </div>
        ${r.mood === 'date' ? `<p class="vx-tip">${fx.shield} ${SAFETY_TIP}</p>` : ''}
        <p class="muted small" id="vxWait">Accept to ride together, or skip to keep looking.</p>
        <div class="two" id="vxBtns"><button class="btn btn-ghost" id="vxSkip">Skip</button><button class="btn btn-primary" id="vxAccept">Accept</button></div>
      </div>
    </div>`;
  on('#vxAccept', 'click', () => o.accept());
  on('#vxSkip', 'click', () => o.skip());
  H().onBack(() => o.skip());
  return () => {
    const w = app.querySelector<HTMLElement>('#vxWait');
    if (w) w.textContent = `Waiting for ${r.name}…`;
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
