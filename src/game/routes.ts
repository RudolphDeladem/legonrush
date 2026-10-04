// Rideable routes over the real campus road network.
import { PLACES, directions, findPath, nodeXZ, placeByName, ROADS, type Place, type PlaceKind, type RoadClass, type Step, type TravelMode } from './campusmap';
import { Track } from './track';
import type { RouteLabel } from './world';
import type { TimeOfDay } from './Game';

export type RouteKind = 'race' | 'explore';

export interface RideStep extends Step {
  /** ride distance (from the start line) where the step happens */
  d: number;
}

export interface Route {
  id: string;
  name: string;
  kind: RouteKind;
  mode: TravelMode;
  /** rideable length in metres, start line to finish line */
  length: number;
  difficulty: number;
  /** lighting for the ride; day when unset */
  time?: TimeOfDay;
  track: Track;
  /** track metres before the start line and after the finish line */
  lead: number;
  tail: number;
  steps: RideStep[];
  labels: RouteLabel[];
  from: Place;
  to: Place;
  /** road class under ride distance d */
  classAt: (d: number) => RoadClass;
}

const LEAD = 25;
const TAIL = 40;
const LABEL_PRIORITY: Record<PlaceKind, number> = { landmark: 0, hall: 1, academic: 2, food: 3, sport: 3, health: 4, bank: 5, worship: 5, transport: 6, other: 7 };

/** Builds a ride along the shortest real way through the given places, in order. */
export function routeThrough(stops: Place[], opts: { id: string; name: string; kind: RouteKind; difficulty?: number; mode?: TravelMode; time?: TimeOfDay }): Route | null {
  const nodes: number[] = [];
  const roads: number[] = [];
  for (let k = 0; k < stops.length - 1; k++) {
    const path = findPath([stops[k].x, stops[k].z], [stops[k + 1].x, stops[k + 1].z], opts.mode);
    if (!path || path.nodes.length < 2) return null;
    nodes.push(...(nodes.length ? path.nodes.slice(1) : path.nodes)); // legs share their end node
    roads.push(...path.roads);
  }
  // a stop at the end of a side road would mean riding in and turning back: ride past it instead
  for (let i = 1; i < nodes.length - 1; ) {
    if (nodes[i - 1] === nodes[i + 1]) {
      nodes.splice(i, 2);
      roads.splice(i - 1, 2);
      i = Math.max(1, i - 1);
    } else i++;
  }
  if (nodes.length < 2) return null;
  const pts = nodes.map(nodeXZ);
  const tags = roads;
  let pathLength = 0;
  for (let k = 0; k < pts.length - 1; k++) pathLength += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
  const steps: Step[] = directions({ nodes, roads, length: pathLength }, stops[stops.length - 1].name);
  // straight run-up before the start line and run-out after the finish line
  const ext = (a: [number, number], b: [number, number], len: number): [number, number] => {
    const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1;
    return [a[0] + (dx / l) * len, a[1] + (dz / l) * len];
  };
  const first = pts[0], last = pts[pts.length - 1];
  const all = [ext(first, pts[1], LEAD), ...pts, ext(last, pts[pts.length - 2], TAIL)];
  const allTags = [tags[0], ...tags, tags[tags.length - 1], tags[tags.length - 1]];
  const track = new Track(all, allTags);
  const length = Math.round(track.length - LEAD - TAIL);
  const rideD = (x: number, z: number) => Math.max(0, Math.min(length, track.project(x, z).d - LEAD));
  const rideSteps: RideStep[] = steps.map((s) => ({ ...s, d: s.turn === 'start' ? 0 : s.turn === 'arrive' ? length : rideD(s.x, s.z) }));
  // tours: announce each stop on the way
  stops.slice(1, -1).forEach((stop, k) => {
    const d = rideD(stop.x, stop.z);
    rideSteps.push({ turn: 'stop', text: `Stop ${k + 1}: ${stop.name}`, at: d, x: stop.x, z: stop.z, d });
  });
  rideSteps.sort((a, b) => a.d - b.d || (a.turn === 'start' ? -1 : b.turn === 'start' ? 1 : 0));

  // label the places the route passes, nearest and most useful first, spaced out
  const near: (RouteLabel & { pr: number; dist: number })[] = [];
  for (const place of PLACES) {
    if (place.kind === 'transport' || place.kind === 'other' && !/hall|library|registry|mall/i.test(place.name)) continue;
    const pr = track.project(place.x, place.z);
    if (pr.dist > 55 || pr.d < LEAD + 5 || pr.d > track.length - TAIL) continue;
    near.push({ place, d: pr.d, pr: LABEL_PRIORITY[place.kind], dist: pr.dist });
  }
  near.sort((a, b) => a.pr - b.pr || a.dist - b.dist);
  const labels: RouteLabel[] = stops.slice(1, -1).map((place) => ({ place, d: track.project(place.x, place.z).d }));
  for (const n of near) {
    if (n.place === stops[stops.length - 1]) continue;
    if (labels.some((l) => Math.abs(l.d - n.d) < 45 || l.place.name === n.place.name)) continue;
    labels.push({ place: n.place, d: n.d });
    if (labels.length >= 40) break;
  }

  return {
    ...opts,
    mode: opts.mode ?? 'cycle',
    difficulty: opts.difficulty ?? 2,
    length,
    track,
    lead: LEAD,
    tail: TAIL,
    steps: rideSteps,
    labels,
    from: stops[0],
    to: stops[stops.length - 1],
    classAt: (d: number) => ROADS[track.tagAt(d + LEAD)]?.cls ?? 2,
  };
}

