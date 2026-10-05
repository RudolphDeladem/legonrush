// Owned items and rewards shared by every system (events, challenges, store, garage).
// The Garage/Store catalogue says what each item id is; this file only counts what a rider owns.
import { saveProfile, type Profile } from '../state';

export interface Reward { coins?: number; xp?: number; diamonds?: number; items?: string[] }

export const owns = (p: Profile, id: string) => (p.items[id] ?? 0) > 0;

export function grantItem(p: Profile, id: string, n = 1) {
  p.items[id] = (p.items[id] ?? 0) + n;
}

/** pay out a reward and save; returns what was given */
export function grant(p: Profile, r: Reward): Reward {
  p.coins += r.coins ?? 0;
  p.xp += r.xp ?? 0;
  p.diamonds = (p.diamonds ?? 0) + (r.diamonds ?? 0);
  for (const id of r.items ?? []) grantItem(p, id);
  saveProfile(p);
  return r;
}

/** spend coins or diamonds if the rider has enough; saves and returns true on success */
export function spend(p: Profile, cost: { coins?: number; diamonds?: number }): boolean {
  if ((cost.coins ?? 0) > p.coins || (cost.diamonds ?? 0) > (p.diamonds ?? 0)) return false;
  p.coins -= cost.coins ?? 0;
  p.diamonds = (p.diamonds ?? 0) - (cost.diamonds ?? 0);
  saveProfile(p);
  return true;
}
