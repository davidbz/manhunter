/**
 * The hidden half of the world (DESIGN.md "Criminal AI"). Nothing in this file may reach
 * `apps/web` except through the post-game reveal in `view.ts` (architecture rule 4).
 */

import type { EdgeId, NodeId } from "./ids";
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
  readonly travelMode: TravelMode;
  readonly profile: CriminalProfile;
  readonly stamina: number;
  readonly heat: number;
  readonly cash: number;
  readonly desperation: number;
  readonly knowledge: CriminalKnowledge;
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

/** A criminal at the start of a hunt: everything measured, and knowing nothing yet. */
export const makeCriminalState = (input: Omit<CriminalState, "knowledge">): CriminalState => ({
  ...input,
  knowledge: EMPTY_CRIMINAL_KNOWLEDGE,
});
