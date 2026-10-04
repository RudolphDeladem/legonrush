// Rideable routes over the real campus road network.
import { PLACES, directions, findPath, nodeXZ, placeByName, ROADS, type Place, type PlaceKind, type RoadClass, type Step, type TravelMode } from './campusmap';
import { Track } from './track';
import type { RouteLabel } from './world';

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
export function routeThrough(stops: Place[], opts: { id: string; name: string; kind: RouteKind; difficulty?: number; mode?: TravelMode }): Route | null {
  const pts: [number, number][] = [];
  const tags: number[] = [];
  const steps: Step[] = [];
  let offset = 0;
  for (let k = 0; k < stops.length - 1; k++) {
    const path = findPath([stops[k].x, stops[k].z], [stops[k + 1].x, stops[k + 1].z], opts.mode);
    if (!path || path.nodes.length < 2) return null;
    const seg = path.nodes.map(nodeXZ);
    if (pts.length) seg.shift(); // shared node between legs
    pts.push(...seg);
    tags.push(...path.roads);
    const legSteps = directions(path, stops[k + 1].name).map((s) => ({ ...s, at: s.at + offset }));
    // between legs, "arrive" and the next "head ..." are not useful
    steps.push(...legSteps.filter((s, i) => (k === 0 || s.turn !== 'start') && (k === stops.length - 2 || s.turn !== 'arrive' || i !== legSteps.length - 1)));
    offset += path.length;
  }
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

  // label the places the route passes, nearest and most useful first, spaced out
  const near: (RouteLabel & { pr: number; dist: number })[] = [];
  for (const place of PLACES) {
    if (place.kind === 'transport' || place.kind === 'other' && !/hall|library|registry|mall/i.test(place.name)) continue;
    const pr = track.project(place.x, place.z);
    if (pr.dist > 55 || pr.d < LEAD + 5 || pr.d > track.length - TAIL) continue;
    near.push({ place, d: pr.d, pr: LABEL_PRIORITY[place.kind], dist: pr.dist });
  }
  near.sort((a, b) => a.pr - b.pr || a.dist - b.dist);
  const labels: RouteLabel[] = [];
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
