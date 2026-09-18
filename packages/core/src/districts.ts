/**
 * Labelling a finished topology into a city (PLAN M2.1c): what each district is, where the ways
 * out are, and where the hunt starts.
 *
 * This is the step that turns a `MapTopology` into a `MapGraph`. It adds no edge and removes
 * none, which is what makes it testable on its own and what makes the costs it measures still
 * true of the map it returns: once labelling is done, the distance from the start to an exit is
 * whatever M2.1a and M2.1b already built.
 *
 * Two of M2.2's validity rules are satisfied here by construction rather than left to luck, which
 * is what M2.1a's note asked for: exits are drawn from border nodes at least `minEscapeTurns`
 * away from the start on foot, and neither the start nor anything adjacent to it can become an
 * exit. Uniform placement over the border would have failed the escape-distance rule on roughly a
 * third of maps and spent a regeneration attempt on each.
 */

import type { Balance } from "./balance";
import type { MapConfig } from "./config";
import type { GraphLogic, Traversal } from "./graph";
import type { NodeId } from "./ids";
import {
  type DistrictType,
  type Exit,
  type ExitKind,
  type MapGraph,
  makeExit,
  makeNode,
  type TravelMode,
} from "./map";
import type { NonEmptyArray, Rng, RngState } from "./rng";
import { type GridCell, gridExtentOf, type MapTopology, type TopologyNode } from "./topology";

export type DistrictRequest = {
  readonly topology: MapTopology;
  readonly config: MapConfig;
  readonly balance: Balance;
  readonly state: RngState;
};

/**
 * `not_enough_exit_sites` is the honest failure when the topology has fewer usable border nodes
 * than `config.exitCount`: a city has to have somewhere to run to, and labelling cannot invent
 * one without adding nodes. It happens on grids too small to hold a start, its neighbours and the
 * requested exits, so M2.3 should treat it the way it treats M2.1b's refusal - regenerate from a
 * derived seed, and give up naming this reason rather than looping.
 */
export type DistrictResult =
  | { readonly kind: "map"; readonly graph: MapGraph; readonly state: RngState }
  | {
      readonly kind: "not_enough_exit_sites";
      readonly available: number;
      readonly requested: number;
    };

export type DistrictLogic = {
  readonly label: (request: DistrictRequest) => DistrictResult;
};

type DistrictDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

/**
 * Exit distance is measured on foot, for the same reason `minEscapeTurns` is (PLAN "Decisions"):
 * walking is the criminal's only MVP travel mode, so it is the honest floor on how long the run
 * out of the city takes.
 */
const DISTANCE_MODE: TravelMode = "foot";

/**
 * The regions a city is divided into, downtown first because it is pinned to the crime scene.
 * `exit` is deliberately absent: it is not a region, it is what an individual node becomes when
 * it is chosen as a way out.
 */
const REGION_TYPES: NonEmptyArray<DistrictType> = [
  "downtown",
  "residential",
  "transit_hub",
  "industrial",
  "park",
  "suburb",
];

/**
 * DESIGN.md's four kinds. Which kind an exit gets is flavour: no MVP rule reads it, and the
 * schedule that would (`timed`) is M6. Drawn uniformly rather than placed by geography - the
 * river is presentation only (M2.1b), so siting a port on it would be the first rule to read it.
 */
const EXIT_KINDS: NonEmptyArray<ExitKind> = ["airport", "port", "border", "highway"];

/** Half a span, so the centre of an even-sided grid falls between two cells. */
const HALF = 2;

const chebyshevFromCentre = (cell: GridCell, columns: number, rows: number): number =>
  Math.max(Math.abs(cell.column - (columns - 1) / HALF), Math.abs(cell.row - (rows - 1) / HALF));

const isBorder = (cell: GridCell, columns: number, rows: number): boolean =>
  cell.column === 0 || cell.row === 0 || cell.column === columns - 1 || cell.row === rows - 1;

/**
 * Nodes joined to `nodeId` by any edge, whatever its kind. Not `GraphLogic.neighbors`, which
 * filters by travel mode: DESIGN.md's "start is not adjacent to an exit" is about the city's
 * shape, and a footpath out of the crime scene is still a door.
 */
const adjacentNodeIds = (topology: MapTopology, nodeId: NodeId): ReadonlySet<NodeId> => {
  const found = new Set<NodeId>();
  for (const edge of topology.edges) {
    if (edge.from === nodeId) {
      found.add(edge.to);
    }
    if (edge.to === nodeId) {
      found.add(edge.from);
    }
  }
  return found;
};

const nonEmpty = <T>(items: readonly T[]): NonEmptyArray<T> | null => {
  const [first, ...rest] = items;
  return first === undefined ? null : [first, ...rest];
};

type StartChoice = {
  readonly start: TopologyNode;
  readonly state: RngState;
};

/**
 * The crime scene: an interior node within `startCentreRadius` cells of the middle. Interior, so
 * the start is never on the border and therefore never an exit and never adjacent to one across
 * the map's rim. A grid with no interior at all falls back to every node, and a radius that
 * catches nothing falls back to the single most central candidate, so this is total for any grid
 * the generator can produce - including the 1x1 one M2.1a normalises a degenerate config into.
 */
