import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./balance";
import type { MapConfig } from "./config";
import { createDistrictLogic, type DistrictResult } from "./districts";
import { createGraphLogic } from "./graph";
import type { NodeId } from "./ids";
import type { DistrictType, MapGraph } from "./map";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { createTopologyLogic, type GridCell, type MapTopology } from "./topology";

const rng = createRng();
const graph = createGraphLogic();
const topologyLogic = createTopologyLogic({ rng, graph });
const riverLogic = createRiverLogic({ rng, graph });
const districts = createDistrictLogic({ rng, graph });

const DEFAULT_CONFIG = BALANCE.map.defaults;
/** Labelling only: exits carve nodes out of regions, so contiguity is asserted without them. */
const NO_EXITS: MapConfig = { ...DEFAULT_CONFIG, exitCount: 0 };
const SINGLE_CELL: MapConfig = { columns: 1, rows: 1, exitCount: 3 };
const SEED = 1;
const OTHER_SEED = 2;
const PROPERTY_RUNS = 50;

/**
 * Where the escape-distance rule is measured from, mirroring `DISTANCE_MODE`. M2.2 owns the rule;
 * this file owns the claim that M2.1c hands it a map that already passes.
 */
const DISTANCE_MODE = "foot" as const;

/** The district types that are regions. `exit` is a label on a node, not a region. */
const REGION_COUNT = 6;

/** Farther on foot than any node of any grid the generator can build, so nothing qualifies. */
const UNREACHABLE_THRESHOLD = 1_000;

/** Wider than any grid, so the centre radius stops narrowing the start and only "interior" does. */
const UNBOUNDED_RADIUS = 1_000;

/** No distance requirement, so every border site qualifies and only the exclusions can exclude. */
const NO_THRESHOLD = 0;

/** Narrower than the half-cell offset of an even-sided grid's centre, so no cell is within it. */
const NO_RADIUS = 0;

/**
 * A grid whose every interior node touches the rim. On the default 8x6 grid a start within
 * `startCentreRadius` of the middle is always two cells clear of the border, so its neighbours are
 * not border sites and the "not adjacent to the start" exclusion has nothing to exclude.
 */
const TIGHT_CONFIG: MapConfig = { columns: 4, rows: 4, exitCount: 3 };

const withMap = (overrides: Partial<Balance["map"]>): Balance => ({
  ...BALANCE,
  map: { ...BALANCE.map, ...overrides },
});

type Built = {
  readonly topology: MapTopology;
  readonly result: DistrictResult;
};

const build = (seed: number, config: MapConfig, balance: Balance = BALANCE): Built => {
  const generated = topologyLogic.generate({ config, balance, state: rng.seed(seed) });
  if (generated.kind !== "topology") {
    throw new Error(`topology refused seed ${seed}: ${generated.kind}`);
  }
  return {
    topology: generated.topology,
    result: districts.label({
      topology: generated.topology,
      config,
      balance,
      state: generated.state,
    }),
  };
};

const labelled = (seed: number, config: MapConfig, balance: Balance = BALANCE): MapGraph => {
  const { result } = build(seed, config, balance);
  if (result.kind !== "map") {
    throw new Error(`labelling refused seed ${seed}: ${result.kind}`);
  }
  return result.graph;
};

const cellsOf = (topology: MapTopology): ReadonlyMap<NodeId, GridCell> =>
  new Map(topology.nodes.map((node) => [node.id, node.cell]));

const gridOf = (topology: MapTopology): { columns: number; rows: number } => ({
  columns: Math.max(0, ...topology.nodes.map((node) => node.cell.column + 1)),
  rows: Math.max(0, ...topology.nodes.map((node) => node.cell.row + 1)),
});

const isBorderCell = (cell: GridCell, columns: number, rows: number): boolean =>
  cell.column === 0 || cell.row === 0 || cell.column === columns - 1 || cell.row === rows - 1;

