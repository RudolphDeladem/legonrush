// Where the rider is, for the You marker: where their last ride ended (kept on this phone),
// their real position if they ask for it with Locate me while on campus, or their hall.
import type { Profile } from '../../state';
import type { CampusMap } from './campus';

const KEY = 'legonrush.mappos.v1';

export interface Where { x: number; z: number; source: 'ride' | 'gps' | 'hall' | 'campus'; at?: number }

/** main.ts calls this when a ride ends or is left: the map's You marker starts there next time */
export function rememberRidePos(xz: [number, number], campus = 'ug') {
  if (!Number.isFinite(xz[0]) || !Number.isFinite(xz[1])) return;
  try { localStorage.setItem(KEY, JSON.stringify({ x: Math.round(xz[0] * 10) / 10, z: Math.round(xz[1] * 10) / 10, at: Date.now(), campus })); } catch { /* private mode */ }
}

export function lastRidePos(campus = 'ug'): { x: number; z: number; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && v.campus === campus && Number.isFinite(v.x) && Number.isFinite(v.z) ? v : null;
  } catch {
    return null;
  }
}

/** best guess without asking for location: last ride, else your hall, else the main gate */
export function whereAmI(map: CampusMap, p: Profile): Where {
  const last = lastRidePos(map.campus.id);
  if (last) return { x: last.x, z: last.z, source: 'ride', at: last.at };
  const hall = map.hallPlace(p.hall);
  if (hall) return { x: hall.x, z: hall.z, source: 'hall' };
  return { x: map.start.x, z: map.start.z, source: 'campus' };
}

/** the phone's real position, if it is on (or right next to) the campus */
export function gpsFix(map: CampusMap): Promise<Where | 'off-campus' | 'denied'> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve('denied');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const [x, z] = map.fromLatLng(pos.coords.latitude, pos.coords.longitude);
        const b = map.bounds, pad = 400;
        if (x < b.minX - pad || x > b.maxX + pad || z < b.minZ - pad || z > b.maxZ + pad) return resolve('off-campus');
        resolve({ x, z, source: 'gps', at: Date.now() });
      },
      () => resolve('denied'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}
