import { BALANCE, type GameSetup, type HunterActionKind, targetKindOf } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_DRAFT_TEST_ID, ACTION_OPTION_TEST_ID, ACTION_PANEL_TEST_ID } from "./actionpanel";
import {
  DISPATCH_ERRORS_TEST_ID,
  DISPATCH_REFUSAL_TEST_ID,
  DISPATCH_REJECTION_TEST_ID,
} from "./dispatcherrors";
import { DISPATCH_SCREEN_TEST_ID, DispatchScreen } from "./dispatchscreen";
import { END_SCREEN_OUTCOME_TEST_ID, END_SCREEN_TEST_ID } from "./endscreen";
import { createGameStore, type GameStore } from "./gamestore";
import { LIMITS } from "./limits";
import { MAP_EDGE_TEST_ID, MAP_NODE_TEST_ID, MAP_TEST_ID } from "./maprenderer";
import { METERS_TEST_ID } from "./meters";
import { NEW_HUNT_TEST_ID } from "./newhuntform";
import { REPLAY_SCREEN_TEST_ID } from "./replayscreen";
import { REPORT_FEED_TEST_ID } from "./reportfeed";
import { SHARE_LINK_LOAD_ERROR_TEST_ID, SHARE_LINK_TEST_ID } from "./sharelink";
import { GameStoreProvider } from "./storecontext";
import {
  END_TURN_TEST_ID,
  QUEUE_ADD_TEST_ID,
  QUEUE_REFUSAL_TEST_ID,
  QUEUE_REMOVE_TEST_ID,
  QUEUE_ROW_TEST_ID,
} from "./turnqueue";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * PLAN M5.5a's acceptance criterion, under jsdom: selecting an action narrows the map to the
 * targets that action accepts. The narrowing is the screen's, not the renderer's - `MapRenderer`
 * is controlled and reports every click, and this is the owner that decides which ones count.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 1;

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (store: GameStore): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <GameStoreProvider store={store}>
        <DispatchScreen />
      </GameStoreProvider>,
    );
  });
};

const started = async (): Promise<GameStore> => {
  const store = createGameStore(TEST_GAME_DEPS, BALANCE);
  await render(store);
  await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

  return store;
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

const firstNode = (): Element => all(MAP_NODE_TEST_ID)[0] as Element;
const firstEdge = (): Element => all(MAP_EDGE_TEST_ID)[0] as Element;

const selectedCount = (testId: string): number =>
  all(testId).filter((element) => element.getAttribute("data-selected") === "true").length;

const clickOn = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const arm = async (kind: HunterActionKind): Promise<void> => {
  const option = container?.querySelector(
    `[data-testid="${ACTION_OPTION_TEST_ID}"][data-action="${kind}"]`,
  );
  await clickOn(option as Element);
};

const draftReady = (): string | null =>
  find(ACTION_DRAFT_TEST_ID)?.getAttribute("data-ready") ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the dispatch screen before a hunt", () => {
  it("is the new hunt form, and no dispatch board at all", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(find(NEW_HUNT_TEST_ID)).not.toBeNull();
    expect(find(DISPATCH_SCREEN_TEST_ID)).toBeNull();
    expect(find(ACTION_PANEL_TEST_ID)).toBeNull();
  });

  it("becomes the dispatch screen once a hunt has started", async () => {
    await started();

    expect(find(NEW_HUNT_TEST_ID)).toBeNull();
    expect(find(DISPATCH_SCREEN_TEST_ID)).not.toBeNull();
  });
});

describe("the dispatch screen", () => {
  it("puts the city, the board, the meters and the feed on one screen", async () => {
    await started();

    for (const testId of [MAP_TEST_ID, ACTION_PANEL_TEST_ID, METERS_TEST_ID, REPORT_FEED_TEST_ID]) {
      expect(find(testId)).not.toBeNull();
    }
  });

  it("takes a selection of any kind while no action is armed", async () => {
    await started();

    await clickOn(firstNode());
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);

    await clickOn(firstEdge());
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(1);
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
  });
});

