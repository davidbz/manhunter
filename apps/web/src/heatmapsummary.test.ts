import {
  type Belief,
  type HunterReport,
  type MapNode,
  makeNodeId,
  makeReportId,
  UNKNOWN_TRAVEL_MODE,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { beliefHeatOf, DEFAULT_BELIEF_FIELD, DEFAULT_HEAT_RAMP, topTierOf } from "./beliefoverlay";
import { type HeatmapSummaryRules, heatmapSummaryOf } from "./heatmapsummary";
import { LIMITS } from "./limits";
import { reportPinsOf } from "./reportpins";
import { FEED_ROW_THEME } from "./theme";

/**
 * PLAN M6.10's text equivalent for the heatmap, on the data: it lists what the map draws, in the
 * order a player would weigh it, and never more than its bound.
 */

const NOW = 10;

const RULES: HeatmapSummaryRules = {
  ramp: DEFAULT_HEAT_RAMP,
  contourFrom: DEFAULT_BELIEF_FIELD.contourFrom,
  pinWindow: { maxAge: 5, maxPins: LIMITS.maxReportPins },
  staleness: FEED_ROW_THEME,
  maxEntries: LIMITS.maxHeatmapSummaryEntries,
};

const DISTRICTS = ["downtown", "residential", "suburb", "industrial", "park"] as const;

const nodesOf = (count: number): readonly MapNode[] =>
  Array.from({ length: count }, (_, index) => ({
    id: makeNodeId(`n${index}`),
    districtType: DISTRICTS[index % DISTRICTS.length] ?? "downtown",
    position: { x: index, y: 0 },
  }));

const beliefOf = (masses: readonly number[]): Belief =>
  masses.map((mass, index) => ({ nodeId: makeNodeId(`n${index}`), mass }));

const sighting = (id: string, node: string, observedAtTurn: number): HunterReport => ({
  id: makeReportId(id),
  source: "witness",
  observedAtTurn,
  receivedAtTurn: observedAtTurn,
  content: { kind: "sighting", nodeId: makeNodeId(node), travelMode: UNKNOWN_TRAVEL_MODE },
});

const summaryOf = (
  masses: readonly number[],
  reports: readonly HunterReport[] = [],
  rules: HeatmapSummaryRules = RULES,
) =>
  heatmapSummaryOf(
    { belief: beliefOf(masses), nodes: nodesOf(masses.length), reports, currentTurn: NOW },
    rules,
  );

describe("the suspected districts", () => {
  it("lists the strongest first, as whole percentages, with each one's district", () => {
    const summary = summaryOf([0.1, 0.6, 0.3]);

    expect(summary.suspects.entries).toEqual([
      { nodeId: makeNodeId("n1"), district: "residential", percent: 60, topTier: true },
      { nodeId: makeNodeId("n2"), district: "suburb", percent: 30, topTier: expect.any(Boolean) },
      { nodeId: makeNodeId("n0"), district: "downtown", percent: 10, topTier: false },
    ]);
  });

  it("breaks a tie by the map's own node order, so the list is stable", () => {
    const order = summaryOf([0.25, 0.25, 0.25, 0.25]).suspects.entries.map((each) => each.nodeId);

    expect(order).toEqual(["n0", "n1", "n2", "n3"].map(makeNodeId));
  });

  it("marks top tier exactly the nodes the map's contour outlines", () => {
    const masses = [0.05, 0.4, 0.35, 0.1, 0.1];
    const heats = beliefHeatOf(beliefOf(masses), nodesOf(masses.length), RULES.ramp);
    const contour = topTierOf(heats, RULES.contourFrom);

    const marked = summaryOf(masses)
      .suspects.entries.filter((each) => each.topTier)
      .map((each) => each.nodeId);

    expect(new Set(marked)).toEqual(contour);
  });

  it("lists no district the map draws no heat for", () => {
    const summary = summaryOf([0, 1, 0]);

    expect(summary.suspects.entries.map((each) => each.nodeId)).toEqual([makeNodeId("n1")]);
    expect(summary.suspects.withheld).toBe(0);
  });

  it("lists nothing for an empty belief", () => {
    expect(summaryOf([]).suspects).toEqual({ entries: [], withheld: 0 });
  });
});

describe("the bound on each list (LIMITS.maxHeatmapSummaryEntries)", () => {
  const atLimit = LIMITS.maxHeatmapSummaryEntries;
  const evenly = (count: number): readonly number[] =>
    Array.from({ length: count }, () => 1 / count);

  it("lists every suspect at the limit and holds none back", () => {
    const summary = summaryOf(evenly(atLimit));

    expect(summary.suspects.entries).toHaveLength(atLimit);
    expect(summary.suspects.withheld).toBe(0);
  });

  it("stops one over the limit and says how many it held back", () => {
    const summary = summaryOf(evenly(atLimit + 1));

    expect(summary.suspects.entries).toHaveLength(atLimit);
    expect(summary.suspects.withheld).toBe(1);
  });

  it("stops the report list one over the limit too", () => {
    const count = atLimit + 1;
    const reports = Array.from({ length: count }, (_, index) =>
      sighting(`r${index}`, `n${index}`, NOW),
    );
    const summary = summaryOf(evenly(count), reports);

    expect(summary.reports.entries).toHaveLength(atLimit);
    expect(summary.reports.withheld).toBe(1);
  });

  it("counts the pins the map itself held back as withheld as well", () => {
    const count = atLimit + 2;
    const reports = Array.from({ length: count }, (_, index) =>
      sighting(`r${index}`, `n${index}`, NOW),
    );
    const summary = summaryOf(evenly(count), reports, {
      ...RULES,
      pinWindow: { ...RULES.pinWindow, maxPins: atLimit + 1 },
    });

    expect(summary.reports.entries).toHaveLength(atLimit);
    expect(summary.reports.withheld).toBe(2);
  });
});

describe("the pinned reports", () => {
  it("lists exactly the map's pins, freshest first, with each pin's district", () => {
    const reports = [sighting("old", "n0", NOW - 2), sighting("new", "n2", NOW)];
    const pins = reportPinsOf(reports, NOW, RULES.pinWindow, RULES.staleness).pins;

    const listed = summaryOf([0.5, 0.25, 0.25], reports).reports.entries;

    expect(listed.map((each) => each.nodeId)).toEqual(pins.map((pin) => pin.nodeId));
    expect(listed.map((each) => each.district)).toEqual(["suburb", "downtown"]);
  });

  it("names no district for a report at a node the map does not have", () => {
    const listed = summaryOf([1], [sighting("stray", "elsewhere", NOW)]).reports.entries;

    expect(listed[0]?.district).toBeNull();
  });
});
