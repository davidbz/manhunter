/**
 * The river (PLAN M2.1b): one watercourse across the city, crossable only at its bridges.
 *
 * This is the chokepoint M2.2 looks for and the reason a roadblock can ever be worth its trust
 * cost (DESIGN.md "The city is a character"). It runs after M2.1a and before any labelling: it
 * only ever removes edges and changes the kind of the survivors, so a topology in is a topology
 * out.
 *
 * The river is a staircase, held as one cut index per row (or per column, when it runs the other
 * way). A node's side is decided from its grid cell, not its position; the drawn polyline is
 * placed on the midlines between cells, so the two agree exactly as long as `positionJitter`
 * stays below half a cell - which `balance.test.ts` pins.
 */

import type { Balance } from "./balance";
import type { GraphLogic, Traversal } from "./graph";
import type { EdgeId, NodeId } from "./ids";
import { type MapEdge, makeEdge, type Position, type TravelMode } from "./map";
import type { Rng, RngState } from "./rng";
import type { MapTopology, TopologyNode } from "./topology";

export type RiverRequest = {
  readonly topology: MapTopology;
  readonly balance: Balance;
  readonly state: RngState;
};

/**
 * `river_not_bridgeable` is the honest failure when the grid offers fewer crossings than
 * `minBridges`, or when reconnecting the two banks would take more than `maxBridges`. Both are
 * properties of an unlucky M2.1a result, so M2.3 should treat this the way it treats a validator
 * violation: regenerate from a derived seed rather than relax the range.
 */
export type RiverResult =
  | { readonly kind: "river"; readonly topology: MapTopology; readonly state: RngState }
  | {
      readonly kind: "river_not_bridgeable";
      readonly crossings: number;
      readonly requiredBridges: number;
    };

export type RiverLogic = {
  readonly carve: (request: RiverRequest) => RiverResult;
};

type RiverDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

/** Which way the water runs. A vertical river separates east from west. */
type Orientation = "vertical" | "horizontal";

/** Same reasoning as `topology.ts`: the criminal walks, and every kind here is walkable. */
const CONNECTIVITY_MODE: TravelMode = "foot";

/**
 * How narrow a bank is allowed to get, in cells. One is legal geometry and a bad map: a
 * single-cell bank is a strip hanging off the city wall, joined only along itself, so any road
 * M2.1a removed from it splits it into pieces that each need their own bridge. Two cells gives a
 * bank enough internal redundancy to survive pruning, which is what keeps `river_not_bridgeable`
 * rare: over 2000 default-grid seeds it takes refusals from 12.2% to 3.5%.
 */
const MIN_BANK = 2;

/** A river needs a bank of its own on each side to run between. */
const MIN_SPAN = MIN_BANK * 2;

const DRIFT_MIN = -1;
const DRIFT_MAX_EXCLUSIVE = 2;

/** The river is drawn on the midline between two cells, half a cell short of either. */
const MIDLINE_OFFSET = 0.5;

type Grid = {
  readonly columns: number;
  readonly rows: number;
};

const gridOf = (nodes: readonly TopologyNode[]): Grid => ({
  columns: Math.max(0, ...nodes.map((node) => node.cell.column + 1)),
  rows: Math.max(0, ...nodes.map((node) => node.cell.row + 1)),
});

/**
 * How far along each step of the river the water sits, as a cut index. Index `c` means the water
 * passes between cell `c - 1` and cell `c`; holding it within `MIN_BANK` of either end is what
 * guarantees both banks a bank's worth of city.
 */
const carveCuts = (
  rng: Rng,
  state: RngState,
  along: number,
  across: number,
): { readonly cuts: readonly number[]; readonly state: RngState } => {
  const widest = across - MIN_BANK;
  const first = rng.int(state, MIN_BANK, widest + 1);
  const cuts: number[] = [first.value];
  let current = first.state;
  for (let step = 1; step < along; step += 1) {
    const drift = rng.int(current, DRIFT_MIN, DRIFT_MAX_EXCLUSIVE);
    current = drift.state;
    const previous = cuts.at(-1) ?? MIN_BANK;
    cuts.push(Math.min(widest, Math.max(MIN_BANK, previous + drift.value)));
  }
  return { cuts, state: current };
};

const cutAt = (cuts: readonly number[], index: number): number => cuts[index] ?? MIN_BANK;

/** True on the near bank: west of a vertical river, north of a horizontal one. */
const isNearBank = (
  node: TopologyNode,
  orientation: Orientation,
  cuts: readonly number[],
): boolean =>
  orientation === "vertical"
    ? node.cell.column < cutAt(cuts, node.cell.row)
    : node.cell.row < cutAt(cuts, node.cell.column);

/**
 * The staircase as a polyline: a segment down the middle of each step, joined by a segment across
 * wherever the river shifts. It runs half a cell beyond each end so that an edge on the outermost
 * row still meets it.
 */
const riverPoints = (
  orientation: Orientation,
  cuts: readonly number[],
  spacing: number,
): readonly Position[] => {
  const point = (across: number, along: number): Position =>
    orientation === "vertical"
      ? { x: across * spacing, y: along * spacing }
      : { x: along * spacing, y: across * spacing };
  const points: Position[] = [];
  for (const [step, cut] of cuts.entries()) {
    const across = cut - MIDLINE_OFFSET;
    points.push(point(across, step - MIDLINE_OFFSET), point(across, step + MIDLINE_OFFSET));
  }
  return points;
};

const feasibleOrientations = (grid: Grid): readonly Orientation[] => {
  const orientations: Orientation[] = [];
  if (grid.columns >= MIN_SPAN) {
    orientations.push("vertical");
  }
  if (grid.rows >= MIN_SPAN) {
    orientations.push("horizontal");
  }
  return orientations;
};

