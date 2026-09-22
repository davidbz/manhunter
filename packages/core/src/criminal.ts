/**
 * The hidden half of the world (DESIGN.md "Criminal AI"). Nothing in this file may reach
 * `apps/web` except through the post-game reveal in `view.ts` (architecture rule 4).
 */

import type { EdgeId, NodeId } from "./ids";
import { LIMITS } from "./limits";
import type { TravelMode } from "./map";
import type { Turn } from "./time";

export type CriminalProfile = "amateur" | "professional" | "local" | "planner";

/**
 * What the criminal believes about the hunt. The AI (PLAN M3.5) may read only this, never the
 * hunter's state directly, so a leak is a change to this record rather than a change of habit.
 */
export type CriminalKnowledge = {
  readonly knownRoadblockEdgeIds: readonly EdgeId[];
  readonly heardBriefingTurns: readonly Turn[];
};

export type CriminalState = {
  readonly nodeId: NodeId;
  /**
   * Where the criminal was before now, most recent first, one entry per turn whether or not it
   * moved. It is what lets a camera show footage of the past (`pullCctv.lookbackTurns`), which
   * counts turns rather than places - a criminal that stood still for three turns was still
   * there for three turns. Capped at `LIMITS.maxCriminalTrail` (PLAN M3.8b-2).
   */
  readonly trail: readonly NodeId[];
  readonly travelMode: TravelMode;
  readonly profile: CriminalProfile;
  readonly stamina: number;
  readonly heat: number;
  readonly cash: number;
  readonly desperation: number;
  readonly knowledge: CriminalKnowledge;
  /**
   * Taken at a checkpoint it never saw coming, which is the MVP's only capture (DESIGN.md "End
   * conditions", PLAN M3.11). It is set by the resolution phase and read by `endconditions.ts`,
   * so the rule that ends the hunt stays out of the turn loop (architecture rule 6).
   */
  readonly inCustody: boolean;
};

export type CriminalAction =
  | { readonly kind: "move"; readonly toNodeId: NodeId; readonly travelMode: TravelMode }
  | { readonly kind: "hide" }
  | { readonly kind: "rest" }
  | { readonly kind: "wait" };

export const EMPTY_CRIMINAL_KNOWLEDGE: CriminalKnowledge = {
  knownRoadblockEdgeIds: [],
  heardBriefingTurns: [],
};

/**
 * A criminal at the start of a hunt: everything measured, nowhere behind it, knowing nothing, and
 * still at large.
 */
export const makeCriminalState = (
  input: Omit<CriminalState, "knowledge" | "trail" | "inCustody">,
): CriminalState => ({
  ...input,
  trail: [],
  knowledge: EMPTY_CRIMINAL_KNOWLEDGE,
  inCustody: false,
});

/**
 * The trail one turn on: where the criminal stood this turn goes to the front and the oldest
 * entry falls off the end. Called once per turn by the resolution phase, before the move is
 * applied, so `trail[0]` is always the turn before `nodeId`.
 */
export const trailAfter = (criminal: CriminalState): readonly NodeId[] =>
  [criminal.nodeId, ...criminal.trail].slice(0, LIMITS.maxCriminalTrail);

/**
 * Where a look at this turn could still find the criminal, going back `lookbackTurns` turns and
 * including this one. A lookback of one is the present alone, which is what a person standing in
 * the street sees; anything more is footage (PLAN M3.4a's `pullCctv.lookbackTurns`).
 */
export const recentNodeIds = (criminal: CriminalState, lookbackTurns: Turn): readonly NodeId[] =>
  [criminal.nodeId, ...criminal.trail].slice(0, lookbackTurns);

/**
 * What the criminal knows once it has run into a checkpoint. Recording the same edge twice would
 * make the list grow with the hunt rather than with the map, so a block already known changes
 * nothing - which also keeps the record a set in everything but type (architecture rule 3 leaves
 * no `Set` in state).
 */
export const withKnownRoadblock = (
  knowledge: CriminalKnowledge,
  edgeId: EdgeId,
): CriminalKnowledge => {
  if (knowledge.knownRoadblockEdgeIds.includes(edgeId)) {
    return knowledge;
  }
  return {
    ...knowledge,
    knownRoadblockEdgeIds: [...knowledge.knownRoadblockEdgeIds, edgeId],
  };
};

/** The part of `balance.criminal` the heat meter's range is read from. */
export type HeatBounds = {
  readonly heatMax: number;
};

const NO_HEAT = 0;
const FULL_HEAT = 1;

/**
 * How recognisable the criminal is, in [0, 1]. `ai.ts` scales the exposure the criminal perceives
 * by it; `intel.ts` scales by it how often a passer-by recognises the face well enough to ring in.
 * The same number on both sides, because they are the same fact seen from either end.
 */
export const heatFactorOf = (bounds: HeatBounds, heat: number): number =>
  Math.min(Math.max(heat / bounds.heatMax, NO_HEAT), FULL_HEAT);
