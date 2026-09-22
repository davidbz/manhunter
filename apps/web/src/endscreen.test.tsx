import type { ScoreBreakdown, ScoreComponent, ScoreComponentKind } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  END_SCREEN_OUTCOME_TEST_ID,
  END_SCREEN_TEST_ID,
  EndScreen,
  SCORE_BASE_TEST_ID,
  SCORE_BREAKDOWN_TEST_ID,
  SCORE_COMPONENT_TEST_ID,
  SCORE_TOTAL_TEST_ID,
} from "./endscreen";

/**
 * PLAN M5.6a's own acceptance criterion: every score component the breakdown carries is
 * rendered, asserted here rather than only by `bun run typecheck` (`SCORE_COMPONENT_LABELS`'s
 * `Readonly<Record<ScoreComponentKind, string>>` already fails to compile if a component is
 * added without a label - this is the test-time half the AC also asks for).
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const CAPTURE_TURN = 6;
const BASE = 1200;
const TOTAL = 1052;

/**
 * Keyed by `ScoreComponentKind`, the same guard `score.test.ts`'s `EXPECTED_POINTS` puts on
 * `core` itself: a fifth component added to `SCORE_COMPONENTS` stops this file compiling until
 * it is given a measured value here, rather than rendering three components silently.
 */
const MEASURED: Readonly<Record<ScoreComponentKind, number>> = {
  turns_taken: 6,
  budget_spent: 120,
  casualties: 0,
  trust_remaining: 58,
};

const POINTS: Readonly<Record<ScoreComponentKind, number>> = {
  turns_taken: -90,
  budget_spent: -18,
  casualties: 0,
  trust_remaining: 116,
};

const EVERY_SCORE_COMPONENT_KIND = Object.keys(MEASURED) as readonly ScoreComponentKind[];

const componentsOf = (): readonly ScoreComponent[] =>
  EVERY_SCORE_COMPONENT_KIND.map((kind) => ({
    kind,
    measured: MEASURED[kind],
    points: POINTS[kind],
  }));

const CAPTURED: ScoreBreakdown = {
  outcome: { kind: "captured", turn: CAPTURE_TURN },
  base: BASE,
  components: componentsOf(),
  total: TOTAL,
};

const IN_PROGRESS_BREAKDOWN: ScoreBreakdown = {
  outcome: { kind: "in_progress" },
  base: 0,
  components: componentsOf(),
  total: 0,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (breakdown: ScoreBreakdown): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<EndScreen breakdown={breakdown} />);
  });
};

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the end screen", () => {
  it("renders nothing for a hunt that is still in progress", async () => {
    await render(IN_PROGRESS_BREAKDOWN);

    expect(one(END_SCREEN_TEST_ID)).toBeNull();
  });

  it("names the outcome and the turn it happened on", async () => {
    await render(CAPTURED);

    const outcome = one(END_SCREEN_OUTCOME_TEST_ID);
    expect(outcome?.getAttribute("data-outcome")).toBe("captured");
    expect(outcome?.getAttribute("data-turn")).toBe(String(CAPTURE_TURN));
  });

  it("draws every score component the breakdown carries, so adding one cannot silently go missing", async () => {
    await render(CAPTURED);

    expect(one(SCORE_BREAKDOWN_TEST_ID)).not.toBeNull();
    const kinds = all(SCORE_COMPONENT_TEST_ID).map((element) => element.getAttribute("data-kind"));
    expect(kinds).toEqual([...EVERY_SCORE_COMPONENT_KIND]);
    expect(kinds.length).toBe(EVERY_SCORE_COMPONENT_KIND.length);
  });

  it("carries the measured value and the points earned for each component", async () => {
    await render(CAPTURED);

    for (const kind of EVERY_SCORE_COMPONENT_KIND) {
      const element = all(SCORE_COMPONENT_TEST_ID).find(
        (candidate) => candidate.getAttribute("data-kind") === kind,
      );
      expect(element?.getAttribute("data-measured")).toBe(String(MEASURED[kind]));
      expect(element?.getAttribute("data-points")).toBe(String(POINTS[kind]));
    }
  });

  it("shows the base the outcome alone was worth, and the total the receipt adds up to", async () => {
    await render(CAPTURED);

    expect(one(SCORE_BASE_TEST_ID)?.getAttribute("data-points")).toBe(String(BASE));
    expect(one(SCORE_TOTAL_TEST_ID)?.getAttribute("data-points")).toBe(String(TOTAL));
  });
});
