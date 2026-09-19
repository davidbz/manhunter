/**
 * Where the hunter thinks the criminal is (DESIGN.md "Probability heatmap"): a probability mass
 * over the city's nodes, spread each turn along the edges that could have been walked, pruned by
 * the places that were searched and found empty, and pulled toward whatever was reported.
 *
 * It is state, not a derivation. `WorldState` carries it, the turn loop advances it once per turn
 * (PLAN M3.8a), and `toHunterView` projects it, which is what lets a bot read it off a view
 * without accumulating a history of its own (PLAN "Decisions": where the belief distribution
 * lives). `advance` is therefore one turn of work and never a fold over the hunt so far.
 *
 * **It may read only what the hunter can see.** `advance` is given a `BeliefEvidence`, and
 * `toBeliefEvidence` is the one thing that produces one - out of a `HunterView`, which is the
 * projection the criminal's position has already been taken out of. `core` computes the hunter's
 * own inference with the true position in scope, so that restriction is a type as far as it can
 * be and a test where it cannot be (PLAN M3.6b's last acceptance criterion).
 *
 * The step is predict-then-update, in that order: a turn of movement over the distribution that
 * was current, and then the reports the hunter is reading now. Folding the reports in first would
 * dilute the freshest thing the hunter has by a turn of running they have already accounted for.
 */

import type { Balance, BeliefSettings } from "./balance";
import type { Adjacency, GraphLogic, Neighbor, Traversal } from "./graph";
import { blockedEdgeIdsAt } from "./hunter";
import type { EdgeId, NodeId } from "./ids";
import type { TraversableGraph } from "./map";
import type { ReportSource } from "./report";
import type { HunterView } from "./view";

export type BeliefCell = {
  readonly nodeId: NodeId;
  /** Probability the criminal is here, in [0, 1]. */
  readonly mass: number;
};

/**
 * A distribution over the map's nodes, in the map's own node order. An array of cells rather than
 * a record keyed by node id, for the reason `MapGraph` keeps arrays (PLAN M1.2): architecture
 * rule 3 bans a `Map` from state, and an explicit order is the order determinism needs.
 */
export type Belief = readonly BeliefCell[];

/** Somewhere a report that landed this turn named, and who named it. */
export type BeliefObservation = {
  readonly nodeId: NodeId;
  readonly source: ReportSource;
};

/**
 * One turn's worth of hunter-visible fact. Every member is readable off a `HunterView`; nothing
 * here can be derived from the criminal's position.
 */
export type BeliefEvidence = {
  readonly graph: TraversableGraph;
  /**
   * Standing containment. Mass does not cross a roadblock, which is DESIGN.md's "roadblock not
   * hit" as negative evidence: a criminal who tried would have been stopped (PLAN M3.8b). A
   * `ReadonlySet` because it is `Traversal.blockedEdgeIds`, not something the world stores.
   */
  readonly blockedEdgeIds: ReadonlySet<EdgeId>;
  /** Places a report that landed this turn put the criminal. */
  readonly sightings: readonly BeliefObservation[];
  /** Places a report that landed this turn found empty. */
  readonly clearances: readonly BeliefObservation[];
};

export type BeliefRequest = {
  readonly belief: Belief;
  readonly evidence: BeliefEvidence;
  readonly balance: Balance;
};

export type BeliefLogic = {
  readonly advance: (request: BeliefRequest) => Belief;
};

type BeliefDeps = {
  readonly graph: GraphLogic;
};

const NO_MASS = 0;
const FULL_MASS = 1;

/**
 * How far a sum of tens of floats may sit from 1 and still be the same distribution. The
 * invariant is stated against this rather than against equality, because normalising divides.
 */
export const BELIEF_MASS_TOLERANCE = 1e-9;

export const uniformBelief = (nodeIds: readonly NodeId[]): Belief =>
  nodeIds.map((nodeId) => ({ nodeId, mass: FULL_MASS / nodeIds.length }));

/**
 * Everything on one node: what the hunter knows at turn zero, when the only place the criminal
 * has certainly been is the crime scene. A node the map does not have leaves the hunter knowing
 * nothing, which is the uniform distribution rather than a mass with nowhere to sit.
 */
export const pointBelief = (nodeIds: readonly NodeId[], at: NodeId): Belief =>
  nodeIds.some((nodeId) => nodeId === at)
    ? nodeIds.map((nodeId) => ({ nodeId, mass: nodeId === at ? FULL_MASS : NO_MASS }))
    : uniformBelief(nodeIds);

/** A node the distribution has no cell for is a node the hunter suspects not at all. */
export const beliefMassAt = (belief: Belief, nodeId: NodeId): number =>
  belief.find((cell) => cell.nodeId === nodeId)?.mass ?? NO_MASS;

const observationsOf = (
  view: HunterView,
  kind: "sighting" | "no_sighting",
): readonly BeliefObservation[] =>
  view.reports
    .filter((report) => report.receivedAtTurn === view.clock.turn && report.content.kind === kind)
    .map((report) => ({ nodeId: report.content.nodeId, source: report.source }));

/**
 * The one projection that produces evidence, and it takes the hunter's own view: the criminal is
 * not in scope here at all (architecture rule 4).
 *
 * Only the reports that landed *this* turn. `advance` is one turn of spread, so a report already
 * folded in on the turn it arrived must not be folded in again on every turn after it.
 */