const footCost = (map: MapGraph, from: NodeId, to: NodeId): number => {
  const path = graph.shortestPath({ graph: map, balance: BALANCE, mode: DISTANCE_MODE }, from, to);
  return path.kind === "path" ? path.cost : Number.POSITIVE_INFINITY;
};

const neighborsOf = (map: MapGraph, nodeId: NodeId): ReadonlySet<NodeId> => {
  const found = new Set<NodeId>();
  for (const edge of map.edges) {
    if (edge.from === nodeId) {
      found.add(edge.to);
    }
    if (edge.to === nodeId) {
      found.add(edge.from);
    }
  }
  return found;
};

/**
 * Whether every node of every district forms one piece over grid adjacency. An independent check:
 * it walks cells and never consults the seeds or the growth order the generator used.
 */
const fragmentedDistricts = (map: MapGraph, topology: MapTopology): readonly DistrictType[] => {
  const cells = cellsOf(topology);
  const byType = new Map<DistrictType, NodeId[]>();
  for (const node of map.nodes) {
    byType.set(node.districtType, [...(byType.get(node.districtType) ?? []), node.id]);
  }
  const fragmented: DistrictType[] = [];
  for (const [districtType, ids] of byType) {
    const touches = (left: NodeId, right: NodeId): boolean => {
      const a = cells.get(left);
      const b = cells.get(right);
      if (a === undefined || b === undefined) {
        return false;
      }
      return Math.abs(a.column - b.column) + Math.abs(a.row - b.row) === 1;
    };
    const [first] = ids;
    if (first === undefined) {
      continue;
    }
    const seen = new Set<NodeId>([first]);
    let grew = true;
    while (grew) {
      grew = false;
      const reached = ids.filter(
        (other) => !seen.has(other) && [...seen].some((inside) => touches(inside, other)),
      );
      for (const other of reached) {
        seen.add(other);
        grew = true;
      }
    }
    if (seen.size !== ids.length) {
      fragmented.push(districtType);
    }
  }
  return fragmented;
};

