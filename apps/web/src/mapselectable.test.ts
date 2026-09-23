import { BALANCE, type EdgeKind, makeEdge, makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { edgeSelectable, nodeSelectable, selectableOf } from "./mapselectable";

const A = makeNodeId("n-a");
const B = makeNodeId("n-b");
const edgeOf = (kind: EdgeKind) => makeEdge(kind, makeEdgeId(`e-${kind}`), A, B);

describe("what an armed action can target", () => {
  it("leaves every target live when nothing is armed", () => {
    expect(nodeSelectable(null)).toBe(true);
    expect(edgeSelectable(null, edgeOf("footpath"))).toBe(true);
  });

  it("keeps nodes and dims every edge for a node action", () => {
    const selectable = selectableOf("canvass", BALANCE.edges);

    expect(selectable).toEqual({ kind: "node" });
    expect(nodeSelectable(selectable)).toBe(true);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(false);
  });

  it("keeps only blockable edges for a roadblock, so a footpath dims", () => {
    const selectable = selectableOf("roadblock", BALANCE.edges);

    expect(nodeSelectable(selectable)).toBe(false);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(true);
    expect(edgeSelectable(selectable, edgeOf("footpath"))).toBe(false);
  });

  it("reads blockable from the balance it is given, not a fixed list", () => {
    const edges = { ...BALANCE.edges, road: { ...BALANCE.edges.road, blockable: false } };

    expect(edgeSelectable(selectableOf("roadblock", edges), edgeOf("road"))).toBe(false);
  });

  it("dims everything for an action with no map target", () => {
    const selectable = selectableOf("true_briefing", BALANCE.edges);

    expect(selectable).toEqual({ kind: "none" });
    expect(nodeSelectable(selectable)).toBe(false);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(false);
  });
});