const chooseStart = (
  rng: Rng,
  balance: Balance,
  topology: MapTopology,
  state: RngState,
): StartChoice | null => {
  const { columns, rows } = gridExtentOf(topology.nodes);
  const interior = topology.nodes.filter((node) => !isBorder(node.cell, columns, rows));
  const pool = nonEmpty(interior) ?? nonEmpty(topology.nodes);
  if (pool === null) {
    return null;
  }
  const distance = (node: TopologyNode): number => chebyshevFromCentre(node.cell, columns, rows);
  const central = pool.filter((node) => distance(node) <= balance.map.startCentreRadius);
  const candidates =
    nonEmpty(central) ??
    nonEmpty(pool.filter((node) => distance(node) === Math.min(...pool.map(distance))));
  if (candidates === null) {
    return null;
  }
  const drawn = rng.pick(state, candidates);
  return { start: drawn.value, state: drawn.state };
};

type ExitSite = {
  readonly node: TopologyNode;
  readonly footCost: number;
};

/**
 * Every border node the criminal could plausibly be running to: reachable on foot, not the start,
 * and not next door to it. Costs come from one search per site rather than one sweep, because
 * `GraphLogic` answers "how far to this node" and "which node is nearest", not "how far to all of
 * them"; a border is a few dozen nodes and each search is bounded, so the cost is trivial.
 */
const exitSites = (
  deps: DistrictDeps,
  balance: Balance,
  topology: MapTopology,
  start: TopologyNode,
): readonly ExitSite[] => {
  const { columns, rows } = gridExtentOf(topology.nodes);
  const adjacent = adjacentNodeIds(topology, start.id);
  const traversal: Traversal = {
    graph: topology,
    balance,
    mode: DISTANCE_MODE,
  };
  const sites: ExitSite[] = [];
  for (const node of topology.nodes) {
    if (!isBorder(node.cell, columns, rows) || node.id === start.id || adjacent.has(node.id)) {
      continue;
    }
    const path = deps.graph.shortestPath(traversal, start.id, node.id);
    if (path.kind !== "path") {
      continue;
    }
    sites.push({ node, footCost: path.cost });
  }
  return sites;
};

type ExitChoice = {
  readonly nodeIds: readonly NodeId[];
  readonly state: RngState;
};

/**
 * Exits are drawn from the sites at least `minEscapeTurns` away on foot, which is what makes
 * M2.2's escape-distance rule pass by construction: the rule is about the *nearest* exit, so every
 * exit has to clear the threshold, and 89% of border nodes do on a default grid.
 *
 * When too few clear it the short ones are topped up farthest-first rather than at random. That
 * produces the best map this topology can support and lets M2.2 reject it on the merits, instead
 * of throwing away a topology that a different exit count would have accepted.
 */
const chooseExits = (
  rng: Rng,
  balance: Balance,
  sites: readonly ExitSite[],
  wanted: number,
  state: RngState,
): ExitChoice => {
  const qualifying = sites.filter((site) => site.footCost >= balance.map.minEscapeTurns);
  const shuffled = rng.shuffle(state, qualifying);
  if (shuffled.value.length >= wanted) {
    return {
      nodeIds: shuffled.value.slice(0, wanted).map((site) => site.node.id),
      state: shuffled.state,
    };
  }
  const chosen = new Set(shuffled.value.map((site) => site.node.id));
  const topUp = sites
    .filter((site) => !chosen.has(site.node.id))
    .toSorted((left, right) => right.footCost - left.footCost)
    .slice(0, wanted - shuffled.value.length);
  return {
    nodeIds: [...shuffled.value, ...topUp].map((site) => site.node.id),
    state: shuffled.state,
  };
};

type RegionSeed = {
  readonly node: TopologyNode;
  readonly districtType: DistrictType;
};

type Regions = {
  readonly seeds: readonly RegionSeed[];
  readonly state: RngState;
};

/**
 * One seed node per district type, downtown pinned to the crime scene. Everything else is drawn
 * without replacement, so each type owns exactly one seed and therefore at least its own node.
 *
 * Pinning downtown to the start is thematic rather than incidental: the crime happened in the busy
 * part of town, and because the start is central, so is downtown, which is what DESIGN.md's
 * district table assumes ("crowds help both sides").
 */
const seedRegions = (
  rng: Rng,
  nodes: readonly TopologyNode[],
  start: TopologyNode,
  state: RngState,
): Regions => {
  const [downtown, ...rest] = REGION_TYPES;
  const shuffled = rng.shuffle(
    state,
    nodes.filter((node) => node.id !== start.id),
  );
  const seeds: RegionSeed[] = [{ node: start, districtType: downtown }];
  for (const [index, districtType] of rest.entries()) {
    const node = shuffled.value[index];
    if (node === undefined) {
      break;
    }
    seeds.push({ node, districtType });
  }
  return { seeds, state: shuffled.state };
};

const cellKey = (cell: GridCell): string => `${cell.column},${cell.row}`;

