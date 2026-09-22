import type { MapNode } from "@manhunter/core";
import { makeNode, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { positionIndexOf } from "./mapnodes";

const NODE_A = makeNode(makeNodeId("n-a"), "downtown", { x: 5, y: 12 });
const NODE_B = makeNode(makeNodeId("n-b"), "park", { x: 30, y: 7 });
const NODES: readonly MapNode[] = [NODE_A, NODE_B];

describe("indexing a map's nodes by id", () => {
  it("finds each node's position by its id", () => {
    const positions = positionIndexOf(NODES);

    expect(positions.get(NODE_A.id)).toEqual(NODE_A.position);
    expect(positions.get(NODE_B.id)).toEqual(NODE_B.position);
  });

  it("has nothing for a node id the map does not carry", () => {
    const positions = positionIndexOf(NODES);

    expect(positions.get(makeNodeId("n-off-map"))).toBeUndefined();
  });

  it("indexes an empty map to nothing", () => {
    expect(positionIndexOf([]).size).toBe(0);
  });
});
