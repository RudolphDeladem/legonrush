import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import './landing.css';
import { HALLS } from '../data/campus';
import { EVENTS, eventStatus } from '../data/events';
import { SUPABASE_KEY, SUPABASE_URL, weekStart } from '../cloud-config';

// Mobile menu
const menu = document.getElementById('menu')!;
const links = document.getElementById('links')!;
menu.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
});
links.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).tagName === 'A') {
    links.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
  }
});

// Hall standings: kilometres ridden for each hall this week, straight from the game's database
const halls = HALLS.filter((h) => h.id !== 'none');
const list = document.getElementById('hall-list')!;
function showHalls(km: Record<string, number>) {
  const sorted = [...halls].sort((a, b) => (km[b.id] ?? 0) - (km[a.id] ?? 0) || a.name.localeCompare(b.name));
  list.innerHTML =
    sorted
      .slice(0, 5)
      .map((h) => `<li><span class="hall-swatch" style="background:${h.color}"></span><span class="hall-name">${h.name}</span><span class="hall-pts">${(km[h.id] ?? 0).toFixed(1)} km</span></li>`)
      .join('') + `<li class="hall-more">+ ${sorted.length - 5} more halls</li>`;
}
showHalls({});
fetch(`${SUPABASE_URL}/rest/v1/rpc/hall_standings`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_since: weekStart().toISOString() }),
})
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((rows: { hall: string; km: number }[]) => showHalls(Object.fromEntries(rows.map((r) => [r.hall, Number(r.km)]))))
  .catch(() => { /* offline or not set up yet: every hall stays on 0 */ });

// Events: show which daily event is live in the visitor's local time
const clockText = (d: Date) => {
  const h = d.getHours();
  return h === 0 ? 'midnight' : `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
};
function showEvents() {
  for (const e of EVENTS) {
    const st = eventStatus(e);
    const card = document.querySelector<HTMLElement>(`.event[data-event="${e.id}"]`);
    if (card) {
      card.classList.toggle('is-live', st.live);
      const tag = card.querySelector<HTMLElement>('.status')!;
      tag.className = `status ${st.live ? 's-live' : 's-up'}`;
      tag.textContent = st.live ? `Live now · ends ${clockText(st.ends!)}` : `Starts ${clockText(st.next)}`;
      const btn = card.querySelector<HTMLAnchorElement>('.btn')!;
      btn.className = `btn ${st.live ? 'btn-gold' : 'btn-line'} btn-xs`;
      btn.firstChild!.textContent = st.live ? 'Ride now ' : 'Practise now ';
    }
    const row = document.querySelector<HTMLElement>(`#today li[data-event="${e.id}"]`);
    if (row) {
      row.classList.toggle('is-live', st.live);
      row.querySelector('span')!.textContent = st.live ? `Live now until ${clockText(st.ends!)} · 2× coins` : `${clockText(st.next)} to ${e.to === 0 ? 'midnight' : `${e.to % 12 || 12} ${e.to < 12 ? 'am' : 'pm'}`}`;
    }
  }
  const days = (8 - new Date().getDay()) % 7 || 7;
  document.getElementById('weekLeft')!.textContent = days === 1 ? 'Last day for this week\'s goal' : `${days} days left this week`;
}
showEvents();
setInterval(showEvents, 60_000);

// ---------- motion ----------
document.documentElement.classList.add('js');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// headline numbers count up once the page is showing
for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
  const target = Number(el.dataset.count);
  const suffix = el.dataset.suffix ?? '';
  if (still) continue;
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / 1400);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString('en-GB') + (k === 1 ? suffix : '');
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// sections rise into view; siblings follow one another
const revealables = document.querySelectorAll<HTMLElement>(
  '.section-head, .split > *, .split-r > *, .pillar, .event, .live-panel, .race-card, .features li, .step, .board, .faq details, .panel, .together > *, .world-copy, .brands-copy, .ready-copy, .how .h2-line',
);
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    seen.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px' });
revealables.forEach((el) => {
  const i = [...(el.parentElement?.children ?? [])].indexOf(el);
  el.style.setProperty('--d', `${Math.min(i, 5) * 0.08}s`);
  el.classList.add('reveal');
  seen.observe(el);
});

// ---------- fastest on campus ----------
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
for (const board of document.querySelectorAll<HTMLElement>('.board[data-route]')) {
  const list = board.querySelector('ol')!;
  fetch(`${SUPABASE_URL}/rest/v1/rpc/leaderboard`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_route: board.dataset.route, p_limit: 3 }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rows: { name: string; hall: string; best: number }[]) => {
      list.innerHTML = rows.length
        ? rows.map((r, i) => {
          const h = HALLS.find((x) => x.id === r.hall);
          return `<li><span class="medal">${i + 1}</span><span class="who"><b>${esc(r.name)}</b><span>${esc(h?.name ?? 'Non-resident')}</span></span><span class="t">${fmtTime(Number(r.best))}</span></li>`;
        }).join('')
        : '<li class="empty">No times yet. Be the first.</li>';
    })
    .catch(() => { list.innerHTML = '<li class="empty">Open the game to see the leaderboard.</li>'; });
}
