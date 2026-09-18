import { fc, test as propertyTest } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { Path, Traversal } from "./graph";
import { createGraphLogic } from "./graph";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import type { EdgeKind, MapEdge, MapGraph, MapNode, TravelMode } from "./map";
import { makeEdge, makeNode } from "./map";

const graphLogic = createGraphLogic();

const ORIGIN = { x: 0, y: 0 };

const node = (id: string): MapNode => makeNode(makeNodeId(id), "residential", ORIGIN);

const edge = (kind: EdgeKind, from: string, to: string): MapEdge =>
  makeEdge(kind, makeEdgeId(`${from}-${to}`), makeNodeId(from), makeNodeId(to));

const graphOf = (nodeNames: readonly string[], edges: readonly MapEdge[]): MapGraph => ({
  nodes: nodeNames.map(node),
  edges,
  exits: [],
  incidentNodeId: makeNodeId(nodeNames[0] ?? ""),
});

const traversalOn = (graph: MapGraph, mode: TravelMode): Traversal => ({
  graph,
  balance: BALANCE,
  mode,
});

const ids = (names: readonly string[]) => names.map(makeNodeId);

/** a - b - c in a straight line, roads throughout. */
const line = graphOf(["a", "b", "c"], [edge("road", "a", "b"), edge("road", "b", "c")]);

/** Two ways from a to c: two roads, or one footpath that no car can use. */
const shortcut = graphOf(
  ["a", "b", "c"],
  [edge("road", "a", "b"), edge("road", "b", "c"), edge("footpath", "a", "c")],
);

const split = graphOf(["a", "b", "x", "y"], [edge("road", "a", "b"), edge("road", "x", "y")]);

const expectPath = (result: ReturnType<typeof graphLogic.shortestPath>): Path => {
  if (result.kind !== "path") {
    throw new Error(`expected a path, got ${result.kind}`);
  }
  return result;
};

describe("neighbors", () => {
  it("is undirected: an edge written a-b makes each a neighbour of the other", () => {
    const fromA = graphLogic.neighbors(traversalOn(line, "car"), makeNodeId("a"));
    const fromB = graphLogic.neighbors(traversalOn(line, "car"), makeNodeId("b"));

    expect(fromA.map((neighbor) => neighbor.nodeId)).toEqual(ids(["b"]));
    expect(fromB.map((neighbor) => neighbor.nodeId)).toEqual(ids(["a", "c"]));
  });

  it("hides edges the mode cannot use", () => {
    const rails = graphOf(["a", "b"], [edge("rail", "a", "b")]);

    expect(graphLogic.neighbors(traversalOn(rails, "transit"), makeNodeId("a"))).toHaveLength(1);
    expect(graphLogic.neighbors(traversalOn(rails, "car"), makeNodeId("a"))).toEqual([]);
    expect(graphLogic.neighbors(traversalOn(rails, "foot"), makeNodeId("a"))).toEqual([]);
  });

  it("carries the balance cost for the mode", () => {
    const [byCar] = graphLogic.neighbors(traversalOn(line, "car"), makeNodeId("a"));
    const [onFoot] = graphLogic.neighbors(traversalOn(line, "foot"), makeNodeId("a"));

    expect(byCar?.cost).toBe(BALANCE.edges.road.costByMode.car);
    expect(onFoot?.cost).toBe(BALANCE.edges.road.costByMode.foot);
  });

  it("returns nothing for a node the graph does not have", () => {
    expect(graphLogic.neighbors(traversalOn(line, "car"), makeNodeId("nowhere"))).toEqual([]);
  });
});

describe("adjacency", () => {
  it("lists every node that has a usable edge, in both directions", () => {
    const adjacency = graphLogic.adjacency(traversalOn(line, "car"));

    expect([...adjacency.keys()]).toEqual(ids(["a", "b", "c"]));
    expect(adjacency.get(makeNodeId("b"))?.map((neighbor) => neighbor.nodeId)).toEqual(
      ids(["a", "c"]),
    );
  });

  it("agrees with neighbors, mode for mode", () => {
    for (const mode of ["foot", "car", "transit"] as const) {
      const traversal = traversalOn(shortcut, mode);
      const adjacency = graphLogic.adjacency(traversal);
      for (const name of ["a", "b", "c"]) {
        const nodeId = makeNodeId(name);
        expect(adjacency.get(nodeId) ?? []).toEqual(graphLogic.neighbors(traversal, nodeId));
      }
    }
  });

  it("omits nodes their mode cannot leave", () => {
    const rails = graphOf(["a", "b"], [edge("rail", "a", "b")]);

    expect(graphLogic.adjacency(traversalOn(rails, "car")).size).toBe(0);
  });
});

