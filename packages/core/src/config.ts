/**
 * The setup of a hunt: everything a game needs besides its seed. A replay is a seed plus this
 * plus an action list (PLAN M3.9), so every field here must be plain serializable data.
 *
 * The config is hidden information: it names the criminal's profile, which DESIGN.md keeps from
 * the hunter. `HunterView` therefore carries derived facts such as turns remaining, never the
 * config itself.
 *
 * Defaults are balance, not configuration, and land in `balance.ts` (PLAN M1.3).
 */

import type { CriminalProfile } from "./criminal";
import type { Hour, Turn } from "./time";

export type MapConfig = {
  readonly columns: number;
  readonly rows: number;
  readonly exitCount: number;
};

export type GameConfig = {
  readonly criminalProfile: CriminalProfile;
  readonly startHour: Hour;
  readonly maxTurns: Turn;
  readonly map: MapConfig;
};
