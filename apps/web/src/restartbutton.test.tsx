import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import { RESTART_TEST_ID, RestartButton, type RestartScreen } from "./restartbutton";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/** PLAN M6.9: the button is one `restart` dispatch, and tells the screen it happened. */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (
  store: GameStore,
  screen: RestartScreen,
  onRestarted?: () => void,
): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  const button =
    onRestarted === undefined ? (
      <RestartButton screen={screen} label="Start over" />
    ) : (
      <RestartButton screen={screen} label="Start over" onRestarted={onRestarted} />
    );
  await act(async () => {
    mounted.render(<GameStoreProvider store={store}>{button}</GameStoreProvider>);
  });
};

const button = (): HTMLButtonElement => {
  const found = container?.querySelector(`[data-testid="${RESTART_TEST_ID}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error("expected the restart button");
  return found;
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("RestartButton", () => {
  it("says which screen it sits on", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE), "debrief");

    expect(button().getAttribute("data-screen")).toBe("debrief");
    expect(button().type).toBe("button");
    expect(button().textContent).toBe("Start over");
  });

  it("drops the hunt the store holds", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    store.getState().start({ setup: SETUP, seed: 1 });
    await render(store, "debrief");

    await act(async () => button().click());

    expect(store.getState().hunt).toBeNull();
  });

  it("tells the screen that drew it, after the store has restarted", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    store.getState().loadShared("not a replay");
    const seen: (string | null)[] = [];
    await render(store, "briefing", () => {
      seen.push(store.getState().shareLinkRefusal?.kind ?? null);
    });

    await act(async () => button().click());

    expect(seen).toEqual([null]);
  });
});
