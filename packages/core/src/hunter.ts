/**
 * The player's side: resources, standing containment, and the actions available in the MVP
 * (DESIGN.md "Hunter resources" and "Hunter actions").
 *
 * Unit fatigue is deliberately absent. No MVP action deploys a unit, so a fatigue meter would be
 * a number nothing advances; political pressure stays because DESIGN.md's override events read
 * it. See the PLAN M1.2 note.
 */

import type { EdgeId, NodeId } from "./ids";
import type { Turn } from "./time";

/** A blocked edge. Expires on its own, so the consequences phase never has to hunt for it. */
export type Roadblock = {
  readonly kind: "roadblock";
  readonly edgeId: EdgeId;
  readonly expiresAt: Turn;
};

/** Standing measures on the map. One variant in the MVP; the rest are PLAN M6. */
export type Containment = Roadblock;

export type HunterState = {
  readonly actionPoints: number;
  readonly budget: number;
  /** Public trust, 0-100. Bounds live in `balance.ts` (PLAN M1.3). */
  readonly trust: number;
  /** Political pressure, 0-100. Rises over time. */
  readonly pressure: number;
  readonly containments: readonly Containment[];
  /**
   * When the hunter went to the press. Media attention is what a briefing buys, and it outlives
   * the turn it was bought in: `actions.ts` reads the count to scale how many people come
   * forward, and PLAN M3.6 reads it again for the pranks that come with them.
   *
   * The criminal's own record of the same broadcasts is `CriminalKnowledge.heardBriefingTurns`.
   * Two lists rather than one because they are two facts: what the hunter said, and what the
   * criminal picked up. A fake briefing (PLAN M6) is the first without being the second.
   */
  readonly briefingTurns: readonly Turn[];
};

/** The MVP subset from DESIGN.md "Hunter actions". PLAN M3.3 and M3.4 give each an entry. */
export type HunterAction =
  | { readonly kind: "roadblock"; readonly edgeId: EdgeId }
  | { readonly kind: "canvass"; readonly nodeId: NodeId }
  | { readonly kind: "pull_cctv"; readonly nodeId: NodeId }
  | { readonly kind: "true_briefing" };

export type HunterActionKind = HunterAction["kind"];

type HunterStateInput = Omit<HunterState, "containments" | "briefingTurns">;

/** A hunter at the start of a hunt: resources as given, nothing deployed and nothing said. */
export const makeHunterState = (input: HunterStateInput): HunterState => ({
  ...input,
  containments: [],
  briefingTurns: [],
});

/**
 * The edges standing containment has closed at `turn`. A containment blocks from the turn it was
 * placed until `expiresAt` exclusive, so `balance.actions.roadblock.durationTurns` turns of
 * blocking covers exactly that many turns.
 *
 * A `ReadonlySet` because it feeds `Traversal.blockedEdgeIds`, which every search consults once
 * per edge (PLAN M3.3). It is derived on demand, never stored: `WorldState` keeps the
 * containments, which are plain data and round-trip through JSON (architecture rule 3).
 */
export const blockedEdgeIdsAt = (
  containments: readonly Containment[],
  turn: Turn,
): ReadonlySet<EdgeId> =>
  new Set(
    containments.filter((containment) => turn < containment.expiresAt).map(({ edgeId }) => edgeId),
  );
