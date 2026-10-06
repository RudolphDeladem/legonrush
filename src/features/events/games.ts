// Mini-games for event spaces: the Campus Quiz (questions about UG and LEGONRUSH, built from the
// campus guide facts) and Target Tap (hit targets for 30 seconds). Each runs in an overlay over
// the event space and hands back a score; the space posts it to the event leaderboard.
import { FACTS } from '../../data/facts';
import { esc } from '../host';
import { icons } from '../../ui/icons';
import { sfx } from '../../audio';
import { buzz } from '../../ui/feedback';

export type GameId = 'quiz' | 'target';
export const GAMES: { id: GameId; name: string; icon: string; blurb: string; max: number }[] = [
  { id: 'quiz', name: 'Campus Quiz', icon: icons.help, blurb: 'Six questions about Legon. Faster answers score more.', max: 960 },
  { id: 'target', name: 'Target Tap', icon: icons.target, blurb: 'Tap the targets for 30 seconds. Small ones score double.', max: 2000 },
];

// ---------- Campus Quiz ----------
interface Q { q: string; options: string[]; answer: number }
const FIXED: Q[] = [
  { q: 'What do Commonwealth Hall residents call themselves?', options: ['Vandals', 'Vikings', 'Farmers', 'Legonites'], answer: 0 },
  { q: 'Mensah Sarbah Hall residents are known as…', options: ['Vandals', 'Vikings', 'Spartans', 'Eagles'], answer: 1 },
  { q: 'Akuafo is the Akan word for…', options: ['Farmers', 'Kings', 'Builders', 'Teachers'], answer: 0 },
  { q: 'Which of these is an all-female hall?', options: ['Volta Hall', 'Commonwealth Hall', 'Mensah Sarbah Hall', 'Akuafo Hall'], answer: 0 },
  { q: 'Ghana\'s Independence Day is on…', options: ['6 March', '1 July', '24 September', '4 August'], answer: 0 },
  { q: 'Where are congregations (graduations) held?', options: ['Great Hall', 'JQB', 'Night Market', 'Athletic Oval'], answer: 0 },
  { q: 'Most students call the Central Cafeteria…', options: ['CC', 'The Caf', 'Central', 'The Mess'], answer: 0 },
  { q: 'In LEGONRUSH, a crash helmet…', options: ['Saves you from one crash', 'Makes you faster', 'Doubles your coins', 'Lasts forever'], answer: 0 },
  { q: 'In LEGONRUSH, riding Night Rush while it is live gives…', options: ['Double coins', 'Free diamonds', 'A new hall', 'Nothing extra'], answer: 0 },
  { q: 'Hall motto of Commonwealth Hall?', options: ['Truth Stands', 'Knowledge is Power', 'Integri Procedamus', 'Rise and Shine'], answer: 0 },
];

/** "Which place is this?" from the campus guide facts, with the name blanked out */
function factQuestions(): Q[] {
  const titles = FACTS.map((f) => f.title);
  return FACTS.map((f) => {
    let text = f.text;
    for (const w of f.title.replace(/\(.*\)/, '').split(/\s+/).filter((x) => x.length > 3)) text = text.replace(new RegExp(w, 'gi'), '…');
    const wrong = titles.filter((t) => t !== f.title).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [f.title, ...wrong].sort(() => Math.random() - 0.5);
    return { q: `Which place is this? "${text}"`, options, answer: options.indexOf(f.title) };
  });
}

function pickQuestions(n = 6): Q[] {
  const pool = [...FIXED.map((q) => shuffleOptions(q)), ...factQuestions()].sort(() => Math.random() - 0.5);
  return pool.slice(0, n);
}
function shuffleOptions(q: Q): Q {
  const right = q.options[q.answer];
  const options = [...q.options].sort(() => Math.random() - 0.5);
  return { ...q, options, answer: options.indexOf(right) };
}

function overlay(cls: string) {
  const ov = document.createElement('div');
  ov.className = `overlay ev-game-ov fade-in ${cls}`;
  document.body.appendChild(ov);
  return ov;
}

