import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './style.css';
import './light.css';
import { registerSW } from 'virtual:pwa-register';
import { Game, type Action, type HudState } from './game/Game';
import { BIKES, GARAGE_BIKES, HALLS, HALL_PLACE, bikeById, hallById, type BikeSpec } from './data/campus';
import { CAMPUS_LOOP, EVENTS, RACES, TOUR_STOPS, eventStatus, exploreRoute, freshersTour, raceRoute, type EventDef, type RaceDef, type Route } from './game/routes';
import { botRivals, decodeChallenge, encodeChallenge, type Challenge } from './game/rivals';
import type { GhostRun, Rival } from './game/Game';
import { ATTRIBUTION, LINE_ENDS, PLACES, placeByName, toLatLng, resolvePlace, searchPlaces, type Place, type PlaceKind, type PlaceMatch, type TravelMode, type Turn } from './game/campusmap';
import { campusOverview, miniMap, routeMap, type Pin } from './ui/mapview';
import { MISSIONS, SKIN_TONES, WEEK_GOAL_KM, WEEK_REWARD, claimMission, todayMissions, onProfileSave, type Accessory, type Look, type Outfit, type RiderType, type StudentStatus, applyRide, claimDaily, clearGhosts, currentWeek, dailyReward, clearProfile, levelFor, loadGhost, loadProfile, loadSettings, newProfile, saveGhost, saveProfile, saveSettings, xpForLevel, type Profile, type RideResult, type RideRewards } from './state';
import { music, setMusicVolume, setSound, sfx, unlockAudio } from './audio';
import { icons } from './ui/icons';
import { ALL_DEPARTMENTS, DEPARTMENTS, OTHER_DEPARTMENT, collegeOf } from './data/departments';
import * as cloud from './cloud';
import * as live from './live';
import { CAMPUSES, campusById } from './data/campuses';

// Service workers are unavailable in some embeds; the game still runs without offline support.
// A new version waits until the player taps Update, so a deploy never reloads the page mid-ride.
const updateBar = document.createElement('div');
updateBar.className = 'update-bar';
updateBar.hidden = true;
updateBar.innerHTML = `<span>A new version of LEGONRUSH is ready.</span><button class="btn btn-primary" id="updateNow">Update</button>`;
document.body.appendChild(updateBar);
let updateReady = false;
const showUpdate = (screen: 'ride' | 'menu') => { updateBar.hidden = !updateReady || screen === 'ride'; };
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => { updateReady = true; showUpdate(game?.isRiding ? 'ride' : 'menu'); },
    onRegisterError: () => {},
  });
  updateBar.querySelector('#updateNow')!.addEventListener('click', () => updateSW(true));
}

const app = document.getElementById('app')!;
// menus use the light look from DELA's mockups; the ride HUD stays dark
app.classList.add('light');
for (const [k, v] of Object.entries({ 'app-bg': 'app-bg', 'hall-img': 'hall-tile', 'campus-img': 'lm-tower' })) {
  document.documentElement.style.setProperty(`--${k}`, `url('${import.meta.env.BASE_URL}photos/${v}.webp')`);
}
const canvas = document.getElementById('world') as HTMLCanvasElement;
// in-world signs are drawn with Sora, so wait for it (but never block the game on it)
await Promise.race([document.fonts.load('700 56px Sora'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
const game = new Game(canvas);
if (import.meta.env.DEV) Object.assign(window, { __game: game });

let profile: Profile | null = loadProfile();
const settings = loadSettings();
function applySettings() {
  setSound(settings.sound, settings.volume);
  setMusicVolume(settings.musicVolume);
  if (!settings.sound || settings.musicVolume <= 0) music(false);
  game.reducedMotion = settings.reducedMotion;
  document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
  game.setQuality(settings.graphics === 'low' || (settings.graphics === 'auto' && settings.slowDevice) ? 'low' : 'high');
}
applySettings();
const changeSettings = (patch: Partial<typeof settings>) => {
  Object.assign(settings, patch);
  saveSettings(settings);
  applySettings();
};

type Tab = 'home' | 'ride' | 'race' | 'events' | 'social' | 'you';
let tab: Tab = 'home';

let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
});

addEventListener('pointerdown', unlockAudio, { once: false });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
const km = (m: number) => (m / 1000).toFixed(2);
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const dots = (n: number) => '●'.repeat(n) + '○'.repeat(5 - n);
/** the game's own address, for links people share */
const PLAY_URL = `${location.origin}${import.meta.env.BASE_URL}play/`;
const isTouch = matchMedia('(pointer: coarse)').matches;

function render(html: string) {
  app.innerHTML = html;
}

// The phone's back button steps back inside the app instead of closing it.
let backAction: (() => void) | null = null;
let trapped = false;
function onBack(fn: (() => void) | null) {
  backAction = fn;
  if (fn && !trapped) {
    history.pushState({ legonrush: true }, '');
    trapped = true;
  }
}
addEventListener('popstate', () => {
  trapped = false;
  const fn = backAction;
  backAction = null;
  if (fn) fn();
});

function on(sel: string, ev: string, fn: (e: Event, el: HTMLElement) => void) {
  app.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
}

/** the profile's rider as the 3D model draws it */
const riderLook = (p: Profile) => ({ ...p.look, gender: p.gender, jersey: p.look.jersey || hallById(p.hall).color });

function applyLook(p: Profile | null = profile) {
  if (!p) return;
  game.setLook(riderLook(p), bikeById(p.bike).color);
}

// ---------- splash + welcome ----------

function splash() {
  game.showcase();
  render(`
    <div class="screen solid center fade-in">
      <div class="logo">LEGON<span>RUSH</span></div>
      <p class="tag" style="margin-top:12px">The Campus Lifestyle Reimagined.</p>
      <p class="kicker" style="margin-top:22px">Ride. Race. Connect.</p>
      <div class="splash-bar"><div></div></div>
    </div>`);
  setTimeout(() => {
    // a shared route link opens straight into Explore, even for someone new
    const link = new URLSearchParams(location.search);
    const v = (link.get('v') ?? '').toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(v)) {
      history.replaceState(null, '', location.pathname);
      ensureProfile();
      return inviteIntro(v, (link.get('n') ?? '').slice(0, 18));
    }
    if (link.get('c')) {
      history.replaceState(null, '', location.pathname);
      ensureProfile();
      return challengeIntro(decodeChallenge(link.get('c')!));
    }
    if (link.get('to')) {
      history.replaceState(null, '', location.pathname);
      if (link.get('mode') === 'walk' || link.get('mode') === 'cycle') { exploreOpts.mode = link.get('mode') as TravelMode; saveExploreOpts(); }
      ensureProfile();
      return explorePicker(link.get('from') ?? undefined, link.get('to')!);
    }
    if (profile) home();
    else welcome();
  }, 1400);
}

/** someone opening a shared link plays straight away as a guest */
function ensureProfile() {
  if (profile) return;
  profile = newProfile();
  profile.name = 'Guest';
  saveProfile(profile);
}

// ---------- welcome + sign-up, one question per screen ----------

/** dev only: fills the current sign-up step with sample answers and moves on (for screenshots) */
let obAuto: (() => string | void) | null = null;
if (import.meta.env.DEV) (window as unknown as { __obNext: () => string | void }).__obNext = () => obAuto?.();

function welcome() {
  game.showcase();
  render(`
    <div class="ob-splash light-ui fade-in" style="--ob-img:url('${photo('ob-splash')}');--ob-desk:url('${photo('app-bg')}')">
      <div class="brand-mark">LEGON<em>RUSH</em></div>
      <p class="s-tag">YOUR CAMPUS. YOUR RIDE.</p>
      <div class="top-right">University of Ghana, Legon</div>
      <div>
        <div class="big">Your campus.<br>Your <em>ride.</em></div>
        <p class="lede">Ride the real Legon campus, race your friends, explore every hall and meet new people on the way.</p>
        <div class="actions">
          <button class="btn btn-primary" id="start">Get Started</button>
          <button class="btn btn-ghost" id="signIn">I already have an account</button>
          <button class="btn btn-link" id="guest">Just ride as a guest</button>
        </div>
      </div>
    </div>`);
  onBack(null);
  obAuto = () => app.querySelector<HTMLElement>('#start')!.click();
  on('#start', 'click', () => onboard());
  on('#signIn', 'click', () => authScreen('in', () => welcome()));
  on('#guest', 'click', () => {
    profile = newProfile();
    profile.name = 'Guest';
    saveProfile(profile);
    applyLook();
    play(true);
  });
}

interface Signup { draft: Profile; email: string; pass: string; step: number }

const OB_STEPS: { img: string; side: string; line: string }[] = [
  { img: 'ob-account', side: 'Ride <em>Explore</em> Connect', line: 'Your account keeps your rides, times and coins on any phone.' },
  { img: 'ob-about', side: 'Ride <em>Explore</em> Connect', line: 'Other riders see your name when you race or vibe ride.' },
  { img: 'ob-uni', side: 'Same campus.<br><em>Bigger</em> adventures.', line: 'Ride where you study, with the people you see every day.' },
  { img: 'hall-tile', side: 'Ride for your <em>hall</em>', line: 'Every kilometre you ride counts for your hall in Hall Week.' },
  { img: 'ob-social', side: 'A stronger <em>campus</em> together.', line: 'Riders you meet can find you after the ride.' },
  { img: 'ob-ride', side: 'Ride your <em>way</em>', line: 'We use this to suggest modes and missions for you.' },
  { img: 'ob-ride', side: 'Make it <em>yours</em>', line: '' },
  { img: 'ob-ride', side: 'Your first ride.<br><em>Many more</em> to come.', line: 'Win races and events to unlock more bikes in the garage.' },
  { img: 'ob-welcome', side: 'See you on <em>campus</em>', line: 'Ride safe, ride fair, and have fun.' },
];

const RIDER_TYPES: [RiderType, string, string, string][] = [
  ['racer', '🏁', 'Racer', 'I love competition and winning.'],
  ['explorer', '🧭', 'Explorer', 'I love discovering new places.'],
  ['social', '👥', 'Social Rider', 'I love riding with friends.'],
  ['speedster', '⚡', 'Speedster', 'I live for speed and thrill.'],
  ['chill', '😎', 'Chill Rider', 'I ride to relax and enjoy.'],
];
const STATUSES: [StudentStatus, string, string][] = [['student', '🎓', 'UG Student'], ['alumni', '🏛️', 'Alumni'], ['staff', '💼', 'Staff'], ['visitor', '👋', 'Visitor / Guest']];

/** a side-on bike drawing in the bike's colour */
const bikeArt = (color: string) => `<svg viewBox="0 0 220 120" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="50" cy="80" r="32" stroke="#0b1530" stroke-width="7"/><circle cx="170" cy="80" r="32" stroke="#0b1530" stroke-width="7"/>
  <circle cx="50" cy="80" r="4" fill="#0b1530"/><circle cx="170" cy="80" r="4" fill="#0b1530"/>
  <path d="M50 80l38-46h66l16 46M88 34l26 46H50M114 80l40-46" stroke="${color}" stroke-width="8"/>
  <path d="M78 22h24M146 34l-6-14h16" stroke="#0b1530" stroke-width="6"/><circle cx="114" cy="80" r="8" stroke="#0b1530" stroke-width="5"/></svg>`;