describe("narrowing the map to the armed action's targets", () => {
  it("lets a roadblock take a road and ignores every district", async () => {
    await started();
    await arm("roadblock");

    await clickOn(firstNode());

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
    expect(draftReady()).toBe("false");

    await clickOn(firstEdge());

    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(1);
    expect(draftReady()).toBe("true");
  });

  it("lets a canvass take a district and ignores every road", async () => {
    await started();
    await arm("canvass");

    await clickOn(firstEdge());

    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);
    expect(draftReady()).toBe("false");

    await clickOn(firstNode());

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);
    expect(draftReady()).toBe("true");
  });

  it("narrows to districts for CCTV too, because core says that is what it takes", async () => {
    await started();
    await arm("pull_cctv");

    expect(targetKindOf("pull_cctv")).toBe("node");

    await clickOn(firstEdge());
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);

    await clickOn(firstNode());
    expect(draftReady()).toBe("true");
  });

  it("drops a selection the newly armed action cannot use", async () => {
    await started();

    await clickOn(firstNode());
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);

    await arm("roadblock");

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
    expect(draftReady()).toBe("false");
  });

  it("keeps a selection the newly armed action can still use", async () => {
    await started();
    await arm("canvass");
    await clickOn(firstNode());

    await arm("pull_cctv");

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);
    expect(draftReady()).toBe("true");
  });

  it("needs no map target at all for a briefing", async () => {
    await started();
    await arm("true_briefing");

    expect(draftReady()).toBe("true");
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);
  });

  it("ignores the map entirely while a briefing is armed", async () => {
    await started();
    await arm("true_briefing");

    await clickOn(firstNode());
    await clickOn(firstEdge());

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);
  });
});

/**
 * PLAN M5.5b: the queue, the turn it becomes, and the two error surfaces PLAN M5.2's note names.
 * The Playwright half of the acceptance criterion is `e2e/turn.spec.ts`; these are the assertions
 * that are cheaper and more exhaustive under jsdom ("Decisions": Playwright keeps two flows).
 */

const queueRowCount = (): number => all(QUEUE_ROW_TEST_ID).length;

const turnOf = (store: GameStore): number => {
  const { hunt } = store.getState();
  if (!hunt) throw new Error("expected a hunt to be running");

  return hunt.view.clock.turn;
};

const outcomeOf = (store: GameStore): string => {
  const { hunt } = store.getState();
  if (!hunt) throw new Error("expected a hunt to be running");

  return hunt.view.outcome.kind;
};

const addToTurn = async (): Promise<void> => {
  await clickOn(find(QUEUE_ADD_TEST_ID) as Element);
};

const endTurn = async (): Promise<void> => {
  await clickOn(find(END_TURN_TEST_ID) as Element);
};

const queueRoadblock = async (): Promise<void> => {
  await arm("roadblock");
  await clickOn(firstEdge());
  await addToTurn();
};

const queueBriefing = async (): Promise<void> => {
  await arm("true_briefing");
  await addToTurn();
};

/** Ends turns through the store until the hunt settles, so the screen is looking at a dead world. */
const playOut = async (store: GameStore): Promise<void> => {
  for (let played = 0; played < PLAY_OUT_LIMIT; played += 1) {
    if (outcomeOf(store) !== "in_progress") return;
    await act(async () => store.getState().endTurn([]));
  }
  throw new Error("the hunt did not end inside its deadline");
};

const PLAY_OUT_LIMIT = 24;

describe("queueing a turn", () => {
  it("stages nothing until the draft is complete", async () => {
    await started();
    await arm("roadblock");

    expect(find(QUEUE_ADD_TEST_ID)?.hasAttribute("disabled")).toBe(true);
    expect(queueRowCount()).toBe(0);
  });

  it("takes the armed action and its target into the turn", async () => {
    await started();
    await queueRoadblock();

    expect(queueRowCount()).toBe(1);
    expect(all(QUEUE_ROW_TEST_ID)[0]?.getAttribute("data-action")).toBe("roadblock");
  });

  it("lets go of the board once a row is staged, so the same one is not staged twice", async () => {
    await started();
    await queueRoadblock();

    expect(draftReady()).toBe("false");
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);
    expect(find(QUEUE_ADD_TEST_ID)?.hasAttribute("disabled")).toBe(true);
  });

  it("stacks more than one action into the same turn", async () => {
    await started();
    await queueRoadblock();
    await queueBriefing();

    expect(queueRowCount()).toBe(2);
  });

  it("drops the row the player asked to drop", async () => {
    await started();
    await queueRoadblock();
    await queueBriefing();

    await clickOn(all(QUEUE_REMOVE_TEST_ID)[0] as Element);

    expect(queueRowCount()).toBe(1);
    expect(all(QUEUE_ROW_TEST_ID)[0]?.getAttribute("data-action")).toBe("true_briefing");
  });

  /** AGENTS.md section 5, at the boundary the clicks arrive on: refused, never truncated. */
  it("refuses the row past LIMITS.maxQueuedActions and keeps the full turn", async () => {
    await started();
    for (let staged = 0; staged < LIMITS.maxQueuedActions; staged += 1) {
      await queueBriefing();
    }
    expect(queueRowCount()).toBe(LIMITS.maxQueuedActions);

    await queueBriefing();

    expect(queueRowCount()).toBe(LIMITS.maxQueuedActions);
    expect(find(QUEUE_REFUSAL_TEST_ID)?.getAttribute("data-refusal")).toBe("too_many_queued");
  });
});

