const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icons = {
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  ride: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l2 8h-6"/><path d="M14 5h2"/>'),
  race: svg('<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>'),
  events: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  you: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  coin: '🪙',
};
