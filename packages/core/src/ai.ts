/**
 * The criminal's turn (DESIGN.md "Criminal AI"). A utility chooser: score every action the
 * criminal could take by the progress it makes toward an exit, minus the risk it perceives, plus
 * a profile-sized random term that keeps a hunt from being solvable by inspection.
 *
 * It reasons over a `CriminalSituation` rather than a `WorldState`, which is the mirror of
 * `view.ts`. The hunter may not see the criminal; the criminal may not see the hunter's budget,
 * trust, reports or standing roadblocks. What it knows of the hunt is `CriminalKnowledge` - the
 * roadblocks it has run into and the briefings it has heard - and `toCriminalSituation` is the
 * only projection that produces it. Handing `choose` the whole world would make that a habit
 * rather than a type.
 *
 * It reads the briefings it heard through their effect rather than as a term of their own:
 * `applyTrueBriefing` raises heat, and heat is what scales every exposure below, so a second
 * term for the same broadcast would count it twice.
 *
 * Every candidate costs exactly one `rng.float`, drawn in enumeration order whether or not the
 * candidate wins, so a decision is a pure function of the situation and the stream position
 * (architecture rule 2).
 */

import type { Balance, CriminalProfileWeights, DistrictProperties } from "./balance";
import { type CriminalAction, type CriminalState, heatFactorOf } from "./criminal";
import { districtPropertiesAt, witnessDensityAt } from "./exposure";
import type { GraphLogic, Traversal } from "./graph";
import type { NodeId } from "./ids";
import { LIMITS } from "./limits";
import type { MapGraph, TravelMode } from "./map";
import type { Rng, RngDraw, RngState } from "./rng";
import type { Clock } from "./time";
import type { WorldState } from "./world";

/**
 * What the criminal may see. The map and the clock because it lives in the city, its own state
 * because it is its own, and nothing else: no hunter, no reports, no config.
 */
export type CriminalSituation = {
  readonly map: MapGraph;
  readonly clock: Clock;
  readonly criminal: CriminalState;
};

/** The action chosen, and the stream position after the draws that chose it. */
export type CriminalDecision = RngDraw<CriminalAction>;

export type CriminalAiRequest = {
  readonly situation: CriminalSituation;
  readonly balance: Balance;
  readonly state: RngState;
};

export type CriminalAiLogic = {
  readonly choose: (request: CriminalAiRequest) => CriminalDecision;
};

type AiDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

/** The one projection that produces a `CriminalSituation`. Stays inside `core` (rule 4). */
export const toCriminalSituation = (world: WorldState): CriminalSituation => ({
  map: world.map,
  clock: world.clock,
  criminal: world.criminal,
});

const WAIT: CriminalAction = { kind: "wait" };
const HIDE: CriminalAction = { kind: "hide" };
const REST: CriminalAction = { kind: "rest" };

/** Every rate here is a fraction: of a turn's worth of escape, or of full exposure. */
const NONE = 0;
const FULL = 1;

/** Lower than any utility a candidate can score, so the first one considered always wins. */
const NO_UTILITY = Number.NEGATIVE_INFINITY;

type Candidate = {
  readonly action: CriminalAction;
  /**
   * What the action buys, in turns of escape: ground gained toward the nearest exit for a move,
   * nerve recovered for a hide, stamina for a rest. A move along an optimal edge scores `FULL`,
   * a move straight back `-FULL`, and standing still while calm scores `NONE`.
   */
  readonly progress: number;
  /** Perceived exposure in [0, 1]: how watched the criminal expects to be, at its own heat. */
  readonly risk: number;
};

