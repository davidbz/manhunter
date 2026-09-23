import { BALANCE, type HunterAction, makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type ActionQueue,
  actionSummary,
  canQueue,
  EMPTY_QUEUE,
  enqueue,
  type PlanAccount,
  queueRows,
  remainingAfter,
  removeAt,
} from "./actionqueue";
import { LIMITS } from "./limits";
import type { PlaceNames } from "./placenames";

const BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-1") };
const OTHER_BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-2") };
const CANVASS: HunterAction = { kind: "canvass", nodeId: makeNodeId("n-7") };
const BRIEFING: HunterAction = { kind: "true_briefing" };

const NAMES: PlaceNames = {
  nodes: { "n-7": "Downtown - 5th Ave & Harbor St" },
  edges: { "e-1": "Harbor St", "e-2": "5th Ave Bridge" },
  avenues: [],
  streets: [],
};

/** Rich enough that only the count bound can refuse, so the bound's tests test the bound. */
const BOTTOMLESS: PlanAccount = {
  resources: { actionPoints: 1_000, budget: 1_000_000, trust: 70 },
  balance: BALANCE,
};

/** A turn as the shipped balance deals it: 3 AP, 1000 budget, 70 trust. */
const TURN: PlanAccount = {
  resources: { actionPoints: 3, budget: 1_000, trust: 70 },
  balance: BALANCE,
};

const queued = (action: HunterAction, count: number): ActionQueue =>
  Array.from({ length: count }, () => action);

const takeQueue = (queue: ActionQueue, action: HunterAction): ActionQueue => {
  const result = enqueue(queue, action, BOTTOMLESS);
  if (result.kind !== "queue") throw new Error(`expected the row to be taken, got ${result.kind}`);

  return result.queue;
};

const takeQueueFrom = (account: PlanAccount, actions: readonly HunterAction[]): ActionQueue =>
  actions.reduce<ActionQueue>((queue, action) => {
    const result = enqueue(queue, action, account);
    if (result.kind !== "queue")
      throw new Error(`expected the row to be taken, got ${result.kind}`);

    return result.queue;
  }, EMPTY_QUEUE);

describe("enqueue", () => {
  it("appends the row to the end of the turn", () => {
    const queue = takeQueue(takeQueue(EMPTY_QUEUE, BLOCK), CANVASS);

    expect(queue).toEqual([BLOCK, CANVASS]);
  });

  it("leaves the queue it was given alone", () => {
    const first = takeQueue(EMPTY_QUEUE, BLOCK);
    takeQueue(first, CANVASS);

    expect(first).toEqual([BLOCK]);
  });

  it("takes the same action twice, because a turn may repeat one", () => {
    expect(takeQueue(takeQueue(EMPTY_QUEUE, BRIEFING), BRIEFING)).toHaveLength(2);
  });

  it("fills a turn right up to the bound", () => {
    const full = queued(BRIEFING, LIMITS.maxQueuedActions - 1);

    expect(takeQueue(full, BRIEFING)).toHaveLength(LIMITS.maxQueuedActions);
  });

  /** AGENTS.md section 5: the row over the bound is an error result, never a truncation. */
  it("refuses the row one past the bound and keeps the queue whole", () => {
    const full = queued(BRIEFING, LIMITS.maxQueuedActions);

    const result = enqueue(full, BRIEFING, BOTTOMLESS);

    expect(result).toEqual({
      kind: "too_many_queued",
      queued: LIMITS.maxQueuedActions,
      maxQueued: LIMITS.maxQueuedActions,
    });
    expect(full).toHaveLength(LIMITS.maxQueuedActions);
  });

  it("goes on refusing once the queue is over the bound", () => {
    const over = queued(BRIEFING, LIMITS.maxQueuedActions + 1);

    expect(enqueue(over, BRIEFING, BOTTOMLESS).kind).toBe("too_many_queued");
  });
});

describe("remainingAfter (PLAN M7.3)", () => {
  it("leaves what the hunter holds untouched for an empty plan", () => {
    expect(remainingAfter(TURN.resources, EMPTY_QUEUE, BALANCE)).toEqual(TURN.resources);
  });

  it("subtracts each order's AP, budget and trust, priced by the balance", () => {
    const remaining = remainingAfter(TURN.resources, [BLOCK, CANVASS], BALANCE);

    expect(remaining).toEqual({
      actionPoints: 3 - 1 - 1,
      budget: 1_000 - 50 - 20,
      trust: 70 - 3 - 1,
    });
  });

  it("adds the trust a briefing gains and charges it no budget", () => {
    expect(remainingAfter(TURN.resources, [BRIEFING], BALANCE)).toEqual({
      actionPoints: 2,
      budget: 1_000,
      trust: 74,
    });
  });

  it("clamps trust to its bounds after every order, the way core charges it", () => {
    const nearlyFull = { ...TURN.resources, actionPoints: 10, trust: 99 };

    expect(remainingAfter(nearlyFull, [BRIEFING, BLOCK], BALANCE).trust).toBe(100 - 3);
  });

  /** An over-the-limit plan is not truncated or floored: the forecast shows the overspend. */
  it("goes negative for a plan that overspends, rather than stopping at zero", () => {
    const remaining = remainingAfter(TURN.resources, queued(BLOCK, 25), BALANCE);

    expect(remaining.actionPoints).toBe(3 - 25);
    expect(remaining.budget).toBe(1_000 - 25 * 50);
    expect(remaining.trust).toBe(0);
  });
});

