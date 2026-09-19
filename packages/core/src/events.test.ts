import { describe, expect, it } from "vitest";
import type { GameEvent, GameEventKind } from "./events";
import { EVENT_VISIBILITY, isHiddenEventKind } from "./events";
import { makeNodeId, makeReportId } from "./ids";

const TURN = 5;

const samples: readonly GameEvent[] = [
  { kind: "eyewitness", turn: TURN, reportId: makeReportId("report-1") },
  { kind: "prank_call", turn: TURN, reportId: makeReportId("report-2") },
  { kind: "civilian_hurt", turn: TURN, nodeId: makeNodeId("residential") },
  { kind: "nightfall", turn: TURN },
  { kind: "rush_hour", turn: TURN },
];

/**
 * Stands in for the event handlers of PLAN M3.7. Adding a variant without a case here fails the
 * typecheck, which is the guarantee the data-driven event table depends on.
 */
const kindOf = (event: GameEvent): GameEventKind => {
  switch (event.kind) {
    case "eyewitness":
      return "eyewitness";
    case "prank_call":
      return "prank_call";
    case "civilian_hurt":
      return "civilian_hurt";
    case "nightfall":
      return "nightfall";
    case "rush_hour":
      return "rush_hour";
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
};

describe("GameEvent", () => {
  it("has one sample per kind, each switchable exhaustively", () => {
    expect(samples.map(kindOf)).toEqual(samples.map((event) => event.kind));
  });

  it("stamps every event with the turn it fired on", () => {
    for (const event of samples) expect(event.turn).toBe(TURN);
  });

  it("round-trips through JSON (architecture rule 3)", () => {
    expect(JSON.parse(JSON.stringify(samples))).toEqual(samples);
  });
});

describe("EVENT_VISIBILITY", () => {
  // Every row pinned by hand. `view.ts` derives both the redaction and the `HunterEvent` type
  // from this table, so nothing else in the repo would notice a row changing sides.
  it("declares a side for every variant, and hides the two that name a report", () => {
    expect(EVENT_VISIBILITY).toEqual({
      eyewitness: "hidden",
      prank_call: "hidden",
      civilian_hurt: "hunter_visible",
      nightfall: "hunter_visible",
      rush_hour: "hunter_visible",
    });
  });

  it("has a row for every variant and no row for anything else", () => {
    expect(Object.keys(EVENT_VISIBILITY).sort()).toEqual(samples.map((event) => event.kind).sort());
  });

  it("hides only variants that carry a report id, which is all the hunter may keep", () => {
    for (const hidden of samples.filter((event) => isHiddenEventKind(event.kind))) {
      expect(hidden).toHaveProperty("reportId");
    }
  });
});
