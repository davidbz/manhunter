import { describe, expect, it } from "vitest";
import { makeEdgeId, makeNodeId } from "./ids";
import type { EdgeKind, MapEdge, MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";

const downtown = makeNodeId("downtown");
const riverside = makeNodeId("riverside");
const airport = makeNodeId("airport");

const EDGE_KINDS: readonly EdgeKind[] = ["road", "footpath", "rail", "tunnel", "bridge"];

/**
 * Stands in for the exhaustive switches the rules will be written as. Its only assertion is a
 * compile-time one: an edge variant added without a case makes the `never` binding fail.
 */
const kindOf = (edge: MapEdge): EdgeKind => {
  switch (edge.kind) {
    case "road":
      return "road";
    case "footpath":
      return "footpath";
    case "rail":
      return "rail";
    case "tunnel":
      return "tunnel";
    case "bridge":
      return "bridge";
    default: {
      const unreachable: never = edge;
      return unreachable;
    }
  }
};

describe("makeNode", () => {
  it("carries the layout position the SVG export and renderer need", () => {
    const node = makeNode(downtown, "downtown", { x: 10, y: 20 });
    expect(node).toEqual({ id: downtown, districtType: "downtown", position: { x: 10, y: 20 } });
  });
});

describe("makeEdge", () => {
  it("narrows to the variant of the kind it was given", () => {
    const bridge = makeEdge("bridge", makeEdgeId("e1"), downtown, riverside);
    expect(bridge.kind).toBe("bridge");
    expect(kindOf(bridge)).toBe("bridge");
  });

  it("builds every kind in the union", () => {
    const edges = EDGE_KINDS.map((kind, index) =>
      makeEdge(kind, makeEdgeId(`e${index}`), downtown, riverside),
    );
    expect(edges.map((edge) => edge.kind)).toEqual(EDGE_KINDS);
  });
});

describe("makeExit", () => {
  it("is always open unless a schedule says otherwise", () => {
    expect(makeExit(airport, "airport").schedule).toEqual({ kind: "always" });
  });

  it("accepts a timed schedule", () => {
    const ferry = makeExit(airport, "port", { kind: "timed", openTurns: [6, 18] });
    expect(ferry.schedule).toEqual({ kind: "timed", openTurns: [6, 18] });
  });
});

describe("MapGraph", () => {
  it("round-trips through JSON (architecture rule 3)", () => {
    const graph: MapGraph = {
      nodes: [makeNode(downtown, "downtown", { x: 0, y: 0 })],
      edges: [makeEdge("road", makeEdgeId("e1"), downtown, riverside)],
      exits: [makeExit(airport, "airport")],
      incidentNodeId: downtown,
    };
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });
});
