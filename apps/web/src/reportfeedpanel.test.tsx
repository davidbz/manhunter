import type { GameSetup } from "@manhunter/core";
import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import {
  REPORT_ENTRY_TEST_ID,
  REPORT_FEED_EMPTY_TEST_ID,
  REPORT_FEED_TEST_ID,
  REPORT_RELIABILITY_TEST_ID,
} from "./reportfeed";
import { ReportFeedPanel } from "./reportfeedpanel";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The connected half of the feed (PLAN M5.4): it reads the view off the store wired at the
 * composition root, and renders the `hunt === null` case every component has to render.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};

const SEED = 7;
const TURNS_PLAYED = 4;

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
        <ReportFeedPanel />
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

describe("the connected report feed", () => {
  it("draws no feed before a hunt has started", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(count(REPORT_FEED_TEST_ID)).toBe(0);
  });

  it("draws an empty feed on the first turn, before anything has been heard", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(count(REPORT_FEED_TEST_ID)).toBe(1);
    expect(count(REPORT_FEED_EMPTY_TEST_ID)).toBe(1);
  });

  it("draws one line per report the hunt has delivered", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    for (let played = 0; played < TURNS_PLAYED; played += 1) {
      await act(async () => store.getState().endTurn([{ kind: "true_briefing" }]));
    }

    const delivered = store.getState().hunt?.view.reports.length ?? 0;
    expect(delivered).toBeGreaterThan(0);
    expect(count(REPORT_ENTRY_TEST_ID)).toBe(delivered);
  });
});

describe("the connected report feed's reliability badges (PLAN M6.8)", () => {
  it("weighs sources by the store's balance, not a default of its own", async () => {
    const weight = 0.33;
    const balance = {
      ...BALANCE,
      belief: {
        ...BALANCE.belief,
        sourceWeight: { cctv: weight, patrol: weight, witness: weight, tip: weight },
      },
    };
    const store = createGameStore(TEST_GAME_DEPS, balance);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));
    for (let played = 0; played < TURNS_PLAYED; played += 1) {
      await act(async () => store.getState().endTurn([{ kind: "true_briefing" }]));
    }

    const badges = Array.from(
      container?.querySelectorAll(`[data-testid="${REPORT_RELIABILITY_TEST_ID}"]`) ?? [],
    );
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((badge) => badge.getAttribute("data-weight") === String(weight))).toBe(
      true,
    );
  });
});
