import { type HunterAction, makeEdgeId, makeNodeId } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_ICON_TEST_ID } from "./actionicon";
import type { ActionQueue, QueueRefusal } from "./actionqueue";
import STYLESHEET from "./index.css?raw";
import { LIMITS } from "./limits";
import type { PlaceNames } from "./placenames";
import {
  type ActionPointPlan,
  actionPointPipsOf,
  actionPointPlanOf,
  actionPointPlanText,
  END_TURN_TEST_ID,
  lineNumberOf,
  QUEUE_AP_PIP_TEST_ID,
  QUEUE_AP_TEST_ID,
  QUEUE_COUNT_TEST_ID,
  QUEUE_REFUSAL_TEST_ID,
  QUEUE_REMOVE_TEST_ID,
  QUEUE_ROW_TEST_ID,
  queueCountText,
  queueRefusalMessage,
  TURN_QUEUE_TEST_ID,
  TurnQueue,
} from "./turnqueue";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-1") };
const CANVASS: HunterAction = { kind: "canvass", nodeId: makeNodeId("n-7") };

const NAMES: PlaceNames = {
  nodes: { "n-7": "Downtown - 5th Ave & Harbor St" },
  edges: { "e-1": "Harbor St" },
  avenues: [],
  streets: [],
};

const TOO_MANY: QueueRefusal = {
  kind: "too_many_queued",
  queued: LIMITS.maxQueuedActions,
  maxQueued: LIMITS.maxQueuedActions,
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let removed: number[] = [];
let ended = 0;

type Overrides = {
  readonly queue?: ActionQueue;
  readonly refusal?: QueueRefusal | null;
  readonly actionPoints?: ActionPointPlan;
};

const NOTHING_PLANNED: ActionPointPlan = { planned: 0, available: 3 };

const render = async (overrides: Overrides = {}): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <TurnQueue
        queue={overrides.queue ?? []}
        refusal={overrides.refusal ?? null}
        onRemove={(index) => {
          removed = [...removed, index];
        }}
        onEndTurn={() => {
          ended += 1;
        }}
        placeNames={NAMES}
        actionPoints={overrides.actionPoints ?? NOTHING_PLANNED}
      />,
    );
  });
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

const clickOn = async (element: Element | null): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
  removed = [];
  ended = 0;
});

describe("queueRefusalMessage", () => {
  it("says how full the turn is and how full it may be", () => {
    const message = queueRefusalMessage(TOO_MANY);

    expect(message).toContain(String(LIMITS.maxQueuedActions));
    expect(message).not.toBe("");
  });

  it("says what the plan still needs and has, for either meter (PLAN M7.3)", () => {
    const points = queueRefusalMessage({
      kind: "not_enough_action_points",
      required: 1,
      available: 0,
    });
    const budget = queueRefusalMessage({ kind: "not_enough_budget", required: 50, available: 30 });

    expect(points).toContain("action points");
    expect(points).toContain("needs 1, has 0");
    expect(budget).toContain("budget");
    expect(budget).toContain("needs 50, has 30");
  });
});

