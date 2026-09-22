import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPLAY_SCRUBBER_INPUT_TEST_ID,
  REPLAY_SCRUBBER_TEST_ID,
  REPLAY_SCRUBBER_TURN_TEST_ID,
  ReplayScrubber,
} from "./replayscrubber";

/**
 * The scrubber control, presentational and controlled (PLAN M5.6b), the `MapRenderer` shape:
 * given a turn it renders it, and it reports what the player dragged to rather than holding a
 * turn of its own.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const MAX_TURN = 4;

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (turn: number, onScrub: (turn: number) => void): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<ReplayScrubber turn={turn} maxTurn={MAX_TURN} onScrub={onScrub} />);
  });
};

/** A controlled harness, so dragging the input moves the turn the way a real screen would. */
const renderControlled = async (initial: number): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  const Controlled = () => {
    const [turn, setTurn] = useState(initial);
    return <ReplayScrubber turn={turn} maxTurn={MAX_TURN} onScrub={setTurn} />;
  };
  await act(async () => {
    mounted.render(<Controlled />);
  });
};

const input = (): HTMLInputElement | null =>
  container?.querySelector(`[data-testid="${REPLAY_SCRUBBER_INPUT_TEST_ID}"]`) ?? null;

const turnIndicator = (): string =>
  container?.querySelector(`[data-testid="${REPLAY_SCRUBBER_TURN_TEST_ID}"]`)?.textContent ?? "";

/**
 * Setting `.value` and dispatching `change` does not reach React's controlled input, which
 * listens through the native setter (`newhuntform.test.tsx`'s pattern for the same reason).
 */
const dragTo = async (range: HTMLInputElement, turn: number): Promise<void> => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as (
    this: HTMLInputElement,
    value: string,
  ) => void;
  await act(async () => {
    setValue.call(range, String(turn));
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the scrubber control", () => {
  it("renders the range input bounded by the replay's turns", async () => {
    await render(0, () => {});

    expect(input()?.min).toBe("0");
    expect(input()?.max).toBe(String(MAX_TURN));
    expect(input()?.value).toBe("0");
  });

  it("shows the turn it was handed", async () => {
    await render(2, () => {});

    expect(container?.querySelector(`[data-testid="${REPLAY_SCRUBBER_TEST_ID}"]`)).not.toBeNull();
    expect(turnIndicator()).toContain("2");
  });

  it("reports the turn dragged to, rather than moving on its own", async () => {
    const scrubbed: number[] = [];
    await render(0, (turn) => scrubbed.push(turn));

    const range = input();
    if (!range) throw new Error("expected the range input to be rendered");
    await dragTo(range, 3);

    expect(scrubbed).toEqual([3]);
  });

  it("moves the turn indicator when the owner moves the turn it was handed", async () => {
    await renderControlled(0);

    const range = input();
    if (!range) throw new Error("expected the range input to be rendered");
    await dragTo(range, 4);

    expect(turnIndicator()).toContain("4");
    expect(input()?.value).toBe("4");
  });
});
