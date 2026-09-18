import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./balance";
import type { MapConfig } from "./config";
import { createGraphLogic } from "./graph";
import { LIMITS } from "./limits";
import { createRng } from "./rng";
import { createTopologyLogic, type MapTopology, type TopologyResult } from "./topology";

const rng = createRng();
const graph = createGraphLogic();
const topology = createTopologyLogic({ rng, graph });

const SMALL: MapConfig = { columns: 4, rows: 3, exitCount: 3 };
const DEFAULT_CONFIG = BALANCE.map.defaults;
const SEED = 1;
const OTHER_SEED = 2;
const PROPERTY_RUNS = 50;

const withMap = (overrides: Partial<Balance["map"]>): Balance => ({
  ...BALANCE,
  map: { ...BALANCE.map, ...overrides },
});

const generate = (config: MapConfig, seed: number, balance: Balance = BALANCE): TopologyResult =>
  topology.generate({ config, balance, state: rng.seed(seed) });

const expectTopology = (result: TopologyResult): MapTopology => {
  if (result.kind !== "topology") {
    throw new Error(`expected a topology, got ${result.kind}`);
  }
  return result.topology;
};

const isConnected = (built: MapTopology, balance: Balance = BALANCE): boolean => {
  const first = built.nodes[0];
  if (first === undefined) {
    return true;
  }
  const reached = graph.reachable({ graph: built, balance, mode: "foot" }, first.id);
  return reached.kind === "reachable" && reached.nodeIds.length === built.nodes.length;
};

describe("grid", () => {
  it("builds one node per cell with unique ids", () => {
    const built = expectTopology(generate(SMALL, SEED));
    expect(built.nodes).toHaveLength(SMALL.columns * SMALL.rows);
    expect(new Set(built.nodes.map((node) => node.id)).size).toBe(built.nodes.length);
  });

  it("jitters positions off their cell without leaving it", () => {
    const built = expectTopology(generate(SMALL, SEED));
    const { nodeSpacing, positionJitter } = BALANCE.map;
    const drift = built.nodes.map((node, index) => {
      const column = index % SMALL.columns;
      const row = Math.floor(index / SMALL.columns);
      return Math.max(
        Math.abs(node.position.x - column * nodeSpacing),
        Math.abs(node.position.y - row * nodeSpacing),
      );
    });
    expect(Math.max(...drift)).toBeLessThanOrEqual(nodeSpacing * positionJitter);
    expect(Math.max(...drift)).toBeGreaterThan(0);
  });

  it("treats a degenerate grid as a single cell rather than failing", () => {
    const built = expectTopology(generate({ columns: 0, rows: 0, exitCount: 0 }, SEED));
    expect(built.nodes).toHaveLength(1);
    expect(built.edges).toHaveLength(0);
  });

  it("joins only grid neighbours, and every edge to nodes that exist", () => {
    const built = expectTopology(generate(SMALL, SEED));
    const ids = new Set(built.nodes.map((node) => node.id));
    expect(new Set(built.edges.map((edge) => edge.id)).size).toBe(built.edges.length);
    for (const edge of built.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
      expect(edge.from).not.toBe(edge.to);
    }
  });
});

describe("edge removal", () => {
  it("removes some of the full grid's edges", () => {
    const built = expectTopology(generate(DEFAULT_CONFIG, SEED));
    const { columns, rows } = DEFAULT_CONFIG;
    const fullGrid = (columns - 1) * rows + columns * (rows - 1);
    expect(built.edges.length).toBeLessThan(fullGrid);
  });

  it("removes nothing when the rate is zero", () => {
    const built = expectTopology(generate(SMALL, SEED, withMap({ edgeRemovalRate: 0 })));
    const fullGrid = (SMALL.columns - 1) * SMALL.rows + SMALL.columns * (SMALL.rows - 1);
    expect(built.edges).toHaveLength(fullGrid);
  });

  it("keeps the graph connected even when asked to remove every edge", () => {
    const built = expectTopology(generate(DEFAULT_CONFIG, SEED, withMap({ edgeRemovalRate: 1 })));
    expect(isConnected(built)).toBe(true);
    // A connected graph of n nodes needs at least n - 1 edges, so the pass had to refuse some.
    expect(built.edges.length).toBeGreaterThanOrEqual(built.nodes.length - 1);
  });
});