describe("shortestPath", () => {
  it("adds up the edges it crossed", () => {
    const path = expectPath(
      graphLogic.shortestPath(traversalOn(line, "car"), makeNodeId("a"), makeNodeId("c")),
    );

    expect(path.nodeIds).toEqual(ids(["a", "b", "c"]));
    expect(path.edgeIds).toEqual([makeEdgeId("a-b"), makeEdgeId("b-c")]);
    expect(path.cost).toBe(2 * (BALANCE.edges.road.costByMode.car ?? 0));
  });

  it("takes the footpath on foot and the long way round by car", () => {
    const onFoot = expectPath(
      graphLogic.shortestPath(traversalOn(shortcut, "foot"), makeNodeId("a"), makeNodeId("c")),
    );
    const byCar = expectPath(
      graphLogic.shortestPath(traversalOn(shortcut, "car"), makeNodeId("a"), makeNodeId("c")),
    );

    expect(onFoot.nodeIds).toEqual(ids(["a", "c"]));
    expect(onFoot.cost).toBe(BALANCE.edges.footpath.costByMode.foot);
    expect(byCar.nodeIds).toEqual(ids(["a", "b", "c"]));
  });

  it("is one node and no cost when it has arrived already", () => {
    const path = expectPath(
      graphLogic.shortestPath(traversalOn(line, "car"), makeNodeId("a"), makeNodeId("a")),
    );

    expect(path.nodeIds).toEqual(ids(["a"]));
    expect(path.edgeIds).toEqual([]);
    expect(path.cost).toBe(0);
  });

  it("reports an unreachable destination rather than a zero-cost path", () => {
    const across = graphLogic.shortestPath(
      traversalOn(split, "car"),
      makeNodeId("a"),
      makeNodeId("x"),
    );
    const missing = graphLogic.shortestPath(
      traversalOn(line, "car"),
      makeNodeId("a"),
      makeNodeId("nowhere"),
    );
    const fromMissing = graphLogic.shortestPath(
      traversalOn(line, "car"),
      makeNodeId("nowhere"),
      makeNodeId("a"),
    );

    expect(across.kind).toBe("unreachable");
    expect(missing.kind).toBe("unreachable");
    expect(fromMissing.kind).toBe("unreachable");
  });

  it("gives the same answer twice", () => {
    const traversal = traversalOn(shortcut, "foot");
    const first = graphLogic.shortestPath(traversal, makeNodeId("a"), makeNodeId("c"));
    const second = graphLogic.shortestPath(traversal, makeNodeId("a"), makeNodeId("c"));

    expect(first).toEqual(second);
  });
});

describe("shortestPathToAny", () => {
  it("stops at the nearest target", () => {
    const path = expectPath(
      graphLogic.shortestPathToAny(traversalOn(line, "car"), makeNodeId("a"), ids(["c", "b"])),
    );

    expect(path.nodeIds).toEqual(ids(["a", "b"]));
  });

  it("is unreachable when there is nothing to reach", () => {
    expect(graphLogic.shortestPathToAny(traversalOn(line, "car"), makeNodeId("a"), []).kind).toBe(
      "unreachable",
    );
  });

  it("costs nothing when the start is already a target", () => {
    const path = expectPath(
      graphLogic.shortestPathToAny(traversalOn(line, "car"), makeNodeId("a"), ids(["a", "c"])),
    );

    expect(path.cost).toBe(0);
  });
});

describe("reachable", () => {
  it("returns the component, starting with the node it was given", () => {
    const result = graphLogic.reachable(traversalOn(split, "car"), makeNodeId("a"));

    expect(result).toEqual({ kind: "reachable", nodeIds: ids(["a", "b"]) });
  });

  it("returns nothing at all for a node the graph does not have", () => {
    const result = graphLogic.reachable(traversalOn(line, "car"), makeNodeId("nowhere"));

    expect(result).toEqual({ kind: "reachable", nodeIds: [] });
  });

  it("shrinks when the mode cannot use the edges", () => {
    const result = graphLogic.reachable(traversalOn(shortcut, "transit"), makeNodeId("a"));

    expect(result).toEqual({ kind: "reachable", nodeIds: ids(["a"]) });
  });
});

