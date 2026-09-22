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

/** Standing measures on the map. One variant in the MVP; the rest are PLAN M7. */
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
   * criminal picked up. A fake briefing (PLAN M7) is the first without being the second.
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

/** The part of `balance.hunter` the trust meter's range is read from. */
export type TrustBounds = {
  readonly trustMin: number;
  readonly trustMax: number;
};

const NO_TRUST = 0;
const FULL_TRUST = 1;

/**
 * The hunter's standing as a fraction of its range. Both producers of witness reports read it -
 * `actions.ts` for a canvass the hunter paid for, `intel.ts` for the calls the city makes unasked
 * - and one copy keeps them from disagreeing about what a trust of 40 is worth.
 *
 * No guard against an empty range: `Balance` is `typeof BALANCE` over an `as const` table, so its
 * trust bounds are literal types and a range with no span is not a value a caller can pass on.
 * Widening them for a sweep (PLAN M4.3) is what would make the division fallible, and that task is
 * where the guard would then belong.
 */
export const trustFactorOf = (bounds: TrustBounds, trust: number): number =>
  Math.min(
    Math.max((trust - bounds.trustMin) / (bounds.trustMax - bounds.trustMin), NO_TRUST),
    FULL_TRUST,
  );
