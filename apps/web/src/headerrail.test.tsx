import type { HunterView } from "@manhunter/core";
import {
  BALANCE,
  IN_PROGRESS,
  makeClock,
  makeHunterState,
  makeNodeId,
  uniformBelief,
} from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  HEADER_RAIL_ITEM_TEST_ID,
  HEADER_RAIL_KINDS,
  HEADER_RAIL_TEST_ID,
  HeaderRail,
  type HeaderRailInput,
  headerRailOf,
} from "./headerrail";
import { METER_TEST_ID } from "./meters";

/**
 * The header rail (PLAN M6.2) under jsdom. The pressure maximum comes from `BALANCE`, for the
 * reason `meters.test.tsx` gives: the rail must not know that pressure runs to 100.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const NODE = makeNodeId("n-downtown");
const SEED = 4217;
const START_HOUR = 22;
const NOW = 4;
const PRESSURE = 22;

const VIEW: HunterView = {
  clock: makeClock(START_HOUR, NOW),
  map: { nodes: [], edges: [], exits: [], river: null, incidentNodeId: NODE },
  hunter: makeHunterState({ actionPoints: 2, budget: 640, trust: 55, pressure: PRESSURE }),
  reports: [],
  events: [],
  belief: uniformBelief([NODE]),
  casualties: 0,
  turnsRemaining: 20,
  outcome: IN_PROGRESS,
};

const INPUT: HeaderRailInput = {
  seed: SEED,
  difficulty: "hard",
  view: VIEW,
  pressureMax: BALANCE.hunter.pressureMax,
};

const displayOf = (kind: string): string | undefined =>
  headerRailOf(INPUT).find((item) => item.kind === kind)?.display;

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(<HeaderRail items={headerRailOf(INPUT)} />));
};

const all = (selector: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(selector) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("deriving the header rail", () => {
  it("names the case by the hunt's seed", () => {
    expect(displayOf("case")).toBe(`#${SEED}`);
  });

  it("reads the wall hour and the turn off the view's clock", () => {
    const clock = displayOf("clock") ?? "";

    expect(clock).toContain(`${String(VIEW.clock.hour).padStart(2, "0")}:00`);
    expect(clock).toContain(String(NOW));
  });

  it("shows the difficulty by the label the new-hunt form offered it under", () => {
    expect(displayOf("difficulty")).toBe("Hard");
  });

  it("scales pressure by the maximum it is handed", () => {
    expect(displayOf("pressure")).toBe(`${PRESSURE} of ${BALANCE.hunter.pressureMax}`);
  });
});

describe("the header rail", () => {
  it("draws every rail kind, so adding one cannot silently go missing", async () => {
    await render();

    expect(all(`[data-testid="${HEADER_RAIL_TEST_ID}"]`)).toHaveLength(1);
    expect(
      all(`[data-testid="${HEADER_RAIL_ITEM_TEST_ID}"]`).map((item) =>
        item.getAttribute("data-rail"),
      ),
    ).toEqual([...HEADER_RAIL_KINDS]);
  });

  it("carries no meter test id, so turn.spec.ts's clock locator stays unambiguous", async () => {
    await render();

    expect(all(`[data-testid="${METER_TEST_ID}"]`)).toHaveLength(0);
  });
});
