import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./balance";
import type { MapConfig } from "./config";
import { createDistrictLogic } from "./districts";
import { createGraphLogic } from "./graph";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import {
  type EdgeKind,
  type Exit,
  type MapEdge,
  type MapGraph,
  makeEdge,
  makeExit,
  makeNode,
} from "./map";
import { createMinCutLogic } from "./mincut";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { createTopologyLogic } from "./topology";
import { createValidatorLogic, type ValidationRule, type Violation } from "./validator";

const rng = createRng();
const graph = createGraphLogic();
const minCut = createMinCutLogic({ graph });
const validator = createValidatorLogic({ graph, minCut });

const ORIGIN = { x: 0, y: 0 };

const node = (id: string) => makeNode(makeNodeId(id), "residential", ORIGIN);

const edge = (kind: EdgeKind, from: string, to: string, tag = ""): MapEdge =>
  makeEdge(kind, makeEdgeId(`${from}-${to}${tag}`), makeNodeId(from), makeNodeId(to));

const exit = (id: string): Exit => makeExit(makeNodeId(id), "border");

type MapParts = {
  readonly nodes: readonly string[];
  readonly edges: readonly MapEdge[];
  readonly exits?: readonly Exit[];
  readonly start?: string;
};

const START = "s";

const mapOf = (parts: MapParts): MapGraph => ({
  nodes: parts.nodes.map(node),
  edges: parts.edges,
  exits: parts.exits ?? [exit("x")],
  river: null,
  incidentNodeId: makeNodeId(parts.start ?? START),
});

const violationsOf = (map: MapGraph, maxExpansions?: number): readonly Violation[] => {
  const result = validator.validate({
    graph: map,
    balance: BALANCE,
    ...(maxExpansions === undefined ? {} : { maxExpansions }),
  });
  return result.kind === "valid" ? [] : result.violations;
};

const kindsOf = (map: MapGraph): readonly Violation["kind"][] =>
  violationsOf(map).map((violation) => violation.kind);

/**
 * The reference city, and the shape every case below mutates by exactly one thing.
 *
 * Two edge-disjoint routes out, so the cut is 2. The short one crosses the bridge `a-c` and costs
 * 6 on foot (three edges at 2); the long one runs round through `b-g-d` and costs 8. So severing
 * the bridge strictly raises the escape cost, which is what makes it a chokepoint that matters,
 * and the second bridge `b-g` is a crossing that can be routed around, which is what makes the
 * chokepoint rule a real question rather than "does a bridge exist".
 */
const NODES = ["s", "a", "b", "c", "d", "g", "x"] as const;

const REFERENCE_EDGES: readonly MapEdge[] = [
  edge("road", "s", "a"),
  edge("bridge", "a", "c"),
  edge("road", "c", "x"),
  edge("road", "s", "b"),
  edge("bridge", "b", "g"),
  edge("road", "g", "d"),
  edge("road", "d", "x"),
];

const reference = (): MapGraph => mapOf({ nodes: [...NODES], edges: REFERENCE_EDGES });

/** Replaces one edge of the reference city, keeping its endpoints. */
const withKind = (from: string, to: string, kind: EdgeKind): readonly MapEdge[] =>
  REFERENCE_EDGES.map((existing) =>
    existing.from === makeNodeId(from) && existing.to === makeNodeId(to)
      ? edge(kind, from, to)
      : existing,
  );

describe("a valid city", () => {
  it("reports no violations", () => {
    expect(validator.validate({ graph: reference(), balance: BALANCE })).toEqual({ kind: "valid" });
  });

  it("measures the escape on foot, where the reference city just clears the threshold", () => {
    // By car the same route costs 3 and would fail; the mode is the whole reason M2 works.
    expect(BALANCE.map.minEscapeTurns).toBe(6);
  });
});

describe("every exit is reachable from the start", () => {
  it("names an exit with no way to it", () => {
    const map = mapOf({
      nodes: [...NODES, "y"],
      edges: REFERENCE_EDGES,
      exits: [exit("x"), exit("y")],
    });
    expect(violationsOf(map)).toEqual([{ kind: "exit_unreachable", nodeId: makeNodeId("y") }]);
  });

  it("reports a city with nowhere to run to", () => {
    const map = mapOf({ nodes: [...NODES], edges: REFERENCE_EDGES, exits: [] });
    expect(violationsOf(map)).toEqual([{ kind: "no_exits" }]);
  });
});

