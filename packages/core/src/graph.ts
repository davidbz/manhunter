/**
 * Getting around the city (PLAN M1.4a): who is next to whom in a given travel mode, what the
 * cheapest route between two districts is, and what can be reached at all.
 *
 * Two things the rest of `core` depends on. **Edges are undirected**: a road between two
 * districts is a road in both directions, and `from`/`to` are how it was written down, not a
 * direction of travel. **Costs are turns** (`balance.edges`), so a path cost compares directly
 * against the clock and against `balance.map.minEscapeTurns` with no conversion anywhere.
 *
 * Every search is bounded by `LIMITS.maxSearchExpansions` and reports the cap as a result
 * variant rather than throwing or spinning (AGENTS.md "Bound every I/O up front").
 */

import type { Balance } from "./balance";
import type { EdgeId, NodeId } from "./ids";
import { LIMITS } from "./limits";
import type { MapEdge, TravelMode, TraversableGraph } from "./map";

export type Neighbor = {
  readonly nodeId: NodeId;
  readonly edgeId: EdgeId;
  readonly cost: number;
};

/**
 * Everything a search needs besides its endpoints. An object rather than positional parameters
 * so that PLAN M3.3 can add standing roadblocks to it without touching every call site.
 *
 * `graph` is the structural minimum rather than `MapGraph` (widened in M2.1a): searching needs
 * node ids and edges, and the map generator has to check connectivity on a topology that has no
 * districts or exits yet. Every `MapGraph` still satisfies it.
 */
export type Traversal = {
  readonly graph: TraversableGraph;
  readonly balance: Balance;
  readonly mode: TravelMode;
  /** Defaults to `LIMITS.maxSearchExpansions`. Overridable so a test can reach the cap. */
  readonly maxExpansions?: number;
};

export type SearchFailure = {
  readonly kind: "expansion_limit_exceeded";
  readonly expansions: number;
};

export type Path = {
  readonly kind: "path";
  /** From the start to the destination inclusive. A path to the start itself is one node. */
  readonly nodeIds: readonly NodeId[];
  readonly edgeIds: readonly EdgeId[];
  readonly cost: number;
};

export type PathResult = Path | { readonly kind: "unreachable" } | SearchFailure;

export type ReachableResult =
  | { readonly kind: "reachable"; readonly nodeIds: readonly NodeId[] }
  | SearchFailure;

export type GraphLogic = {
  readonly neighbors: (traversal: Traversal, nodeId: NodeId) => readonly Neighbor[];
  /**
   * Every node's neighbours in one pass. `neighbors` builds this and throws the rest away, which
   * is O(edges) per lookup; anything that walks the whole graph (PLAN M1.4b's residual network,
   * M3.6b's belief spread) should take the map once instead.
   */
  readonly adjacency: (traversal: Traversal) => Adjacency;
  readonly shortestPath: (traversal: Traversal, from: NodeId, to: NodeId) => PathResult;
  /** Cheapest route to whichever target is nearest. The nearest exit, in practice. */
  readonly shortestPathToAny: (
    traversal: Traversal,
    from: NodeId,
    targets: readonly NodeId[],
  ) => PathResult;
  /** Every node reachable from `from`, the start included, in the order they were settled. */
  readonly reachable: (traversal: Traversal, from: NodeId) => ReachableResult;
};

export type Adjacency = ReadonlyMap<NodeId, readonly Neighbor[]>;

type Step = { readonly nodeId: NodeId; readonly edgeId: EdgeId };
type Previous = ReadonlyMap<NodeId, Step>;
type Visit = { readonly nodeId: NodeId; readonly cost: number };

type Settled = {
  readonly kind: "settled";
  /** The target the search stopped on, or `null` when it ran out of nodes first. */
  readonly reached: NodeId | null;
  readonly cost: number;
  readonly previous: Previous;
  readonly order: readonly NodeId[];
};

type SearchOutcome = Settled | SearchFailure;

const UNREACHABLE = { kind: "unreachable" } as const;
const ZERO_COST = 0;

const nodeIdSet = (graph: TraversableGraph): ReadonlySet<NodeId> =>
  new Set(graph.nodes.map((node) => node.id));

/**
 * `null` when the mode cannot use the edge. Non-positive costs are treated the same way: they
 * would break Dijkstra's assumption, and balance is injected data that a sweep could get wrong.
 */
const edgeCost = (balance: Balance, edge: MapEdge, mode: TravelMode): number | null => {
  const cost = balance.edges[edge.kind].costByMode[mode];
  if (cost === null || cost <= ZERO_COST) {
    return null;
  }
  return cost;
};

const link = (adjacency: Map<NodeId, Neighbor[]>, from: NodeId, neighbor: Neighbor): void => {
  const existing = adjacency.get(from);
  if (existing === undefined) {
    adjacency.set(from, [neighbor]);
    return;
  }
  existing.push(neighbor);
};

const buildAdjacency = (traversal: Traversal, nodeIds: ReadonlySet<NodeId>): Adjacency => {
  const { graph, balance, mode } = traversal;
  const adjacency = new Map<NodeId, Neighbor[]>();
  for (const edge of graph.edges) {
    const cost = edgeCost(balance, edge, mode);
    if (cost === null || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }
    link(adjacency, edge.from, { nodeId: edge.to, edgeId: edge.id, cost });
    link(adjacency, edge.to, { nodeId: edge.from, edgeId: edge.id, cost });
  }
  return adjacency;
};