describe("createDistrictLogic", () => {
  it("gives every node a district", () => {
    const map = labelled(SEED, DEFAULT_CONFIG);
    expect(map.nodes).toHaveLength(DEFAULT_CONFIG.columns * DEFAULT_CONFIG.rows);
    for (const node of map.nodes) {
      expect(typeof node.districtType).toBe("string");
    }
  });

  it("places the requested number of exits, each with a kind", () => {
    const map = labelled(SEED, DEFAULT_CONFIG);
    expect(map.exits).toHaveLength(DEFAULT_CONFIG.exitCount);
    for (const exit of map.exits) {
      expect(["airport", "port", "border", "highway"]).toContain(exit.kind);
      expect(exit.schedule).toEqual({ kind: "always" });
    }
  });

  it("labels exactly the exit nodes as the exit district", () => {
    const map = labelled(SEED, DEFAULT_CONFIG);
    const exitIds = new Set(map.exits.map((exit) => exit.nodeId));
    for (const node of map.nodes) {
      expect(node.districtType === "exit").toBe(exitIds.has(node.id));
    }
  });

  it("puts the crime scene downtown", () => {
    const map = labelled(SEED, DEFAULT_CONFIG);
    const start = map.nodes.find((node) => node.id === map.incidentNodeId);
    expect(start?.districtType).toBe("downtown");
  });

  it("adds no edge, removes none, and keeps the river", () => {
    const { topology, result } = build(SEED, DEFAULT_CONFIG);
    if (result.kind !== "map") {
      throw new Error(result.kind);
    }
    expect(result.graph.edges).toEqual(topology.edges);
    expect(result.graph.river).toBe(topology.river);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(
      topology.nodes.map((node) => node.id),
    );
  });

  it("is deterministic for one seed and differs across seeds", () => {
    expect(labelled(SEED, DEFAULT_CONFIG)).toEqual(labelled(SEED, DEFAULT_CONFIG));
    expect(labelled(OTHER_SEED, DEFAULT_CONFIG)).not.toEqual(labelled(SEED, DEFAULT_CONFIG));
  });

  it("refuses when the grid has nowhere to run to", () => {
    const { result } = build(SEED, SINGLE_CELL);
    expect(result).toEqual({
      kind: "not_enough_exit_sites",
      available: 0,
      requested: SINGLE_CELL.exitCount,
    });
  });

  test.prop([fc.integer({ min: 1, max: 5_000 })], { numRuns: PROPERTY_RUNS })(
    "keeps the start off the border even when the centre radius stops narrowing it",
    (seed) => {
      const balance = withMap({ startCentreRadius: UNBOUNDED_RADIUS });
      const { topology, result } = build(seed, DEFAULT_CONFIG, balance);
      if (result.kind !== "map") {
        return;
      }
      const { columns, rows } = gridOf(topology);
      const cell = cellsOf(topology).get(result.graph.incidentNodeId);
      expect(cell !== undefined && !isBorderCell(cell, columns, rows)).toBe(true);
    },
  );

  test.prop([fc.integer({ min: 1, max: 5_000 })], { numRuns: PROPERTY_RUNS })(
    "never puts an exit next door to the start even when every border site qualifies",
    (seed) => {
      const balance = withMap({ minEscapeTurns: NO_THRESHOLD });
      const map = labelled(seed, TIGHT_CONFIG, balance);
      const adjacent = neighborsOf(map, map.incidentNodeId);
      expect(map.exits.length).toBe(TIGHT_CONFIG.exitCount);
      for (const exit of map.exits) {
        expect(adjacent.has(exit.nodeId)).toBe(false);
      }
    },
  );

  it("carries a carved river through to the map", () => {
    const generated = topologyLogic.generate({
      config: DEFAULT_CONFIG,
      balance: BALANCE,
      state: rng.seed(SEED),
    });
    if (generated.kind !== "topology") {
      throw new Error(generated.kind);
    }
    const carved = riverLogic.carve({
      topology: generated.topology,
      balance: BALANCE,
      state: generated.state,
    });
    if (carved.kind !== "river") {
      throw new Error(carved.kind);
    }
    const result = districts.label({
      topology: carved.topology,
      config: DEFAULT_CONFIG,
      balance: BALANCE,
      state: carved.state,
    });
    if (result.kind !== "map") {
      throw new Error(result.kind);
    }
    expect(carved.topology.river).not.toBeNull();
    expect(result.graph.river).toEqual(carved.topology.river);
  });

  it("falls back to the most central node when the centre radius catches nothing", () => {
    const balance = withMap({ startCentreRadius: NO_RADIUS });
    const { topology, result } = build(SEED, NO_EXITS, balance);
    if (result.kind !== "map") {
      throw new Error(result.kind);
    }
    const { columns, rows } = gridOf(topology);
    const cell = cellsOf(topology).get(result.graph.incidentNodeId);
    if (cell === undefined) {
      throw new Error("start is not a node of the topology");
    }
    const centred = (of: GridCell): number =>
      Math.max(Math.abs(of.column - (columns - 1) / 2), Math.abs(of.row - (rows - 1) / 2));
    const closest = Math.min(...topology.nodes.map((node) => centred(node.cell)));
    expect(centred(cell)).toBe(closest);
  });

  it("refuses an empty topology rather than labelling nothing", () => {
    const result = districts.label({
      topology: { nodes: [], edges: [], river: null },
      config: DEFAULT_CONFIG,
      balance: BALANCE,
      state: rng.seed(SEED),
    });
    expect(result).toEqual({
      kind: "not_enough_exit_sites",
      available: 0,
      requested: DEFAULT_CONFIG.exitCount,
    });
  });

  it("labels a grid with no interior rather than refusing", () => {
    const map = labelled(SEED, { columns: 2, rows: 2, exitCount: 0 });
    expect(map.nodes).toHaveLength(4);
    expect(map.exits).toEqual([]);
  });
});

