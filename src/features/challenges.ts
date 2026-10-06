// Daily and weekly challenges screen, with the streak bonus.
import { MISSIONS, STREAK_BONUS, WEEKLY_MISSIONS, claimMission, missionStreak, thisWeek, todayMissions, type Mission, type MissionDay } from '../state';
import { icons } from '../ui/icons';
import { sfx } from '../audio';
import { fx } from './icons';
import { H, bar, esc, fmt, on, screen } from './host';

const iconOf = (name: string) => (icons as Record<string, string>)[name] ?? icons.target;

function row(x: Mission, m: { claimed: string[] }, progress: number) {
  const got = Math.min(x.goal, progress);
  const done = got >= x.goal;
  const claimed = m.claimed.includes(x.id);
  return `<div class="fx-row${claimed ? ' claimed' : ''}">
    <span class="fx-ico">${iconOf(x.icon)}</span>
    <div class="grow"><b>${esc(x.title)}</b>${bar(got, x.goal)}<small class="muted">${x.unit ? got.toFixed(1) : fmt(got)} / ${fmt(x.goal)}${x.unit ? ' ' + x.unit : ''}</small></div>
    ${claimed ? `<span class="badge">${icons.check} Done</span>` : done ? `<button class="btn btn-primary btn-sm" data-claim="${x.id}">Claim +${fmt(x.reward)}</button>` : `<span class="fx-reward">${icons.coin} ${fmt(x.reward)}</span>`}
  </div>`;
}

/** time left until midnight, or until Monday for the weekly set */
function left(weekly: boolean) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (weekly ? 7 - ((now.getDay() + 6) % 7) : 1));
  const h = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 3600e3));
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h left` : `${h} h left`;
}

export function challengesScreen(back: () => void = () => H().home('you')) {
  const p = H().profile();
  const day = todayMissions(p);
  const week = thisWeek(p);
  const streak = missionStreak(p);
  const allToday = MISSIONS.every((x) => day.claimed.includes(x.id));
  const nextBonus = STREAK_BONUS * Math.min(7, allToday ? streak : streak + 1);
  screen(`
    <p class="kicker">${icons.target} Daily &amp; weekly goals</p>
    <h1 class="title">Daily &amp; weekly</h1>
    <div class="card fx-streak">
      <span class="fx-big-ico">${icons.flame}</span>
      <div class="grow"><b>${streak} day${streak === 1 ? '' : 's'} streak</b>
        <p class="muted small">${allToday ? `All done today. Come back tomorrow to keep it going.` : `Clear all three daily challenges for a streak bonus of <b>${fmt(nextBonus)}</b> coins. It grows every day in a row, up to ${fmt(STREAK_BONUS * 7)}.`}</p></div>
      <div class="fx-days">${Array.from({ length: 7 }, (_, i) => `<i class="${i < Math.min(7, streak) ? 'on' : ''}"></i>`).join('')}</div>
    </div>
    <div class="fx-head"><h2 class="shop-h">${fx.calendar} Today</h2><span class="muted small">${left(false)}</span></div>
    <div class="card fx-list">${MISSIONS.map((x) => row(x, day, x.progress(day))).join('')}</div>
    <div class="fx-head"><h2 class="shop-h">${icons.trophy} This week</h2><span class="muted small">${left(true)}</span></div>
    <div class="card fx-list">${WEEKLY_MISSIONS.map((x) => row(x, week, x.progress(week as unknown as MissionDay))).join('')}</div>
    <p class="muted small">Every ride counts. Near misses, jumps and treasure are counted as you ride; races and Explore trips count when you finish.</p>
  `, back);
  on('[data-claim]', 'click', (_, el) => {
    if (claimMission(p, el.dataset.claim!)) sfx.finish();
    challengesScreen(back);
  });
}
