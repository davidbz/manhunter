import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPLAY_SCRUBBER_INPUT_TEST_ID,
  REPLAY_SCRUBBER_TEST_ID,
  REPLAY_SCRUBBER_TURN_TEST_ID,
  REPLAY_TRANSPORT_TEST_ID,
  ReplayScrubber,
  TRANSPORT_STEPS,
  type TransportStep,
  transportTargetOf,
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

const transport = (step: TransportStep): HTMLButtonElement => {
  const button = container?.querySelector(
    `[data-testid="${REPLAY_TRANSPORT_TEST_ID}"][data-step="${step}"]`,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`expected a ${step} button`);
  return button;
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

/** PLAN M6.9: the transport row, one button per step, clamped to the replay's range. */
describe("the transport buttons", () => {
  it("names a clamped target turn for every step", () => {
    expect(transportTargetOf("first", 2, MAX_TURN)).toBe(0);
    expect(transportTargetOf("previous", 2, MAX_TURN)).toBe(1);
    expect(transportTargetOf("previous", 0, MAX_TURN)).toBe(0);
    expect(transportTargetOf("next", 2, MAX_TURN)).toBe(3);
    expect(transportTargetOf("next", MAX_TURN, MAX_TURN)).toBe(MAX_TURN);
    expect(transportTargetOf("last", 2, MAX_TURN)).toBe(MAX_TURN);
  });

  it("draws one labelled button per step", async () => {
    await render(2, () => {});

    for (const step of TRANSPORT_STEPS) {
      expect(transport(step).getAttribute("aria-label")).not.toBeNull();
      expect(transport(step).disabled).toBe(false);
    }
  });

  it("disables the steps that would not move off the first turn", async () => {
    await render(0, () => {});

    expect(transport("first").disabled).toBe(true);
    expect(transport("previous").disabled).toBe(true);
    expect(transport("next").disabled).toBe(false);
    expect(transport("last").disabled).toBe(false);
  });

  it("disables the steps that would not move off the last turn", async () => {
    await render(MAX_TURN, () => {});

    expect(transport("next").disabled).toBe(true);
    expect(transport("last").disabled).toBe(true);
  });

  it("reports the step's target turn when clicked", async () => {
    const scrubbed: number[] = [];
    await render(2, (turn) => scrubbed.push(turn));

    for (const step of TRANSPORT_STEPS) {
      await act(async () => transport(step).click());
    }

    expect(scrubbed).toEqual([0, 1, 3, MAX_TURN]);
  });

  it("moves the controlled turn one step at a time", async () => {
    await renderControlled(0);

    await act(async () => transport("next").click());
    await act(async () => transport("next").click());

    expect(turnIndicator()).toContain("2");
    expect(input()?.value).toBe("2");
  });
});
