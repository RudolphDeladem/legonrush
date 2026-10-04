// Campus data. Building positions are real (see ugmap.ts); buildings are still
// boxes with labels until proper models exist.
import { Track } from '../game/track';
import { CAMPUS_LOOP_PATH, PLACES, toLocal, type Place } from './ugmap';

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

export interface Route {
  id: string;
  name: string;
  /** rideable length in metres, start line to finish line */
  length: number;
  difficulty: number;
  reward: number;
  available: boolean;
  /** road centreline; the start line sits LEAD metres in so there is scenery behind the rider */
  track?: Track;
  places?: Place[];
}

/** metres of road before the start line and after the finish line */
export const LEAD = 60;

const loopTrack = new Track(CAMPUS_LOOP_PATH.map(([lat, lng]) => toLocal(lat, lng)));

export const CAMPUS_LOOP: Route = {
  id: 'campus-loop-2',
  name: 'Campus Loop',
  length: Math.round(loopTrack.length - LEAD * 2),
  difficulty: 2,
  reward: 250,
  available: true,
  track: loopTrack,
  places: PLACES,
};

export const ROUTES: Route[] = [
  CAMPUS_LOOP,
  { id: 'engineering-run', name: 'Engineering Run', length: 3600, difficulty: 3, reward: 350, available: false },
  { id: 'sunset-route', name: 'Sunset Route', length: 4200, difficulty: 3, reward: 450, available: false },
  { id: 'night-circuit', name: 'Night Circuit', length: 3100, difficulty: 4, reward: 400, available: false },
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