describe("the turn queue", () => {
  it("says the turn is empty before anything is staged", async () => {
    await render();

    expect(all(QUEUE_ROW_TEST_ID)).toHaveLength(0);
    expect(find(TURN_QUEUE_TEST_ID)?.getAttribute("data-queued")).toBe("0");
  });

  it("draws one row per staged action, in the order they were staged", async () => {
    await render({ queue: [BLOCK, CANVASS] });

    const rows = all(QUEUE_ROW_TEST_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-action")).toBe("roadblock");
    expect(rows[0]?.textContent).toContain("Harbor St");
    expect(rows[1]?.getAttribute("data-action")).toBe("canvass");
    expect(rows[1]?.textContent).toContain("Downtown - 5th Ave & Harbor St");
  });

  /**
   * PLAN M7.3 removed the Add button: an order is staged by pointing the armed tool at the map,
   * so the queue has no control that stages anything, and `queue-add` is gone on purpose.
   */
  it("has no Add button, because orders are placed from the map", async () => {
    await render({ queue: [BLOCK] });

    expect(container?.querySelector('[data-testid="queue-add"]')).toBeNull();
    expect(
      Array.from(container?.querySelectorAll("button") ?? []).map((button) =>
        button.getAttribute("data-testid"),
      ),
    ).toEqual([QUEUE_REMOVE_TEST_ID, END_TURN_TEST_ID]);
  });

  it("names the row the player asked to drop", async () => {
    await render({ queue: [BLOCK, CANVASS] });

    await clickOn(all(QUEUE_REMOVE_TEST_ID)[1] ?? null);

    expect(removed).toEqual([1]);
  });

  /**
   * PLAN M7.3: a click anywhere on the line removes it. The line's one control is its Remove
   * button, stretched over the line by the stylesheet, which jsdom does not lay out; so the
   * stretch is asserted as the rule it is, and the hit itself in `turn.spec.ts`.
   */
  it("stretches each line's Remove button over the whole line", async () => {
    await render({ queue: [BLOCK] });

    expect(all(QUEUE_REMOVE_TEST_ID)[0]?.classList.contains("mh-order__remove")).toBe(true);
    expect(STYLESHEET).toMatch(/\.mh-order__line \{\n {2}position: relative;/);
    expect(STYLESHEET).toMatch(
      /\.mh-order__remove::after \{[^}]*position: absolute;[^}]*inset: 0;/,
    );
  });

  it("ends the turn on an empty queue too, because waiting is a move", async () => {
    await render();

    await clickOn(find(END_TURN_TEST_ID));

    expect(find(END_TURN_TEST_ID)?.hasAttribute("disabled")).toBe(false);
    expect(ended).toBe(1);
  });

  it("shows nothing about the bound until a row is refused by it", async () => {
    await render({ queue: [BLOCK] });

    expect(find(QUEUE_REFUSAL_TEST_ID)).toBeNull();
  });

  it("says why a row was refused when the turn is full", async () => {
    await render({ refusal: TOO_MANY });

    const refusal = find(QUEUE_REFUSAL_TEST_ID);
    expect(refusal?.getAttribute("data-refusal")).toBe("too_many_queued");
    expect(refusal?.textContent).toBe(queueRefusalMessage(TOO_MANY));
  });
});

describe("the dispatch order form (PLAN M6.8)", () => {
  it("numbers lines from one, padded to a column", () => {
    expect(lineNumberOf(0)).toBe("01");
    expect(lineNumberOf(LIMITS.maxQueuedActions - 1)).toBe(String(LIMITS.maxQueuedActions));
  });

  it("counts the lines used against the queue's bound", async () => {
    await render({ queue: [BLOCK, CANVASS] });

    expect(find(QUEUE_COUNT_TEST_ID)?.textContent).toBe(queueCountText(2, LIMITS.maxQueuedActions));
    expect(queueCountText(2, LIMITS.maxQueuedActions)).toBe(`2 / ${LIMITS.maxQueuedActions} lines`);
  });

  it("gives every line its number and its action's icon", async () => {
    await render({ queue: [BLOCK, CANVASS] });

    const rows = all(QUEUE_ROW_TEST_ID);
    expect(rows.map((row) => row.textContent?.slice(0, 2))).toEqual(["01", "02"]);
    expect(
      rows.map((row) =>
        row.querySelector(`[data-testid="${ACTION_ICON_TEST_ID}"]`)?.getAttribute("data-icon"),
      ),
    ).toEqual(["roadblock", "canvass"]);
  });
});

describe("the plan in action points (PLAN M7.4)", () => {
  it("counts what the plan spends of what the turn holds", () => {
    const held = { actionPoints: 3, budget: 1000, trust: 70 };
    const left = { actionPoints: 1, budget: 930, trust: 66 };

    expect(actionPointPlanOf(held, left)).toEqual({ planned: 2, available: 3 });
    expect(actionPointPlanText({ planned: 2, available: 3 })).toBe("2 of 3 AP planned");
  });

  it("draws one pip per point held, filled for each the plan spends", async () => {
    await render({ queue: [BLOCK, CANVASS], actionPoints: { planned: 2, available: 3 } });

    const head = find(QUEUE_AP_TEST_ID);
    expect(head?.textContent).toBe("2 of 3 AP planned");
    expect(head?.getAttribute("data-planned")).toBe("2");
    expect(head?.getAttribute("data-available")).toBe("3");
    expect(all(QUEUE_AP_PIP_TEST_ID).map((pip) => pip.getAttribute("data-filled"))).toEqual([
      "true",
      "true",
      "false",
    ]);
  });

  it("draws no pips for a turn with no action points, and never a negative count", () => {
    expect(actionPointPipsOf({ planned: 0, available: 0 })).toEqual([]);
    expect(actionPointPipsOf({ planned: 1, available: -1 })).toEqual([]);
  });
});
