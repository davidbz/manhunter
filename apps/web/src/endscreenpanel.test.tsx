import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  END_SCREEN_OUTCOME_TEST_ID,
  END_SCREEN_TEST_ID,
  SCORE_COMPONENT_TEST_ID,
} from "./endscreen";
import { EndScreenPanel } from "./endscreenpanel";
import { createGameStore, type GameStore } from "./gamestore";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of the end screen (PLAN M5.6a). `hunt.score` is projected once per
 * transition, so this only has to prove the panel reads it and stays quiet before there is one.
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
        <EndScreenPanel />
      </GameStoreProvider>,
    );
  });
};

const count = (testId: string): number =>
  container?.querySelectorAll(`[data-testid="${testId}"]`).length ?? 0;

const outcomeOf = (store: GameStore): string => {
  const { hunt } = store.getState();
  if (!hunt) throw new Error("expected a hunt to be running");

  return hunt.view.outcome.kind;
};

/** Ends turns through the store until the hunt settles, so the panel has a breakdown to draw. */
const playOut = async (store: GameStore): Promise<void> => {
  for (let played = 0; played < PLAY_OUT_LIMIT; played += 1) {
    if (outcomeOf(store) !== "in_progress") return;
    await act(async () => store.getState().endTurn([]));
  }
  throw new Error("the hunt did not end inside its deadline");
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the connected end screen", () => {
  it("draws nothing before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(count(END_SCREEN_TEST_ID)).toBe(0);
  });

  it("draws nothing while the hunt is still in progress", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(count(END_SCREEN_TEST_ID)).toBe(0);
  });

  it("draws the breakdown the store scored once the hunt settles", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    await playOut(store);

    expect(count(END_SCREEN_TEST_ID)).toBe(1);
    expect(count(SCORE_COMPONENT_TEST_ID)).toBeGreaterThan(0);
    const outcomeElement = container?.querySelector(
      `[data-testid="${END_SCREEN_OUTCOME_TEST_ID}"]`,
    );
    expect(outcomeElement?.getAttribute("data-outcome")).toBe(outcomeOf(store));
  });
});
