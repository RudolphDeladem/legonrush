// Small flat drawings for cards: a side-on bike in its colours, and a picture for every kind of item.
import type { BikeStyle } from '../../game/models';
import { icons } from '../../ui/icons';
import { fx } from '../icons';
import { bikeLook, item, type Item } from './catalog';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const DASH: Record<string, string> = { stripe: '6 4', speed: '2 2', checker: '3 3', kente: '4 2', dots: '1 3', flames: '8 2', sunset: '', map: '3 2', hall: '10 3', word: '' };

/** a side-on bike drawing in the style's colours */
export function bikeSvg(s: BikeStyle, cls = 'gx-bike') {
  const R = [26, 50], F = [94, 50], BB = [54, 52], S = [48, 24], H = [80, 24], HL = [82, 32];
  const fat = s.wheel === 'fat';
  const wheel = ([x, y]: number[]) => `
    ${s.wheel === 'disc' ? `<circle cx="${x}" cy="${y}" r="16" fill="${s.accent}" opacity="0.9"/>` : ''}
    ${s.wheel === 'deep' ? `<circle cx="${x}" cy="${y}" r="13.5" fill="none" stroke="${s.accent}" stroke-width="5"/>` : ''}
    ${s.wheel === 'spoke' || fat ? [0, 30, 60, 90, 120, 150].map((a) => { const r = (a * Math.PI) / 180, c = Math.cos(r) * 15, d = Math.sin(r) * 15; return `<line x1="${x - c}" y1="${y - d}" x2="${x + c}" y2="${y + d}" stroke="#9aa1ab" stroke-width="0.6"/>`; }).join('') : ''}
    <circle cx="${x}" cy="${y}" r="16.5" fill="none" stroke="${s.accent}" stroke-width="1.6"/>
    <circle cx="${x}" cy="${y}" r="${fat ? 19 : 18.5}" fill="none" stroke="${s.tyre}" stroke-width="${fat ? 5.5 : 3.2}"/>
    <circle cx="${x}" cy="${y}" r="2.2" fill="${s.accent}"/>`;
  const line = (a: number[], b: number[], c: string, w: number) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  const tw = s.frame === 'mtb' ? 5 : 3.8;
  const top = s.frame === 'step' ? `<path d="M${H[0] - 1} ${H[1] + 4} Q 62 30 ${BB[0] + 1} ${BB[1] - 10}" fill="none" stroke="${s.primary}" stroke-width="${tw}" stroke-linecap="round"/>`
    : s.frame === 'mtb' ? line([S[0] + 1, S[1] + 6], H, s.primary, tw) : line(S, H, s.primary, tw);
  const bars = s.bars === 'drop' ? `<path d="M${H[0] - 2} 18 h8 q5 0 5 5 q0 5 -4 6" fill="none" stroke="#1b1e24" stroke-width="2.4" stroke-linecap="round"/>`
    : s.bars === 'riser' ? `<path d="M${H[0] - 1} 19 q4 -1 6 -5 l4 0" fill="none" stroke="#1b1e24" stroke-width="2.4" stroke-linecap="round"/>`
    : `<path d="M${H[0] - 2} 18 h10" stroke="#1b1e24" stroke-width="2.4" stroke-linecap="round"/>`;
  const grip = s.grips === 'accent' ? `<circle cx="${H[0] + 8}" cy="18" r="1.8" fill="${s.accent}"/>` : '';
  const seat = s.seat === 'comfy' ? `<ellipse cx="${S[0] - 1}" cy="${S[1] - 5}" rx="7" ry="2.6" fill="#6b4428"/>` : `<path d="M${S[0] - 7} ${S[1] - 5} q6 -3 13 0 q-6 2 -13 0z" fill="#1b1e24"/>`;
  const d = s.decal;
  const decal = d ? `<line x1="${BB[0] + 3}" y1="${BB[1] - 3}" x2="${HL[0] - 4}" y2="${HL[1] + 3}" stroke="${d.pattern === 'sunset' ? '#ff7a3d' : d.pattern === 'kente' ? '#f2b705' : d.color ?? s.accent}" stroke-width="2" stroke-dasharray="${DASH[d.pattern] ?? ''}" stroke-linecap="round"/>` : '';
  const light = s.light ? `<circle cx="${H[0] + 3}" cy="23" r="2.4" fill="${s.light}" stroke="#1b1e24" stroke-width="0.8"/>${s.glow ? line([BB[0] + 2, BB[1] + 2], [HL[0] - 2, HL[1] + 5], s.light, 1.6) : ''}` : '';
  const basket = s.basket ? `<rect x="${F[0] - 9}" y="20" width="14" height="10" rx="1.5" fill="none" stroke="#b8864b" stroke-width="1.6"/><path d="M${F[0] - 6} 20v10M${F[0] - 2} 20v10M${F[0] + 2} 20v10" stroke="#b8864b" stroke-width="0.8"/>` : '';
  const rack = s.rack ? `${line([S[0] - 4, 30], [R[0] - 2, 30], '#9aa1ab', 1.4)}<rect x="${R[0] - 4}" y="22" width="16" height="8" rx="2" fill="${s.secondary}" stroke="#1b1e24" stroke-width="0.6"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 120 72" aria-hidden="true">
    ${wheel(R)}${wheel(F)}
    ${line(BB, R, s.secondary, 2.6)}${line([S[0], S[1] + 1], R, s.secondary, 2.2)}${line(HL, F, s.secondary, 3)}
    ${top}${line(BB, HL, s.primary, tw + 0.8)}${line(BB, [S[0] - 1, S[1] - 1], s.primary, tw)}${line(HL, H, s.primary, tw + 1)}
    ${decal}${rack}
    ${line([S[0] - 1, S[1] - 1], [S[0] - 1.6, S[1] - 4], '#9aa1ab', 1.6)}${seat}
    ${line(H, [H[0] + 1, 18], '#9aa1ab', 1.8)}${bars}${grip}${basket}${light}
    <circle cx="${BB[0]}" cy="${BB[1]}" r="4.5" fill="none" stroke="${s.accent}" stroke-width="1.4"/>
  </svg>`;
}