function onboard(s: Signup = { draft: { ...newProfile(), name: '', hall: '', guest: false }, email: '', pass: '', step: 0 }): void {
  const d = s.draft;
  const A = d.about;
  if (s.step === 6) {
    obAuto = () => app.querySelector<HTMLElement>('#go')!.click();
    return dressRider(d, false, { next: () => onboard({ ...s, step: 7 }), back: () => onboard({ ...s, step: 5 }), step: 7, of: OB_STEPS.length });
  }
  game.showcase();
  applyLook(d);
  const meta = OB_STEPS[s.step];
  const field = (icon: string, label: string, input: string, extra = '') => `<label class="ob-field"><span class="ico">${icon}</span><span class="grow"><span class="ob-l">${label}</span>${input}</span>${extra}</label>`;
  const bike = bikeById(d.bike);
  const bodies: (() => [string, string, string])[] = [
    () => ['Create your <em>account</em>', 'Join thousands of riders on campus.', `
      ${field('✉️', 'Email address', `<input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@st.ug.edu.gh" value="${esc(s.email)}">`)}
      ${field('🔒', 'Password', `<input id="pass" type="password" autocomplete="new-password" placeholder="Create a password" value="${esc(s.pass)}">`, '<button type="button" class="eye" id="eye">Show</button>')}
      <div class="rules" id="rules"><span data-r="len">At least 8 characters</span><span data-r="num">Contains a number</span><span data-r="sym">Contains a special character</span></div>
      ${field('@', 'Username', `<input id="user" maxlength="20" autocapitalize="off" placeholder="rudolphrides" value="${esc(d.username)}">`)}
      <button class="btn btn-link" id="skipAcct">Skip for now and save on this phone only</button>`],
    () => ['Tell us about <em>you</em>', 'This helps us personalise your experience.', `
      <div class="ob-avatar" id="avatar" style="background:#ffd21f">${esc((d.name || '?')[0].toUpperCase())}<i>📷</i></div>
      ${field('👤', 'Display name', `<input id="name" maxlength="18" autocomplete="nickname" placeholder="Rudolph" value="${esc(d.name)}">`)}
      <p class="ob-label">Gender</p>
      <div class="opt-grid two" id="gender">${(['male', 'female'] as const).map((g) => `<button class="opt row ${d.gender === g ? 'on' : ''}" data-v="${g}">${g === 'male' ? 'Male' : 'Female'}</button>`).join('')}</div>
      ${field('🎂', 'Date of birth (optional)', `<input id="dob" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(A.dob)}">`)}`],
    () => ['Your <em>university</em>', 'Connect with your campus community.', `
      ${field('🏫', 'University', `<select id="uni">${CAMPUSES.map((c) => `<option value="${c.id}" ${A.campus === c.id ? 'selected' : ''} ${c.open ? '' : 'disabled'}>${esc(c.name)}${c.open ? '' : ' (coming soon)'}</option>`).join('')}</select>`, '<em class="muted">▾</em>')}
      <p class="ob-label">Student status</p>
      <div class="opt-grid two" id="status">${STATUSES.map(([v, i, t]) => `<button class="opt ${A.status === v ? 'on' : ''}" data-v="${v}"><span class="o-ico">${i}</span>${t}</button>`).join('')}</div>
      <div id="progWrap" ${A.status === 'staff' || A.status === 'visitor' ? 'hidden' : ''}>
      ${field('📘', 'Programme / Department', `<input id="dept" list="depts" autocomplete="off" placeholder="Start typing, like Computer Science" value="${esc(d.department === OTHER_DEPARTMENT ? '' : d.department)}">`)}
      <datalist id="depts">${DEPARTMENTS.flatMap((g) => g.departments.map((x) => `<option value="${esc(x)}" label="${esc(g.college)}"></option>`)).join('')}</datalist></div>`],
    () => ['Choose your <em>hall</em>', 'Represent your hall and earn points together.', `
      <div class="hall-tiles" id="halls">${HALLS.filter((h) => h.id !== 'none').map((h) => `<button class="hall-t ${d.hall === h.id ? 'on' : ''}" data-v="${h.id}" style="--hc:${h.color}">${esc(h.name)}</button>`).join('')}</div>
      <button class="opt row ${d.hall === 'none' ? 'on' : ''}" data-v="none" id="nonRes">I don't live in a hall (non-resident)</button>`],
    () => ['Connect your <em>social</em>', 'Let riders you meet find you. All optional.', `
      <div class="social-row"><span class="s-logo" style="background:#fffc00;color:#0b1530">👻</span><input id="snap" maxlength="15" autocapitalize="off" placeholder="Snapchat username" value="${esc(d.snap)}"></div>
      <div class="social-row"><span class="s-logo" style="background:#f1f3f8;color:#0b1530">👁️</span><span class="grow">Who can see your Snapchat?</span>
        <select id="snapVis"><option value="all" ${d.snapPublic ? 'selected' : ''}>Everyone</option><option value="me" ${d.snapPublic ? '' : 'selected'}>Only me</option></select></div>
      <div class="social-row"><span class="s-logo" style="background:linear-gradient(45deg,#f9a825,#e91e63,#7b1fa2)">📷</span><input id="insta" maxlength="30" autocapitalize="off" placeholder="Instagram username" value="${esc(A.instagram)}"></div>
      <div class="social-row"><span class="s-logo" style="background:#0b1530">♪</span><input id="tiktok" maxlength="24" autocapitalize="off" placeholder="TikTok username" value="${esc(A.tiktok)}"></div>`],
    () => ['What kind of <em>rider</em> are you?', 'Choose the style that fits you best.', `
      <div class="types" id="types">${RIDER_TYPES.map(([v, i, t, x]) => `<button class="type ${A.riderType === v ? 'on' : ''}" data-v="${v}"><img src="${photo('type-' + v)}" alt="" loading="lazy"><span class="t-ico">${i}</span><span><b>${t}</b><small>${x}</small></span></button>`).join('')}</div>`],
    () => ['', '', ''],
    () => ['Choose your first <em>ride</em>', 'You can unlock more bikes as you ride.', `
      <div class="bike-hero">${bikeArt(bike.color)}<span class="b-name">${esc(bike.name)}</span><span class="b-sel">Selected</span></div>
      <div class="bike-thumbs" id="bikes">${BIKES.map((b) => `<button class="${b.id === d.bike ? 'on' : ''}" data-v="${b.id}" aria-label="${esc(b.name)}">${bikeArt(b.color)}<small>${esc(b.name)}</small></button>`).join('')}</div>
      <div class="bike-stats">${(['speed', 'handling', 'acceleration'] as const).map((k) => `<div><span>${k[0].toUpperCase() + k.slice(1)}</span><i><b style="width:${bike[k] * 20}%"></b></i></div>`).join('')}</div>`],
    () => ['Almost <em>there!</em>', 'Please review and accept to continue.', `
      <div class="terms">
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Terms of Service<button type="button" class="lnk" data-doc="terms">Read Terms of Service</button></span></label>
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Privacy Policy<button type="button" class="lnk" data-doc="privacy">Read Privacy Policy</button></span></label>
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Community Guidelines<button type="button" class="lnk" data-doc="rules">Read Community Guidelines</button></span></label>
        <label class="term"><input type="checkbox" id="news" ${A.newsOptIn ? 'checked' : ''}><span>Send me news, events and updates about LEGONRUSH <span class="muted">(optional)</span></span></label>
      </div>
      <p class="small auth-note good" id="mailNote" hidden></p>`],
  ];
  const [title, sub, body] = bodies[s.step]();
  const last = s.step === OB_STEPS.length - 1;
  render(`
    <div class="ob light-ui fade-in" style="--ob-img:url('${photo(meta.img)}')">
      <div class="ob-main">
        <div class="ob-top"><button class="ob-back" id="back" aria-label="Back">‹</button><div class="brand-mark">LEGON<em>RUSH</em></div>
          <div class="ob-progress">${OB_STEPS.map((_, i) => `<i class="${i <= s.step ? 'on' : ''}"></i>`).join('')}</div><span class="ob-count">${s.step + 1}/${OB_STEPS.length}</span></div>
        <h1>${title}</h1>
        <p class="ob-sub">${sub}</p>
        <div class="ob-body">${body}</div>
        <p class="small auth-note" id="note" role="status" hidden></p>
        <div class="ob-foot">
          <button class="btn btn-link desk-back" id="back2">‹ Back</button>
          ${s.step === 4 ? '<button class="btn btn-link" id="skip">Skip for now</button>' : ''}
          <button class="btn btn-primary" id="next">${last ? (s.email ? 'Create Account' : 'Finish') : 'Continue'}</button>
        </div>
      </div>
      <div class="ob-side"><h2>${meta.side}</h2>${meta.line ? `<p>${meta.line}</p>` : ''}</div>
    </div>`);
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>('#' + id)!;
  const v = (id: string) => ($<HTMLInputElement>(id)?.value ?? '').trim();
  const say = (t: string, focus?: string) => {
    const n = $('note');
    n.hidden = false;
    n.textContent = t;
    if (focus) $(focus).focus();
  };
  app.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', () => ($('note').hidden = true)));
  const go = (step: number) => onboard({ ...s, step });
  const pick = (sel: string, fn: (v: string) => void) => on(`${sel} [data-v]`, 'click', (_, el) => {
    app.querySelectorAll(`${sel} [data-v]`).forEach((b) => b.classList.toggle('on', b === el));
    fn(el.dataset.v!);
  });
  const back = () => (s.step === 0 ? welcome() : go(s.step - 1));
  on('#back', 'click', back);
  on('#back2', 'click', back);
  onBack(back);
  const handle = (raw: string) => raw.trim().replace(/^@/, '');

  const steps: (() => boolean | void)[] = [
    () => {
      s.email = v('email');
      s.pass = $<HTMLInputElement>('pass').value;
      d.username = v('user').replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
      if (!/^\S+@\S+\.\S+$/.test(s.email)) return say('Enter your email address.', 'email');
      if (!(s.pass.length >= 8 && /\d/.test(s.pass) && /[^A-Za-z0-9]/.test(s.pass))) return say('Your password needs 8 characters, a number and a special character like ! or #.', 'pass');
      if (d.username.length < 2) return say('Choose a username of at least 2 letters or numbers.', 'user');
      return true;
    },
    () => {
      d.name = v('name');
      A.dob = v('dob');
      if (!d.name) return say('Add a display name.', 'name');
      return true;
    },
    () => {
      A.campus = v('uni') || 'ug';
      if (!A.status) return say('Choose your student status.');
      if (A.status === 'staff' || A.status === 'visitor') { d.department = OTHER_DEPARTMENT; return true; }
      const typed = v('dept');
      const dept = ALL_DEPARTMENTS.find((x) => x.toLowerCase() === typed.toLowerCase());
      if (!dept) return say(typed ? 'Pick your programme from the list.' : 'Choose your programme or department.', 'dept');
      d.department = dept;
      return true;
    },
    () => (d.hall ? true : say('Choose your hall, or tap "I don\'t live in a hall".')),
    () => {
      const snap = handle(v('snap'));
      if (snap && !/^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(snap)) return say('That Snapchat username doesn\'t look right. It has 3 to 15 letters, numbers, dots, dashes or underscores.', 'snap');
      d.snap = snap;
      d.snapPublic = v('snapVis') !== 'me';
      A.instagram = handle(v('insta')).replace(/[^A-Za-z0-9._]/g, '');
      A.tiktok = handle(v('tiktok')).replace(/[^A-Za-z0-9._]/g, '');
      return true;
    },
    () => (A.riderType ? true : say('Pick the rider type that fits you best.')),
    () => true,
    () => true,
    () => {
      if ([...app.querySelectorAll<HTMLInputElement>('.must')].some((c) => !c.checked)) return say('Tick the three boxes to agree before you start.');
      A.newsOptIn = $<HTMLInputElement>('news').checked;
      A.termsAt = new Date().toISOString().slice(0, 10);
      return true;
    },
  ];

  // step-specific controls
  if (s.step === 0) {
    const rules = () => {
      const p = $<HTMLInputElement>('pass').value;
      const ok = { len: p.length >= 8, num: /\d/.test(p), sym: /[^A-Za-z0-9]/.test(p) };
      app.querySelectorAll<HTMLElement>('#rules [data-r]').forEach((r) => r.classList.toggle('ok', ok[r.dataset.r as keyof typeof ok]));
    };
    $('pass').addEventListener('input', rules);
    rules();
    on('#eye', 'click', (e, el) => {
      e.preventDefault();
      const p = $<HTMLInputElement>('pass');
      p.type = p.type === 'password' ? 'text' : 'password';
      el.textContent = p.type === 'password' ? 'Show' : 'Hide';
    });
    on('#skipAcct', 'click', () => {
      s.email = '';
      s.pass = '';
      d.username = v('user').replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
      go(1);
    });
  }
  if (s.step === 1) {
    pick('#gender', (g) => { d.gender = g as Profile['gender']; applyLook(d); });
    $('name').addEventListener('input', () => { $('avatar').firstChild!.textContent = (v('name') || '?')[0].toUpperCase(); });
  }
  if (s.step === 2) pick('#status', (x) => { A.status = x as StudentStatus; $('progWrap').hidden = x === 'staff' || x === 'visitor'; });
  if (s.step === 3) {
    on('#halls [data-v], #nonRes', 'click', (_, el) => {
      d.hall = el.dataset.v!;
      app.querySelectorAll('#halls [data-v], #nonRes').forEach((b) => b.classList.toggle('on', b === el));
      $('note').hidden = true;
      applyLook(d);
    });
  }
  if (s.step === 4) on('#skip', 'click', () => go(5));
  if (s.step === 5) pick('#types', (x) => { A.riderType = x as RiderType; $('note').hidden = true; });
  if (s.step === 7) on('#bikes [data-v]', 'click', (_, el) => { d.bike = el.dataset.v!; go(7); });
  on('[data-doc]', 'click', (e, el) => { e.preventDefault(); docSheet(el.dataset.doc as DocId); });

  on('#next', 'click', async (_, el) => {
    if (!steps[s.step]()) return;
    if (!last) return go(s.step + 1);
    const btn = el as HTMLButtonElement;
    let confirmMail = false;
    if (s.email) {
      btn.disabled = true;
      btn.textContent = 'Creating your account…';
      const r = await cloud.signUp(s.email, s.pass);
      btn.disabled = false;
      btn.textContent = 'Create Account';
      if (r.ok === false) return say(r.error);
      confirmMail = r.ok === 'confirm';
    }
    d.guest = false;
    profile = d;
    saveProfile(profile);
    if (cloud.account) { resetLobby(); void loadInvites(); }
    sfx.finish();
    welcomeDone(confirmMail ? s.email : '');
  });

  // dev: sample answers for the screenshot run
  obAuto = () => {
    const set = (id: string, val: string) => { const i = app.querySelector<HTMLInputElement>('#' + id); if (i) { i.value = val; i.dispatchEvent(new Event('input')); } };
    if (s.step === 0) { set('email', 'rider@st.ug.edu.gh'); set('pass', 'Legon#2026'); set('user', 'rudolph'); app.querySelector<HTMLElement>('#skipAcct')!.click(); return; }
    if (s.step === 1) set('name', 'Rudolph');
    if (s.step === 2) { app.querySelector<HTMLElement>('#status [data-v="student"]')!.click(); set('dept', 'Computer Science'); }
    if (s.step === 3) app.querySelector<HTMLElement>('#halls [data-v="volta"]')?.click();
    if (s.step === 5) app.querySelector<HTMLElement>('#types [data-v="explorer"]')!.click();
    if (s.step === 8) app.querySelectorAll<HTMLInputElement>('.must').forEach((c) => (c.checked = true));
    $('next').click();
  };
}

function welcomeDone(mailedTo: string) {
  const name = profile?.name || 'Rider';
  render(`
    <div class="ob-welcome light-ui fade-in" style="--ob-img:url('${photo('ob-welcome')}')">
      <div>
        <div class="brand-mark" style="font-size:28px">LEGON<em>RUSH</em></div>
        <h1 style="margin-top:18px">Welcome to<br><em>LEGONRUSH</em>,<br>${esc(name)}!</h1>
        <p>Your campus. Your ride. Your competition.</p>
        ${mailedTo ? `<p class="small auth-note good" style="margin-top:12px">We sent a link to ${esc(mailedTo)}. Open it on this phone to finish your account. You can ride now.</p>` : ''}
      </div>
      <button class="btn btn-primary" id="first">Start First Ride</button>
    </div>`);
  onBack(null);
  obAuto = () => 'end';
  on('#first', 'click', () => {
    applyLook();
    play(!profile!.tutorialDone);
  });
}

type DocId = 'terms' | 'privacy' | 'rules';
const DOCS: Record<DocId, [string, string]> = {
  terms: ['Terms of Service', `
    <p>LEGONRUSH is a free game made by a University of Ghana student. By using it you agree to these simple terms.</p>
    <h3>Playing fair</h3><ul><li>Don't cheat, hack or use tools to change your times or coins.</li><li>One account per person.</li><li>We can remove times that look impossible, and close accounts that break these terms.</li></ul>
    <h3>Rush Coins</h3><p>Coins and bikes are only for the game. They have no money value and can't be sold or swapped for cash.</p>
    <h3>Real life</h3><p>LEGONRUSH is a game. Never play it while riding a real bike, driving or walking on a road.</p>
    <h3>Changes</h3><p>We may update the game and these terms. We'll tell you in the app when something important changes.</p>`],
  privacy: ['Privacy Policy', `
    <p>We keep as little about you as we can.</p>
    <h3>What we keep</h3><ul><li>Your email and password (stored safely by our sign-in provider, Supabase).</li><li>Your rider: name, username, hall, programme, look and bike.</li><li>Your rides, race times, coins and missions.</li><li>Your social usernames, only if you add them.</li></ul>
    <h3>What other riders see</h3><p>Your name, username, hall, level and race times. Your Snapchat only if you choose "Everyone". Your date of birth is never shown.</p>
    <h3>What we never do</h3><p>We never sell your data, and we never track your real location.</p>
    <h3>Deleting</h3><p>Write to legonrush@gmail.com and we'll delete your account and everything in it.</p>`],
  rules: ['Community Guidelines', `
    <p>LEGONRUSH is for everyone on campus. Keep it friendly.</p>
    <ul><li>Be kind in chat. No insults, bullying, hate or threats.</li><li>No sexual messages or pictures.</li><li>Don't share someone else's private details.</li><li>Don't spam invites.</li><li>Respect "no". If someone leaves a ride, let them go.</li></ul>
    <p>Riders who break these rules can lose chat or their account. Report a problem to legonrush@gmail.com.</p>`],
};

function docSheet(id: DocId) {
  const [title, html] = DOCS[id];
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui doc-sheet" role="dialog" aria-label="${title}">
    <div class="row"><h2 class="title" style="font-size:22px">${title}</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>${html}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
}

// ---------- onboarding ----------

function createRider(draft: Profile, editing = false) {
  game.showcase();
  applyLook(draft);
  const hallOpt = (h: (typeof HALLS)[number]) => `<option value="${h.id}" ${draft.hall === h.id ? 'selected' : ''}>${esc(h.name)}</option>`;
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack">
        <p class="kicker">${editing ? 'Edit rider' : 'Step 1 of 2'}</p>
        <h1 class="title">About you</h1>
        <div class="field"><label for="name">Display name</label><input id="name" maxlength="18" autocomplete="nickname" value="${esc(draft.guest && ['Rider', 'Guest'].includes(draft.name) ? '' : draft.name)}" placeholder="Rudolph"></div>
        <div class="field"><label for="user">Username</label><input id="user" maxlength="20" autocapitalize="off" value="${esc(draft.username)}" placeholder="rudolphrides"></div>
        <div class="field"><label>Gender</label><div class="seg wide" id="gender">${(['male', 'female'] as const).map((g) => `<button data-v="${g}" class="${draft.gender === g ? 'on' : ''}">${g === 'male' ? 'Male' : 'Female'}</button>`).join('')}</div></div>
        <div class="field"><label for="hall">Hall</label>
          <div class="select-wrap"><span class="hall-dot" id="hallDot" style="background:${hallById(draft.hall).color}"></span><select id="hall">
            <option value="" disabled ${draft.hall === 'none' && draft.guest ? 'selected' : ''}>Choose your hall</option>
            ${HALLS.filter((h) => h.id !== 'none').map(hallOpt).join('')}
            ${hallOpt(hallById('none'))}
          </select></div>
          <p class="muted small">Every kilometre you ride counts for your hall.</p>
        </div>
        <div class="field"><label for="dept">Department</label>
          <input id="dept" list="depts" autocomplete="off" value="${esc(draft.department)}" placeholder="Start typing, like Computer Science">
          <datalist id="depts">${DEPARTMENTS.flatMap((g) => g.departments.map((d) => `<option value="${esc(d)}" label="${esc(g.college)}"></option>`)).join('')}<option value="${OTHER_DEPARTMENT}"></option></datalist>
        </div>
        <div class="field"><label for="snap">Snapchat <span class="muted">(optional)</span></label>
          <div class="prefix-input"><span>@</span><input id="snap" maxlength="15" autocapitalize="off" autocomplete="off" value="${esc(draft.snap)}" placeholder="yoursnap"></div>
          <label class="check-row"><input type="checkbox" id="snapPublic" ${draft.snapPublic ? 'checked' : ''}> Show it to other riders</label>
        </div>
        <p class="small auth-note" id="note" role="status" hidden></p>
        <button class="btn btn-primary" id="next" style="margin-top:8px">${editing ? 'Save' : 'Continue'}</button>
        ${editing ? '<button class="btn btn-link" id="cancel">Cancel</button>' : '<button class="btn btn-link" id="back">Back</button>'}
      </div>
    </div>`);
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>('#' + id)!;
  on('#gender [data-v]', 'click', (_, el) => {
    draft.gender = el.dataset.v as Profile['gender'];
    app.querySelectorAll('#gender button').forEach((b) => b.classList.toggle('on', b === el));
    applyLook(draft);
  });
  $('hall').addEventListener('change', () => {
    draft.hall = $<HTMLSelectElement>('hall').value;
    $('hallDot').style.background = hallById(draft.hall).color;
    applyLook(draft);
  });
  app.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', () => ($('note').hidden = true)));
  const say = (t: string, field: string) => {
    const n = $('note');
    n.hidden = false;
    n.textContent = t;
    $(field).focus();
  };
  on('#next', 'click', () => {
    const name = $<HTMLInputElement>('name').value.trim();
    const user = $<HTMLInputElement>('user').value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
    const hall = $<HTMLSelectElement>('hall').value;
    const typed = $<HTMLInputElement>('dept').value.trim();
    const dept = ALL_DEPARTMENTS.find((d) => d.toLowerCase() === typed.toLowerCase());
    const snap = $<HTMLInputElement>('snap').value.trim().replace(/^@/, '');
    if (!name) return say('Add a display name.', 'name');
    if (!hall) return say('Choose your hall, or Non-resident.', 'hall');
    if (!dept) return say(typed ? 'Pick your department from the list, or choose "Other / not a student".' : 'Choose your department.', 'dept');
    if (snap && !/^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(snap)) return say('That Snapchat username doesn\'t look right. It has 3 to 15 letters, numbers, dots, dashes or underscores.', 'snap');
    Object.assign(draft, { name, username: user, hall, department: dept, snap, snapPublic: $<HTMLInputElement>('snapPublic').checked, guest: false });
    if (editing) {
      profile = draft;
      saveProfile(draft);
      applyLook();
      home('you');
    } else dressRider(draft);
  });
  // a guest who already has progress goes back home, never to the welcome screen that would start over
  const back = () => (editing ? home('you') : profile ? home() : welcome());
  on('#back', 'click', back);
  on('#cancel', 'click', back);
  onBack(back);
}

const JERSEY_COLORS = ['#d64545', '#f2c230', '#2e8b3a', '#1f6fd6', '#7b3fc4', '#ff7a1a', '#111418', '#f4f4f4'];
const HELMET_COLORS = ['#f5c518', '#f4f4f4', '#111418', '#d64545', '#1f6fd6', '#2ecc71'];
const OUTFITS: [Outfit, string][] = [['jersey', 'Jersey'], ['hall-tee', 'Hall T-shirt'], ['hoodie', 'Hoodie'], ['kente', 'Kente jersey']];
const ACCESSORIES: [Accessory, string, string][] = [['helmet', '⛑️', 'Helmet'], ['sunglasses', '🕶️', 'Sunglasses'], ['backpack', '🎒', 'Backpack'], ['watch', '⌚', 'Watch'], ['gloves', '🧤', 'Gloves']];

/** Step 2: dress the rider, with the 3D rider turning above the options. */
interface DressFlow { next: () => void; back: () => void; step: number; of: number }

function dressRider(draft: Profile, editing = false, flow?: DressFlow) {
  game.dressView();
  applyLook(draft);
  const L = draft.look;
  const hall = hallById(draft.hall);
  const swatches = (id: string, colors: string[], value: string, first?: [string, string]) =>
    `<div class="swatches" id="${id}">${first ? `<button class="swatch ${value === first[0] ? 'on' : ''}" data-v="${first[0]}" style="background:${first[1]}" aria-label="Hall colour"><span>Hall</span></button>` : ''}${colors.map((c) => `<button class="swatch ${value === c ? 'on' : ''}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const prev = app.querySelector('.dress-panel');
  const prevScroll = prev?.scrollTop ?? 0;
  render(`
    <div class="screen dress light-ui${prev ? '' : ' fade-in'}">
      <div class="wrap dress-head">
        ${flow ? `<div class="ob-top"><button class="ob-back" id="back" aria-label="Back">‹</button><div class="ob-progress">${Array.from({ length: flow.of }, (_, i) => `<i class="${i < flow.step ? 'on' : ''}"></i>`).join('')}</div><span class="ob-count">${flow.step}/${flow.of}</span></div>` : `<p class="kicker">${editing ? 'Your look' : 'Step 2 of 2'}</p>`}
        <h1 class="title">${flow ? 'Create your <em>rider</em>' : 'Dress your rider'}</h1>
      </div>
      <div class="grow"></div>
      <div class="dress-panel">
        <div class="wrap stack">
          <div class="dress-row"><b>Body type</b><div class="seg" id="body">${(['slim', 'regular', 'broad'] as const).map((b) => `<button data-v="${b}" class="${L.body === b ? 'on' : ''}">${b[0].toUpperCase() + b.slice(1)}</button>`).join('')}</div></div>
          <div class="dress-row"><b>Skin tone</b>${swatches('skin', SKIN_TONES, L.skin)}</div>
          <div class="dress-row col"><b>Outfit</b><div class="chips-row" id="outfit">${OUTFITS.map(([v, label]) => `<button data-v="${v}" class="chip-btn ${L.outfit === v ? 'on' : ''}">${label}</button>`).join('')}</div></div>
          ${L.outfit === 'kente' ? '' : `<div class="dress-row col"><b>${L.outfit === 'hall-tee' ? 'T-shirt' : L.outfit === 'hoodie' ? 'Hoodie' : 'Jersey'} colour</b>${swatches('jersey', JERSEY_COLORS, L.jersey, ['', hall.color])}</div>`}
          <div class="dress-row col"><b>Accessories</b><div class="chips-row" id="acc">${ACCESSORIES.map(([v, icon, label]) => `<button data-v="${v}" class="chip-btn ${L.accessories.includes(v) ? 'on' : ''}" aria-pressed="${L.accessories.includes(v)}">${icon} ${label}</button>`).join('')}</div></div>
          ${L.accessories.includes('helmet') ? `<div class="dress-row col"><b>Helmet colour</b>${swatches('helmet', HELMET_COLORS, L.helmet)}</div>` : ''}
          ${editing || flow ? '' : `<div class="dress-row col"><b>Starter bike</b><div class="chips-row" id="bike">${BIKES.map((b) => `<button data-v="${b.id}" class="chip-btn ${draft.bike === b.id ? 'on' : ''}"><span class="dot" style="background:${b.color}"></span>${b.name} · ${b.tagline}</button>`).join('')}</div></div>`}
          <button class="btn btn-primary" id="go">${editing ? 'Save' : flow ? 'Continue' : "Let's go"}</button>
          ${editing ? '<button class="btn btn-link" id="cancel">Cancel</button>' : ''}
        </div>
      </div>
    </div>`);
  const panel = app.querySelector<HTMLElement>('.dress-panel')!;
  panel.scrollTop = prevScroll;
  const redraw = () => dressRider(draft, editing, flow);
  on('#body [data-v]', 'click', (_, el) => { L.body = el.dataset.v as Look['body']; redraw(); });
  on('#skin [data-v]', 'click', (_, el) => { L.skin = el.dataset.v!; redraw(); });
  on('#outfit [data-v]', 'click', (_, el) => { L.outfit = el.dataset.v as Outfit; redraw(); });
  on('#jersey [data-v]', 'click', (_, el) => { L.jersey = el.dataset.v!; redraw(); });
  on('#helmet [data-v]', 'click', (_, el) => { L.helmet = el.dataset.v!; redraw(); });
  on('#bike [data-v]', 'click', (_, el) => { draft.bike = el.dataset.v!; redraw(); });
  on('#acc [data-v]', 'click', (_, el) => {
    const a = el.dataset.v as Accessory;
    L.accessories = L.accessories.includes(a) ? L.accessories.filter((x) => x !== a) : [...L.accessories, a];
    redraw();
  });
  on('#go', 'click', () => {
    if (flow) return flow.next();
    profile = draft;
    saveProfile(profile);
    game.showcase();
    applyLook();
    if (editing) home('you');
    else play(!profile.tutorialDone);
  });
  const back = () => {
    game.showcase();
    if (flow) return flow.back();
    if (editing) return home('you');
    createRider(draft);
  };
  on('#cancel', 'click', back);
  on('#back', 'click', back);
  onBack(back);
}

// ---------- gameplay ----------

const ARROW: Record<Turn, string> = {
  start: '↑', straight: '↑', 'slight-left': '↖', 'slight-right': '↗', left: '←', right: '→', 'sharp-left': '↙', 'sharp-right': '↘', arrive: '◎', stop: '★',
};
const dm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const isExplore = (r: Route) => r.kind === 'explore';
const routeKey = (r: Route) => (r.id === 'explore' ? `explore:${r.from.name}>${r.to.name}` : r.id);
const finishReward = (r: Route) => (isExplore(r) ? 50 + Math.round(r.length / 20) : 250);

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

interface PlayOpts {
  /** bots for Quick Match */
  rivals?: Rival[];
  /** a friend's run from a challenge link */
  challenge?: Challenge;
  /** a timed event this ride counts for */
  event?: EventDef;
  /** riding with people right now: a Quick Match race or a Vibe Ride */
  live?: LiveRide;
}

interface LiveRide {
  ch: live.Channel;
  kind: 'race' | 'vibe';
  riders: { id: string; name: string; jersey: string }[];
}

function play(tutorial: boolean, route: Route = CAMPUS_LOOP, opts: PlayOpts = {}) {
  if (!profile) return;
  if (game.currentRoute !== route) game.setRoute(route);
  applyLook();
  const bike = bikeById(profile.bike);
  render(`
    <div class="hud${settings.leftHanded ? ' lefty' : ''}">
      <div class="touch-layer" id="touch"></div>
      <div class="boosting-vignette" id="vignette"></div>
      <div class="hud-top" style="position:relative">
        <div class="hud-pill"><small>DISTANCE</small><span id="dist">0.00</span> KM</div>
        <div class="hud-progress">
          <div class="xpbar"><div id="prog" style="width:0%"></div></div>
          <p class="muted">${esc((route.id === 'explore' ? `To ${route.to.name}` : route.name).toUpperCase())}</p>
          <div class="row" style="gap:6px;justify-content:center${opts.live?.kind === 'vibe' ? ';display:none' : ''}"><p class="place-pill" id="place" hidden></p><p class="ghost-gap" id="ghostGap" hidden></p></div>
        </div>
        <div class="row">
          <div class="hud-pill">${icons.coin} <span id="coins">0</span></div>
          <button class="pause-btn" id="pause" aria-label="Pause">${icons.pause}</button>
        </div>
      </div>
      <div class="turn-banner" id="turn" hidden><span class="turn-arrow" id="turnArrow"></span><div><b id="turnDist"></b><span id="turnText"></span></div></div>
      <div class="prompt" id="prompt"></div>
      <div class="hud-bottom" style="position:relative">
        <div class="boost" id="boostWrap"><label>BOOST${isTouch ? '' : ' · B / SHIFT'}</label><div class="xpbar"><div id="boost" style="width:0%"></div></div></div>
        ${isTouch ? '<button class="boost-btn" id="boostBtn" disabled>BOOST</button>' : ''}
      </div>
      <canvas class="minimap" id="minimap" width="240" height="240" aria-hidden="true"></canvas>
      ${opts.live?.kind === 'vibe' ? `<div class="ride-chat" id="rideChat"><div class="rc-log" id="rcLog"></div>${quickActions()}<form class="chat-form" id="rcForm" hidden><input id="rcSay" maxlength="160" autocomplete="off" placeholder="Message…"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form></div>` : ''}
    </div>`);

  const $ = (id: string) => app.querySelector<HTMLElement>('#' + id)!;
  const dist = $('dist');
  const prog = $('prog');
  const coins = $('coins');
  const boost = $('boost');
  const boostWrap = $('boostWrap');
  const prompt = $('prompt');
  const vignette = $('vignette');
  const boostBtn = app.querySelector<HTMLButtonElement>('#boostBtn');
  const drawMap = miniMap(app.querySelector<HTMLCanvasElement>('#minimap')!, route);
  const turn = $('turn'), turnArrow = $('turnArrow'), turnDist = $('turnDist'), turnText = $('turnText');
  const ghostGap = $('ghostGap');
  const placeEl = $('place');
  // races: a friend's challenge, Quick Match bots, or else your own best run rides with you
  const lr = opts.live;
  const ghost = route.kind === 'race' && !opts.challenge && !opts.rivals && !lr ? loadGhost(route.id) : null;
  const rivals: Rival[] = lr
    ? lr.riders.map((r) => ({ run: { step: 0.1, d: [], x: [] }, name: r.name, color: r.jersey || '#ffd21f', ghostly: false, live: true }))
    : opts.challenge
    ? [{ run: opts.challenge.run, name: opts.challenge.name, color: '#ffd21f', ghostly: false }]
    : opts.rivals ?? (ghost ? [{ run: ghost, name: 'Best run', color: '#9fd8ff', ghostly: true }] : []);
  game.setRivals(rivals);
  const gapName = rivals[0]?.name.replace(/ \(bot\)$/, '') ?? '';
  let lastTurn = '';

  // riding with people: stream your position, and place theirs as it arrives
  let stream = 0;
  if (lr) {
    let sent = 0;
    stream = window.setInterval(() => {
      const rec = game.recording;
      if (rec.d.length <= sent) return;
      lr.ch.send('pos', { k: myId(), i: sent, d: rec.d.slice(sent), x: rec.x.slice(sent) });
      sent = rec.d.length;
    }, 300);
    const sink = (m: PosMsg) => {
      const run = rivals[lr.riders.findIndex((r) => r.id === m.k)]?.run;
      if (!run || !Array.isArray(m.d)) return;
      // a lost update: hold the last position until the next one
      while (run.d.length < m.i) { run.d.push(run.d[run.d.length - 1] ?? 0); run.x.push(run.x[run.x.length - 1] ?? 0); }
      m.d.forEach((d, j) => { run.d[m.i + j] = Number(d) || 0; run.x[m.i + j] = Number(m.x[j]) || 0; });
    };
    if (lr.kind === 'vibe' && vibe) vibe.onPos = sink;
    else lr.ch.on('pos', sink);
  }
  setStatus('riding');
  // Vibe Ride: the chat rides with you
  const rideChat = app.querySelector<HTMLElement>('#rideChat');
  if (rideChat && vibe) {
    const log = $('rcLog');
    const form = app.querySelector<HTMLFormElement>('#rcForm')!;
    const input = app.querySelector<HTMLInputElement>('#rcSay')!;
    const draw = () => {
      log.innerHTML = vibe ? vibe.msgs.slice(-4).map(chatLine).join('') : '';
    };
    draw();
    vibe.redraw = () => draw();
    bindChat(rideChat, log, input, () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
  }

  // tutorial: teach through play, one move at a time
  const steps: { action: Action; text: string }[] = [
    { action: 'left', text: isTouch ? 'Swipe left' : 'Press ←' },
    { action: 'right', text: isTouch ? 'Swipe right' : 'Press →' },
    { action: 'jump', text: isTouch ? 'Swipe up to jump' : 'Press ↑ or Space to jump' },
    { action: 'boost', text: isTouch ? 'Tap boost' : 'Press B to boost' },
  ];
  let step = tutorial ? 0 : -1;
  let countdownShown = false;
  const showStep = () => {
    if (step < 0) return;
    if (step >= steps.length) {
      prompt.innerHTML = `You've got it.`;
      game.releaseSpawns();
      step = -1;
      setTimeout(() => { if (prompt.textContent === `You've got it.`) prompt.innerHTML = ''; }, 1600);
      return;
    }
    if (steps[step].action === 'boost') game.giveBoost(1);
    prompt.innerHTML = `<small>TUTORIAL</small>${steps[step].text}`;
  };

  game.onAction = (a) => {
    if (step >= 0 && steps[step].action === a) {
      step++;
      setTimeout(showStep, 350);
    }
  };

  game.onHud = (h: HudState) => {
    dist.textContent = km(h.distance);
    drawMap(h.pos, h.yaw);
    turn.hidden = !h.next || !!h.countdown;
    if (h.next) {
      const key = h.next.turn + h.next.text;
      if (key !== lastTurn) {
        lastTurn = key;
        turnArrow.textContent = ARROW[h.next.turn as Turn] ?? '↑';
        turnText.textContent = h.next.text;
        turn.classList.toggle('arrive', h.next.turn === 'arrive' || h.next.turn === 'stop');
      }
      turnDist.textContent = h.next.dist < 25 ? 'Now' : dm(h.next.dist);
      turn.classList.toggle('soon', h.next.dist < 60);
    }
    prog.style.width = `${(h.distance / h.routeLength) * 100}%`;
    placeEl.hidden = !h.place;
    if (h.place) placeEl.textContent = `${ordinal(h.place.pos)} of ${h.place.of}`;
    ghostGap.hidden = h.ghostGap === null;
    if (h.ghostGap !== null) {
      const behind = h.ghostGap > 0.05;
      ghostGap.textContent = `${gapName} ${behind ? '+' : '−'}${Math.abs(h.ghostGap).toFixed(1)} s`;
      ghostGap.classList.toggle('behind', behind);
    }
    coins.textContent = String(h.coins);
    boost.style.width = `${h.boost * 100}%`;
    const ready = h.boost >= 0.25 && !h.boosting;
    boostWrap.classList.toggle('ready', ready);
    if (boostBtn) boostBtn.disabled = !ready;
    vignette.classList.toggle('on', h.boosting);
    if (h.countdown) {
      prompt.innerHTML = `<span class="countdown">${h.countdown}</span>`;
      countdownShown = true;
    } else if (countdownShown) {
      countdownShown = false;
      prompt.innerHTML = '';
      showStep();
    }
  };

  game.onEnd = (r) => {
    cleanup();
    const result: RideResult = { routeId: routeKey(route), ...r };
    const run = game.lastRun;
    const event = opts.event && eventStatus(opts.event).live ? opts.event : undefined;
    const p = profile!;
    // won: finished ahead of every rider you raced
    if (route.kind === 'race' && r.finished && rivals.length && !ghost && game.rivalTimes.every((t) => t.time > r.time)) p.wins = (p.wins ?? 0) + 1;
    const m = todayMissions(p);
    if (isExplore(route) && r.finished) {
      for (const n of route.id === 'freshers-tour' ? TOUR_STOPS : [route.to.name]) if (!m.places.includes(n)) m.places.push(n);
    }
    if (lr) lr.ch.send('done', { k: myId(), name: p.name, km: r.distance / 1000, finished: r.finished, time: r.time });
    if (lr?.kind === 'vibe') {
      for (const f of lr.riders) if (r.distance > 200 && !m.friends.includes(f.id)) m.friends.push(f.id);
      const rw = applyRide(p, result, finishReward(route));
      cloud.record({ hall: p.hall, department: p.department, km: r.distance / 1000 });
      vibe?.msgs.push({ sys: true, text: `${r.finished ? `You reached ${route.to.name}` : 'You stopped'} · ${km(r.distance)} km · +${rw.coins} coins`, at: Date.now() });
      return vibeRoom();
    }
    if (lr) setTimeout(() => lr.ch.leave(), 90e3);
    const rewards = applyRide(profile!, result, finishReward(route), event ? 2 : 1);
    cloud.record({ hall: profile!.hall, department: profile!.department, km: r.distance / 1000, race: route.kind === 'race' && r.finished ? { route: route.id, time: r.time } : undefined });
    if (route.kind === 'race' && r.finished && profile!.bestTimes[result.routeId] === r.time) saveGhost(route.id, { time: r.time, ...run });
    // finishing a live event wins its bike
    let prize: string | undefined;
    if (event && r.finished && !profile!.ownedBikes.includes(event.prize)) {
      profile!.ownedBikes.push(event.prize);
      saveProfile(profile!);
      prize = event.prize;
    }
    results(result, rewards, route, { hadGhost: !!ghost, rivals: game.rivalTimes, run, opts, event, prize });
    if (lr) liveStandings(lr, result);
  };

  // controls
  const keyMap: Record<string, Action> = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyB: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',
  };
  keyHandler = (e) => {
    // typing in the ride chat
    if (e.target instanceof HTMLInputElement) {
      if (e.code === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') return togglePause();
    const a = keyMap[e.code];
    if (a) {
      e.preventDefault();
      game.action(a);
    }
  };
  addEventListener('keydown', keyHandler);

  const touch = $('touch');
  let sx = 0, sy = 0, st = 0, swiped = false;
  touch.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); swiped = false; });
  touch.addEventListener('pointermove', (e) => {
    if (swiped || !st) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    swiped = true;
    if (Math.abs(dx) > Math.abs(dy)) game.action(dx < 0 ? 'left' : 'right');
    else if (dy < 0) game.action('jump');
  });
  touch.addEventListener('pointerup', () => {
    if (!swiped && performance.now() - st < 250 && isTouch) game.action('boost');
    st = 0;
  });
  boostBtn?.addEventListener('pointerdown', (e) => { e.stopPropagation(); game.action('boost'); });

  const togglePause = () => {
    if (!game.isRiding) return onBack(togglePause);
    if (game.paused) return resume();
    game.paused = true;
    music(false);
    const ov = document.createElement('div');
    ov.className = 'overlay fade-in';
    ov.id = 'pauseOverlay';
    ov.innerHTML = `
      <div class="panel">
        <h2 class="title">Paused</h2>
        <button class="btn btn-primary" data-p="continue">Continue</button>
        ${lr ? '' : '<button class="btn btn-ghost" data-p="restart">Restart</button>'}
        <button class="btn btn-ghost" data-p="sound">Sound: ${settings.sound ? 'On' : 'Off'}</button>
        <p class="muted small" style="margin:6px 0">${isTouch ? 'Swipe left/right to change lanes, up to jump, tap to boost.' : '← → or A D to steer, ↑ W or Space to jump, B or Shift to boost, Esc to pause.'}</p>
        <button class="btn btn-link" data-p="exit">Exit ride</button>
      </div>`;
    app.appendChild(ov);
    onBack(resume);
    ov.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (p === 'continue') resume();
      if (p === 'restart') { cleanup(); play(false, route, opts); }
      if (p === 'sound') {
        changeSettings({ sound: !settings.sound });
        b.textContent = `Sound: ${settings.sound ? 'On' : 'Off'}`;
      }
      if (p === 'exit') { cleanup(); leave(); }
    }));
  };
  const resume = () => {
    game.paused = false;
    music(true);
    app.querySelector('#pauseOverlay')?.remove();
    onBack(togglePause);
  };
  const leave = () => {
    if (lr) {
      lr.ch.send('done', { k: myId(), name: profile!.name, km: 0, finished: false, time: 0 });
      if (lr.kind === 'vibe') return vibeRoom();
      lr.ch.leave();
      return home('race');
    }
    leaveSolo();
  };
  const leaveSolo = () => (route.id === 'explore' ? explorePicker(route.from.name, route.to.name) : route.id === 'freshers-tour' ? explorePicker() : home(opts.event ? 'events' : opts.rivals || opts.challenge ? 'race' : route.kind === 'race' ? 'ride' : 'home'));
  $('pause').addEventListener('click', togglePause);
  const onHidden = () => { if (document.hidden && game.isRiding && !game.paused) togglePause(); };
  document.addEventListener('visibilitychange', onHidden);

  function cleanup() {
    music(false);
    if (keyHandler) removeEventListener('keydown', keyHandler);
    keyHandler = null;
    document.removeEventListener('visibilitychange', onHidden);
    game.onHud = () => {};
    game.onEnd = () => {};
    game.onAction = () => {};
    game.paused = false;
    clearInterval(stream);
    if (vibe) { vibe.onPos = null; vibe.redraw = null; }
  }

  game.calm = lr?.kind === 'vibe' || (isExplore(route) && exploreOpts.calm);
  // auto graphics: drop to smooth mode once if this phone can't keep up
  game.watchSpeed = settings.graphics === 'auto' && !settings.slowDevice;
  game.onSlow = () => {
    changeSettings({ slowDevice: true });
    prompt.innerHTML = `<small>GRAPHICS</small>Switched to smooth mode for this phone`;
    setTimeout(() => { if (prompt.textContent?.includes('smooth mode')) prompt.innerHTML = ''; }, 3000);
  };
  game.start(bike, tutorial);
  music(true);
  showUpdate('ride');
  onBack(togglePause);
}

