import type { ActionRejection, HunterAction, PlanningRejection } from "@manhunter/core";
import { makeEdgeId, makeNodeId } from "@manhunter/core";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISPATCH_ERRORS_TEST_ID,
  DISPATCH_REFUSAL_TEST_ID,
  DISPATCH_REJECTION_TEST_ID,
  DispatchErrors,
  refusalMessage,
  rejectedRows,
  rejectionMessage,
} from "./dispatcherrors";
import type { StoreRefusal } from "./gamestore";
import type { PlaceNames } from "./placenames";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const EDGE = makeEdgeId("e-1");
const NODE = makeNodeId("n-1");

const BLOCK: HunterAction = { kind: "roadblock", edgeId: EDGE };
const BRIEFING: HunterAction = { kind: "true_briefing" };

const NAMES: PlaceNames = {
  nodes: {},
  edges: { "e-1": "Harbor St" },
  avenues: [],
  streets: [],
};

/**
 * One of every variant, written out rather than generated: the point of the list is that adding
 * a refusal to `core` or to the store breaks this file at compile time as well as at run time.
 */
const EVERY_REFUSAL: readonly StoreRefusal[] = [
  { kind: "deadline_too_long", requestedTurns: 500, maxTurns: 240 },
  {
    kind: "generation_failed",
    attempts: 128,
    lastFailure: { kind: "map_too_large", requestedNodes: 900, maxNodes: 256 },
  },
  { kind: "too_many_actions", requestedActions: 40, maxActions: 32 },
  { kind: "hunt_over", outcome: { kind: "captured", turn: 6 } },
  { kind: "no_hunt" },
  { kind: "too_many_recorded_turns", recordedTurns: 240, maxTurns: 240 },
];

const EVERY_REJECTION: readonly ActionRejection[] = [
  { kind: "not_enough_action_points", required: 2, available: 1 },
  { kind: "not_enough_budget", required: 30, available: 5 },
  { kind: "unknown_edge", edgeId: EDGE },
  { kind: "unknown_node", nodeId: NODE },
  { kind: "edge_not_blockable", edgeId: EDGE },
  { kind: "edge_already_blocked", edgeId: EDGE },
];

describe("refusalMessage", () => {
  it("has a sentence for every refusal the store can hold", () => {
    for (const refusal of EVERY_REFUSAL) {
      expect(refusalMessage(refusal), refusal.kind).not.toBe("");
    }
  });

  it("says what the bound was and what was asked for", () => {
    const message = refusalMessage({
      kind: "too_many_actions",
      requestedActions: 40,
      maxActions: 32,
    });

    expect(message).toContain("40");
    expect(message).toContain("32");
  });

  it("gives every refusal its own words", () => {
    const messages = EVERY_REFUSAL.map(refusalMessage);

    expect(new Set(messages).size).toBe(EVERY_REFUSAL.length);
  });
});

describe("rejectionMessage", () => {
  it("has a sentence for every reason core can reject an action for", () => {
    for (const reason of EVERY_REJECTION) {
      expect(rejectionMessage(reason), reason.kind).not.toBe("");
    }
  });

  it("says what was needed and what was left", () => {
    const message = rejectionMessage({ kind: "not_enough_budget", required: 30, available: 5 });

    expect(message).toContain("30");
    expect(message).toContain("5");
  });

  it("names the road a blocked-edge rejection is about", () => {
    expect(rejectionMessage({ kind: "edge_already_blocked", edgeId: EDGE })).toContain("e-1");
  });

  it("gives every reason its own words", () => {
    const messages = EVERY_REJECTION.map(rejectionMessage);

    expect(new Set(messages).size).toBe(EVERY_REJECTION.length);
  });
});

describe("rejectedRows", () => {
  const REJECTED: PlanningRejection = {
    index: 1,
    reason: { kind: "not_enough_action_points", required: 2, available: 1 },
  };

  it("names the row of the submitted queue the rejection points at", () => {
    const rows = rejectedRows([BLOCK, BRIEFING], [REJECTED], NAMES);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.index).toBe(1);
    expect(rows[0]?.action).toContain("Brief the press");
  });

  it("does not name a row the rejection does not point at", () => {
    expect(rejectedRows([BLOCK, BRIEFING], [REJECTED], NAMES)[0]?.action).not.toContain(
      "Roadblock",
    );
  });

  it("still carries the reason when the queue has no such row", () => {
    const rows = rejectedRows([], [REJECTED], NAMES);

    expect(rows[0]?.message).toBe(rejectionMessage(REJECTED.reason));
  });

  it("has no rows when the turn rejected nothing", () => {
    expect(rejectedRows([BLOCK], [], NAMES)).toEqual([]);
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (element: ReactElement): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(element));
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the dispatch errors panel", () => {
  it("draws nothing at all when the dispatch went through", async () => {
    await render(
      <DispatchErrors placeNames={NAMES} refusal={null} dispatched={[BLOCK]} rejections={[]} />,
    );

    expect(find(DISPATCH_ERRORS_TEST_ID)).toBeNull();
  });

  it("draws the refusal for a dispatch that did not happen", async () => {
    await render(
      <DispatchErrors
        placeNames={NAMES}
        refusal={{ kind: "no_hunt" }}
        dispatched={[]}
        rejections={[]}
      />,
    );

    const refusal = find(DISPATCH_REFUSAL_TEST_ID);
    expect(refusal?.getAttribute("data-refusal")).toBe("no_hunt");
    expect(refusal?.textContent).toBe(refusalMessage({ kind: "no_hunt" }));
    expect(all(DISPATCH_REJECTION_TEST_ID)).toHaveLength(0);
  });

  it("draws one row per rejected action, against the row it belongs to", async () => {
    const rejections: readonly PlanningRejection[] = [
      { index: 0, reason: { kind: "edge_already_blocked", edgeId: EDGE } },
      { index: 1, reason: { kind: "not_enough_action_points", required: 2, available: 1 } },
    ];

    await render(
      <DispatchErrors
        placeNames={NAMES}
        refusal={null}
        dispatched={[BLOCK, BRIEFING]}
        rejections={rejections}
      />,
    );

    const rows = all(DISPATCH_REJECTION_TEST_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-index")).toBe("0");
    expect(rows[0]?.getAttribute("data-rejection")).toBe("edge_already_blocked");
    expect(rows[0]?.textContent).toContain("Roadblock - Harbor St");
    expect(rows[1]?.getAttribute("data-index")).toBe("1");
    expect(rows[1]?.textContent).toContain("Brief the press");
  });

  it("draws a refusal and a rejection at once, because they are different surfaces", async () => {
    await render(
      <DispatchErrors
        placeNames={NAMES}
        refusal={{ kind: "hunt_over", outcome: { kind: "escaped", turn: 9 } }}
        dispatched={[BLOCK]}
        rejections={[{ index: 0, reason: { kind: "unknown_edge", edgeId: EDGE } }]}
      />,
    );

    expect(find(DISPATCH_REFUSAL_TEST_ID)).not.toBeNull();
    expect(all(DISPATCH_REJECTION_TEST_ID)).toHaveLength(1);
  });
});
