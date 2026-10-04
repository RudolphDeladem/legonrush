import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import './landing.css';
import { HALLS } from '../data/campus';
import { EVENTS, eventStatus } from '../data/events';

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

// Hall standings: Season 1 has not started, so every hall is on 0 points (listed A to Z)
const halls = HALLS.filter((h) => h.id !== 'none').sort((a, b) => a.name.localeCompare(b.name));
const list = document.getElementById('hall-list')!;
list.innerHTML =
  halls
    .slice(0, 5)
    .map((h) => `<li><span class="hall-swatch" style="background:${h.color}"></span><span class="hall-name">${h.name}</span><span class="hall-pts">0</span></li>`)
    .join('') + `<li class="hall-more">+ ${halls.length - 5} more halls</li>`;

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