type Course = {
  readonly orientation: Orientation;
  readonly cuts: readonly number[];
  readonly state: RngState;
};

const plotCourse = (rng: Rng, state: RngState, grid: Grid): Course | null => {
  const feasible = feasibleOrientations(grid);
  const [only, ...rest] = feasible;
  if (only === undefined) {
    return null;
  }
  const chosen = rng.pick(state, [only, ...rest]);
  const vertical = chosen.value === "vertical";
  const along = vertical ? grid.rows : grid.columns;
  const across = vertical ? grid.columns : grid.rows;
  const carved = carveCuts(rng, chosen.state, along, across);
  return { orientation: chosen.value, cuts: carved.cuts, state: carved.state };
};

/**
 * One label per node, equal for any two nodes joined by the given edges. Built by repeated
 * reachability rather than a union-find: the graph is already the input to `GraphLogic`, and a
 * second traversal implementation in `core` is a second thing to keep correct.
 */
const componentLabels = (
  deps: RiverDeps,
  balance: Balance,
  nodes: readonly TopologyNode[],
  edges: readonly MapEdge[],
): Map<NodeId, number> => {
  const traversal: Traversal = { graph: { nodes, edges }, balance, mode: CONNECTIVITY_MODE };
  const labels = new Map<NodeId, number>();
  let nextLabel = 0;
  for (const node of nodes) {
    if (labels.has(node.id)) {
      continue;
    }
    const reached = deps.graph.reachable(traversal, node.id);
    const members = reached.kind === "reachable" ? reached.nodeIds : [node.id];
    for (const member of members) {
      labels.set(member, nextLabel);
    }
    nextLabel += 1;
  }
  return labels;
};

const relabel = (labels: Map<NodeId, number>, from: number, to: number): void => {
  for (const [nodeId, label] of labels) {
    if (label === from) {
      labels.set(nodeId, to);
    }
  }
};

/**
 * The crossings that have to stay, in shuffled order: each one joins two banks of the map that
 * nothing else joins. At most one fewer than the number of components, and usually exactly one.
 */
const essentialCrossings = (
  labels: Map<NodeId, number>,
  crossings: readonly MapEdge[],
): readonly MapEdge[] => {
  const essential: MapEdge[] = [];
  for (const edge of crossings) {
    const from = labels.get(edge.from);
    const to = labels.get(edge.to);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    relabel(labels, to, from);
    essential.push(edge);
  }
  return essential;
};

const toBridge = (edge: MapEdge): MapEdge => makeEdge("bridge", edge.id, edge.from, edge.to);

type Selection = {
  readonly chosen: ReadonlySet<EdgeId>;
  readonly state: RngState;
};

/**
 * Every crossing that has to stay, topped up at random to a drawn count inside the configured
 * range. The essential ones are taken first and never dropped, so the count can land above the
 * drawn one when reconnecting the banks demands it; it can never land above `maxBridges`, which
 * the caller has already refused.
 */
const selectBridges = (
  rng: Rng,
  balance: Balance,
  shuffled: readonly MapEdge[],
  essential: readonly MapEdge[],
  state: RngState,
): Selection => {
  const wanted = rng.int(state, balance.map.minBridges, balance.map.maxBridges + 1);
  const chosen = new Set<EdgeId>(essential.map((edge) => edge.id));
  for (const edge of shuffled) {
    if (chosen.size >= wanted.value) {
      break;
    }
    chosen.add(edge.id);
  }
  return { chosen, state: wanted.state };
};

const spanRiver = (
  edges: readonly MapEdge[],
  crosses: (edge: MapEdge) => boolean,
  chosen: ReadonlySet<EdgeId>,
): readonly MapEdge[] =>
  edges.flatMap((edge) => {
    if (!crosses(edge)) {
      return [edge];
    }
    return chosen.has(edge.id) ? [toBridge(edge)] : [];
  });

export const createRiverLogic = (deps: RiverDeps): RiverLogic => ({
  carve: ({ topology, balance, state }) => {
    const { minBridges, maxBridges, nodeSpacing } = balance.map;
    const course = plotCourse(deps.rng, state, gridOf(topology.nodes));
    if (course === null) {
      return { kind: "river_not_bridgeable", crossings: 0, requiredBridges: minBridges };
    }

    const banks = new Map<NodeId, boolean>(
      topology.nodes.map((node) => [node.id, isNearBank(node, course.orientation, course.cuts)]),
    );
    const crosses = (edge: MapEdge): boolean => banks.get(edge.from) !== banks.get(edge.to);
    const crossings = topology.edges.filter(crosses);
    if (crossings.length < minBridges) {
      return {
        kind: "river_not_bridgeable",
        crossings: crossings.length,
        requiredBridges: minBridges,
      };
    }

    const shuffled = deps.rng.shuffle(course.state, crossings);
    const banked = topology.edges.filter((edge) => !crosses(edge));
    const essential = essentialCrossings(
      componentLabels(deps, balance, topology.nodes, banked),
      shuffled.value,
    );
    if (essential.length > maxBridges) {
      return {
        kind: "river_not_bridgeable",
        crossings: crossings.length,
        requiredBridges: essential.length,
      };
    }

    const selected = selectBridges(deps.rng, balance, shuffled.value, essential, shuffled.state);
    return {
      kind: "river",
      topology: {
        nodes: topology.nodes,
        edges: spanRiver(topology.edges, crosses, selected.chosen),
        river: { points: riverPoints(course.orientation, course.cuts, nodeSpacing) },
      },
      state: selected.state,
    };
  },
});
