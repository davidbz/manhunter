import {
  BALANCE,
  type EdgeKind,
  type HunterAction,
  makeEdge,
  makeEdgeId,
  makeNodeId,
  type Roadblock,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  closedEdgeIdsOf,
  edgeSelectable,
  nodeSelectable,
  selectableOf,
  selectionSelectable,
} from "./mapselectable";

const A = makeNodeId("n-a");
const B = makeNodeId("n-b");
const edgeOf = (kind: EdgeKind) => makeEdge(kind, makeEdgeId(`e-${kind}`), A, B);
const NONE_CLOSED = [] as const;

describe("what an armed action can target", () => {
  it("leaves every target live when nothing is armed", () => {
    expect(nodeSelectable(null)).toBe(true);
    expect(edgeSelectable(null, edgeOf("footpath"))).toBe(true);
  });

  it("keeps nodes and dims every edge for a node action", () => {
    const selectable = selectableOf("canvass", BALANCE.edges, NONE_CLOSED);

    expect(selectable).toEqual({ kind: "node" });
    expect(nodeSelectable(selectable)).toBe(true);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(false);
  });

  it("keeps only blockable edges for a roadblock, so a footpath dims", () => {
    const selectable = selectableOf("roadblock", BALANCE.edges, NONE_CLOSED);

    expect(nodeSelectable(selectable)).toBe(false);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(true);
    expect(edgeSelectable(selectable, edgeOf("footpath"))).toBe(false);
  });

  it("reads blockable from the balance it is given, not a fixed list", () => {
    const edges = { ...BALANCE.edges, road: { ...BALANCE.edges.road, blockable: false } };

    expect(edgeSelectable(selectableOf("roadblock", edges, NONE_CLOSED), edgeOf("road"))).toBe(
      false,
    );
  });

  it("dims everything for an action with no map target", () => {
    const selectable = selectableOf("true_briefing", BALANCE.edges, NONE_CLOSED);

    expect(selectable).toEqual({ kind: "none" });
    expect(nodeSelectable(selectable)).toBe(false);
    expect(edgeSelectable(selectable, edgeOf("road"))).toBe(false);
  });
});

describe("closed edges (PLAN M7.3)", () => {
  const road = edgeOf("road");
  const standing = (expiresAt: number): Roadblock => ({
    kind: "roadblock",
    edgeId: road.id,
    expiresAt,
  });

  it("dims a road a standing checkpoint already closes", () => {
    const closed = closedEdgeIdsOf([standing(5)], 2, []);

    expect(edgeSelectable(selectableOf("roadblock", BALANCE.edges, closed), road)).toBe(false);
  });

  it("lets a road go live again once its checkpoint has expired", () => {
    const closed = closedEdgeIdsOf([standing(2)], 2, []);

    expect(edgeSelectable(selectableOf("roadblock", BALANCE.edges, closed), road)).toBe(true);
  });

  it("dims a road the plan already blocks, because a second block on it is refused", () => {
    const planned: HunterAction = { kind: "roadblock", edgeId: road.id };
    const closed = closedEdgeIdsOf([], 0, [planned, { kind: "true_briefing" }]);

    expect(closed).toEqual([road.id]);
    expect(edgeSelectable(selectableOf("roadblock", BALANCE.edges, closed), road)).toBe(false);
  });
});

describe("selectionSelectable", () => {
  const road = edgeOf("road");
  const footpath = edgeOf("footpath");
  const edges = [road, footpath];
  const roadblock = selectableOf("roadblock", BALANCE.edges, NONE_CLOSED);

  it("asks the same question of a click that the map dims by", () => {
    expect(selectionSelectable(roadblock, { kind: "edge", edgeId: road.id }, edges)).toBe(true);
    expect(selectionSelectable(roadblock, { kind: "edge", edgeId: footpath.id }, edges)).toBe(
      false,
    );
    expect(selectionSelectable(roadblock, { kind: "node", nodeId: A }, edges)).toBe(false);
  });

  it("refuses an edge the map does not carry", () => {
    const missing = { kind: "edge", edgeId: makeEdgeId("e-missing") } as const;

    expect(selectionSelectable(null, missing, edges)).toBe(false);
  });
});
