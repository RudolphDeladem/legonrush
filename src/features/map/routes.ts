// Official LEGONRUSH cycling routes for the map's Routes layer: the races and tour the game
// already has, plus a few named campus routes. Routes are built the first time they are drawn.
import { CAMPUS_LOOP, RACES, freshersTour, raceRoute, routeThrough, type Route } from '../../game/routes';
import { placeByName, type Place } from '../../game/campusmap';
import type { TimeOfDay } from '../../game/Game';

export interface MapRoute {
  id: string;
  name: string;
  blurb: string;
  difficulty: number;
  time: TimeOfDay;
  /** player level that opens it (races) */
  level: number;
  color: string;
  stops: string[];
  route: () => Route | null;
}

/** named routes beyond the races: real roads between real places */
const EXTRA: { id: string; name: string; blurb: string; stops: string[]; difficulty: number; time: TimeOfDay; color: string }[] = [
  { id: 'main-gate-sprint', name: 'Main Gate Sprint', blurb: 'In through the Main Gate and straight up to the Balme Library.', stops: ['Legon Main Entrance', 'The Balme Library'], difficulty: 2, time: 'day', color: '#e8710a' },
  { id: 'hall-loop', name: 'Hall Loop', blurb: 'The traditional halls one after another: Volta, Commonwealth, Akuafo, Legon and Sarbah.', stops: ['Volta Hall', 'Commonwealth Hall', 'Akuafo Hall Main', 'Legon Hall', 'Mensah Sarbah Hall'], difficulty: 2, time: 'day', color: '#c23b8a' },
  { id: 'legon-hill', name: 'Legon Hill', blurb: 'From the Night Market up the hill to the Great Hall.', stops: ['Night Market', 'Great Hall'], difficulty: 3, time: 'sunset', color: '#7a4fb3' },
  { id: 'botanical-ride', name: 'Botanical Ride', blurb: 'From the Sports Complex out to the Botanical Gardens.', stops: ['Sports Complex', 'University of Ghana Botanical Gardens'], difficulty: 2, time: 'day', color: '#2f7d32' },
];

const cache = new Map<string, Route | null>();
const once = (id: string, make: () => Route | null) => () => {
  if (!cache.has(id)) {
    try { cache.set(id, make()); } catch { cache.set(id, null); }
  }
  return cache.get(id)!;
};

export const MAP_ROUTES: MapRoute[] = [
  { id: CAMPUS_LOOP.id, name: CAMPUS_LOOP.name, blurb: 'The Quick Ride: from Hilla Limann Hall past Sarbah and Legon Hall up to the Great Hall.', difficulty: CAMPUS_LOOP.difficulty, time: 'day', level: 1, color: '#1a73e8', stops: [CAMPUS_LOOP.from.name, CAMPUS_LOOP.to.name], route: () => CAMPUS_LOOP },
  { id: 'freshers-tour', name: "Freshers' Tour", blurb: 'The places you need in week one, in one easy ride.', difficulty: 1, time: 'day', level: 1, color: '#0f9d8a', stops: [], route: once('freshers-tour', freshersTour) },
  ...RACES.map((r): MapRoute => ({ id: r.id, name: r.name, blurb: r.blurb, difficulty: r.difficulty, time: r.time, level: r.level, color: r.time === 'night' ? '#3949ab' : r.time === 'sunset' ? '#e8710a' : '#d93025', stops: r.stops, route: once(r.id, () => raceRoute(r)) })),
  ...EXTRA.map((r): MapRoute => ({
    ...r, level: 1,
    route: once(r.id, () => {
      const stops = r.stops.map((n) => placeByName(n)).filter((p): p is Place => !!p);
      return stops.length === r.stops.length ? routeThrough(stops, { id: r.id, name: r.name, kind: 'race', difficulty: r.difficulty, time: r.time }) : null;
    }),
  })),
];

/** the route's line on the map, every ~8 m, start line to finish line */
const lines = new Map<string, [number, number][]>();
export function routeLine(r: MapRoute): [number, number][] {
  let l = lines.get(r.id);
  if (l) return l;
  const route = r.route();
  if (!route) return [];
  const all = route.track.outline(8) as [number, number][];
  // drop the run-up and run-out
  const step = route.track.length / Math.max(1, all.length - 1);
  const a = Math.round(route.lead / step), b = all.length - Math.round(route.tail / step);
  l = all.slice(a, Math.max(a + 2, b));
  lines.set(r.id, l);
  return l;
}
