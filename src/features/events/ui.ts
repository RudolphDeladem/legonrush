// Pieces of event UI shared by the tab, the detail page and the wizard preview.
import { esc, fmt } from '../host';
import { icons } from '../../ui/icons';
import type { CampusEvent, SeriesInfo, Status } from './types';
import { STATUS_LABEL, now, statusOf, whenText, countdown } from './schedule';
import { TYPES, coverUrl, placeLabel } from './catalog';
import { rewardText } from './store';

export function statusBadge(s: Status) {
  return `<span class="ev-badge ${s}">${s === 'live' || s === 'ending' ? '<i></i>' : ''}${STATUS_LABEL[s]}</span>`;
}
export const officialBadge = (small = false) => `<span class="ev-official${small ? ' sm' : ''}">${icons.shield}${small ? 'Official' : 'Official LEGONRUSH'}</span>`;

export function feeHtml(e: CampusEvent) {
  return e.fee ? `<span class="ev-fee">${icons.coin} ${fmt(e.fee)} to join</span>` : `<span class="ev-fee free">Free</span>`;
}
/** the headline reward, short */
export function topReward(e: CampusEvent) {
  const r = e.rewards.winner ?? e.rewards.done;
  if (!r) return '';
  if (r.diamonds) return `${icons.diamond} ${r.diamonds}${r.coins ? ` + ${icons.coin} ${fmt(r.coins)}` : ''}`;
  if (r.coins) return `${icons.coin} ${fmt(r.coins)}`;
  if (r.items?.length) return `${icons.gift} Item`;
  if (r.xp) return `${icons.star} ${r.xp} XP`;
  return '';
}

export function eventCard(e: CampusEvent, opts: { joined?: boolean; wide?: boolean } = {}) {
  const st = statusOf(e);
  const t = TYPES[e.type];
  const reward = topReward(e);
  const soon = st === 'soon' ? ` · in ${countdown(e.start - now())}` : st === 'live' || st === 'ending' ? ` · ends in ${countdown(e.end - now())}` : '';
  return `<button class="ev-card${opts.wide ? ' wide' : ''}${st === 'completed' || st === 'cancelled' ? ' past' : ''}" data-ev="${esc(e.key)}">
    <span class="ev-cover" style="background-image:url('${coverUrl(e.cover)}')">
      ${statusBadge(st)}
      ${e.source !== 'community' ? officialBadge(true) : ''}
      ${opts.joined ? `<span class="ev-joined-tag">${icons.check} Joined</span>` : ''}
    </span>
    <span class="ev-body">
      <span class="ev-type">${t.icon}${esc(t.label)}${e.series ? ` · Day ${e.series.day} of ${e.series.of}` : ''}</span>
      <b class="ev-name">${esc(e.name)}</b>
      <span class="ev-meta">${icons.pin}${esc(placeLabel(e.place))}</span>
      <span class="ev-meta">${icons.clock}${esc(whenText(e))}${soon}</span>
      <span class="ev-foot">
        ${e.joinedCount !== undefined && e.joinedCount > 0 ? (e.capacity && e.joinedCount >= e.capacity ? `<span class="ev-count-pill full">${icons.users} Full · ${fmt(e.capacity)}</span>` : `<span class="ev-count-pill">${icons.users} ${fmt(e.joinedCount)}${e.capacity ? ` / ${fmt(e.capacity)}` : ''} joined</span>`) : ''}
        ${feeHtml(e)}
        ${reward ? `<span class="ev-reward">${icons.trophy} ${reward}</span>` : ''}
      </span>
    </span>
  </button>`;
}

export function seriesCard(s: SeriesInfo) {
  const t = now();
  const today = s.days.find((d) => d.start <= t + 86400e3 && d.end > t);
  const live = t >= s.start && t < s.end;
  return `<button class="ev-series" data-series="${esc(s.id)}">
    <span class="ev-cover" style="background-image:url('${coverUrl(s.cover)}')">${live ? statusBadge('live') : statusBadge(t < s.start ? 'upcoming' : 'completed')}${officialBadge(true)}</span>
    <span class="ev-body">
      <span class="ev-type">${icons.events}Event series · ${s.days.length} ${s.days.length === 1 ? 'day' : 'days'}</span>
      <b class="ev-name">${esc(s.name)}</b>
      <span class="ev-meta">${icons.clock}${esc(new Date(s.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}${s.days.length > 1 ? ` to ${esc(new Date(s.end - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}` : ''}</span>
      <span class="ev-meta">${icons.sparkle}${esc(today ? `${live ? 'Today' : 'Next'}: ${today.name}` : s.blurb)}</span>
    </span>
  </button>`;
}

export const rewardsList = (e: CampusEvent) => {
  const r = e.rewards;
  const rows: [string, string][] = [];
  if (r.join && rewardText(r.join)) rows.push(['For taking part', rewardText(r.join)]);
  if (r.done && rewardText(r.done)) rows.push([e.activity === 'space' ? 'For joining in (play a game or stay a while)' : 'For completing it', rewardText(r.done)]);
  if (r.winner && rewardText(r.winner)) rows.push(['Winner', rewardText(r.winner)]);
  if (r.top3 && rewardText(r.top3)) rows.push(['Top 3', rewardText(r.top3)]);
  if (r.hall) rows.push(['Your hall', `+${r.hall} hall points`]);
  return rows;
};

export const emptyHtml = (title: string, text: string, icon = icons.events) => `<div class="ev-empty-card"><span class="ev-empty-ico">${icon}</span><b>${esc(title)}</b><p class="muted small">${esc(text)}</p></div>`;
