import { BALANCE, type GameSetup, type HunterActionKind, targetKindOf } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_DRAFT_TEST_ID, ACTION_OPTION_TEST_ID, ACTION_PANEL_TEST_ID } from "./actionpanel";
import {
  APP_FRAME_COMMAND_TEST_ID,
  APP_FRAME_INTEL_TEST_ID,
  APP_FRAME_MAP_TEST_ID,
  APP_FRAME_RAIL_TEST_ID,
} from "./appframe";
import { BELIEF_LEGEND_TEST_ID } from "./belieflegend";
import { BELIEF_HEAT_TEST_ID } from "./beliefoverlay";
import { BRIEFING_ITEM_TEST_ID, BRIEFING_SCREEN_TEST_ID } from "./briefingscreen";
import { ClipboardProvider } from "./clipboardcontext";
import { DEBRIEF_SCREEN_TEST_ID } from "./debriefscreen";
import {
  DISPATCH_ERRORS_TEST_ID,
  DISPATCH_REFUSAL_TEST_ID,
  DISPATCH_REJECTION_TEST_ID,
} from "./dispatcherrors";
import { DISPATCH_SCREEN_TEST_ID, DispatchScreen } from "./dispatchscreen";
import { CRIMINAL_DOSSIER_TEST_ID } from "./dossier";
import { END_SCREEN_OUTCOME_TEST_ID, END_SCREEN_TEST_ID } from "./endscreen";
import { createGameStore, type GameStore } from "./gamestore";
import { HEADER_RAIL_ITEM_TEST_ID, HEADER_RAIL_TEST_ID } from "./headerrail";
import { HEATMAP_SUMMARY_TEST_ID, HEATMAP_SUSPECT_TEST_ID } from "./heatmapsummarylist";
import { LIMITS } from "./limits";
import { MAP_FOCUS_BEACON_RING_TEST_ID, MAP_FOCUS_BEACON_TEST_ID } from "./mapfocusbeacon";
import {
  MAP_PLAN_COST_TAG_TEST_ID,
  MAP_PLAN_GHOST_TEST_ID,
  MAP_PLANNED_ORDER_CLASS,
  MAP_PLANNED_ORDER_TEST_ID,
  MAP_PLANNED_ORDERS_TEST_ID,
} from "./mapplannedorders";
import {
  MAP_EDGE_TEST_ID,
  MAP_NODE_TEST_ID,
  MAP_OVERLAY_TEST_ID,
  MAP_PLAN_TEST_ID,
  MAP_REPORT_PIN_TEST_ID,
  MAP_TEST_ID,
} from "./maprenderer";
import {
  METER_FORECAST_TEST_ID,
  METER_KINDS,
  METER_TEST_ID,
  METER_VALUE_TEST_ID,
  METERS_TEST_ID,
} from "./meters";
import { NEW_HUNT_SEED_TEST_ID, NEW_HUNT_TEST_ID } from "./newhuntform";
import { REPLAY_SCREEN_TEST_ID } from "./replayscreen";
import { REPLAY_SCRUBBER_TEST_ID } from "./replayscrubber";
import { REPORT_ENTRY_TEST_ID, REPORT_FEED_TEST_ID } from "./reportfeed";
import { RESTART_TEST_ID } from "./restartbutton";
import { SHARE_LINK_LOAD_ERROR_TEST_ID, SHARE_LINK_TEST_ID } from "./sharelink";
import { SHARE_LINK_COPY_TEST_ID } from "./sharelinkcopy";
import { SKIP_LINK_TEST_ID } from "./skiplink";
import { GameStoreProvider } from "./storecontext";
import {
  END_TURN_TEST_ID,
  QUEUE_AP_TEST_ID,
  QUEUE_REFUSAL_TEST_ID,
  QUEUE_REMOVE_TEST_ID,
  QUEUE_ROW_TEST_ID,
} from "./turnqueue";
import { TEST_CLIPBOARD, TEST_GAME_DEPS } from "./wiring.testfixture";

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
        <ClipboardProvider clipboard={TEST_CLIPBOARD}>
          <DispatchScreen />
        </ClipboardProvider>
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

