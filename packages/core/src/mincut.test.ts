import { fc, test as propertyTest } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { Traversal } from "./graph";
import { createGraphLogic } from "./graph";
import type { NodeId } from "./ids";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import type { EdgeKind, MapEdge, MapGraph, MapNode, TravelMode } from "./map";
import { makeEdge, makeNode } from "./map";
import type { MinCutResult } from "./mincut";
import { createMinCutLogic } from "./mincut";

const graphLogic = createGraphLogic();
const minCutLogic = createMinCutLogic({ graph: graphLogic });

const ORIGIN = { x: 0, y: 0 };

const node = (id: string): MapNode => makeNode(makeNodeId(id), "residential", ORIGIN);

/** `tag` distinguishes parallel edges, which need distinct ids but join the same two nodes. */
const edge = (kind: EdgeKind, from: string, to: string, tag = ""): MapEdge =>
  makeEdge(kind, makeEdgeId(`${from}-${to}${tag}`), makeNodeId(from), makeNodeId(to));

const graphOf = (nodeNames: readonly string[], edges: readonly MapEdge[]): MapGraph => ({
  nodes: nodeNames.map(node),
  edges,
  exits: [],
  river: null,
  incidentNodeId: makeNodeId(nodeNames[0] ?? ""),
});

const traversalOn = (graph: MapGraph, mode: TravelMode): Traversal => ({
  graph,
  balance: BALANCE,
  mode,
});

const roads = (nodeNames: readonly string[], pairs: readonly string[]): MapGraph =>
  graphOf(
    nodeNames,
    pairs.map((pair) => {
      const [from = "", to = ""] = pair.split("-");
      return edge("road", from, to);
    }),
  );

const cutValue = (result: MinCutResult): number => {
  if (result.kind !== "cut") {
    throw new Error(`expected a cut, got ${result.kind}`);
  }
  return result.value;
};

const cutBetween = (graph: MapGraph, from: string, targets: readonly string[]): number =>
  cutValue(
    minCutLogic.minCut(traversalOn(graph, "car"), makeNodeId(from), targets.map(makeNodeId)),
  );

/** n0 - n1 - ... - n(length-1). One route end to end, so every cut on it is 1. */
const chainOf = (length: number): MapGraph => {
  const names = Array.from({ length }, (_, index) => `n${index}`);
  return roads(
    names,
    names.slice(1).map((_, index) => `n${index}-n${index + 1}`),
  );
};

describe("hand-built graphs with known cut values", () => {
  it("cuts a line at its single road", () => {
    expect(cutBetween(roads(["a", "b", "c"], ["a-b", "b-c"]), "a", ["c"])).toBe(1);
  });

  it("cuts a ring in two places", () => {
    const ring = roads(["a", "b", "c", "d"], ["a-b", "b-c", "c-d", "d-a"]);

    expect(cutBetween(ring, "a", ["c"])).toBe(2);
  });

  it("cuts three parallel routes in three places", () => {
    const routes = roads(["s", "p", "q", "r", "t"], ["s-p", "p-t", "s-q", "q-t", "s-r", "r-t"]);

    expect(cutBetween(routes, "s", ["t"])).toBe(3);
  });

  it("finds the bottleneck behind a well-connected neighbourhood", () => {
    const bottleneck = roads(["s", "a", "b", "c", "t"], ["s-a", "s-b", "a-b", "a-c", "b-c", "c-t"]);

    expect(cutBetween(bottleneck, "s", ["t"])).toBe(1);
  });

  it("counts routes, not roads leaving the source", () => {
    const funnel = roads(["s", "a", "b", "t"], ["s-a", "s-b", "b-a", "a-t"]);

    expect(cutBetween(funnel, "s", ["t"])).toBe(1);
  });

  it("counts parallel roads separately", () => {
    const twinned = graphOf(
      ["a", "b"],
      [edge("road", "a", "b", "-north"), edge("road", "a", "b", "-south")],
    );

    expect(cutBetween(twinned, "a", ["b"])).toBe(2);
  });

  it("is zero when the target is already unreachable", () => {
    expect(cutBetween(roads(["a", "b", "x", "y"], ["a-b", "x-y"]), "a", ["y"])).toBe(0);
  });
});

describe("cutting a set of targets", () => {
  it("cuts every branch, not the cheapest one", () => {
    const exits = roads(["s", "a", "b", "e1", "e2"], ["s-a", "s-b", "a-e1", "b-e2"]);

    expect(cutBetween(exits, "s", ["e1"])).toBe(1);
    expect(cutBetween(exits, "s", ["e2"])).toBe(1);
    expect(cutBetween(exits, "s", ["e1", "e2"])).toBe(2);
  });

  it("does not route one target through another", () => {
    const inLine = roads(["s", "e1", "e2"], ["s-e1", "e1-e2"]);

    expect(cutBetween(inLine, "s", ["e1", "e2"])).toBe(1);
  });

  it("separates a node from nothing at no cost", () => {
    expect(cutBetween(roads(["a", "b"], ["a-b"]), "a", [])).toBe(0);
  });

  it("cannot separate a node from itself", () => {
    const graph = roads(["a", "b"], ["a-b"]);
    const result = minCutLogic.minCut(traversalOn(graph, "car"), makeNodeId("a"), [
      makeNodeId("b"),
      makeNodeId("a"),
    ]);

    expect(result.kind).toBe("not_separable");
  });

  it("is zero for a source that is not on the map", () => {
    expect(cutBetween(roads(["a", "b"], ["a-b"]), "ghost", ["b"])).toBe(0);
  });
});

