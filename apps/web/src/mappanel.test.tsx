import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import { MapPanel } from "./mappanel";
import { MAP_NODE_TEST_ID, MAP_TEST_ID } from "./maprenderer";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of PLAN M5.3a: the panel reads the view off the store wired at the
 * composition root, and renders the `hunt === null` case every component has to render.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 1;

const nothingSelected = () => {
  /* the panel under test only has to render */
};

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
        <MapPanel selection={null} onSelect={nothingSelected} />
      </GameStoreProvider>,
    );
  });
};

const count = (testId: string): number =>
  container?.querySelectorAll(`[data-testid="${testId}"]`).length ?? 0;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the connected map panel", () => {
  it("draws no map before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(count(MAP_TEST_ID)).toBe(0);
  });

  it("draws the hunt's own city once one has started", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(count(MAP_TEST_ID)).toBe(1);
    expect(count(MAP_NODE_TEST_ID)).toBe(store.getState().hunt?.view.map.nodes.length);
  });
});
