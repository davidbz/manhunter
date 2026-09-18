import { describe, expect, it } from "vitest";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId, makeReportId } from "./ids";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import { HIDDEN_REPORT_FIELDS, makeReport } from "./report";
import { makeClock } from "./time";
import type { HunterReport, HunterView, RevealFrame } from "./view";
import { IN_PROGRESS } from "./world";

// Architecture rule 4, checked where it is cheapest to check: in the type layer. A `HunterView`
// that grows a `criminal` or `config` member, or a `HunterReport` that keeps a hidden field,
// fails `bun run typecheck` before any test runs.
type AssertTrue<T extends true> = T;
type KeyAbsent<T, Key extends string> = Key extends keyof T ? false : true;

export type ViewHidesTheCriminal = AssertTrue<KeyAbsent<HunterView, "criminal">>;
export type ViewHidesTheConfig = AssertTrue<KeyAbsent<HunterView, "config">>;
export type ViewHidesTheRng = AssertTrue<KeyAbsent<HunterView, "rng">>;
// Named literally, not as `HiddenReportField`: deriving them from the constant would only
// restate it, and DESIGN.md "Reports" is what says these two fields are the hidden ones.
export type HunterReportHidesTruth = AssertTrue<KeyAbsent<HunterReport, "truth">>;
export type HunterReportHidesAccuracy = AssertTrue<KeyAbsent<HunterReport, "accuracy">>;

const START_HOUR = 21;
const TURN = 3;
const TURNS_REMAINING = 21;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;
const ACCURACY = 0.5;

const downtown = makeNodeId("downtown");
const airport = makeNodeId("airport");

const map: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(airport, "exit", { x: 1, y: 0 }),
  ],
  edges: [makeEdge("road", makeEdgeId("e1"), downtown, airport)],
  exits: [makeExit(airport, "airport")],
  river: null,
  incidentNodeId: downtown,
};

const report = makeReport({
  id: makeReportId("report-1"),
  source: "witness",
  observedAtTurn: 1,
  deliveryDelayTurns: 1,
  content: { kind: "sighting", nodeId: downtown, travelMode: "foot" },
  truth: "true",
  accuracy: ACCURACY,
});

const { truth: _truth, accuracy: _accuracy, ...hunterReport } = report;

const view: HunterView = {
  clock: makeClock(START_HOUR, TURN),
  map,
  hunter: makeHunterState({
    actionPoints: START_ACTION_POINTS,
    budget: START_BUDGET,
    trust: START_TRUST,
    pressure: START_PRESSURE,
  }),
  reports: [hunterReport],
  events: [{ kind: "nightfall", turn: TURN }],
  casualties: 0,
  turnsRemaining: TURNS_REMAINING,
  outcome: IN_PROGRESS,
};

describe("HunterView", () => {
  it("carries no member that could hold the criminal or its profile", () => {
    for (const forbidden of ["criminal", "config", "rng"]) {
      expect(Object.keys(view)).not.toContain(forbidden);
    }
  });

  it("carries reports with their hidden fields stripped", () => {
    for (const field of HIDDEN_REPORT_FIELDS) {
      for (const hunterVisible of view.reports) {
        expect(hunterVisible).not.toHaveProperty(field);
      }
    }
  });

  it("keeps the map, including where the hunt began, which both sides know", () => {
    expect(view.map.incidentNodeId).toBe(downtown);
  });

  it("round-trips through JSON, because the UI receives it across a boundary", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});

describe("RevealFrame", () => {
  it("adds the criminal's true position to a hunter view, and nothing else", () => {
    const frame: RevealFrame = { turn: TURN, view, criminalNodeId: airport };
    expect(Object.keys(frame).sort()).toEqual(["criminalNodeId", "turn", "view"]);
  });
});
