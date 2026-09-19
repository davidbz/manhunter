/**
 * The city's skeleton (PLAN M2.1a): where the districts sit, and which of them are joined.
 *
 * A jittered grid, roads between grid neighbours, some of those roads removed, and some of the
 * survivors laid as footpaths. What this file deliberately does *not* decide is what any
 * district is, where the exits are, or where the hunt starts: that is labelling over a finished
 * topology (M2.1c), and keeping it out is what makes both halves testable on their own.
 *
 * Footpaths are placed here rather than left to a later task because `balance.edges.footpath` is
 * the only unblockable edge kind. A map of nothing but roads can be sealed with roadblocks
 * alone, which DESIGN.md's "min-cut between start and exits >= 2" rule exists to prevent.
 */

import type { Balance } from "./balance";
import type { MapConfig } from "./config";
import type { GraphLogic, Traversal } from "./graph";
import { type EdgeId, makeEdgeId, makeNodeId, type NodeId } from "./ids";
import { LIMITS } from "./limits";
import { type MapEdge, makeEdge, type Position, type River } from "./map";
import type { Rng, RngState } from "./rng";

/** Which cell of the generating grid a node came from. Zero-based, column-major in `x`. */
export type GridCell = {
  readonly column: number;
  readonly row: number;
};

/**
 * A node before it has a district. `MapNode` minus the labelling M2.1c adds, plus the `cell` it
 * grew from: M2.1b needs it to tell which side of the river a node is on, and M2.1c needs it to
 * tell a border node from an interior one. Both are grid questions, and recovering a cell from a
 * jittered position or by parsing an id would be guesswork dressed as arithmetic.
 */
export type TopologyNode = {
  readonly id: NodeId;
  readonly cell: GridCell;
  readonly position: Position;
};

/** `river` is `null` until M2.1b carves one. The type lives in `map.ts`, where `MapGraph` needs it too. */
export type MapTopology = {
  readonly nodes: readonly TopologyNode[];
  readonly edges: readonly MapEdge[];
  readonly river: River | null;
};

/** How many cells a set of nodes covers. Zero on an empty set. */
export type GridExtent = {
  readonly columns: number;
  readonly rows: number;
};

/**
 * The grid a finished topology came from, recovered from its cells. Both consumers of a topology
 * need it - M2.1b to tell one bank from the other, M2.1c to tell a border node from an interior
 * one - and it is the one grid fact that survives generation, since a jittered position cannot be
 * turned back into a cell.
 */
export const gridExtentOf = (nodes: readonly TopologyNode[]): GridExtent => ({
  columns: Math.max(0, ...nodes.map((node) => node.cell.column + 1)),
  rows: Math.max(0, ...nodes.map((node) => node.cell.row + 1)),
});

export type TopologyRequest = {
  readonly config: MapConfig;
  readonly balance: Balance;
  readonly state: RngState;
};

/**
 * `map_too_large` rather than a clamp: AGENTS.md section 5 wants oversized input rejected, not
 * truncated. There is no matching `map_too_small`, because an undersized grid costs nothing to
 * build and M2.2's validator is what rejects a map too small to hunt in.
 */
export type TopologyResult =
  | { readonly kind: "topology"; readonly topology: MapTopology; readonly state: RngState }
  | {
      readonly kind: "map_too_large";
      readonly requestedNodes: number;
      readonly maxNodes: number;
    };

export type TopologyLogic = {
  readonly generate: (request: TopologyRequest) => TopologyResult;
};

type TopologyDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

const MIN_GRID_SIDE = 1;

/** A `[0, 1)` draw spans `[-magnitude, +magnitude)`. */
const JITTER_SPAN = 2;

const gridSide = (value: number): number => Math.max(MIN_GRID_SIDE, Math.floor(value));

const gridNodeId = (column: number, row: number): NodeId => makeNodeId(`n-${column}-${row}`);

/** Kind-independent, because M2.1b turns some of these roads into bridges and keeps the id. */
const gridEdgeId = (column: number, row: number, axis: string): EdgeId =>
  makeEdgeId(`e-${column}-${row}-${axis}`);

/**
 * The two directions a grid edge can run, as data: the axis letter that goes into the edge id,
 * and the cell offset from one end to the other. One loop reads the table rather than two
 * near-identical loops reading each other's shape.
 *
 * Order is load-bearing. Edge order is the iteration order determinism depends on, so horizontal
 * before vertical is a fixed part of what a seed produces, not a preference.
 */
type GridAxis = {
  readonly letter: string;
  readonly column: number;
  readonly row: number;
};

const GRID_AXES: readonly GridAxis[] = [
  { letter: "h", column: 1, row: 0 },
  { letter: "v", column: 0, row: 1 },
];

const jitterOffset = (draw: number, magnitude: number): number =>
  (draw * JITTER_SPAN - 1) * magnitude;

type NodeBuild = {
  readonly nodes: readonly TopologyNode[];
  readonly state: RngState;
};

