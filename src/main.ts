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
import { CAMPUS_LOOP, EVENTS, RACES, TOUR_STOPS, eventStatus, exploreRoute, freshersTour, guideStops, raceRoute, type EventDef, type RaceDef, type Route } from './game/routes';
import { botRivals, decodeChallenge, encodeChallenge, type Challenge } from './game/rivals';
import type { GhostRun, Rival } from './game/Game';
import { ATTRIBUTION, LINE_ENDS, PLACES, placeByName, toLatLng, resolvePlace, searchPlaces, type Place, type PlaceKind, type PlaceMatch, type TravelMode, type Turn } from './game/campusmap';
import { campusOverview, miniMap, routeMap, type Pin } from './ui/mapview';
import { PROFILE_REWARD, profileComplete, profileTodo, MISSIONS, SHOP, SKIN_TONES, WEEK_GOAL_KM, WEEK_REWARD, claimMission, todayMissions, onProfileSave, type Accessory, type Look, type Outfit, type RiderType, type StudentStatus, applyRide, claimDaily, clearGhosts, currentWeek, dailyReward, clearProfile, levelFor, loadGhost, loadProfile, loadSettings, newProfile, normalizeProfile, saveGhost, saveProfile, saveSettings, xpForLevel, type Profile, type RideResult, type RideRewards } from './state';
import { music, setAmbience, setMusicVolume, setSound, sfx, startAmbience, stopAmbience, unlockAudio } from './audio';
import { marketProximity } from './game/life';
import { icons } from './ui/icons';
import { buzz, countUp, hookHaptics, randomFact, setFeedback, tapSounds } from './ui/feedback';
import { ALL_DEPARTMENTS, DEPARTMENTS, OTHER_DEPARTMENT, collegeOf } from './data/departments';
import * as cloud from './cloud';
import * as live from './live';
import { CAMPUSES, campusById } from './data/campuses';
import * as fx from './features';
import * as money from './features/money-ui';
import * as vb from './features/vibe';
import { tabView, type TabId } from './tabs/registry';
// Garage & Store: bike looks and the stats rides use
import * as garage from './features/garage/garage';
import { openStore } from './tabs/store';
import { showSystem, takeDue } from './features/notify';
import * as community from './features/community';
import './tabs';
import type { EventRide } from './features/events/ride-hook';
import { rememberRidePos } from './features/map/where';
import { MAP_ROUTES } from './features/map/routes';
import { passportCardHtml } from './features/events';
import { privacyScreen } from './features/community/settings';
import { openChallengeLink } from './features/challenges/links';
import type { ChallengeRide } from './features/host';

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
  const root = document.documentElement.classList;
  root.toggle('reduce-motion', settings.reducedMotion);
  root.toggle('big-ui', settings.bigButtons);
  root.toggle('night', settings.nightMenus);
  setFeedback(settings);
  game.setQuality(settings.graphics === 'low' || (settings.graphics === 'auto' && settings.slowDevice) ? 'low' : 'high');
}
applySettings();
hookHaptics();
const changeSettings = (patch: Partial<typeof settings>) => {
  Object.assign(settings, patch);
  saveSettings(settings);
  applySettings();
};

/** the menu tabs, plus older names still used around the app (race → challenges, social → community) */
type Tab = TabId | 'ride' | 'race' | 'social';
const TAB_ALIAS: Partial<Record<Tab, TabId>> = { race: 'challenges', social: 'community' };
let tab: TabId | 'ride' = 'home';

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

/** how a new screen comes in: a fade, or a slide forward/back through steps */
type Enter = 'fade' | 'next' | 'back' | 'none';
function render(html: string, enter: Enter = 'fade') {
  app.innerHTML = html;
  const first = app.firstElementChild;
  if (!first || enter === 'fade' || settings.reducedMotion) return;
  first.classList.remove('fade-in');
  if (enter !== 'none') first.classList.add(`enter-${enter}`);
}
tapSounds(app);

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
  game.setLook(riderLook(p), fx.bikePaint(p));
  game.setBikeStyle(garage.styleFor(p));
}

// ---------- splash + welcome ----------

/** a campus fact or tip under a loading bar */
const factBox = () => {
  const [kind, text] = randomFact();
  return `<div class="fact"><span class="fact-k">${kind === 'Tip' ? icons.bolt : icons.pillars} ${kind}</span><p>${esc(text)}</p></div>`;
};

