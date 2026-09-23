import { fc, test } from "@fast-check/vitest";
import {
  BALANCE,
  createDistrictLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createValidatorLogic,
  type MapGraph,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeNode,
  makeNodeId,
  toHunterView,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  DISTRICT_LABELS,
  EXIT_LABELS,
  edgeNameOf,
  NO_PLACE_NAMES,
  nodeNameOf,
  placeNamesOf,
  UNKNOWN_PLACE,
} from "./placenames";

/**
 * PLAN M7.1's naming, against hand-built grids for the exact cases and against cities the
 * generator actually produced for the invariants, the way `maprenderer.test.tsx` builds one.
 */

const PITCH = BALANCE.map.nodeSpacing;
const GENERATED_RUNS = 12;
const COLUMNS = 8;
const ROWS = 6;

const rng = createRng();
const graph = createGraphLogic();
const game = createGameLogic({
  rng,
  generation: createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  }),
});

const generatedMapOf = (seed: number): MapGraph => {
  const created = game.create({
    setup: {
      map: { columns: COLUMNS, rows: ROWS, exitCount: 3 },
      maxTurns: 24,
      difficulty: "standard",
    },
    seed,
    balance: BALANCE,
  });
  if (created.kind !== "game") throw new Error(`seed ${seed} produced no game: ${created.kind}`);

  return toHunterView(created.world).map;
};

const arbitrarySeed = fc.integer({ min: 0, max: 0xffff_ffff });

/** A 3x2 grid, each node jittered off its cell by less than half a pitch, with one exit. */
const WEST = makeNodeId("west");
const MIDDLE = makeNodeId("middle");
const EAST = makeNodeId("east");
const SOUTH_WEST = makeNodeId("south-west");
const SOUTH_MIDDLE = makeNodeId("south-middle");
const SOUTH_EAST = makeNodeId("south-east");
const ACROSS = makeEdgeId("across");
const DOWN = makeEdgeId("down");
const TUNNEL = makeEdgeId("tunnel");

const SMALL_GRID: MapGraph = {
  nodes: [
    makeNode(WEST, "downtown", { x: 12, y: 208 }),
    makeNode(MIDDLE, "park", { x: 131, y: 190 }),
    makeNode(EAST, "exit", { x: 188, y: 221 }),
    makeNode(SOUTH_WEST, "suburb", { x: -20, y: 305 }),
    makeNode(SOUTH_MIDDLE, "downtown", { x: 104, y: 290 }),
    makeNode(SOUTH_EAST, "industrial", { x: 214, y: 311 }),
  ],
  edges: [
    makeEdge("road", ACROSS, WEST, MIDDLE),
    makeEdge("road", DOWN, MIDDLE, SOUTH_MIDDLE),
    makeEdge("tunnel", TUNNEL, SOUTH_MIDDLE, SOUTH_EAST),
  ],
  exits: [makeExit(EAST, "airport")],
  river: null,
  incidentNodeId: WEST,
};

const RAW_ID = /\b[ne]-\d/;

