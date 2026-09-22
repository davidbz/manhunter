import { BALANCE, type GameSetup, type HunterActionKind, targetKindOf } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_DRAFT_TEST_ID, ACTION_OPTION_TEST_ID, ACTION_PANEL_TEST_ID } from "./actionpanel";
import { DISPATCH_SCREEN_TEST_ID, DispatchScreen } from "./dispatchscreen";
import { createGameStore, type GameStore } from "./gamestore";
import { MAP_EDGE_TEST_ID, MAP_NODE_TEST_ID, MAP_TEST_ID } from "./maprenderer";
import { METERS_TEST_ID } from "./meters";
import { NEW_HUNT_TEST_ID } from "./newhuntform";
import { REPORT_FEED_TEST_ID } from "./reportfeed";
import { GameStoreProvider } from "./storecontext";
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
