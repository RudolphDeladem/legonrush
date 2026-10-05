// Small touches that make the menus feel alive: phone vibration, tap sounds,
// numbers that count up, and campus facts for the loading screens.
import { sfx } from '../audio';

let vibrate = true;
let motion = true;

export function setFeedback(o: { vibration: boolean; reducedMotion: boolean }) {
  vibrate = o.vibration;
  motion = !o.reducedMotion;
}

/** buzz the phone (Android browsers; iPhones ignore it) */
export function buzz(pattern: number | number[]) {
  if (!vibrate || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some embedded browsers block vibration */
  }
}

// The game plays these sounds on a crash, a coin and the finish; the phone buzzes with them.
let hooked = false;
export function hookHaptics() {
  if (hooked) return;
  hooked = true;
  const { crash, coin, finish } = sfx;
  sfx.crash = () => { crash(); buzz([90, 50, 160]); };
  sfx.coin = () => { coin(); buzz(12); };
  sfx.finish = () => { finish(); buzz([40, 60, 40, 60, 120]); };
}

/** a soft click on every menu button */
export function tapSounds(root: HTMLElement) {
  root.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.hud') && !t.closest('.overlay')) return; // the ride has its own sounds
    if (t.closest('button, .btn, a.btn, [data-nav]')) {
      sfx.lane();
      buzz(6);
    }
  }, { passive: true });
}

/** counts a number up from `from` to `to`, easing out */
export function countUp(el: HTMLElement, from: number, to: number, ms = 900, format = (n: number) => Math.round(n).toLocaleString('en-GB')) {
  if (!motion || from === to) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  el.textContent = format(from);
  requestAnimationFrame(tick);
}

/** shown while a ride loads and on the splash screen */
export const FACTS: [string, string][] = [
  ['Campus fact', 'The University of Ghana opened in 1948 as the University College of the Gold Coast.'],
  ['Campus fact', 'The Balme Library is named after David Balme, the first Principal of the University College.'],
  ['Campus fact', "Akuafo means \"farmers\" in Twi. Ghana's cocoa farmers helped pay for the hall."],
  ['Campus fact', "UG's motto is \"Integri Procedamus\": let us proceed with integrity."],
  ['Campus fact', 'The Great Hall sits on Legon Hill, looking down over the whole campus.'],
  ['Campus fact', 'Commonwealth Hall riders are known across campus as the Vandals.'],
  ['Tip', 'Boost to smash straight through barriers instead of crashing into them.'],
  ['Tip', 'Explore rides never end in a crash. Obstacles only slow you down.'],
  ['Tip', 'Every kilometre you ride counts for your hall in Hall Week.'],
  ['Tip', 'A crash helmet saves you from one crash. Stock up in the Garage.'],
  ['Tip', 'Finish an event while it is live to win a bike you can only get there.'],
  ['Tip', 'Coins fill your boost bar. Grab them to boost more often.'],
];
export const randomFact = () => FACTS[Math.floor(Math.random() * FACTS.length)];