describe("travel mode", () => {
  it("only counts edges the mode can use", () => {
    const rails = graphOf(["a", "b", "c"], [edge("rail", "a", "b"), edge("rail", "b", "c")]);
    const onRails = (mode: TravelMode) =>
      cutValue(minCutLogic.minCut(traversalOn(rails, mode), makeNodeId("a"), [makeNodeId("c")]));

    expect(onRails("transit")).toBe(1);
    expect(onRails("car")).toBe(0);
    expect(onRails("foot")).toBe(0);
  });

  it("counts a footpath even though no roadblock can close one", () => {
    const alley = graphOf(["a", "b"], [edge("road", "a", "b"), edge("footpath", "a", "b")]);
    const onFoot = minCutLogic.minCut(traversalOn(alley, "foot"), makeNodeId("a"), [
      makeNodeId("b"),
    ]);

    expect(BALANCE.edges.footpath.blockable).toBe(false);
    expect(cutValue(onFoot)).toBe(2);
  });
});

describe("the expansion cap", () => {
  it("reports the cap instead of searching on", () => {
    const traversal: Traversal = { ...traversalOn(chainOf(8), "car"), maxExpansions: 3 };
    const result = minCutLogic.minCut(traversal, makeNodeId("n0"), [makeNodeId("n7")]);

    if (result.kind !== "expansion_limit_exceeded") {
      throw new Error(`expected the cap, got ${result.kind}`);
    }
    expect(result.expansions).toBe(4);
  });

  it("defaults to LIMITS.maxSearchExpansions", () => {
    const withinCap = chainOf(LIMITS.maxSearchExpansions + 1);
    const overCap = chainOf(LIMITS.maxSearchExpansions + 2);
    const endOf = (graph: MapGraph) => makeNodeId(`n${graph.nodes.length - 1}`);

    expect(
      minCutLogic.minCut(traversalOn(withinCap, "car"), makeNodeId("n0"), [endOf(withinCap)]),
    ).toEqual({ kind: "cut", value: 1 });
    expect(
      minCutLogic.minCut(traversalOn(overCap, "car"), makeNodeId("n0"), [endOf(overCap)]).kind,
    ).toBe("expansion_limit_exceeded");
  });
});

const MAX_RANDOM_NODES = 6;
const MAX_RANDOM_EDGES = 16;

const randomGraph = fc
  .record({
    nodeCount: fc.integer({ min: 2, max: MAX_RANDOM_NODES }),
    pairs: fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
        fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
      ),
      { maxLength: MAX_RANDOM_EDGES },
    ),
  })
  .map(({ nodeCount, pairs }) => {
    const names = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
    const edges = pairs
      .filter(([from, to]) => from < nodeCount && to < nodeCount && from !== to)
      .map(([from, to], index) => edge("road", `n${from}`, `n${to}`, `-${index}`));
    return graphOf(names, edges);
  });

const endpoints = fc.tuple(
  fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
  fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
);

/**
 * The definition rather than the algorithm: the fewest edges crossing any division of the map
 * that keeps the source on one side and every target on the other. Exponential, so it is only
 * usable on the small random graphs above. Every random edge is a road, which a car can use, so
 * no edge is filtered out by travel mode here.
 */
const smallestCutByHand = (graph: MapGraph, from: NodeId, targets: readonly NodeId[]): number => {
  const nodeIds = graph.nodes.map((mapNode) => mapNode.id);
  let smallest = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 1 << nodeIds.length; mask += 1) {
    const side = new Set(nodeIds.filter((_, index) => (mask & (1 << index)) !== 0));
    if (!side.has(from) || targets.some((target) => side.has(target))) {
      continue;
    }
    const crossing = graph.edges.filter(
      (mapEdge) => side.has(mapEdge.from) !== side.has(mapEdge.to),
    ).length;
    smallest = Math.min(smallest, crossing);
  }
  return smallest;
};

describe("invariants over random graphs", () => {
  propertyTest.prop([randomGraph, endpoints])(
    "finds the smallest cut there is",
    (graph, [fromIndex, toIndex]) => {
      const nodeCount = graph.nodes.length;
      const from = makeNodeId(`n${fromIndex % nodeCount}`);
      const to = makeNodeId(`n${toIndex % nodeCount}`);
      if (from === to) {
        return;
      }

      expect(cutValue(minCutLogic.minCut(traversalOn(graph, "car"), from, [to]))).toBe(
        smallestCutByHand(graph, from, [to]),
      );
    },
  );

  propertyTest.prop([randomGraph, endpoints])(
    "cuts the same either way round",
    (graph, [fromIndex, toIndex]) => {
      const nodeCount = graph.nodes.length;
      const from = makeNodeId(`n${fromIndex % nodeCount}`);
      const to = makeNodeId(`n${toIndex % nodeCount}`);
      if (from === to) {
        return;
      }
      const traversal = traversalOn(graph, "car");

      expect(minCutLogic.minCut(traversal, from, [to])).toEqual(
        minCutLogic.minCut(traversal, to, [from]),
      );
    },
  );

  propertyTest.prop([randomGraph, endpoints])(
    "needs a cut exactly when a route exists, and never more than the roads at either end",
    (graph, [fromIndex, toIndex]) => {
      const nodeCount = graph.nodes.length;
      const from = makeNodeId(`n${fromIndex % nodeCount}`);
      const to = makeNodeId(`n${toIndex % nodeCount}`);
      if (from === to) {
        return;
      }
      const traversal = traversalOn(graph, "car");
      const value = cutValue(minCutLogic.minCut(traversal, from, [to]));
      const reached = graphLogic.reachable(traversal, from);

      expect(value > 0).toBe(reached.kind === "reachable" && reached.nodeIds.includes(to));
      expect(value).toBeLessThanOrEqual(graphLogic.neighbors(traversal, from).length);
      expect(value).toBeLessThanOrEqual(graphLogic.neighbors(traversal, to).length);
    },
  );
});