// ---------- results ----------

interface ResultExtras {
  hadGhost: boolean;
  rivals: { name: string; time: number }[];
  run: GhostRun;
  opts: PlayOpts;
  event?: EventDef;
  prize?: string;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** A link that lets a friend race this run. */
const challengeLink = (route: Route, run: GhostRun, time: number) =>
  `${PLAY_URL}?c=${encodeChallenge({ routeId: route.id, name: profile?.name || 'A friend', time, run })}`;

/** the route a challenge or event names: the Campus Loop or one of the races */
function routeById(id: string): Route | null {
  if (id === CAMPUS_LOOP.id) return CAMPUS_LOOP;
  const def = RACES.find((r) => r.id === id);
  return def ? raceRoute(def) : null;
}

const hourText = (d: Date) => {
  const h = d.getHours();
  return h === 0 ? 'midnight' : `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
};
const inText = (d: Date) => {
  const m = Math.max(1, Math.round((d.getTime() - Date.now()) / 60000));
  return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
};

function playEvent(e: EventDef) {
  const route = routeById(e.race)!;
  play(false, route, eventStatus(e).live ? { event: e } : {});
}

/** what someone sees after opening a friend's challenge link */
function challengeIntro(ch: Challenge | null) {
  game.showcase();
  applyLook();
  const route = ch ? routeById(ch.routeId) : null;
  if (!ch || !route || !ch.run.d.length) {
    render(`
      <div class="screen scrim fade-in">
        <div class="grow"></div>
        <div class="wrap stack">
          <p class="kicker">Challenge</p>
          <h1 class="title">That link didn't work</h1>
          <p class="muted">The challenge link is incomplete or from an older version. Ask your friend to send it again.</p>
          <button class="btn btn-primary" id="quick">Race bots instead</button>
          <button class="btn btn-ghost" id="home">Home</button>
        </div>
      </div>`);
    on('#quick', 'click', () => quickMatch());
    on('#home', 'click', () => home());
    onBack(() => home());
    return;
  }
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">Challenge</p>
        <h1 class="title">${esc(ch.name)} challenges you</h1>
        <div class="card stack" style="gap:6px">
          <div class="row"><b>${esc(route.name)}</b><span class="grow"></span><span class="muted small">${(route.length / 1000).toFixed(1)} km</span></div>
          <p class="muted small">Beat <b>${clock(ch.time)}</b>. ${esc(ch.name)}'s exact ride races alongside you in yellow.</p>
        </div>
        <button class="btn btn-primary" id="go">Ride</button>
        <button class="btn btn-ghost" id="home">Not now</button>
      </div>
    </div>`);
  on('#go', 'click', () => play(!profile!.tutorialDone, route, { challenge: ch }));
  on('#home', 'click', () => home());
  onBack(() => home());
}