/** A chain of `length` nodes joined by roads, for walking into the expansion cap. */
const chainOf = (length: number): MapGraph => {
  const names = Array.from({ length }, (_, index) => `n${index}`);
  const edges = names.slice(1).map((name, index) => edge("road", names[index] ?? "", name));
  return graphOf(names, edges);
};

describe("the expansion cap", () => {
  it("reports the cap instead of searching on", () => {
    const traversal: Traversal = { ...traversalOn(line, "car"), maxExpansions: 1 };

    expect(graphLogic.shortestPath(traversal, makeNodeId("a"), makeNodeId("c"))).toEqual({
      kind: "expansion_limit_exceeded",
      expansions: 2,
    });
  });

  it("caps reachability too", () => {
    const traversal: Traversal = { ...traversalOn(line, "car"), maxExpansions: 2 };

    expect(graphLogic.reachable(traversal, makeNodeId("a"))).toEqual({
      kind: "expansion_limit_exceeded",
      expansions: 3,
    });
  });

  it("defaults to LIMITS.maxSearchExpansions: a graph one node over is refused", () => {
    const atLimit = chainOf(LIMITS.maxSearchExpansions);
    const overLimit = chainOf(LIMITS.maxSearchExpansions + 1);
    const last = (graph: MapGraph) => graph.nodes[graph.nodes.length - 1]?.id ?? makeNodeId("");

    expect(
      graphLogic.shortestPath(traversalOn(atLimit, "car"), makeNodeId("n0"), last(atLimit)).kind,
    ).toBe("path");
    expect(
      graphLogic.shortestPath(traversalOn(overLimit, "car"), makeNodeId("n0"), last(overLimit)),
    ).toEqual({
      kind: "expansion_limit_exceeded",
      expansions: LIMITS.maxSearchExpansions + 1,
    });
  });
});

const MAX_RANDOM_NODES = 8;

const randomGraph = fc
  .record({
    nodeCount: fc.integer({ min: 2, max: MAX_RANDOM_NODES }),
    pairs: fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
        fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
      ),
      { maxLength: 16 },
    ),
  })
  .map(({ nodeCount, pairs }) => {
    const names = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
    const edges = pairs
      .filter(([from, to]) => from < nodeCount && to < nodeCount && from !== to)
      .map(([from, to]) => edge("road", `n${from}`, `n${to}`));
    return graphOf(names, edges);
  });

const endpoints = fc.tuple(
  fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
  fc.integer({ min: 0, max: MAX_RANDOM_NODES - 1 }),
);

describe("invariants over random graphs", () => {
  propertyTest.prop([randomGraph, endpoints])(
    "a returned path is a real walk whose cost is the sum of its edges",
    (graph, [fromIndex, toIndex]) => {
      const nodeCount = graph.nodes.length;
      const traversal = traversalOn(graph, "car");
      const from = makeNodeId(`n${fromIndex % nodeCount}`);
      const to = makeNodeId(`n${toIndex % nodeCount}`);
      const result = graphLogic.shortestPath(traversal, from, to);
      if (result.kind !== "path") {
        return;
      }

      expect(result.nodeIds.at(0)).toBe(from);
      expect(result.nodeIds.at(-1)).toBe(to);
      expect(result.edgeIds).toHaveLength(result.nodeIds.length - 1);

      let walked = 0;
      result.edgeIds.forEach((edgeId, index) => {
        const step = graph.edges.find((candidate) => candidate.id === edgeId);
        const ends = [step?.from, step?.to];
        expect(ends).toContain(result.nodeIds[index]);
        expect(ends).toContain(result.nodeIds[index + 1]);
        walked += BALANCE.edges.road.costByMode.car ?? 0;
      });
      expect(result.cost).toBe(walked);
    },
  );

  propertyTest.prop([randomGraph, endpoints])(
    "a path exists exactly when the destination is reachable",
    (graph, [fromIndex, toIndex]) => {
      const nodeCount = graph.nodes.length;
      const traversal = traversalOn(graph, "car");
      const from = makeNodeId(`n${fromIndex % nodeCount}`);
      const to = makeNodeId(`n${toIndex % nodeCount}`);

      const path = graphLogic.shortestPath(traversal, from, to);
      const reachable = graphLogic.reachable(traversal, from);
      if (reachable.kind !== "reachable") {
        return;
      }

      expect(path.kind === "path").toBe(reachable.nodeIds.includes(to));
    },
  );
});
