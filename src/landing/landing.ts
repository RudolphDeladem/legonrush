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

// Halls of residence (no standings until the season opens)
const list = document.getElementById('hall-list')!;
list.innerHTML = HALLS.filter((h) => h.id !== 'none')
  .map((h) => `<li><span class="hall-swatch" style="background:${h.color}"></span><span class="hall-name">${h.name}</span></li>`)
  .join('');