function garageScreen() {
  const p = profile!;
  const owns = (b: BikeSpec) => (!b.price && !b.event) || p.ownedBikes.includes(b.id);
  const card = (b: BikeSpec) => {
    const ev = b.event ? EVENTS.find((e) => e.id === b.event) : undefined;
    const action = p.bike === b.id ? '<span class="badge gold">Riding</span>'
      : owns(b) ? `<button class="btn btn-ghost btn-sm" data-equip="${b.id}">Ride this</button>`
      : b.price ? `<button class="btn btn-primary btn-sm" data-buy="${b.id}" ${p.coins < b.price ? 'disabled' : ''}>${fmt(b.price)} ${icons.coin}</button>`
      : `<span class="muted small">Win it in ${esc(ev?.name ?? 'an event')}</span>`;
    return `<div class="card bike-card garage-card ${p.bike === b.id ? 'selected' : ''}${owns(b) ? '' : ' locked-bike'}">
      <div class="hall-swatch" style="background:${b.color};margin:0 auto 8px"></div>
      <h3>${esc(b.name)}</h3>
      <p class="muted small">${esc(b.tagline)}</p>
      <div class="stat-line"><span>SPD</span><span class="dots">${dots(b.speed)}</span></div>
      <div class="stat-line"><span>ACC</span><span class="dots">${dots(b.acceleration)}</span></div>
      <div class="stat-line"><span>HDL</span><span class="dots">${dots(b.handling)}</span></div>
      <div class="garage-action">${action}</div>
    </div>`;
  };
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack">
        <button class="btn btn-link back" id="back">← Back</button>
        <div class="row"><h1 class="title">Garage</h1><span class="grow"></span><span class="chip">${icons.coin} ${fmt(p.coins)}</span></div>
        <p class="muted small">Buy bikes with Rush Coins, or win the event bikes by finishing Sunset Rush or Night Rush while they are live.</p>
        <div class="bike-grid garage-grid">${[...BIKES, ...GARAGE_BIKES].map(card).join('')}</div>
      </div>
    </div>`);
  const equip = (id: string) => {
    p.bike = id;
    saveProfile(p);
    applyLook();
    garageScreen();
  };
  on('[data-equip]', 'click', (_, el) => equip(el.dataset.equip!));
  on('[data-buy]', 'click', (_, el) => {
    const b = bikeById(el.dataset.buy!);
    if (!b.price || p.coins < b.price || p.ownedBikes.includes(b.id)) return;
    p.coins -= b.price;
    p.ownedBikes.push(b.id);
    sfx.finish();
    equip(b.id);
  });
  on('#back', 'click', () => home('you'));
  onBack(() => home('you'));
}

/** Quick Match: the standings fill in as the other riders finish */
function liveStandings(lr: LiveRide, r: RideResult) {
  const times = game.rivalTimes.map((t) => t.time);
  const left = new Set<number>();
  const draw = () => {
    const el = app.querySelector<HTMLElement>('#standings');
    if (!el) return;
    const rows = [{ name: 'You', time: r.finished ? r.time : Infinity, me: true, out: false }, ...lr.riders.map((v, i) => ({ name: v.name, time: times[i], me: false, out: left.has(i) }))].sort((a, b) => a.time - b.time);
    el.innerHTML = rows.map((t, i) => `<div class="reward-row${t.me ? ' me' : ''}"><span>${ordinal(i + 1)} · ${esc(t.name)}</span><b>${Number.isFinite(t.time) ? clock(t.time) : t.out || t.me ? 'DNF' : 'Riding…'}</b></div>`).join('');
  };
  lr.ch.on('done', (m: { k: string; finished: boolean; time: number }) => {
    const i = lr.riders.findIndex((v) => v.id === m.k);
    if (i < 0) return;
    if (m.finished) times[i] = Math.min(times[i], Number(m.time));
    else left.add(i);
    draw();
  });
  draw();
}

function results(r: RideResult, rw: RideRewards, route: Route, x: ResultExtras) {
  const p = profile!;
  const hadGhost = x.hadGhost;
  // standings: you and every rival, by finish time (unfinished last)
  const you = { name: 'You', time: r.finished ? r.time : Infinity, me: true };
  const table = x.rivals.length ? [you, ...x.rivals.map((v) => ({ ...v, me: false }))].sort((a, b) => a.time - b.time) : [];
  const ch = x.opts.challenge;
  const verdict = ch ? (r.finished && r.time < ch.time ? `You beat ${esc(ch.name)} by ${(ch.time - r.time).toFixed(1)} s` : `${esc(ch.name)} wins${r.finished ? ` by ${(r.time - ch.time).toFixed(1)} s` : ''}. Try again?`) : '';
  const prizeBike = x.prize ? bikeById(x.prize) : undefined;
  showUpdate('menu');
  const levelUp = rw.levelAfter > rw.levelBefore;
  const unlocked = RACES.filter((x) => x.level > rw.levelBefore && x.level <= rw.levelAfter);
  const explore = isExplore(route);
  const headline = r.finished ? (explore ? 'You made it' : 'Finish!') : 'Wiped out';
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">${esc(route.name)}</p>
        <h1 class="title">${headline}</h1>
        ${explore && r.finished && route.id === 'explore' ? placeCard(route.to) : ''}
        ${explore && r.finished ? `<p class="muted">${route.id === 'freshers-tour' ? `You toured ${TOUR_STOPS.length} places every fresher needs.` : `You found your way to <b>${esc(route.to.name)}</b>.`} Here is the way you rode:</p>${stepsList(route)}` : ''}
        ${rw.newBestTime ? '<span class="badge gold">New personal best 🔥</span>' : rw.newBestScore ? '<span class="badge gold">New high score 🔥</span>' : ''}
        <div class="result-big">${km(r.distance)} <span style="font-size:0.4em">KM</span></div>
        ${r.finished ? `<p class="muted">Time ${clock(r.time)}</p>` : ''}
        <div class="card">
          <div class="reward-row"><span>Score</span><b data-count="${rw.score}">0</b></div>
          <div class="reward-row"><span>Coins</span><b>+<span data-count="${rw.coins}">0</span> ${icons.coin}</b></div>
          <div class="reward-row"><span>XP</span><b>+<span data-count="${rw.xp}">0</span></b></div>
        </div>
        ${levelUp ? `<div class="levelup">🎉 Level up! You're now level ${rw.levelAfter}</div>` : ''}
        ${unlocked.map((x) => `<button class="card selectable unlock-card" data-race="${x.id}"><div class="row"><b>🔓 New race: ${esc(x.name)}</b><span class="grow"></span>${icons.arrow}</div><p class="muted small">${esc(x.blurb)}</p></button>`).join('')}
        ${verdict ? `<div class="levelup">${verdict}</div>` : ''}
        ${table.length > 1 ? `<div class="card standings" id="standings">${table.map((t, i) => `<div class="reward-row${t.me ? ' me' : ''}"><span>${ordinal(i + 1)} · ${esc(t.name)}</span><b>${Number.isFinite(t.time) ? clock(t.time) : 'DNF'}</b></div>`).join('')}</div>` : ''}
        ${x.event ? `<p class="muted small">${x.event.icon} ${esc(x.event.name)} is live: coins doubled.</p>` : ''}
        ${prizeBike ? `<div class="levelup">🚲 You won the ${esc(prizeBike.name)}! Equip it in the Garage.</div>` : ''}
        ${route.kind === 'race' && r.finished && !hadGhost && !x.rivals.length ? `<p class="muted small">Next time on this route, a ghost of this run rides with you. Beat it.</p>` : ''}
        ${route.kind === 'race' && r.finished ? `<button class="btn btn-ghost" id="challenge">${ch ? `Send ${esc(ch.name)} your answer` : 'Challenge a friend to beat this'}</button><p class="muted small" id="shareNote" hidden></p>` : ''}
        ${route.kind === 'race' && r.finished ? `<button class="btn btn-ghost" id="board">${cloud.account ? 'See the leaderboard' : 'Leaderboard · sign in to post your time'}</button>` : ''}
        ${p.guest ? `<div class="card stack"><p><b>Save your progress</b></p><p class="muted small">Create your rider to pick your hall and keep your stats.</p><button class="btn btn-ghost" id="create">Create rider</button></div>` : ''}
        <button class="btn btn-primary" id="again">Ride again</button>
        ${explore ? '<button class="btn btn-ghost" id="explore">Go somewhere else</button>' : ''}
        <button class="btn btn-ghost" id="home">Home</button>
      </div>
    </div>`);
  // animated counters
  app.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  on('#again', 'click', () => (x.opts.live ? quickMatch() : play(false, route, x.opts.rivals ? { ...x.opts, rivals: botRivals(route) } : x.opts)));
  on('#challenge', 'click', () => share(`Can you beat my ${clock(r.time)} on ${route.name}? Race my run on LEGONRUSH`, challengeLink(route, x.run, r.time), app.querySelector('#shareNote')!));
  on('#explore', 'click', () => explorePicker(route.id === 'explore' ? route.to.name : undefined));
  on('#home', 'click', () => home());
  on('#create', 'click', () => createRider({ ...p, name: '' }, false));
  on('#board', 'click', () => boardScreen(route.id, () => home('race')));
  on('[data-race]', 'click', (_, el) => play(false, raceRoute(RACES.find((x) => x.id === el.dataset.race)!)));
  onBack(() => home());
}

// ---------- hub ----------

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

type NavId = Tab | 'map' | 'garage';
/** id, label, icon, shown in the phone's bottom bar */
const NAV: [NavId, string, string, boolean][] = [
  ['home', 'Home', icons.home, true], ['ride', 'Ride', icons.ride, true], ['race', 'Race', icons.race, true],
  ['events', 'Events', icons.events, true], ['social', 'Social', icons.social, true],
  ['map', 'Map', icons.map, false], ['garage', 'Garage', icons.garage, false], ['you', 'Profile', icons.you, true],
];

function shell(content: string) {
  const c = campusById(settings.campus);
  return `
    <div class="shell">
      <nav class="nav">
        <div class="nav-brand"><div class="brand-mark">LEGON<span>RUSH</span></div></div>
        ${NAV.map(([id, label, icon, phone]) => `<button class="nav-item${tab === id ? ' active' : ''}${phone ? '' : ' desk-only'}" data-nav="${id}">${icon}<span>${id === 'you' ? '<i class="phone-only">You</i><i class="desk-only">Profile</i>' : id === 'social' ? '<i class="phone-only">Social</i><i class="desk-only">Community</i>' : label}</span></button>`).join('')}
        <button class="nav-campus" data-campus><small>📍 Riding on</small><b>${esc(c.id === 'ug' ? 'University of Ghana, Legon' : c.name)}</b><span class="small">Change campus →</span></button>
      </nav>
      <main class="content fade-in tab-${tab}">${tab === 'home' ? content : topBar() + content}</main>
    </div>`;
}

function topBar() {
  const p = profile!;
  const c = campusById(settings.campus);
  const level = levelFor(p.xp);
  const lo = xpForLevel(level), hi = xpForLevel(level + 1);
  return `<header class="topbar">
    <button class="campus-btn" data-campus aria-label="Choose campus">${icons.pin}<span>${esc(c.id === 'ug' ? 'UG · Legon' : c.short)}</span><em>▾</em></button>
    <div class="weather-pill" id="weather" hidden></div>
    <span class="grow"></span>
    <span class="coin-pill">${icons.coin} ${fmt(p.coins)}</span>
    <button class="icon-btn" id="bell" aria-label="Invites">${icons.bell}${notices.length ? `<i class="dot-badge">${notices.length}</i>` : ''}</button>
    <button class="me-btn" data-nav="you" aria-label="Your profile"><span class="avatar sm" style="background:${hallById(p.hall).color}">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="lv-wrap"><span class="lv">Lv ${level}</span><span class="lv-bar"><i style="width:${((p.xp - lo) / (hi - lo)) * 100}%"></i></span></span></button>
    <button class="icon-btn desk-only" id="settingsTop" aria-label="Settings">${icons.gear}</button>
  </header>`;
}

/** Legon's weather now, for the top bar; quietly absent when offline */
let weather: { icon: string; temp: number; word: string; at: number } | null = null;
const WEATHER: [number, string, string][] = [[0, '☀️', 'Sunny'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [48, '🌫️', 'Hazy'], [67, '🌧️', 'Rain'], [82, '🌦️', 'Showers'], [99, '⛈️', 'Storm']];
async function fillWeather() {
  const show = () => {
    const el = app.querySelector<HTMLElement>('#weather');
    if (!el || !weather) return;
    const now = new Date();
    el.innerHTML = `<span class="w-icon">${weather.icon}</span><span><b>${weather.temp}°C</b><small>${weather.word}</small></span><span class="w-sep"></span><span><b>${now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</b><small>${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</small></span>`;
    el.hidden = false;
  };
  if (weather && Date.now() - weather.at < 30 * 60e3) return show();
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=5.6505&longitude=-0.1869&current=temperature_2m,weather_code&timezone=Africa%2FAccra');
    const j = await r.json();
    const code = Number(j.current.weather_code);
    const [, icon, word] = WEATHER.find(([max]) => code <= max) ?? WEATHER[0];
    const night = new Date().getHours() >= 19 || new Date().getHours() < 6;
    weather = { icon: night && code <= 2 ? '🌙' : icon, temp: Math.round(j.current.temperature_2m), word: night && code <= 2 ? 'Clear' : word, at: Date.now() };
    show();
  } catch {
    /* offline: no weather */
  }
}

/** Choose a campus. Legon is open; the rest are coming soon. */
function campusSheet(after: () => void) {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `
    <div class="sheet light-ui" role="dialog" aria-label="Choose campus">
      <div class="row"><h2 class="title" style="font-size:22px">Choose campus</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
      <p class="muted small">We're starting with the University of Ghana. More campuses are on the way.</p>
      <p class="small campus-note" id="campusNote" hidden></p>
      <div class="campus-list">${CAMPUSES.map((c) => `<button class="campus-row${c.id === settings.campus ? ' on' : ''}${c.open ? '' : ' soon'}" data-c="${c.id}">
        <span class="campus-mark">${esc(c.id === 'ug' ? 'UG' : c.short.toUpperCase())}</span>
        <span class="grow"><b>${esc(c.name)}</b><small class="muted">${esc(c.short)} · ${esc(c.city)}</small></span>
        ${c.open ? (c.id === settings.campus ? '<span class="badge gold">Riding here</span>' : '<span class="badge gold">Open</span>') : '<span class="badge">Coming soon</span>'}
      </button>`).join('')}</div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); after(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  ov.querySelectorAll<HTMLElement>('[data-c]').forEach((b) => b.addEventListener('click', () => {
    const c = CAMPUSES.find((x) => x.id === b.dataset.c)!;
    if (!c.open) {
      const note = ov.querySelector<HTMLElement>('#campusNote')!;
      note.hidden = false;
      note.innerHTML = `<b>${esc(c.short)}</b> is coming soon. For now, ride Legon and tell your friends at ${esc(c.short)} to look out for it.`;
      return;
    }
    changeSettings({ campus: c.id });
    close();
  }));
}

const photo = (name: string) => `${import.meta.env.BASE_URL}photos/${name}.webp`;
const MODES = [
  { id: 'explore', icon: '🗺️', title: 'Explore', text: 'Discover campus, hidden routes and iconic locations.', img: photo('mode-explore') },
  { id: 'match', icon: '🏁', title: 'Quick Match', text: 'Get matched with riders online and race now.', img: photo('mode-match') },
  { id: 'challenge', icon: '🏆', title: 'Challenge', text: 'Create or join a challenge and beat your friends.', img: photo('mode-challenge') },
  { id: 'vibe', icon: '❤️', title: 'Vibe Ride', text: 'Meet someone, ride together and enjoy the ride.', img: photo('mode-vibe') },
];

const BIKE_ICON = '<svg class="qr-bike" viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="27" r="10"/><circle cx="51" cy="27" r="10"/><path d="M13 27l10-16h18l10 16M23 11l9 16h-19M32 27l9-16M20 6h8M41 11l-2-6h6"/></svg>';

function quickRideCard() {
  const c = campusById(settings.campus);
  return `<button class="qr" id="ride">${BIKE_ICON}
      <span class="qr-text"><span class="qr-kicker">Quick ride</span><span class="qr-big">Ride now</span><span class="qr-route">${esc(CAMPUS_LOOP.name)} · ${(CAMPUS_LOOP.length / 1000).toFixed(1)} km</span></span>
      <img class="qr-photo" src="${photo('qr-ride')}" alt="" width="1400" height="590">
      <span class="qr-go">${icons.arrow}</span>
    </button>
    <div class="qr-campus-row"><button class="qr-campus-chip" data-campus>${icons.pin} Campus: ${esc(c.id === 'ug' ? 'University of Ghana, Legon' : c.name)} <em>▾</em></button></div>`;
}

function missionsPanel() {
  const m = todayMissions(profile!);
  return `<div class="panel">
    <div class="panel-head"><span>🎯</span><b>Daily Missions</b><span class="muted small" style="margin-left:auto">Resets at midnight</span></div>
    <div class="mission-list">${MISSIONS.map((x) => {
      const got = Math.min(x.goal, x.progress(m));
      const done = got >= x.goal;
      const claimed = m.claimed.includes(x.id);
      return `<div class="mission${claimed ? ' claimed' : ''}">
        <span class="m-icon">${x.icon}</span>
        <div class="grow"><div class="small" style="font-weight:600">${esc(x.title)}</div><div class="xpbar"><div style="width:${(got / x.goal) * 100}%"></div></div></div>
        <span class="m-count">${x.unit ? got.toFixed(1) : got} / ${x.goal}</span>
        ${claimed ? '<span class="m-reward">✓</span>' : done ? `<button class="btn btn-primary btn-sm" data-mission="${x.id}">+${x.reward}</button>` : `<span class="m-reward">${icons.coin} ${x.reward}</span>`}
      </div>`;
    }).join('')}</div>
  </div>`;
}

function livePanel() {
  const live = EVENTS.find((e) => eventStatus(e).live);
  const e = live ?? [...EVENTS].sort((a, b) => eventStatus(a).next!.getTime() - eventStatus(b).next!.getTime())[0];
  const st = eventStatus(e);
  const [first, ...rest] = e.name.toUpperCase().split(' ');
  return `<button class="live-panel" data-event="${e.id}" style="--ev-img:url('${photo(e.id.includes('night') ? 'ev-night' : 'ev-sunset')}')">
    <span class="lp-tag"><i class="${live ? '' : 'off'}"></i>${live ? 'Live Event' : 'Next Event'}</span>
    <span class="lp-join">${live ? 'Join Now' : 'Practise'}</span>
    <h3>${esc(first)} <span>${esc(rest.join(' '))}</span></h3>
    <p>${live ? `2× coins and the ${esc(bikeById(e.prize).name)} until ${hourText(st.ends!)}.` : esc(e.blurb)}</p>
    <span class="lp-meta"><span>📅 ${live ? 'Now' : `Today · ${hourText(st.next)}`}</span><span>📍 ${esc(routeById(e.race)?.name ?? 'Campus')}</span></span>
  </button>`;
}

function onlinePanel() {
  return `<div class="panel online-panel">
    <div class="panel-head"><span>👥</span><b>Riders Online</b><span class="small" style="margin-left:auto;font-weight:600"><span class="dot-live"></span> <span id="onlineCount">${onlineCountText()}</span></span></div>
    <div id="onlineList" class="online-list">${onlineRows()}</div>
  </div>`;
}

const onlineCountText = () => (lobbyState === 'on' ? `${online.length + 1} online` : lobbyState === 'off' ? 'Offline' : 'Connecting…');

function onlineCard() {
  return `<div class="card stack online-card" style="gap:8px">
    <div class="row"><b>Riders online</b><span class="grow"></span><span class="small" style="font-weight:600"><span class="dot-live"></span> <span id="onlineCount">${onlineCountText()}</span></span></div>
    <div id="onlineList" class="online-list">${onlineRows()}</div>
  </div>`;
}

function onlineRows() {
  if (lobbyState === 'off') return '<p class="muted small">Live riders show here when you are online.</p>';
  if (!online.length) return `<p class="muted small">${lobbyState === 'on' ? "You're the only one riding right now. Invite a friend to Vibe Ride." : 'Looking for riders…'}</p>`;
  const STATUS: Record<string, string> = { menu: 'Online', riding: 'Riding', vibe: 'Looking for a vibe ride', match: 'Looking for a race', room: 'In a vibe ride' };
  return online.slice(0, 8).map((r) => `<div class="online-row">
    <span class="on-dot"></span>
    <span class="avatar xs" style="background:${hallById(r.state.hall).color}">${esc(r.state.name.slice(0, 1).toUpperCase())}</span>
    <span class="grow"><b>${esc(r.state.name)}</b><small class="muted">${esc(hallById(r.state.hall).short)} · ${STATUS[r.state.status] ?? 'Online'}</small></span>
    <button class="btn btn-ghost btn-sm" data-invite="${esc(r.key)}">Invite</button>
  </div>`).join('') + (online.length > 8 ? `<p class="muted small">and ${online.length - 8} more</p>` : '');
}

function home(next: Tab = 'home') {
  if (!profile) return welcome();
  if (pendingVibe && !profile.guest) {
    const v = pendingVibe;
    pendingVibe = null;
    return void joinVibe(v.code, false, v.name);
  }
  stopSearching();
  tab = next;
  game.showcase();
  applyLook();
  setStatus('menu');
  const p = profile;
  const level = levelFor(p.xp);
  const lo = xpForLevel(level);
  const hi = xpForLevel(level + 1);
  const hall = hallById(p.hall);
  const best = p.bestTimes[CAMPUS_LOOP.id];
  const daily = dailyReward(p);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const TIME_ICON = { day: '☀️', sunset: '🌅', night: '🌙' };
  const raceCard = (r: RaceDef) => {
    if (level < r.level) {
      return `<div class="card locked"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge">Level ${r.level}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">Reach level ${r.level} to unlock.</p></div>`;
    }
    const route = raceRoute(r);
    const b = p.bestTimes[r.id];
    return `<button class="card selectable" data-race="${r.id}" style="text-align:left"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">${(route.length / 1000).toFixed(1)} km · Difficulty ${stars(r.difficulty)}${b ? ` · Best ${clock(b)} 👻` : ''}</p></button>`;
  };
  const week = currentWeek(p);
  const eventCard = (e: EventDef) => {
    const st = eventStatus(e);
    const route = routeById(e.race)!;
    const prize = bikeById(e.prize);
    const won = p.ownedBikes.includes(e.prize);
    return `<div class="card stack event-card${st.live ? ' live' : ''}" style="gap:8px">
      <div class="row"><h3 style="font-weight:800">${e.icon} ${esc(e.name.toUpperCase())}</h3><span class="grow"></span><span class="badge${st.live ? ' gold live-badge' : ''}">${st.live ? 'Live now' : `Starts at ${hourText(st.next)}`}</span></div>
      <p class="muted small">${esc(e.blurb)}</p>
      <p class="small">${esc(route.name)} · ${(route.length / 1000).toFixed(1)} km · ${st.live ? `<b>2× coins</b>, ends ${hourText(st.ends!)}` : `opens ${inText(st.next)}`}</p>
      <div class="row small"><span class="hall-swatch" style="background:${prize.color}"></span><span>${won ? `You won the ${esc(prize.name)} ✓` : `Finish while live to win the <b>${esc(prize.name)}</b>`}</span></div>
      <button class="btn ${st.live ? 'btn-primary' : 'btn-ghost'}" data-event="${e.id}">${st.live ? 'Ride now' : 'Practise the route'}</button>
    </div>`;
  };
  const unlocked = [CAMPUS_LOOP, ...RACES.filter((r) => level >= r.level).map(raceRoute)];
  const exploreCard = `<button class="card selectable explore-card" id="exploreBtn"><div class="row"><h3 style="font-weight:800">🗺️ EXPLORE</h3><span class="grow"></span><span class="badge gold">Directions</span></div><p class="muted small" style="margin-top:4px">Discover the campus your way. Ride freely through familiar places, find hidden routes and shortcuts, and visit iconic landmarks.</p></button>
    <button class="card selectable explore-card" id="quizBtn"><div class="row"><h3 style="font-weight:800">📍 WHERE IS IT?</h3><span class="grow"></span><span class="badge gold">Earn ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">Five campus places. Tap the map where you think each one is.</p></button>`;
  const firstName = p.name.split(' ')[0];

  const views: Record<Tab, string> = {
    home: `
      <div class="home">
        ${topBar()}
        <div class="home-head">
          <section class="hello">
            <p class="greet">${greeting()},</p>
            <h1>${esc(firstName)} <span class="wave">👋</span></h1>
            <p class="slogan">Your campus. Your ride. Your competition.</p>
          </section>
          <div class="stat-chips">
            <div class="stat-chip"><span class="s-ico">👑</span><span><b>${level}</b><small>Level</small></span></div>
            <div class="stat-chip opt-chip"><span class="s-ico">🚲</span><span><b>${p.rides}</b><small>Rides</small></span></div>
            <div class="stat-chip"><span class="s-ico">🚩</span><span><b>${(p.totalDistance / 1000).toFixed(1)} km</b><small>Distance</small></span></div>
            <div class="stat-chip"><span class="s-ico">🏆</span><span><b>${p.wins}</b><small>Races won</small></span></div>
            ${daily ? `<button class="stat-chip daily-chip" id="daily"><span class="s-ico">🎁</span><span><b>+${daily.coins}</b><small>Daily reward</small></span></button>` : ''}
          </div>
        </div>
        ${quickRideCard()}
        <div class="modes">${MODES.map((m) => `<button class="mode-card" data-mode="${m.id}"><img class="mode-img" src="${m.img}" alt="" width="760" height="320"><span class="mode-body"><span class="mode-title"><span class="mode-ico">${m.icon}</span>${esc(m.title)}</span><span class="mode-text">${esc(m.text)}</span></span><span class="mode-go">${icons.arrow}</span></button>`).join('')}</div>
        <div class="home-bottom">
          ${missionsPanel()}
          ${livePanel()}
          ${onlinePanel()}
        </div>
      </div>`,
    ride: `
      <div class="hub">
        <p class="kicker">Ride</p>
        <h1 class="title">Where to?</h1>
        ${quickRideCard()}
        ${exploreCard}
        <p class="kicker" style="margin-top:8px">Races</p>
        <p class="muted small">Beat your best time: a ghost of your best run rides with you.</p>
        <div class="card selectable" id="routeCard">
          <div class="row"><h3 style="font-weight:800">${esc(CAMPUS_LOOP.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div>
          <p class="muted small" style="margin-top:4px">${(CAMPUS_LOOP.length / 1000).toFixed(1)} km · Difficulty ${stars(CAMPUS_LOOP.difficulty)}${best ? ` · Best ${clock(best)} 👻` : ''}</p>
        </div>
        ${RACES.map(raceCard).join('')}
      </div>`,
    race: `
      <div class="hub">
        <p class="kicker">Race</p>
        <h1 class="title">Race someone</h1>
        <button class="ride-cta" id="quick">
          <div><div class="big" style="font-size:26px">🏁 QUICK MATCH</div><div class="sub">Race against riders online. Get matched with available riders and jump straight into a live race.</div></div>${icons.arrow}
        </button>
        <p class="kicker" style="margin-top:8px">⚡ Challenge</p>
        <p class="muted small">Create a route challenge and invite others, or join one someone shared with you. Beat their time and claim the top spot.</p>
        <div class="card stack" style="gap:8px">
          <b>Create a challenge</b>
          <p class="muted small">Pick a route. Ride it, then send your run. Your friends race your exact ride.</p>
          ${unlocked.map((r) => {
            const b = p.bestTimes[r.id];
            const ghost = b && loadGhost(r.id);
            return `<div class="row challenge-row"><span class="grow"><b>${esc(r.name)}</b><small class="muted">${(r.length / 1000).toFixed(1)} km${b ? ` · your best ${clock(b)}` : ''}</small></span>${ghost ? `<button class="btn btn-primary btn-sm" data-send="${r.id}">Send</button>` : `<button class="btn btn-ghost btn-sm" data-set="${r.id}">Set a time</button>`}</div>`;
          }).join('')}
          <p class="muted small" id="sendNote" hidden></p>
        </div>
        <div class="card stack">
          <b>Join a challenge</b>
          <div class="field"><label for="cLink">Paste the link or code a friend sent you</label><input id="cLink" autocapitalize="off" autocomplete="off" placeholder="${esc(PLAY_URL.replace(/^https?:\/\//, ''))}?c=..."></div>
          <button class="btn btn-ghost" id="cOpen">Open challenge</button>
        </div>
        <button class="card selectable" id="boards" style="text-align:left"><div class="row"><h3 style="font-weight:800">🏆 LEADERBOARDS</h3><span class="grow"></span><span class="badge gold">Live</span></div><p class="muted small" style="margin-top:4px">The fastest riders on every route, and this week's hall standings.${cloud.account ? '' : ' Sign in to post your times.'}</p></button>
      </div>`,
    events: `
      <div class="hub">
        <p class="kicker">Events</p>
        <h1 class="title">Campus events</h1>
        <p class="muted">Ride an event while it is live for double coins and a bike you can only win there.</p>
        ${EVENTS.map(eventCard).join('')}
        <div class="card stack" style="gap:8px">
          <div class="row"><h3 style="font-weight:800">🏫 HALL WEEK</h3><span class="grow"></span><span class="badge gold">+${WEEK_REWARD} ${icons.coin}</span></div>
          <p class="muted small">Ride ${WEEK_GOAL_KM} km for ${esc(hall.name)} between Monday and Sunday. Every ride counts.</p>
          <div class="xpbar"><div style="width:${Math.min(100, (week.km / WEEK_GOAL_KM) * 100)}%"></div></div>
          <div class="row small"><span>${Math.min(week.km, WEEK_GOAL_KM).toFixed(1)} / ${WEEK_GOAL_KM} km</span><span class="grow"></span><span class="muted">${week.claimed ? 'Claimed ✓ New goal on Monday' : 'Resets on Monday'}</span></div>
          ${week.km >= WEEK_GOAL_KM && !week.claimed ? `<button class="btn btn-primary" id="weekClaim">Claim ${WEEK_REWARD} coins</button>` : ''}
          <button class="btn btn-ghost" id="hallBoard">See how ${esc(hall.short)} ranks this week</button>
          ${cloud.account ? '' : '<p class="muted small">Sign in so your kilometres count for your hall.</p>'}
        </div>
      </div>`,
    social: socialView(),
    you: `
      <div class="hub">
        <div class="row" style="gap:14px">
          <div class="avatar" style="background:${hall.color}">${esc(p.name.slice(0, 1).toUpperCase())}</div>
          <div>
            <h1 class="title" style="font-size:26px">${esc(p.name)}</h1>
            ${p.username ? `<p class="muted">@${esc(p.username)}</p>` : ''}
            <p class="small" style="margin-top:4px">Level ${level} · ${esc(hall.name)}</p>
            ${p.department ? `<p class="muted small">${esc(p.department)}</p>` : ''}
            ${p.snap ? `<p class="muted small">👻 @${esc(p.snap)}${p.snapPublic ? '' : ' · hidden'}</p>` : ''}
          </div>
        </div>
        <div class="card stack" style="gap:8px">
          <div class="row"><b>Level ${level}</b><span class="grow"></span><span class="muted small">${fmt(p.xp - lo)} / ${fmt(hi - lo)} XP</span></div>
          <div class="xpbar"><div style="width:${((p.xp - lo) / (hi - lo)) * 100}%"></div></div>
        </div>
        <div class="stats">
          <div class="stat"><b>${km(p.totalDistance)}</b><span>KM ridden</span></div>
          <div class="stat"><b>${p.rides}</b><span>Rides</span></div>
          <div class="stat"><b>${p.wins}</b><span>Races won</span></div>
          <div class="stat"><b>${p.finishes}</b><span>Finishes</span></div>
          <div class="stat"><b>${fmt(p.coins)}</b><span>Rush coins</span></div>
          <div class="stat"><b>${fmt(p.bestScore)}</b><span>Best score</span></div>
        </div>
        <button class="card selectable row" id="garage"><span class="hall-swatch" style="background:${bikeById(p.bike).color}"></span><span class="muted small">Bike</span><b>${bikeById(p.bike).name}</b><span class="grow"></span><span class="small">Garage ${icons.arrow}</span></button>
        <div class="two"><button class="btn btn-ghost" id="dress">Dress rider</button><button class="btn btn-ghost" id="edit">${p.guest ? 'Create rider' : 'Edit details'}</button></div>
        <button class="btn btn-ghost" id="settings">Settings</button>
        ${installPrompt ? '<button class="btn btn-ghost" id="install">Install app</button>' : ''}
        ${cloud.account
          ? `<div class="card stack" style="gap:8px"><div class="row"><b>Account</b><span class="grow"></span><span class="badge gold">Synced</span></div><p class="muted small">Signed in as ${esc(cloud.account.email)}. Your progress is saved to your account and follows you to any device.</p><button class="btn btn-ghost" id="signOut">Sign out</button></div>`
          : `<div class="card stack" style="gap:8px"><b>Save your progress online</b><p class="muted small">Sign in to keep your progress on any device, post your race times and ride for your hall.</p><button class="btn btn-primary" id="signIn">Sign in or create an account</button></div>
        <button class="btn btn-link" id="reset">Reset progress</button>
        <p class="muted small">Progress is saved on this device until you sign in.</p>`}
      </div>`,
  };

  render(shell(views[tab]));
  void fillWeather();
  // who's online loads a moment later, so the menu itself is never held up
  setTimeout(connectLobby, 1500);
  on('[data-nav]', 'click', (_, el) => {
    const id = el.dataset.nav as NavId;
    if (id === 'map') return explorePicker();
    if (id === 'garage') return garageScreen();
    home(id);
  });
  on('[data-campus]', 'click', () => campusSheet(() => home(tab)));
  on('#bell', 'click', () => noticesSheet());
  on('#settingsTop', 'click', () => settingsScreen());
  on('[data-mode]', 'click', (_, el) => {
    const m = el.dataset.mode;
    if (m === 'explore') explorePicker();
    if (m === 'match') quickMatch();
    if (m === 'challenge') home('race');
    if (m === 'vibe') home('social');
  });
  on('[data-mission]', 'click', (_, el) => {
    if (claimMission(p, el.dataset.mission!)) sfx.finish();
    home(tab);
  });
  on('[data-invite]', 'click', (_, el) => inviteOnline(el.dataset.invite!));
  on('#ride', 'click', () => play(false));
  on('#routeCard', 'click', () => play(false));
  on('#exploreBtn', 'click', () => explorePicker());
  on('[data-race]', 'click', (_, el) => play(false, raceRoute(RACES.find((r) => r.id === el.dataset.race)!)));
  on('#settings', 'click', () => settingsScreen());
  on('#quick', 'click', () => quickMatch());
  on('#boards', 'click', () => boardScreen(CAMPUS_LOOP.id, () => home('race')));
  on('#hallBoard', 'click', () => boardScreen('halls', () => home('events')));
  on('#signIn', 'click', () => authScreen('in', () => home('you')));
  on('#signOut', 'click', async (_, el) => {
    (el as HTMLButtonElement).disabled = true;
    await cloud.signOut();
    // the progress lives in the account now, so this device starts fresh
    clearProfile();
    clearGhosts();
    profile = null;
    resetLobby();
    welcome();
  });
  on('#garage', 'click', () => garageScreen());
  on('[data-event]', 'click', (_, el) => playEvent(EVENTS.find((e) => e.id === el.dataset.event)!));
  on('[data-send]', 'click', (_, el) => {
    const route = routeById(el.dataset.send!)!;
    share(`Can you beat my ${clock(p.bestTimes[route.id])} on ${route.name}? Race my run on LEGONRUSH`, challengeLink(route, loadGhost(route.id)!, p.bestTimes[route.id]), app.querySelector('#sendNote')!);
  });
  on('[data-set]', 'click', (_, el) => play(false, routeById(el.dataset.set!)!));
  on('#cOpen', 'click', () => {
    const raw = (app.querySelector('#cLink') as HTMLInputElement).value.trim();
    let code = raw;
    try {
      code = new URL(raw.includes('://') ? raw : `https://${raw}`).searchParams.get('c') ?? raw;
    } catch { /* a bare code */ }
    challengeIntro(decodeChallenge(code));
  });
  on('#weekClaim', 'click', () => {
    if (week.claimed || week.km < WEEK_GOAL_KM) return;
    week.claimed = true;
    p.coins += WEEK_REWARD;
    saveProfile(p);
    sfx.finish();
    home('events');
  });
  on('#daily', 'click', () => {
    if (claimDaily(p)) sfx.finish();
    home('home');
  });
  bindSocial();
  showUpdate('menu');
  // back from another tab goes to Home; from Home it leaves the app
  onBack(tab === 'home' ? null : () => home());
  on('#quizBtn', 'click', () => whereIsIt());
  on('#edit', 'click', () => createRider({ ...p, look: structuredClone(p.look) }, !p.guest));
  on('#dress', 'click', () => dressRider({ ...p, look: structuredClone(p.look) }, true));
  on('#install', 'click', async () => {
    await installPrompt?.prompt();
    installPrompt = null;
  });
  on('#reset', 'click', (_, el) => {
    // two taps instead of confirm(), which some embedded browsers block
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1';
      el.textContent = 'Tap again to erase all progress';
      return;
    }
    clearProfile();
    clearGhosts();
    profile = null;
    welcome();
  });
}

// ---------- riding with people: who is online, invites, Quick Match, Vibe Ride ----------

const DEVICE_KEY = 'legonrush.device.v1';
const deviceId = (() => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = `d-${crypto.randomUUID()}`));
    return id;
  } catch {
    return `d-${Math.random().toString(36).slice(2)}`;
  }
})();
/** who you are to other riders: your account, or this device for guests */
const myId = () => cloud.account?.id ?? deviceId;

