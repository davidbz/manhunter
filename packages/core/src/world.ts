/**
 * The whole truth about a game in progress. `WorldState` is the only place the criminal's
 * position lives, and it never leaves `core`: the UI receives `HunterView` (architecture rule 4).
 *
 * It is plain data throughout, so `JSON.parse(JSON.stringify(world))` round-trips it
 * (architecture rule 3). That includes the RNG position, which travels with the world rather
 * than in a generator object, so a saved world resumes the same stream.
 */

import type { GameConfig } from "./config";
import type { CriminalState } from "./criminal";
import type { GameEvent } from "./events";
import type { HunterState } from "./hunter";
import type { MapGraph } from "./map";
import type { Report } from "./report";
import type { RngState } from "./rng";
import type { Clock, Turn } from "./time";

/**
 * How the hunt ended, per DESIGN.md "End conditions". No variant carries a node id: where the
 * criminal was is revealed by the reveal frames (`view.ts`), not smuggled out through the
 * outcome, which the hunter sees.
 *
 * There is no bankruptcy variant: budget is enforced when an action is planned, so it never goes
 * below 0 and the condition could not be reached. Reintroducing it needs an action billed after
 * the fact, which is post-MVP (PLAN "Decisions").
 */
export type GameOutcome =
  | { readonly kind: "in_progress" }
  | { readonly kind: "captured"; readonly turn: Turn }
  | { readonly kind: "escaped"; readonly turn: Turn }
  | { readonly kind: "trust_collapsed"; readonly turn: Turn }
  | { readonly kind: "casualties_exceeded"; readonly turn: Turn };

export type WorldState = {
  readonly config: GameConfig;
  readonly rng: RngState;
  readonly clock: Clock;
  readonly map: MapGraph;
  readonly hunter: HunterState;
  readonly criminal: CriminalState;
  /** Every report ever generated. One with `receivedAtTurn` after now has not landed yet. */
  readonly reports: readonly Report[];
  readonly events: readonly GameEvent[];
  readonly casualties: number;
  readonly outcome: GameOutcome;
};

export const IN_PROGRESS: GameOutcome = { kind: "in_progress" };

const NO_CASUALTIES = 0;

type WorldStateInput = Omit<WorldState, "reports" | "events" | "casualties" | "outcome">;

/** A world at turn zero: the parts a game is assembled from, and nothing having happened yet. */
export const makeWorldState = (input: WorldStateInput): WorldState => ({
  ...input,
  reports: [],
  events: [],
  casualties: NO_CASUALTIES,
  outcome: IN_PROGRESS,
});