describe("exit placement", () => {
  /**
   * The point of the task. M2.2's escape-distance rule is about the *nearest* exit, so every exit
   * has to clear `minEscapeTurns`; drawing them from the sites that do makes the rule free instead
   * of costing roughly one regeneration in three (M2.1a's measurement).
   */
  test.prop([fc.integer({ min: 1, max: 5_000 })], { numRuns: PROPERTY_RUNS })(
    "puts every exit at least minEscapeTurns from the start on foot",
    (seed) => {
      const map = labelled(seed, DEFAULT_CONFIG);
      for (const exit of map.exits) {
        expect(footCost(map, map.incidentNodeId, exit.nodeId)).toBeGreaterThanOrEqual(
          BALANCE.map.minEscapeTurns,
        );
      }
    },
  );

  test.prop([fc.integer({ min: 1, max: 5_000 })], { numRuns: PROPERTY_RUNS })(
    "keeps exits on the border, off the start, and never next door to it",
    (seed) => {
      const { topology, result } = build(seed, DEFAULT_CONFIG);
      if (result.kind !== "map") {
        return;
      }
      const map = result.graph;
      const { columns, rows } = gridOf(topology);
      const cells = cellsOf(topology);
      const adjacent = neighborsOf(map, map.incidentNodeId);
      const startCell = cells.get(map.incidentNodeId);
      expect(startCell === undefined || !isBorderCell(startCell, columns, rows)).toBe(true);
      for (const exit of map.exits) {
        const cell = cells.get(exit.nodeId);
        expect(cell !== undefined && isBorderCell(cell, columns, rows)).toBe(true);
        expect(exit.nodeId).not.toBe(map.incidentNodeId);
        expect(adjacent.has(exit.nodeId)).toBe(false);
      }
    },
  );

  it("tops up with the farthest short sites when too few qualify", () => {
    /** An unreachable threshold, so nothing qualifies and every exit comes from the top-up. */
    const balance = withMap({ minEscapeTurns: UNREACHABLE_THRESHOLD });
    const { topology, result } = build(SEED, DEFAULT_CONFIG, balance);
    if (result.kind !== "map") {
      throw new Error(result.kind);
    }
    const map = result.graph;
    expect(map.exits).toHaveLength(DEFAULT_CONFIG.exitCount);

    const { columns, rows } = gridOf(topology);
    const cells = cellsOf(topology);
    const adjacent = neighborsOf(map, map.incidentNodeId);
    const chosen = new Set(map.exits.map((exit) => exit.nodeId));
    const eligible = map.nodes.filter((node) => {
      const cell = cells.get(node.id);
      return (
        cell !== undefined &&
        isBorderCell(cell, columns, rows) &&
        node.id !== map.incidentNodeId &&
        !adjacent.has(node.id) &&
        Number.isFinite(footCost(map, map.incidentNodeId, node.id))
      );
    });
    const costOf = (nodeId: NodeId): number => footCost(map, map.incidentNodeId, nodeId);
    const rejected = eligible.filter((node) => !chosen.has(node.id)).map((node) => costOf(node.id));
    /** Farthest-first, so no exit is closer than a site that was passed over. Tie-safe. */
    for (const exit of map.exits) {
      expect(costOf(exit.nodeId)).toBeGreaterThanOrEqual(Math.max(...rejected));
    }
  });
});

describe("district regions", () => {
  test.prop([fc.integer({ min: 1, max: 5_000 })], { numRuns: PROPERTY_RUNS })(
    "grows every district as one contiguous region",
    (seed) => {
      const { topology, result } = build(seed, NO_EXITS);
      if (result.kind !== "map") {
        return;
      }
      expect(fragmentedDistricts(result.graph, topology)).toEqual([]);
    },
  );

  it("uses every region type on a default grid", () => {
    const map = labelled(SEED, NO_EXITS);
    expect(new Set(map.nodes.map((node) => node.districtType)).size).toBe(REGION_COUNT);
  });

  it("does not spread a region into a grid that cannot hold one per type", () => {
    const map = labelled(SEED, { columns: 2, rows: 2, exitCount: 0 });
    expect(new Set(map.nodes.map((node) => node.districtType)).size).toBe(4);
  });
});