type Status = 'menu' | 'riding' | 'vibe' | 'match' | 'room';
interface RiderState {
  id: string;
  name: string;
  hall: string;
  department: string;
  jersey: string;
  level: number;
  status: Status;
  /** what a rider looking for a vibe ride wants: anyone, their hall or their department */
  want?: VibeWant;
  at: number;
}
type VibeWant = 'anyone' | 'hall' | 'dept';

const riderState = (status: Status, extra: Partial<RiderState> = {}): RiderState => ({
  id: myId(), name: profile?.name ?? 'Rider', hall: profile?.hall ?? 'none', department: profile?.department ?? '',
  jersey: profile ? riderLook(profile).jersey : '#f5c518', level: levelFor(profile?.xp ?? 0), status, at: Date.now(), ...extra,
});

let lobby: Promise<live.Channel | null> | null = null;
let lobbyCh: live.Channel | null = null;
let lobbyState: 'connecting' | 'on' | 'off' = 'connecting';
let online: live.Peer<RiderState>[] = [];
let myStatus: RiderState = riderState('menu');
/** set while searching, to hear a pairing or match meant for you */
let onPair: ((m: { code: string; from: RiderState }) => void) | null = null;
let onMatch: ((m: MatchMsg) => void) | null = null;

/** Joins this campus's lobby once, in the background: who is online, and invites meant for you. */
function connectLobby() {
  if (lobby || !profile) return lobby;
  lobbyState = 'connecting';
  lobby = live.join(`lobby:${settings.campus}`, myId(), { ...myStatus }).then((ch) => {
    lobbyCh = ch;
    lobbyState = ch ? 'on' : 'off';
    if (!ch) {
      lobby = null;
      refreshOnline();
      return null;
    }
    ch.onPeers((peers) => {
      online = peers.filter((p) => p.state?.name).sort((a, b) => (a.state.status === 'riding' ? 1 : 0) - (b.state.status === 'riding' ? 1 : 0));
      refreshOnline();
    });
    ch.on('invite', (m: { to: string; code: string; from: RiderState }) => {
      if (m.to === myId()) gotInvite({ id: `l-${m.code}`, code: m.code, from: m.from, at: Date.now() });
    });
    ch.on('pair', (m: { to: string; code: string; from: RiderState }) => {
      if (m.to === myId()) onPair?.(m);
    });
    ch.on('match', (m: MatchMsg) => {
      if (m.riders.some((r) => r.id === myId())) onMatch?.(m);
    });
    return ch;
  });
  return lobby;
}

function resetLobby() {
  lobbyCh?.leave();
  lobbyCh = null;
  lobby = null;
  online = [];
}

function setStatus(status: Status, extra: Partial<RiderState> = {}) {
  myStatus = riderState(status, extra);
  lobbyCh?.track({ ...myStatus });
}

function refreshOnline() {
  const list = app.querySelector<HTMLElement>('#onlineList');
  const count = app.querySelector<HTMLElement>('#onlineCount');
  if (count) count.textContent = onlineCountText();
  if (list) {
    list.innerHTML = onlineRows();
    list.querySelectorAll<HTMLElement>('[data-invite]').forEach((b) => b.addEventListener('click', () => inviteOnline(b.dataset.invite!)));
  }
  searchTick?.();
}

// ---------- notifications ----------

interface Notice {
  id: string;
  code: string;
  from: { id: string; name: string; hall: string };
  at: number;
  dbId?: number;
}
let notices: Notice[] = [];

const toastBox = document.createElement('div');
toastBox.className = 'toasts';
document.body.appendChild(toastBox);

/** A message at the top of the screen, with up to two buttons. */
function toast(html: string, actions: [string, () => void, boolean?][] = [], ms = 12000) {
  const t = document.createElement('div');
  t.className = 'toast fade-in';
  t.innerHTML = `<div class="grow">${html}</div>${actions.map(([label, , primary], i) => `<button class="btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}" data-i="${i}">${esc(label)}</button>`).join('')}`;
  const close = () => t.remove();
  t.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', () => { close(); actions[Number(b.dataset.i)][1](); }));
  toastBox.appendChild(t);
  setTimeout(close, ms);
  while (toastBox.children.length > 3) toastBox.firstElementChild!.remove();
}

const inviteText = (name: string) => `${name} is inviting you to ride with them`;

