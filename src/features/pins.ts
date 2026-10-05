// Things that show up on the campus map, contributed by each system (events, challenges, community).
// The Map tab asks every registered source for its pins; sources must be cheap and never throw.
export type PinKind = 'event' | 'challenge' | 'treasure' | 'rider' | 'friend' | 'crew' | 'place';

export interface Pin {
  id: string;
  kind: PinKind;
  /** a place name from the campus map (src/game/campusmap.ts) or exact lat/lng */
  place?: string;
  lat?: number;
  lng?: number;
  title: string;
  sub?: string;
  /** live now: drawn with a pulse */
  live?: boolean;
  /** what tapping "Open" does */
  open?: () => void;
}

type Source = () => Pin[] | Promise<Pin[]>;
const sources = new Map<string, Source>();
export function registerPinSource(name: string, src: Source) {
  sources.set(name, src);
}
export async function allPins(): Promise<Pin[]> {
  const lists = await Promise.all([...sources.values()].map(async (s) => { try { return await s(); } catch { return []; } }));
  return lists.flat();
}
