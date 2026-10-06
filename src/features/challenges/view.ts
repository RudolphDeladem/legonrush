// Small pieces of HTML shared by the Challenges tab and its screens: cards, rows, badges, the live
// countdowns and the share/copy buttons.
import { icons } from '../../ui/icons';
import { esc, fmt } from '../host';
import { hallById } from '../../data/campus';
import { accessOf, chRoute, countdown, dayDiff, formatOf, kmOf, maxPoolOf, phaseOf, poolOf, regOpen, timeText, whenText, type Challenge } from './model';
import { joined } from './data';
import * as api from './api';
import { kindOf, photoOf } from './kinds';

export const ic = (name: string) => (icons as Record<string, string>)[name] ?? icons.flag;
export const PLAY_URL = `${location.origin}${import.meta.env.BASE_URL}play/`;
export const linkOf = (c: Challenge) => `${PLAY_URL}?ch=${encodeURIComponent(c.official ? c.id : c.code)}`;

/** the text that goes with a shared challenge */
export function shareText(c: Challenge) {
  const route = chRoute(c.route)?.name ?? '';
  const ph = phaseOf(c);
  const when = ph === 'live' ? (c.format === 'live_race' ? 'Racing now' : `Open now until ${whenText(c.endsAt).replace(' · ', ' at ')}`) : `Starts ${whenText(c.startsAt).replace(' · ', ' at ').replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}`;
  return `Can you beat my LEGONRUSH time?\n${c.name}\n${route} · ${when}${c.code ? `\nCode: ${c.code}` : ''}`;
}

/** LIVE, Starts in 18:42 (ticking), Sat · 5:00 PM, Ended */
export function statusBadge(c: Challenge, now = Date.now()) {
  const ph = phaseOf(c, now);
  if (ph === 'cancelled') return `<span class="chx-st off">Cancelled</span>`;
  if (ph === 'ended') return `<span class="chx-st off">Ended</span>`;
  if (ph === 'live') return c.format === 'live_race' && !regOpen(c, now) && c.status === 'live' ? `<span class="chx-st live"><i></i>Racing</span>` : `<span class="chx-st live"><i></i>Live</span>`;
  if (ph === 'soon' && c.startNow) return `<span class="chx-st soon">${icons.social} In the lobby</span>`;
  if (ph === 'soon') return `<span class="chx-st soon">${icons.clock}<span data-cd="${c.startsAt}">${countdown(c.startsAt - now)}</span></span>`;
  return `<span class="chx-st">${esc(shortWhen(c.startsAt, now))}</span>`;
}