/**
 * The frontier is scanned rather than heaped. City maps are tens of nodes, the scan costs no
 * dead branches under `noUncheckedIndexedAccess`, and `LIMITS.maxSearchExpansions` is set low
 * enough that the quadratic worst case stays well under a second.
 */
const takeCheapest = (frontier: Visit[]): Visit | undefined => {
  if (frontier.length === 0) {
    return undefined;
  }
  const cheapest = frontier.reduce((best, visit) => (visit.cost < best.cost ? visit : best));
  frontier.splice(frontier.indexOf(cheapest), 1);
  return cheapest;
};

type Relaxation = {
  readonly adjacency: Adjacency;
  readonly best: Map<NodeId, number>;
  readonly previous: Map<NodeId, Step>;
  readonly frontier: Visit[];
};

const relax = (relaxation: Relaxation, visit: Visit): void => {
  const { adjacency, best, previous, frontier } = relaxation;
  for (const neighbor of adjacency.get(visit.nodeId) ?? []) {
    const cost = visit.cost + neighbor.cost;
    const known = best.get(neighbor.nodeId);
    if (known !== undefined && known <= cost) {
      continue;
    }
    best.set(neighbor.nodeId, cost);
    previous.set(neighbor.nodeId, { nodeId: visit.nodeId, edgeId: neighbor.edgeId });
    frontier.push({ nodeId: neighbor.nodeId, cost });
  }
};

/**
 * Dijkstra. Stops on the first target it settles; an empty target set means it settles
 * everything reachable, which is what `reachable` wants.
 */
const search = (
  traversal: Traversal,
  from: NodeId,
  targets: ReadonlySet<NodeId>,
): SearchOutcome => {
  const nodeIds = nodeIdSet(traversal.graph);
  const order: NodeId[] = [];
  const previous = new Map<NodeId, Step>();
  if (!nodeIds.has(from)) {
    return { kind: "settled", reached: null, cost: ZERO_COST, previous, order };
  }

  const relaxation: Relaxation = {
    adjacency: buildAdjacency(traversal, nodeIds),
    best: new Map([[from, ZERO_COST]]),
    previous,
    frontier: [{ nodeId: from, cost: ZERO_COST }],
  };
  const maxExpansions = traversal.maxExpansions ?? LIMITS.maxSearchExpansions;
  const done = new Set<NodeId>();
  let expansions = 0;

  for (
    let visit = takeCheapest(relaxation.frontier);
    visit !== undefined;
    visit = takeCheapest(relaxation.frontier)
  ) {
    if (done.has(visit.nodeId)) {
      continue;
    }
    expansions += 1;
    if (expansions > maxExpansions) {
      return { kind: "expansion_limit_exceeded", expansions };
    }
    done.add(visit.nodeId);
    order.push(visit.nodeId);
    if (targets.has(visit.nodeId)) {
      return { kind: "settled", reached: visit.nodeId, cost: visit.cost, previous, order };
    }
    relax(relaxation, visit);
  }
  return { kind: "settled", reached: null, cost: ZERO_COST, previous, order };
};

/**
 * Walks the predecessor tree back from the destination. The tree was built by a search bounded
 * by `maxExpansions`, so the walk is bounded by the same cap without a second counter.
 */
const buildPath = (previous: Previous, to: NodeId, cost: number): Path => {
  const nodeIds: NodeId[] = [to];
  const edgeIds: EdgeId[] = [];
  for (let step = previous.get(to); step !== undefined; step = previous.get(step.nodeId)) {
    nodeIds.push(step.nodeId);
    edgeIds.push(step.edgeId);
  }
  return {
    kind: "path",
    nodeIds: nodeIds.toReversed(),
    edgeIds: edgeIds.toReversed(),
    cost,
  };
};

const toPathResult = (outcome: SearchOutcome): PathResult => {
  if (outcome.kind === "expansion_limit_exceeded") {
    return outcome;
  }
  if (outcome.reached === null) {
    return UNREACHABLE;
  }
  return buildPath(outcome.previous, outcome.reached, outcome.cost);
};

const shortestPathToAny = (
  traversal: Traversal,
  from: NodeId,
  targets: readonly NodeId[],
): PathResult => {
  if (targets.length === 0) {
    return UNREACHABLE;
  }
  return toPathResult(search(traversal, from, new Set(targets)));
};

export const createGraphLogic = (): GraphLogic => ({
  neighbors: (traversal, nodeId) =>
    buildAdjacency(traversal, nodeIdSet(traversal.graph)).get(nodeId) ?? [],

  adjacency: (traversal) => buildAdjacency(traversal, nodeIdSet(traversal.graph)),

  shortestPath: (traversal, from, to) => shortestPathToAny(traversal, from, [to]),

  shortestPathToAny,

  reachable: (traversal, from) => {
    const outcome = search(traversal, from, new Set());
    if (outcome.kind === "expansion_limit_exceeded") {
      return outcome;
    }
    return { kind: "reachable", nodeIds: outcome.order };
  },
});
