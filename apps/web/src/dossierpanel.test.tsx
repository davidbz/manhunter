import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_TEST_ID } from "./avatarportrait";
import { CRIMINAL_DOSSIER_TEST_ID } from "./dossier";
import { CriminalDossierPanel } from "./dossierpanel";
import { createGameStore, type GameStore } from "./gamestore";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected dossier (PLAN M6.7), against the shipped engine: two real hunts on different
 * seeds render the same dossier while they run, and the portrait only arrives once the store has
 * built `RevealFrame`s for a settled hunt.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const FIRST_SEED = 1;
const SECOND_SEED = 2;

/** Every MVP hunt is over well inside the deadline (PLAN M3.8c), so this only bounds the loop. */
const PLAY_OUT_LIMIT = 24;

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (store: GameStore): Promise<HTMLElement> => {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  container = host;
  root = mounted;
  await act(async () => {
    mounted.render(
      <GameStoreProvider store={store}>
        <CriminalDossierPanel />
      </GameStoreProvider>,
    );
  });

  return host;
};

const unmount = async (): Promise<void> => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
};

afterEach(unmount);

const startedStore = async (seed: number): Promise<GameStore> => {
  const store = createGameStore(TEST_GAME_DEPS, BALANCE);
  await act(async () => store.getState().start({ setup: SETUP, seed }));

  return store;
};

const isRunning = (store: GameStore): boolean =>
  store.getState().hunt?.view.outcome.kind === "in_progress";

const playOut = async (store: GameStore): Promise<void> => {
  for (let played = 0; played < PLAY_OUT_LIMIT; played += 1) {
    if (!isRunning(store)) return;
    await act(async () => store.getState().endTurn([]));
  }
  throw new Error("the hunt did not end inside its deadline");
};

const subjectOf = (host: HTMLElement): string | null | undefined =>
  host.querySelector(`[data-testid="${CRIMINAL_DOSSIER_TEST_ID}"]`)?.getAttribute("data-subject");

describe("the connected dossier", () => {
  it("draws nothing before a hunt has started", async () => {
    const host = await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(host.innerHTML).toBe("");
  });

  it("is identical for two running hunts on different seeds", async () => {
    const firstStore = await startedStore(FIRST_SEED);
    const secondStore = await startedStore(SECOND_SEED);
    expect(firstStore.getState().hunt?.view.map).not.toEqual(secondStore.getState().hunt?.view.map);

    const first = (await render(firstStore)).innerHTML;
    await unmount();
    const second = (await render(secondStore)).innerHTML;

    expect(subjectOf(container ?? document.body)).toBe("redacted");
    expect(second).toBe(first);
  });

  it("stays redacted after a turn that leaves the hunt running", async () => {
    const store = await startedStore(FIRST_SEED);
    const before = (await render(store)).innerHTML;
    await act(async () => store.getState().endTurn([]));
    if (!isRunning(store)) throw new Error("expected the first turn to leave the hunt running");

    expect(container?.innerHTML).toBe(before);
  });

  it("reveals the seeded portrait once the hunt has settled", async () => {
    const store = await startedStore(FIRST_SEED);
    const host = await render(store);
    await playOut(store);

    expect(store.getState().hunt?.frames).not.toBeNull();
    expect(subjectOf(host)).toBe("revealed");
    expect(
      host.querySelector(`[data-testid="${AVATAR_TEST_ID}"]`)?.getAttribute("data-subject"),
    ).toBe("criminal");
  });
});
