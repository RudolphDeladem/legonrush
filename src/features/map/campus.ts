// University -> campus -> map. Every campus the map can show is one CampusMap; the Map tab,
// its search, collection and routes only ever talk to this interface, so adding KNUST or UCC
// later means adding their map data and one entry in MAPS below, not rewriting the tab.
import {
  ALIASES, AREAS, ATTRIBUTION, BUILDINGS, NODE_XZ, PLACES, ROADS, directions, findPath, mapBounds, placeByName, searchPlaces, toLatLng,
  type Area, type Building, type Place, type PlaceKind, type PlaceMatch, type Road, type Step, type TravelMode,
} from '../../game/campusmap';
import { HALLS, HALL_PLACE } from '../../data/campus';
import { FACTS } from '../../data/facts';
import { CAMPUSES, type Campus } from '../../data/campuses';

export interface MapHall { id: string; name: string; short: string; color: string; place: Place }

/** a group of places in the campus collection */
export interface CollectionGroup {
  id: string;
  name: string;
  /** icon key from ui/icons */
  icon: string;
  places: Place[];
  /** shown on the map as "?" until reached */
  hidden?: boolean;
}

export interface CampusMap {
  campus: Campus;
  /** "University of Ghana — Legon" */
  title: string;
  attribution: string;
  places: Place[];
  roads: Road[];
  /** road graph node positions: x, z pairs in metres (+x east, +z south) */
  nodes: Float32Array;
  buildings: Building[];
  areas: Area[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** where a new rider is shown when nothing better is known */
  start: Place;
  placeByName: (name: string) => Place | undefined;
  search: (q: string, limit?: number) => PlaceMatch[];
  /** nicknames students use: nickname -> place name */
  aliases: Record<string, string>;
  toLatLng: (x: number, z: number) => [number, number];
  fromLatLng: (lat: number, lng: number) => [number, number];
  halls: MapHall[];
  /** the place for a rider's hall id */
  hallPlace: (hallId: string) => Place | undefined;
  /** short facts for landmarks */
  fact: (place: string) => { title: string; text: string } | undefined;
  /** a photo in public/photos for the place, if there is one */
  photo: (place: string) => string | undefined;
  collection: CollectionGroup[];
  /** shortest way and turn-by-turn steps between two points */
  path: (from: [number, number], to: [number, number], mode?: TravelMode, destination?: string) => { points: [number, number][]; length: number; steps: Step[] } | null;
}

// ---------- Legon ----------

const must = (names: string[]) => names.map((n) => placeByName(n)).filter((p): p is Place => !!p);

/** places that count for the Legon campus collection (all real places on the OSM map) */
const LEGON_COLLECTION: (Omit<CollectionGroup, 'places'> & { names: string[] })[] = [
  { id: 'landmarks', name: 'Landmarks', icon: 'star', names: ['The Balme Library', 'Great Hall', 'Legon Main Entrance', 'Night Market', 'Kuffour Quadrangle', 'University of Ghana Registry', 'University of Ghana Hospital', 'Central Cafeteria, CC', 'Sports Complex', 'Athletic Oval', 'University of Ghana Botanical Gardens', 'SRC Union Building', 'Noguchi Memorial Institute for Medical Research', 'Radio Univers'] },
  { id: 'halls', name: 'Halls and hostels', icon: 'bed', names: [...Object.values(HALL_PLACE), 'Pent Hostel Block A', 'International Students Hostel 1, ISH 1', 'Valco Trust Hostel Phase 1', 'Bani Hostel', 'TF Hostel', 'Evandy Hostel', 'Jubilee Hall', 'James Topp Nelson Yankah Hall'] },
  { id: 'faculties', name: 'Faculties and schools', icon: 'grad', names: ['School of Engineering Sciences', 'Jones Quartey Building, JQB', 'New N Block, NNB', 'University of Ghana Business School', 'School of Law', 'K. A. Busia Building, KAB', 'School of Performing Arts', 'Department of Economics, University of Ghana', 'Graduate School, Legon', 'Science Resource Centre', 'Computer Science Dept', 'Physics Department, University of Ghana', 'Department of Music', 'School of Public Health', 'Institute of Africa Studies', 'ISSER Building', 'GCB Lecture Building'] },
  { id: 'food', name: 'Food and sport', icon: 'food', names: ['Bush Canteen (near Department of Music)', 'Pent Food Court', 'Volta Café', 'Commonwealth Dinning hall', 'Mensah Sarbah Dining Hall', 'Library Pub', 'Sarbah field', 'UG Gymnasium', 'University of Ghana Sports Directorate'] },
  { id: 'hidden', name: 'Hidden spots', icon: 'search', hidden: true, names: ['Balme Library Fountain', 'Amphitheatre Grounds', 'Bacchus Garden', 'J.H. Kwabena Nketia Archives', 'Ghana Dance Ensemble', 'Museum of Archaelogy', 'Legon Post Office', 'Commonwealth Hall Library'] },
];

const PHOTOS: Record<string, string> = {
  'The Balme Library': 'lm-balme',
  'Legon Main Entrance': 'lm-gate',
  'Great Hall': 'lm-tower',
};

// latitude/longitude back to map metres, from two points of the forward projection
const [LAT0, LNG0] = toLatLng(0, 0);
const [LAT1, LNG1] = toLatLng(1000, 1000);
const fromLatLngLegon = (lat: number, lng: number): [number, number] => [((lng - LNG0) / (LNG1 - LNG0)) * 1000, ((lat - LAT0) / (LAT1 - LAT0)) * 1000];

let legon: CampusMap | null = null;
function legonMap(): CampusMap {
  if (legon) return legon;
  const halls: MapHall[] = HALLS.filter((h) => HALL_PLACE[h.id]).flatMap((h) => {
    const place = placeByName(HALL_PLACE[h.id]);
    return place ? [{ id: h.id, name: h.name, short: h.short, color: h.color, place }] : [];
  });
  legon = {
    campus: CAMPUSES.find((c) => c.id === 'ug')!,
    title: 'University of Ghana — Legon',
    attribution: ATTRIBUTION,
    places: PLACES,
    roads: ROADS,
    nodes: NODE_XZ,
    buildings: BUILDINGS,
    areas: AREAS,
    bounds: mapBounds(),
    start: placeByName('Legon Main Entrance') ?? PLACES[0],
    placeByName,
    search: searchPlaces,
    aliases: ALIASES,
    toLatLng,
    fromLatLng: fromLatLngLegon,
    halls,
    hallPlace: (id) => placeByName(HALL_PLACE[id] ?? ''),
    fact: (name) => FACTS.find((f) => f.place === name),
    photo: (name) => (PHOTOS[name] ? `${import.meta.env.BASE_URL}photos/${PHOTOS[name]}.webp` : undefined),
    collection: LEGON_COLLECTION.map(({ names, ...g }) => ({ ...g, places: must(names) })),
    path: (from, to, mode = 'cycle', dest = '') => {
      const r = findPath(from, to, mode);
      if (!r) return null;
      const points = r.nodes.map((i): [number, number] => [NODE_XZ[i * 2], NODE_XZ[i * 2 + 1]]);
      return { points, length: r.length, steps: directions(r, dest) };
    },
  };
  return legon;
}

/** campus id -> its map; campuses without one show as "coming soon" */
const MAPS: Record<string, () => CampusMap> = {
  ug: legonMap,
};

export const hasMap = (campusId: string) => !!MAPS[campusId];
/** the campus map for a campus id, falling back to Legon */
export const campusMap = (campusId: string): CampusMap => (MAPS[campusId] ?? MAPS.ug)();

// ---------- shared helpers ----------

export const KIND_LABEL: Record<PlaceKind, string> = {
  hall: 'Hall of residence', academic: 'Faculty or department', landmark: 'Landmark', food: 'Food', bank: 'Bank',
  transport: 'Bus stop', worship: 'Place of worship', sport: 'Sport', health: 'Health', other: 'Place',
};
export const KIND_ICON: Record<PlaceKind, string> = {
  hall: 'bed', academic: 'grad', landmark: 'star', food: 'food', bank: 'bank', transport: 'bus', worship: 'church', sport: 'ball', health: 'health', other: 'pin',
};
/** the short form of a long OSM name, for labels */
export const shortName = (name: string) => name.replace(/ \(.*\)$/, '').replace(/^The /, '').replace(/, University of Ghana$/, '').replace(/, Legon$/, '');

export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
export const distText = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
/** cycling minutes at an easy 16 km/h */
export const rideMins = (m: number) => Math.max(1, Math.round(m / 270));

/** nearest named place of the useful kinds */
export function nearestPlace(map: CampusMap, x: number, z: number, kinds?: PlaceKind[], skip?: (p: Place) => boolean): Place {
  let best = map.start, d = Infinity;
  for (const p of map.places) {
    if (kinds && !kinds.includes(p.kind)) continue;
    if (skip?.(p)) continue;
    if (p.kind === 'other' || p.kind === 'transport') continue;
    const e = Math.hypot(p.x - x, p.z - z);
    if (e < d) { d = e; best = p; }
  }
  return best;
}