/** Today 6:00 PM → "6:00 PM", tomorrow → "Tomorrow", this week → "Wed", later → "10 Oct" */
function shortWhen(t: number, now: number) {
  const dd = dayDiff(t, now);
  if (dd === 0) return timeText(t);
  if (dd === 1) return 'Tomorrow';
  return new Date(t).toLocaleDateString('en-GB', dd < 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
}

export const fmtTile = (c: Challenge) => `<span class="chx-tile f-${c.format}">${ic(formatOf(c.format).icon)}</span>`;
export const byline = (c: Challenge) => (c.official ? `<span class="chx-off">${icons.shield} LEGONRUSH</span> · ${esc(c.series ?? 'Official')}` : `by ${esc(c.creator?.username ? '@' + c.creator.username : c.creator?.name ?? 'a rider')}`);
export const entryText = (c: Challenge) => (c.entryFee > 0 ? `${icons.coin} ${fmt(c.entryFee)} entry` : 'Free');
export const ridersText = (c: Challenge) => (c.maxRiders >= 999 ? `${fmt(c.riders)} rider${c.riders === 1 ? '' : 's'}` : `${c.riders}/${c.maxRiders}`);
export function accessChip(c: Challenge) {
  const a = accessOf(c.access);
  const name = c.access === 'hall' && c.hall ? `${hallById(c.hall).short} only` : a.name;
  return `<span class="chx-acc">${ic(a.icon)} ${esc(name)}</span>`;
}

/** the main card in lists */
export function chCard(c: Challenge, now = Date.now()) {
  const ph = phaseOf(c, now);
  const r = chRoute(c.route);
  const mine = joined(c);
  const pool = c.entryFee > 0 ? Math.max(poolOf(c), 0) : 0;
  const started = ph === 'live' && c.format === 'live_race' ? `<span>${icons.clock} Started <span data-up="${c.startsAt}">${countdown(now - c.startsAt)}</span> ago</span>` : '';
  const ends = ph === 'live' && c.format !== 'live_race' ? `<span>${icons.clock} Ends ${c.endsAt - now < 86400e3 ? timeText(c.endsAt) : whenText(c.endsAt, now)}</span>` : '';
  const action = ph === 'ended' || ph === 'cancelled' ? 'Results' : mine ? (ph === 'live' ? (c.format === 'live_race' ? 'Lobby' : 'Ride') : 'View') : regOpen(c, now) ? (c.official && ph === 'live' && c.format !== 'live_race' ? 'Ride' : 'Join') : ph === 'live' ? 'Leaderboard' : 'View';
  return `<button class="card chx-card ph-${ph}${mine ? ' is-mine' : ''}" data-chx-open="${esc(c.id)}">
    <span class="chx-card-top">${fmtTile(c)}<span class="grow chx-name"><b>${esc(c.name)}</b><small>${byline(c)}</small></span>${statusBadge(c, now)}</span>
    <span class="chx-meta">
      <span>${icons.pin} ${esc(r?.name ?? c.route)} · ${kmOf(c.route)}</span>
      <span>${ic(formatOf(c.format).icon)} ${esc(formatOf(c.format).name)}${c.attempts > 1 ? ` · ${c.attempts} tries` : ''}</span>
      ${c.official && !c.riders ? '' : `<span>${icons.social} ${ridersText(c)}</span>`}
      ${started}${ends}
      ${c.startNow && ph === 'soon' ? `<span>${icons.flag} Starts when riders are ready</span>` : ph === 'upcoming' || ph === 'soon' ? `<span>${icons.events} ${esc(whenText(c.startsAt, now))}</span>` : ''}
      <span>${entryText(c)}</span>
      ${c.entryFee > 0 ? `<span>${icons.trophy} ${fmt(pool || maxPoolOf(c))}${pool ? '' : ' max'} pool</span>` : ''}
      ${c.official ? '' : accessChip(c)}
    </span>
    <span class="chx-card-foot">${mine ? `<span class="chx-in">${icons.check} You're in</span>` : ph === 'live' && c.format === 'live_race' && !regOpen(c, now) ? '<span class="muted small">Race in progress</span>' : ''}<span class="grow"></span><span class="chx-go">${action} ${icons.arrow}</span></span>
  </button>`;
}

/** the photo card in the Challenges tab rows (DELA's design): badges on the photo, then name, line, stats and a yellow button */
export function chTile(c: Challenge, now = Date.now()) {
  const ph = phaseOf(c, now);
  const k = kindOf(c);
  const r = chRoute(c.route);
  const mine = joined(c);
  const badges = [
    ph === 'live' ? `<i class="b live"><em></em>Live</i>` : ph === 'soon' ? `<i class="b soon">Starting soon</i>` : ph === 'upcoming' ? `<i class="b">Upcoming</i>` : `<i class="b">${ph === 'cancelled' ? 'Cancelled' : 'Ended'}</i>`,
    c.entryFee > 0 ? `<i class="b">${icons.coin} Paid</i>` : `<i class="b">Free</i>`,
    k.id === 'hall' || k.id === 'interhall' || c.access === 'hall' ? `<i class="b">${icons.pillars} ${c.hall ? esc(hallById(c.hall).short) : 'Hall'}</i>` : '',
    c.access === 'code' || c.access === 'link' || c.access === 'friends' ? `<i class="b">${icons.key} ${c.access === 'friends' ? 'Invite' : 'Code'}</i>` : '',
  ].join('');
  const sub = k.sub ?? r?.line ?? '';
  const left = c.endsAt - now;
  const when = ph === 'live'
    ? (c.format === 'live_race' ? `${icons.clock} Racing` : left > 36 * 3600e3 ? `${icons.clock} ${Math.round(left / 86400e3)} days left` : `${icons.clock} Ends ${timeText(c.endsAt)}`)
    : ph === 'soon' ? `${icons.clock} <span data-cd="${c.startsAt}">${countdown(c.startsAt - now)}</span>`
    : ph === 'upcoming' ? `${icons.events} ${esc(shortWhen(c.startsAt, now))}` : '';
  const dist = k.id === 'treasure' && c.clues ? `${icons.search} ${c.clues.length} clues` : k.id === 'location' ? `${icons.pin} 5 stops` : `${icons.bike} ${kmOf(c.route)}`;
  const people = c.riders > 0 ? `${icons.social} ${c.maxRiders >= 999 ? fmt(c.riders) : `${c.riders}/${c.maxRiders}`}` : c.maxRiders < 999 ? `${icons.social} Max ${c.maxRiders}` : `${icons.social} Open to all`;
  const action = ph === 'ended' || ph === 'cancelled' ? 'See results' : mine ? (ph === 'live' ? (c.format === 'live_race' ? 'Open lobby' : 'Ride now') : "You're in") : regOpen(c, now) ? k.cta : 'View Challenge';
  return `<button class="chx-pc ph-${ph}${mine ? ' is-mine' : ''}" data-chx-open="${esc(c.id)}">
    <span class="chx-pc-img" style="background-image:url('${photoOf(c)}')"><span class="chx-pc-badges">${badges}</span>${mine ? `<span class="chx-pc-in">${icons.check}</span>` : ''}</span>
    <span class="chx-pc-body">
      <b>${esc(c.name)}</b>
      <small>${esc(sub)}</small>
      <span class="chx-pc-stats"><span>${dist}</span><span>${people}</span>${when ? `<span>${when}</span>` : ''}</span>
      <span class="chx-pc-go">${action} ${icons.arrow}</span>
    </span>
  </button>`;
}

/** a compact row for day lists: 6:00 PM — Name · route */
export function chRow(c: Challenge, now = Date.now()) {
  const r = chRoute(c.route);
  return `<button class="chx-row${joined(c) ? ' is-mine' : ''}" data-chx-open="${esc(c.id)}">
    <span class="chx-time">${timeText(c.startsAt)}</span>
    ${fmtTile(c)}
    <span class="grow chx-name"><b>${esc(c.name)}</b><small>${esc(r?.name ?? '')} · ${esc(formatOf(c.format).name)}${c.entryFee ? ` · ${fmt(c.entryFee)} entry` : ''}${c.official ? '' : ` · ${ridersText(c)}`}</small></span>
    ${joined(c) ? `<span class="chx-in">${icons.check}</span>` : phaseOf(c, now) === 'soon' ? statusBadge(c, now) : ''}
  </button>`;
}

export const empty = (icon: string, title: string, text: string, action = '') =>
  `<div class="chx-empty"><span class="chx-empty-ico">${ic(icon)}</span><b>${title}</b><p class="muted small">${text}</p>${action}</div>`;

/** keeps every [data-cd] (counting down to) and [data-up] (counting up from) element ticking; returns a stop function */
export function ticker(root: HTMLElement, onZero?: () => void) {
  let fired = false;
  const tick = () => {
    const now = Date.now();
    root.querySelectorAll<HTMLElement>('[data-cd]').forEach((el) => {
      const ms = Number(el.dataset.cd) - now;
      if (ms <= 0) {
        el.textContent = el.dataset.zero ?? 'Starting now';
        if (!fired && onZero) { fired = true; setTimeout(onZero, 1500); }
      } else el.textContent = (el.dataset.prefix ?? '') + countdown(ms);
    });
    root.querySelectorAll<HTMLElement>('[data-up]').forEach((el) => (el.textContent = countdown(now - Number(el.dataset.up))));
  };
  tick();
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}

export async function copy(text: string, note: HTMLElement | null, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* shown below anyway */ }
    ta.remove();
  }
  if (note) { note.hidden = false; note.textContent = done; }
}

export const signedOutNote = () => (api.online() ? '' : `<p class="muted small">${icons.user} Sign in to create, join and post times in rider challenges. Official LEGONRUSH challenges work for everyone.</p>`);