describe("enqueue against the plan's remainder (PLAN M7.3)", () => {
  it("takes orders until the turn's action points are planned", () => {
    const full = takeQueueFrom(TURN, [CANVASS, CANVASS, CANVASS]);

    expect(full).toHaveLength(3);
    expect(enqueue(full, CANVASS, TURN)).toEqual({
      kind: "not_enough_action_points",
      required: 1,
      available: 0,
    });
  });

  it("refuses an order the remaining budget cannot cover, naming what is left", () => {
    const poor: PlanAccount = { ...TURN, resources: { ...TURN.resources, budget: 60 } };
    const one = takeQueueFrom(poor, [BLOCK]);

    expect(enqueue(one, CANVASS, poor)).toEqual({
      kind: "not_enough_budget",
      required: 20,
      available: 10,
    });
  });

  it("names action points first when both fall short, as core's validate does", () => {
    const broke: PlanAccount = { ...TURN, resources: { actionPoints: 0, budget: 0, trust: 70 } };

    expect(enqueue(EMPTY_QUEUE, BLOCK, broke).kind).toBe("not_enough_action_points");
  });

  it("never refuses for trust, which core clamps rather than validates", () => {
    const distrusted: PlanAccount = { ...TURN, resources: { ...TURN.resources, trust: 0 } };

    expect(enqueue(EMPTY_QUEUE, BLOCK, distrusted).kind).toBe("queue");
  });

  it("checks the count bound before the meters", () => {
    const full = queued(BRIEFING, LIMITS.maxQueuedActions);

    expect(enqueue(full, BRIEFING, TURN).kind).toBe("too_many_queued");
  });
});

describe("canQueue", () => {
  it("answers what enqueue would do with one more of the kind", () => {
    const two = takeQueueFrom(TURN, [CANVASS, CANVASS]);

    expect(canQueue(two, "canvass", TURN)).toBe(true);
    expect(canQueue([...two, CANVASS], "canvass", TURN)).toBe(false);
  });

  it("is false at the count bound whatever the meters say", () => {
    expect(canQueue(queued(BRIEFING, LIMITS.maxQueuedActions), "true_briefing", BOTTOMLESS)).toBe(
      false,
    );
  });
});

describe("removeAt", () => {
  it("drops the named row and nothing else", () => {
    expect(removeAt([BLOCK, CANVASS, BRIEFING], 1)).toEqual([BLOCK, BRIEFING]);
  });

  it("drops one of two identical rows, not both", () => {
    expect(removeAt([BRIEFING, BRIEFING], 0)).toEqual([BRIEFING]);
  });

  it("leaves a queue that has no such row exactly as it was", () => {
    expect(removeAt([BLOCK], 4)).toEqual([BLOCK]);
  });
});

describe("actionSummary", () => {
  /** PLAN M7.1: the target is named by the hunt's place names, and the raw id never shows. */
  it("names the action the board names it, and the road it points at by name", () => {
    expect(actionSummary(BLOCK, NAMES)).toContain("Roadblock");
    expect(actionSummary(BLOCK, NAMES)).toContain("Harbor St");
    expect(actionSummary(BLOCK, NAMES)).not.toContain("e-1");
  });

  it("names a district target by name", () => {
    expect(actionSummary(CANVASS, NAMES)).toContain("Downtown - 5th Ave & Harbor St");
    expect(actionSummary(CANVASS, NAMES)).not.toContain("n-7");
  });

  it("names the city for an action that points at nothing", () => {
    expect(actionSummary(BRIEFING, NAMES)).toContain("the whole city");
  });

  it("tells two roadblocks on different roads apart", () => {
    expect(actionSummary(BLOCK, NAMES)).not.toBe(actionSummary(OTHER_BLOCK, NAMES));
  });
});

describe("queueRows", () => {
  it("carries the position of every row, which is what a rejection names", () => {
    expect(queueRows([BLOCK, CANVASS], NAMES).map((row) => row.index)).toEqual([0, 1]);
  });

  it("carries the same words actionSummary gives", () => {
    expect(queueRows([BLOCK], NAMES)[0]?.summary).toBe(actionSummary(BLOCK, NAMES));
  });

  it("has no rows for an empty turn", () => {
    expect(queueRows(EMPTY_QUEUE, NAMES)).toEqual([]);
  });
});
