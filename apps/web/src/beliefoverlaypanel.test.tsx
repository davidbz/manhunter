import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BELIEF_CONTOUR_TEST_ID, BELIEF_HEAT_TEST_ID } from "./beliefoverlay";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { createGameStore, type GameStore } from "./gamestore";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of PLAN M5.3b, against a city the generator actually produced: the panel
 * reads the belief off the store wired at the composition root, and renders the `hunt === null`
 * case every component has to render.
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
        <svg aria-label="Test map">
          <BeliefOverlayPanel />
        </svg>
      </GameStoreProvider>,
    );
  });
};

const heat = (): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${BELIEF_HEAT_TEST_ID}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the connected heatmap panel", () => {
  it("draws no heat before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(heat()).toHaveLength(0);
  });

  it("draws the hunt's own distribution once one has started", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    const suspected = (store.getState().hunt?.view.belief ?? []).filter((cell) => cell.mass > 0);

    expect(heat()).toHaveLength(suspected.length);
    expect(suspected.length).toBeGreaterThan(0);
  });

  it("outlines the hunt's top tier once one has started (PLAN M6.6)", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    const contour = container?.querySelector(`[data-testid="${BELIEF_CONTOUR_TEST_ID}"]`);
    expect(contour?.getAttribute("data-nodeids")?.length).toBeGreaterThan(0);
  });
});
