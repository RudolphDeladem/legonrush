// Halls and bikes. The campus itself (roads, buildings, places) comes from
// OpenStreetMap: see game/campusmap.ts.

export interface Hall {
  id: string;
  name: string;
  short: string;
  color: string;
}

// Halls of residence at the University of Ghana, Legon.
// Jersey colours: Commonwealth (red), Akuafo (green and yellow), Volta (blue and yellow)
// and Sarbah (dark blue) follow the halls' own colours; the rest are placeholders until
// DELA confirms them.
export const HALLS: Hall[] = [
  { id: 'legon', name: 'Legon Hall', short: 'Legon', color: '#e08a1e' },
  { id: 'akuafo', name: 'Akuafo Hall', short: 'Akuafo', color: '#2e8b3a' },
  { id: 'commonwealth', name: 'Commonwealth Hall', short: 'Vandals', color: '#c8102e' },
  { id: 'volta', name: 'Volta Hall', short: 'Volta', color: '#1f3a93' },
  { id: 'sarbah', name: 'Mensah Sarbah Hall', short: 'Sarbah', color: '#0b2a5b' },
  { id: 'jean-nelson', name: 'Jean Nelson Aka Hall', short: 'JNA', color: '#16a3a3' },
  { id: 'kwapong', name: 'Alexander Kwapong Hall', short: 'Kwapong', color: '#c23b8a' },
  { id: 'sey', name: 'Elizabeth Frances Sey Hall', short: 'Sey', color: '#8a9a1c' },
  { id: 'limann', name: 'Hilla Limann Hall', short: 'Limann', color: '#5560e0' },
  { id: 'none', name: 'Non-resident', short: 'NR', color: '#8a8f99' },
];

export const hallById = (id: string) => HALLS.find((h) => h.id === id) ?? HALLS[HALLS.length - 1];

/** Hall id to its place on the real campus map (see game/campusmap.ts). */
export const HALL_PLACE: Record<string, string> = {
  legon: 'Legon Hall', akuafo: 'Akuafo Hall Main', commonwealth: 'Commonwealth Hall', volta: 'Volta Hall',
  sarbah: 'Mensah Sarbah Hall', 'jean-nelson': 'Jean Nelson Aka Hall', kwapong: 'Alexander Kwapong Hall',
  sey: 'Elizabeth Frances Sey Hall', limann: 'Dr. Hilla Limann Hall',
};

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
