/**
 * What a hunt was worth (DESIGN.md "End conditions": turns taken, budget spent, civilian harm,
 * trust remaining). The ending itself scores a base - only a capture has one - and each component
 * is a signed adjustment to it, so the breakdown reads as a receipt rather than a verdict.
 *
 * Four components, not five. Captured-alive is not one of them: no MVP action can use force and a
 * capture is both sides on one node, so the flag would be `true` by construction and the bonus a
 * constant on every win (PLAN "Decisions"). It returns with the force actions in M7, as a fifth
 * entry in the table below.
 *
 * Political pressure is not one either, and for a different reason: it tracks the clock, and turns
 * taken is already a component (PLAN M1.2).
 *
 * `score` takes a `SealedWorld` like every exported game function (PLAN M3.1b) - `apps/web` is the
 * consumer (PLAN M5.6a) and may not name a `WorldState` at all - and `balance` is an argument
 * rather than a factory dep, so the numbers a score is read against are the same ones the turn it
 * scores was played under (PLAN M3.6b).
 */

import type { Balance } from "./balance";
import { type SealedWorld, unseal } from "./sealed";
import type { GameOutcome, WorldState } from "./world";

export type ScoreComponentKind = "turns_taken" | "budget_spent" | "casualties" | "trust_remaining";

export type ScoreComponent = {
  readonly kind: ScoreComponentKind;
  /** What the hunt did, in the component's own unit: turns, budget, people, points of trust. */
  readonly measured: number;
  /** What that was worth. Signed: a penalty is negative and a bonus positive. */
  readonly points: number;
};

/**
 * Plain serializable data (architecture rule 3), because PLAN M5.6a renders it component by
 * component and PLAN M3.9's replay may carry it across a boundary.
 */
export type ScoreBreakdown = {
  readonly outcome: GameOutcome;
  /** What the ending alone was worth, before the components (`balance.score.outcomeBase`). */
  readonly base: number;
  readonly components: readonly ScoreComponent[];
  /** `base` plus every component's points, floored at `balance.score.minimumScore`. */
  readonly total: number;
};

export type ScoreRequest = {
  readonly world: SealedWorld;
  readonly balance: Balance;
};

export type ScoringLogic = {
  readonly score: (request: ScoreRequest) => ScoreBreakdown;
};

type ScoreComponentDefinition = {
  readonly kind: ScoreComponentKind;
  readonly measure: (world: WorldState, balance: Balance) => number;
  /** Signed, so which direction a component pulls in is written down once, here. */
  readonly weight: (balance: Balance) => number;
};

const NO_POINTS = 0;

/**
 * How long the hunt lasted. The outcome's own stamp, because the end conditions are checked after
 * the clock has moved, which makes it the number of turns played rather than the index of the last
 * one (PLAN M3.8c). A hunt still running has no stamp, so its clock is the count so far.
 */
const turnsTaken = (world: WorldState): number =>
  "turn" in world.outcome ? world.outcome.turn : world.clock.turn;

/**
 * Nothing records what the hunter has spent, because nothing needs to until now: planning refuses
 * an action the budget cannot cover, so the balance only ever falls and what is missing from it is
 * what was spent.
 */
const budgetSpent = (world: WorldState, balance: Balance): number =>
  balance.hunter.startingBudget - world.hunter.budget;

const casualties = (world: WorldState): number => world.casualties;

const trustRemaining = (world: WorldState): number => world.hunter.trust;

/** A new component is an entry here and a new `ScoreComponentKind`, never a branch below. */
const SCORE_COMPONENTS: readonly ScoreComponentDefinition[] = [
  {
    kind: "turns_taken",
    measure: turnsTaken,
    weight: (balance) => -balance.score.turnPenalty,
  },
  {
    kind: "budget_spent",
    measure: budgetSpent,
    weight: (balance) => -balance.score.budgetPenaltyPerUnit,
  },
  {
    kind: "casualties",
    measure: casualties,
    weight: (balance) => -balance.score.casualtyPenalty,
  },
  {
    kind: "trust_remaining",
    measure: trustRemaining,
    weight: (balance) => balance.score.trustBonusPerPoint,
  },
];

/**
 * A score is a whole number of points. Rounding each component rather than the total is what keeps
 * the receipt adding up on screen, since `budgetPenaltyPerUnit` is the one weight that is not an
 * integer. Negative zero is normalised away: it survives `JSON.stringify` and a UI would print it.
 */
const pointsFor = (measured: number, weight: number): number => {
  const rounded = Math.round(measured * weight);
  return rounded === NO_POINTS ? NO_POINTS : rounded;
};

const componentOf = (
  definition: ScoreComponentDefinition,
  world: WorldState,
  balance: Balance,
): ScoreComponent => {
  const measured = definition.measure(world, balance);
  return {
    kind: definition.kind,
    measured,
    points: pointsFor(measured, definition.weight(balance)),
  };
};

export const createScoringLogic = (): ScoringLogic => ({
  score: ({ world, balance }) => {
    const state = unseal(world);
    const base = balance.score.outcomeBase[state.outcome.kind];
    const components = SCORE_COMPONENTS.map((definition) =>
      componentOf(definition, state, balance),
    );
    const earned = components.reduce((sum, component) => sum + component.points, base);

    return {
      outcome: state.outcome,
      base,
      components,
      total: Math.max(earned, balance.score.minimumScore),
    };
  },
});
