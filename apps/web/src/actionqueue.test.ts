import { type HunterAction, makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type ActionQueue,
  actionSummary,
  EMPTY_QUEUE,
  enqueue,
  queueRows,
  removeAt,
} from "./actionqueue";
import { LIMITS } from "./limits";

const BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-1") };
const OTHER_BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-2") };
const CANVASS: HunterAction = { kind: "canvass", nodeId: makeNodeId("n-7") };
const BRIEFING: HunterAction = { kind: "true_briefing" };

const queued = (action: HunterAction, count: number): ActionQueue =>
  Array.from({ length: count }, () => action);

const takeQueue = (queue: ActionQueue, action: HunterAction): ActionQueue => {
  const result = enqueue(queue, action);
  if (result.kind !== "queue") throw new Error(`expected the row to be taken, got ${result.kind}`);

  return result.queue;
};

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

    const result = enqueue(full, BRIEFING);

    expect(result).toEqual({
      kind: "too_many_queued",
      queued: LIMITS.maxQueuedActions,
      maxQueued: LIMITS.maxQueuedActions,
    });
    expect(full).toHaveLength(LIMITS.maxQueuedActions);
  });

  it("goes on refusing once the queue is over the bound", () => {
    const over = queued(BRIEFING, LIMITS.maxQueuedActions + 1);

    expect(enqueue(over, BRIEFING).kind).toBe("too_many_queued");
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
  it("names the action the board names it, and the target it points at", () => {
    expect(actionSummary(BLOCK)).toContain("Roadblock");
    expect(actionSummary(BLOCK)).toContain("e-1");
  });

  it("names a district target", () => {
    expect(actionSummary(CANVASS)).toContain("n-7");
  });

  it("names the city for an action that points at nothing", () => {
    expect(actionSummary(BRIEFING)).toContain("the whole city");
  });

  it("tells two roadblocks on different roads apart", () => {
    expect(actionSummary(BLOCK)).not.toBe(actionSummary(OTHER_BLOCK));
  });
});

describe("queueRows", () => {
  it("carries the position of every row, which is what a rejection names", () => {
    expect(queueRows([BLOCK, CANVASS]).map((row) => row.index)).toEqual([0, 1]);
  });

  it("carries the same words actionSummary gives", () => {
    expect(queueRows([BLOCK])[0]?.summary).toBe(actionSummary(BLOCK));
  });

  it("has no rows for an empty turn", () => {
    expect(queueRows(EMPTY_QUEUE)).toEqual([]);
  });
});
