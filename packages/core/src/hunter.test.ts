import { describe, expect, it } from "vitest";
import type { HunterAction, HunterState } from "./hunter";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";

const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;

const input: Omit<HunterState, "containments"> = {
  actionPoints: START_ACTION_POINTS,
  budget: START_BUDGET,
  trust: START_TRUST,
  pressure: START_PRESSURE,
};

/** Compile-time exhaustiveness over the MVP action set; the AP cost table is PLAN M3.3. */
const targetOf = (action: HunterAction): string => {
  switch (action.kind) {
    case "roadblock":
      return action.edgeId;
    case "canvass":
    case "pull_cctv":
      return action.nodeId;
    case "true_briefing":
      return "";
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
};

describe("makeHunterState", () => {
  it("starts with nothing deployed", () => {
    expect(makeHunterState(input).containments).toEqual([]);
  });

  it("keeps the resources it was given", () => {
    expect(makeHunterState(input)).toEqual({ ...input, containments: [] });
  });

  it("round-trips through JSON with a standing roadblock (architecture rule 3)", () => {
    const hunter: HunterState = {
      ...makeHunterState(input),
      containments: [{ kind: "roadblock", edgeId: makeEdgeId("e1"), expiresAt: 7 }],
    };
    expect(JSON.parse(JSON.stringify(hunter))).toEqual(hunter);
  });
});

describe("HunterAction", () => {
  it("targets an edge, a node, or nothing at all", () => {
    expect(targetOf({ kind: "roadblock", edgeId: makeEdgeId("e1") })).toBe("e1");
    expect(targetOf({ kind: "canvass", nodeId: makeNodeId("park") })).toBe("park");
    expect(targetOf({ kind: "pull_cctv", nodeId: makeNodeId("park") })).toBe("park");
    expect(targetOf({ kind: "true_briefing" })).toBe("");
  });
});
