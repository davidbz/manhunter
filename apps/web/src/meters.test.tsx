import type { HunterView } from "@manhunter/core";
import {
  BALANCE,
  IN_PROGRESS,
  makeClock,
  makeHunterState,
  makeNodeId,
  uniformBelief,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  METER_KINDS,
  METER_LABELS,
  METER_TEST_ID,
  METER_VALUE_TEST_ID,
  METERS_TEST_ID,
  type MeterBounds,
  Meters,
  metersOf,
} from "./meters";

/**
 * The meters under jsdom, per the plan's "How much of M5 is Playwright's". Bounds come from
 * `BALANCE` rather than from literals here for the same reason they are a prop in the component:
 * the maximums are balance data, and a test that hardcoded 100 would pass a balance change that
 * broke the bar.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const NODE = makeNodeId("n-downtown");

const BOUNDS: MeterBounds = BALANCE.hunter;

const START_HOUR = 22;
const NOW = 4;
const TURNS_REMAINING = 20;

const ACTION_POINTS = 2;
const BUDGET = 640;
const TRUST = 55;
const PRESSURE = 22;

const viewWith = (
  parts: { readonly turn?: number; readonly turnsRemaining?: number } = {},
): HunterView => ({
  clock: makeClock(START_HOUR, parts.turn ?? NOW),
  map: { nodes: [], edges: [], exits: [], river: null, incidentNodeId: NODE },
  hunter: makeHunterState({
    actionPoints: ACTION_POINTS,
    budget: BUDGET,
    trust: TRUST,
    pressure: PRESSURE,
  }),
  reports: [],
  events: [],
  belief: uniformBelief([NODE]),
  casualties: 0,
  turnsRemaining: parts.turnsRemaining ?? TURNS_REMAINING,
  outcome: IN_PROGRESS,
});

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (children: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(children);
  });
};

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const meterOf = (kind: string): Element | null =>
  container?.querySelector(`[data-testid="${METER_TEST_ID}"][data-meter="${kind}"]`) ?? null;

const readingOf = (kind: string): string =>
  meterOf(kind)?.querySelector(`[data-testid="${METER_VALUE_TEST_ID}"]`)?.textContent ?? "";

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the meters", () => {
  it("draws every meter kind, so adding one cannot silently go missing", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    expect(one(METERS_TEST_ID)).not.toBeNull();
    expect(all(METER_TEST_ID).map((element) => element.getAttribute("data-meter"))).toEqual([
      ...METER_KINDS,
    ]);
  });

  it("draws no fatigue meter, which the MVP does not have", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    expect(meterOf("fatigue")).toBeNull();
  });

  it("reads the hunter's resources straight off the view", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    expect(meterOf("action_points")?.getAttribute("data-value")).toBe(String(ACTION_POINTS));
    expect(meterOf("budget")?.getAttribute("data-value")).toBe(String(BUDGET));
    expect(meterOf("trust")?.getAttribute("data-value")).toBe(String(TRUST));
    expect(meterOf("pressure")?.getAttribute("data-value")).toBe(String(PRESSURE));
  });

  it("scales trust and pressure by the bounds it was given, not by a number of its own", async () => {
    const halved: MeterBounds = { ...BOUNDS, trustMax: BALANCE.hunter.trustMax / 2 };

    await render(<Meters view={viewWith()} bounds={halved} />);

    expect(meterOf("trust")?.getAttribute("data-max")).toBe(String(halved.trustMax));
    expect(meterOf("trust")?.getAttribute("data-min")).toBe(String(BOUNDS.trustMin));
    expect(meterOf("pressure")?.getAttribute("data-max")).toBe(String(BOUNDS.pressureMax));
    expect(readingOf("trust")).toBe(`${TRUST} of ${halved.trustMax}`);
  });

  it("shows the hour of day and how much clock is left", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    expect(readingOf("clock")).toBe("02:00 - turn 4 of 24, 20 left");
    expect(meterOf("clock")?.getAttribute("data-max")).toBe(String(NOW + TURNS_REMAINING));
  });

  it("pads an hour before ten so the feed reads as a clock", async () => {
    await render(<Meters view={viewWith({ turn: 0 })} bounds={BOUNDS} />);

    expect(readingOf("clock")).toContain("22:00");
  });

  it("names every meter for a screen reader", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    const labels = Array.from(container?.querySelectorAll("meter") ?? []).map((element) =>
      element.getAttribute("aria-label"),
    );
    expect(labels).toEqual(METER_KINDS.map((kind) => METER_LABELS[kind]));
  });

  it("tints the native meter with the dispatch accent colour (PLAN M5.7)", async () => {
    await render(<Meters view={viewWith()} bounds={BOUNDS} />);

    const meter = container?.querySelector('[data-testid="meter"][data-meter="trust"] meter');
    expect((meter as HTMLElement | null)?.style.accentColor).toBe("rgb(95, 212, 255)");
  });

  it("survives a hunt whose clock has run out, where the range has no span", () => {
    const meters = metersOf(viewWith({ turn: 0, turnsRemaining: 0 }), BOUNDS);
    const clock = meters.find((meter) => meter.kind === "clock");

    expect(clock?.min).toBe(clock?.max);
    expect(clock?.display).toBe("22:00 - turn 0 of 0, 0 left");
  });
});
