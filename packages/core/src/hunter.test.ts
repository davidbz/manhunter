import { describe, expect, it } from "vitest";
import type { HunterAction, HunterState } from "./hunter";
import { blockedEdgeIdsAt, makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";

const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;

const input: Omit<HunterState, "containments" | "briefingTurns"> = {
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
  it("starts with nothing deployed and nothing said", () => {
    expect(makeHunterState(input).containments).toEqual([]);
    expect(makeHunterState(input).briefingTurns).toEqual([]);
  });

  it("keeps the resources it was given", () => {
    expect(makeHunterState(input)).toEqual({ ...input, containments: [], briefingTurns: [] });
  });

  it("round-trips through JSON with a standing roadblock (architecture rule 3)", () => {
    const hunter: HunterState = {
      ...makeHunterState(input),
      containments: [{ kind: "roadblock", edgeId: makeEdgeId("e1"), expiresAt: 7 }],
      briefingTurns: [2, 5],
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

describe("blockedEdgeIdsAt", () => {
  const road = makeEdgeId("road");
  const bridge = makeEdgeId("bridge");
  const PLACED_AT = 3;
  const DURATION = 4;
  const EXPIRES_AT = PLACED_AT + DURATION;

  const standing: HunterState = {
    ...makeHunterState(input),
    containments: [{ kind: "roadblock", edgeId: road, expiresAt: EXPIRES_AT }],
  };

  it("blocks from the turn it was placed until the turn it expires, exclusive", () => {
    const blockedOn = (turn: number) => blockedEdgeIdsAt(standing.containments, turn).has(road);

    expect(Array.from({ length: DURATION }, (_, i) => blockedOn(PLACED_AT + i))).toEqual(
      Array.from({ length: DURATION }, () => true),
    );
    expect(blockedOn(EXPIRES_AT)).toBe(false);
    expect(blockedOn(EXPIRES_AT + 1)).toBe(false);
  });

  it("is empty when nothing is deployed", () => {
    expect(blockedEdgeIdsAt(makeHunterState(input).containments, PLACED_AT).size).toBe(0);
  });

  it("keeps the containments that are still standing and drops the ones that are not", () => {
    const mixed = [
      ...standing.containments,
      { kind: "roadblock", edgeId: bridge, expiresAt: PLACED_AT } as const,
    ];

    expect([...blockedEdgeIdsAt(mixed, PLACED_AT)]).toEqual([road]);
  });
});
