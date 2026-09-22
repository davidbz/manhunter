import { BALANCE } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameStore, type GameStore } from "./gamestore";
import { LIMITS } from "./limits";
import {
  NEW_HUNT_DIFFICULTY_TEST_ID,
  NEW_HUNT_SEED_ERROR_TEST_ID,
  NEW_HUNT_SEED_TEST_ID,
  NEW_HUNT_START_TEST_ID,
  NEW_HUNT_TEST_ID,
  NewHuntForm,
  parseSeed,
} from "./newhuntform";
import { GameStoreProvider } from "./storecontext";
import { TEST_GAME_DEPS } from "./wiring.testfixture";

/**
 * The pre-start screen of PLAN M5.5a, and the bound on the one number the player types.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const AT_LIMIT = "9".repeat(LIMITS.maxSeedInputLength);
const OVER_LIMIT = "9".repeat(LIMITS.maxSeedInputLength + 1);

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
        <NewHuntForm />
      </GameStoreProvider>,
    );
  });
};

const find = (testId: string): HTMLElement | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const type = async (text: string): Promise<void> => {
  const field = find(NEW_HUNT_SEED_TEST_ID) as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as (
    this: HTMLInputElement,
    value: string,
  ) => void;
  await act(async () => {
    setValue.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("reading a seed the player typed", () => {
  it("takes a whole number", () => {
    expect(parseSeed("1")).toEqual({ kind: "seed", seed: 1 });
    expect(parseSeed("0")).toEqual({ kind: "seed", seed: 0 });
  });

  it("takes a seed of exactly the maximum length", () => {
    expect(parseSeed(AT_LIMIT).kind).toBe("seed");
  });

  it("refuses a seed one character over the limit rather than truncating it", () => {
    expect(parseSeed(OVER_LIMIT)).toEqual({
      kind: "too_long",
      length: OVER_LIMIT.length,
      maxLength: LIMITS.maxSeedInputLength,
    });
  });

  it("refuses anything that is not a whole number", () => {
    for (const text of ["", " ", "-1", "1.5", "one", "1e3"]) {
      expect(parseSeed(text).kind).toBe("not_a_seed");
    }
  });
});

describe("the new hunt form", () => {
  it("offers a seed, a difficulty and nothing else the seed already decides", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    expect(find(NEW_HUNT_TEST_ID)).not.toBeNull();
    expect(find(NEW_HUNT_SEED_TEST_ID)).not.toBeNull();
    expect(find(NEW_HUNT_DIFFICULTY_TEST_ID)).not.toBeNull();
    expect(container?.querySelectorAll("input")).toHaveLength(1);
    expect(container?.querySelectorAll("select")).toHaveLength(1);
  });

  it("starts a hunt on the seed and difficulty it was given", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await act(async () => {
      find(NEW_HUNT_START_TEST_ID)?.click();
    });

    expect(store.getState().hunt).not.toBeNull();
    expect(store.getState().hunt?.setup.difficulty).toBe("standard");
    expect(store.getState().refusal).toBeNull();
  });

  it("starts a hunt from a form submit, not only a click - the Enter-key path (PLAN M5.7)", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    const form = find(NEW_HUNT_TEST_ID) as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(store.getState().hunt).not.toBeNull();
  });

  it("does not start a hunt on submit while the seed is refused", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await type(OVER_LIMIT);
    const form = find(NEW_HUNT_TEST_ID) as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(store.getState().hunt).toBeNull();
  });

  it("says why an over-long seed was refused, and will not start on it", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await type(OVER_LIMIT);

    expect(find(NEW_HUNT_SEED_ERROR_TEST_ID)?.getAttribute("data-refusal")).toBe("too_long");
    expect((find(NEW_HUNT_START_TEST_ID) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      find(NEW_HUNT_START_TEST_ID)?.click();
    });

    expect(store.getState().hunt).toBeNull();
  });

  it("lets the browser hold the whole over-long entry, so the refusal is reachable", async () => {
    await render(createGameStore(TEST_GAME_DEPS, BALANCE));

    await type(OVER_LIMIT);

    expect((find(NEW_HUNT_SEED_TEST_ID) as HTMLInputElement).value).toBe(OVER_LIMIT);
    expect(find(NEW_HUNT_SEED_TEST_ID)?.getAttribute("maxlength")).toBeNull();
  });

  it("clears the refusal once the seed is a number again", async () => {
    const store = createGameStore(TEST_GAME_DEPS, BALANCE);
    await render(store);

    await type("nine");
    expect(find(NEW_HUNT_SEED_ERROR_TEST_ID)?.getAttribute("data-refusal")).toBe("not_a_seed");

    await type("9");

    expect(find(NEW_HUNT_SEED_ERROR_TEST_ID)).toBeNull();
    expect((find(NEW_HUNT_START_TEST_ID) as HTMLButtonElement).disabled).toBe(false);
  });
});