const buildNodes = (rng: Rng, balance: Balance, grid: GridExtent, state: RngState): NodeBuild => {
  const { nodeSpacing, positionJitter } = balance.map;
  const magnitude = nodeSpacing * positionJitter;
  const nodes: TopologyNode[] = [];
  let current = state;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const drawnX = rng.float(current);
      const drawnY = rng.float(drawnX.state);
      current = drawnY.state;
      nodes.push({
        id: gridNodeId(column, row),
        cell: { column, row },
        position: {
          x: column * nodeSpacing + jitterOffset(drawnX.value, magnitude),
          y: row * nodeSpacing + jitterOffset(drawnY.value, magnitude),
        },
      });
    }
  }
  return { nodes, state: current };
};

const axisEdges = (grid: GridExtent, axis: GridAxis): readonly MapEdge[] => {
  const edges: MapEdge[] = [];
  for (let row = 0; row + axis.row < grid.rows; row += 1) {
    for (let column = 0; column + axis.column < grid.columns; column += 1) {
      const id = gridEdgeId(column, row, axis.letter);
      const to = gridNodeId(column + axis.column, row + axis.row);
      edges.push(makeEdge("road", id, gridNodeId(column, row), to));
    }
  }
  return edges;
};

/** A road between every pair of cells that touch. */
const gridEdges = (grid: GridExtent): readonly MapEdge[] =>
  GRID_AXES.flatMap((axis) => axisEdges(grid, axis));

/**
 * Whether every node is still one journey away from every other, in `balance.map.escapeMode`.
 * That is the whole truth here only because every edge kind this file emits is foot-traversable;
 * revisit if rail ever appears in a topology.
 *
 * A search that hits `LIMITS.maxSearchExpansions` answers "no", which keeps the edge: the
 * conservative direction, because a denser graph can only be more connected, never less.
 */
const isConnected = (
  deps: TopologyDeps,
  balance: Balance,
  nodes: readonly TopologyNode[],
  edges: readonly MapEdge[],
): boolean => {
  const first = nodes[0];
  if (first === undefined) {
    return true;
  }
  const traversal: Traversal = { graph: { nodes, edges }, balance, mode: balance.map.escapeMode };
  const result = deps.graph.reachable(traversal, first.id);
  if (result.kind === "expansion_limit_exceeded") {
    return false;
  }
  return result.nodeIds.length === nodes.length;
};

type EdgeBuild = {
  readonly edges: readonly MapEdge[];
  readonly state: RngState;
};

/**
 * `edgeRemovalRate` is a rate of *attempts*, not of removals. Refusing to remove an edge that
 * would cut the city in two is the point of the pass, so the surviving count is an outcome; a
 * loop that kept going until it hit a quota would be unbounded on a grid that cannot spare one.
 */
const pruneEdges = (
  deps: TopologyDeps,
  balance: Balance,
  nodes: readonly TopologyNode[],
  edges: readonly MapEdge[],
  state: RngState,
): EdgeBuild => {
  const shuffled = deps.rng.shuffle(state, edges);
  const attempts = Math.round(edges.length * balance.map.edgeRemovalRate);
  let surviving = edges;
  for (const edge of shuffled.value.slice(0, attempts)) {
    const candidate = surviving.filter((survivor) => survivor.id !== edge.id);
    if (!isConnected(deps, balance, nodes, candidate)) {
      continue;
    }
    surviving = candidate;
  }
  return { edges: surviving, state: shuffled.state };
};

/**
 * Roads become footpaths in place, keeping their ids and endpoints. No connectivity re-check is
 * needed: both kinds are foot-traversable, so a conversion cannot disconnect what `pruneEdges`
 * left connected. It does remove the edge from the car network, which is intended - an alley is
 * not a road, and a roadblock cannot stand on one.
 */
const layFootpaths = (
  rng: Rng,
  balance: Balance,
  edges: readonly MapEdge[],
  state: RngState,
): EdgeBuild => {
  const count = Math.round(edges.length * balance.map.footpathRate);
  if (count === 0) {
    return { edges, state };
  }
  const shuffled = rng.shuffle(state, edges);
  const chosen = new Set(shuffled.value.slice(0, count).map((edge) => edge.id));
  return {
    edges: edges.map((edge) =>
      chosen.has(edge.id) ? makeEdge("footpath", edge.id, edge.from, edge.to) : edge,
    ),
    state: shuffled.state,
  };
};

export const createTopologyLogic = (deps: TopologyDeps): TopologyLogic => ({
  generate: ({ config, balance, state }) => {
    const grid = { columns: gridSide(config.columns), rows: gridSide(config.rows) };
    const requestedNodes = grid.columns * grid.rows;
    if (requestedNodes > LIMITS.maxMapNodes) {
      return { kind: "map_too_large", requestedNodes, maxNodes: LIMITS.maxMapNodes };
    }

    const built = buildNodes(deps.rng, balance, grid, state);
    const full = gridEdges(grid);
    const pruned = pruneEdges(deps, balance, built.nodes, full, built.state);
    const withPaths = layFootpaths(deps.rng, balance, pruned.edges, pruned.state);

    return {
      kind: "topology",
      topology: { nodes: built.nodes, edges: withPaths.edges, river: null },
      state: withPaths.state,
    };
  },
});