export const toBeliefEvidence = (view: HunterView): BeliefEvidence => ({
  graph: view.map,
  blockedEdgeIds: blockedEdgeIdsAt(view.hunter.containments, view.clock.turn),
  sightings: observationsOf(view, "sighting"),
  clearances: observationsOf(view, "no_sighting"),
});

type Masses = Map<NodeId, number>;

const add = (masses: Masses, nodeId: NodeId, mass: number): void => {
  masses.set(nodeId, (masses.get(nodeId) ?? NO_MASS) + mass);
};

const totalOf = (masses: Masses): number =>
  [...masses.values()].reduce((sum, mass) => sum + mass, NO_MASS);

/** Plausible speed: cost is in turns, so the cheaper the edge the more of a turn it leaves over. */
const speedOf = (neighbor: Neighbor): number => FULL_MASS / neighbor.cost;

/**
 * One node's turn of movement. It keeps `1 - spreadFraction` of what it holds and hands the rest
 * to its neighbours in proportion to how fast each edge is. A node with nowhere to go keeps
 * everything, which is what a district every route out of is blocked should do.
 */
const spreadFrom = (
  next: Masses,
  neighbors: readonly Neighbor[],
  nodeId: NodeId,
  mass: number,
  fraction: number,
): void => {
  const totalSpeed = neighbors.reduce((sum, neighbor) => sum + speedOf(neighbor), NO_MASS);
  if (totalSpeed <= NO_MASS) {
    add(next, nodeId, mass);
    return;
  }
  add(next, nodeId, mass * (FULL_MASS - fraction));
  for (const neighbor of neighbors) {
    add(next, neighbor.nodeId, (mass * fraction * speedOf(neighbor)) / totalSpeed);
  }
};

/**
 * A cell naming a node the map does not have is dropped rather than carried: the distribution
 * this returns is over the graph the evidence was drawn from, so the two cannot drift.
 */
const spread = (
  adjacency: Adjacency,
  belief: Belief,
  nodeIds: readonly NodeId[],
  fraction: number,
): Masses => {
  const next: Masses = new Map(nodeIds.map((nodeId) => [nodeId, NO_MASS]));
  for (const cell of belief) {
    if (next.has(cell.nodeId)) {
      spreadFrom(next, adjacency.get(cell.nodeId) ?? [], cell.nodeId, cell.mass, fraction);
    }
  }
  return next;
};

/**
 * How much a report moves the distribution. The hunter cannot see a report's hidden accuracy, so
 * what a source is worth is what the hunter can know about it: a camera does not misremember and
 * an anonymous tip is somebody on a telephone (DESIGN.md "Reports").
 */
const weightOf = (settings: BeliefSettings, observation: BeliefObservation): number =>
  settings.sourceWeight[observation.source];

/** Somewhere looked at and found empty holds that much less of the hunter's suspicion. */
const prune = (masses: Masses, observation: BeliefObservation, weight: number): void => {
  const held = masses.get(observation.nodeId);
  if (held === undefined) {
    return;
  }
  masses.set(observation.nodeId, held * (FULL_MASS - weight));
};

/**
 * A sighting pulls the whole distribution toward the node it names: every node keeps `1 - weight`
 * of what it held and the named node takes the difference. Mass is preserved, so a report the
 * hunter half believes moves half the city's worth of suspicion and no more.
 */
const concentrate = (masses: Masses, observation: BeliefObservation, weight: number): void => {
  if (!masses.has(observation.nodeId)) {
    return;
  }
  const moved = totalOf(masses) * weight;
  for (const [nodeId, mass] of masses) {
    masses.set(nodeId, mass * (FULL_MASS - weight));
  }
  add(masses, observation.nodeId, moved);
};

/**
 * Evidence can take every node to nothing - a clearance on the one node the hunter suspected, on
 * a one-node map. Knowing nothing is the uniform distribution, not a distribution of zeroes.
 */
const normalized = (masses: Masses, nodeIds: readonly NodeId[]): Belief => {
  const total = totalOf(masses);
  if (total <= NO_MASS) {
    return uniformBelief(nodeIds);
  }
  return nodeIds.map((nodeId) => ({ nodeId, mass: (masses.get(nodeId) ?? NO_MASS) / total }));
};

export const createBeliefLogic = (deps: BeliefDeps): BeliefLogic => ({
  advance: ({ belief, evidence, balance }) => {
    const nodeIds = evidence.graph.nodes.map((node) => node.id);
    const traversal: Traversal = {
      graph: evidence.graph,
      balance,
      mode: balance.map.escapeMode,
      blockedEdgeIds: evidence.blockedEdgeIds,
    };
    const settings = balance.belief;
    const masses = spread(
      deps.graph.adjacency(traversal),
      belief,
      nodeIds,
      settings.spreadFraction,
    );
    for (const clearance of evidence.clearances) {
      prune(masses, clearance, weightOf(settings, clearance));
    }
    for (const sighting of evidence.sightings) {
      concentrate(masses, sighting, weightOf(settings, sighting));
    }
    return normalized(masses, nodeIds);
  },
});
