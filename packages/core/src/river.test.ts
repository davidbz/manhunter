import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./balance";
import type { MapConfig } from "./config";
import { createGraphLogic } from "./graph";
import type { MapEdge, Position } from "./map";
import { createRiverLogic, type RiverResult } from "./river";
import { createRng } from "./rng";
import { createTopologyLogic, type MapTopology } from "./topology";

const rng = createRng();
const graph = createGraphLogic();
const topology = createTopologyLogic({ rng, graph });
const river = createRiverLogic({ rng, graph });

const DEFAULT_CONFIG = BALANCE.map.defaults;
const SINGLE_CELL: MapConfig = { columns: 1, rows: 1, exitCount: 0 };
/** Three cells across cannot hold two banks and the water between them. */
const TOO_NARROW: MapConfig = { columns: 3, rows: 3, exitCount: 0 };
const SEED = 1;
const OTHER_SEED = 2;
const PROPERTY_RUNS = 50;

/**
 * The refusal budget. `river_not_bridgeable` is a real outcome, so the properties below cannot
 * demand a river on every seed - but they would go vacuous if it started refusing everything,
 * and each refusal costs M2.3 a whole map regeneration. This pins the rate at a fixed range of
 * seeds, well above the 3% measured on this generator and well below anything that would hurt.
 */
const BUDGET_SEEDS = 200;
const MAX_REFUSAL_RATE = 0.1;

/** The narrowest bank the generator is allowed to leave, in cells. Mirrors `MIN_BANK`. */
const MIN_BANK_CELLS = 2;

/** No pruning, so each bank is internally complete and the bridges are its only joins. */
const UNPRUNED: Partial<Balance["map"]> = { edgeRemovalRate: 0 };

const withMap = (overrides: Partial<Balance["map"]>): Balance => ({
  ...BALANCE,
  map: { ...BALANCE.map, ...overrides },
});

const buildTopology = (config: MapConfig, seed: number, balance: Balance = BALANCE) => {
  const result = topology.generate({ config, balance, state: rng.seed(seed) });
  if (result.kind !== "topology") {
    throw new Error(`expected a topology, got ${result.kind}`);
  }
  return result;
};

const carve = (config: MapConfig, seed: number, balance: Balance = BALANCE): RiverResult => {
  const built = buildTopology(config, seed, balance);
  return river.carve({ topology: built.topology, balance, state: built.state });
};

const expectRiver = (result: RiverResult): MapTopology => {
  if (result.kind !== "river") {
    throw new Error(`expected a river, got ${result.kind}`);
  }
  return result.topology;
};

/**
 * A refusal is part of the contract, not a hole in the test: an unlucky M2.1a result really can
 * leave banks that `maxBridges` cannot rejoin. What every refusal still owes us is a reason that
 * genuinely disqualifies the course, which is what this checks before letting the caller skip.
 */
const riverOrSoundRefusal = (result: RiverResult): MapTopology | null => {
  if (result.kind === "river") {
    return result.topology;
  }
  const overBudget = result.requiredBridges > BALANCE.map.maxBridges;
  const tooFewCrossings = result.crossings < BALANCE.map.minBridges;
  expect(overBudget || tooFewCrossings).toBe(true);
  return null;
};

/**
 * The cut index behind each step of the staircase, recovered from the drawn polyline. The two
 * points of a step share their across coordinate, which is what tells the orientation apart.
 */
const acrossSeries = (built: MapTopology): readonly number[] => {
  const points = built.river?.points ?? [];
  const [first, second] = points;
  const vertical = first !== undefined && second !== undefined && first.x === second.x;
  return points.filter((_point, index) => index % 2 === 0).map((p) => (vertical ? p.x : p.y));
};

const componentSizes = (built: MapTopology, edges: readonly MapEdge[]): readonly number[] => {
  const traversal = {
    graph: { nodes: built.nodes, edges },
    balance: BALANCE,
    mode: "foot",
  } as const;
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const node of built.nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    const reached = graph.reachable(traversal, node.id);
    const members = reached.kind === "reachable" ? reached.nodeIds : [node.id];
    for (const member of members) {
      seen.add(member);
    }
    sizes.push(members.length);
  }
  return sizes;
};

const isConnected = (built: MapTopology): boolean => {
  const first = built.nodes[0];
  if (first === undefined) {
    return true;
  }
  const reached = graph.reachable({ graph: built, balance: BALANCE, mode: "foot" }, first.id);
  return reached.kind === "reachable" && reached.nodeIds.length === built.nodes.length;
};

