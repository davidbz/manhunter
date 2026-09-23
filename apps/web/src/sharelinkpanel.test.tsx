import type { GameSetup } from "@manhunter/core";
import { BALANCE, decodeReplay, makeReplay } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ClipboardProvider } from "./clipboardcontext";
import { createGameStore, type GameStore } from "./gamestore";
import {
  SHARE_LINK_LOAD_ERROR_TEST_ID,
  SHARE_LINK_TEST_ID,
  SHARE_LINK_URL_TEST_ID,
} from "./sharelink";
import { SHARE_LINK_COPY_TEST_ID } from "./sharelinkcopy";
import { ShareLinkErrorPanel, ShareLinkPanel } from "./sharelinkpanel";
import { replayParamOf } from "./sharelinkurl";
import { GameStoreProvider } from "./storecontext";
import { TEST_CLIPBOARD, TEST_GAME_DEPS } from "./wiring.testfixture";

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
          <ShareLinkPanel />
          <ShareLinkErrorPanel />
        </ClipboardProvider>
      </GameStoreProvider>,
    );
  });
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ShareLinkPanel", () => {
  it("draws nothing before a hunt exists", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(find(SHARE_LINK_TEST_ID)).toBeNull();
  });

  it("draws a link built from the hunt the store is holding", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    const url = find(SHARE_LINK_URL_TEST_ID);
    expect(url).not.toBeNull();
    const href = url?.getAttribute("href");
    if (href === undefined || href === null) {
      throw new Error("expected the share link to carry an href");
    }

    const value = replayParamOf(new URL(href).search);
    if (value === null) {
      throw new Error("expected the share link to carry a replay parameter");
    }

    const { hunt } = store.getState();
    if (!hunt) throw new Error("expected a hunt to be running");

    const expected = makeReplay({
      seed: hunt.seed,
      setup: hunt.setup,
      actions: hunt.recordedActions,
    });
    expect(decodeReplay(value)).toEqual({ kind: "replay", replay: expected });
  });

  it("draws the copy button under the link (PLAN M6.9)", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().start({ setup: SETUP, seed: SEED }));

    expect(find(SHARE_LINK_COPY_TEST_ID)).not.toBeNull();
  });
});

describe("ShareLinkErrorPanel", () => {
  it("draws nothing while there is no share-link problem", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(find(SHARE_LINK_LOAD_ERROR_TEST_ID)).toBeNull();
  });

  it("draws the refusal when the URL's replay could not be loaded", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => store.getState().loadShared("not a replay"));

    const error = find(SHARE_LINK_LOAD_ERROR_TEST_ID);
    expect(error).not.toBeNull();
    expect(error?.querySelector('[role="alert"]')?.getAttribute("data-refusal")).toBe("malformed");
  });
});