function gotInvite(n: Notice) {
  if (notices.some((x) => x.code === n.code) || vibe?.code === n.code) return;
  notices.unshift(n);
  notices = notices.slice(0, 10);
  sfx.coin?.();
  const bell = app.querySelector('#bell');
  if (bell) bell.innerHTML = `${icons.bell}<i class="dot-badge">${notices.length}</i>`;
  toast(`💛 <b>${esc(n.from.name)}</b> is inviting you to ride with them`, [['Accept', () => acceptNotice(n), true], ['Not now', () => {}]], 20000);
  // the game is open in the background: tell the phone too
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('LEGONRUSH', { body: inviteText(n.from.name), icon: `${import.meta.env.BASE_URL}icons/icon-192.png`, tag: n.code });
    } catch { /* some phones only allow this from a service worker */ }
  }
}

function dropNotice(n: Notice) {
  notices = notices.filter((x) => x !== n);
  if (n.dbId) void cloud.answerInvite(n.dbId);
}

function acceptNotice(n: Notice) {
  dropNotice(n);
  if (game.isRiding) return toast('Finish this ride first, then accept from the 🔔.');
  void joinVibe(n.code, false);
}

function noticesSheet() {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui">
    <div class="row"><h2 class="title" style="font-size:22px">Invites</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    ${notices.length ? notices.map((n, i) => `<div class="online-row"><span class="avatar xs" style="background:${hallById(n.from.hall).color}">${esc(n.from.name.slice(0, 1).toUpperCase())}</span><span class="grow"><b>${esc(inviteText(n.from.name))}</b><small class="muted">Vibe Ride · code ${esc(n.code)}</small></span><button class="btn btn-primary btn-sm" data-yes="${i}">Accept</button><button class="btn btn-link" data-no="${i}">✕</button></div>`).join('') : '<p class="muted">No invites right now. When someone invites you to a Vibe Ride, it shows up here.</p>'}
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); if (!game.isRiding && app.querySelector('.shell')) home(tab); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  ov.querySelectorAll<HTMLElement>('[data-yes]').forEach((b) => b.addEventListener('click', () => { ov.remove(); acceptNotice(notices[Number(b.dataset.yes)]); }));
  ov.querySelectorAll<HTMLElement>('[data-no]').forEach((b) => b.addEventListener('click', () => { dropNotice(notices[Number(b.dataset.no)]); ov.remove(); noticesSheet(); }));
}

/** invites left while you were away */
async function loadInvites() {
  try {
    for (const i of (await cloud.pendingInvites()).reverse()) gotInvite({ id: `db-${i.id}`, dbId: i.id, code: i.code, from: i.from, at: Date.parse(i.at) });
  } catch {
    /* offline, or the invites table isn't set up yet */
  }
}

// ---------- Social tab ----------

function socialView() {
  const canAlert = 'Notification' in window && Notification.permission === 'default';
  return `
    <div class="hub">
      <p class="kicker">💛 Vibe Ride</p>
      <h1 class="title">Ride together</h1>
      <p class="muted">Find someone and enjoy the ride together. Get paired with an online rider, or create a private ride and invite someone with a link or code. No racing: just ride, connect and enjoy the campus.</p>
      <div class="card stack" style="gap:10px">
        <b>Find a rider</b>
        <p class="muted small">We pair you with someone online who wants a ride too.</p>
        <div class="seg wide" id="want">${(['anyone', 'hall', 'dept'] as VibeWant[]).map((w) => `<button data-v="${w}" class="${w === vibeWant ? 'on' : ''}">${w === 'anyone' ? 'Anyone' : w === 'hall' ? 'My hall' : 'My department'}</button>`).join('')}</div>
        <button class="btn btn-primary" id="vibeFind">Find a rider</button>
      </div>
      <div class="card stack" style="gap:10px">
        <b>Private ride</b>
        <p class="muted small">Create a ride and share the invite on Snapchat, WhatsApp or anywhere. Your friend gets "${esc(profile!.name)} is inviting you to ride with them".</p>
        <button class="btn btn-ghost" id="vibeNew">Create a private ride</button>
        <div class="row"><input class="code-in" id="vibeCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Got a code?"><button class="btn btn-ghost btn-sm" id="vibeJoin">Join</button></div>
      </div>
      ${canAlert ? '<button class="btn btn-link" id="alerts">🔔 Turn on invite alerts</button>' : ''}
      ${onlineCard()}
      <div class="two"><button class="btn btn-ghost" id="hallStand">Hall standings</button><button class="btn btn-ghost" id="deptStand">Departments</button></div>
    </div>`;
}

let vibeWant: VibeWant = 'anyone';

function bindSocial() {
  on('#want button', 'click', (_, el) => {
    vibeWant = el.dataset.v as VibeWant;
    app.querySelectorAll('#want button').forEach((b) => b.classList.toggle('on', b === el));
  });
  on('#vibeFind', 'click', () => vibeFind());
  on('#vibeNew', 'click', () => void joinVibe(live.newCode(), true));
  on('#vibeJoin', 'click', () => {
    const code = (app.querySelector<HTMLInputElement>('#vibeCode')!.value || '').trim().toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(code)) void joinVibe(code, false);
  });
  on('#alerts', 'click', async (_, el) => {
    try { await Notification.requestPermission(); } catch { /* not supported */ }
    el.remove();
  });
  on('#hallStand', 'click', () => boardScreen('halls', () => home('social')));
  on('#deptStand', 'click', () => boardScreen('depts', () => home('social')));
}

/** Vibe Ride needs a name others can see, so guests make a rider first. */
function needsRider() {
  if (!profile!.guest) return false;
  toast('Create your rider first, so people know who they are riding with.', [['Create rider', () => createRider({ ...profile!, name: '' }, false), true]]);
  return true;
}

/** a rider from Riders Online: start a private ride and invite them to it */
async function inviteOnline(key: string) {
  if (needsRider()) return;
  const peer = online.find((p) => p.key === key);
  if (!peer) return;
  const code = vibe?.code ?? live.newCode();
  lobbyCh?.send('invite', { to: key, code, from: riderState('room') });
  if (!vibe) await joinVibe(code, true);
  vibe?.msgs.push({ sys: true, text: `Invite sent to ${peer.state.name}.`, at: Date.now() });
  vibe?.redraw?.('chat');
}

// ---------- searching (Vibe Ride pairing and Quick Match) ----------

let searchTick: (() => void) | null = null;
let searchTimer = 0;
function stopSearching() {
  searchTick = null;
  onPair = null;
  onMatch = null;
  clearInterval(searchTimer);
}

function searchScreen(kicker: string, title: string, text: string, fallback: string) {
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack center-text">
        <p class="kicker">${kicker}</p>
        <div class="pulse-ring"><span>${icons.ride}</span></div>
        <h1 class="title">${title}</h1>
        <p class="muted" id="searchText">${text}</p>
        <button class="btn btn-ghost" id="fallback">${fallback}</button>
        <button class="btn btn-link" id="cancel">Cancel</button>
      </div>
    </div>`);
}

/** Pairs you with someone online who also wants a Vibe Ride. */
async function vibeFind() {
  if (needsRider()) return;
  stopSearching();
  searchScreen('💛 Vibe Ride', 'Finding a rider', 'Looking for someone online who wants to ride…', 'Invite a friend instead');
  on('#fallback', 'click', () => { stopSearching(); void joinVibe(live.newCode(), true); });
  on('#cancel', 'click', () => home('social'));
  onBack(() => home('social'));
  const ch = await connectLobby();
  if (!ch) return searchFailed('You need to be online to find a rider.');
  const want = vibeWant;
  setStatus('vibe', { want });
  const p = profile!;
  const fits = (s: RiderState) => {
    const ok = (w: VibeWant | undefined, a: RiderState | Profile, b: { hall: string; department: string }) =>
      !w || w === 'anyone' || (w === 'hall' && a.hall === b.hall) || (w === 'dept' && !!a.department && a.department === b.department);
    return s.status === 'vibe' && ok(want, p, s) && ok(s.want, s, p);
  };
  const started = Date.now();
  let done = false;
  onPair = (m) => {
    if (done) return;
    done = true;
    stopSearching();
    void joinVibe(m.code, false, m.from.name);
  };
  searchTick = () => {
    if (done) return;
    const match = online.find((o) => fits(o.state));
    const text = app.querySelector('#searchText');
    if (text) text.textContent = match ? `Found ${match.state.name}. Connecting…` : Date.now() - started > 60e3 ? "Nobody is free right now. Invite a friend, or keep waiting." : `Looking for someone online who wants to ride… ${online.length ? `(${online.length} online)` : ''}`;
    // the rider whose id sorts first sets up the ride, so both don't
    if (match && myId() < match.key) {
      done = true;
      const code = live.newCode();
      ch.send('pair', { to: match.key, code, from: riderState('room') });
      stopSearching();
      void joinVibe(code, true, match.state.name);
    }
  };
  searchTimer = window.setInterval(() => searchTick?.(), 1000);
  searchTick();
}

function searchFailed(text: string) {
  stopSearching();
  const t = app.querySelector('#searchText');
  if (t) t.textContent = text;
}

// ---------- Quick Match ----------

interface MatchMsg {
  code: string;
  route: string;
  riders: { id: string; name: string; jersey: string }[];
}

/** Race against riders online; bots fill in when nobody else is looking. */
async function quickMatch() {
  if (!profile) return;
  stopSearching();
  const level = levelFor(profile.xp);
  const bots = (note = '') => {
    stopSearching();
    const pool = [CAMPUS_LOOP, ...RACES.filter((r) => level >= r.level).map(raceRoute)];
    const route = pool[Math.floor(Math.random() * pool.length)];
    if (note) toast(note, [], 5000);
    play(false, route, { rivals: botRivals(route) });
  };
  searchScreen('🏁 Quick Match', 'Finding riders', 'Looking for riders online…', 'Race bots now');
  on('#fallback', 'click', () => bots());
  on('#cancel', 'click', () => home('race'));
  onBack(() => home('race'));
  const ch = await connectLobby();
  if (!ch) return bots("You're offline, so you're racing bots this time.");
  setStatus('match');
  const started = Date.now();
  let done = false;
  const go = (m: MatchMsg) => {
    if (done) return;
    done = true;
    stopSearching();
    void startLiveRace(m);
  };
  onMatch = go;
  searchTick = () => {
    if (done) return;
    const others = online.filter((o) => o.state.status === 'match');
    const waited = Date.now() - started;
    const text = app.querySelector('#searchText');
    if (text) text.textContent = others.length ? `${others.length + 1} riders ready. Starting soon…` : `Looking for riders online… ${online.length ? `(${online.length} online)` : ''}`;
    const group = [myStatus, ...others.map((o) => o.state)].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 4);
    // the rider whose id sorts first picks the route, after a moment for more riders to join
    if (group.length > 1 && group[0].id === myId() && (group.length === 4 || waited > 5000)) {
      const minLevel = Math.min(...group.map((g) => g.level ?? 1));
      const pool = [CAMPUS_LOOP, ...RACES.filter((r) => minLevel >= r.level).map(raceRoute)];
      const m: MatchMsg = { code: live.newCode(), route: pool[Math.floor(Math.random() * pool.length)].id, riders: group.map((g) => ({ id: g.id, name: g.name, jersey: g.jersey })) };
      ch.send('match', m as unknown as Record<string, unknown>);
      go(m);
      return;
    }
    if (waited > 15000 && !others.length) bots("Nobody else is looking for a race right now, so you're racing bots.");
  };
  searchTimer = window.setInterval(() => searchTick?.(), 1000);
  searchTick();
}

async function startLiveRace(m: MatchMsg) {
  const route = routeById(m.route) ?? CAMPUS_LOOP;
  const ch = await live.join(`race:${m.code}`, myId(), { name: profile!.name });
  const others = m.riders.filter((r) => r.id !== myId());
  if (!ch) return play(false, route, { rivals: botRivals(route) });
  // start together: once everyone is in, or after a few seconds
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    play(false, route, { live: { ch, kind: 'race', riders: others } });
  };
  ch.on('go', start);
  ch.onPeers((peers) => {
    if (peers.length >= others.length && m.riders[0].id === myId()) {
      setTimeout(() => { ch.send('go', {}); start(); }, 600);
    }
  });
  setTimeout(() => {
    if (started || m.riders[0].id !== myId()) return;
    ch.send('go', {});
    start();
  }, 4000);
  setTimeout(() => { if (!started) { ch.leave(); play(false, route, { rivals: botRivals(route) }); } }, 9000);
}

// ---------- Vibe Ride ----------

interface ChatMsg {
  from?: string;
  name?: string;
  text?: string;
  react?: string;
  place?: string;
  sys?: boolean;
  at: number;
}

interface VibeSession {
  code: string;
  host: boolean;
  ch: live.Channel;
  partner: live.Peer<RiderState> | null;
  msgs: ChatMsg[];
  from: string;
  to: string;
  /** redraws whatever screen shows the ride: the room or the ride HUD */
  redraw: ((what: 'all' | 'chat') => void) | null;
  /** positions from your partner, while riding */
  onPos: ((m: PosMsg) => void) | null;
  joinedAt: number;
}

interface PosMsg {
  k: string;
  i: number;
  d: number[];
  x: number[];
}

let vibe: VibeSession | null = null;
/** an invite accepted before making a rider: joined once the rider exists */
let pendingVibe: { code: string; name: string } | null = null;

const REACTS: [string, string, string][] = [['wave', '👋', 'waved'], ['heart', '❤️', 'sent a heart'], ['laugh', '😂', 'is laughing'], ['like', '👍', 'liked that']];
const VIBE_PLACES = () => [...new Set([...Object.values(HALL_PLACE), ...POPULAR, ...TOUR_STOPS, 'Akuafo Hall', 'Commonwealth Hall'])].filter((n) => placeByName(n)).sort();

function leaveVibe() {
  vibe?.ch.send('bye', { name: profile?.name });
  vibe?.ch.leave();
  vibe = null;
}

/** Opens a Vibe Ride room: as its host (you made it) or as a guest (invite, code or pairing). */
async function joinVibe(code: string, host: boolean, partnerName = '') {
  if (!profile || needsRider()) return;
  if (vibe?.code === code) return vibeRoom();
  leaveVibe();
  stopSearching();
  render(`<div class="screen scrim center fade-in"><div class="wrap stack"><p class="kicker">💛 Vibe Ride</p><h1 class="title">${partnerName ? `Joining ${esc(partnerName)}` : 'Opening the ride'}…</h1></div></div>`);
  const me = riderState('room');
  const ch = await live.join(`vibe:${code}`, myId(), { ...me });
  if (!ch) {
    toast("Couldn't connect. Check your data or Wi-Fi and try again.");
    return home('social');
  }
  setStatus('room');
  const p = profile;
  const s: VibeSession = {
    code, host, ch, partner: null, msgs: [], redraw: null, onPos: null, joinedAt: me.at,
    from: HALL_PLACE[p.hall] && placeByName(HALL_PLACE[p.hall]) ? HALL_PLACE[p.hall] : 'Legon Main Entrance', to: 'The Balme Library',
  };
  vibe = s;
  let goneTimer = 0;
  const say = (m: ChatMsg) => { s.msgs.push(m); s.msgs = s.msgs.slice(-80); s.redraw?.('chat'); };
  ch.onPeers((peers) => {
    if (vibe !== s) return;
    // two riders per ride: anyone who joined after the first two waits outside
    const earlier = peers.filter((x) => x.state.at < s.joinedAt);
    if (earlier.length >= 2) {
      leaveVibe();
      toast('That ride already has two riders.');
      return home('social');
    }
    const partner = peers.sort((a, b) => a.state.at - b.state.at)[0] ?? null;
    // a weak connection drops for a moment: only say they left if they stay gone
    if (!partner && s.partner) {
      clearTimeout(goneTimer);
      goneTimer = window.setTimeout(() => {
        if (vibe !== s || !s.partner || s.ch.peers().length) return;
        say({ sys: true, text: `${s.partner.state.name} left the ride.`, at: Date.now() });
        s.partner = null;
        s.redraw?.('all');
      }, 8000);
      return;
    }
    clearTimeout(goneTimer);
    if (partner && !s.partner) {
      say({ sys: true, text: `${partner.state.name} joined the ride 🎉`, at: Date.now() });
      sfx.finish();
    }
    const changed = (partner?.key ?? '') !== (s.partner?.key ?? '');
    s.partner = partner;
    // the host shares the route with whoever joins
    if (changed && partner && s.host) ch.send('route', { from: s.from, to: s.to });
    if (changed) s.redraw?.('all');
  });
  ch.on('chat', (m: { name: string; text: string }) => say({ from: 'them', name: m.name, text: String(m.text).slice(0, 160), at: Date.now() }));
  ch.on('react', (m: { name: string; kind: string }) => {
    say({ from: 'them', name: m.name, react: m.kind, at: Date.now() });
    floatEmoji(REACTS.find((r) => r[0] === m.kind)?.[1] ?? '💛');
  });
  ch.on('suggest', (m: { name: string; place: string }) => say({ from: 'them', name: m.name, place: m.place, at: Date.now() }));
  ch.on('route', (m: { from: string; to: string }) => {
    if (placeByName(m.from)) s.from = m.from;
    if (placeByName(m.to)) s.to = m.to;
    s.redraw?.('all');
  });
  ch.on('start', (m: { from: string; to: string }) => {
    s.from = m.from;
    s.to = m.to;
    if (vibe === s && !game.isRiding) vibeGo();
  });
  ch.on('pos', (m: PosMsg) => s.onPos?.(m));
  ch.on('done', (m: { name: string; km: number; finished: boolean }) => say({ sys: true, text: m.finished ? `${m.name} arrived 🏁` : `${m.name} stopped riding.`, at: Date.now() }));
  ch.on('bye', (m: { name: string }) => {
    say({ sys: true, text: `${m.name} left the ride.`, at: Date.now() });
    s.partner = null;
    s.redraw?.('all');
  });
  if (host) say({ sys: true, text: 'Your ride is open. Invite someone to join you.', at: Date.now() });
  vibeRoom();
}

function sendChat(text: string) {
  const t = text.trim().slice(0, 160);
  if (!t || !vibe) return;
  vibe.ch.send('chat', { name: profile!.name, text: t });
  vibe.msgs.push({ from: 'me', name: profile!.name, text: t, at: Date.now() });
  vibe.redraw?.('chat');
}

function sendReact(kind: string) {
  if (!vibe) return;
  vibe.ch.send('react', { name: profile!.name, kind });
  vibe.msgs.push({ from: 'me', name: profile!.name, react: kind, at: Date.now() });
  floatEmoji(REACTS.find((r) => r[0] === kind)?.[1] ?? '💛');
  vibe.redraw?.('chat');
}

function sendSuggest(place: string) {
  if (!vibe) return;
  vibe.ch.send('suggest', { name: profile!.name, place });
  vibe.msgs.push({ from: 'me', name: profile!.name, place, at: Date.now() });
  vibe.redraw?.('chat');
}

function floatEmoji(e: string) {
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = e;
  el.style.left = `${30 + Math.random() * 40}%`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

function chatLine(m: ChatMsg) {
  if (m.sys) return `<div class="msg sys">${esc(m.text ?? '')}</div>`;
  const mine = m.from === 'me';
  const who = mine ? 'You' : esc(m.name ?? '');
  if (m.react) {
    const r = REACTS.find((x) => x[0] === m.react);
    return `<div class="msg react${mine ? ' me' : ''}"><span class="big-emoji">${r?.[1] ?? '💛'}</span> ${who} ${r?.[2] ?? ''}</div>`;
  }
  if (m.place) {
    const canGo = vibe?.host && !game.isRiding;
    return `<div class="msg${mine ? ' me' : ''}"><b>${who}</b><span>📍 Let's go to ${esc(m.place)}</span>${canGo ? `<button class="btn btn-ghost btn-sm" data-goto="${esc(m.place)}">Go there</button>` : ''}</div>`;
  }
  return `<div class="msg${mine ? ' me' : ''}"><b>${who}</b><span>${esc(m.text ?? '')}</span></div>`;
}

/** the quick actions under the chat: 👋 ❤️ 😂 👍 📍 💬 */
const quickActions = () => `<div class="quick-acts">${REACTS.map(([k, e]) => `<button data-react="${k}" aria-label="${k}">${e}</button>`).join('')}<button data-suggest aria-label="Suggest a place">📍</button><button data-chat aria-label="Chat">💬</button></div>`;

function placeMenu(onPick: (place: string) => void) {
  const ov = document.createElement('div');
  ov.className = 'overlay sheet-overlay fade-in';
  ov.innerHTML = `<div class="sheet light-ui"><div class="row"><h2 class="title" style="font-size:20px">Suggest a place</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    <div class="place-list">${VIBE_PLACES().map((n) => `<button class="chip" data-p="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  ov.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', () => { close(); onPick(b.dataset.p!); }));
}

