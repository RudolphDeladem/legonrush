// Daily timed events. Kept free of map data so the landing page can show live status cheaply.

export interface EventDef {
  id: string;
  name: string;
  icon: string;
  /** the race ridden during the event */
  race: string;
  /** daily window in local hours; `to` may be past midnight */
  from: number;
  to: number;
  /** garage bike won by finishing it while live */
  prize: string;
  blurb: string;
}

/** Daily timed events: 2x coins on their race, and a bike for finishing while they are live. */
export const EVENTS: EventDef[] = [
  { id: 'sunset-rush', name: 'Sunset Rush', icon: '🌅', race: 'sunset-route', from: 17, to: 19, prize: 'sunset', blurb: 'Golden hour on the Sunset Route, every day from 5 to 7 pm.' },
  { id: 'night-rush', name: 'Night Rush', icon: '🌙', race: 'night-circuit', from: 19, to: 5, prize: 'neon', blurb: 'The Night Circuit after dark, every night from 7 pm to 5 am.' },
];

const at = (base: Date, hour: number, dayOffset = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour);

/** Whether an event is on now, when it ends, and when it next starts. */
export function eventStatus(e: EventDef, now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  const live = e.from < e.to ? h >= e.from && h < e.to : h >= e.from || h < e.to;
  const ends = live ? (e.from < e.to || h >= e.from ? at(now, e.to, e.from < e.to ? 0 : 1) : at(now, e.to)) : null;
  const next = h < e.from ? at(now, e.from) : at(now, e.from, 1);
  return { live, ends, next };
}