/**
 * An independent oracle for "crosses the river": plain segment intersection against the drawn
 * polyline, which knows nothing of the cut indices the generator decided sides with. If the two
 * ever disagree, one of them is wrong and this test says so.
 */
const turn = (a: Position, b: Position, c: Position): number =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

const segmentsCross = (a: Position, b: Position, c: Position, d: Position): boolean =>
  turn(a, b, c) !== turn(a, b, d) && turn(c, d, a) !== turn(c, d, b);

const crossesRiver = (built: MapTopology, edge: MapEdge): boolean => {
  const points = built.river?.points ?? [];
  const positionOf = (id: MapEdge["from"]): Position =>
    built.nodes.find((node) => node.id === id)?.position ?? { x: 0, y: 0 };
  const from = positionOf(edge.from);
  const to = positionOf(edge.to);
  return points.some((point, index) => {
    const next = points[index + 1];
    return next !== undefined && segmentsCross(from, to, point, next);
  });
};

describe("the river is crossable only at its bridges", () => {
  it("draws a polyline that every bridge crosses", () => {
    const built = expectRiver(carve(DEFAULT_CONFIG, SEED));
    const bridges = built.edges.filter((edge) => edge.kind === "bridge");
    expect(bridges.length).toBeGreaterThan(0);
    for (const bridge of bridges) {
      expect(crossesRiver(built, bridge)).toBe(true);
    }
  });

  it("leaves no other edge crossing it", () => {
    const built = expectRiver(carve(DEFAULT_CONFIG, SEED));
    const crossing = built.edges.filter(
      (edge) => edge.kind !== "bridge" && crossesRiver(built, edge),
    );
    expect(crossing).toEqual([]);
  });

  it("removes the crossings it did not bridge", () => {
    const before = buildTopology(DEFAULT_CONFIG, SEED).topology;
    const after = expectRiver(carve(DEFAULT_CONFIG, SEED));
    expect(after.edges.length).toBeLessThan(before.edges.length);
  });

  it("keeps a bridged edge's id and endpoints, so it is the same crossing", () => {
    const before = buildTopology(DEFAULT_CONFIG, SEED).topology;
    const after = expectRiver(carve(DEFAULT_CONFIG, SEED));
    for (const bridge of after.edges.filter((edge) => edge.kind === "bridge")) {
      const original = before.edges.find((edge) => edge.id === bridge.id);
      expect(original).toBeDefined();
      expect({ from: bridge.from, to: bridge.to }).toEqual({
        from: original?.from,
        to: original?.to,
      });
    }
  });
});

describe("bridges", () => {
  it("lands inside the configured range", () => {
    const built = expectRiver(carve(DEFAULT_CONFIG, SEED));
    const bridges = built.edges.filter((edge) => edge.kind === "bridge");
    expect(bridges.length).toBeGreaterThanOrEqual(BALANCE.map.minBridges);
    expect(bridges.length).toBeLessThanOrEqual(BALANCE.map.maxBridges);
  });

  it("keeps the city connected", () => {
    expect(isConnected(expectRiver(carve(DEFAULT_CONFIG, SEED)))).toBe(true);
  });

  it("is blockable, which is what makes the river a chokepoint worth holding", () => {
    expect(BALANCE.edges.bridge.blockable).toBe(true);
  });
});

describe("the course", () => {
  it("wanders both ways, so the river is a staircase and not a diagonal", () => {
    const drifts = new Set<number>();
    for (let seed = 0; seed < BUDGET_SEEDS; seed += 1) {
      const result = carve(DEFAULT_CONFIG, seed);
      if (result.kind !== "river") {
        continue;
      }
      const series = acrossSeries(result.topology);
      for (const [step, across] of series.entries()) {
        const previous = series[step - 1];
        if (previous !== undefined) {
          drifts.add(Math.sign(across - previous));
        }
      }
    }
    expect(drifts).toEqual(new Set([-1, 0, 1]));
  });

  it("runs both ways across the city over a range of seeds", () => {
    const orientations = new Set<boolean>();
    for (let seed = 0; seed < BUDGET_SEEDS; seed += 1) {
      const result = carve(DEFAULT_CONFIG, seed);
      if (result.kind !== "river") {
        continue;
      }
      const [first, second] = result.topology.river?.points ?? [];
      orientations.add(first?.x === second?.x);
    }
    expect(orientations).toEqual(new Set([true, false]));
  });
});

