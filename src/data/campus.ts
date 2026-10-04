// Campus data for the prototype. Positions are approximate placeholders:
// landmarks are boxes placed along one straight route until the layout is
// traced from Google Maps.

export interface Hall {
  id: string;
  name: string;
  short: string;
  color: string;
}

// Halls of residence at the University of Ghana, Legon.
// Colors are placeholders for the in-game jersey, not official hall colors.
export const HALLS: Hall[] = [
  { id: 'legon', name: 'Legon Hall', short: 'Legon', color: '#d64545' },
  { id: 'akuafo', name: 'Akuafo Hall', short: 'Akuafo', color: '#2f8f4e' },
  { id: 'commonwealth', name: 'Commonwealth Hall', short: 'Vandals', color: '#7a3db8' },
  { id: 'volta', name: 'Volta Hall', short: 'Volta', color: '#2b74d6' },
  { id: 'sarbah', name: 'Mensah Sarbah Hall', short: 'Sarbah', color: '#e08a1e' },
  { id: 'jean-nelson', name: 'Jean Nelson Aka Hall', short: 'JNA', color: '#16a3a3' },
  { id: 'kwapong', name: 'Alexander Kwapong Hall', short: 'Kwapong', color: '#c23b8a' },
  { id: 'sey', name: 'Elizabeth Frances Sey Hall', short: 'Sey', color: '#8a9a1c' },
  { id: 'limann', name: 'Hilla Limann Hall', short: 'Limann', color: '#5560e0' },
  { id: 'none', name: 'Non-resident', short: 'NR', color: '#8a8f99' },
];

export const hallById = (id: string) => HALLS.find((h) => h.id === id) ?? HALLS[HALLS.length - 1];

export type LandmarkKind = 'hall' | 'academic' | 'landmark' | 'gate';

export interface Landmark {
  name: string;
  kind: LandmarkKind;
  /** metres from the start of the route */
  at: number;
  /** -1 = left of the road, 1 = right */
  side: -1 | 1;
  /** width (along road), height, depth (away from road) in metres */
  size: [number, number, number];
  /** distance of the near face from the road centre */
  setback?: number;
}

export interface Route {
  id: string;
  name: string;
  length: number;
  difficulty: number;
  reward: number;
  available: boolean;
  landmarks: Landmark[];
}

export const CAMPUS_LOOP: Route = {
  id: 'campus-loop',
  name: 'Campus Loop',
  length: 2800,
  difficulty: 2,
  reward: 250,
  available: true,
  landmarks: [
    { name: 'Main Gate', kind: 'gate', at: 40, side: 1, size: [0, 0, 0] },
    { name: 'Commonwealth Hall', kind: 'hall', at: 220, side: -1, size: [70, 16, 34] },
    { name: 'Great Hall', kind: 'landmark', at: 340, side: -1, size: [40, 22, 30], setback: 60 },
    { name: 'Legon Hall', kind: 'hall', at: 520, side: 1, size: [80, 14, 40] },
    { name: 'Balme Library', kind: 'academic', at: 760, side: -1, size: [46, 20, 30] },
    { name: 'Akuafo Hall', kind: 'hall', at: 980, side: 1, size: [80, 12, 40] },
    { name: 'JQB', kind: 'academic', at: 1220, side: -1, size: [60, 18, 26] },
    { name: 'Volta Hall', kind: 'hall', at: 1450, side: 1, size: [60, 13, 32] },
    { name: 'Mensah Sarbah Hall', kind: 'hall', at: 1700, side: -1, size: [80, 14, 40] },
    { name: 'Night Market', kind: 'landmark', at: 1900, side: 1, size: [50, 5, 24] },
    { name: 'UGBS', kind: 'academic', at: 2120, side: -1, size: [56, 18, 28] },
    { name: 'Jean Nelson Aka Hall', kind: 'hall', at: 2340, side: 1, size: [44, 24, 30] },
    { name: 'Alexander Kwapong Hall', kind: 'hall', at: 2420, side: -1, size: [44, 24, 30] },
    { name: 'Elizabeth Frances Sey Hall', kind: 'hall', at: 2560, side: 1, size: [44, 24, 30] },
    { name: 'Hilla Limann Hall', kind: 'hall', at: 2640, side: -1, size: [44, 24, 30] },
  ],
};

export const ROUTES: Route[] = [
  CAMPUS_LOOP,
  { id: 'engineering-run', name: 'Engineering Run', length: 3600, difficulty: 3, reward: 350, available: false, landmarks: [] },
  { id: 'sunset-route', name: 'Sunset Route', length: 4200, difficulty: 3, reward: 450, available: false, landmarks: [] },
  { id: 'night-circuit', name: 'Night Circuit', length: 3100, difficulty: 4, reward: 400, available: false, landmarks: [] },
];

export interface BikeSpec {
  id: string;
  name: string;
  tagline: string;
  speed: number;
  acceleration: number;
  handling: number;
  color: string;
}

export const BIKES: BikeSpec[] = [
  { id: 'city', name: 'City', tagline: 'Balanced', speed: 3, acceleration: 4, handling: 4, color: '#f2c230' },
  { id: 'speed', name: 'Speed', tagline: 'Fast', speed: 5, acceleration: 3, handling: 3, color: '#e04848' },
  { id: 'cruiser', name: 'Cruiser', tagline: 'Stable', speed: 2, acceleration: 4, handling: 5, color: '#3bb6e8' },
];

export const bikeById = (id: string) => BIKES.find((b) => b.id === id) ?? BIKES[0];
