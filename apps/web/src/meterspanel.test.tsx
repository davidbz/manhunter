import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import { METER_KINDS, METER_TEST_ID, METERS_TEST_ID } from "./meters";
import { MetersPanel } from "./meterspanel";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of the meters (PLAN M5.4). It is the only place the bounds are read off the
 * store, which is what keeps `Meters` free of any number of its own.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 7;

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
        <MetersPanel />
      </GameStoreProvider>,
    );
  });
};

const count = (testId: string): number =>
  container?.querySelectorAll(`[data-testid="${testId}"]`).length ?? 0;

const meterValue = (kind: string): string | null =>
  container
    ?.querySelector(`[data-testid="${METER_TEST_ID}"][data-meter="${kind}"]`)
    ?.getAttribute("data-value") ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the connected meters", () => {
  it("draws no meters before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(count(METERS_TEST_ID)).toBe(0);
  });

  it("draws the hunt's own resources once one has started", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(count(METER_TEST_ID)).toBe(METER_KINDS.length);
    expect(meterValue("budget")).toBe(String(BALANCE.hunter.startingBudget));
    expect(meterValue("trust")).toBe(String(BALANCE.hunter.startingTrust));
  });

  it("follows the meters down as the hunt spends them", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    const before = meterValue("clock");
    await act(async () => store.getState().endTurn([{ kind: "true_briefing" }]));

    expect(meterValue("clock")).not.toBe(before);
    expect(Number(meterValue("pressure"))).toBeGreaterThan(BALANCE.hunter.startingPressure);
  });
});