describe("refusing to carve", () => {
  it("reports a grid with no room for a river", () => {
    expect(carve(SINGLE_CELL, SEED)).toEqual({
      kind: "river_not_bridgeable",
      crossings: 0,
      requiredBridges: BALANCE.map.minBridges,
    });
  });

  it("reports a grid too narrow to hold a bank on each side", () => {
    expect(carve(TOO_NARROW, SEED)).toEqual({
      kind: "river_not_bridgeable",
      crossings: 0,
      requiredBridges: BALANCE.map.minBridges,
    });
  });

  it("reports a course offering fewer crossings than the minimum", () => {
    const result = carve(DEFAULT_CONFIG, SEED, withMap({ minBridges: 1000, maxBridges: 1000 }));
    expect(result.kind).toBe("river_not_bridgeable");
    if (result.kind !== "river_not_bridgeable") {
      throw new Error("expected a refusal");
    }
    expect(result.requiredBridges).toBe(1000);
    expect(result.crossings).toBeLessThan(result.requiredBridges);
  });

  it("reports a course needing more bridges than the maximum allows", () => {
    const result = carve(DEFAULT_CONFIG, SEED, withMap({ minBridges: 0, maxBridges: 0 }));
    expect(result.kind).toBe("river_not_bridgeable");
    if (result.kind !== "river_not_bridgeable") {
      throw new Error("expected a refusal");
    }
    expect(result.requiredBridges).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  it("carves an identical river for the same seed", () => {
    expect(carve(DEFAULT_CONFIG, SEED)).toEqual(carve(DEFAULT_CONFIG, SEED));
  });

  it("carves a different river for a different seed", () => {
    expect(carve(DEFAULT_CONFIG, SEED)).not.toEqual(carve(DEFAULT_CONFIG, OTHER_SEED));
  });

  it("advances the stream past the topology it was given", () => {
    const built = buildTopology(DEFAULT_CONFIG, SEED);
    const result = river.carve({
      topology: built.topology,
      balance: BALANCE,
      state: built.state,
    });
    if (result.kind !== "river") {
      throw new Error("expected a river");
    }
    expect(result.state).not.toEqual(built.state);
  });

  it("round-trips through JSON, river included", () => {
    const built = expectRiver(carve(DEFAULT_CONFIG, SEED));
    expect(built.river?.points.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
});

describe("the refusal budget", () => {
  it("carves for nearly every seed, so M2.3 seldom has to regenerate a map", () => {
    const refusals = Array.from({ length: BUDGET_SEEDS }, (_unused, seed) =>
      carve(DEFAULT_CONFIG, seed),
    ).filter((result) => result.kind !== "river");
    expect(refusals.length / BUDGET_SEEDS).toBeLessThan(MAX_REFUSAL_RATE);
  });
});

describe("properties over seeds", () => {
  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })("always leaves one city", (seed) => {
    const built = riverOrSoundRefusal(carve(DEFAULT_CONFIG, seed));
    if (built === null) {
      return;
    }
    expect(isConnected(built)).toBe(true);
  });

  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })(
    "always agrees with the drawn polyline about what crosses",
    (seed) => {
      const built = riverOrSoundRefusal(carve(DEFAULT_CONFIG, seed));
      if (built === null) {
        return;
      }
      for (const edge of built.edges) {
        expect(crossesRiver(built, edge)).toBe(edge.kind === "bridge");
      }
    },
  );

  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })(
    "always bridges within the configured range",
    (seed) => {
      const built = riverOrSoundRefusal(carve(DEFAULT_CONFIG, seed));
      if (built === null) {
        return;
      }
      const bridges = built.edges.filter((edge) => edge.kind === "bridge");
      expect(bridges.length).toBeGreaterThanOrEqual(BALANCE.map.minBridges);
      expect(bridges.length).toBeLessThanOrEqual(BALANCE.map.maxBridges);
    },
  );

  test.prop([fc.integer()], { numRuns: PROPERTY_RUNS })(
    "always leaves both banks at least two cells wide, which is what keeps them in one piece",
    (seed) => {
      const built = expectRiver(carve(DEFAULT_CONFIG, seed, withMap(UNPRUNED)));
      const banks = componentSizes(
        built,
        built.edges.filter((edge) => edge.kind !== "bridge"),
      );
      expect(banks).toHaveLength(2);
      const { columns, rows } = DEFAULT_CONFIG;
      expect(Math.min(...banks)).toBeGreaterThanOrEqual(MIN_BANK_CELLS * Math.min(columns, rows));
    },
  );
});