/** plays the quiz; calls done(score, correct) unless the player quits (done(null)) */
export function playQuiz(done: (score: number | null, detail: string) => void) {
  const qs = pickQuestions();
  const ov = overlay('light-ui');
  let i = 0, score = 0, right = 0, timer = 0, left = 12;
  const finish = (quit = false) => {
    clearInterval(timer);
    ov.remove();
    done(quit ? null : score, `${right} of ${qs.length} right`);
  };
  const show = () => {
    clearInterval(timer);
    if (i >= qs.length) {
      ov.innerHTML = `<div class="ev-game card"><span class="ev-game-ico">${icons.trophy}</span><h2 class="title" style="font-size:30px">${score} points</h2><p class="muted">${right} of ${qs.length} right${right === qs.length ? '. Full marks!' : ''}</p><button class="btn btn-primary" data-done>Post my score</button></div>`;
      ov.querySelector('[data-done]')!.addEventListener('click', () => finish());
      sfx.finish();
      return;
    }
    const q = qs[i];
    left = 12;
    ov.innerHTML = `<div class="ev-game card">
      <div class="row"><small class="kicker">Question ${i + 1} of ${qs.length}</small><span class="grow"></span><b class="ev-qtime" id="qt">${left}</b><button class="btn btn-link" data-quit>${icons.close}</button></div>
      <div class="xpbar"><div id="qbar" style="width:100%"></div></div>
      <h3 class="ev-q">${esc(q.q)}</h3>
      <div class="ev-opts">${q.options.map((o, k) => `<button class="ev-opt" data-k="${k}">${esc(o)}</button>`).join('')}</div>
      <p class="muted small">Score ${score}</p>
    </div>`;
    ov.querySelector('[data-quit]')!.addEventListener('click', () => finish(true));
    const answer = (k: number) => {
      clearInterval(timer);
      const ok = k === q.answer;
      if (ok) { right++; score += 100 + left * 5; sfx.coin(); } else buzz(40);
      ov.querySelectorAll<HTMLButtonElement>('.ev-opt').forEach((b, j) => {
        b.disabled = true;
        if (j === q.answer) b.classList.add('right');
        else if (j === k) b.classList.add('wrong');
      });
      setTimeout(() => { i++; show(); }, 1100);
    };
    ov.querySelectorAll<HTMLElement>('.ev-opt').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.k))));
    timer = window.setInterval(() => {
      left--;
      const t = ov.querySelector('#qt'), bar = ov.querySelector<HTMLElement>('#qbar');
      if (t) t.textContent = String(Math.max(0, left));
      if (bar) bar.style.width = `${(left / 12) * 100}%`;
      if (left <= 0) answer(-1);
    }, 1000);
  };
  show();
}

// ---------- Target Tap ----------
export function playTarget(done: (score: number | null, detail: string) => void) {
  const ov = overlay('light-ui');
  const LEN = 30;
  let score = 0, hits = 0, misses = 0, left = LEN, timer = 0, spawn = 0, running = false;
  ov.innerHTML = `<div class="ev-game card ev-target-wrap">
    <div class="row"><small class="kicker">Target Tap</small><span class="grow"></span><b class="ev-qtime" id="tt">${LEN}</b><button class="btn btn-link" data-quit>${icons.close}</button></div>
    <div class="ev-pad" id="pad"><div class="ev-pad-msg"><b>Tap the targets</b><span class="muted small">Big ones 10, small ones 20. Misses cost 3.</span><button class="btn btn-primary" data-go>Start</button></div></div>
    <div class="row small"><span>Score <b id="ts">0</b></span><span class="grow"></span><span class="muted" id="th">0 hits</span></div>
  </div>`;
  const pad = ov.querySelector<HTMLElement>('#pad')!;
  const end = (quit: boolean) => {
    clearInterval(timer); clearInterval(spawn);
    running = false;
    if (quit) { ov.remove(); return done(null, ''); }
    pad.innerHTML = `<div class="ev-pad-msg"><span class="ev-game-ico">${icons.trophy}</span><b>${score} points</b><span class="muted small">${hits} hits · ${misses} misses</span><button class="btn btn-primary" data-done>Post my score</button></div>`;
    pad.querySelector('[data-done]')!.addEventListener('click', () => { ov.remove(); done(score, `${hits} hits`); });
    sfx.finish();
  };
  ov.querySelector('[data-quit]')!.addEventListener('click', () => end(true));
  const put = () => {
    if (!running) return;
    if (pad.querySelectorAll('.ev-tgt').length >= 3) pad.querySelector('.ev-tgt')?.remove();
    const small = Math.random() < 0.3;
    const t = document.createElement('button');
    t.className = `ev-tgt${small ? ' small' : ''}`;
    t.setAttribute('aria-label', 'Target');
    t.innerHTML = icons.target;
    t.style.left = `${8 + Math.random() * 76}%`;
    t.style.top = `${8 + Math.random() * 72}%`;
    t.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      if (!running) return;
      hits++;
      score += small ? 20 : 10;
      t.classList.add('hit');
      sfx.coin();
      setTimeout(() => t.remove(), 160);
      ov.querySelector('#ts')!.textContent = String(score);
      ov.querySelector('#th')!.textContent = `${hits} hits`;
    });
    pad.appendChild(t);
    setTimeout(() => t.isConnected && !t.classList.contains('hit') && t.remove(), small ? 900 : 1400);
  };
  pad.addEventListener('pointerdown', () => {
    if (!running) return;
    misses++;
    score = Math.max(0, score - 3);
    ov.querySelector('#ts')!.textContent = String(score);
    buzz(20);
  });
  ov.querySelector('[data-go]')!.addEventListener('click', (ev) => {
    ev.stopPropagation();
    pad.innerHTML = '';
    running = true;
    put();
    spawn = window.setInterval(put, 520);
    timer = window.setInterval(() => {
      left--;
      ov.querySelector('#tt')!.textContent = String(Math.max(0, left));
      if (left <= 0) end(false);
    }, 1000);
  });
}

export const playGame = (id: GameId, done: (score: number | null, detail: string) => void) => (id === 'quiz' ? playQuiz(done) : playTarget(done));
