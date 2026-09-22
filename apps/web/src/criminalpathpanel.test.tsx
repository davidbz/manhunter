import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CRIMINAL_PATH_MARKER_TEST_ID } from "./criminalpath";
import { CriminalPathPanel } from "./criminalpathpanel";
import { createGameStore, type GameStore } from "./gamestore";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of PLAN M5.6b's criminal path, against a city the generator actually
 * produced. This is the AC itself, end to end: once a hunt is finished, scrubbing to a turn
 * shows the criminal's position for it, read off `hunt.frames` the way `EndScreenPanel` reads
 * `hunt.score` (PLAN M5.6a's note).
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

const render = async (store: GameStore, turn: number): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <GameStoreProvider store={store}>
        <svg aria-label="Test map">
          <CriminalPathPanel turn={turn} />
        </svg>
      </GameStoreProvider>,
    );
  });
};

const markerNodeId = (): string | null =>
  container
    ?.querySelector(`[data-testid="${CRIMINAL_PATH_MARKER_TEST_ID}"]`)
    ?.getAttribute("data-nodeid") ?? null;

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

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the connected criminal path", () => {
  it("draws nothing before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE), 0);

    expect(markerNodeId()).toBeNull();
  });

  it("draws nothing while the hunt is still in progress, having no frames yet", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store, 0);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(store.getState().hunt?.frames).toBeNull();
    expect(markerNodeId()).toBeNull();
  });

  it("shows the criminal's starting position at turn 0", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await store.getState().start({ setup: SETUP, seed: SEED });
    await playOut(store);
    const first = store.getState().hunt?.frames?.[0];
    if (first === undefined) throw new Error("expected the settled hunt to carry frames");

    await render(store, first.turn);

    expect(markerNodeId()).toBe(String(first.criminalNodeId));
  });

  it("moves to the criminal's final position once scrubbed to the last turn", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await store.getState().start({ setup: SETUP, seed: SEED });
    await playOut(store);
    const last = store.getState().hunt?.frames?.at(-1);
    if (last === undefined) throw new Error("expected the settled hunt to carry frames");

    await render(store, last.turn);

    expect(markerNodeId()).toBe(String(last.criminalNodeId));
  });
});
