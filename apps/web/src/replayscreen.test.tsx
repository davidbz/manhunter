import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BELIEF_LEGEND_TEST_ID } from "./belieflegend";
import { CRIMINAL_PATH_MARKER_TEST_ID } from "./criminalpath";
import { createGameStore, type GameStore } from "./gamestore";
import { REPLAY_MAP_TEST_ID, REPLAY_SCREEN_TEST_ID, ReplayScreen } from "./replayscreen";
import { REPLAY_SCRUBBER_INPUT_TEST_ID, REPLAY_SCRUBBER_TURN_TEST_ID } from "./replayscrubber";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * PLAN M5.6b's AC itself: under jsdom, scrubbing to a turn shows the criminal's position for it.
 * This drives the real range input the player drags, against a city the generator actually
 * produced and a hunt played out through the real turn logic - the map, the belief overlay, the
 * path and the scrubber, composed the way `DispatchScreen` composes them.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 1;

/** Every MVP hunt is over well inside the deadline (PLAN M3.8c), so this only bounds the loop. */
const PLAY_OUT_LIMIT = 24;

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
        <ReplayScreen />
      </GameStoreProvider>,
    );
  });
};

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const markerNodeId = (): string | null =>
  one(CRIMINAL_PATH_MARKER_TEST_ID)?.getAttribute("data-nodeid") ?? null;

const outcomeOf = (store: GameStore): string => {
  const { hunt } = store.getState();
  if (!hunt) throw new Error("expected a hunt to be running");
  return hunt.view.outcome.kind;
};

const playOut = async (store: GameStore): Promise<void> => {
  for (let played = 0; played < PLAY_OUT_LIMIT; played += 1) {
    if (outcomeOf(store) !== "in_progress") return;
    await act(async () => store.getState().endTurn([]));
  }
  throw new Error("the hunt did not end inside its deadline");
};

/**
 * Setting `.value` and dispatching `change` does not reach React's controlled input, which
 * listens through the native setter (`newhuntform.test.tsx`'s pattern for the same reason).
 */
const scrubTo = async (turn: number): Promise<void> => {
  const range = one(REPLAY_SCRUBBER_INPUT_TEST_ID) as HTMLInputElement | null;
  if (!range) throw new Error("expected the scrubber's range input to be rendered");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as (
    this: HTMLInputElement,
    value: string,
  ) => void;
  await act(async () => {
    setValue.call(range, String(turn));
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the replay screen", () => {
  it("renders nothing before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(one(REPLAY_SCREEN_TEST_ID)).toBeNull();
  });

  it("renders nothing while the hunt is still in progress", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(one(REPLAY_SCREEN_TEST_ID)).toBeNull();
  });

  it("scrubbing to a turn shows the criminal's true position for it", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);
    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    await playOut(store);
    const frames = store.getState().hunt?.frames ?? null;
    if (frames === null) throw new Error("expected the settled hunt to carry frames");

    for (const expected of frames) {
      await scrubTo(expected.turn);

      expect(one(REPLAY_SCRUBBER_TURN_TEST_ID)?.textContent).toContain(String(expected.turn));
      expect(markerNodeId()).toBe(String(expected.criminalNodeId));
    }
  });

  it("sizes the map in its own container and keys it with the legend (PLAN M6.9)", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);
    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    await playOut(store);

    expect(one(REPLAY_MAP_TEST_ID)?.querySelector("svg")).not.toBeNull();
    expect(one(BELIEF_LEGEND_TEST_ID)).not.toBeNull();
  });
});