describe("naming a hand-built grid", () => {
  const names = placeNamesOf(SMALL_GRID, 7, PITCH);

  it("recovers three avenues and two streets from jittered positions", () => {
    expect(names.avenues.map((line) => line.index)).toEqual([0, 1, 2]);
    expect(names.streets.map((line) => line.index)).toEqual([0, 1]);
  });

  it("puts each line at the mean of its nodes' coordinates", () => {
    expect(names.avenues[0]?.at).toBe(-4);
    expect(names.streets[1]?.at).toBe(302);
  });

  it("names a node for its district and the crossing it stands on", () => {
    const west = nodeNameOf(names, WEST);
    const avenue = names.avenues[0]?.name ?? "";
    const street = names.streets[0]?.name ?? "";

    expect(west).toBe(`${DISTRICT_LABELS.downtown} - ${avenue} & ${street}`);
  });

  it("names an exit for its kind, and still for its crossing", () => {
    expect(nodeNameOf(names, EAST)).toMatch(new RegExp(`^${EXIT_LABELS.airport} - .+ & .+$`));
  });

  it("names an edge along a row for its street and one down a column for its avenue", () => {
    expect(edgeNameOf(names, ACROSS)).toBe(names.streets[0]?.name);
    expect(edgeNameOf(names, DOWN)).toBe(names.avenues[1]?.name);
  });

  it("marks a tunnel as a tunnel", () => {
    expect(edgeNameOf(names, TUNNEL)).toBe(`${names.streets[1]?.name ?? ""} Tunnel`);
  });

  it("says an unknown id is an unknown place rather than repeating the id", () => {
    expect(nodeNameOf(names, makeNodeId("n-9-9"))).toBe(UNKNOWN_PLACE);
    expect(edgeNameOf(NO_PLACE_NAMES, ACROSS)).toBe(UNKNOWN_PLACE);
  });

  it("gives an edge whose ends the map does not carry no name of its own", () => {
    const dangling = makeEdgeId("dangling");
    const withDangling: MapGraph = {
      ...SMALL_GRID,
      edges: [...SMALL_GRID.edges, makeEdge("road", dangling, WEST, makeNodeId("off-map"))],
    };

    expect(edgeNameOf(placeNamesOf(withDangling, 7, PITCH), dangling)).toBe(UNKNOWN_PLACE);
  });
});

describe("naming a grid wider than the word tables", () => {
  const WIDE = 30;
  const wide: MapGraph = {
    ...SMALL_GRID,
    nodes: Array.from({ length: WIDE }, (_unused, index) =>
      makeNode(makeNodeId(`wide-${index}`), "suburb", { x: index * PITCH, y: 0 }),
    ),
    edges: [],
    exits: [],
  };

  it("goes round the table again with a pass number, so every avenue is distinct", () => {
    const avenues = placeNamesOf(wide, 3, PITCH).avenues.map((line) => line.name);

    expect(avenues).toHaveLength(WIDE);
    expect(new Set(avenues).size).toBe(WIDE);
  });
});

describe("naming a generated city", () => {
  test.prop([arbitrarySeed], { numRuns: GENERATED_RUNS })(
    "names every node and edge, and no two nodes alike",
    (seed) => {
      const map = generatedMapOf(seed);
      const names = placeNamesOf(map, seed, PITCH);
      const nodeNames = map.nodes.map((node) => nodeNameOf(names, node.id));
      const edgeNames = map.edges.map((edge) => edgeNameOf(names, edge.id));

      for (const name of [...nodeNames, ...edgeNames]) {
        expect(name).not.toBe("");
        expect(name).not.toBe(UNKNOWN_PLACE);
        expect(name).not.toMatch(RAW_ID);
      }
      expect(new Set(nodeNames).size).toBe(map.nodes.length);
    },
  );

  test.prop([arbitrarySeed], { numRuns: GENERATED_RUNS })(
    "recovers the generator's columns and rows",
    (seed) => {
      const names = placeNamesOf(generatedMapOf(seed), seed, PITCH);

      expect(names.avenues).toHaveLength(COLUMNS);
      expect(names.streets).toHaveLength(ROWS);
    },
  );

  test.prop([arbitrarySeed], { numRuns: GENERATED_RUNS })(
    "gives the same names for the same seed",
    (seed) => {
      const map = generatedMapOf(seed);

      expect(placeNamesOf(map, seed, PITCH)).toEqual(placeNamesOf(map, seed, PITCH));
    },
  );

  it("names the same city differently under another seed", () => {
    const map = generatedMapOf(1);
    const avenuesFor = (seed: number): readonly string[] =>
      placeNamesOf(map, seed, PITCH).avenues.map((line) => line.name);

    expect(avenuesFor(1)).not.toEqual(avenuesFor(2));
  });

  it("survives a JSON round trip", () => {
    const names = placeNamesOf(generatedMapOf(1), 1, PITCH);

    expect(JSON.parse(JSON.stringify(names))).toEqual(names);
  });
});