/** Explore: the real shortest way from one place to another. */
export const exploreRoute = (from: Place, to: Place, mode: TravelMode = 'cycle') =>
  routeThrough([from, to], { id: 'explore', name: `${from.name} to ${to.name}`, kind: 'explore', difficulty: 1, mode });

const must = (name: string) => {
  const p = placeByName(name);
  if (!p) throw new Error(`missing place ${name}`);
  return p;
};

/** Quick Ride: from Hilla Limann Hall in the south, past Sarbah and Legon Hall, up to the Great Hall. */
export const CAMPUS_LOOP = routeThrough([must('Dr. Hilla Limann Hall'), must('Great Hall')], { id: 'limann-great-hall', name: 'Limann to Great Hall', kind: 'race' })!;

/** The places a new student needs in week one, in an order that rides as one loop up to the Great Hall. */
export const TOUR_STOPS = ['Night Market', 'Central Cafeteria, CC', 'Jones Quartey Building, JQB', 'The Balme Library', 'University of Ghana Business School', 'University of Ghana Registry', 'Great Hall'];
let tour: Route | null = null;
/** Freshers' Tour, built the first time it is asked for. */
export function freshersTour() {
  tour ??= routeThrough(TOUR_STOPS.map(must), { id: 'freshers-tour', name: "Freshers' Tour", kind: 'explore', difficulty: 1 });
  return tour!;
}

export interface RaceDef {
  id: string;
  name: string;
  blurb: string;
  stops: string[];
  difficulty: number;
  time: TimeOfDay;
  /** player level that opens the race */
  level: number;
}

/** Races on real campus roads, opened one by one as the player levels up. */
export const RACES: RaceDef[] = [
  { id: 'engineering-run', name: 'Engineering Run', blurb: 'Limann Hall, out past the Main Gate, to the School of Engineering Sciences.', stops: ['Dr. Hilla Limann Hall', 'Legon Main Entrance', 'School of Engineering Sciences'], difficulty: 3, time: 'day', level: 1 },
  { id: 'sunset-route', name: 'Sunset Route', blurb: 'Commonwealth Hall past the Athletic Oval and the Night Market to the Sports Complex, at golden hour.', stops: ['Commonwealth Hall', 'Athletic Oval', 'Night Market', 'Sports Complex'], difficulty: 3, time: 'sunset', level: 2 },
  { id: 'night-circuit', name: 'Night Circuit', blurb: 'From the Sports Complex through the Night Market and Bush Canteen to Legon Hospital, after dark.', stops: ['Sports Complex', 'Night Market', 'Bush Canteen (near Department of Music)', 'University of Ghana Hospital'], difficulty: 4, time: 'night', level: 3 },
];

const races = new Map<string, Route>();
/** A race's route, built the first time it is asked for. */
export function raceRoute(def: RaceDef) {
  if (!races.has(def.id)) races.set(def.id, routeThrough(def.stops.map(must), { id: def.id, name: def.name, kind: 'race', difficulty: def.difficulty, time: def.time })!);
  return races.get(def.id)!;
}

export { EVENTS, eventStatus, type EventDef } from '../data/events';
