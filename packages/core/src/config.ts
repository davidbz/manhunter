/**
 * The two halves of a hunt's configuration, split because one of them is hidden information.
 *
 * `GameSetup` is the player-visible half: what the player (or `sim`, or a replay string) asks for.
 * A replay is a seed plus this plus an action list (PLAN M3.9), so every field here must be plain
 * serializable data.
 *
 * `GameConfig` is the resolved form that lives inside `WorldState`. It names the criminal's
 * profile and the hour the hunt began, both of which DESIGN.md derives from the seed rather than
 * letting the player choose - which is why a shared replay link cannot spoil the hunt it replays.
 * `HunterView` therefore carries derived facts such as turns remaining, never the config itself.
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

/**
 * How hard the hunt should be. In the MVP it selects nothing but the pool of criminal profiles the
 * seed may draw from (`balance.criminal.pools`), and only `amateur` has behaviour, so every pool
 * names it alone until PLAN M6 implements the other three.
 */
export type Difficulty = "easy" | "standard" | "hard";

/** Everything the player chooses. Goes into the replay string; contains nothing hidden. */
export type GameSetup = {
  readonly map: MapConfig;
  /** The deadline, in turns. Bounded by `LIMITS.maxGameTurns` because it arrives from a replay. */
  readonly maxTurns: Turn;
  readonly difficulty: Difficulty;
};

export type GameConfig = {
  readonly criminalProfile: CriminalProfile;
  readonly startHour: Hour;
  readonly maxTurns: Turn;
  readonly map: MapConfig;
  readonly difficulty: Difficulty;
};
