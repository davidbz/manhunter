import { type HunterAction, makeEdgeId, makeNodeId } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ActionQueue, QueueRefusal } from "./actionqueue";
import { LIMITS } from "./limits";
import {
  END_TURN_TEST_ID,
  QUEUE_ADD_TEST_ID,
  QUEUE_REFUSAL_TEST_ID,
  QUEUE_REMOVE_TEST_ID,
  QUEUE_ROW_TEST_ID,
  queueRefusalMessage,
  TURN_QUEUE_TEST_ID,
  TurnQueue,
} from "./turnqueue";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("e-1") };
const CANVASS: HunterAction = { kind: "canvass", nodeId: makeNodeId("n-7") };

const TOO_MANY: QueueRefusal = {
  kind: "too_many_queued",
  queued: LIMITS.maxQueuedActions,
  maxQueued: LIMITS.maxQueuedActions,
};

let root: Root | null = null;
let container: HTMLElement | null = null;
let removed: number[] = [];
let added = 0;
let ended = 0;

type Overrides = {
  readonly queue?: ActionQueue;
  readonly draft?: HunterAction | null;
  readonly refusal?: QueueRefusal | null;
};

const render = async (overrides: Overrides = {}): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <TurnQueue
        queue={overrides.queue ?? []}
        draft={overrides.draft === undefined ? BLOCK : overrides.draft}
        refusal={overrides.refusal ?? null}
        onAdd={() => {
          added += 1;
        }}
        onRemove={(index) => {
          removed = [...removed, index];
        }}
        onEndTurn={() => {
          ended += 1;
        }}
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
  added = 0;
  ended = 0;
});

describe("queueRefusalMessage", () => {
  it("says how full the turn is and how full it may be", () => {
    const message = queueRefusalMessage(TOO_MANY);

    expect(message).toContain(String(LIMITS.maxQueuedActions));
    expect(message).not.toBe("");
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
    expect(rows[0]?.textContent).toContain("e-1");
    expect(rows[1]?.getAttribute("data-action")).toBe("canvass");
    expect(rows[1]?.textContent).toContain("n-7");
  });

  it("offers no way to stage an action that has no target yet", async () => {
    await render({ draft: null });

    expect(find(QUEUE_ADD_TEST_ID)?.hasAttribute("disabled")).toBe(true);
  });

  it("stages the draft when there is one", async () => {
    await render({ draft: CANVASS });

    await clickOn(find(QUEUE_ADD_TEST_ID));

    expect(added).toBe(1);
  });

  it("names the row the player asked to drop", async () => {
    await render({ queue: [BLOCK, CANVASS] });

    await clickOn(all(QUEUE_REMOVE_TEST_ID)[1] ?? null);

    expect(removed).toEqual([1]);
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
