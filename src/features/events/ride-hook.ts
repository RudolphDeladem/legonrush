// How an event rides along with a normal ride (main.ts ride()): the event sets its rules after the
// ride starts, draws its own HUD, sees every HUD update and adds its result to the results screen.
import type { Game, HudState, RideEnd } from '../../game/Game';

export interface EventRideCtx {
  game: Game;
  /** the ride HUD element: the event adds its own panel here */
  hud: HTMLElement;
  /** brakes fitted for this ride (for Game.setGear) */
  brakes: number;
  /** stop the ride now (time up, treasure found): tidies the ride and calls leave() */
  quit: () => void;
}

export interface EventRide {
  /** weather for the whole ride (no passing showers during events) */
  rain: boolean;
  /** called once, right after the ride starts */
  start(ctx: EventRideCtx): void;
  /** every HUD update */
  hud(h: HudState): void;
  /** the ride ended by itself: HTML added to the results screen */
  end(r: RideEnd): string;
  /** the rider left the ride (Exit from pause, or quit()): where to go now */
  leave(): void;
  /** always called when the ride is tidied away */
  stop(): void;
}
