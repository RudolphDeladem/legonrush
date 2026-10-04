import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import './landing.css';
import { HALLS } from '../data/campus';

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