/** wires the chat box and quick actions inside root */
function bindChat(root: HTMLElement, log: HTMLElement, input: HTMLInputElement, onChatBtn: () => void) {
  root.querySelectorAll<HTMLElement>('[data-react]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendReact(b.dataset.react!); }));
  root.querySelector('[data-suggest]')?.addEventListener('click', (e) => { e.stopPropagation(); placeMenu(sendSuggest); });
  root.querySelector('[data-chat]')?.addEventListener('click', (e) => { e.stopPropagation(); onChatBtn(); });
  const form = input.form!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat(input.value);
    input.value = '';
  });
  log.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (b && vibe?.host) setVibeRoute(vibe.from, b.dataset.goto!);
  });
}

function setVibeRoute(from: string, to: string) {
  if (!vibe || !placeByName(from) || !placeByName(to)) return;
  vibe.from = from;
  vibe.to = to === from ? vibe.to : to;
  vibe.ch.send('route', { from: vibe.from, to: vibe.to });
  vibe.redraw?.('all');
}

function vibeLink(code: string) {
  return `${PLAY_URL}?v=${code}&n=${encodeURIComponent(profile!.name)}`;
}

/** the room: who you're riding with, where you're going, the invite and the chat */
function vibeRoom() {
  const s = vibe;
  if (!s || !profile) return home('social');
  game.showcase();
  applyLook();
  const partner = s.partner?.state;
  const places = VIBE_PLACES();
  const select = (id: string, value: string) => `<div class="select-wrap"><select id="${id}" ${s.host ? '' : 'disabled'}>${places.map((n) => `<option ${n === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
  const link = vibeLink(s.code);
  const msg = `${inviteText(profile.name)} on LEGONRUSH 🚴💛 Tap to join: ${link}`;
  render(`
    <div class="screen solid vibe-room fade-in">
      <div class="wrap stack">
        <div class="row"><button class="btn btn-link back" id="leave">← Leave ride</button><span class="grow"></span><span class="badge gold">Code ${esc(s.code)}</span></div>
        <p class="kicker">💛 Vibe Ride</p>
        <h1 class="title">${partner ? `Riding with ${esc(partner.name)}` : 'Waiting for your friend'}</h1>
        ${partner
          ? `<div class="card row partner"><span class="avatar sm" style="background:${hallById(partner.hall).color}">${esc(partner.name.slice(0, 1).toUpperCase())}</span><span class="grow"><b>${esc(partner.name)}</b><small class="muted">${esc(hallById(partner.hall).name)}${partner.department ? ` · ${esc(partner.department)}` : ''}</small></span><span class="badge gold">● Here</span></div>`
          : `<div class="card stack invite-card" style="gap:10px">
              <b>Invite someone</b>
              <p class="muted small">They'll see "<b>${esc(inviteText(profile.name))}</b>". Share it on Snapchat, WhatsApp or anywhere, or give them the code <b>${esc(s.code)}</b>.</p>
              <button class="btn btn-primary" id="shareInvite">Share invite</button>
              <div class="two"><a class="btn btn-ghost" id="wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn btn-ghost" id="copy">Copy link</button></div>
              <p class="muted small" id="inviteNote" hidden></p>
              ${cloud.account ? `<div class="field picker"><label for="who">Invite by username or Snapchat</label><input id="who" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@username"><ul class="suggest" id="whoList" hidden></ul></div>` : '<p class="muted small">Sign in to invite riders by their username.</p>'}
            </div>
            <div class="card stack" style="gap:8px"><div class="row"><b>Riders online</b><span class="grow"></span><span class="badge gold" id="onlineCount"></span></div><div id="onlineList" class="online-list">${onlineRows()}</div></div>`}
        <div class="card stack" style="gap:8px">
          <b>Where to?</b>
          <div class="field"><label for="vFrom">From</label>${select('vFrom', s.from)}</div>
          <div class="field"><label for="vTo">To</label>${select('vTo', s.to)}</div>
          ${s.host
            ? `<button class="btn btn-primary" id="vGo" ${partner ? '' : 'disabled'}>${partner ? 'Start the ride' : 'Waiting for your friend'}</button>`
            : `<p class="muted small">${partner ? `${esc(partner.name)} picks the route and starts the ride. Suggest a place with 📍.` : 'Waiting for the host…'}</p>`}
          ${s.host && !partner ? '<button class="btn btn-link" id="vSolo">Ride it alone for now</button>' : ''}
        </div>
        <div class="card stack chat-card">
          <div class="row"><b>💬 Chat</b><span class="grow"></span><span class="muted small">Be kind. Leave anytime.</span></div>
          <div class="chat-log" id="log"></div>
          ${quickActions()}
          <form class="chat-form"><input id="say" maxlength="160" autocomplete="off" placeholder="${partner ? `Message ${esc(partner.name)}…` : 'Say something…'}"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form>
        </div>
      </div>
    </div>`);
  const log = app.querySelector<HTMLElement>('#log')!;
  const input = app.querySelector<HTMLInputElement>('#say')!;
  const drawLog = () => {
    log.innerHTML = s.msgs.map(chatLine).join('') || '<p class="muted small">No messages yet. Say hi 👋</p>';
    log.scrollTop = log.scrollHeight;
  };
  drawLog();
  bindChat(app.querySelector('.chat-card')!, log, input, () => input.focus());
  s.redraw = (what) => {
    if (vibe !== s) return;
    if (what === 'chat') return drawLog();
    // keep a half-typed message across a redraw
    const typed = input.value;
    vibeRoom();
    app.querySelector<HTMLInputElement>('#say')!.value = typed;
  };
  refreshOnline();
  on('[data-invite]', 'click', (_, el) => inviteOnline(el.dataset.invite!));
  on('#leave', 'click', () => { leaveVibe(); home('social'); });
  onBack(() => { leaveVibe(); home('social'); });
  on('#vFrom', 'change', (_, el) => setVibeRoute((el as HTMLSelectElement).value, s.to));
  on('#vTo', 'change', (_, el) => setVibeRoute(s.from, (el as HTMLSelectElement).value));
  on('#vGo', 'click', () => {
    if (!s.partner) return;
    s.ch.send('start', { from: s.from, to: s.to });
    vibeGo();
  });
  on('#vSolo', 'click', () => vibeGo());
  const note = app.querySelector<HTMLElement>('#inviteNote');
  on('#shareInvite', 'click', () => note && share(`${inviteText(profile!.name)} on LEGONRUSH 🚴💛`, link, note));
  on('#copy', 'click', async () => {
    try {
      await navigator.clipboard.writeText(msg);
      if (note) { note.hidden = false; note.textContent = 'Copied. Paste it in Snapchat, WhatsApp or anywhere.'; }
    } catch {
      if (note) { note.hidden = false; note.textContent = link; }
    }
  });
  // find riders by username and leave them an invite
  const who = app.querySelector<HTMLInputElement>('#who');
  const whoList = app.querySelector<HTMLElement>('#whoList');
  if (who && whoList) {
    let timer = 0;
    who.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        let found: cloud.RiderCard[] = [];
        try { found = await cloud.findRiders(who.value); } catch { /* offline */ }
        whoList.hidden = !found.length;
        whoList.innerHTML = found.map((r, i) => `<li data-i="${i}"><span class="kind">${online.some((o) => o.key === r.id) ? '🟢' : '⚪'}</span><span class="grow"><b>${esc(r.name)}</b> <small class="muted">${r.username ? `@${esc(r.username)}` : ''}${r.snap ? ` · 👻 ${esc(r.snap)}` : ''}</small></span><small class="muted">${esc(hallById(r.hall).short)}</small></li>`).join('');
        whoList.querySelectorAll<HTMLElement>('li').forEach((li) => li.addEventListener('click', async () => {
          const r = found[Number(li.dataset.i)];
          whoList.hidden = true;
          who.value = '';
          // online now: they get it straight away; either way it waits for them in their 🔔
          lobbyCh?.send('invite', { to: r.id, code: s.code, from: riderState('room') });
          const saved = await cloud.sendInvite(r.id, s.code);
          s.msgs.push({ sys: true, text: online.some((o) => o.key === r.id) || saved ? `Invite sent to ${r.name}.` : `Couldn't reach ${r.name}. Share the link instead.`, at: Date.now() });
          drawLog();
        }));
      }, 250);
    });
  }
  showUpdate('menu');
}

/** both riders ride the chosen route; the partner rides beside you live */
function vibeGo() {
  const s = vibe;
  if (!s) return;
  const from = placeByName(s.from);
  const to = placeByName(s.to);
  if (!from || !to || from === to) return toast('Pick two different places.');
  const route = exploreRoute(from, to, 'cycle');
  if (!route) return toast("Couldn't find a way between those places. Pick another.");
  const partner = s.partner?.state;
  play(false, route, { live: { ch: s.ch, kind: 'vibe', riders: partner ? [{ id: partner.id, name: partner.name, jersey: partner.jersey }] : [] } });
}

/** someone opened a Vibe Ride invite link */
function inviteIntro(code: string, name: string) {
  game.showcase();
  applyLook();
  render(`
    <div class="screen scrim fade-in">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">💛 Vibe Ride</p>
        <h1 class="title">${esc(name || 'A friend')} is inviting you to ride with them</h1>
        <p class="muted">Ride the campus together, chat as you go. No racing.</p>
        <button class="btn btn-primary" id="yes">Accept</button>
        <button class="btn btn-ghost" id="no">Not now</button>
      </div>
    </div>`);
  on('#yes', 'click', () => {
    if (!profile!.guest) return void joinVibe(code, false, name);
    // new here: make a rider first, then straight into the ride
    pendingVibe = { code, name };
    createRider({ ...profile!, name: '' }, false);
  });
  on('#no', 'click', () => home());
  onBack(() => home());
}

// ---------- accounts ----------

/** After signing in: bring down the account's progress, or make a rider for a new account. */
async function afterSignIn() {
  // you are your account now, to other riders too
  resetLobby();
  void loadInvites();
  const remote = await cloud.pull().catch(() => null);
  if (remote) {
    profile = profile ? cloud.merge(profile, remote) : { ...newProfile(), ...remote };
    saveProfile(profile);
    applyLook();
    return home('you');
  }
  if (profile && !profile.guest) {
    saveProfile(profile); // first save to the new account
    return home('you');
  }
  createRider(profile ? { ...profile, name: profile.name === 'Guest' ? '' : profile.name } : newProfile());
}

/** On launch, a signed-in rider picks up progress made on their other devices. */
async function syncDown() {
  const remote = await cloud.pull().catch(() => null);
  if (!remote) {
    if (profile && !profile.guest) saveProfile(profile);
    return;
  }
  profile = profile ? cloud.merge(profile, remote) : { ...newProfile(), ...remote };
  saveProfile(profile);
  // refresh the menu if one is showing; never interrupt a ride
  if (app.querySelector('.shell')) home(tab);
}

type AuthMode = 'in' | 'up' | 'reset' | 'newpass';

function authScreen(mode: AuthMode, back: () => void) {
  const titles: Record<AuthMode, string> = { in: 'Sign in', up: 'Create account', reset: 'Reset password', newpass: 'New password' };
  const go: Record<AuthMode, string> = { in: 'Sign in', up: 'Create account', reset: 'Send reset link', newpass: 'Save password' };
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack auth">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker">Account</p>
        <h1 class="title">${titles[mode]}</h1>
        <p class="muted">${mode === 'newpass' ? 'Choose a new password for your account.' : 'Keep your progress on any device, post your race times and ride for your hall.'}</p>
        ${mode !== 'newpass' ? `<div class="field"><label for="email">Email</label><input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@st.ug.edu.gh"></div>` : ''}
        ${mode !== 'reset' ? `<div class="field"><label for="pass">Password</label><input id="pass" type="password" minlength="6" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" placeholder="At least 6 characters"></div>` : ''}
        <p class="small auth-note" id="note" role="status" hidden></p>
        <button class="btn btn-primary" id="go">${go[mode]}</button>
        ${mode === 'in' ? '<button class="btn btn-ghost" id="toUp">New here? Create an account</button><button class="btn btn-link" id="toReset">Forgot your password?</button>' : ''}
        ${mode === 'up' || mode === 'reset' ? '<button class="btn btn-link" id="toIn">I already have an account</button>' : ''}
      </div>
    </div>`);
  const note = app.querySelector<HTMLElement>('#note')!;
  const say = (text: string, good = false) => {
    note.hidden = false;
    note.textContent = text;
    note.classList.toggle('good', good);
  };
  const val = (id: string) => (app.querySelector<HTMLInputElement>('#' + id)?.value ?? '').trim();
  on('#go', 'click', async (_, el) => {
    const btn = el as HTMLButtonElement;
    note.hidden = true;
    const email = val('email');
    const pass = app.querySelector<HTMLInputElement>('#pass')?.value ?? '';
    if (mode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)) return say('Enter your email address.');
    if (mode !== 'reset' && pass.length < 6) return say('Use a password of at least 6 characters.');
    btn.disabled = true;
    btn.textContent = 'One moment…';
    const r = mode === 'in' ? await cloud.signIn(email, pass)
      : mode === 'up' ? await cloud.signUp(email, pass)
      : mode === 'reset' ? await cloud.resetPassword(email)
      : await cloud.setPassword(pass);
    btn.disabled = false;
    btn.textContent = go[mode];
    if (r.ok === 'confirm') return say(`Almost there. We sent a link to ${email}. Open it on this phone to finish creating your account.`, true);
    if (r.ok === false) return say(r.error);
    if (mode === 'reset') return say(`Check ${email} for a link to set a new password.`, true);
    sfx.finish();
    if (mode === 'newpass') return profile ? home('you') : afterSignIn();
    afterSignIn();
  });
  app.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') app.querySelector<HTMLButtonElement>('#go')!.click();
  }));
  on('#toUp', 'click', () => authScreen('up', back));
  on('#toIn', 'click', () => authScreen('in', back));
  on('#toReset', 'click', () => authScreen('reset', back));
  on('#back', 'click', back);
  onBack(back);
}

// ---------- leaderboards ----------

function boardScreen(view: string, back: () => void) {
  const routes: [string, string][] = [[CAMPUS_LOOP.id, CAMPUS_LOOP.name], ...RACES.map((r): [string, string] => [r.id, r.name])];
  const myHall = profile?.hall ?? 'none';
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker">Leaderboards</p>
        <h1 class="title">${view === 'halls' ? 'Hall Week' : view === 'depts' ? 'Departments' : esc(routes.find(([id]) => id === view)?.[1] ?? 'Leaderboard')}</h1>
        <div class="board-tabs">${[['halls', '🏫 Halls'] as [string, string], ['depts', '🎓 Departments'] as [string, string], ...routes].map(([id, name]) => `<button class="${id === view ? 'on' : ''}" data-view="${id}">${esc(name)}</button>`).join('')}</div>
        <div id="board" class="card board"><p class="muted small">Loading…</p></div>
        ${cloud.account ? '' : '<p class="muted small">Your times and kilometres appear here once you sign in.</p><button class="btn btn-ghost" id="signIn">Sign in or create an account</button>'}
      </div>
    </div>`);
  const box = app.querySelector<HTMLElement>('#board')!;
  const fail = () => {
    box.innerHTML = '<p class="muted small">Couldn\'t load the leaderboard. Check your connection.</p><button class="btn btn-ghost" id="retry">Try again</button>';
    on('#retry', 'click', () => boardScreen(view, back));
  };
  if (view === 'halls') {
    cloud.hallStandings().then((rows) => {
      const all = HALLS.filter((h) => h.id !== 'none').map((h) => {
        const r = rows.find((x) => x.hall === h.id);
        return { h, km: r?.km ?? 0, riders: r?.riders ?? 0 };
      }).sort((a, b) => b.km - a.km || a.h.name.localeCompare(b.h.name));
      box.innerHTML = `<p class="muted small">Kilometres ridden for each hall since Monday.</p>${all.map((x, i) => `<div class="board-row${x.h.id === myHall ? ' me' : ''}"><span class="rank">${i + 1}</span><span class="hall-swatch" style="background:${x.h.color}"></span><span class="grow">${esc(x.h.name)}<small>${x.riders} rider${x.riders === 1 ? '' : 's'}</small></span><b>${x.km.toFixed(1)} km</b></div>`).join('')}`;
    }, fail);
  } else if (view === 'depts') {
    const mine = profile?.department ?? '';
    cloud.departmentStandings().then((rows) => {
      box.innerHTML = `<p class="muted small">Kilometres ridden for each department since Monday.</p>${rows.length
        ? rows.map((x, i) => `<div class="board-row${x.department === mine ? ' me' : ''}"><span class="rank">${i + 1}</span><span class="grow">${esc(x.department)}<small>${esc(collegeOf(x.department))} · ${x.riders} rider${x.riders === 1 ? '' : 's'}</small></span><b>${x.km.toFixed(1)} km</b></div>`).join('')
        : '<p class="muted small">No kilometres yet this week. Ride to put your department on the board.</p>'}`;
    }, fail);
  } else {
    cloud.leaderboard(view).then((rows) => {
      const mine = profile?.bestTimes[view];
      box.innerHTML = rows.length
        ? rows.map((r, i) => `<div class="board-row${r.me ? ' me' : ''}"><span class="rank">${i + 1}</span><span class="hall-swatch" style="background:${hallById(r.hall).color}"></span><span class="grow">${esc(r.name)}<small>${r.username ? `@${esc(r.username)} · ` : ''}${esc(hallById(r.hall).short)}${r.snap ? ` · 👻 ${esc(r.snap)}` : ''}</small></span><b>${clock(r.best)}</b></div>`).join('')
          + (mine && !rows.some((r) => r.me) ? `<p class="muted small" style="margin-top:8px">Your best: ${clock(mine)}${cloud.account ? '' : ' (sign in to post it)'}</p>` : '')
        : `<p class="muted small">No times yet. Finish this race to be the first.</p>`;
    }, fail);
  }
  on('[data-view]', 'click', (_, el) => boardScreen(el.dataset.view!, back));
  on('#signIn', 'click', () => authScreen('in', () => boardScreen(view, back)));
  on('#back', 'click', back);
  onBack(back);
}

// ---------- settings ----------

/** first-visit download, measured from the build (see vite.config.ts) */
const INSTALL_KB = 500;

function settingsScreen() {
  const seg = (id: string, options: [string, string][], value: string) =>
    `<div class="seg" id="${id}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  const graphicsNote = () => settings.graphics === 'auto'
    ? `Starts sharp and switches to smooth if your phone struggles.${settings.slowDevice ? ' This phone is on smooth.' : ''}`
    : settings.graphics === 'low' ? 'No shadows and a lower resolution. Runs faster and uses less battery.' : 'Shadows and full resolution.';
  render(`
    <div class="screen solid fade-in">
      <div class="wrap stack settings">
        <button class="btn btn-link back" id="back">← Back</button>
        <h1 class="title">Settings</h1>
        <div class="card stack">
          <div class="set-row"><b>Sound</b>${seg('sound', [['1', 'On'], ['0', 'Off']], settings.sound ? '1' : '0')}</div>
          <label class="set-row"><span>Effects</span><input type="range" id="volume" min="0" max="100" step="5" value="${Math.round(settings.volume * 100)}" aria-label="Sound effects volume"></label>
          <label class="set-row"><span>Music</span><input type="range" id="musicVol" min="0" max="100" step="5" value="${Math.round(settings.musicVolume * 100)}" aria-label="Ride music volume"></label>
          <p class="muted small">Music plays during rides. Slide it to zero to turn it off.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Graphics</b>${seg('graphics', [['auto', 'Auto'], ['high', 'Sharp'], ['low', 'Smooth']], settings.graphics)}</div>
          <p class="muted small" id="gNote">${graphicsNote()}</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Boost button</b>${seg('hand', [['0', 'Right'], ['1', 'Left']], settings.leftHanded ? '1' : '0')}</div>
          <p class="muted small">Put the boost button under the thumb you prefer.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Motion</b>${seg('motion', [['0', 'Full'], ['1', 'Reduced']], settings.reducedMotion ? '1' : '0')}</div>
          <p class="muted small">Reduced turns off camera shake, speed zoom and screen animations.</p>
        </div>
        <div class="card stack">
          <b>Data</b>
          <p class="muted small">LEGONRUSH uses no data while you ride. The first visit downloads about ${INSTALL_KB} KB, then the game works offline. Updates download only the parts that changed.</p>
        </div>
      </div>
    </div>`);
  const pick = (id: string, fn: (v: string) => void) => on(`#${id} [data-v]`, 'click', (_, el) => {
    app.querySelectorAll(`#${id} [data-v]`).forEach((b) => b.classList.toggle('on', b === el));
    fn(el.dataset.v!);
  });
  pick('sound', (v) => changeSettings({ sound: v === '1' }));
  pick('graphics', (v) => {
    // choosing Auto again gives the phone a fresh chance at sharp graphics
    changeSettings({ graphics: v as typeof settings.graphics, slowDevice: false });
    app.querySelector('#gNote')!.textContent = graphicsNote();
  });
  pick('hand', (v) => changeSettings({ leftHanded: v === '1' }));
  pick('motion', (v) => changeSettings({ reducedMotion: v === '1' }));
  on('#volume', 'input', (_, el) => changeSettings({ volume: Number((el as HTMLInputElement).value) / 100 }));
  on('#volume', 'change', () => sfx.coin());
  on('#musicVol', 'input', (_, el) => changeSettings({ musicVolume: Number((el as HTMLInputElement).value) / 100 }));
  on('#back', 'click', () => home('you'));
  onBack(() => home('you'));
}

