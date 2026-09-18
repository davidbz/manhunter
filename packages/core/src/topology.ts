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
import { type MapEdge, makeEdge, type Position, type TravelMode } from "./map";
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

/**
 * Where the river runs, in layout coordinates, or `null` before M2.1b carves one. Presentation
 * only: once generation finishes, everything the river does to the rules is already expressed in
 * which edges exist and which of them are bridges. M2.4 and M5.3a draw it; no rule reads it.
 */
export type River = {
  readonly points: readonly Position[];
};

export type MapTopology = {
  readonly nodes: readonly TopologyNode[];
  readonly edges: readonly MapEdge[];
  readonly river: River | null;
};

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

/**
 * Connectivity is checked on foot, for the same reason `minEscapeTurns` is measured on foot
 * (PLAN "Decisions"): the criminal walks. It is also the whole truth here, because every edge
 * kind this file emits is foot-traversable - revisit if rail ever appears in a topology.
 */
const CONNECTIVITY_MODE: TravelMode = "foot";

const MIN_GRID_SIDE = 1;

/** A `[0, 1)` draw spans `[-magnitude, +magnitude)`. */
const JITTER_SPAN = 2;

const gridSide = (value: number): number => Math.max(MIN_GRID_SIDE, Math.floor(value));

const gridNodeId = (column: number, row: number): NodeId => makeNodeId(`n-${column}-${row}`);

/** Kind-independent, because M2.1b turns some of these roads into bridges and keeps the id. */
const gridEdgeId = (column: number, row: number, axis: string): EdgeId =>
  makeEdgeId(`e-${column}-${row}-${axis}`);

const HORIZONTAL = "h";
const VERTICAL = "v";

const jitterOffset = (draw: number, magnitude: number): number =>
  (draw * JITTER_SPAN - 1) * magnitude;

type NodeBuild = {
  readonly nodes: readonly TopologyNode[];
  readonly state: RngState;
};

const buildNodes = (
  rng: Rng,
  balance: Balance,
  grid: { readonly columns: number; readonly rows: number },
  state: RngState,
): NodeBuild => {
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

const horizontalEdges = (grid: {
  readonly columns: number;
  readonly rows: number;
}): readonly MapEdge[] => {
  const edges: MapEdge[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column + 1 < grid.columns; column += 1) {
      const id = gridEdgeId(column, row, HORIZONTAL);
      edges.push(makeEdge("road", id, gridNodeId(column, row), gridNodeId(column + 1, row)));
    }
  }
  return edges;
};

const verticalEdges = (grid: {
  readonly columns: number;
  readonly rows: number;
}): readonly MapEdge[] => {
  const edges: MapEdge[] = [];
  for (let row = 0; row + 1 < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const id = gridEdgeId(column, row, VERTICAL);
      edges.push(makeEdge("road", id, gridNodeId(column, row), gridNodeId(column, row + 1)));
    }
  }
  return edges;
};

/**
 * Whether every node is still one walk away from every other. A search that hits
 * `LIMITS.maxSearchExpansions` answers "no", which keeps the edge: the conservative direction,
 * because a denser graph can only be more connected, never less.
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
  const traversal: Traversal = { graph: { nodes, edges }, balance, mode: CONNECTIVITY_MODE };
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
  if (count < MIN_GRID_SIDE) {
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
    const full = [...horizontalEdges(grid), ...verticalEdges(grid)];
    const pruned = pruneEdges(deps, balance, built.nodes, full, built.state);
    const withPaths = layFootpaths(deps.rng, balance, pruned.edges, pruned.state);

    return {
      kind: "topology",
      topology: { nodes: built.nodes, edges: withPaths.edges, river: null },
      state: withPaths.state,
    };
  },
});
