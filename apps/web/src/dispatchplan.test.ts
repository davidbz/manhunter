import { BALANCE, makeEdge, makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import type { PlanAccount } from "./actionqueue";
import {
  armTool,
  clickTarget,
  type DispatchPlan,
  disarmTool,
  draftOf,
  EMPTY_PLAN,
  removeOrder,
  type TargetContext,
  targetAccepted,
} from "./dispatchplan";
import type { MapSelection } from "./maprenderer";
import { selectableOf } from "./mapselectable";

const A = makeNodeId("n-a");
const B = makeNodeId("n-b");
const C = makeNodeId("n-c");
const ROAD = makeEdge("road", makeEdgeId("e-road"), A, B);
const FOOTPATH = makeEdge("footpath", makeEdgeId("e-foot"), B, C);
const EDGES = [ROAD, FOOTPATH];

const AT_A: MapSelection = { kind: "node", nodeId: A };
const AT_B: MapSelection = { kind: "node", nodeId: B };
const AT_C: MapSelection = { kind: "node", nodeId: C };
const ON_ROAD: MapSelection = { kind: "edge", edgeId: ROAD.id };
const ON_FOOTPATH: MapSelection = { kind: "edge", edgeId: FOOTPATH.id };

/** A turn as the shipped balance deals it: 3 AP, 1000 budget, 70 trust. */
const TURN: PlanAccount = {
  resources: { actionPoints: 3, budget: 1_000, trust: 70 },
  balance: BALANCE,
};

const contextFor = (plan: DispatchPlan, account: PlanAccount = TURN): TargetContext => {
  const closed = plan.queue.flatMap((action) => ("edgeId" in action ? [action.edgeId] : []));

  return {
    account,
    selectable:
      plan.armed === null ? null : selectableOf(plan.armed, account.balance.edges, closed),
    edges: EDGES,
  };
};

const clickEach = (plan: DispatchPlan, targets: readonly MapSelection[]): DispatchPlan =>
  targets.reduce((current, target) => clickTarget(current, target, contextFor(current)), plan);

describe("arming a tool", () => {
  it("arms a targeted tool and queues nothing yet", () => {
    const plan = armTool(EMPTY_PLAN, "canvass", TURN);

    expect(plan.armed).toBe("canvass");
    expect(plan.queue).toEqual([]);
  });

  it("places a global order at once, and stays armed while another would fit", () => {
    const plan = armTool(EMPTY_PLAN, "true_briefing", TURN);

    expect(plan.queue).toEqual([{ kind: "true_briefing" }]);
    expect(plan.armed).toBe("true_briefing");
  });

  it("changes nothing when the plan cannot afford the tool", () => {
    const spent = clickEach(armTool(EMPTY_PLAN, "canvass", TURN), [AT_A, AT_B, AT_C]);

    expect(armTool(spent, "roadblock", TURN)).toBe(spent);
  });

  it("disarms without touching the queue", () => {
    const plan = clickEach(armTool(EMPTY_PLAN, "canvass", TURN), [AT_A]);

    expect(disarmTool(plan)).toEqual({ ...plan, armed: null });
  });
});

describe("clicking the map with a tool armed", () => {
  it("takes three canvasses on three districts after one arm, then lets go", () => {
    const plan = clickEach(armTool(EMPTY_PLAN, "canvass", TURN), [AT_A, AT_B, AT_C]);

    expect(plan.queue.map((action) => ("nodeId" in action ? action.nodeId : null))).toEqual([
      A,
      B,
      C,
    ]);
    expect(plan.armed).toBeNull();
    expect(plan.refusal).toBeNull();
  });

  it("stays armed while the plan can still pay for another of the same order", () => {
    const plan = clickEach(armTool(EMPTY_PLAN, "canvass", TURN), [AT_A]);

    expect(plan.armed).toBe("canvass");
  });

  it("lets go after the order that spends the budget, even with points left", () => {
    const tight: PlanAccount = { ...TURN, resources: { ...TURN.resources, budget: 50 } };
    const armed = armTool(EMPTY_PLAN, "roadblock", tight);
    const plan = clickTarget(armed, ON_ROAD, contextFor(armed, tight));

    expect(plan.queue).toHaveLength(1);
    expect(plan.armed).toBeNull();
  });

  it("ignores a click while nothing is armed", () => {
    expect(clickTarget(EMPTY_PLAN, AT_A, contextFor(EMPTY_PLAN))).toBe(EMPTY_PLAN);
  });

  it("ignores a target of the wrong kind", () => {
    const armed = armTool(EMPTY_PLAN, "roadblock", TURN);

    expect(clickTarget(armed, AT_A, contextFor(armed))).toBe(armed);
  });

  it("ignores a road no roadblock can close, and one the plan already closes", () => {
    const armed = armTool(EMPTY_PLAN, "roadblock", TURN);
    const once = clickTarget(armed, ON_ROAD, contextFor(armed));

    expect(clickTarget(armed, ON_FOOTPATH, contextFor(armed))).toBe(armed);
    expect(clickTarget(once, ON_ROAD, contextFor(once))).toBe(once);
  });
});

describe("removing an order", () => {
  it("drops the order at the index and clears a refusal", () => {
    const plan = clickEach(armTool(EMPTY_PLAN, "canvass", TURN), [AT_A, AT_B]);
    const refused: DispatchPlan = {
      ...plan,
      refusal: { kind: "not_enough_action_points", required: 1, available: 0 },
    };

    const removed = removeOrder(refused, 0);

    expect(removed.queue).toEqual([plan.queue[1]]);
    expect(removed.refusal).toBeNull();
    expect(removed.armed).toBe(plan.armed);
  });
});

describe("targetAccepted", () => {
  it("takes a target only if the tool takes its kind and the map would not dim it", () => {
    const context = { selectable: selectableOf("roadblock", BALANCE.edges, []), edges: EDGES };

    expect(targetAccepted("roadblock", ON_ROAD, context)).toBe(true);
    expect(targetAccepted("roadblock", ON_FOOTPATH, context)).toBe(false);
    expect(targetAccepted("roadblock", AT_A, context)).toBe(false);
  });
});

describe("draftOf", () => {
  const roadblockContext = {
    selectable: selectableOf("roadblock", BALANCE.edges, []),
    edges: EDGES,
  };

  it("drafts nothing while nothing is armed", () => {
    expect(draftOf(null, ON_ROAD, roadblockContext)).toEqual({ target: null, draft: null });
  });

  it("drafts the armed order on the hovered target the tool would take", () => {
    expect(draftOf("roadblock", ON_ROAD, roadblockContext)).toEqual({
      target: ON_ROAD,
      draft: { kind: "roadblock", edgeId: ROAD.id },
    });
  });

  it("drafts nothing for a hovered target the tool would refuse, or for no target", () => {
    expect(draftOf("roadblock", ON_FOOTPATH, roadblockContext).draft).toBeNull();
    expect(draftOf("roadblock", null, roadblockContext).draft).toBeNull();
  });

  it("drafts a global order with no target at all", () => {
    const context = { selectable: selectableOf("true_briefing", BALANCE.edges, []), edges: EDGES };

    expect(draftOf("true_briefing", null, context).draft).toEqual({ kind: "true_briefing" });
  });
});
