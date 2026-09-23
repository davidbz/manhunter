import { type HunterEvent, makeNodeId, makeReportId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { locatedIncidentsOf } from "./mapincidents";

const MARKET = makeNodeId("n-market");
const DOCKS = makeNodeId("n-docks");

describe("located incidents", () => {
  it("is empty for a hunt with no harm in it", () => {
    const events: readonly HunterEvent[] = [
      { kind: "nightfall", turn: 2 },
      { kind: "report_arrived", turn: 3, reportId: makeReportId("r-1") },
    ];

    expect(locatedIncidentsOf(events)).toEqual([]);
  });

  it("places each civilian_hurt on its node and skips events that name no place", () => {
    const events: readonly HunterEvent[] = [
      { kind: "rush_hour", turn: 1 },
      { kind: "civilian_hurt", turn: 4, nodeId: MARKET },
    ];

    expect(locatedIncidentsOf(events)).toEqual([{ nodeId: MARKET, count: 1, lastTurn: 4 }]);
  });

  it("merges repeated harm at one node, keeping the count and the latest turn", () => {
    const events: readonly HunterEvent[] = [
      { kind: "civilian_hurt", turn: 7, nodeId: DOCKS },
      { kind: "civilian_hurt", turn: 2, nodeId: MARKET },
      { kind: "civilian_hurt", turn: 5, nodeId: DOCKS },
    ];

    expect(locatedIncidentsOf(events)).toEqual([
      { nodeId: DOCKS, count: 2, lastTurn: 7 },
      { nodeId: MARKET, count: 1, lastTurn: 2 },
    ]);
  });
});