const swatch = (c: string, sheen = false) => `<svg class="gx-sw" viewBox="0 0 40 40" aria-hidden="true">${sheen ? `<defs><radialGradient id="sh" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` : ''}<circle cx="20" cy="20" r="16" fill="${c}" stroke="rgba(0,0,0,0.15)"/>${sheen ? '<circle cx="20" cy="20" r="16" fill="url(#sh)"/>' : ''}</svg>`;

const FINISH: Record<string, string> = { gloss: '#e04848', matte: '#5a6270', metallic: '#8a9bb8', carbon: '#2a2d33', chrome: '#d7dde5', neon: '#39ff14' };

/** the decal as a short painted tube */
function decalArt(it: Item) {
  const d = it.style!.decal!;
  const c = d.color ?? '#0b1530';
  const base = d.pattern === 'kente' ? '#111' : '#f4f5f8';
  let inner = '';
  if (d.pattern === 'stripe') inner = `<rect x="14" y="10" width="10" height="20" fill="${c}"/><rect x="34" y="10" width="10" height="20" fill="${c}"/><rect x="54" y="10" width="10" height="20" fill="${c}"/>`;
  else if (d.pattern === 'speed') inner = [0, 1, 2, 3, 4, 5].map((i) => `<path d="M${6 + i * 12} 30 l8 -20 h4 l-8 20z" fill="${c}"/>`).join('');
  else if (d.pattern === 'checker') inner = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${6 + i * 8}" y="${i % 2 ? 10 : 20}" width="8" height="10" fill="${c}"/>`).join('');
  else if (d.pattern === 'kente') inner = ['#f2b705', '#0f7b3a', '#c8102e', '#f2b705', '#0f7b3a', '#c8102e', '#f2b705'].map((k, i) => `<rect x="${6 + i * 10}" y="10" width="6" height="20" fill="${k}"/>`).join('');
  else if (d.pattern === 'dots') inner = [0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${12 + i * 10}" cy="${i % 2 ? 15 : 25}" r="3" fill="${c}"/>`).join('');
  else if (d.pattern === 'flames') inner = `<path d="M6 30 q14 -6 20 -16 q2 8 10 6 q-2 -6 6 -12 q0 10 10 12 q4 -4 4 -10 q8 10 20 20z" fill="${d.color ?? '#ff7a1a'}"/>`;
  else if (d.pattern === 'sunset') inner = `<defs><linearGradient id="ss" x1="0" x2="1"><stop offset="0" stop-color="#ffcf4a"/><stop offset="0.5" stop-color="#ff7a3d"/><stop offset="1" stop-color="#c2366b"/></linearGradient></defs><rect x="6" y="10" width="68" height="20" rx="10" fill="url(#ss)"/>`;
  else if (d.pattern === 'map') inner = `<path d="M10 22 q10 -10 20 0 t20 0 t20 -4" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/><path d="M62 12l6 6M68 12l-6 6" stroke="${c}" stroke-width="2.4"/>`;
  else inner = `<rect x="6" y="10" width="${d.pattern === 'hall' ? 10 : 0}" height="20" fill="${c}"/><text x="40" y="24.5" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="10" fill="${d.pattern === 'hall' ? '#0b1530' : c}">${esc((d.text ?? 'YOUR NAME').slice(0, 10))}</text>`;
  return `<svg class="gx-decal" viewBox="0 0 80 40" aria-hidden="true"><clipPath id="tube-${it.id.replace(/\W/g, '')}"><rect x="6" y="10" width="68" height="20" rx="10"/></clipPath><rect x="6" y="10" width="68" height="20" rx="10" fill="${base}" stroke="rgba(0,0,0,0.15)"/><g clip-path="url(#tube-${it.id.replace(/\W/g, '')})">${inner}</g></svg>`;
}

const PART_ICON: Record<string, string> = { frame: icons.frame, wheels: icons.wheel, tires: icons.wheel, gearing: icons.cog, brakes: icons.brake, boost: icons.bolt };

/** a picture for any item; bikes use their look (or the given one) */
export function itemArt(it: Item, look?: BikeStyle): string {
  // very light colours (white, chrome) get a darker shade so they show on light cards
  const light = (c: string) => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) > 200; };
  const tint = (svg: string, color?: string) => `<span class="gx-ico"${color ? ` style="color:${light(color) ? '#7d8796' : color}"` : ''}>${svg}</span>`;
  switch (it.kind) {
    case 'bike': return bikeSvg(look ?? bikeLook(it));
    case 'paint': return swatch(it.color!, true);
    case 'finish': return swatch(FINISH[it.id.slice(7)] ?? '#888', it.id !== 'finish:matte');
    case 'decal': return decalArt(it);
    case 'wheel': return bikeSvg({ ...bikeLook(item('bike:city')!), primary: '#c3c8d0', secondary: '#c3c8d0', accent: '#2f7bea', ...it.style }, 'gx-bike faded');
    case 'tyre': return `<svg class="gx-sw" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="none" stroke="${it.color}" stroke-width="6"/><circle cx="20" cy="20" r="10" fill="none" stroke="#9aa1ab" stroke-width="1.5"/></svg>`;
    case 'bars': case 'seat': case 'grips': return bikeSvg({ ...bikeLook(item('bike:city')!), primary: '#c3c8d0', secondary: '#c3c8d0', accent: '#e04848', ...it.style }, 'gx-bike faded');
    case 'light': return tint(fx.bulb, it.color && it.color !== '#fff6d8' ? it.color : undefined);
    case 'acc': return it.id === 'acc:bottle' ? tint(fx.cup) : bikeSvg({ ...bikeLook(item('bike:city')!), primary: '#c3c8d0', secondary: '#2f7bea', accent: '#c3c8d0', ...it.style }, 'gx-bike faded');
    case 'bell': return tint(icons.bell);
    case 'rider': return tint(it.rider?.helmet ? icons.helmet : fx.shirt, it.color);
    case 'jersey': return tint(fx.shirt, it.color);
    case 'gear': return tint(it.gear?.helmets ? icons.helmet : it.gear?.repairKits ? fx.wrench : fx.cup);
    case 'part': return tint(PART_ICON[it.slot!] ?? icons.cog);
    case 'bundle': {
      const inside = (it.contains ?? []).map((id) => item(id)).filter(Boolean) as Item[];
      const lead = inside.find((x) => x.kind === 'bike');
      return lead ? bikeSvg(bikeLook(lead)) : `<span class="gx-stack">${inside.slice(0, 3).map((x) => `<i>${itemArt(x)}</i>`).join('')}</span>`;
    }
  }
  return tint(icons.star);
}