/** Everything the scorers read, derived once per decision (the `Lookout` shape in `actions.ts`). */
type Perception = {
  readonly situation: CriminalSituation;
  readonly balance: Balance;
  readonly weights: CriminalProfileWeights;
  readonly traversal: Traversal;
  readonly exitNodeIds: readonly NodeId[];
  /** How recognisable the criminal is, in [0, 1]. Scales every exposure it perceives. */
  readonly heatFactor: number;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/**
 * The city as the criminal can cross it: the travel mode asked for, with the roadblocks it knows
 * about taken out of the map. Every distance below is measured on this and the neighbours it may
 * move to are drawn from it, so "never moves through a known roadblock" is a property of the
 * graph the AI searches rather than a check it could forget.
 *
 * Exported because `turn.ts` walks the same graph to find which edge a chosen move takes (PLAN
 * M3.8b-2): the route the hunt resolves has to be the route the criminal planned, and two copies
 * of this shape is how the two would drift apart.
 */
export const criminalTraversalOf = (
  balance: Balance,
  situation: CriminalSituation,
  mode: TravelMode,
): Traversal => ({
  graph: situation.map,
  balance,
  mode,
  blockedEdgeIds: new Set(situation.criminal.knowledge.knownRoadblockEdgeIds),
});

/**
 * Turns to the nearest exit, or `null` when the criminal cannot work it out - no exit it can
 * reach, or a search that hit `LIMITS.maxSearchExpansions`. Both mean the same thing to a
 * chooser: no way to tell whether a step helps.
 */
const escapeCost = (deps: AiDeps, perception: Perception, from: NodeId): number | null => {
  const result = deps.graph.shortestPathToAny(perception.traversal, from, perception.exitNodeIds);
  return result.kind === "path" ? result.cost : null;
};

/**
 * Ground gained per turn of travel. Costs are in turns (`balance.edges`), so dividing by the
 * edge's own cost is what makes a long road and a short footpath comparable, and the triangle
 * inequality keeps the result in [-1, 1] without a clamp.
 *
 * `null` is a distance the criminal could not work out: no exit it can reach, or a search that hit
 * `LIMITS.maxSearchExpansions`. It can only ever be null at both ends at once, because the two
 * nodes are adjacent and a route from one is a route from the other, and a step it cannot measure
 * teaches it nothing - so it scores `NONE` and the risk term decides.
 */
const escapeProgress = (from: number | null, to: number | null, cost: number): number => {
  if (from === null || to === null) {
    return NONE;
  }
  return (from - to) / cost;
};

const exposureOf = (perception: Perception, properties: DistrictProperties): number =>
  witnessDensityAt(perception.balance.time, properties, perception.situation.clock.hour) *
  perception.heatFactor;

const exposureAt = (perception: Perception, nodeId: NodeId): number =>
  exposureOf(
    perception,
    districtPropertiesAt(perception.balance.districts, perception.situation.map, nodeId),
  );

/**
 * How far past the profile's nerve the criminal's heat has gone, as a fraction of what is left of
 * the meter: `NONE` until `hideAboveHeat`, `FULL` at maximum heat. This is what makes an amateur
 * go to ground (DESIGN.md "hides when heat is high"), and below the threshold hiding buys
 * nothing, so any move that makes progress beats it.
 *
 * The guard is reachable, unlike `staminaShortfall`'s: `CriminalProfileWeights` is an annotated
 * type, so a balance sweep (PLAN M4.3) can set a threshold at or above `heatMax`, and a profile
 * with no nerve left to lose never hides rather than dividing by nothing.
 */
const heatPressure = (perception: Perception, heat: number): number => {
  const span = perception.balance.criminal.heatMax - perception.weights.hideAboveHeat;
  if (span <= NONE) {
    return NONE;
  }
  return clamp((heat - perception.weights.hideAboveHeat) / span, NONE, FULL);
};

/**
 * How much of the criminal's stamina is gone. Resting is worth a full turn of escape only to
 * someone with nothing left. No guard on the division: `balance.criminal.staminaMax` is a literal
 * type off the `as const` table, so a maximum of zero is not a value this can be handed - the
 * same reason `actions.ts`'s `trustFactorOf` has none.
 */
const staminaShortfall = (balance: Balance, stamina: number): number =>
  clamp(FULL - stamina / balance.criminal.staminaMax, NONE, FULL);

/**
 * Three ways to spend a turn where you stand, differing in what they buy and what they cost.
 * Hiding trades the whole turn for the district's cover, which is why it is worth most in an
 * industrial back lot and least on a station concourse; resting buys stamina; waiting buys
 * nothing and is what a criminal with no better idea does.
 */
const stationaryCandidates = (perception: Perception): readonly Candidate[] => {
  const { balance, situation } = perception;
  const { criminal } = situation;
  const properties = districtPropertiesAt(balance.districts, situation.map, criminal.nodeId);
  const exposure = exposureOf(perception, properties);
  return [
    {
      action: HIDE,
      progress: properties.hidingSpots * heatPressure(perception, criminal.heat),
      risk: exposure * (FULL - properties.hidingSpots),
    },
    { action: REST, progress: staminaShortfall(balance, criminal.stamina), risk: exposure },
    { action: WAIT, progress: NONE, risk: exposure },
  ];
};

/**
 * One candidate per neighbour the criminal could reach this turn, in its current travel mode -
 * stealing a car is post-MVP, so the mode it starts in is the mode it keeps.
 *
 * Bounded by `room`, which is what is left of `LIMITS.maxAiCandidates` after the stationary
 * actions. A district with more exits than that is a generator bug rather than a workload, and
 * considering the first `room` of them beats enumerating whatever a broken map offers.
 */
const moveCandidates = (
  deps: AiDeps,
  perception: Perception,
  room: number,
): readonly Candidate[] => {
  const { criminal } = perception.situation;
  const here = escapeCost(deps, perception, criminal.nodeId);
  return deps.graph
    .neighbors(perception.traversal, criminal.nodeId)
    .slice(0, room)
    .map(
      (neighbor): Candidate => ({
        action: { kind: "move", toNodeId: neighbor.nodeId, travelMode: criminal.travelMode },
        progress: escapeProgress(
          here,
          escapeCost(deps, perception, neighbor.nodeId),
          neighbor.cost,
        ),
        risk: exposureAt(perception, neighbor.nodeId),
      }),
    );
};

type Choice = {
  readonly state: RngState;
  readonly action: CriminalAction;
  readonly utility: number;
};

/**
 * DESIGN.md's decision model, one candidate at a time: progress toward the exit, minus perceived
 * risk, plus a random term the profile sizes. Ties keep the incumbent, so enumeration order is
 * the tiebreak and the whole decision is reproducible from the seed.
 */
const consider = (
  rng: Rng,
  weights: CriminalProfileWeights,
  choice: Choice,
  candidate: Candidate,
): Choice => {
  const drawn = rng.float(choice.state);
  const utility =
    weights.exitProgress * candidate.progress -
    weights.perceivedRisk * candidate.risk +
    weights.noise * drawn.value;
  if (utility <= choice.utility) {
    return { ...choice, state: drawn.state };
  }
  return { state: drawn.state, action: candidate.action, utility };
};

export const createCriminalAiLogic = (deps: AiDeps): CriminalAiLogic => ({
  choose: ({ situation, balance, state }) => {
    const weights = balance.criminal.profiles[situation.criminal.profile];
    if (weights === undefined) {
      // A profile with no weights has no behaviour, so it does nothing. Unreachable for any world
      // `createGameLogic` builds - `balance.test.ts` pins that every pooled profile has weights -
      // but total rather than assumed, and better than borrowing another profile's nerve.
      return { state, value: WAIT };
    }
    const perception: Perception = {
      situation,
      balance,
      weights,
      traversal: criminalTraversalOf(balance, situation, situation.criminal.travelMode),
      exitNodeIds: situation.map.exits.map((exit) => exit.nodeId),
      heatFactor: heatFactorOf(balance.criminal, situation.criminal.heat),
    };
    const stationary = stationaryCandidates(perception);
    const room = Math.max(LIMITS.maxAiCandidates - stationary.length, NONE);
    const nothingChosen: Choice = { state, action: WAIT, utility: NO_UTILITY };
    const chosen = [...stationary, ...moveCandidates(deps, perception, room)].reduce(
      (choice, candidate) => consider(deps.rng, weights, choice, candidate),
      nothingChosen,
    );
    return { state: chosen.state, value: chosen.action };
  },
});