// ---------- explore ----------

const POPULAR = ['School of Law', 'Pent Hostel Block A', 'The Balme Library', 'Great Hall', 'Night Market', 'Jones Quartey Building, JQB', 'University of Ghana Hospital', 'Legon Main Entrance'];

function stepsList(route: Route) {
  return `<ol class="steps">${route.steps.map((s, i) => `
    <li class="${s.turn === 'arrive' || s.turn === 'stop' ? 'arrive' : ''}"><span class="turn-arrow">${ARROW[s.turn]}</span><span class="grow">${esc(s.text)}</span>${i < route.steps.length - 1 ? `<small class="muted">${dm(route.steps[i + 1].d - s.d)}</small>` : ''}</li>`).join('')}</ol>`;
}

const KIND_ICON: Record<PlaceKind, [string, string]> = {
  hall: ['🛏️', 'Hall'], academic: ['🎓', 'Faculty'], landmark: ['⭐', 'Landmark'], food: ['🍽️', 'Food'], bank: ['🏦', 'Bank'],
  transport: ['🚌', 'Bus stop'], worship: ['🕊️', 'Worship'], sport: ['⚽', 'Sport'], health: ['🏥', 'Health'], other: ['📍', 'Place'],
};

// Explore options, remembered on this device
const EXPLORE_KEY = 'legonrush.explore.v1';
const exploreOpts: { mode: TravelMode; calm: boolean } = (() => {
  try { return { mode: 'cycle', calm: true, ...JSON.parse(localStorage.getItem(EXPLORE_KEY) ?? '{}') }; } catch { return { mode: 'cycle', calm: true }; }
})();
const saveExploreOpts = () => { try { localStorage.setItem(EXPLORE_KEY, JSON.stringify(exploreOpts)); } catch { /* private mode */ } };

/** What a place is, for the cards in Explore. Kept short and factual. */
const PLACE_INFO: [RegExp, string][] = [
  [/^The Balme Library$/, "The university's main library."],
  [/^Jones Quartey Building/, 'Lecture block with about seven lecture halls. The Radio Univers newsroom is here too.'],
  [/^Night Market$/, 'On-campus food market with food stalls and a mini mall.'],
  [/^Bush Canteen/, "Officially the University Workers' Canteen: affordable local food."],
  [/^Great Hall$/, 'Where congregations (graduations) and big university events are held.'],
  [/^University of Ghana Registry$/, 'Main administration: admissions, records and student matters.'],
  [/^University of Ghana Hospital$/, 'The university hospital for students and staff, often called Legon Hospital.'],
  [/^Commonwealth Hall$/, 'All-male hall. Residents are the Vandals; the motto is "Truth Stands".'],
  [/^Volta Hall$/, 'All-female hall.'],
  [/^Mensah Sarbah Hall$/, 'Residents are the Vikings. The hall has annexes A to D.'],
  [/^Akuafo Hall/, 'Akuafo is Akan for farmers.'],
  [/^Legon Hall$/, 'The first hall built on campus, close to the Balme Library.'],
  [/^Pent/, 'Part of Africa Union Hall (Pent): five hostel blocks named for their pentagon shape.'],
  [/^(Dr. Hilla Limann|Alexander Kwapong|Elizabeth Frances Sey|Jean Nelson Aka) Hall$/, 'One of the four Diaspora halls.'],
];
const NEARBY_KINDS = new Set<PlaceKind>(['food', 'bank', 'health', 'landmark', 'academic', 'sport']);

function placeCard(place: Place) {
  const [icon, label] = KIND_ICON[place.kind];
  const info = PLACE_INFO.find(([re]) => re.test(place.name))?.[1];
  const nearby: Place[] = [];
  for (const q of [...PLACES].sort((a, b) => Math.hypot(a.x - place.x, a.z - place.z) - Math.hypot(b.x - place.x, b.z - place.z))) {
    if (Math.hypot(q.x - place.x, q.z - place.z) > 250 || nearby.length >= 4) break;
    if (q === place || !NEARBY_KINDS.has(q.kind) || nearby.some((n) => n.name.split(' (')[0] === q.name.split(' (')[0])) continue;
    nearby.push(q);
  }
  // nearest trotro stop and where its trotros go
  let stop: Place | undefined, stopD = Infinity;
  for (const q of PLACES) {
    if (!q.lines) continue;
    const d = Math.hypot(q.x - place.x, q.z - place.z);
    if (d < stopD) { stop = q; stopD = d; }
  }
  const ends = stop && stopD < 900 ? [...new Set(stop.lines!.flatMap((l) => LINE_ENDS[l] ?? []))].slice(0, 8) : [];
  return `
    <div class="card place-card">
      <div class="row"><span class="kind-icon">${icon}</span><div class="grow"><b>${esc(place.name)}</b><div class="muted small">${label}</div></div></div>
      ${info ? `<p class="small" style="margin-top:8px">${esc(info)}</p>` : ''}
      ${nearby.length ? `<p class="muted small" style="margin-top:8px">Nearby: ${nearby.map((n) => `${KIND_ICON[n.kind][0]} ${esc(n.name.split(' (')[0])}`).join(' · ')}</p>` : ''}
      ${stop && ends.length ? `<p class="muted small" style="margin-top:6px">🚌 Nearest trotro stop: <b>${esc(stop.name.split(' (')[0])}</b>, ${dm(stopD)} away. Trotros to ${ends.map(esc).join(', ')}.</p>` : ''}
    </div>`;
}

function shareRoute(from: Place, to: Place, note: HTMLElement) {
  const url = `${PLAY_URL}?${new URLSearchParams({ from: from.name, to: to.name, mode: exploreOpts.mode })}`;
  return share(`How to get from ${from.name} to ${to.name} on campus, on LEGONRUSH`, url, note);
}

/** Shares a link with the phone's share sheet, or copies it and offers WhatsApp. */
async function share(text: string, url: string, note: HTMLElement) {
  try {
    if (navigator.share) return await navigator.share({ title: 'LEGONRUSH', text, url });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  note.hidden = false;
  try {
    await navigator.clipboard.writeText(`${text}: ${url}`);
    note.innerHTML = `Link copied. <a href="https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}" target="_blank" rel="noopener">Send on WhatsApp</a>`;
  } catch {
    note.innerHTML = `<a href="https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}" target="_blank" rel="noopener">Send on WhatsApp</a> or copy: <span class="small">${esc(url)}</span>`;
  }
}

function explorePicker(fromName?: string, toName = '') {
  if (!profile) return welcome();
  const p = profile;
  let from: Place | undefined = resolvePlace(fromName ?? HALL_PLACE[p.hall] ?? 'Legon Main Entrance');
  let to: Place | undefined = toName ? resolvePlace(toName) : undefined;
  const seg = (id: string, options: [string, string][], value: string) =>
    `<div class="seg" id="${id}">${options.map(([v, label]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  render(`
    <div class="screen scrim fade-in">
      <div class="wrap stack explore">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker">🗺️ Explore</p>
        <h1 class="title">Find your way</h1>
        <button class="qr-campus solo" data-campus><span>${icons.pin}</span><span class="grow"><small>Campus</small>${esc(campusById(settings.campus).name)}${settings.campus === 'ug' ? ', Legon' : ''}</span><em>▾</em></button>
        <button class="card selectable tour-card" id="tour"><div class="row"><h3 style="font-weight:800">⭐ FRESHERS' TOUR</h3><span class="grow"></span><span class="badge gold">${TOUR_STOPS.length} places · 3.5 km</span></div><p class="muted small" style="margin-top:4px">One ride past the places you need in week one: ${TOUR_STOPS.map((n) => esc(n.replace(/^The |, .*$/g, ''))).join(', ')}.</p></button>
        <p class="kicker" style="margin-top:6px">Or plan your own way</p>
        <p class="muted">Pick where you are and where you need to be. Type a name or what students call it, like Vandals, Pent or JQB.</p>
        <div class="field picker"><label for="from">From</label><input id="from" autocomplete="off" spellcheck="false" placeholder="Your hall, a faculty, a landmark…"><ul class="suggest" id="fromList" hidden></ul></div>
        <button class="btn btn-link swap" id="swap" aria-label="Swap from and to">⇅ Swap</button>
        <div class="field picker"><label for="to">To</label><input id="to" autocomplete="off" spellcheck="false" placeholder="Where do you need to be?"><ul class="suggest" id="toList" hidden></ul></div>
        <div class="chips">${POPULAR.filter((n) => placeByName(n)).map((n) => `<button class="chip" data-to="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="row options">${seg('mode', [['cycle', '🚲 Cycle'], ['walk', '🚶 Walk']], exploreOpts.mode)}${seg('calm', [['1', 'Calm ride'], ['0', 'With traffic']], exploreOpts.calm ? '1' : '0')}</div>
        <div id="preview" class="stack"></div>
        <p class="muted small">${esc(ATTRIBUTION)}</p>
      </div>
    </div>`);
  const fromIn = app.querySelector<HTMLInputElement>('#from')!;
  const toIn = app.querySelector<HTMLInputElement>('#to')!;
  const preview = app.querySelector<HTMLElement>('#preview')!;
  const show = (place: Place | undefined) => (place ? place.name : '');
  fromIn.value = show(from);
  toIn.value = show(to);

  let route: Route | null = null;
  const update = () => {
    route = null;
    if (!from || !to) {
      preview.innerHTML = '';
      return;
    }
    if (from === to) {
      preview.innerHTML = `<p class="muted small">You're already there. Pick a different destination.</p>`;
      return;
    }
    route = exploreRoute(from, to, exploreOpts.mode);
    if (!route) {
      preview.innerHTML = `<p class="muted small">No path connects those two places on the map yet.</p>`;
      return;
    }
    preview.innerHTML = `
      ${placeCard(to)}
      <canvas class="route-map" width="720" height="440" aria-label="Map of the way from ${esc(from.name)} to ${esc(to.name)}"></canvas>
      <div class="stats three">
        <div class="stat"><b>${dm(route.length)}</b><span>Distance</span></div>
        <div class="stat"><b>${mins(route.length / 1.3)}</b><span>Walking</span></div>
        <div class="stat"><b>${mins(route.length / 4.5)}</b><span>Cycling</span></div>
      </div>
      <button class="btn btn-primary" id="go">Ride there</button>
      <div class="two">
        <button class="btn btn-ghost" id="share">Share route</button>
        <a class="btn btn-ghost" id="gmaps" target="_blank" rel="noopener">Google Maps</a>
      </div>
      <p class="muted small" id="shareNote" hidden></p>
      <p class="kicker" style="margin-top:6px">Directions</p>
      ${stepsList(route)}`;
    routeMap(preview.querySelector('canvas')!, route);
    preview.querySelector('#go')!.addEventListener('click', () => route && play(false, route));
    const [fl, fg] = toLatLng(from.x, from.z), [tl, tg] = toLatLng(to.x, to.z);
    preview.querySelector<HTMLAnchorElement>('#gmaps')!.href =
      `https://www.google.com/maps/dir/?api=1&origin=${fl.toFixed(6)},${fg.toFixed(6)}&destination=${tl.toFixed(6)},${tg.toFixed(6)}&travelmode=${exploreOpts.mode === 'walk' ? 'walking' : 'bicycling'}`;
    const a = from, b = to;
    preview.querySelector('#share')!.addEventListener('click', () => shareRoute(a, b, preview.querySelector('#shareNote')!));
  };

  // type-ahead with the kind of each place, nicknames included
  const picker = (input: HTMLInputElement, list: HTMLElement, set: (p: Place) => void) => {
    let matches: PlaceMatch[] = [];
    let active = 0;
    const draw = () => {
      list.hidden = !matches.length;
      list.innerHTML = matches.map((m, i) => {
        const [icon, label] = KIND_ICON[m.place.kind];
        return `<li data-i="${i}" class="${i === active ? 'on' : ''}"><span class="kind" title="${label}">${icon}</span><span class="grow">${esc(m.place.name)}${m.alias ? ` <small class="muted">“${esc(m.alias)}”</small>` : ''}</span><small class="muted">${label}</small></li>`;
      }).join('');
    };
    const choose = (m: PlaceMatch | undefined) => {
      if (!m) return;
      set(m.place);
      input.value = m.place.name;
      matches = [];
      draw();
      update();
    };
    input.addEventListener('input', () => {
      matches = searchPlaces(input.value, 7);
      active = 0;
      draw();
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (!matches.length) return;
      if (e.key === 'ArrowDown') { active = (active + 1) % matches.length; draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active + matches.length - 1) % matches.length; draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(matches[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { matches = []; draw(); }
    });
    // pointerdown fires before the input loses focus
    list.addEventListener('pointerdown', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
      if (li) { e.preventDefault(); choose(matches[Number(li.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(() => { matches = []; draw(); }, 150));
  };
  picker(fromIn, app.querySelector('#fromList')!, (pl) => { from = pl; });
  picker(toIn, app.querySelector('#toList')!, (pl) => { to = pl; });

  on('[data-to]', 'click', (_, el) => { to = placeByName(el.dataset.to!); toIn.value = show(to); update(); });
  on('#swap', 'click', () => { [from, to] = [to, from]; fromIn.value = show(from); toIn.value = show(to); update(); });
  on('#mode [data-v]', 'click', (_, el) => {
    exploreOpts.mode = el.dataset.v as TravelMode;
    saveExploreOpts();
    app.querySelectorAll('#mode [data-v]').forEach((b) => b.classList.toggle('on', b === el));
    update();
  });
  on('#calm [data-v]', 'click', (_, el) => {
    exploreOpts.calm = el.dataset.v === '1';
    saveExploreOpts();
    app.querySelectorAll('#calm [data-v]').forEach((b) => b.classList.toggle('on', b === el));
  });
  on('#back', 'click', () => home());
  onBack(() => home());
  on('#tour', 'click', () => play(false, freshersTour()));
  on('[data-campus]', 'click', () => campusSheet(() => explorePicker(fromName, toName)));
  update();
}

// ---------- where is it? ----------

const QUIZ_POOL = [
  'The Balme Library', 'Great Hall', 'University of Ghana Registry', 'Legon Main Entrance', 'Night Market', 'Central Cafeteria, CC',
  'Jones Quartey Building, JQB', 'New N Block, NNB', 'School of Law', 'University of Ghana Business School', 'University of Ghana Hospital',
  'Athletic Oval', 'Pent Hostel Block A', 'Legon Hall', 'Akuafo Hall Main', 'Commonwealth Hall', 'Volta Hall', 'Mensah Sarbah Hall',
  'Jean Nelson Aka Hall', 'Alexander Kwapong Hall', 'Elizabeth Frances Sey Hall', 'Dr. Hilla Limann Hall', 'International Students Hostel 1, ISH 1',
  'Valco Trust Hostel Phase 1', 'SRC Union Building',
];
const ROUNDS = 5;
const quizPoints = (m: number) => (m <= 40 ? 100 : Math.max(0, Math.round(100 * (1 - (m - 40) / 560))));

function whereIsIt() {
  if (!profile) return welcome();
  const p = profile;
  const home_ = placeByName(HALL_PLACE[p.hall] ?? '');
  const pool = QUIZ_POOL.map((n) => placeByName(n)).filter((pl): pl is Place => !!pl && pl !== home_);
  const picks = pool.sort(() => Math.random() - 0.5).slice(0, ROUNDS);
  let round = 0, total = 0;
  render(`
    <div class="screen scrim fade-in">
      <div class="wrap stack quiz">
        <button class="btn btn-link back" id="back">← Back</button>
        <p class="kicker" id="qRound"></p>
        <h1 class="title" id="qTitle" style="font-size:clamp(22px,6vw,30px)"></h1>
        <p class="muted small" id="qHint">Tap the map where you think it is.</p>
        <canvas class="quiz-map" id="qMap" width="720" height="780" aria-label="Campus map"></canvas>
        <p id="qResult" class="quiz-result"></p>
        <div class="two" id="qNext" hidden>
          <button class="btn btn-ghost" id="qRide">Ride there</button>
          <button class="btn btn-primary" id="qGo">Next</button>
        </div>
      </div>
    </div>`);
  const canvas = app.querySelector<HTMLCanvasElement>('#qMap')!;
  const map = campusOverview(canvas, [...pool, ...(home_ ? [home_] : [])]);
  const $ = (id: string) => app.querySelector<HTMLElement>('#' + id)!;
  const youPin: Pin[] = home_ ? [{ x: home_.x, z: home_.z, color: '#5ec8ff', label: 'Your hall' }] : [];
  let answered = false;
  const ask = () => {
    answered = false;
    const target = picks[round];
    $('qRound').textContent = `Where is it? · ${round + 1} of ${picks.length} · ${total} pts`;
    $('qTitle').textContent = target.name.replace(/, [A-Z]+ ?\d?$/, '');
    $('qHint').hidden = false;
    $('qResult').textContent = '';
    $('qNext').hidden = true;
    map.draw(youPin);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (answered) return;
    answered = true;
    const r = canvas.getBoundingClientRect();
    const [x, z] = map.toWorld(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
    const target = picks[round];
    const off = Math.hypot(x - target.x, z - target.z);
    const pts = quizPoints(off);
    total += pts;
    const guess: Pin = { x, z, color: '#ffd21f' };
    const real: Pin = { x: target.x, z: target.z, color: '#22c55e', label: target.name.replace(/^The |, .*$/g, '') };
    map.draw([...youPin, guess, real], [guess, real]);
    $('qHint').hidden = true;
    $('qResult').innerHTML = `${off <= 40 ? 'Spot on!' : `${dm(off)} away.`} <b>+${pts}</b>`;
    $('qRound').textContent = `Where is it? · ${round + 1} of ${picks.length} · ${total} pts`;
    $('qNext').hidden = false;
    $('qGo').textContent = round + 1 < picks.length ? 'Next' : 'See score';
  });
  on('#qGo', 'click', () => {
    round++;
    if (round < picks.length) return ask();
    const coins = Math.round(total / 5), xp = Math.round(total / 2);
    p.coins += coins;
    p.xp += xp;
    saveProfile(p);
    render(`
      <div class="screen scrim fade-in">
        <div class="grow"></div>
        <div class="wrap stack" style="text-align:center">
          <p class="kicker">Where is it?</p>
          <h1 class="title">${total >= 400 ? 'Campus expert' : total >= 250 ? 'Getting there' : 'Keep exploring'}</h1>
          <div class="result-big">${total} <span style="font-size:0.4em">/ ${picks.length * 100}</span></div>
          <div class="card">
            <div class="reward-row"><span>Coins</span><b>+${coins} ${icons.coin}</b></div>
            <div class="reward-row"><span>XP</span><b>+${xp}</b></div>
          </div>
          <button class="btn btn-primary" id="again">Play again</button>
          <button class="btn btn-ghost" id="explore">Explore campus</button>
          <button class="btn btn-ghost" id="home">Home</button>
        </div>
      </div>`);
    on('#again', 'click', () => whereIsIt());
    on('#explore', 'click', () => explorePicker());
    on('#home', 'click', () => home());
  });
  on('#qRide', 'click', () => explorePicker(undefined, picks[round].name));
  on('#back', 'click', () => home());
  onBack(() => home());
  ask();
}

// a signed-in rider's progress follows them between devices
const resetting = cloud.cameFromReset();
onProfileSave((p) => {
  if (!p.guest) cloud.push(p);
});
splash();
cloud.restore(() => {
  if (cloud.account) void syncDown();
}).then(() => {
  if (resetting && cloud.account) return authScreen('newpass', () => home('you'));
  if (cloud.account) {
    void syncDown();
    void loadInvites();
  }
});