describe("the shortest escape is at least MIN_ESCAPE_TURNS", () => {
  it("names the cost it found and the cost it wanted", () => {
    // `s-c` replaces `s-a-c`, so the short route loses an edge and costs 4 rather than 6.
    const map = mapOf({
      nodes: ["s", "b", "c", "d", "g", "x"],
      edges: [
        edge("bridge", "s", "c"),
        edge("road", "c", "x"),
        edge("road", "s", "b"),
        edge("road", "b", "g"),
        edge("road", "g", "d"),
        edge("road", "d", "x"),
      ],
    });
    expect(violationsOf(map)).toEqual([
      { kind: "escape_too_short", cost: 4, required: BALANCE.map.minEscapeTurns },
    ]);
  });
});

describe("the cut between the start and the exits", () => {
  it("rejects a city one edge can seal", () => {
    const map = mapOf({
      nodes: ["s", "a", "c", "x"],
      edges: [edge("road", "s", "a"), edge("bridge", "a", "c"), edge("road", "c", "x")],
    });
    expect(violationsOf(map)).toEqual([
      { kind: "exit_cut_too_small", value: 1, required: BALANCE.map.minCutToExits },
    ]);
  });
});

describe("a chokepoint that matters", () => {
  it("rejects a bridgeless city", () => {
    const map = mapOf({
      nodes: [...NODES],
      edges: withKind("a", "c", "road").map((existing) =>
        existing.kind === "bridge" ? edge("road", "b", "g") : existing,
      ),
    });
    expect(map.edges.some((existing) => existing.kind === "bridge")).toBe(false);
    expect(violationsOf(map)).toEqual([{ kind: "no_chokepoint" }]);
  });

  it("rejects a bridge the criminal can route around at no extra cost", () => {
    // Both routes cost 6, so severing either leaves the escape exactly as cheap as it was.
    const map = mapOf({
      nodes: ["s", "a", "b", "c", "d", "x"],
      edges: [
        edge("bridge", "s", "a"),
        edge("road", "a", "c"),
        edge("road", "c", "x"),
        edge("road", "s", "b"),
        edge("road", "b", "d"),
        edge("road", "d", "x"),
      ],
    });
    expect(violationsOf(map)).toEqual([{ kind: "no_chokepoint" }]);
  });

  it("accepts a tunnel as well as a bridge", () => {
    const map = mapOf({ nodes: [...NODES], edges: withKind("a", "c", "tunnel") });
    expect(kindsOf(map)).toEqual([]);
  });

  it("counts severing the last way out as raising the cost", () => {
    // A single route out, so removing the bridge leaves the exit unreachable rather than dearer.
    // That is as strict an increase as there is, and the rule has to read it as one.
    const map = mapOf({
      nodes: ["s", "a", "c", "x"],
      edges: [edge("road", "s", "a"), edge("bridge", "a", "c"), edge("road", "c", "x")],
    });
    expect(kindsOf(map)).not.toContain("no_chokepoint");
  });
});

describe("the start is clear of the exits", () => {
  it("names an exit next door, over an edge no foot search would follow", () => {
    // Rail is not foot-traversable, so only a structural reading of adjacency catches this.
    const map = mapOf({
      nodes: [...NODES],
      edges: [...REFERENCE_EDGES, edge("rail", "s", "x")],
    });
    expect(violationsOf(map)).toEqual([
      {
        kind: "exit_adjacent_to_start",
        nodeId: makeNodeId("x"),
        edgeId: makeEdgeId("s-x"),
      },
    ]);
  });

  it("reports a start that is itself an exit", () => {
    const map = mapOf({
      nodes: [...NODES],
      edges: REFERENCE_EDGES,
      exits: [exit("x"), exit(START)],
    });
    expect(kindsOf(map)).toContain("start_is_exit");
  });

  it("leaves the cut rule silent when the start cannot be separated from an exit", () => {
    const map = mapOf({
      nodes: [...NODES],
      edges: REFERENCE_EDGES,
      exits: [exit("x"), exit(START)],
    });
    expect(kindsOf(map)).not.toContain("exit_cut_too_small");
  });
});

describe("reporting", () => {
  it("returns every violation, not the first", () => {
    const map = mapOf({
      nodes: ["s", "a", "x"],
      edges: [edge("road", "s", "a"), edge("road", "a", "x")],
    });
    expect(kindsOf(map)).toEqual(["escape_too_short", "exit_cut_too_small", "no_chokepoint"]);
  });
});