function splash() {
  game.showcase();
  // someone who already rides never needs the welcome screens
  if (profile && !settings.onboarded) changeSettings({ onboarded: true });
  render(`
    <div class="screen solid center fade-in splash">
      <div class="logo">LEGON<span>RUSH</span></div>
      <p class="tag" style="margin-top:12px">The Campus Lifestyle Reimagined.</p>
      <p class="kicker" style="margin-top:22px">Ride. Race. Connect.</p>
      <div class="splash-bar"><div></div></div>
      ${factBox()}
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
    // a Race Challenge invite link: ?ch=LR-7K29X
    if (link.get('ch')) {
      history.replaceState(null, '', location.pathname);
      ensureProfile();
      return void openChallengeLink(link.get('ch')!);
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
    else if (!settings.onboarded) intro();
    else welcome();
  }, 1400);
}

// ---------- first visit: three welcome screens, then straight into a ride ----------

const INTRO: { img: string; kicker: string; title: string; text: string; icon: string }[] = [
  { img: 'hero', kicker: 'Welcome to LEGONRUSH', title: 'Ride the real <em>Legon</em> campus', text: 'Cycle past the Balme Library, the halls and the Great Hall, on roads drawn from the real campus map.', icon: icons.bike },
  { img: 'race', kicker: 'Race and earn', title: 'Race friends and your <em>hall</em>', text: 'Beat your friends, ride for your hall in Hall Week and earn Rush Coins for bikes and gear.', icon: icons.trophy },
  { img: 'connect', kicker: 'New on campus?', title: 'Learn the campus as you <em>ride</em>', text: 'Explore mode guides you turn by turn to lecture halls, banks, food and every place freshers need.', icon: icons.compass },
];

function intro(i = 0, enter: Enter = 'fade') {
  game.showcase();
  const it = INTRO[i];
  const last = i === INTRO.length - 1;
  render(`
    <div class="intro light-ui fade-in">
      <div class="intro-top"><div class="brand-mark">LEGON<em>RUSH</em></div>${last ? '' : '<button class="btn btn-link" id="guest">Skip</button>'}</div>
      <div class="intro-photo"><img src="${photo(it.img)}" alt="" width="640" height="560"><span class="intro-ico">${it.icon}</span></div>
      <div class="intro-text">
        <p class="kicker">${it.kicker}</p>
        <h1>${it.title}</h1>
        <p class="intro-lede">${it.text}</p>
        <div class="intro-dots">${INTRO.map((_, j) => `<button class="${j === i ? 'on' : ''}" data-dot="${j}" aria-label="Screen ${j + 1} of ${INTRO.length}"></button>`).join('')}</div>
        <div class="intro-actions">
          <button class="btn btn-primary" id="${last ? 'guest' : 'next'}">${last ? `Let's ride ${icons.arrow}` : 'Next'}</button>
          ${last ? '<button class="btn btn-link" id="signIn">I already have an account</button>' : ''}
        </div>
      </div>
    </div>`, enter);
  const go = (j: number) => { if (j >= 0 && j < INTRO.length && j !== i) intro(j, j > i ? 'next' : 'back'); };
  on('#next', 'click', () => go(i + 1));
  on('[data-dot]', 'click', (_, el) => go(Number(el.dataset.dot)));
  on('#guest', 'click', () => firstRide());
  on('#signIn', 'click', () => { changeSettings({ onboarded: true }); authScreen('in', () => intro(INTRO.length - 1)); });
  onBack(i ? () => go(i - 1) : null);
  // swipe between the screens
  const box = app.querySelector<HTMLElement>('.intro')!;
  let x0 = 0, y0 = 0;
  box.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  box.addEventListener('pointerup', (e) => {
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(i + (dx < 0 ? 1 : -1));
  });
  obAuto = () => (last ? app.querySelector<HTMLElement>('#guest')!.click() : go(i + 1));
}

/** a new rider's first ride: as a guest, with tips; the account comes after */
function firstRide() {
  changeSettings({ onboarded: true });
  profile = newProfile();
  profile.name = 'Guest';
  saveProfile(profile);
  applyLook();
  play(true);
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
  on('#guest', 'click', () => firstRide());
}

/** sign-up asks only what a rider needs; the rest waits in "Complete your profile" */
type ObStep = 'account' | 'about' | 'hall' | 'look' | 'terms' | 'birthday' | 'uni' | 'social' | 'type';
const SIGNUP_STEPS: ObStep[] = ['account', 'about', 'hall', 'look', 'terms'];
const PROFILE_STEPS: ObStep[] = ['birthday', 'uni', 'social', 'type'];
interface Signup { draft: Profile; email: string; pass: string; step: number; flow: 'signup' | 'complete' }

/** a new sign-up; a guest keeps the coins and rides they already have */
function newSignup(): Signup {
  const base = profile?.guest ? structuredClone(profile) : newProfile();
  return { draft: { ...base, name: base.name === 'Guest' || base.name === 'Rider' ? '' : base.name, hall: '', guest: false }, email: '', pass: '', step: 0, flow: 'signup' };
}

const OB_META: Record<ObStep, { img: string; side: string; line: string }> = {
  account: { img: 'ob-account', side: 'Ride <em>Explore</em> Connect', line: 'Your account keeps your rides, times and coins on any phone.' },
  about: { img: 'ob-about', side: 'Ride <em>Explore</em> Connect', line: 'Other riders see your name when you race or vibe ride.' },
  hall: { img: 'hall-tile', side: 'Ride for your <em>hall</em>', line: 'Every kilometre you ride counts for your hall in Hall Week.' },
  look: { img: 'ob-ride', side: 'Make it <em>yours</em>', line: '' },
  terms: { img: 'ob-welcome', side: 'See you on <em>campus</em>', line: 'Ride safe, ride fair, and have fun.' },
  birthday: { img: 'ob-about', side: 'Tell us about <em>you</em>', line: 'Your birthday is never shown to other riders.' },
  uni: { img: 'ob-uni', side: 'Same campus.<br><em>Bigger</em> adventures.', line: 'Ride where you study, with the people you see every day.' },
  social: { img: 'ob-social', side: 'A stronger <em>campus</em> together.', line: 'Riders you meet can find you after the ride.' },
  type: { img: 'ob-ride', side: 'Ride your <em>way</em>', line: 'We use this to suggest modes and missions for you.' },
};

const RIDER_TYPES: [RiderType, string, string, string][] = [
  ['racer', icons.flag, 'Racer', 'I love competition and winning.'],
  ['explorer', icons.compass, 'Explorer', 'I love discovering new places.'],
  ['social', icons.social, 'Social Rider', 'I love riding with friends.'],
  ['speedster', icons.bolt, 'Speedster', 'I live for speed and thrill.'],
  ['chill', icons.smile, 'Chill Rider', 'I ride to relax and enjoy.'],
];
const STATUSES: [StudentStatus, string, string][] = [['student', icons.grad, 'UG Student'], ['alumni', icons.pillars, 'Alumni'], ['staff', icons.briefcase, 'Staff'], ['visitor', icons.hand, 'Visitor / Guest']];

function onboard(s: Signup = newSignup(), enter: Enter = 'fade'): void {
  const d = s.draft;
  const A = d.about;
  const order = s.flow === 'signup' ? SIGNUP_STEPS : PROFILE_STEPS;
  const id = order[s.step];
  const go = (step: number) => onboard({ ...s, step }, step < s.step ? 'back' : 'next');
  const leave = () => (s.flow === 'complete' ? home('you') : profile ? home() : welcome());
  if (id === 'look') {
    obAuto = () => app.querySelector<HTMLElement>('#go')!.click();
    return dressRider(d, false, { next: () => go(s.step + 1), back: () => go(s.step - 1), step: s.step + 1, of: order.length });
  }
  game.showcase();
  applyLook(d);
  const meta = OB_META[id];
  const field = (icon: string, label: string, input: string, extra = '') => `<label class="ob-field"><span class="ico">${icon}</span><span class="grow"><span class="ob-l">${label}</span>${input}</span>${extra}</label>`;
  const bodies: Record<ObStep, () => [string, string, string]> = {
    account: () => ['Save your <em>progress</em>', `Create your account to keep ${d.coins ? `your ${fmt(d.coins)} coins and ` : ''}every ride.`, `
      ${field(icons.mail, 'Email address', `<input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@st.ug.edu.gh" value="${esc(s.email)}">`)}
      ${field(icons.lock, 'Password', `<input id="pass" type="password" autocomplete="new-password" placeholder="Create a password" value="${esc(s.pass)}">`, '<button type="button" class="eye" id="eye">Show</button>')}
      <div class="rules" id="rules"><span data-r="len">At least 8 characters</span><span data-r="num">Contains a number</span><span data-r="sym">Contains a special character</span></div>
      ${field('@', 'Username', `<input id="user" maxlength="20" autocapitalize="off" placeholder="rudolphrides" value="${esc(d.username)}">`)}
      <button class="btn btn-link" id="skipAcct">Skip for now and save on this phone only</button>`],
    about: () => ['Tell us about <em>you</em>', 'Other riders see this when you race.', `
      <div class="ob-avatar" id="avatar" style="background:#ffd21f">${esc((d.name || '?')[0].toUpperCase())}<i>${icons.camera}</i></div>
      ${field(icons.user, 'Display name', `<input id="name" maxlength="18" autocomplete="nickname" placeholder="Rudolph" value="${esc(d.name)}">`)}
      <p class="ob-label">Gender</p>
      <div class="opt-grid two" id="gender">${(['male', 'female'] as const).map((g) => `<button class="opt row ${d.gender === g ? 'on' : ''}" data-v="${g}">${g === 'male' ? 'Male' : 'Female'}</button>`).join('')}</div>`],
    hall: () => ['Choose your <em>hall</em>', 'Represent your hall and earn points together.', `
      <div class="hall-tiles" id="halls">${HALLS.filter((h) => h.id !== 'none').map((h) => `<button class="hall-t ${d.hall === h.id ? 'on' : ''}" data-v="${h.id}" style="--hc:${h.color}">${esc(h.name)}</button>`).join('')}</div>
      <button class="opt row ${d.hall === 'none' ? 'on' : ''}" data-v="none" id="nonRes">I don't live in a hall (non-resident)</button>`],
    look: () => ['', '', ''],
    terms: () => ['Almost <em>there!</em>', 'Please review and accept to continue.', `
      <div class="terms">
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Terms of Service<button type="button" class="lnk" data-doc="terms">Read Terms of Service</button></span></label>
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Privacy Policy<button type="button" class="lnk" data-doc="privacy">Read Privacy Policy</button></span></label>
        <label class="term"><input type="checkbox" class="must" ${A.termsAt ? 'checked' : ''}><span>I agree to the Community Guidelines<button type="button" class="lnk" data-doc="rules">Read Community Guidelines</button></span></label>
        <label class="term"><input type="checkbox" id="news" ${A.newsOptIn ? 'checked' : ''}><span>Send me news, events and updates about LEGONRUSH <span class="muted">(optional)</span></span></label>
      </div>`],
    birthday: () => ['When is your <em>birthday</em>?', 'Optional. It is never shown to other riders.', `
      ${field(icons.cake, 'Date of birth', `<input id="dob" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${esc(A.dob)}">`)}`],
    uni: () => ['Your <em>university</em>', 'Connect with your campus community.', `
      ${field(icons.pillars, 'University', `<select id="uni">${CAMPUSES.map((c) => `<option value="${c.id}" ${A.campus === c.id ? 'selected' : ''} ${c.open ? '' : 'disabled'}>${esc(c.name)}${c.open ? '' : ' (coming soon)'}</option>`).join('')}</select>`, '<em class="muted">▾</em>')}
      <p class="ob-label">Student status</p>
      <div class="opt-grid two" id="status">${STATUSES.map(([v, i, t]) => `<button class="opt ${A.status === v ? 'on' : ''}" data-v="${v}"><span class="o-ico">${i}</span>${t}</button>`).join('')}</div>
      <div id="progWrap" ${A.status === 'staff' || A.status === 'visitor' ? 'hidden' : ''}>
      ${field(icons.book, 'Programme / Department', `<input id="dept" list="depts" autocomplete="off" placeholder="Start typing, like Computer Science" value="${esc(d.department === OTHER_DEPARTMENT ? '' : d.department)}">`)}
      <datalist id="depts">${DEPARTMENTS.flatMap((g) => g.departments.map((x) => `<option value="${esc(x)}" label="${esc(g.college)}"></option>`)).join('')}</datalist></div>`],
    social: () => ['Connect your <em>social</em>', 'Let riders you meet find you. All optional.', `
      <div class="social-row"><span class="s-logo" style="background:#fffc00;color:#0b1530">${icons.ghost}</span><input id="snap" maxlength="15" autocapitalize="off" placeholder="Snapchat username" value="${esc(d.snap)}"></div>
      <div class="social-row"><span class="s-logo" style="background:#f1f3f8;color:#0b1530">${icons.eye}</span><span class="grow">Who can see your Snapchat?</span>
        <select id="snapVis"><option value="all" ${d.snapPublic ? 'selected' : ''}>Everyone</option><option value="me" ${d.snapPublic ? '' : 'selected'}>Only me</option></select></div>
      <div class="social-row"><span class="s-logo" style="background:linear-gradient(45deg,#f9a825,#e91e63,#7b1fa2)">${icons.camera}</span><input id="insta" maxlength="30" autocapitalize="off" placeholder="Instagram username" value="${esc(A.instagram)}"></div>
      <div class="social-row"><span class="s-logo" style="background:#0b1530">${icons.music}</span><input id="tiktok" maxlength="24" autocapitalize="off" placeholder="TikTok username" value="${esc(A.tiktok)}"></div>`],
    type: () => ['What kind of <em>rider</em> are you?', 'Choose the style that fits you best.', `
      <div class="types" id="types">${RIDER_TYPES.map(([v, i, t, x]) => `<button class="type ${A.riderType === v ? 'on' : ''}" data-v="${v}"><img src="${photo('type-' + v)}" alt="" loading="lazy"><span class="t-ico">${i}</span><span><b>${t}</b><small>${x}</small></span></button>`).join('')}</div>`],
  };
  const [title, sub, body] = bodies[id]();
  const last = s.step === order.length - 1;
  const done = s.flow === 'complete' ? 'Finish' : s.email ? 'Create Account' : 'Finish';
  render(`
    <div class="ob light-ui fade-in" style="--ob-img:url('${photo(meta.img)}')">
      <div class="ob-main">
        <div class="ob-top"><button class="ob-back" id="back" aria-label="Back">‹</button><div class="brand-mark">LEGON<em>RUSH</em></div>
          <div class="ob-progress">${order.map((_, i) => `<i class="${i <= s.step ? 'on' : ''}"></i>`).join('')}</div><span class="ob-count">${s.step + 1}/${order.length}</span></div>
        ${s.flow === 'complete' ? `<p class="kicker ob-kick">Complete your profile · +${PROFILE_REWARD} ${icons.coin}</p>` : ''}
        <h1>${title}</h1>
        <p class="ob-sub">${sub}</p>
        <div class="ob-body">${body}</div>
        <p class="small auth-note" id="note" role="status" hidden></p>
        <div class="ob-foot">
          <button class="btn btn-link desk-back" id="back2">‹ Back</button>
          ${s.flow === 'complete' || id === 'social' ? '<button class="btn btn-link" id="skip">Skip for now</button>' : ''}
          <button class="btn btn-primary" id="next">${last ? done : 'Continue'}</button>
        </div>
      </div>
      <div class="ob-side"><h2>${meta.side}</h2>${meta.line ? `<p>${meta.line}</p>` : ''}</div>
    </div>`, enter);
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>('#' + id)!;
  const v = (id: string) => ($<HTMLInputElement>(id)?.value ?? '').trim();
  const say = (t: string, focus?: string) => {
    const n = $('note');
    n.hidden = false;
    n.textContent = t;
    if (focus) $(focus).focus();
  };
  app.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', () => ($('note').hidden = true)));
  const pick = (sel: string, fn: (v: string) => void) => on(`${sel} [data-v]`, 'click', (_, el) => {
    app.querySelectorAll(`${sel} [data-v]`).forEach((b) => b.classList.toggle('on', b === el));
    fn(el.dataset.v!);
  });
  const back = () => (s.step === 0 ? leave() : go(s.step - 1));
  on('#back', 'click', back);
  on('#back2', 'click', back);
  onBack(back);
  const handle = (raw: string) => raw.trim().replace(/^@/, '');

  // each step checks its answers; false keeps the rider on the step
  const check: Record<ObStep, () => boolean | void> = {
    account: () => {
      s.email = v('email');
      s.pass = $<HTMLInputElement>('pass').value;
      d.username = v('user').replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
      if (!/^\S+@\S+\.\S+$/.test(s.email)) return say('Enter your email address.', 'email');
      if (!(s.pass.length >= 8 && /\d/.test(s.pass) && /[^A-Za-z0-9]/.test(s.pass))) return say('Your password needs 8 characters, a number and a special character like ! or #.', 'pass');
      if (d.username.length < 2) return say('Choose a username of at least 2 letters or numbers.', 'user');
      return true;
    },
    about: () => {
      d.name = v('name');
      if (!d.name) return say('Add a display name.', 'name');
      return true;
    },
    hall: () => (d.hall ? true : say('Choose your hall, or tap "I don\'t live in a hall".')),
    look: () => true,
    terms: () => {
      if ([...app.querySelectorAll<HTMLInputElement>('.must')].some((c) => !c.checked)) return say('Tick the three boxes to agree before you start.');
      A.newsOptIn = $<HTMLInputElement>('news').checked;
      A.termsAt = new Date().toISOString().slice(0, 10);
      return true;
    },
    birthday: () => {
      A.dob = v('dob');
      return true;
    },
    uni: () => {
      A.campus = v('uni') || 'ug';
      if (!A.status) return say('Choose your student status.');
      if (A.status === 'staff' || A.status === 'visitor') { d.department = OTHER_DEPARTMENT; return true; }
      const typed = v('dept');
      const dept = ALL_DEPARTMENTS.find((x) => x.toLowerCase() === typed.toLowerCase());
      if (!dept) return say(typed ? 'Pick your programme from the list.' : 'Choose your programme or department.', 'dept');
      d.department = dept;
      return true;
    },
    social: () => {
      const snap = handle(v('snap'));
      if (snap && !/^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(snap)) return say('That Snapchat username doesn\'t look right. It has 3 to 15 letters, numbers, dots, dashes or underscores.', 'snap');
      d.snap = snap;
      d.snapPublic = v('snapVis') !== 'me';
      A.instagram = handle(v('insta')).replace(/[^A-Za-z0-9._]/g, '');
      A.tiktok = handle(v('tiktok')).replace(/[^A-Za-z0-9._]/g, '');
      return true;
    },
    type: () => (A.riderType ? true : say('Pick the rider type that fits you best.')),
  };

  // step-specific controls
  if (id === 'account') {
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
  if (id === 'about') {
    pick('#gender', (g) => { d.gender = g as Profile['gender']; applyLook(d); });
    $('name').addEventListener('input', () => { $('avatar').firstChild!.textContent = (v('name') || '?')[0].toUpperCase(); });
  }
  if (id === 'uni') pick('#status', (x) => { A.status = x as StudentStatus; $('progWrap').hidden = x === 'staff' || x === 'visitor'; });
  if (id === 'hall') {
    on('#halls [data-v], #nonRes', 'click', (_, el) => {
      d.hall = el.dataset.v!;
      app.querySelectorAll('#halls [data-v], #nonRes').forEach((b) => b.classList.toggle('on', b === el));
      $('note').hidden = true;
      applyLook(d);
    });
  }
  if (id === 'type') pick('#types', (x) => { A.riderType = x as RiderType; $('note').hidden = true; });
  on('[data-doc]', 'click', (e, el) => { e.preventDefault(); docSheet(el.dataset.doc as DocId); });

  const finishProfile = () => {
    profile = d;
    let reward = 0;
    if (profileComplete(d) && !d.about.completedAt) {
      d.about.completedAt = new Date().toISOString().slice(0, 10);
      d.coins += PROFILE_REWARD;
      reward = PROFILE_REWARD;
    }
    saveProfile(d);
    if (reward) {
      sfx.finish();
      celebrate(icons.check, 'Profile complete', `+${reward} coins for telling us about you.`, () => home('you'));
    } else home('you');
  };
  on('#skip', 'click', () => (last ? (s.flow === 'complete' ? finishProfile() : null) : go(s.step + 1)));

  on('#next', 'click', async (_, el) => {
    if (!check[id]()) return;
    if (!last) return go(s.step + 1);
    if (s.flow === 'complete') return finishProfile();
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
    if (id === 'account') { set('email', 'rider@st.ug.edu.gh'); set('pass', 'Legon#2026'); set('user', 'rudolph'); app.querySelector<HTMLElement>('#skipAcct')!.click(); return; }
    if (id === 'about') set('name', 'Rudolph');
    if (id === 'uni') { app.querySelector<HTMLElement>('#status [data-v="student"]')!.click(); set('dept', 'Computer Science'); }
    if (id === 'hall') app.querySelector<HTMLElement>('#halls [data-v="volta"]')?.click();
    if (id === 'type') app.querySelector<HTMLElement>('#types [data-v="explorer"]')!.click();
    if (id === 'terms') app.querySelectorAll<HTMLInputElement>('.must').forEach((c) => (c.checked = true));
    $('next').click();
  };
}

/** a big moment: level up, profile complete */
function celebrate(icon: string, title: string, text: string, then: () => void, extra = '') {
  const ov = document.createElement('div');
  ov.className = 'overlay celebrate light-ui fade-in';
  ov.innerHTML = `<div class="cele-card" role="dialog" aria-label="${esc(title)}">
    <div class="cele-burst" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('')}</div>
    <div class="cele-ico">${icon}</div>
    <h2>${title}</h2>
    <p>${text}</p>
    ${extra}
    <button class="btn btn-primary" data-close>Awesome</button>
  </div>`;
  app.appendChild(ov);
  buzz([30, 40, 30, 40, 90]);
  const close = () => { ov.remove(); then(); };
  ov.querySelector('[data-close]')!.addEventListener('click', close);
  onBack(close);
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
      <div class="ob-welcome-foot">
        ${profile?.rides ? `<p class="small">Finish your profile on the You tab for <b>+${PROFILE_REWARD} coins</b>.</p>` : ''}
        <button class="btn btn-primary" id="first">${profile?.rides ? "Let's go" : 'Start First Ride'}</button>
      </div>
    </div>`);
  onBack(null);
  obAuto = () => 'end';
  on('#first', 'click', () => {
    applyLook();
    if (profile!.rides) return home();
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
const ACCESSORIES: [Accessory, string, string][] = [['helmet', icons.helmet, 'Helmet'], ['sunglasses', icons.glasses, 'Sunglasses'], ['backpack', icons.backpack, 'Backpack'], ['watch', icons.watch, 'Watch'], ['gloves', icons.glove, 'Gloves']];

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
let brakeDown: ((e: KeyboardEvent) => void) | null = null;
let brakeUp: ((e: KeyboardEvent) => void) | null = null;

interface PlayOpts {
  /** bots for Quick Match */
  rivals?: Rival[];
  /** a friend's run from a challenge link */
  challenge?: Challenge;
  /** a timed event this ride counts for */
  event?: EventDef;
  /** riding with people right now: a Quick Match race or a Vibe Ride */
  live?: LiveRide;
  /** a campus mission: time limit, HUD and pass or fail (features/missions.ts) */
  mission?: fx.MissionRun;
  /** this week's treasure hunt: chests to place on the route (the lead wires Game.setTreasure) */
  treasure?: { count: number; seed: number };
  /** Events tab: an event activity riding along (features/events/play.ts) */
  eventPlay?: EventRide;
  /** Race Challenges: HUD panel, result recording, level field and buttons (features/challenges) */
  challengeRide?: ChallengeRide;
  /** Explore's guided ride: very slow, stopping at places along the way to introduce them */
  guided?: boolean;
}

interface LiveRide {
  ch: live.Channel;
  kind: 'race' | 'vibe';
  riders: { id: string; name: string; jersey: string }[];
}

// "Continue where you left off": the last solo ride, remembered on this phone
const LAST_KEY = 'legonrush.last.v1';
interface LastRide { id: string; name: string; from?: string; to?: string; mode?: TravelMode }
function saveLastRide(route: Route) {
  const last: LastRide = route.id === 'explore'
    ? { id: 'explore', name: `To ${route.to.name}`, from: route.from.name, to: route.to.name, mode: exploreOpts.mode }
    : { id: route.id, name: route.name };
  try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch { /* private mode */ }
}
function lastRide(): { last: LastRide; route: () => Route | null } | null {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastRide | null;
    if (!last?.id) return null;
    const route = () => {
      if (last.id === 'freshers-tour') return freshersTour();
      if (last.id !== 'explore') return routeById(last.id);
      const from = placeByName(last.from ?? ''), to = placeByName(last.to ?? '');
      return from && to ? exploreRoute(from, to, last.mode ?? 'cycle') : null;
    };
    return { last, route };
  } catch {
    return null;
  }
}

/** km/h for the speedometer. The game's own figure (HudState.kmh) replaces this when it lands. */

/** a new route takes a moment to build: show a campus fact meanwhile */
function play(tutorial: boolean, route: Route = CAMPUS_LOOP, opts: PlayOpts = {}) {
  if (!profile) return;
  if (game.currentRoute === route) return ride(tutorial, route, opts);
  render(`
    <div class="screen solid center loading light-ui fade-in">
      <div class="brand-mark">LEGON<em>RUSH</em></div>
      <p class="kicker" style="margin-top:18px">Loading</p>
      <h1 class="title">${esc(route.id === 'explore' ? `To ${route.to.name}` : route.name)}</h1>
      <div class="splash-bar"><div></div></div>
      ${factBox()}
    </div>`);
  // let the loading screen paint before the world is built
  setTimeout(() => {
    game.setRoute(route);
    setTimeout(() => ride(tutorial, route, opts), 500);
  }, 60);
}

function ride(tutorial: boolean, route: Route, opts: PlayOpts) {
  if (!profile) return;
  applyLook();
  if (!opts.live && !opts.rivals && !opts.challenge && !opts.challengeRide) saveLastRide(route);
  // the Garage's stats (bike + parts) ride; prize rides and paid Race Challenges are a level field: same plain bike, no upgrades or items
  const levelRide = money.isPrizeRide(route.id) || !!opts.challengeRide?.levelField;
  const bike = levelRide ? bikeById(money.PRIZE_BIKE) : garage.rideSpec(profile);
  // the first ride lends rim brakes, so the brake tip has something to teach
  const brakes = tutorial ? Math.max(1, profile.gear.brakes) : profile.gear.brakes;
  const RING = 2 * Math.PI * 52;
  render(`
    <div class="hud${settings.leftHanded ? ' lefty' : ''}">
      <div class="touch-layer" id="touch"></div>
      <div class="boosting-vignette" id="vignette"></div>
      <div class="hud-top">
        <div class="hud-route">
          <div class="hr-name">${esc(route.id === 'explore' ? `To ${route.to.name}` : route.name)}</div>
          <div class="xpbar"><div id="prog" style="width:0%"></div></div>
          <div class="hr-dist"><span id="dist">0.00</span> / ${km(route.length)} km</div>
          <div class="hr-race"${opts.live?.kind === 'vibe' ? ' hidden' : ''}><p class="place-pill" id="place" hidden></p><p class="ghost-gap" id="ghostGap" hidden></p></div>
        </div>
        <div class="hud-pill coin-hud" id="coinPill">${icons.coin} <span id="coins">0</span></div>
        <button class="pause-btn" id="pause" aria-label="Pause">${icons.pause}</button>
      </div>
      <div class="turn-banner" id="turn" hidden><span class="turn-arrow" id="turnArrow"></span><div><b id="turnDist"></b><span id="turnText"></span></div></div>
      <div class="prompt" id="prompt"></div>
      <div class="tip" id="tip" hidden></div>
      <div class="guide-card" id="guideCard" role="dialog" aria-live="polite" hidden></div>
      <div class="hud-bottom">
        ${brakes ? `<button class="brake-btn" id="brakeBtn" aria-label="Brake">${icons.brake}<span>${isTouch ? 'BRAKE' : 'S / ↓'}</span></button>` : '<span class="hud-slot"></span>'}
        <div class="speedo" id="speedo">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="sp-track" cx="60" cy="60" r="52"/><circle class="sp-boost" id="boostArc" cx="60" cy="60" r="52" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/></svg>
          <b id="kmh">0</b><small>KM/H</small>
          <span class="sp-label" id="boostLabel">${isTouch ? 'BOOST' : 'B · BOOST'}</span>
          ${route.kind === 'explore' ? '' : `<span class="sp-helmets" title="Crash helmets: each one saves you from a crash">${icons.helmet}<span id="helmets">${profile.gear.helmets}</span></span>`}
        </div>
        ${isTouch ? '<button class="boost-btn" id="boostBtn" disabled>BOOST</button>' : '<span class="hud-slot"></span>'}
      </div>
      <canvas class="minimap" id="minimap" width="240" height="240" aria-hidden="true"></canvas>
      ${opts.live?.kind === 'vibe' ? `<div class="ride-chat" id="rideChat"><div class="rc-log" id="rcLog"></div>${quickActions(true)}<form class="chat-form" id="rcForm" hidden><input id="rcSay" maxlength="160" autocomplete="off" placeholder="Message…"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form></div>` : ''}
    </div>`, 'none');

  const $ = (id: string) => app.querySelector<HTMLElement>('#' + id)!;
  const dist = $('dist');
  const prog = $('prog');
  const coins = $('coins');
  const coinPill = $('coinPill');
  const boostArc = $('boostArc');
  const speedo = $('speedo');
  const kmhEl = $('kmh');
  const tipEl = $('tip');
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
    : opts.rivals ?? (opts.mission?.friend ? [opts.mission.friend] : ghost ? [{ run: ghost, name: 'Best run', color: '#9fd8ff', ghostly: true }] : []);
  game.setRivals(rivals);
  game.setGear(profile.gear.helmets, brakes);
  // shop gear, difficulty, live campus weather and treasure
  const setup = fx.rideSetup(profile);
  // prize rides are a level field: no shop items are used up
  if (levelRide) { setup.energy = false; setup.repairKits = 0; }
  let kitsLeft = setup.repairKits;
  game.setUpgrades(setup.upgrades);
  game.setRideItems({ energy: setup.energy, repairKits: setup.repairKits });
  game.setDifficulty(opts.challengeRide?.difficulty ?? settings.difficulty ?? 'normal');
  // weather: sun and showers come and go, or follow Legon's real weather, or stay clear
  const wMode = lr || levelRide || opts.eventPlay || opts.challengeRide?.rain !== undefined ? 'clear' : settings.weather ?? 'changing';
  // events set their own weather (a Rain Rush stays wet)
  let raining = opts.eventPlay ? opts.eventPlay.rain : opts.challengeRide?.rain !== undefined ? opts.challengeRide.rain : wMode === 'live' ? !!weather?.rain : wMode === 'changing' ? Math.random() < 0.25 : false;
  game.setWeather(raining ? 'rain' : 'clear');
  const weatherTimer = wMode === 'changing' ? setInterval(() => {
    if (game.paused || !game.isRiding) return;
    // showers pass after a while; dry spells sometimes end in rain
    if (Math.random() < (raining ? 0.5 : 0.2)) {
      raining = !raining;
      game.setWeather(raining ? 'rain' : 'clear');
      flash(raining ? 'RAIN' : 'SUN', raining ? 'A shower is coming. Roads get slippery' : 'The rain has stopped', 2200);
    }
  }, 45000) : 0;
  game.setTreasure(opts.treasure?.count ?? 0, opts.treasure?.seed ?? 1);
  if (levelRide) money.levelField(game, brakes);
  const flash = (head: string, text: string, ms = 1600) => {
    prompt.innerHTML = `<small>${head}</small>${text}`;
    setTimeout(() => { if (prompt.textContent?.startsWith(head)) prompt.innerHTML = ''; }, ms);
  };
  game.onNearMiss = () => { fx.track(profile!, 'nearMiss'); flash('NEAR MISS', '+2 coins', 900); };
  game.onJump = () => fx.track(profile!, 'jumps');
  game.onDraft = (on) => { if (on) flash('DRAFTING', 'Riding in their slipstream', 1200); };
  game.onRepair = (left) => { kitsLeft = left; flash('REPAIR KIT USED', `${left} kit${left === 1 ? '' : 's'} left`, 2200); };
  game.onTreasure = (found) => { fx.treasureFound(profile!, 1); flash('TREASURE FOUND', `${found} of ${opts.treasure?.count ?? found}`, 1800); };
  const helmetsEl = app.querySelector<HTMLElement>('#helmets');
  const brakeBtn = app.querySelector<HTMLButtonElement>('#brakeBtn');
  game.onHelmet = (left) => {
    profile!.gear.helmets = left;
    saveProfile(profile!);
    if (helmetsEl) helmetsEl.textContent = String(left);
    if (tutorial && !helmetTipShown) return helmetTip(true);
    prompt.innerHTML = `<small>HELMET SAVED YOU</small>${left ? `${left} helmet${left === 1 ? '' : 's'} left` : 'No helmets left. Ride carefully!'}`;
    setTimeout(() => { if (prompt.textContent?.startsWith('HELMET')) prompt.innerHTML = ''; }, 2200);
  };
  const gapName = rivals[0]?.name.replace(/ \(bot\)$/, '') ?? '';
  const missionTick = opts.mission ? fx.missionHud(app.querySelector<HTMLElement>('.hud')!, opts.mission) : null;
  const challengeTick = opts.challengeRide?.hud?.(app.querySelector<HTMLElement>('.hud')!) ?? null;
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
  setStatus('riding', { place: route.to.name }); // COMMUNITY: place is only shared with "show me on map"
  // Vibe Ride: the chat rides with you
  const rideChat = app.querySelector<HTMLElement>('#rideChat');
  if (rideChat && vibe) {
    const log = $('rcLog');
    const form = app.querySelector<HTMLFormElement>('#rcForm')!;
    const input = app.querySelector<HTMLInputElement>('#rcSay')!;
    const draw = () => {
      log.innerHTML = vibe ? chatHtml(vibe, 4) : '';
      if (vibe) markSeen(vibe);
    };
    draw();
    vibe.redraw = () => draw();
    bindChat(rideChat, log, input, () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
  }

  // first ride: four short tips, each at the moment it's needed
  const TIPS = {
    steer: [icons.steer, 'Steer', isTouch ? 'Swipe left or right to change lanes. Swipe up to jump.' : 'Press ← → to change lanes, ↑ or Space to jump.'],
    boost: [icons.bolt, 'Boost', isTouch ? 'Your boost is full. Tap the screen or BOOST to fly and smash through barriers.' : 'Your boost is full. Press B or Shift to fly and smash through barriers.'],
    brake: [icons.brake, 'Brake', `${isTouch ? 'Hold BRAKE' : 'Hold S or ↓'} to slow down before a crash. These rim brakes are on loan for your first ride.`],
    helmet: [icons.helmet, 'Helmets', 'Each crash helmet saves you from one crash, then it is used up. Get more in the Garage.'],
  } as const;
  type TipId = keyof typeof TIPS;
  const ORDER: TipId[] = ['steer', 'boost', 'brake', 'helmet'];
  let tipNow: TipId | null = null;
  let tipTimer = 0;
  let helmetTipShown = false;
  const showTip = (id: TipId | null, ms = 0, lead = '') => {
    clearTimeout(tipTimer);
    tipNow = id;
    tipEl.hidden = !id;
    if (!id) return;
    const [icon, title, text] = TIPS[id];
    tipEl.innerHTML = `<span class="tip-ico">${icon}</span><span class="grow"><small>TIP ${ORDER.indexOf(id) + 1} OF ${ORDER.length}</small><b>${lead || title}</b><span>${text}</span></span>`;
    tipEl.classList.remove('pop');
    void tipEl.offsetWidth;
    tipEl.classList.add('pop');
    if (ms) tipTimer = window.setTimeout(() => { if (tipNow === id) showTip(null); }, ms);
  };
  const helmetTip = (saved: boolean) => {
    helmetTipShown = true;
    showTip('helmet', 6000, saved ? 'Your helmet saved you!' : '');
  };
  let tutStage: 'wait' | 'steer' | 'boost' | 'brake' | 'free' | 'off' = tutorial ? 'wait' : 'off';
  let brakeAt = 0;
  const nextStage = () => {
    if (tutStage === 'steer') {
      tutStage = 'boost';
      game.giveBoost(1);
      setTimeout(() => showTip('boost'), 400);
    } else if (tutStage === 'boost') {
      tutStage = 'brake';
      showTip(null);
      // the brake tip waits until the boost has worn off
      brakeAt = performance.now() + 3500;
    } else if (tutStage === 'brake') {
      tutStage = 'free';
      showTip(null);
      game.releaseSpawns();
      prompt.innerHTML = `You've got it.`;
      setTimeout(() => { if (prompt.textContent === `You've got it.`) prompt.innerHTML = ''; }, 1600);
    }
  };
  let countdownShown = false;

  game.onAction = (a) => {
    if (tutStage === 'steer' && (a === 'left' || a === 'right' || a === 'jump')) setTimeout(nextStage, 700);
    if (tutStage === 'boost' && a === 'boost') nextStage();
  };
  const tutorialTick = (h: HudState) => {
    if (tutStage === 'wait' && !h.countdown) { tutStage = 'steer'; showTip('steer'); }
    if (tutStage === 'brake' && brakeAt && performance.now() > brakeAt) {
      brakeAt = 0;
      showTip('brake');
      // a rider who never brakes moves on after a while
      setTimeout(() => { if (tutStage === 'brake') nextStage(); }, 9000);
    }
    if (tutStage === 'brake' && !brakeAt && h.braking) setTimeout(() => { if (tutStage === 'brake') nextStage(); }, 600);
    // no crash yet by mid-route: explain helmets anyway
    if (tutStage === 'free' && !helmetTipShown && route.kind !== 'explore' && h.distance > h.routeLength * 0.45) helmetTip(false);
  };
  let lastCoins = 0;

  game.onHud = (h: HudState) => {
    missionTick?.(h);
    opts.eventPlay?.hud(h);
    challengeTick?.(h);
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
    if (h.coins !== lastCoins) {
      lastCoins = h.coins;
      coins.textContent = String(h.coins);
      coinPill.classList.remove('pop');
      void coinPill.offsetWidth;
      coinPill.classList.add('pop');
    }
    kmhEl.textContent = String(h.kmh);
    boostArc.style.strokeDashoffset = String(RING * (1 - h.boost));
    const ready = h.boost >= 0.25 && !h.boosting;
    speedo.classList.toggle('ready', ready);
    speedo.classList.toggle('boosting', h.boosting);
    if (boostBtn) boostBtn.disabled = !ready;
    if (tutStage !== 'off') tutorialTick(h);
    vignette.classList.toggle('on', h.boosting);
    brakeBtn?.classList.toggle('on', h.braking);
    if (h.countdown) {
      prompt.innerHTML = `<span class="countdown">${h.countdown}</span>`;
      countdownShown = true;
    } else if (countdownShown) {
      countdownShown = false;
      prompt.innerHTML = '';
    }
  };

  game.onEnd = (r) => {
    cleanup();
    fx.useRideItems(profile!, { energy: setup.energy, repairKits: setup.repairKits - kitsLeft });
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
      for (const f of lr.riders) if (r.distance > 200) community.rodeWith(p, f.id); // COMMUNITY: 'You rode together'
      const rw = applyRide(p, result, finishReward(route));
      cloud.record({ hall: p.hall, department: p.department, km: r.distance / 1000 });
      vibe?.msgs.push({ sys: true, text: `${r.finished ? `You reached ${route.to.name}` : 'You stopped'} · ${km(r.distance)} km · +${rw.coins} coins`, at: Date.now() });
      // a memory card of the ride you shared, with a picture of where you ended up
      if (vibe && lr.riders[0] && r.distance > 100) {
        let photo: string | undefined;
        try { photo = game.capture(); } catch { /* no picture this time */ }
        vibe.memory = { me: p.name, them: lr.riders[0].name, from: route.from.name, to: route.to.name, km: r.distance / 1000, sunset: route.time === 'sunset', at: Date.now(), photo };
        vibe.memoryShown = false;
      }
      return vibeRoom();
    }
    if (lr) setTimeout(() => lr.ch.leave(), 90e3);
    const rewards = applyRide(profile!, result, finishReward(route), event ? 2 : 1);
    cloud.record({ hall: profile!.hall, department: profile!.department, km: r.distance / 1000, race: route.kind === 'race' && r.finished ? { route: route.id, time: r.time } : undefined });
    money.afterRace(route, r, run);
    if (route.kind === 'race' && r.finished && profile!.bestTimes[result.routeId] === r.time) saveGhost(route.id, { time: r.time, ...run });
    // finishing a live event wins its bike
    let prize: string | undefined;
    if (event && r.finished && !profile!.ownedBikes.includes(event.prize)) {
      profile!.ownedBikes.push(event.prize);
      saveProfile(profile!);
      prize = event.prize;
    }
    const feature = fx.afterRide(profile!, route, result, opts.mission) + (opts.eventPlay?.end(r) ?? '') + (opts.challengeRide?.after(result, run, game.rivalTimes) ?? '');
    results(result, rewards, route, { hadGhost: !!ghost, rivals: game.rivalTimes, run, opts, event, prize, feature });
    if (lr) liveStandings(lr, result);
  };

  // controls
  const keyMap: Record<string, Action> = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyB: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost', KeyE: 'pedal',
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
  // brakes: hold S or ↓, or the brake button
  const brakeKey = (on: boolean) => (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); game.setBrake(on); }
  };
  brakeDown = brakeKey(true);
  brakeUp = brakeKey(false);
  addEventListener('keydown', brakeDown);
  addEventListener('keyup', brakeUp);
  if (brakeBtn) {
    const hold = (on: boolean) => (e: Event) => { e.stopPropagation(); e.preventDefault(); game.setBrake(on); };
    brakeBtn.addEventListener('pointerdown', hold(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) brakeBtn.addEventListener(ev, hold(false));
  }

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
    stopAmbience();
    const ov = document.createElement('div');
    ov.className = 'overlay fade-in';
    ov.id = 'pauseOverlay';
    ov.innerHTML = `
      <div class="panel">
        <h2 class="title">Paused</h2>
        <button class="btn btn-primary" data-p="continue">Continue</button>
        ${lr || opts.challengeRide ? '' : '<button class="btn btn-ghost" data-p="restart">Restart</button>'}
        ${lr ? '' : `<button class="btn btn-ghost" data-p="photo">${icons.camera} Photo mode</button>`}
        <button class="btn btn-ghost" data-p="sound">Sound: ${settings.sound ? 'On' : 'Off'}</button>
        <p class="muted small" style="margin:6px 0">${isTouch ? 'Swipe left/right to change lanes, up to jump, tap to boost.' : `← → or A D to steer, ↑ W or Space to jump, B or Shift to boost${profile!.gear.brakes ? ', hold S or ↓ to brake' : ''}, Esc to pause.`}</p>
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
      if (p === 'photo') photoMode();
    }));
  };
  // photo mode: drag to turn the camera around your rider, then save the picture
  const photoMode = () => {
    app.querySelector('#pauseOverlay')?.remove();
    game.paused = false;
    game.setPhotoMode(true);
    app.classList.add('photo-on');
    const ov = document.createElement('div');
    ov.className = 'photo-ui';
    ov.id = 'pauseOverlay';
    ov.innerHTML = `<p class="photo-hint">Drag to move the camera</p><div class="photo-bar"><button class="btn btn-ghost" data-ph="back">Back</button><button class="btn btn-primary" data-ph="save">${icons.camera} Save photo</button></div>`;
    app.appendChild(ov);
    let px = 0, py = 0, drag = false;
    ov.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) return; drag = true; px = e.clientX; py = e.clientY; });
    ov.addEventListener('pointermove', (e) => { if (!drag) return; game.orbitPhoto(e.clientX - px, e.clientY - py); px = e.clientX; py = e.clientY; });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) ov.addEventListener(ev, () => (drag = false));
    const back = () => { game.setPhotoMode(false); app.classList.remove('photo-on'); ov.remove(); game.paused = false; togglePause(); };
    onBack(back);
    ov.querySelector('[data-ph="back"]')!.addEventListener('click', back);
    ov.querySelector('[data-ph="save"]')!.addEventListener('click', async () => {
      const url = game.capture();
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'legonrush-ride.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: 'My LEGONRUSH ride' });
      } catch { /* fall back to download */ }
      const a = document.createElement('a');
      a.href = url;
      a.download = 'legonrush-ride.png';
      a.click();
    });
  };
  const resume = () => {
    game.paused = false;
    music(true);
    startAmbience(ambience());
    app.querySelector('#pauseOverlay')?.remove();
    onBack(togglePause);
  };
  const leave = () => {
    if (lr) {
      lr.ch.send('done', { k: myId(), name: profile!.name, km: 0, finished: false, time: 0 });
      if (lr.kind === 'vibe') return vibeRoom();
      lr.ch.leave();
      return opts.challengeRide ? opts.challengeRide.leave() : home('race');
    }
    if (opts.challengeRide) return opts.challengeRide.leave();
    leaveSolo();
  };
  const night = (route.time ?? 'day') === 'night';
  const ambience = () => ({ night, rain: raining, market: marketProximity(...game.riderXZ) });
  const ambTimer = setInterval(() => { if (!game.paused) setAmbience(ambience()); }, 1000);
  const leaveSolo = () => (opts.eventPlay ? opts.eventPlay.leave() : opts.mission ? fx.missionsScreen() : route.id === 'explore' ? explorePicker(route.from.name, route.to.name) : route.id === 'freshers-tour' ? explorePicker() : home(opts.event ? 'events' : opts.rivals || opts.challenge ? 'race' : route.kind === 'race' ? 'ride' : 'home'));
  $('pause').addEventListener('click', togglePause);
  const onHidden = () => { if (document.hidden && game.isRiding && !game.paused) togglePause(); };
  document.addEventListener('visibilitychange', onHidden);

  function cleanup() {
    // Map tab: the You marker starts where this ride ended
    rememberRidePos(game.riderXZ, settings.campus);
    app.classList.remove('photo-on');
    music(false);
    stopAmbience();
    clearInterval(ambTimer);
    clearInterval(weatherTimer);
    game.onNearMiss = game.onJump = () => {};
    game.onDraft = game.onRepair = game.onTreasure = () => {};
    if (keyHandler) removeEventListener('keydown', keyHandler);
    keyHandler = null;
    if (brakeDown) removeEventListener('keydown', brakeDown);
    if (brakeUp) removeEventListener('keyup', brakeUp);
    brakeDown = brakeUp = null;
    game.setBrake(false);
    document.removeEventListener('visibilitychange', onHidden);
    game.onHud = () => {};
    game.onEnd = () => {};
    game.onAction = () => {};
    game.onGuide = () => {};
    game.tour = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    game.paused = false;
    clearInterval(stream);
    clearTimeout(tipTimer);
    if (vibe) { vibe.onPos = null; vibe.redraw = null; }
    opts.eventPlay?.stop();
  }

  game.calm = lr?.kind === 'vibe' || (isExplore(route) && exploreOpts.calm);
  // Explore's guided ride: walking pace, stopping at each place to introduce it
  const guide = opts.guided && isExplore(route) && !lr ? guideStops(route) : [];
  game.tour = guide.length ? { stops: guide.map((g) => ({ d: g.d, x: g.place.x, z: g.place.z })), speed: exploreOpts.mode === 'walk' ? 2.4 : 4 } : null;
  if (game.tour) game.calm = true;
  const guideCard = $('guideCard');
  const canSpeak = 'speechSynthesis' in window;
  const say = (text: string) => {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.95;
    speechSynthesis.speak(u);
  };
  game.onGuide = (i) => {
    guideCard.hidden = i === null;
    if (i === null) { if (canSpeak) speechSynthesis.cancel(); return; }
    const g = guide[i];
    const [icon, label] = KIND_ICON[g.place.kind];
    const where = i === 0 ? 'You start at' : i === guide.length - 1 && g.place === route.to ? 'You have arrived at' : 'Now passing';
    guideCard.innerHTML = `
      <p class="kicker">Stop ${i + 1} of ${guide.length} · ${esc(where)}</p>
      <div class="row gc-head"><span class="kind-icon" title="${esc(label)}">${icon}</span><h2>${esc(g.entry.title)}</h2></div>
      <p>${esc(g.entry.intro)}</p>
      <p class="kicker">What students do here</p>
      <ul>${g.entry.doHere.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="row gc-actions">
        ${canSpeak ? `<button class="btn btn-ghost btn-sm" id="gcSay">${icons.megaphone} Read aloud</button>` : ''}
        <button class="btn btn-primary" id="gcGo">${i === guide.length - 1 && g.place === route.to ? 'Finish' : 'Continue riding'}</button>
      </div>`;
    guideCard.querySelector('#gcSay')?.addEventListener('click', () => say(`${g.entry.title}. ${g.entry.intro} What students do here: ${g.entry.doHere.join('. ')}.`));
    guideCard.querySelector('#gcGo')!.addEventListener('click', () => game.continueTour());
  };
  // auto graphics: drop to smooth mode once if this phone can't keep up
  game.watchSpeed = settings.graphics === 'auto' && !settings.slowDevice;
  game.onSlow = () => {
    changeSettings({ slowDevice: true });
    prompt.innerHTML = `<small>GRAPHICS</small>Switched to smooth mode for this phone`;
    setTimeout(() => { if (prompt.textContent?.includes('smooth mode')) prompt.innerHTML = ''; }, 3000);
  };
  game.start(bike, tutorial);
  // Events tab: the event's rules (night, fog, no boost...) and its HUD start with the ride
  opts.eventPlay?.start({ game, hud: app.querySelector<HTMLElement>('.hud')!, brakes, quit: () => { cleanup(); opts.eventPlay!.leave(); } });
  music(true);
  startAmbience(ambience());
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
  /** mission outcome, campus-guide facts and new badges (features/index.ts afterRide) */
  feature?: string;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** A link that lets a friend race this run. */
const challengeLink = (route: Route, run: GhostRun, time: number) =>
  `${PLAY_URL}?c=${encodeChallenge({ routeId: route.id, name: profile?.name || 'A friend', time, run })}`;

/** the route a challenge or event names: the Campus Loop or one of the races */
function routeById(id: string): Route | null {
  if (id === CAMPUS_LOOP.id) return CAMPUS_LOOP;
  const def = RACES.find((r) => r.id === id);
  return def ? raceRoute(def) : MAP_ROUTES.find((r) => r.id === id)?.route() ?? null;
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

/** the Garage tab (src/tabs/garage.ts); the older all-in-one screen below is kept only as a fallback */
function garageScreen() {
  if (tabView('garage')) return home('garage');
  oldGarageScreen();
}
function oldGarageScreen() {
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
        <div class="row"><h1 class="title">Garage &amp; shop</h1><span class="grow"></span>${money.shopBuyHtml()}<span class="chip">${icons.coin} ${fmt(p.coins)}</span></div>
        <h2 class="shop-h">${icons.shop} Ride gear</h2>
        <div class="gear-grid">
          <div class="card gear-card">
            <div class="gear-ico">${icons.helmet}</div>
            <div class="grow"><h3>Crash helmet</h3><p class="muted small">Saves you from one crash, so the ride goes on. Used up when it saves you.</p>
              <p class="gear-have">You have <b>${p.gear.helmets}</b></p></div>
            <div class="gear-buy">
              <button class="btn btn-primary btn-sm" data-helmets="1" ${p.coins < SHOP.helmet.price ? 'disabled' : ''}>1 for ${fmt(SHOP.helmet.price)} ${icons.coin}</button>
              <button class="btn btn-ghost btn-sm" data-helmets="${SHOP.helmet.pack}" ${p.coins < SHOP.helmet.packPrice ? 'disabled' : ''}>${SHOP.helmet.pack} for ${fmt(SHOP.helmet.packPrice)} ${icons.coin}</button>
            </div>
          </div>
          ${SHOP.brakes.map((b) => `<div class="card gear-card${p.gear.brakes >= b.level ? ' owned' : ''}">
            <div class="gear-ico">${icons.brake}</div>
            <div class="grow"><h3>${b.name}</h3><p class="muted small">${b.text} ${isTouch ? 'Hold the brake button.' : 'Hold S or ↓.'}</p></div>
            <div class="gear-buy">${p.gear.brakes >= b.level ? `<span class="badge gold">${icons.check} Fitted</span>` : `<button class="btn btn-primary btn-sm" data-brakes="${b.level}" ${p.coins < b.price ? 'disabled' : ''}>${fmt(b.price)} ${icons.coin}</button>`}</div>
          </div>`).join('')}
          ${fx.gearCards(p)}
        </div>
        ${fx.shopSections(p)}
        <h2 class="shop-h">${icons.bike} Bikes</h2>
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
  on('[data-helmets]', 'click', (_, el) => {
    const n = Number(el.dataset.helmets);
    const price = n === 1 ? SHOP.helmet.price : SHOP.helmet.packPrice;
    if (p.coins < price) return;
    p.coins -= price;
    p.gear.helmets += n;
    saveProfile(p);
    sfx.coin();
    garageScreen();
  });
  on('[data-brakes]', 'click', (_, el) => {
    const b = SHOP.brakes.find((x) => x.level === Number(el.dataset.brakes))!;
    if (p.coins < b.price || p.gear.brakes >= b.level) return;
    p.coins -= b.price;
    p.gear.brakes = b.level;
    saveProfile(p);
    sfx.finish();
    garageScreen();
  });
  on('[data-buy]', 'click', (_, el) => {
    const b = bikeById(el.dataset.buy!);
    if (!b.price || p.coins < b.price || p.ownedBikes.includes(b.id)) return;
    p.coins -= b.price;
    p.ownedBikes.push(b.id);
    sfx.finish();
    equip(b.id);
  });
  fx.bindShop(p, () => {
    const y = scrollY;
    garageScreen();
    scrollTo(0, y);
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

/** after a ride, one clear next step: what most riders would want to do now */
interface NextStep { label: string; run: () => void }
function nextStep(r: RideResult, rw: RideRewards, route: Route, x: ResultExtras, again: () => void): NextStep {
  const p = profile!;
  const explore = isExplore(route);
  if (x.opts.challengeRide?.next) return x.opts.challengeRide.next;
  if (x.opts.live) return { label: 'Race again', run: again };
  if (x.opts.challenge) return { label: r.finished && r.time < x.opts.challenge.time ? 'Ride again' : 'Try again', run: again };
  if (explore) return { label: 'Go somewhere else', run: () => explorePicker(route.id === 'explore' ? route.to.name : undefined) };
  if (!r.finished) {
    // out of helmets and able to buy one: the shop is the fix
    if (!p.gear.helmets && p.coins >= SHOP.helmet.price) return { label: `Get a helmet · ${fmt(SHOP.helmet.price)} coins`, run: () => openStore('gear') };
    return { label: 'Retry', run: again };
  }
  const level = levelFor(p.xp);
  const next = RACES.find((d) => d.id !== route.id && level >= d.level && p.bestTimes[d.id] === undefined);
  if (next) return { label: `Next race: ${next.name}`, run: () => play(false, raceRoute(next)) };
  const bike = GARAGE_BIKES.find((b) => b.price && !p.ownedBikes.includes(b.id) && p.coins >= b.price);
  const brake = SHOP.brakes.find((b) => b.level > p.gear.brakes && p.coins >= b.price);
  if (bike || brake) return { label: `Shop: ${bike ? bike.name : brake!.name}`, run: () => openStore(bike ? 'bikes' : 'parts') };
  return { label: 'Ride again', run: again };
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
  const again = () => (x.opts.challengeRide ? (x.opts.challengeRide.next?.run ?? (() => play(false, route, x.opts)))() : x.opts.live ? quickMatch() : play(false, route, x.opts.rivals ? { ...x.opts, rivals: botRivals(route, 3, settings.difficulty ?? 'normal') } : x.opts));
  // a guest has just had their first taste: now is the moment to save it
  const invite = p.guest && !x.opts.live;
  const step = nextStep(r, rw, route, x, again);
  render(`
    <div class="screen scrim fade-in results">
      <div class="grow"></div>
      <div class="wrap stack">
        <p class="kicker">${esc(route.name)}</p>
        <h1 class="title">${headline}</h1>
        ${explore && r.finished && route.id === 'explore' ? placeCard(route.to) : ''}
        ${explore && r.finished ? `<p class="muted">${route.id === 'freshers-tour' ? `You toured ${TOUR_STOPS.length} places every fresher needs.` : `You found your way to <b>${esc(route.to.name)}</b>.`} Here is the way you rode:</p>${stepsList(route)}` : ''}
        ${rw.newBestTime ? '<span class="badge gold">New personal best</span>' : rw.newBestScore ? '<span class="badge gold">New high score</span>' : ''}
        <div class="result-big">${km(r.distance)} <span style="font-size:0.4em">KM</span></div>
        ${r.finished ? `<p class="muted">Time ${clock(r.time)}</p>` : ''}
        <div class="card">
          <div class="reward-row"><span>Score</span><b data-count="${rw.score}">0</b></div>
          <div class="reward-row"><span>Coins</span><b>+<span data-count="${rw.coins}">0</span> ${icons.coin}</b></div>
          <div class="reward-row"><span>XP</span><b>+<span data-count="${rw.xp}">0</span></b></div>
        </div>
        ${x.feature ?? ''}
        ${!r.finished && !explore && !p.gear.helmets && !invite && p.coins < SHOP.helmet.price ? `<div class="card helmet-tip"><span class="gear-ico">${icons.helmet}</span><span class="grow"><b>Out of helmets</b><span class="muted small">A crash helmet saves you from your next crash. ${fmt(SHOP.helmet.price)} coins in the Garage.</span></span></div>` : ''}
        ${verdict ? `<div class="levelup">${verdict}</div>` : ''}
        ${table.length > 1 ? `<div class="card standings" id="standings">${table.map((t, i) => `<div class="reward-row${t.me ? ' me' : ''}"><span>${ordinal(i + 1)} · ${esc(t.name)}</span><b>${Number.isFinite(t.time) ? clock(t.time) : 'DNF'}</b></div>`).join('')}</div>` : ''}
        ${x.event ? `<p class="muted small">${eventIcon(x.event)} ${esc(x.event.name)} is live: coins doubled.</p>` : ''}
        ${prizeBike ? `<div class="levelup">${icons.trophy} You won the ${esc(prizeBike.name)}! Equip it in the Garage.</div>` : ''}
        ${route.kind === 'race' && r.finished && !hadGhost && !x.rivals.length && !invite ? `<p class="muted small">Next time on this route, a ghost of this run rides with you. Beat it.</p>` : ''}
        ${invite ? `<div class="card invite-card stack">
            <div class="row"><span class="gear-ico">${icons.user}</span><span class="grow"><b>Save your progress</b><span class="muted small">Create your account to keep your ${fmt(p.coins)} coins, pick your hall and race your friends.</span></span></div>
            <button class="btn btn-primary" id="create">Create my account</button>
            <button class="btn btn-link" id="later">Later</button>
          </div>`
          : `<button class="btn btn-primary next-step" id="next">${esc(step.label)} ${icons.arrow}</button>
            <div class="two">
              ${step.label === 'Retry' || step.label === 'Try again' || step.label === 'Ride again' || step.label === 'Race again' ? `<button class="btn btn-ghost" id="garage">${icons.shop} Shop</button>` : `<button class="btn btn-ghost" id="again">${icons.replay} Retry</button>`}
              <button class="btn btn-ghost" id="home">${icons.home} Home</button>
            </div>`}
        ${route.kind === 'race' && r.finished ? `<div class="result-links"><button class="btn btn-link" id="challenge">${icons.send} ${ch ? `Send ${esc(ch.name)} your answer` : 'Challenge a friend'}</button><button class="btn btn-link" id="board">${icons.trophy} Leaderboard</button></div><p class="muted small" id="shareNote" hidden></p>` : ''}
      </div>
    </div>`);
  // animated counters
  app.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => countUp(el, 0, Number(el.dataset.count)));
  on('#next', 'click', () => step.run());
  on('#again', 'click', again);
  on('#garage', 'click', () => garageScreen());
  on('#challenge', 'click', () => share(`Can you beat my ${clock(r.time)} on ${route.name}? Race my run on LEGONRUSH`, challengeLink(route, x.run, r.time), app.querySelector('#shareNote')!));
  on('#home', 'click', () => home());
  on('#later', 'click', () => home());
  on('#create', 'click', () => onboard());
  on('#board', 'click', () => boardScreen(route.id, () => home('race')));
  onBack(() => home());
  // level up: a moment of its own, with what it unlocked
  if (levelUp) {
    setTimeout(() => {
      if (!app.querySelector('.results')) return;
      sfx.finish();
      celebrate(icons.star, `Level ${rw.levelAfter}!`, unlocked.length ? 'You unlocked something new.' : 'Keep riding to unlock new races and bikes.',
        () => onBack(() => home()),
        unlocked.map((u) => `<button class="card selectable unlock-card" data-race="${u.id}"><div class="row"><b>${icons.unlock} New race: ${esc(u.name)}</b><span class="grow"></span>${icons.arrow}</div><p class="muted small">${esc(u.blurb)}</p></button>`).join(''));
      app.querySelectorAll<HTMLElement>('.celebrate [data-race]').forEach((el) => el.addEventListener('click', () => play(false, raceRoute(RACES.find((d) => d.id === el.dataset.race)!))));
    }, settings.reducedMotion ? 0 : 1100);
  }
}

// ---------- hub ----------

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

let tabCleanup: (() => void) | null = null;

/** phones: the tabs that don't fit in the bottom bar */
function moreSheet() {
  const sh = document.createElement('div');
  sh.className = 'overlay sheet-overlay fade-in';
  sh.innerHTML = `<div class="sheet light-ui more-sheet" role="dialog" aria-label="More"><div class="row"><h2 class="title" style="font-size:22px">More</h2><span class="grow"></span><button class="btn btn-link" data-close>Close</button></div>
    <div class="more-grid">${NAV.filter(([id]) => !PHONE_NAV.includes(id)).map(([id, label, icon]) => `<button class="more-item" data-go="${id}"><span class="p-ico">${icon}</span>${label}</button>`).join('')}
    <button class="more-item" data-go="settings"><span class="p-ico">${icons.gear}</span>Settings</button></div></div>`;
  document.body.appendChild(sh);
  const close = () => sh.remove();
  sh.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (b) { close(); return b.dataset.go === 'settings' ? settingsScreen() : home(b.dataset.go as TabId); }
    if (e.target === sh || (e.target as HTMLElement).closest('[data-close]')) close();
  });
}
/** id, label, icon, shown in the phone's bottom bar */
// side menu on computers; phones show the first four plus More
const NAV: [TabId, string, string][] = [
  ['home', 'Home', icons.home], ['challenges', 'Challenges', icons.race], ['events', 'Events', icons.events],
  ['community', 'Community', icons.social], ['map', 'Map', icons.map], ['garage', 'Garage', icons.garage],
  ['store', 'Store', icons.shop], ['you', 'Profile', icons.you],
];
const PHONE_NAV: TabId[] = ['home', 'challenges', 'events', 'community'];

function shell(content: string) {
  const c = campusById(settings.campus);
  return `
    <div class="shell">
      <nav class="nav">
        <div class="nav-brand"><div class="brand-mark">LEGON<span>RUSH</span></div></div>
        ${NAV.map(([id, label, icon]) => `<button class="nav-item${tab === id ? ' active' : ''}${PHONE_NAV.includes(id) ? '' : ' desk-only'}" data-nav="${id}">${icon}<span>${label}</span></button>`).join('')}
        <button class="nav-item phone-only-flex${PHONE_NAV.includes(tab as TabId) ? '' : ' active'}" data-more>${icons.grid}<span>More</span></button>
        <button class="nav-campus" data-campus><small>Riding on</small><b>${esc(c.id === 'ug' ? 'University of Ghana, Legon' : c.name)}</b><span class="small">Change campus →</span></button>
      </nav>
      <main class="content fade-in tab-${tab}">${tab === 'home' || tabView(tab as TabId)?.bare ? content : topBar() + content}</main>
    </div>`;
}

/** the coin count the player last saw, so new coins count up into it */
let shownCoins = -1;
function animateCoins() {
  const p = profile;
  if (!p) return;
  app.querySelectorAll<HTMLElement>('.coin-count').forEach((el) => countUp(el, shownCoins < 0 ? p.coins : shownCoins, p.coins, 1100));
  if (shownCoins >= 0 && p.coins > shownCoins) app.querySelector('.coin-pill')?.classList.add('pop');
  shownCoins = p.coins;
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
    <span class="coin-pill">${icons.coin} <span class="coin-count">${fmt(shownCoins < 0 ? p.coins : shownCoins)}</span></span>
    <button class="icon-btn" id="bell" aria-label="Invites">${icons.bell}${notices.length ? `<i class="dot-badge">${notices.length}</i>` : ''}</button>
    <button class="me-btn" data-nav="you" aria-label="Your profile"><span class="avatar sm" style="background:${hallById(p.hall).color}">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="lv-wrap"><span class="lv">Lv ${level}</span><span class="lv-bar"><i style="width:${((p.xp - lo) / (hi - lo)) * 100}%"></i></span></span></button>
    <button class="icon-btn desk-only" id="settingsTop" aria-label="Settings">${icons.gear}</button>
  </header>`;
}

/** Legon's weather now, for the top bar; quietly absent when offline */
let weather: { icon: string; temp: number; word: string; at: number; rain?: boolean } | null = null;
const WEATHER: [number, string, string][] = [[0, icons.sun, 'Sunny'], [2, icons.cloudSun, 'Partly cloudy'], [3, icons.cloud, 'Cloudy'], [48, icons.fog, 'Hazy'], [67, icons.rain, 'Rain'], [82, icons.rain, 'Showers'], [99, icons.storm, 'Storm']];
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
    weather = { icon: night && code <= 2 ? icons.moon : icon, temp: Math.round(j.current.temperature_2m), word: night && code <= 2 ? 'Clear' : word, at: Date.now(), rain: code >= 51 && code < 70 || code >= 80 };
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

const eventIcon = (e: { id: string }) => (e.id === 'night-rush' ? icons.moon : icons.sunrise);
const photo = (name: string) => `${import.meta.env.BASE_URL}photos/${name}.webp`;
const MODES = [
  { id: 'explore', icon: icons.map, title: 'Explore', text: 'Discover campus, hidden routes and iconic locations.', img: photo('mode-explore') },
  { id: 'match', icon: icons.flag, title: 'Quick Match', text: 'Get matched with riders online and race now.', img: photo('mode-match') },
  { id: 'missions', icon: icons.target, title: 'Missions', text: 'Clear level 1 to unlock level 2. Each level gets harder.', img: photo('mode-challenge') },
  { id: 'vibe', icon: icons.heart, title: 'Vibe Ride', text: 'Meet someone, ride together and enjoy the ride.', img: photo('mode-vibe') },
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

/** "Complete your profile": the answers sign-up skipped, for a coin reward */
function completeCard(p: Profile) {
  if (p.about.completedAt) return '';
  const t = profileTodo(p);
  const items: [boolean, string][] = [[t.birthday, 'Birthday'], [t.campus, 'Campus and programme'], [t.social, 'Socials'], [t.type, 'Rider type']];
  const done = items.filter(([ok]) => ok).length;
  return `<div class="card stack complete-card">
    <div class="row"><span class="gear-ico">${icons.user}</span><span class="grow"><b>Complete your profile</b><span class="muted small">${done} of ${items.length} done. Tell riders a bit more about you.</span></span><span class="badge gold">+${PROFILE_REWARD} ${icons.coin}</span></div>
    <div class="xpbar"><div style="width:${(done / items.length) * 100}%"></div></div>
    <div class="todo">${items.map(([ok, label]) => `<span class="${ok ? 'ok' : ''}">${ok ? icons.check : '<i></i>'} ${label}</span>`).join('')}</div>
    <button class="btn btn-primary" id="completeProfile">Finish my profile</button>
  </div>`;
}

function continueRow() {
  const lr = lastRide();
  if (!lr || lr.last.id === CAMPUS_LOOP.id) return '';
  const best = profile?.bestTimes[lr.last.id];
  return `<button class="continue-row" id="continue">
    <span class="p-ico">${icons.replay}</span>
    <span class="grow"><small>Continue where you left off</small><b>${esc(lr.last.name)}</b></span>
    ${best ? `<span class="muted small">Best ${clock(best)}</span>` : ''}
    <span class="cr-go">${icons.arrow}</span>
  </button>`;
}

function missionsPanel() {
  const m = todayMissions(profile!);
  return `<div class="panel">
    <div class="panel-head"><span class="p-ico">${icons.target}</span><b>Daily Missions</b><span class="muted small" style="margin-left:auto">Resets at midnight</span></div>
    <div class="mission-list">${MISSIONS.map((x) => {
      const got = Math.min(x.goal, x.progress(m));
      const done = got >= x.goal;
      const claimed = m.claimed.includes(x.id);
      return `<div class="mission${claimed ? ' claimed' : ''}">
        <span class="m-icon">${icons[x.icon as keyof typeof icons] ?? ''}</span>
        <div class="grow"><div class="small" style="font-weight:600">${esc(x.title)}</div><div class="xpbar"><div style="width:${(got / x.goal) * 100}%"></div></div></div>
        <span class="m-count">${x.unit ? got.toFixed(1) : got} / ${x.goal}</span>
        ${claimed ? `<span class="m-reward">${icons.check}</span>` : done ? `<button class="btn btn-primary btn-sm" data-mission="${x.id}">+${x.reward}</button>` : `<span class="m-reward">${icons.coin} ${x.reward}</span>`}
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
    <span class="lp-meta"><span>${icons.events} ${live ? 'Now' : `Today · ${hourText(st.next)}`}</span><span>${icons.pin} ${esc(routeById(e.race)?.name ?? 'Campus')}</span></span>
  </button>`;
}

/** what still works without a connection */
const offlineNote = (compact = false) => `<div class="offline-card${compact ? ' compact' : ''}" role="status">
    <span class="p-ico">${icons.wifiOff}</span>
    <span class="grow"><b>You're offline</b><span>Solo rides, Explore, the Garage and your progress all still work. Online races, Vibe Ride and leaderboards come back when you reconnect.</span></span>
  </div>`;

function onlinePanel() {
  if (!navigator.onLine) return `<div class="panel online-panel">${offlineNote(true)}</div>`;
  return `<div class="panel online-panel">
    <div class="panel-head"><span class="p-ico">${icons.social}</span><b>Riders Online</b><span class="small" style="margin-left:auto;font-weight:600"><span class="dot-live"></span> <span id="onlineCount">${onlineCountText()}</span></span></div>
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
  const want = TAB_ALIAS[next] ?? next;
  tabCleanup?.();
  tabCleanup = null;
  // tabs not rebuilt yet open their older screens
  if (want === 'garage' && !tabView('garage')) return oldGarageScreen();
  if (want === 'store' && !tabView('store')) return money.buyCoinsScreen();
  tab = want as TabId | 'ride';
  game.showcase();
  game.sleep = !!(want !== 'home' && tabView(want as TabId)?.bare);
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
  const TIME_ICON = { day: icons.sun, sunset: icons.sunrise, night: icons.moon };
  const raceCard = (r: RaceDef) => {
    if (level < r.level) {
      return `<div class="card locked"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge">Level ${r.level}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">Reach level ${r.level} to unlock.</p></div>`;
    }
    const route = raceRoute(r);
    const b = p.bestTimes[r.id];
    return `<button class="card selectable" data-race="${r.id}" style="text-align:left"><div class="row"><h3 style="font-weight:800">${TIME_ICON[r.time]} ${esc(r.name.toUpperCase())}</h3><span class="grow"></span><span class="badge gold">250 ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">${esc(r.blurb)}</p><p class="muted small" style="margin-top:4px">${(route.length / 1000).toFixed(1)} km · Difficulty ${stars(r.difficulty)}${b ? ` · Best ${clock(b)}` : ''}</p></button>`;
  };
  const week = currentWeek(p);
  const eventCard = (e: EventDef) => {
    const st = eventStatus(e);
    const route = routeById(e.race)!;
    const prize = bikeById(e.prize);
    const won = p.ownedBikes.includes(e.prize);
    return `<div class="card stack event-card${st.live ? ' live' : ''}" style="gap:8px">
      <div class="row"><h3 style="font-weight:800">${eventIcon(e)} ${esc(e.name.toUpperCase())}</h3><span class="grow"></span><span class="badge${st.live ? ' gold live-badge' : ''}">${st.live ? 'Live now' : `Starts at ${hourText(st.next)}`}</span></div>
      <p class="muted small">${esc(e.blurb)}</p>
      <p class="small">${esc(route.name)} · ${(route.length / 1000).toFixed(1)} km · ${st.live ? `<b>2× coins</b>, ends ${hourText(st.ends!)}` : `opens ${inText(st.next)}`}</p>
      <div class="row small"><span class="hall-swatch" style="background:${prize.color}"></span><span>${won ? `You won the ${esc(prize.name)} ✓` : `Finish while live to win the <b>${esc(prize.name)}</b>`}</span></div>
      <button class="btn ${st.live ? 'btn-primary' : 'btn-ghost'}" data-event="${e.id}">${st.live ? 'Ride now' : 'Practise the route'}</button>
    </div>`;
  };
  const unlocked = [CAMPUS_LOOP, ...RACES.filter((r) => level >= r.level).map(raceRoute)];
  const exploreCard = `<button class="card selectable explore-card" id="exploreBtn"><div class="row"><h3 style="font-weight:800">${icons.map} EXPLORE</h3><span class="grow"></span><span class="badge gold">Directions</span></div><p class="muted small" style="margin-top:4px">Discover the campus your way. Ride freely through familiar places, find hidden routes and shortcuts, and visit iconic landmarks.</p></button>
    <button class="card selectable explore-card" id="quizBtn"><div class="row"><h3 style="font-weight:800">${icons.pin} WHERE IS IT?</h3><span class="grow"></span><span class="badge gold">Earn ${icons.coin}</span></div><p class="muted small" style="margin-top:4px">Five campus places. Tap the map where you think each one is.</p></button>`;
  const firstName = p.name.split(' ')[0];

  const views: Record<'home' | 'ride' | 'race' | 'events' | 'social' | 'you', string> = {
    home: `
      <div class="home">
        ${topBar()}
        <div class="home-head">
          <section class="hello">
            <p class="greet">${greeting()},</p>
            <h1>${esc(firstName)}</h1>
            <p class="slogan">Your campus. Your ride. Your competition.</p>
          </section>
          <div class="stat-chips">
            <div class="stat-chip"><span class="s-ico">${icons.crown}</span><span><b>${level}</b><small>Level</small></span></div>
            <div class="stat-chip opt-chip"><span class="s-ico">${icons.bike}</span><span><b>${p.rides}</b><small>Rides</small></span></div>
            <div class="stat-chip"><span class="s-ico">${icons.flag}</span><span><b>${(p.totalDistance / 1000).toFixed(1)} km</b><small>Distance</small></span></div>
            <div class="stat-chip"><span class="s-ico">${icons.trophy}</span><span><b>${p.wins}</b><small>Races won</small></span></div>
            ${daily ? `<button class="stat-chip daily-chip" id="daily"><span class="s-ico">${icons.gift}</span><span><b>+${daily.coins}</b><small>Daily reward</small></span></button>` : ''}
          </div>
        </div>
        ${quickRideCard()}
        ${continueRow()}
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
          <p class="muted small" style="margin-top:4px">${(CAMPUS_LOOP.length / 1000).toFixed(1)} km · Difficulty ${stars(CAMPUS_LOOP.difficulty)}${best ? ` · Best ${clock(best)}` : ''}</p>
        </div>
        ${RACES.map(raceCard).join('')}
      </div>`,
    race: `
      <div class="hub">
        <p class="kicker">Race</p>
        <h1 class="title">Race someone</h1>
        ${navigator.onLine ? '' : offlineNote()}
        <button class="ride-cta" id="quick">
          <div><div class="big" style="font-size:26px">${icons.flag} QUICK MATCH</div><div class="sub">Race against riders online. Get matched with available riders and jump straight into a live race.</div></div>${icons.arrow}
        </button>
        <p class="kicker" style="margin-top:8px">${icons.bolt} Challenge</p>
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
        <button class="card selectable" id="boards" style="text-align:left"><div class="row"><h3 style="font-weight:800">${icons.trophy} LEADERBOARDS</h3><span class="grow"></span><span class="badge gold">Live</span></div><p class="muted small" style="margin-top:4px">The fastest riders on every route, and this week's hall standings.${cloud.account ? '' : ' Sign in to post your times.'}</p></button>
      </div>`,
    events: `
      <div class="hub">
        <p class="kicker">Events</p>
        <h1 class="title">Campus events</h1>
        <p class="muted">Ride an event while it is live for double coins and a bike you can only win there.</p>
        ${money.prizeCardHtml()}
        ${EVENTS.map(eventCard).join('')}
        <div class="card stack" style="gap:8px">
          <div class="row"><h3 style="font-weight:800">${icons.pillars} HALL WEEK</h3><span class="grow"></span><span class="badge gold">+${WEEK_REWARD} ${icons.coin}</span></div>
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
            ${p.snap ? `<p class="muted small">${icons.ghost} @${esc(p.snap)}${p.snapPublic ? '' : ' · hidden'}</p>` : ''}
          </div>
        </div>
        ${p.guest ? `<div class="card stack complete-card">
            <div class="row"><span class="gear-ico">${icons.user}</span><span class="grow"><b>Save your progress</b><span class="muted small">Create your account to keep your coins, pick your hall and race your friends.</span></span></div>
            <button class="btn btn-primary" id="createAcct">Create my account</button>
          </div>` : completeCard(p)}
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
        ${fx.youLinksHtml(p)}
        ${passportCardHtml()}
        ${money.youMoneyHtml()}
        <button class="card selectable row" id="garage"><span class="hall-swatch" style="background:${bikeById(p.bike).color}"></span><span class="muted small">Bike</span><b>${bikeById(p.bike).name}</b><span class="grow"></span><span class="small">Garage ${icons.arrow}</span></button>
        <div class="two"><button class="btn btn-ghost" id="dress">Dress rider</button><button class="btn btn-ghost" id="edit">${p.guest ? 'Create account' : 'Edit details'}</button></div>
        <div class="two"><button class="btn btn-ghost" id="settings">Settings</button><button class="btn btn-ghost" id="privacy">Privacy &amp; safety</button></div>
        ${installPrompt ? '<button class="btn btn-ghost" id="install">Install app</button>' : ''}
        ${cloud.account
          ? `<div class="card stack" style="gap:8px"><div class="row"><b>Account</b><span class="grow"></span><span class="badge gold">Synced</span></div><p class="muted small">Signed in as ${esc(cloud.account.email)}. Your progress is saved to your account and follows you to any device.</p><button class="btn btn-ghost" id="signOut">Sign out</button></div>`
          : `<div class="card stack" style="gap:8px"><b>Save your progress online</b><p class="muted small">Sign in to keep your progress on any device, post your race times and ride for your hall.</p><button class="btn btn-primary" id="signIn">Sign in or create an account</button></div>
        <button class="btn btn-link" id="reset">Reset progress</button>
        <p class="muted small">Progress is saved on this device until you sign in.</p>`}
      </div>`,
  };

  const reg = tab === 'ride' ? undefined : tabView(tab);
  const legacy: Record<string, keyof typeof views> = { challenges: 'race', community: 'social' };
  render(shell(reg ? reg.render() : views[(legacy[tab] ?? tab) as keyof typeof views]));
  if (reg?.bind) tabCleanup = reg.bind(app.querySelector<HTMLElement>('main.content')!) || null;
  animateCoins();
  void fillWeather();
  // who's online loads a moment later, so the menu itself is never held up
  setTimeout(connectLobby, 1500);
  on('[data-nav]', 'click', (_, el) => {
    home(el.dataset.nav as TabId);
  });
  on('[data-more]', 'click', () => moreSheet());
  on('[data-campus]', 'click', () => campusSheet(() => home(tab)));
  on('#bell', 'click', () => noticesSheet());
  on('#settingsTop', 'click', () => settingsScreen());
  on('[data-mode]', 'click', (_, el) => {
    const m = el.dataset.mode;
    if (m === 'explore') explorePicker();
    if (m === 'match') quickMatch();
    if (m === 'missions') fx.levelsScreen(() => home(tab));
    if (m === 'vibe') home('social');
  });
  on('[data-mission]', 'click', (_, el) => {
    if (claimMission(p, el.dataset.mission!)) sfx.finish();
    home(tab);
  });
  on('[data-invite]', 'click', (_, el) => inviteOnline(el.dataset.invite!));
  on('#ride', 'click', () => play(false));
  on('#continue', 'click', () => {
    const r = lastRide()?.route();
    if (r) play(false, r);
  });
  on('#routeCard', 'click', () => play(false));
  on('#exploreBtn', 'click', () => explorePicker());
  on('[data-race]', 'click', (_, el) => play(false, raceRoute(RACES.find((r) => r.id === el.dataset.race)!)));
  on('#settings', 'click', () => settingsScreen());
  on('#privacy', 'click', () => privacyScreen(() => home('you')));
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
  fx.bindFeatureLinks(() => home('you'));
  bindSocial();
  showUpdate('menu');
  // back from another tab goes to Home; from Home it leaves the app
  onBack(tab === 'home' ? null : () => home());
  on('#quizBtn', 'click', () => whereIsIt());
  on('#edit', 'click', () => (p.guest ? onboard() : createRider({ ...p, look: structuredClone(p.look) }, true)));
  on('#createAcct', 'click', () => onboard());
  on('#completeProfile', 'click', () => onboard({ draft: structuredClone(p), email: '', pass: '', step: 0, flow: 'complete' }));
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
  /** Vibe Ride match preferences while looking: from where, who and what for (features/vibe.ts) */
  want?: vb.VibeFrom;
  who?: vb.VibeWho;
  mood?: vb.VibeMood;
  gender?: 'male' | 'female';
  riderType?: RiderType | '';
  /** COMMUNITY: where you're riding (only sent with "show me on map"), and set when "show online" is off */
  place?: string;
  map?: boolean;
  hidden?: boolean;
  at: number;
}

// COMMUNITY hook: presence follows the rider's privacy (hidden hall/course, show online, show me on map)
const riderState = (status: Status, extra: Partial<RiderState> = {}): RiderState => community.maskPresence({
  id: myId(), name: profile?.name ?? 'Rider', hall: profile?.hall ?? 'none', department: profile?.department ?? '',
  jersey: profile ? riderLook(profile).jersey : '#f5c518', level: levelFor(profile?.xp ?? 0), status, at: Date.now(),
  gender: profile?.gender, riderType: profile?.about.riderType ?? '', ...extra,
}, profile);

let lobby: Promise<live.Channel | null> | null = null;
let lobbyCh: live.Channel | null = null;
let lobbyState: 'connecting' | 'on' | 'off' = 'connecting';
let online: live.Peer<RiderState>[] = [];
let myStatus: RiderState = riderState('menu');
/** set while searching, to hear a pairing or match meant for you */
let onPair: ((m: { code: string; from: RiderState }) => void) | null = null;
/** a matched rider's Accept or Skip */
let onPairAns: ((m: { code: string; from: string; ok: boolean }) => void) | null = null;
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
    ch.on('pairAns', (m: { to: string; code: string; from: string; ok: boolean }) => {
      if (m.to === myId()) onPairAns?.(m);
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

/** COMMUNITY: screens that follow who is online */
const onlineWatchers = new Set<() => void>();
function refreshOnline() {
  onlineWatchers.forEach((fn) => fn());
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
  if (notices.some((x) => x.code === n.code) || vibe?.code === n.code || vb.isBlocked(n.from.id)) return;
  // COMMUNITY hook: "who can invite me to Vibe Ride" (invites left on the server are checked there too)
  if (!n.dbId && !n.id.startsWith('cm-') && !community.allowVibeInvite(profile, n.from.id)) return;
  notices.unshift(n);
  notices = notices.slice(0, 10);
  sfx.coin?.();
  const bell = app.querySelector('#bell');
  if (bell) bell.innerHTML = `${icons.bell}<i class="dot-badge">${notices.length}</i>`;
  toast(`${icons.heart} <b>${esc(n.from.name)}</b> is inviting you to ride with them`, [['Accept', () => acceptNotice(n), true], ['Not now', () => {}]], 20000);
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
  if (game.isRiding) return toast('Finish this ride first, then accept from the bell.');
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
      <p class="kicker">${icons.heart} Vibe Ride</p>
      <h1 class="title">Ride together</h1>
      ${navigator.onLine ? '' : offlineNote()}
      <p class="muted">Find someone and enjoy the ride together. Get paired with an online rider, or create a private ride and invite someone with a link or code. No racing: just ride, connect and enjoy the campus.</p>
      <div class="card stack" style="gap:10px">
        <b>Find a rider</b>
        <p class="muted small">We pair you with someone online who wants a ride too. Choose who you'd like to meet: anyone, male or female riders, your hall or department, and your vibe.</p>
        <p class="small vx-partner-line">${esc(vb.prefsSummary(vb.loadPrefs(profile!)))}</p>
        <button class="btn btn-primary" id="vibeFind">Find a rider</button>
      </div>
      <div class="card stack" style="gap:10px">
        <b>Private ride</b>
        <p class="muted small">Create a ride and share the invite on Snapchat, WhatsApp or anywhere. Your friend gets "${esc(profile!.name)} is inviting you to ride with them".</p>
        <button class="btn btn-ghost" id="vibeNew">Create a private ride</button>
        <div class="row"><input class="code-in" id="vibeCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Got a code?"><button class="btn btn-ghost btn-sm" id="vibeJoin">Join</button></div>
      </div>
      ${canAlert ? `<button class="btn btn-link" id="alerts">${icons.bell} Turn on invite alerts</button>` : ''}
      ${onlineCard()}
      <div class="two"><button class="btn btn-ghost" id="hallStand">Hall standings</button><button class="btn btn-ghost" id="deptStand">Departments</button></div>
    </div>`;
}

function bindSocial() {
  on('#vibeFind', 'click', () => vibeSetup());
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

/** Vibe Ride preferences (who, from where, what vibe), or invite a friend instead */
function vibeSetup() {
  if (needsRider()) return;
  vb.vibeSetup({
    find: (prefs) => vibeFind(prefs),
    create: () => void joinVibe(live.newCode(), true),
    join: (code) => void joinVibe(code, false),
    back: () => home('social'),
  });
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
  onPairAns = null;
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

/** riders you skipped while looking: not shown again until you start a fresh search */
const vibeSkipped = new Set<string>();

/**
 * Pairs you with someone online whose choices fit yours both ways (features/vibe.ts fits()).
 * Both then see who it is and Accept or Skip; the ride opens once both accept.
 */
async function vibeFind(prefs: vb.VibePrefs = vb.loadPrefs(profile!), fresh = true) {
  if (needsRider()) return;
  stopSearching();
  if (fresh) vibeSkipped.clear();
  const again = () => vibeFind(prefs, false);
  searchScreen(`${icons.heart} ${esc(vb.prefsSummary(prefs))}`, prefs.mood === 'date' ? 'Finding your match' : 'Finding a rider', 'Looking for someone online who wants to ride…', 'Invite a friend instead');
  app.firstElementChild?.classList.add('vibe-warm');
  on('#fallback', 'click', () => { stopSearching(); void joinVibe(live.newCode(), true); });
  on('#cancel', 'click', () => { stopSearching(); setStatus('menu'); vibeSetup(); });
  onBack(() => { stopSearching(); setStatus('menu'); vibeSetup(); });
  const ch = await connectLobby();
  if (!ch) return searchFailed('You need to be online to find a rider.');
  setStatus('vibe', { want: prefs.from, who: prefs.who, mood: prefs.mood });
  const looking = myStatus;
  const fits = (s: RiderState) => s.status === 'vibe' && !vibeSkipped.has(s.id) && vb.fits(looking, s);
  const answer = (to: string, code: string, ok: boolean, busy = false) => ch.send('pairAns', { to, code, from: myId(), ok, busy });
  const started = Date.now();
  let done = false;

  // matched: show who they are, and wait for both to accept
  const preview = (code: string, them: RiderState, host: boolean) => {
    done = true;
    clearInterval(searchTimer);
    searchTick = null;
    setStatus('room');
    // someone else asking meanwhile hears you're busy
    onPair = (m) => answer(m.from.id, m.code, false, true);
    let mine = false, theirs = false, over = false;
    const finish = (ok: boolean, why = '', busy = false) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      onPairAns = null;
      if (ok) return void joinVibe(code, host, them.name, vb.roomMood(prefs.mood, them.mood));
      if (!busy) vibeSkipped.add(them.id);
      if (why) toast(esc(why), [], 4000);
      void again();
    };
    const timer = window.setTimeout(() => { answer(them.id, code, false); finish(false, `${them.name} didn't answer. Looking again…`); }, 30e3);
    onPairAns = (m: { code: string; from: string; ok: boolean; busy?: boolean }) => {
      if (m.code !== code || m.from !== them.id) return;
      if (!m.ok) return finish(false, m.busy ? '' : `${them.name} skipped. Looking for someone else…`, m.busy);
      theirs = true;
      if (mine) finish(true);
    };
    const hall = hallById(them.hall);
    const waiting = vb.matchPreview({ name: them.name, hallName: hall.name, hallColor: hall.color, riderType: them.riderType, mood: them.mood, level: them.level }, {
      accept: () => {
        if (mine || over) return;
        mine = true;
        answer(them.id, code, true);
        waiting();
        if (theirs) finish(true);
      },
      skip: () => { answer(them.id, code, false); finish(false); },
    });
  };

  onPair = (m) => {
    if (done) return answer(m.from.id, m.code, false, true);
    // check their choices here too: never meet someone whose filter (or yours) leaves you out
    if (!fits({ ...m.from, status: 'vibe' })) return answer(m.from.id, m.code, false);
    preview(m.code, m.from, false);
  };
  searchTick = () => {
    if (done) return;
    const match = online.find((o) => fits(o.state));
    const text = app.querySelector('#searchText');
    if (text) text.textContent = match ? 'Found someone. Connecting…' : Date.now() - started > 60e3 ? 'Nobody who fits your choices is free right now. Invite a friend, or keep waiting.' : `Looking for someone online who wants to ride… ${online.length ? `(${online.length} online)` : ''}`;
    // the rider whose id sorts first asks, so both don't
    if (match && myId() < match.key) {
      const code = live.newCode();
      ch.send('pair', { to: match.key, code, from: looking });
      preview(code, match.state, true);
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
    play(false, route, { rivals: botRivals(route, 3, settings.difficulty ?? 'normal') });
  };
  searchScreen(`${icons.flag} Quick Match`, 'Finding riders', 'Looking for riders online…', 'Race bots now');
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
  if (!ch) return play(false, route, { rivals: botRivals(route, 3, settings.difficulty ?? 'normal') });
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
  setTimeout(() => { if (!started) { ch.leave(); play(false, route, { rivals: botRivals(route, 3, settings.difficulty ?? 'normal') }); } }, 9000);
}

// ---------- Vibe Ride ----------
// The room and its chat. Preferences, safety, gifts, icebreakers and the memory card live in features/vibe.ts.

interface ChatMsg {
  from?: string;
  name?: string;
  text?: string;
  react?: string;
  place?: string;
  /** a suggestion to ride there at sunset */
  sunset?: boolean;
  /** an icebreaker card someone tapped */
  ice?: boolean;
  gift?: string;
  sys?: boolean;
  /** your messages are numbered so your partner can say they've seen them */
  id?: number;
  seen?: boolean;
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
  /** what the ride is for: Date vibe hides numbers and links and shows the safety tip */
  mood: vb.VibeMood;
  /** sunset lighting for the ride, from the Sunset ride suggestion or gift */
  time: 'day' | 'sunset';
  /** redraws whatever screen shows the ride: the room or the ride HUD */
  redraw: ((what: 'all' | 'chat') => void) | null;
  /** positions from your partner, while riding */
  onPos: ((m: PosMsg) => void) | null;
  joinedAt: number;
  /** your partner is typing until then */
  typingUntil: number;
  /** last message number you sent, and the last of theirs you told them you'd seen */
  seq: number;
  seenSent: number;
  /** the card for the ride you just finished together */
  memory: vb.Memory | null;
  memoryShown: boolean;
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

/** quick reactions: id, line icon, what it says */
const REACTS: [string, string, string][] = [['wave', icons.hand, 'waved'], ['heart', icons.heart, 'sent a heart'], ['laugh', vb.vIcons.laugh, 'is laughing'], ['like', vb.vIcons.like, 'liked that']];
const VIBE_PLACES = () => [...new Set([...Object.values(HALL_PLACE), ...POPULAR, ...TOUR_STOPS, 'Akuafo Hall', 'Commonwealth Hall'])].filter((n) => placeByName(n)).sort();
/** where a Sunset ride goes: up to the Great Hall, or the library if you start there */
const sunsetSpot = (from: string) => (from === 'Great Hall' ? 'The Balme Library' : 'Great Hall');
const lowerFirst = (t: string) => t.slice(0, 1).toLowerCase() + t.slice(1);

function leaveVibe() {
  vibe?.ch.send('bye', { name: profile?.name });
  vibe?.ch.leave();
  vibe = null;
}

/** Opens a Vibe Ride room: as its host (you made it) or as a guest (invite, code or pairing). */
async function joinVibe(code: string, host: boolean, partnerName = '', mood: vb.VibeMood = 'friends') {
  if (!profile || needsRider()) return;
  if (vibe?.code === code) return vibeRoom();
  leaveVibe();
  stopSearching();
  render(`<div class="screen scrim center fade-in vibe-warm"><div class="wrap stack"><p class="kicker">${icons.heart} Vibe Ride</p><h1 class="title">${partnerName ? `Joining ${esc(partnerName)}` : 'Opening the ride'}…</h1></div></div>`);
  const me = riderState('room', { mood });
  const ch = await live.join(`vibe:${code}`, myId(), { ...me });
  if (!ch) {
    toast("Couldn't connect. Check your data or Wi-Fi and try again.");
    return home('social');
  }
  setStatus('room');
  const p = profile;
  const s: VibeSession = {
    code, host, ch, partner: null, msgs: [], redraw: null, onPos: null, joinedAt: me.at, mood, time: 'day',
    typingUntil: 0, seq: 0, seenSent: 0, memory: null, memoryShown: false,
    from: HALL_PLACE[p.hall] && placeByName(HALL_PLACE[p.hall]) ? HALL_PLACE[p.hall] : 'Legon Main Entrance', to: 'The Balme Library',
  };
  vibe = s;
  let goneTimer = 0;
  const say = (m: ChatMsg) => { s.msgs.push(m); s.msgs = s.msgs.slice(-80); s.redraw?.('chat'); };
  const clean = (t: unknown) => {
    const text = String(t ?? '').slice(0, 160);
    return s.mood === 'date' ? vb.maskText(text) : text;
  };
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
    // someone you blocked: never ride with them
    if (partner && vb.isBlocked(partner.key)) {
      leaveVibe();
      toast("You've blocked that rider, so you left the ride.");
      if (!game.isRiding) home('social');
      return;
    }
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
      say({ sys: true, text: `${partner.state.name} joined the ride`, at: Date.now() });
      sfx.finish();
    }
    const changed = (partner?.key ?? '') !== (s.partner?.key ?? '');
    s.partner = partner;
    // the host shares the route with whoever joins
    if (changed && partner && s.host) ch.send('route', { from: s.from, to: s.to, time: s.time });
    if (changed) s.redraw?.('all');
  });
  ch.on('chat', (m: { name: string; text: string; id?: number; ice?: boolean }) => {
    s.typingUntil = 0;
    say({ from: 'them', name: m.name, text: clean(m.text), id: Number(m.id) || 0, ice: !!m.ice, at: Date.now() });
  });
  ch.on('typing', () => {
    s.typingUntil = Date.now() + 3500;
    s.redraw?.('chat');
    setTimeout(() => { if (vibe === s && Date.now() >= s.typingUntil) s.redraw?.('chat'); }, 3600);
  });
  ch.on('seen', (m: { id: number }) => {
    let any = false;
    for (const x of s.msgs) if (x.from === 'me' && x.id && x.id <= m.id && !x.seen) { x.seen = true; any = true; }
    if (any) s.redraw?.('chat');
  });
  ch.on('react', (m: { name: string; kind: string }) => {
    say({ from: 'them', name: m.name, react: m.kind, at: Date.now() });
    vb.floatIcon(REACTS.find((r) => r[0] === m.kind)?.[1] ?? icons.heart);
  });
  ch.on('gift', (m: { name: string; gift: string }) => {
    const g = vb.giftById(m.gift);
    if (!g) return;
    say({ from: 'them', name: m.name, gift: g.id, at: Date.now() });
    vb.giftBurst(g, `${m.name} ${g.line}`);
    sfx.coin?.();
    if (g.id === 'sunset' && s.host) setVibeRoute(s.from, s.to, 'sunset');
  });
  ch.on('suggest', (m: { name: string; place: string; sunset?: boolean }) => say({ from: 'them', name: m.name, place: m.place, sunset: !!m.sunset, at: Date.now() }));
  ch.on('route', (m: { from: string; to: string; time?: string }) => {
    if (placeByName(m.from)) s.from = m.from;
    if (placeByName(m.to)) s.to = m.to;
    s.time = m.time === 'sunset' ? 'sunset' : 'day';
    s.redraw?.('all');
  });
  ch.on('start', (m: { from: string; to: string; time?: string }) => {
    s.from = m.from;
    s.to = m.to;
    s.time = m.time === 'sunset' ? 'sunset' : 'day';
    if (vibe === s && !game.isRiding) vibeGo();
  });
  ch.on('pos', (m: PosMsg) => s.onPos?.(m));
  ch.on('done', (m: { name: string; km: number; finished: boolean }) => say({ sys: true, text: m.finished ? `${m.name} arrived` : `${m.name} stopped riding.`, at: Date.now() }));
  ch.on('bye', (m: { name: string }) => {
    say({ sys: true, text: `${m.name} left the ride.`, at: Date.now() });
    s.partner = null;
    s.redraw?.('all');
  });
  if (host) say({ sys: true, text: 'Your ride is open. Invite someone to join you.', at: Date.now() });
  vibeRoom();
}

function sendChat(text: string, ice = false) {
  const s = vibe;
  let t = text.trim().slice(0, 160);
  if (!t || !s) return;
  if (s.mood === 'date') t = vb.maskText(t);
  const id = ++s.seq;
  typingSent = 0;
  s.ch.send('chat',{ name: profile!.name, text: t, id, ice });
  s.msgs.push({ from: 'me', name: profile!.name, text: t, id, ice, at: Date.now() });
  s.redraw?.('chat');
}

function sendReact(kind: string) {
  if (!vibe) return;
  vibe.ch.send('react', { name: profile!.name, kind });
  vibe.msgs.push({ from: 'me', name: profile!.name, react: kind, at: Date.now() });
  vb.floatIcon(REACTS.find((r) => r[0] === kind)?.[1] ?? icons.heart);
  vibe.redraw?.('chat');
}

function sendSuggest(place: string, sunset = false) {
  if (!vibe) return;
  vibe.ch.send('suggest', { name: profile!.name, place, sunset });
  vibe.msgs.push({ from: 'me', name: profile!.name, place, sunset, at: Date.now() });
  vibe.redraw?.('chat');
}

function sendGift() {
  const s = vibe;
  if (!s) return;
  if (!s.partner) return toast('Gifts can be sent once someone is in the ride with you.', [], 4000);
  vb.giftSheet(s.partner.state.name, (g) => {
    if (vibe !== s) return;
    s.ch.send('gift', { name: profile!.name, gift: g.id });
    s.msgs.push({ from: 'me', name: profile!.name, gift: g.id, at: Date.now() });
    vb.giftBurst(g, `You sent ${lowerFirst(g.name)}`);
    sfx.coin?.();
    if (g.id === 'sunset' && s.host) setVibeRoute(s.from, s.to, 'sunset');
    s.redraw?.('chat');
  });
}

/** tell your partner you've read their messages, while the chat is on screen */
function markSeen(s: VibeSession) {
  if (document.hidden) return;
  const last = Math.max(0, ...s.msgs.filter((m) => m.from === 'them' && m.id).map((m) => m.id!));
  if (last > s.seenSent) {
    s.seenSent = last;
    s.ch.send('seen', { id: last });
  }
}

let typingSent = 0;
/** "typing…" for your partner, at most every two seconds */
function sendTyping() {
  if (!vibe || Date.now() - typingSent < 2000) return;
  typingSent = Date.now();
  vibe.ch.send('typing', {});
}

function reportPartner(reason: string) {
  const s = vibe;
  const p = s?.partner;
  if (!s || !p) return;
  const r: vb.Report = { id: p.key, name: p.state.name, reason, code: s.code, lines: s.msgs.filter((m) => m.from === 'them' && m.text).slice(-5).map((m) => m.text!), at: Date.now() };
  vb.saveReport(r);
  // for moderation later: the lobby hears it, nothing else happens yet
  void connectLobby()?.then((ch) => ch?.send('report', { reporter: myId(), ...r }));
}

function blockPartner() {
  const p = vibe?.partner;
  if (!p) return;
  vb.block(p.key, p.state.name);
  leaveVibe();
  toast(`You blocked ${esc(p.state.name)}. You won't be matched with them again.`, [], 5000);
  if (!game.isRiding) home('social');
  else hideRideChat();
}

function leaveFromSafety() {
  leaveVibe();
  if (!game.isRiding) return home('social');
  hideRideChat();
  toast('You left the Vibe Ride. Keep riding solo, or pause to stop.', [], 5000);
}

function hideRideChat() {
  const rc = app.querySelector<HTMLElement>('#rideChat');
  if (rc) rc.hidden = true;
}

function safety() {
  const p = vibe?.partner;
  if (!p) return leaveFromSafety();
  vb.safetySheet(p.state.name, { onReport: reportPartner, onBlock: blockPartner, onLeave: leaveFromSafety });
}

function chatLine(m: ChatMsg) {
  if (m.sys) return `<div class="msg sys">${esc(m.text ?? '')}</div>`;
  const mine = m.from === 'me';
  const who = mine ? 'You' : esc(m.name ?? '');
  if (m.gift) {
    const g = vb.giftById(m.gift);
    return `<div class="msg gift${mine ? ' me' : ''}"><span class="vx-gift-ico">${g?.icon ?? icons.gift}</span><span>${mine ? `You sent ${esc(lowerFirst(g?.name ?? 'a gift'))}` : `<b>${who}</b> ${esc(g?.line ?? 'sent you a gift')}`}</span></div>`;
  }
  if (m.react) {
    const r = REACTS.find((x) => x[0] === m.react);
    return `<div class="msg react${mine ? ' me' : ''}"><span class="vx-react-ico">${r?.[1] ?? icons.heart}</span> ${who} ${r?.[2] ?? ''}</div>`;
  }
  if (m.place) {
    const canGo = vibe?.host && !game.isRiding;
    return `<div class="msg${mine ? ' me' : ''}"><b>${who}</b><span>${m.sunset ? vb.vIcons.sunset : icons.pin} ${m.sunset ? `Sunset ride to ${esc(m.place)}?` : `Let's go to ${esc(m.place)}`}</span>${canGo ? `<button class="btn btn-ghost btn-sm" data-goto="${esc(m.place)}" ${m.sunset ? 'data-sunset="1"' : ''}>Go there</button>` : ''}</div>`;
  }
  const ticks = mine && m.id ? `<small class="vx-seen${m.seen ? ' on' : ''}">${m.seen ? `${vb.vIcons.ticks} Seen` : icons.check}</small>` : '';
  return `<div class="msg${mine ? ' me' : ''}${m.ice ? ' ice' : ''}"><b>${who}</b><span>${m.ice ? vb.vIcons.ice : ''}${esc(m.text ?? '')}</span>${ticks}</div>`;
}

/** the chat log, with "typing…" at the end while your partner types */
function chatHtml(s: VibeSession, last = 0) {
  const msgs = last ? s.msgs.slice(-last) : s.msgs;
  const typing = s.partner && Date.now() < s.typingUntil ? `<div class="vx-typing">${esc(s.partner.state.name)} is typing <i></i><i></i><i></i></div>` : '';
  return msgs.map(chatLine).join('') + typing;
}

/** the quick actions under the chat: wave, heart, laugh, like, a place, a gift; on the ride also safety and the keyboard */
const quickActions = (ride = false) => `<div class="quick-acts">${REACTS.filter(([k]) => !ride || k !== 'like').map(([k, ico]) => `<button data-react="${k}" aria-label="${k}">${ico}</button>`).join('')}<button data-suggest aria-label="Suggest a place">${icons.pin}</button><button data-gift aria-label="Send a gift">${icons.gift}</button>${ride ? `<button data-safety aria-label="Safety">${icons.shield}</button><button data-chat aria-label="Chat">${icons.chat}</button>` : ''}</div>`;

/** icebreaker cards and sweet replies: tap to send */
const prompts = (mood: vb.VibeMood) => `
  <div class="vx-ice" aria-label="Icebreakers">${vb.icebreakers(mood).map((q) => `<button data-ice="${esc(q)}"><small>Icebreaker</small>${esc(q)}</button>`).join('')}</div>
  <div class="vx-sweet">${vb.sweetReplies(mood).map((q) => `<button data-sweet="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;

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

/** wires the chat box, prompts and quick actions inside root */
function bindChat(root: HTMLElement, log: HTMLElement, input: HTMLInputElement, onChatBtn: () => void) {
  root.querySelectorAll<HTMLElement>('[data-react]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendReact(b.dataset.react!); }));
  root.querySelector('[data-suggest]')?.addEventListener('click', (e) => { e.stopPropagation(); placeMenu((p) => sendSuggest(p)); });
  root.querySelector('[data-gift]')?.addEventListener('click', (e) => { e.stopPropagation(); sendGift(); });
  root.querySelector('[data-safety]')?.addEventListener('click', (e) => { e.stopPropagation(); safety(); });
  root.querySelector('[data-chat]')?.addEventListener('click', (e) => { e.stopPropagation(); onChatBtn(); });
  root.querySelectorAll<HTMLElement>('[data-ice]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendChat(b.dataset.ice!, true); }));
  root.querySelectorAll<HTMLElement>('[data-sweet]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendChat(b.dataset.sweet!); }));
  input.addEventListener('input', () => { if (input.value.trim()) sendTyping(); });
  const form = input.form!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat(input.value);
    input.value = '';
  });
  log.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
    if (b && vibe?.host) setVibeRoute(vibe.from, b.dataset.goto!, b.dataset.sunset ? 'sunset' : vibe.time);
  });
}

function setVibeRoute(from: string, to: string, time: 'day' | 'sunset' = vibe?.time ?? 'day') {
  if (!vibe || !placeByName(from) || !placeByName(to)) return;
  vibe.from = from;
  vibe.to = to === from ? vibe.to : to;
  vibe.time = time;
  vibe.ch.send('route', { from: vibe.from, to: vibe.to, time });
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
  const date = s.mood === 'date';
  const places = VIBE_PLACES();
  const select = (id: string, value: string) => `<div class="select-wrap"><select id="${id}" ${s.host ? '' : 'disabled'}>${places.map((n) => `<option ${n === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
  const link = vibeLink(s.code);
  const msg = `${inviteText(profile.name)} on LEGONRUSH. Tap to join: ${link}`;
  const sunset = s.time === 'sunset';
  render(`
    <div class="screen solid vibe-room vibe-warm${date ? ' date' : ''} fade-in">
      <div class="wrap stack">
        <div class="row"><button class="btn btn-link back" id="leave">← Leave ride</button><span class="grow"></span><span class="badge gold">Code ${esc(s.code)}</span></div>
        <p class="kicker">${icons.heart} ${date ? 'Date vibe' : 'Vibe Ride'}</p>
        <h1 class="title">${partner ? `Riding with ${esc(partner.name)}` : 'Waiting for your friend'}</h1>
        ${s.memory ? `<button class="vx-mem-btn" id="vxMem"><span class="vx-gift-ico">${icons.camera}</span><span class="grow"><b>Your ride memory</b><small>${esc(s.memory.them)} and you · ${s.memory.km.toFixed(1)} km. Tap to share.</small></span></button>` : ''}
        ${partner
          ? `<div class="card row partner"><span class="avatar sm" style="background:${hallById(partner.hall).color}">${esc(partner.name.slice(0, 1).toUpperCase())}</span><span class="grow"><b>${esc(partner.name)}</b><small class="vx-partner-line">${esc(vb.vibeLine(partner, hallById(partner.hall).name))}</small></span><span class="badge gold">● Here</span><button class="vx-icon-btn" id="vxSafety" aria-label="Report or block">${icons.shield}</button></div>`
          : `<div class="card stack invite-card" style="gap:10px">
              <b>Invite someone</b>
              <p class="muted small">They'll see "<b>${esc(inviteText(profile.name))}</b>". Share it on Snapchat, WhatsApp or anywhere, or give them the code <b>${esc(s.code)}</b>.</p>
              <button class="btn btn-primary" id="shareInvite">Share invite</button>
              <div class="two"><a class="btn btn-ghost" id="wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn btn-ghost" id="copy">Copy link</button></div>
              <p class="muted small" id="inviteNote" hidden></p>
              ${cloud.account ? `<div class="field picker"><label for="who">Invite by username or Snapchat</label><input id="who" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@username"><ul class="suggest" id="whoList" hidden></ul></div>` : '<p class="muted small">Sign in to invite riders by their username.</p>'}
            </div>
            <div class="card stack" style="gap:8px"><div class="row"><b>Riders online</b><span class="grow"></span><span class="badge gold" id="onlineCount"></span></div><div id="onlineList" class="online-list">${onlineRows()}</div></div>`}
        ${date ? `<p class="vx-tip">${icons.shield} ${vb.SAFETY_TIP}</p>` : ''}
        <div class="card stack" style="gap:8px">
          <b>Where to?</b>
          <div class="field"><label for="vFrom">From</label>${select('vFrom', s.from)}</div>
          <div class="field"><label for="vTo">To</label>${select('vTo', s.to)}</div>
          <button class="vx-sunset${sunset ? ' on' : ''}" id="vxSunset">${vb.vIcons.sunset}<span class="grow"><b>${sunset ? 'Sunset ride is on' : 'Sunset ride'}</b><small>${sunset ? `Golden-hour light for this ride.${s.host ? ' Tap to ride in daylight.' : ''}` : s.host ? `Ride to ${esc(sunsetSpot(s.from))} in golden-hour light.` : 'Suggest a golden-hour ride.'}</small></span></button>
          ${s.host
            ? `<button class="btn btn-primary" id="vGo" ${partner ? '' : 'disabled'}>${partner ? 'Start the ride' : 'Waiting for your friend'}</button>`
            : `<p class="muted small">${partner ? `${esc(partner.name)} picks the route and starts the ride. Suggest a place with the pin button.` : 'Waiting for the host…'}</p>`}
          ${s.host && !partner ? '<button class="btn btn-link" id="vSolo">Ride it alone for now</button>' : ''}
        </div>
        <div class="card stack chat-card">
          <div class="row"><b>${icons.chat} Chat</b><span class="grow"></span><span class="muted small">Be kind. Leave anytime.</span></div>
          ${date ? '<p class="vx-filter-note">Phone numbers and links are hidden in Date vibe.</p>' : ''}
          <div class="chat-log" id="log"></div>
          ${prompts(s.mood)}
          ${quickActions()}
          <form class="chat-form"><input id="say" maxlength="160" autocomplete="off" placeholder="${partner ? `Message ${esc(partner.name)}…` : 'Say something…'}"><button class="btn btn-primary btn-sm" aria-label="Send">${icons.send}</button></form>
        </div>
      </div>
    </div>`);
  const log = app.querySelector<HTMLElement>('#log')!;
  const input = app.querySelector<HTMLInputElement>('#say')!;
  const drawLog = () => {
    log.innerHTML = chatHtml(s) || '<p class="muted small">No messages yet. Say hi, or tap an icebreaker.</p>';
    log.scrollTop = log.scrollHeight;
    markSeen(s);
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
  on('#vxSafety', 'click', () => safety());
  on('#vxMem', 'click', () => s.memory && void vb.memorySheet(s.memory));
  on('#vFrom', 'change', (_, el) => setVibeRoute((el as HTMLSelectElement).value, s.to));
  on('#vTo', 'change', (_, el) => setVibeRoute(s.from, (el as HTMLSelectElement).value));
  on('#vxSunset', 'click', () => {
    if (!s.host) return sendSuggest(s.to, true);
    if (s.time === 'sunset') return setVibeRoute(s.from, s.to, 'day');
    setVibeRoute(s.from, sunsetSpot(s.from), 'sunset');
  });
  on('#vGo', 'click', () => {
    if (!s.partner) return;
    s.ch.send('start', { from: s.from, to: s.to, time: s.time });
    vibeGo();
  });
  on('#vSolo', 'click', () => vibeGo());
  const note = app.querySelector<HTMLElement>('#inviteNote');
  on('#shareInvite', 'click', () => note && share(`${inviteText(profile!.name)} on LEGONRUSH`, link, note));
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
        whoList.innerHTML = found.map((r, i) => `<li data-i="${i}"><span class="kind">${online.some((o) => o.key === r.id) ? '<i class="on-dot"></i>' : '<i class="on-dot off"></i>'}</span><span class="grow"><b>${esc(r.name)}</b> <small class="muted">${r.username ? `@${esc(r.username)}` : ''}${r.snap ? ` · 👻 ${esc(r.snap)}` : ''}</small></span><small class="muted">${esc(hallById(r.hall).short)}</small></li>`).join('');
        whoList.querySelectorAll<HTMLElement>('li').forEach((li) => li.addEventListener('click', async () => {
          const r = found[Number(li.dataset.i)];
          whoList.hidden = true;
          who.value = '';
          // online now: they get it straight away; either way it waits for them in their bell
          lobbyCh?.send('invite', { to: r.id, code: s.code, from: riderState('room') });
          const saved = await cloud.sendInvite(r.id, s.code);
          s.msgs.push({ sys: true, text: online.some((o) => o.key === r.id) || saved ? `Invite sent to ${r.name}.` : `Couldn't reach ${r.name}. Share the link instead.`, at: Date.now() });
          drawLog();
        }));
      }, 250);
    });
  }
  // just back from a ride together: show the memory card once
  if (s.memory && !s.memoryShown) {
    s.memoryShown = true;
    void vb.memorySheet(s.memory);
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
  if (s.time === 'sunset') route.time = 'sunset';
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
        <p class="kicker">${icons.heart} Vibe Ride</p>
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
    profile = profile ? cloud.merge(profile, remote) : normalizeProfile(remote);
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
  profile = profile ? cloud.merge(profile, remote) : normalizeProfile(remote);
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
        <div class="board-tabs">${[['halls', 'Halls'] as [string, string], ['depts', 'Departments'] as [string, string], ...routes].map(([id, name]) => `<button class="${id === view ? 'on' : ''}" data-view="${id}">${esc(name)}</button>`).join('')}</div>
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
          <div class="set-row"><b>Difficulty</b>${seg('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], settings.difficulty)}</div>
          <div class="set-row"><b>Weather</b>${seg('weather', [['changing', 'Changing'], ['live', 'Live Legon'], ['clear', 'Always sunny']], settings.weather ?? 'changing')}</div>
          <p class="muted small">Easy gives you more time on missions; Hard gives less and more traffic.</p>
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
          <div class="set-row"><b>Vibration</b>${seg('vibe', [['1', 'On'], ['0', 'Off']], settings.vibration ? '1' : '0')}</div>
          <p class="muted small">The phone buzzes when you crash, grab coins and finish.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Big buttons</b>${seg('big', [['0', 'Off'], ['1', 'On']], settings.bigButtons ? '1' : '0')}</div>
          <p class="muted small">Larger buttons and text in the menus, easier to tap.</p>
        </div>
        <div class="card stack">
          <div class="set-row"><b>Night menus</b>${seg('night', [['0', 'Off'], ['1', 'On']], settings.nightMenus ? '1' : '0')}</div>
          <p class="muted small">Dark menus that are easier on the eyes at night.</p>
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
  pick('difficulty', (v) => changeSettings({ difficulty: v as typeof settings.difficulty }));
  pick('weather', (v) => changeSettings({ weather: v as typeof settings.weather }));
  pick('motion', (v) => changeSettings({ reducedMotion: v === '1' }));
  pick('vibe', (v) => { changeSettings({ vibration: v === '1' }); buzz(40); });
  pick('big', (v) => changeSettings({ bigButtons: v === '1' }));
  pick('night', (v) => changeSettings({ nightMenus: v === '1' }));
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
  hall: [icons.bed, 'Hall'], academic: [icons.grad, 'Faculty'], landmark: [icons.star, 'Landmark'], food: [icons.food, 'Food'], bank: [icons.bank, 'Bank'],
  transport: [icons.bus, 'Bus stop'], worship: [icons.church, 'Worship'], sport: [icons.ball, 'Sport'], health: [icons.health, 'Health'], other: [icons.pin, 'Place'],
};

// Explore options, remembered on this device
const EXPLORE_KEY = 'legonrush.explore.v1';
const exploreOpts: { mode: TravelMode; calm: boolean; guide: boolean } = (() => {
  try { return { mode: 'cycle', calm: true, guide: true, ...JSON.parse(localStorage.getItem(EXPLORE_KEY) ?? '{}') }; } catch { return { mode: 'cycle', calm: true, guide: true }; }
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
      ${stop && ends.length ? `<p class="muted small" style="margin-top:6px">${icons.bus} Nearest trotro stop: <b>${esc(stop.name.split(' (')[0])}</b>, ${dm(stopD)} away. Trotros to ${ends.map(esc).join(', ')}.</p>` : ''}
      <a class="btn btn-link btn-sm gmaps-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${toLatLng(place.x, place.z).map((v) => v.toFixed(6)).join(',')}">${icons.map} View on Google Maps</a>
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
        <p class="kicker">${icons.map} Explore</p>
        <h1 class="title">Find your way</h1>
        ${fx.exploreSearchHtml(p)}
        <button class="qr-campus solo" data-campus><span>${icons.pin}</span><span class="grow"><small>Campus</small>${esc(campusById(settings.campus).name)}${settings.campus === 'ug' ? ', Legon' : ''}</span><em>▾</em></button>
        <button class="card selectable tour-card" id="tour"><div class="row"><h3 style="font-weight:800">${icons.star} FRESHERS' TOUR</h3><span class="grow"></span><span class="badge gold">${TOUR_STOPS.length} places · 3.5 km</span></div><p class="muted small" style="margin-top:4px">One ride past the places you need in week one: ${TOUR_STOPS.map((n) => esc(n.replace(/^The |, .*$/g, ''))).join(', ')}.</p></button>
        ${fx.exploreModesHtml(p)}
        <p class="kicker" style="margin-top:6px">Or plan your own way</p>
        <p class="muted">Pick where you are and where you need to be. Type a name or what students call it, like Vandals, Pent or JQB.</p>
        <div class="field picker"><label for="from">From</label><input id="from" autocomplete="off" spellcheck="false" placeholder="Your hall, a faculty, a landmark…"><ul class="suggest" id="fromList" hidden></ul></div>
        <button class="btn btn-link swap" id="swap" aria-label="Swap from and to">⇅ Swap</button>
        <div class="field picker"><label for="to">To</label><input id="to" autocomplete="off" spellcheck="false" placeholder="Where do you need to be?"><ul class="suggest" id="toList" hidden></ul></div>
        <div class="chips">${POPULAR.filter((n) => placeByName(n)).map((n) => `<button class="chip" data-to="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="row options">${seg('mode', [['cycle', `${icons.bike} Cycle`], ['walk', `${icons.walk} Walk`]], exploreOpts.mode)}${seg('guide', [['1', 'Guided tour'], ['0', 'Just ride']], exploreOpts.guide ? '1' : '0')}${seg('calm', [['1', 'Calm ride'], ['0', 'With traffic']], exploreOpts.calm ? '1' : '0')}</div>
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
      ${fx.favButtonHtml(p, to)}
      <canvas class="route-map" width="720" height="440" aria-label="Map of the way from ${esc(from.name)} to ${esc(to.name)}"></canvas>
      <div class="stats three">
        <div class="stat"><b>${dm(route.length)}</b><span>Distance</span></div>
        <div class="stat"><b>${mins(route.length / 1.3)}</b><span>Walking</span></div>
        <div class="stat"><b>${mins(route.length / 4.5)}</b><span>Cycling</span></div>
      </div>
      <button class="btn btn-primary" id="go">${exploreOpts.guide ? 'Start guided ride' : 'Ride there'}</button>
      <div class="two">
        <button class="btn btn-ghost" id="share">Share route</button>
        <a class="btn btn-ghost" id="gmaps" target="_blank" rel="noopener">Google Maps</a>
      </div>
      <p class="muted small" id="shareNote" hidden></p>
      <p class="kicker" style="margin-top:6px">Directions</p>
      ${stepsList(route)}`;
    routeMap(preview.querySelector('canvas')!, route);
    fx.bindFavButton(preview, p);
    preview.querySelector('#go')!.addEventListener('click', () => route && play(false, route, { guided: exploreOpts.guide }));
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
  // "Where do you want to go?" picks the destination; favourites are one tap
  picker(app.querySelector('#fxWhere')!, app.querySelector('#fxWhereList')!, (pl) => { to = pl; toIn.value = pl.name; });
  on('[data-fav]', 'click', (_, el) => { to = placeByName(el.dataset.fav!); toIn.value = show(to); update(); preview.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  on('#fxMissions', 'click', () => fx.missionsScreen(() => explorePicker(fromName, toName)));
  on('#fxTreasure', 'click', () => fx.treasureScreen(() => explorePicker(fromName, toName)));

  on('[data-to]', 'click', (_, el) => { to = placeByName(el.dataset.to!); toIn.value = show(to); update(); });
  on('#swap', 'click', () => { [from, to] = [to, from]; fromIn.value = show(from); toIn.value = show(to); update(); });
  on('#mode [data-v]', 'click', (_, el) => {
    exploreOpts.mode = el.dataset.v as TravelMode;
    saveExploreOpts();
    app.querySelectorAll('#mode [data-v]').forEach((b) => b.classList.toggle('on', b === el));
    update();
  });
  on('#guide [data-v]', 'click', (_, el) => {
    exploreOpts.guide = el.dataset.v === '1';
    saveExploreOpts();
    app.querySelectorAll('#guide [data-v]').forEach((b) => b.classList.toggle('on', b === el));
    update();
  });
  on('#calm [data-v]', 'click', (_, el) => {
    exploreOpts.calm = el.dataset.v === '1';
    saveExploreOpts();
    app.querySelectorAll('#calm [data-v]').forEach((b) => b.classList.toggle('on', b === el));
  });
  on('#back', 'click', () => home());
  onBack(() => home());
  on('#tour', 'click', () => play(false, freshersTour(), { guided: exploreOpts.guide }));
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

// feature screens (challenges, badges, missions, treasure, profile card) share the shell's helpers
fx.initFeatures({
  app, settings, onBack, share,
  profile: () => profile!,
  showcase: () => { game.showcase(); applyLook(); },
  play: (route, extras) => play(false, route, extras),
  home: (t) => home(t),
  explore: (from, to) => explorePicker(from, to),
  garage: () => garageScreen(),
  bike3d: { style: (s) => game.setBikeStyle(s), view: (v) => game.viewBike(v), yaw: () => game.bikeYaw, scene: (t) => game.setTimeOfDay(t), refresh: (p) => applyLook(p ?? profile) },
  // COMMUNITY hooks: live presence, Vibe Ride entry points, sign-in and toasts
  online: () => online,
  onlineState: () => lobbyState,
  watchOnline: (fn) => { onlineWatchers.add(fn); return () => void onlineWatchers.delete(fn); },
  vibe: {
    setup: () => vibeSetup(),
    room: (code, host) => void joinVibe(code, host),
    inviteOnline: (key) => void inviteOnline(key),
    notice: (code, from) => gotInvite({ id: `cm-${code}`, code, from, at: Date.now() }),
  },
  signIn: () => authScreen('in', () => home('community')),
  toast: (html, actions, ms) => toast(html, actions, ms),
  quickMatch: () => void quickMatch(),
  myId,
  board: (routeId, back) => boardScreen(routeId, back),
});
money.initMoney();

// a signed-in rider's progress follows them between devices
const resetting = cloud.cameFromReset();
onProfileSave((p) => {
  if (!p.guest) cloud.push(p);
});
// riders who answered everything at sign-up before "Complete your profile" existed are already done
if (profile && !profile.guest && !profile.about.completedAt && profileComplete(profile)) {
  profile.about.completedAt = 'signup';
  saveProfile(profile);
}
// reminders for events and challenges the rider signed up for
setInterval(() => {
  for (const r of takeDue()) {
    showSystem(r);
    toast(`<b>${esc(r.title)}</b> ${esc(r.body)}`, r.tab ? [['Open', () => home(r.tab as TabId), true]] : []);
  }
}, 20000);
// losing the connection: say what still works, and refresh the menu that is showing
let offlineToldAt = 0;
addEventListener('offline', () => {
  // browsers can fire 'offline' twice in a row; say it once
  if (Date.now() - offlineToldAt < 10000) return;
  offlineToldAt = Date.now();
  toast(`${icons.wifiOff} <b>You're offline.</b> Solo rides, Explore and the Garage still work.`, [], 6000);
  if (app.querySelector('.shell')) home(tab);
});
addEventListener('online', () => {
  if (app.querySelector('.shell')) home(tab);
});
splash();
cloud.restore(() => {
  if (cloud.account) void syncDown();
}).then(() => {
  if (resetting && cloud.account) return authScreen('newpass', () => home('you'));
  if (cloud.account) {
    // coins paid for while away are added after the account's progress has arrived
    void syncDown().then(() => money.afterLaunch());
    void loadInvites();
  } else void money.afterLaunch();
});