describe("ending a turn", () => {
  it("moves the clock on, which is what the turn counter reads", async () => {
    const store = await started();
    const before = turnOf(store);

    await queueRoadblock();
    await endTurn();

    expect(turnOf(store)).toBe(before + 1);
  });

  it("moves the clock on for a turn that queued nothing, because waiting is a move", async () => {
    const store = await started();
    const before = turnOf(store);

    await endTurn();

    expect(turnOf(store)).toBe(before + 1);
  });

  it("records the queue it played, which is what a share link is made of", async () => {
    const store = await started();

    await queueRoadblock();
    await endTurn();

    expect(store.getState().hunt?.recordedActions).toHaveLength(1);
    expect(store.getState().hunt?.recordedActions[0]).toHaveLength(1);
  });

  it("empties the queue, so the next turn starts from nothing", async () => {
    await started();

    await queueRoadblock();
    await endTurn();

    expect(queueRowCount()).toBe(0);
  });
});

describe("the errors a dispatch comes back with", () => {
  it("shows none while the turn is still being staged", async () => {
    await started();
    await queueRoadblock();

    expect(find(DISPATCH_ERRORS_TEST_ID)).toBeNull();
  });

  it("marks the row the turn would not take, by its place in the queue", async () => {
    const store = await started();
    const overAllowance = store.getState().balance.hunter.actionPointsPerTurn + 1;
    for (let staged = 0; staged < overAllowance; staged += 1) {
      await queueBriefing();
    }

    await endTurn();

    const rejections = all(DISPATCH_REJECTION_TEST_ID);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.getAttribute("data-index")).toBe(String(overAllowance - 1));
    expect(rejections[0]?.getAttribute("data-rejection")).toBe("not_enough_action_points");
    expect(find(DISPATCH_REFUSAL_TEST_ID)).toBeNull();
  });

  it("still played the turn the rejected row was in", async () => {
    const store = await started();
    const before = turnOf(store);
    const overAllowance = store.getState().balance.hunter.actionPointsPerTurn + 1;
    for (let staged = 0; staged < overAllowance; staged += 1) {
      await queueBriefing();
    }

    await endTurn();

    expect(turnOf(store)).toBe(before + 1);
    expect(queueRowCount()).toBe(0);
  });
});

/**
 * PLAN M5.6a, resolving the Inbox note M5.5b left: once the hunt is over, this screen swaps to
 * `EndScreenPanel` instead of waiting for a further dispatch to be refused. The two tests this
 * replaces staged a turn on top of an already-settled hunt and asserted `hunt_over` on the
 * refusal surface; that surface is gone with the rest of the board once the swap happens, so
 * `hunt_over` is exercised directly against `DispatchErrors` in `dispatcherrors.test.tsx` instead
 * and this file asserts the swap that makes it unreachable through play.
 */
describe("once the hunt is over", () => {
  it("swaps the board for the end screen, leaving no further dispatch to make", async () => {
    const store = await started();
    await playOut(store);

    expect(find(DISPATCH_SCREEN_TEST_ID)).toBeNull();
    expect(find(END_TURN_TEST_ID)).toBeNull();
    expect(find(ACTION_PANEL_TEST_ID)).toBeNull();
    expect(find(END_SCREEN_TEST_ID)).not.toBeNull();
  });

  it("renders the replay screen beside the end screen (PLAN M5.6b)", async () => {
    const store = await started();
    await playOut(store);

    expect(find(REPLAY_SCREEN_TEST_ID)).not.toBeNull();
  });

  it("renders the share link beside the end screen (PLAN M5.6b-2)", async () => {
    const store = await started();
    await playOut(store);

    expect(find(SHARE_LINK_TEST_ID)).not.toBeNull();
  });
});

describe("a share link that failed to load (PLAN M5.6b-2)", () => {
  it("shows the problem next to the new hunt form, rather than nothing at all", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().loadShared("not a replay"));

    expect(find(NEW_HUNT_TEST_ID)).not.toBeNull();
    expect(find(SHARE_LINK_LOAD_ERROR_TEST_ID)).not.toBeNull();
  });

  it("names the outcome the hunt actually ended with", async () => {
    const store = await started();
    await playOut(store);

    expect(find(END_SCREEN_OUTCOME_TEST_ID)?.getAttribute("data-outcome")).toBe(outcomeOf(store));
  });
});