describe("bounds", () => {
  it("leaves every searching rule undecided when the expansion cap is reached", () => {
    const ONE_EXPANSION = 1;
    const undecidedRules = violationsOf(reference(), ONE_EXPANSION).map((violation) =>
      violation.kind === "undecided" ? violation.rule : violation.kind,
    );
    const searching: readonly ValidationRule[] = [
      "exits_reachable",
      "escape_distance",
      "exit_cut",
      "chokepoint",
    ];
    expect(undecidedRules).toEqual(searching);
  });

  /**
   * A short route over the bridge and a long way round, so that testing the bridge costs far more
   * expansions than measuring the escape did.
   */
  const detoured = (length: number): MapGraph => {
    const detour = Array.from({ length }, (_, index) => `p${index}`);
    const chain = detour.slice(0, -1).map((from, index) => edge("road", from, `p${index + 1}`));
    return mapOf({
      nodes: ["s", "a", "c", "x", ...detour],
      edges: [
        edge("road", "s", "a"),
        edge("bridge", "a", "c"),
        edge("road", "c", "x"),
        edge("road", "s", "p0"),
        ...chain,
        edge("road", `p${length - 1}`, "x"),
      ],
    });
  };

  it("leaves the chokepoint rule undecided when testing a candidate reaches the cap", () => {
    const DETOUR_LENGTH = 10;
    // Chosen so the baseline search finishes and the search with the bridge removed does not:
    // `escape_distance` runs that same baseline, so its silence is what proves the cap was
    // reached inside the candidate loop rather than before it.
    const CAP = 8;
    const violations = violationsOf(detoured(DETOUR_LENGTH), CAP);
    expect(violations).toContainEqual({ kind: "undecided", rule: "chokepoint" });
    expect(violations).not.toContainEqual({ kind: "undecided", rule: "escape_distance" });
  });

  const padded = (extraBridges: number): MapGraph => {
    const pad = Array.from({ length: extraBridges }, (_, index) =>
      edge("bridge", "p", "q", `-${index}`),
    );
    return mapOf({ nodes: [...NODES, "p", "q"], edges: [...REFERENCE_EDGES, ...pad] });
  };

  /** The reference city already carries two bridges, so the padding tops it up to the cap. */
  const BASE_CANDIDATES = 2;

  it("decides the chokepoint rule at the candidate limit", () => {
    const map = padded(LIMITS.maxChokepointCandidates - BASE_CANDIDATES);
    expect(kindsOf(map)).toEqual([]);
  });

  it("refuses to decide it one candidate over", () => {
    const map = padded(LIMITS.maxChokepointCandidates - BASE_CANDIDATES + 1);
    expect(violationsOf(map)).toEqual([{ kind: "undecided", rule: "chokepoint" }]);
  });
});

describe("over maps the generator actually builds", () => {
  const topologyLogic = createTopologyLogic({ rng, graph });
  const riverLogic = createRiverLogic({ rng, graph });
  const districtLogic = createDistrictLogic({ rng, graph });
  const CONFIG: MapConfig = BALANCE.map.defaults;
  const SEEDS = 100;

  /**
   * The real M2.1a -> M2.1b -> M2.1c chain. A refusal from any stage is not a validator concern,
   * so it is counted and skipped; M2.3 is what retries those with a derived seed.
   */
  const generate = (seed: number, balance: Balance): MapGraph | null => {
    const topology = topologyLogic.generate({ config: CONFIG, balance, state: rng.seed(seed) });
    if (topology.kind !== "topology") {
      return null;
    }
    const carved = riverLogic.carve({
      topology: topology.topology,
      balance,
      state: topology.state,
    });
    if (carved.kind !== "river") {
      return null;
    }
    const labelled = districtLogic.label({
      topology: carved.topology,
      config: CONFIG,
      balance,
      state: carved.state,
    });
    return labelled.kind === "map" ? labelled.graph : null;
  };

  const surveyed = Array.from({ length: SEEDS }, (_, seed) => generate(seed, BALANCE)).filter(
    (map): map is MapGraph => map !== null,
  );

  it("generates enough maps to survey", () => {
    expect(surveyed.length).toBeGreaterThan(SEEDS / 2);
  });

  it("never leaves a rule undecided", () => {
    // A generated map is well inside every search bound, so `undecided` here is a generator bug.
    const undecidedKinds = surveyed.flatMap((map) =>
      violationsOf(map).filter((violation) => violation.kind === "undecided"),
    );
    expect(undecidedKinds).toEqual([]);
  });

  /**
   * The yield M2.3 sizes `LIMITS.maxMapGenerationAttempts` against, measured at 16% over 500 seeds
   * and pinned well under that. It is low because the chokepoint rule is strict by decision: in
   * 76% of generated cities the nearest exit sits on the start's own bank, so removing every
   * bridge changes the escape cost by nothing and no single crossing can matter. That is the
   * generator's doing, not the rule's (see the Inbox), and it is the regeneration budget that pays
   * for it - M2.3 should not discover the rate by exhausting its cap.
   */
  const MIN_VALID_RATE = 0.1;

  it("accepts the share of them that M2.3 budgets for", () => {
    const valid = surveyed.filter(
      (map) => validator.validate({ graph: map, balance: BALANCE }).kind === "valid",
    );
    expect(valid.length / surveyed.length).toBeGreaterThan(MIN_VALID_RATE);
  });
});