const CELL_STEPS: readonly GridCell[] = [
  { column: 1, row: 0 },
  { column: -1, row: 0 },
  { column: 0, row: 1 },
  { column: 0, row: -1 },
];

type CellIndex = ReadonlyMap<string, TopologyNode>;

const cellIndexOf = (nodes: readonly TopologyNode[]): CellIndex =>
  new Map(nodes.map((node) => [cellKey(node.cell), node]));

/**
 * Grid neighbours, not graph neighbours. Regions are a property of the city's layout, so they
 * spread over cells that touch; whether M2.1a left a road between two of them decides how the
 * criminal travels, not whether they are the same part of town.
 */
const cellNeighbors = (index: CellIndex, cell: GridCell): readonly TopologyNode[] =>
  CELL_STEPS.flatMap((step) => {
    const found = index.get(
      cellKey({ column: cell.column + step.column, row: cell.row + step.row }),
    );
    return found === undefined ? [] : [found];
  });

/** One ring of growth for one region. Claims are first-come, so two regions never overlap. */
const advanceRegion = (
  index: CellIndex,
  claimed: Map<NodeId, DistrictType>,
  frontier: readonly TopologyNode[],
  districtType: DistrictType,
): readonly TopologyNode[] => {
  const next: TopologyNode[] = [];
  for (const node of frontier) {
    for (const neighbor of cellNeighbors(index, node.cell)) {
      if (claimed.has(neighbor.id)) {
        continue;
      }
      claimed.set(neighbor.id, districtType);
      next.push(neighbor);
    }
  }
  return next;
};

/**
 * Regions grown outward from their seeds, one ring at a time and one region per turn, rather than
 * assigned to whichever seed is nearest.
 *
 * Growth is chosen for the guarantee, not for measured behaviour: a node is only ever claimed from
 * an already-claimed neighbour of the same region, so every region is contiguous by construction
 * and `districts.test.ts` can assert it outright. Nearest-seed was written first and measures
 * identically (0 fragmented regions over 500 default-grid seeds with no exits), but its contiguity
 * is a coincidence of well-spaced seeds rather than a property: L1 ties are everywhere on a coarse
 * grid, and the lattice points of a convex region need not touch, so a 501st seed could fragment.
 *
 * Contiguity holds of the *grown* labelling. Exits overwrite it afterwards and can carve a node
 * out of the middle of a region, which is why the test asserts this with `exitCount: 0`.
 *
 * The loop is bounded by the node count: every ring claims at least one node or ends the growth,
 * and `LIMITS.maxMapNodes` already bounds how many nodes there can be.
 */
const growRegions = (
  nodes: readonly TopologyNode[],
  seeds: readonly RegionSeed[],
): ReadonlyMap<NodeId, DistrictType> => {
  const index = cellIndexOf(nodes);
  const claimed = new Map<NodeId, DistrictType>();
  let frontiers = seeds.map((seed) => [seed.node]);
  for (const seed of seeds) {
    claimed.set(seed.node.id, seed.districtType);
  }
  for (let ring = 0; ring < nodes.length && frontiers.some((one) => one.length > 0); ring += 1) {
    frontiers = seeds.map((seed, position) =>
      advanceRegion(index, claimed, frontiers[position] ?? [], seed.districtType).slice(),
    );
  }
  return claimed;
};

type ExitBuild = {
  readonly exits: readonly Exit[];
  readonly state: RngState;
};

const buildExits = (rng: Rng, nodeIds: readonly NodeId[], state: RngState): ExitBuild => {
  const exits: Exit[] = [];
  let current = state;
  for (const nodeId of nodeIds) {
    const drawn = rng.pick(current, EXIT_KINDS);
    current = drawn.state;
    exits.push(makeExit(nodeId, drawn.value));
  }
  return { exits, state: current };
};

const EXIT_DISTRICT: DistrictType = "exit";

export const createDistrictLogic = (deps: DistrictDeps): DistrictLogic => ({
  label: ({ topology, config, balance, state }) => {
    const wanted = Math.max(0, Math.floor(config.exitCount));
    const started = chooseStart(deps.rng, balance, topology, state);
    if (started === null) {
      return { kind: "not_enough_exit_sites", available: 0, requested: wanted };
    }

    const sites = exitSites(deps, balance, topology, started.start);
    if (sites.length < wanted) {
      return { kind: "not_enough_exit_sites", available: sites.length, requested: wanted };
    }

    const chosen = chooseExits(deps.rng, balance, sites, wanted, started.state);
    const exitIds = new Set(chosen.nodeIds);
    const regions = seedRegions(deps.rng, topology.nodes, started.start, chosen.state);
    const grown = growRegions(topology.nodes, regions.seeds);
    const built = buildExits(deps.rng, chosen.nodeIds, regions.state);

    return {
      kind: "map",
      graph: {
        nodes: topology.nodes.map((node) =>
          makeNode(
            node.id,
            exitIds.has(node.id) ? EXIT_DISTRICT : (grown.get(node.id) ?? REGION_TYPES[0]),
            node.position,
          ),
        ),
        edges: topology.edges,
        exits: built.exits,
        river: topology.river,
        incidentNodeId: started.start.id,
      },
      state: built.state,
    };
  },
});