const restartOn = async (screen: "debrief" | "briefing"): Promise<void> => {
  const button = container?.querySelector(
    `[data-testid="${RESTART_TEST_ID}"][data-screen="${screen}"]`,
  );
  if (!button) throw new Error(`expected a restart button on the ${screen}`);
  await clickOn(button);
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

  it("is the case briefing: the rules, the redacted suspect and the form (PLAN M6.9)", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    const briefing = find(BRIEFING_SCREEN_TEST_ID);
    expect(briefing?.querySelector(`[data-testid="${NEW_HUNT_TEST_ID}"]`)).not.toBeNull();
    expect(all(BRIEFING_ITEM_TEST_ID).length).toBeGreaterThan(0);
    expect(find(CRIMINAL_DOSSIER_TEST_ID)?.getAttribute("data-subject")).toBe("redacted");
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

  it("lays the panels out in the frame's regions (PLAN M6.2)", async () => {
    await started();

    const inRegion = (region: string, testId: string): boolean =>
      find(region)?.contains(find(testId)) ?? false;

    expect(inRegion(APP_FRAME_RAIL_TEST_ID, HEADER_RAIL_TEST_ID)).toBe(true);
    expect(inRegion(APP_FRAME_MAP_TEST_ID, MAP_TEST_ID)).toBe(true);
    expect(inRegion(APP_FRAME_INTEL_TEST_ID, METERS_TEST_ID)).toBe(true);
    expect(inRegion(APP_FRAME_INTEL_TEST_ID, REPORT_FEED_TEST_ID)).toBe(true);
    expect(inRegion(APP_FRAME_COMMAND_TEST_ID, ACTION_PANEL_TEST_ID)).toBe(true);
    expect(inRegion(APP_FRAME_COMMAND_TEST_ID, END_TURN_TEST_ID)).toBe(true);
  });

  it("keys the map with its legend, under the map in the map region (PLAN M6.6)", async () => {
    await started();

    const map = find(MAP_TEST_ID);
    const legend = find(BELIEF_LEGEND_TEST_ID);

    expect(find(APP_FRAME_MAP_TEST_ID)?.contains(legend)).toBe(true);
    expect(legend === null ? 0 : map?.compareDocumentPosition(legend)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("puts the meters above the feed in the intel column", async () => {
    await started();

    const meters = find(METERS_TEST_ID);
    const feed = find(REPORT_FEED_TEST_ID);

    expect(feed === null ? 0 : meters?.compareDocumentPosition(feed)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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

/**
 * PLAN M7.3: an armed tool places its order where the map is clicked, so there is no longer a
 * selection to narrow while a tool is armed. The narrowing M5.5a asserted here is now asserted on
 * what the click does: a target the tool accepts becomes a queue row, anything else is ignored.
 */

const queueRowCount = (): number => all(QUEUE_ROW_TEST_ID).length;

const queuedActions = (): readonly (string | null)[] =>
  all(QUEUE_ROW_TEST_ID).map((row) => row.getAttribute("data-action"));

const plannedTargets = (): readonly (string | null)[] =>
  all(MAP_PLANNED_ORDER_TEST_ID).map((mark) => mark.getAttribute("data-target"));

const tileOf = (kind: HunterActionKind): Element | null =>
  container?.querySelector(`[data-testid="${ACTION_OPTION_TEST_ID}"][data-action="${kind}"]`) ??
  null;

const armedKind = (): string | null =>
  all(ACTION_OPTION_TEST_ID)
    .find((tile) => tile.getAttribute("data-armed") === "true")
    ?.getAttribute("data-action") ?? null;

const openRoads = (): readonly Element[] =>
  all(MAP_EDGE_TEST_ID).filter((edge) => edge.getAttribute("data-selectable") === "true");

const openRoad = (): Element => {
  const road = openRoads()[0];
  if (road === undefined) throw new Error("expected a road the roadblock can close");

  return road;
};

const nodeAt = (index: number): Element => {
  const node = all(MAP_NODE_TEST_ID)[index];
  if (node === undefined) throw new Error(`expected a district at ${index}`);

  return node;
};

const pointAtTarget = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
};

const press = async (key: string): Promise<void> => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
};

describe("placing orders from the map (PLAN M7.3)", () => {
  it("places a roadblock on the road clicked, and ignores every district", async () => {
    await started();
    await arm("roadblock");

    await clickOn(firstNode());

    expect(queueRowCount()).toBe(0);

    const road = openRoad();
    await clickOn(road);

    expect(queuedActions()).toEqual(["roadblock"]);
    expect(plannedTargets()).toEqual([road.getAttribute("data-edgeid")]);
  });

  it("places a canvass on the district clicked, and ignores every road", async () => {
    await started();
    await arm("canvass");

    await clickOn(firstEdge());

    expect(queueRowCount()).toBe(0);

    await clickOn(firstNode());

    expect(queuedActions()).toEqual(["canvass"]);
  });

  it("targets districts for CCTV too, because core says that is what it takes", async () => {
    await started();
    await arm("pull_cctv");

    expect(targetKindOf("pull_cctv")).toBe("node");

    await clickOn(firstEdge());
    expect(queueRowCount()).toBe(0);

    await clickOn(firstNode());
    expect(queuedActions()).toEqual(["pull_cctv"]);
  });

  /** The absorbed M6.5 Inbox item: a dimmed road is refused by the board, not by core later. */
  it("ignores a road the roadblock cannot close, and one it has already closed", async () => {
    const store = await started();
    await arm("roadblock");
    const unblockableKinds = Object.entries(store.getState().balance.edges)
      .filter(([, properties]) => !properties.blockable)
      .map(([kind]) => kind);
    const footpath = all(MAP_EDGE_TEST_ID).find((edge) =>
      unblockableKinds.includes(edge.getAttribute("data-edgekind") ?? ""),
    );
    if (footpath === undefined) throw new Error("expected a road no roadblock can close");

    await clickOn(footpath);
    expect(queueRowCount()).toBe(0);

    const road = openRoad();
    await clickOn(road);
    await clickOn(road);

    expect(queueRowCount()).toBe(1);
    expect(road.getAttribute("data-selectable")).toBe("false");
  });

  it("dims what the armed action cannot target, and swaps what it dims when re-armed", async () => {
    const store = await started();
    const dimmed = (testId: string): readonly Element[] =>
      all(testId).filter((element) => element.getAttribute("data-selectable") === "false");
    const unblockableKinds = Object.entries(store.getState().balance.edges)
      .filter(([, properties]) => !properties.blockable)
      .map(([kind]) => kind);
    const unblockable = all(MAP_EDGE_TEST_ID).filter((edge) =>
      unblockableKinds.includes(edge.getAttribute("data-edgekind") ?? ""),
    );
    expect(unblockable.length).toBeGreaterThan(0);

    await arm("roadblock");

    expect(dimmed(MAP_NODE_TEST_ID)).toHaveLength(all(MAP_NODE_TEST_ID).length);
    expect(dimmed(MAP_EDGE_TEST_ID)).toEqual(unblockable);

    await arm("canvass");

    expect(dimmed(MAP_NODE_TEST_ID)).toHaveLength(0);
    expect(dimmed(MAP_EDGE_TEST_ID)).toHaveLength(all(MAP_EDGE_TEST_ID).length);
  });

  it("selects nothing while a tool is armed, and drops the selection it was armed over", async () => {
    await started();
    await clickOn(firstNode());
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);

    await arm("canvass");

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);

    await clickOn(nodeAt(1));

    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
  });

  it("takes three canvasses on three districts in four clicks", async () => {
    const store = await started();
    expect(store.getState().balance.hunter.actionPointsPerTurn).toBe(3);

    await arm("canvass");
    await clickOn(nodeAt(0));
    await clickOn(nodeAt(1));
    await clickOn(nodeAt(2));

    expect(queuedActions()).toEqual(["canvass", "canvass", "canvass"]);
    expect(plannedTargets()).toEqual(
      [0, 1, 2].map((index) => nodeAt(index).getAttribute("data-nodeid")),
    );
  });

  it("keeps the tool armed while the plan can pay for another, and lets go when it cannot", async () => {
    await started();
    await arm("canvass");

    await clickOn(nodeAt(0));
    expect(armedKind()).toBe("canvass");

    await clickOn(nodeAt(1));
    await clickOn(nodeAt(2));

    expect(armedKind()).toBeNull();
  });

  it("disables every tile the plan can no longer afford, before the player tries it", async () => {
    await started();
    await arm("canvass");
    await clickOn(nodeAt(0));

    expect(tileOf("roadblock")?.hasAttribute("disabled")).toBe(false);

    await clickOn(nodeAt(1));
    await clickOn(nodeAt(2));

    for (const tile of all(ACTION_OPTION_TEST_ID)) {
      expect(tile.hasAttribute("disabled")).toBe(true);
      expect(tile.getAttribute("data-affordable")).toBe("false");
    }
  });

  it("queues a briefing on the tile click, since it has no target", async () => {
    await started();
    await arm("true_briefing");

    expect(queuedActions()).toEqual(["true_briefing"]);

    await clickOn(firstNode());
    await clickOn(firstEdge());

    expect(queueRowCount()).toBe(1);
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
    expect(selectedCount(MAP_EDGE_TEST_ID)).toBe(0);
  });

  it("stacks different actions into the same turn", async () => {
    await started();
    await arm("roadblock");
    await clickOn(openRoad());
    await arm("true_briefing");

    expect(queuedActions()).toEqual(["roadblock", "true_briefing"]);
  });

  /** AGENTS.md section 5: the count bound is still the first thing `enqueue` checks. */
  it("never holds more rows than LIMITS.maxQueuedActions", async () => {
    await started();
    for (let pressed = 0; pressed <= LIMITS.maxQueuedActions; pressed += 1) {
      await arm("true_briefing");
    }

    expect(queueRowCount()).toBeLessThanOrEqual(LIMITS.maxQueuedActions);
    expect(find(QUEUE_REFUSAL_TEST_ID)).toBeNull();
  });
});

describe("disarming and arming without the pointer (PLAN M7.3)", () => {
  it("disarms on Escape, and places nothing on the next click", async () => {
    await started();
    await arm("canvass");

    await press("Escape");

    expect(armedKind()).toBeNull();

    await clickOn(firstNode());

    expect(queueRowCount()).toBe(0);
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(1);
  });

  it("disarms on a right-click on the map, and keeps the browser's menu away", async () => {
    await started();
    await arm("roadblock");
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    await act(async () => {
      find(MAP_TEST_ID)?.dispatchEvent(menu);
    });

    expect(armedKind()).toBeNull();
    expect(menu.defaultPrevented).toBe(true);
  });

  it("leaves the browser's menu alone while nothing is armed", async () => {
    await started();
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

    await act(async () => {
      find(MAP_TEST_ID)?.dispatchEvent(menu);
    });

    expect(menu.defaultPrevented).toBe(false);
  });

  it("arms the tile whose number is pressed", async () => {
    await started();

    await press("2");
    expect(armedKind()).toBe("canvass");

    await press("1");
    expect(armedKind()).toBe("roadblock");
  });

  it("ignores a number pressed with a modifier, or into a text field", async () => {
    await started();
    const field = document.createElement("input");
    container?.append(field);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    });

    expect(armedKind()).toBeNull();
  });

  it("does not arm a tile by its key once the plan cannot afford it", async () => {
    await started();
    await arm("canvass");
    await clickOn(nodeAt(0));
    await clickOn(nodeAt(1));
    await clickOn(nodeAt(2));

    await press("1");

    expect(armedKind()).toBeNull();
    expect(queueRowCount()).toBe(3);
  });
});

describe("the live plan on the map (PLAN M7.3)", () => {
  const marks = (): readonly Element[] => all(MAP_PLANNED_ORDER_TEST_ID);

  it("draws a numbered marker on every placed order, in the layer above the targets", async () => {
    await started();
    await arm("canvass");
    await clickOn(nodeAt(0));
    await clickOn(nodeAt(1));

    expect(marks().map((mark) => mark.getAttribute("data-index"))).toEqual(["0", "1"]);
    expect(marks()[1]?.getAttribute("data-target")).toBe(nodeAt(1).getAttribute("data-nodeid"));
    expect(find(MAP_PLAN_TEST_ID)?.contains(find(MAP_PLANNED_ORDERS_TEST_ID))).toBe(true);
  });

  it("removes an order when its marker is clicked", async () => {
    await started();
    await arm("canvass");
    await clickOn(nodeAt(0));
    await clickOn(nodeAt(1));
    const badge = marks()[0]?.querySelector(`.${MAP_PLANNED_ORDER_CLASS}`);
    if (!badge) throw new Error("expected the first order's marker");

    await act(async () => {
      badge.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(queueRowCount()).toBe(1);
    expect(plannedTargets()).toEqual([nodeAt(1).getAttribute("data-nodeid")]);
  });

  it("removes an order from its queue row, which gives the plan its points back", async () => {
    await started();
    await arm("canvass");
    await clickOn(nodeAt(0));
    await clickOn(nodeAt(1));
    await clickOn(nodeAt(2));

    await clickOn(all(QUEUE_REMOVE_TEST_ID)[0] as Element);

    expect(queueRowCount()).toBe(2);
    expect(marks()).toHaveLength(2);
    expect(tileOf("canvass")?.hasAttribute("disabled")).toBe(false);
  });

  it("previews the armed order on the target pointed at, with its price and place", async () => {
    await started();
    await arm("roadblock");
    const road = openRoad();

    await pointAtTarget(road);

    const ghost = find(MAP_PLAN_GHOST_TEST_ID);
    expect(ghost?.getAttribute("data-action")).toBe("roadblock");
    expect(ghost?.getAttribute("data-target")).toBe(road.getAttribute("data-edgeid"));
    expect(find(MAP_PLAN_COST_TAG_TEST_ID)?.textContent).toMatch(/^-1 AP -50 -3 trust - /);
    expect(draftReady()).toBe("true");
  });

  it("previews nothing on a target the armed tool would not take", async () => {
    await started();
    await arm("roadblock");

    await pointAtTarget(firstNode());

    expect(find(MAP_PLAN_GHOST_TEST_ID)).toBeNull();
    expect(draftReady()).toBe("false");
  });

  it("previews nothing while no tool is armed", async () => {
    await started();

    await pointAtTarget(firstNode());

    expect(find(MAP_PLAN_GHOST_TEST_ID)).toBeNull();
  });
});

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

const endTurn = async (): Promise<void> => {
  await clickOn(find(END_TURN_TEST_ID) as Element);
};

const queueRoadblock = async (): Promise<void> => {
  await arm("roadblock");
  await clickOn(openRoad());
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

  it("empties the plan and disarms, so the next turn starts from nothing", async () => {
    await started();

    await queueRoadblock();
    await endTurn();

    expect(queueRowCount()).toBe(0);
    expect(all(MAP_PLANNED_ORDER_TEST_ID)).toHaveLength(0);
    expect(armedKind()).toBeNull();
  });
});

/**
 * The board can no longer queue a turn `core` would reject for want of points (PLAN M7.3), so the
 * rejection surface is driven the one way a rejection can still arrive: a turn handed to the store
 * directly, as a replay would hand it.
 */
describe("the errors a dispatch comes back with", () => {
  const OVER_ALLOWANCE = BALANCE.hunter.actionPointsPerTurn + 1;
  const briefings = Array.from({ length: OVER_ALLOWANCE }, () => ({
    kind: "true_briefing" as const,
  }));

  it("shows none while the turn is still being planned", async () => {
    await started();
    await queueRoadblock();

    expect(find(DISPATCH_ERRORS_TEST_ID)).toBeNull();
  });

  it("marks the order the turn would not take, by its place in the turn", async () => {
    const store = await started();

    await act(async () => store.getState().endTurn(briefings));

    const rejections = all(DISPATCH_REJECTION_TEST_ID);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.getAttribute("data-index")).toBe(String(OVER_ALLOWANCE - 1));
    expect(rejections[0]?.getAttribute("data-rejection")).toBe("not_enough_action_points");
    expect(find(DISPATCH_REFUSAL_TEST_ID)).toBeNull();
  });

  it("still played the turn the rejected order was in", async () => {
    const store = await started();
    const before = turnOf(store);

    await act(async () => store.getState().endTurn(briefings));

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

  it("gathers the report, the replay, the dossier and the copyable link in one debrief", async () => {
    const store = await started();
    await playOut(store);

    const debrief = find(DEBRIEF_SCREEN_TEST_ID);
    for (const testId of [
      END_SCREEN_TEST_ID,
      REPLAY_SCREEN_TEST_ID,
      SHARE_LINK_TEST_ID,
      SHARE_LINK_COPY_TEST_ID,
    ]) {
      expect(debrief?.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }
    expect(find(CRIMINAL_DOSSIER_TEST_ID)?.getAttribute("data-subject")).toBe("revealed");
  });

  it("restarts to the briefing and clears the share link (PLAN M6.9)", async () => {
    const store = await started();
    await playOut(store);

    await restartOn("debrief");

    expect(find(BRIEFING_SCREEN_TEST_ID)).not.toBeNull();
    expect(find(NEW_HUNT_TEST_ID)).not.toBeNull();
    expect(find(DEBRIEF_SCREEN_TEST_ID)).toBeNull();
    expect(find(SHARE_LINK_TEST_ID)).toBeNull();
    expect(store.getState().hunt).toBeNull();
  });

  it("starts the next hunt from the briefing it restarted to", async () => {
    const store = await started();
    await playOut(store);
    await restartOn("debrief");

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(find(DISPATCH_SCREEN_TEST_ID)).not.toBeNull();
    expect(turnOf(store)).toBe(0);
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

  it("is cleared by the briefing's restart, which keeps the form (PLAN M6.9)", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);
    await act(async () => store.getState().loadShared("not a replay"));

    await restartOn("briefing");

    expect(find(SHARE_LINK_LOAD_ERROR_TEST_ID)).toBeNull();
    expect(find(NEW_HUNT_TEST_ID)).not.toBeNull();
  });

  it("puts back the seed the player had typed over when the briefing resets", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));
    const seed = find(NEW_HUNT_SEED_TEST_ID);
    if (!(seed instanceof HTMLInputElement)) throw new Error("expected the seed field");
    const defaultSeed = seed.value;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as (
      this: HTMLInputElement,
      value: string,
    ) => void;
    await act(async () => {
      setValue.call(seed, "not a seed");
      seed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((find(NEW_HUNT_SEED_TEST_ID) as HTMLInputElement).value).toBe("not a seed");

    await restartOn("briefing");

    expect((find(NEW_HUNT_SEED_TEST_ID) as HTMLInputElement).value).toBe(defaultSeed);
  });

  it("names the outcome the hunt actually ended with", async () => {
    const store = await started();
    await playOut(store);

    expect(find(END_SCREEN_OUTCOME_TEST_ID)?.getAttribute("data-outcome")).toBe(outcomeOf(store));
  });
});

/**
 * PLAN M6.10's focus-order pass, on the tab sequence jsdom can compute: the document order of
 * everything Tab stops on, since no element in the app sets a positive `tabindex` to reorder it.
 * What a real browser adds - that focus is visible where it lands - is `index.css`'s
 * `:focus-visible` rule, which is not jsdom's to check.
 */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const tabStops = (): readonly Element[] => Array.from(container?.querySelectorAll(TABBABLE) ?? []);

const positiveTabIndexes = (): readonly Element[] =>
  Array.from(container?.querySelectorAll("[tabindex]") ?? []).filter(
    (element) => Number(element.getAttribute("tabindex")) > 0,
  );

const skipLink = (name: string): Element | null =>
  container?.querySelector(`[data-testid="${SKIP_LINK_TEST_ID}"][data-skip="${name}"]`) ?? null;

describe("the focus order (PLAN M6.10)", () => {
  it("never reorders Tab with a positive tabindex, on any screen", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);
    expect(positiveTabIndexes()).toEqual([]);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    expect(positiveTabIndexes()).toEqual([]);

    await playOut(store);
    expect(positiveTabIndexes()).toEqual([]);
  });

  it("reaches the briefing's seed before its start button", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    const stops = tabStops();
    const seed = stops.indexOf(find(NEW_HUNT_SEED_TEST_ID) as Element);
    const submit = stops.findIndex((stop) => stop.getAttribute("type") === "submit");

    expect(seed).toBeGreaterThanOrEqual(0);
    expect(submit).toBeGreaterThan(seed);
  });

  it("stops on the skip link first on the board, before any map target", async () => {
    await started();

    const stops = tabStops();
    const firstMapStop = stops.findIndex((stop) => find(MAP_TEST_ID)?.contains(stop));

    expect(stops[0]).toBe(skipLink("command"));
    expect(firstMapStop).toBeGreaterThan(0);
  });

  it("goes rail, map, intel, command, so End Turn comes after the board it confirms", async () => {
    await started();

    const regions = [
      APP_FRAME_RAIL_TEST_ID,
      APP_FRAME_MAP_TEST_ID,
      APP_FRAME_INTEL_TEST_ID,
      APP_FRAME_COMMAND_TEST_ID,
    ];
    const stops = tabStops();
    const regionIndexes = stops
      .map((stop) => regions.findIndex((region) => find(region)?.contains(stop)))
      .filter((index) => index >= 0);

    expect(regionIndexes).toEqual([...regionIndexes].sort((first, second) => first - second));
    expect(new Set(regionIndexes)).toContain(regions.indexOf(APP_FRAME_MAP_TEST_ID));
    expect(stops.indexOf(find(END_TURN_TEST_ID) as Element)).toBeGreaterThan(
      stops.findIndex((stop) => find(ACTION_PANEL_TEST_ID)?.contains(stop)),
    );
  });

  it("jumps past every map target to the command region from the skip link", async () => {
    await started();

    await clickOn(skipLink("command") as Element);

    expect(document.activeElement).toBe(find(APP_FRAME_COMMAND_TEST_ID));
    expect(find(APP_FRAME_COMMAND_TEST_ID)?.getAttribute("tabindex")).toBe("-1");
  });

  it("gives the debrief's replay a skip link past its map, to the replay controls", async () => {
    const store = await started();
    await playOut(store);

    const stops = tabStops();
    const link = skipLink("replay-controls");
    const firstMapStop = stops.findIndex((stop) => find(MAP_TEST_ID)?.contains(stop));

    expect(stops.indexOf(link as Element)).toBeLessThan(firstMapStop);
    await clickOn(link as Element);
    expect(document.activeElement).toBe(find(REPLAY_SCRUBBER_TEST_ID));
  });
});

describe("the heatmap's text equivalent (PLAN M6.10)", () => {
  it("sits in the map region, ahead of the map, so it is read before the map's targets", async () => {
    await started();

    const summary = find(HEATMAP_SUMMARY_TEST_ID);
    const map = find(MAP_TEST_ID);

    expect(find(APP_FRAME_MAP_TEST_ID)?.contains(summary)).toBe(true);
    expect(map === null ? 0 : summary?.compareDocumentPosition(map)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("lists the view's suspects, bounded, and matches the heat the map draws", async () => {
    await started();

    const listed = all(HEATMAP_SUSPECT_TEST_ID);
    const heated = all(BELIEF_HEAT_TEST_ID).map((blob) => blob.getAttribute("data-nodeid"));

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThanOrEqual(LIMITS.maxHeatmapSummaryEntries);
    for (const row of listed) {
      expect(heated.some((nodeId) => row.textContent?.startsWith(`${nodeId} - `))).toBe(true);
    }
  });

  it("is read out on the debrief's replay too", async () => {
    const store = await started();
    await playOut(store);

    expect(find(REPLAY_SCREEN_TEST_ID)?.contains(find(HEATMAP_SUMMARY_TEST_ID))).toBe(true);
  });
});

const REPORTING_TURNS = 2;

describe("the hover link between the feed and the map (PLAN M7.2)", () => {
  /** Two turns of intel ordered through the store, so the feed has rows at more than one node. */
  const withReports = async (): Promise<GameStore> => {
    const store = await started();
    const map = store.getState().hunt?.view.map;
    const cctvAt = map?.nodes[0]?.id;
    if (map === undefined || cctvAt === undefined) throw new Error("expected a hunt to be running");
    for (let turn = 0; turn < REPORTING_TURNS; turn += 1) {
      await act(async () =>
        store.getState().endTurn([
          { kind: "canvass", nodeId: map.incidentNodeId },
          { kind: "pull_cctv", nodeId: cctvAt },
        ]),
      );
    }

    return store;
  };

  const pointAt = async (element: Element, type: "pointerover" | "pointerout"): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    });
  };

  const rowNodeIds = (): readonly (string | null)[] =>
    all(REPORT_ENTRY_TEST_ID).map((row) => row.getAttribute("data-nodeid"));

  const linkedRows = (): readonly Element[] =>
    all(REPORT_ENTRY_TEST_ID).filter((row) => row.getAttribute("data-linked") === "true");

  it("puts the beacon on a feed row's node while the row is pointed at", async () => {
    await withReports();
    const row = all(REPORT_ENTRY_TEST_ID).at(-1);
    if (row === undefined) throw new Error("expected the feed to hold a report");

    await pointAt(row, "pointerover");

    const ring = find(MAP_FOCUS_BEACON_RING_TEST_ID);
    expect(ring?.getAttribute("data-nodeid")).toBe(row.getAttribute("data-nodeid"));
    expect(find(MAP_OVERLAY_TEST_ID)?.contains(ring)).toBe(true);

    await pointAt(row, "pointerout");

    expect(find(MAP_FOCUS_BEACON_RING_TEST_ID)).toBeNull();
  });

  it("puts the beacon on a feed row's node while the row has keyboard focus", async () => {
    await withReports();
    const row = all(REPORT_ENTRY_TEST_ID)[0];
    if (!(row instanceof HTMLElement)) throw new Error("expected the feed to hold a report");

    await act(async () => row.focus());

    expect(find(MAP_FOCUS_BEACON_RING_TEST_ID)?.getAttribute("data-nodeid")).toBe(
      row.getAttribute("data-nodeid"),
    );
  });

  it("marks exactly the rows at a pin's node as linked while the pin is pointed at", async () => {
    await withReports();
    const pins = all(MAP_REPORT_PIN_TEST_ID);
    const pin = pins.find((each) =>
      rowNodeIds().some((nodeId) => nodeId === each.getAttribute("data-nodeid")),
    );
    if (pin === undefined) throw new Error("expected a pin over a reported node");
    const nodeId = pin.getAttribute("data-nodeid");
    const atNode = all(REPORT_ENTRY_TEST_ID).filter(
      (row) => row.getAttribute("data-nodeid") === nodeId,
    );

    expect(linkedRows()).toEqual([]);
    await pointAt(pin, "pointerover");

    expect(atNode.length).toBeGreaterThan(0);
    expect(atNode.length).toBeLessThan(all(REPORT_ENTRY_TEST_ID).length);
    expect(linkedRows()).toEqual(atNode);

    await pointAt(pin, "pointerout");

    expect(linkedRows()).toEqual([]);
  });

  it("links the rows at a node pointed at on the map, and selects nothing by it", async () => {
    await withReports();
    const nodeId = rowNodeIds()[0] ?? null;
    const node = all(MAP_NODE_TEST_ID).find((each) => each.getAttribute("data-nodeid") === nodeId);
    if (node === undefined) throw new Error("expected the reported node on the map");

    await pointAt(node, "pointerover");

    expect(linkedRows().map((row) => row.getAttribute("data-nodeid"))).toEqual(
      rowNodeIds().filter((each) => each === nodeId),
    );
    expect(find(MAP_FOCUS_BEACON_RING_TEST_ID)?.getAttribute("data-nodeid")).toBe(nodeId);
    expect(selectedCount(MAP_NODE_TEST_ID)).toBe(0);
  });

  it("draws the beacon in a layer that takes no pointer events", async () => {
    await started();

    const layer = find(MAP_FOCUS_BEACON_TEST_ID);
    expect(find(MAP_OVERLAY_TEST_ID)?.contains(layer)).toBe(true);
    expect(layer?.getAttribute("style")).toContain("pointer-events: none");
  });
});

describe("the plan's forecast (PLAN M7.4)", () => {
  const { hunter, actions } = BALANCE;

  const meterOf = (kind: string): Element | null =>
    container?.querySelector(`[data-testid="${METER_TEST_ID}"][data-meter="${kind}"]`) ?? null;

  const readingOf = (kind: string): string =>
    meterOf(kind)?.querySelector(`[data-testid="${METER_VALUE_TEST_ID}"]`)?.textContent ?? "";

  const hatched = (): readonly (string | null)[] =>
    all(METER_FORECAST_TEST_ID).map(
      (hatch) =>
        hatch.closest(`[data-testid="${METER_TEST_ID}"]`)?.getAttribute("data-meter") ?? null,
    );

  const railOf = (kind: string): string | null | undefined =>
    container?.querySelector(`[data-testid="${HEADER_RAIL_ITEM_TEST_ID}"][data-rail="${kind}"] dd`)
      ?.textContent;

  const valuesOf = (): readonly (string | null)[] =>
    METER_KINDS.map((kind) => meterOf(kind)?.getAttribute("data-value") ?? null);

  it("puts the budget in the header rail from the first turn", async () => {
    await started();

    expect(railOf("budget")).toBe(String(hunter.startingBudget));
    expect(railOf("trust")).toBe(`${hunter.startingTrust} of ${hunter.trustMax}`);
  });

  it("moves the forecast on every meter a queued order touches, and on no other", async () => {
    await started();
    const before = valuesOf();

    await arm("roadblock");
    await clickOn(openRoad());

    const points = hunter.actionPointsPerTurn - actions.roadblock.actionPointCost;
    const budget = hunter.startingBudget - actions.roadblock.budgetCost;
    const trust = hunter.startingTrust - actions.roadblock.trustCost;
    expect(hatched()).toEqual(["action_points", "budget", "trust"]);
    expect(readingOf("action_points")).toContain(`${hunter.actionPointsPerTurn} -> ${points}`);
    expect(readingOf("budget")).toContain(`${hunter.startingBudget} -> ${budget}`);
    expect(readingOf("trust")).toContain(`${hunter.startingTrust} -> ${trust}`);
    expect(railOf("budget")).toBe(`${hunter.startingBudget} -> ${budget}`);
    expect(railOf("trust")).toBe(`${hunter.startingTrust} -> ${trust} of ${hunter.trustMax}`);
    expect(find(QUEUE_AP_TEST_ID)?.textContent).toBe(
      `${actions.roadblock.actionPointCost} of ${hunter.actionPointsPerTurn} AP planned`,
    );
    expect(valuesOf()).toEqual(before);
  });

  it("forecasts a briefing's trust as a gain, and spends no budget on it", async () => {
    await started();

    await arm("true_briefing");

    expect(hatched()).toEqual(["action_points", "trust"]);
    expect(readingOf("trust")).toContain(
      `${hunter.startingTrust} -> ${hunter.startingTrust + actions.trueBriefing.trustGain}`,
    );
  });

  it("drops the forecast when the order is taken back out", async () => {
    await started();
    await queueRoadblock();

    await clickOn(all(QUEUE_REMOVE_TEST_ID)[0] as Element);

    expect(hatched()).toEqual([]);
    expect(railOf("budget")).toBe(String(hunter.startingBudget));
  });
});
