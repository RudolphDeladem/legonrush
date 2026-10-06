// "Latest from Campus": the news side of the Community feed. Every item is made from things that
// really exist in the game today (this week's Garage set, today's drop, today's challenges, the
// coming social events and well-known campus facts), so the feed is never empty and never invents news.
// Player posts from the server are mixed in by home.ts.
import { H } from '../host';
import { FACTS } from '../../data/facts';
import { rotation } from '../garage/rotation';
import { allEvents } from '../events/store';
import { officialSchedule, phaseOf, whenText } from '../challenges/model';

export type NewsCat = 'campus' | 'legonrush' | 'events' | 'sports';
export const NEWS_CATS: [NewsCat, string][] = [['campus', 'Campus'], ['legonrush', 'LEGONRUSH'], ['events', 'Events'], ['sports', 'Sports']];

export interface News {
  id: string;
  cat: NewsCat;
  title: string;
  text: string;
  /** public/photos/<photo>.webp */
  photo: string;
  /** when it happened, or when it starts (events) */
  at: number;
  /** "2h ago", or "Starts Today · 5:00 PM" */
  when?: string;
  author: string;
  /** what the card opens */
  go: () => void;
  goLabel: string;
}

const FACT_PHOTO: Record<string, string> = { balme: 'lm-balme', 'great-hall': 'lm-tower', 'night-market': 'ev-night' };
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function campusNews(now = Date.now()): News[] {
  const out: News[] = [];
  const today = dayStart(now);
  const day = Math.floor(today / 86400e3);

  // LEGONRUSH: the Garage
  const r = rotation(new Date(now));
  out.push({ id: `g-feat-${r.featured.id}`, cat: 'legonrush', title: `New in the Garage: ${r.featured.name}`, text: `This week's featured collection is in the Garage shop until ${r.featuredEnds.toLocaleDateString('en-GB', { weekday: 'long' })}. ${r.featured.blurb ?? ''}`.trim(), photo: 'garage', at: r.featuredEnds.getTime() - 7 * 86400e3, author: 'LEGONRUSH', go: () => H().home('store'), goLabel: 'Open the shop' });
  out.push({ id: `g-drop-${r.drop.id}-${day}`, cat: 'legonrush', title: `Today's drop: ${r.drop.name}`, text: 'Only in the Garage shop today. Tomorrow it is gone.', photo: 'mode-challenge', at: today + 60e3, author: 'LEGONRUSH', go: () => H().home('store'), goLabel: 'See the drop' });

  // challenges today and this week
  const ch = officialSchedule(now, 0, 7);
  const hunt = ch.find((c) => c.kind === 'treasure' && phaseOf(c, now) !== 'ended');
  if (hunt) out.push({ id: hunt.id, cat: 'legonrush', title: "Today's Treasure Hunt is live", text: `${hunt.clues?.length ?? 3} clues lead to one hidden place on campus. Work them out, then ride there as fast as you can.`, photo: 'sc-quiz', at: hunt.startsAt, author: 'LEGONRUSH', go: () => H().home('challenges'), goLabel: 'Start the hunt' });
  const inter = ch.find((c) => c.kind === 'interhall' && phaseOf(c, now) !== 'ended');
  if (inter) out.push({ id: inter.id, cat: 'sports', title: 'Inter-Hall Challenge: ride for your hall', text: 'Three tries today. Every time you post counts for your hall on the inter-hall board.', photo: 'halls', at: inter.startsAt, author: 'LEGONRUSH', go: () => H().home('challenges'), goLabel: 'Join in' });
  for (const c of ch.filter((x) => x.kind === 'weekly' || x.kind === 'hall').filter((x) => phaseOf(x, now) !== 'ended').slice(0, 2)) {
    out.push({ id: c.id, cat: 'sports', title: `${c.name}: ${whenText(c.startsAt, now)}`, text: c.description, photo: c.kind === 'hall' ? 'hall-tile' : 'race', at: Math.min(now - 3600e3, c.startsAt - 2 * 86400e3), when: `Starts ${whenText(c.startsAt, now)}`, author: 'LEGONRUSH', go: () => H().home('challenges'), goLabel: 'View challenge' });
  }

  // events coming up
  for (const e of allEvents().filter((x) => (x.activity === 'space' || x.activity === 'sunset') && !x.name.startsWith('Hall Wars') && x.end > now && x.start < now + 2 * 86400e3).sort((a, b) => a.start - b.start).slice(0, 3)) {
    out.push({ id: `ev-${e.key}`, cat: 'events', title: e.name, text: e.description, photo: e.cover || 'together', at: Math.min(now - 1800e3, e.start - 86400e3), when: e.start <= now ? 'Happening now' : `Starts ${whenText(e.start, now)}`, author: 'LEGONRUSH Events', go: () => H().home('events'), goLabel: 'See the event' });
  }

  // campus: three facts a day
  for (let k = 0; k < 3; k++) {
    const f = FACTS[(day * 3 + k) % FACTS.length];
    out.push({ id: `fact-${f.id}-${day}`, cat: 'campus', title: `Did you know? ${f.title}`, text: f.text, photo: FACT_PHOTO[f.id] ?? (/Hall/.test(f.place) ? 'lm-hall' : 'lm-aerial'), at: today + (k + 1) * 3 * 3600e3 - 86400e3, author: 'Campus guide', go: () => H().home('map'), goLabel: 'Find it on the map' });
  }
  return out.sort((a, b) => b.at - a.at);
}

// likes on news are this phone's own
const KEY = 'legonrush.news.likes.v1';
let likes: Set<string> | null = null;
function liked(): Set<string> {
  if (!likes) { try { likes = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { likes = new Set(); } }
  return likes;
}
export const isLiked = (id: string) => liked().has(id);
export function toggleLike(id: string) {
  const s = liked();
  if (s.has(id)) s.delete(id); else s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-300))); } catch { /* fine */ }
  return s.has(id);
}
