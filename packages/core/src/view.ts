/**
 * The visibility split (architecture rule 4). Three types, designed together:
 *
 * - `WorldState` (in `world.ts`) is everything, and stays inside `core`.
 * - `HunterView` is what the player may see during a hunt. It has no `criminal` member and no
 *   `config` member, so neither the criminal's position nor its profile can reach the UI.
 * - `RevealFrame` is what the after-action replay may see, once the game is over: a hunter view
 *   plus the criminal's true position for that turn, and nothing else (PLAN M3.9, M5.6).
 *
 * This file declares the types. `toHunterView` is PLAN M3.2 and lands here beside them.
 */

import type { GameEvent } from "./events";
import type { HunterState } from "./hunter";
import type { NodeId } from "./ids";
import type { MapGraph } from "./map";
import type { HiddenReportField, Report } from "./report";
import type { Clock, Turn } from "./time";
import type { GameOutcome } from "./world";

/** A report with its hidden fields removed. Derived from `Report` so the two cannot drift. */
export type HunterReport = Omit<Report, HiddenReportField>;

export type HunterView = {
  readonly clock: Clock;
  readonly map: MapGraph;
  readonly hunter: HunterState;
  /** Only reports that have landed by `clock.turn`. */
  readonly reports: readonly HunterReport[];
  readonly events: readonly GameEvent[];
  readonly casualties: number;
  /** Derived from the config, which the hunter may not see, because it names the profile. */
  readonly turnsRemaining: Turn;
  readonly outcome: GameOutcome;
};

export type RevealFrame = {
  readonly turn: Turn;
  readonly view: HunterView;
  readonly criminalNodeId: NodeId;
};