describe("footpaths", () => {
  it("lays footpaths, because they are the only unblockable edge kind", () => {
    const built = expectTopology(generate(DEFAULT_CONFIG, SEED));
    const footpaths = built.edges.filter((edge) => edge.kind === "footpath");
    expect(footpaths.length).toBeGreaterThan(0);
    expect(BALANCE.edges.footpath.blockable).toBe(false);
  });

  it("converts the configured fraction of the surviving edges", () => {
    const built = expectTopology(generate(DEFAULT_CONFIG, SEED));
    const footpaths = built.edges.filter((edge) => edge.kind === "footpath");
    expect(footpaths).toHaveLength(Math.round(built.edges.length * BALANCE.map.footpathRate));
  });

  it("lays none when the rate is zero", () => {
    const built = expectTopology(generate(SMALL, SEED, withMap({ footpathRate: 0 })));
    expect(built.edges.every((edge) => edge.kind === "road")).toBe(true);
  });

  it("keeps the edge's id and endpoints, so M2.1b can still find it", () => {
    const roads = expectTopology(generate(SMALL, SEED, withMap({ footpathRate: 0 })));
    const paths = expectTopology(generate(SMALL, SEED, withMap({ footpathRate: 1 })));
    expect(paths.edges.map((edge) => edge.kind)).toEqual(paths.edges.map(() => "footpath"));
    expect(paths.edges.map(({ id, from, to }) => ({ id, from, to }))).toEqual(
      roads.edges.map(({ id, from, to }) => ({ id, from, to })),
    );
  });
});

describe("bounds", () => {
  it("rejects a grid over the node limit rather than building it", () => {
    const result = generate({ columns: LIMITS.maxMapNodes + 1, rows: 1, exitCount: 3 }, SEED);
    expect(result).toEqual({
      kind: "map_too_large",
      requestedNodes: LIMITS.maxMapNodes + 1,
      maxNodes: LIMITS.maxMapNodes,
    });
  });

  it("accepts a grid exactly at the node limit", () => {
    const result = generate({ columns: LIMITS.maxMapNodes, rows: 1, exitCount: 3 }, SEED);
    expect(expectTopology(result).nodes).toHaveLength(LIMITS.maxMapNodes);
  });

  it("counts the normalised grid, not the requested one", () => {
    const result = generate({ columns: LIMITS.maxMapNodes, rows: 0, exitCount: 3 }, SEED);
    expect(expectTopology(result).nodes).toHaveLength(LIMITS.maxMapNodes);
  });
});

describe("determinism", () => {
  it("gives an identical topology for the same seed", () => {
    expect(generate(DEFAULT_CONFIG, SEED)).toEqual(generate(DEFAULT_CONFIG, SEED));
  });

  it("gives a different topology for a different seed", () => {
    expect(generate(DEFAULT_CONFIG, SEED)).not.toEqual(generate(DEFAULT_CONFIG, OTHER_SEED));
  });

  it("advances the stream, so the caller draws fresh values afterwards", () => {
    const result = generate(SMALL, SEED);
    if (result.kind !== "topology") {
      throw new Error("expected a topology");
    }
    expect(result.state).not.toEqual(rng.seed(SEED));
  });

  it("round-trips through JSON", () => {
    const built = expectTopology(generate(DEFAULT_CONFIG, SEED));
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
});

describe("properties over seeds", () => {
  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })(
    "always produces a connected topology",
    (seed) => {
      expect(isConnected(expectTopology(generate(DEFAULT_CONFIG, seed)))).toBe(true);
    },
  );

  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })("is reproducible from its seed", (seed) => {
    expect(generate(DEFAULT_CONFIG, seed)).toEqual(generate(DEFAULT_CONFIG, seed));
  });
});
