import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import type { GameEvent } from "./events";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId, makeReportId } from "./ids";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import type { Report } from "./report";
import { HIDDEN_REPORT_FIELDS, makeReport } from "./report";
import { createRng } from "./rng";
import { seal } from "./sealed";
import { makeClock } from "./time";
import type { HunterReport, HunterView, RevealFrame } from "./view";
import { toHunterView } from "./view";
import type { WorldState } from "./world";
import { IN_PROGRESS, makeWorldState } from "./world";

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

const rng = createRng();

const SEED = 1;
const START_HOUR = 21;
const MAX_TURNS = 24;
const TURN = 3;
const TURNS_REMAINING = 21;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;
const ACCURACY = 0.5;
const MAX_REPORTS = 8;
const MAX_EVENTS = 8;
const MAX_DELIVERY_DELAY = 3;

const downtown = makeNodeId("downtown");
const riverside = makeNodeId("riverside");
const airport = makeNodeId("airport");

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const map: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(riverside, "park", { x: 1, y: 0 }),
    makeNode(airport, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", makeEdgeId("e1"), downtown, riverside),
    makeEdge("bridge", makeEdgeId("e2"), riverside, airport),
  ],
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

/**
 * The criminal stands somewhere the hunter has no report about, so nothing in a projected view
 * can be traced back to it by coincidence.
 */
const sampleWorld = (): WorldState =>
  makeWorldState({
    config,
    rng: rng.seed(SEED),
    clock: makeClock(START_HOUR, TURN),
    map,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: START_BUDGET,
      trust: START_TRUST,
      pressure: START_PRESSURE,
    }),
    criminal: makeCriminalState({
      nodeId: riverside,
      travelMode: "foot",
      profile: "amateur",
      stamina: START_STAMINA,
      heat: 0,
      cash: START_CASH,
      desperation: 0,
    }),
  });

const arbitraryTurn = fc.integer({ min: 0, max: MAX_TURNS });

const arbitraryReport: fc.Arbitrary<Report> = fc
  .record({
    index: fc.nat(),
    observedAtTurn: arbitraryTurn,
    deliveryDelayTurns: fc.integer({ min: 0, max: MAX_DELIVERY_DELAY }),
    source: fc.constantFrom(...(["witness", "cctv", "tip", "patrol"] as const)),
    truth: fc.constantFrom(...(["true", "false", "prank", "planted"] as const)),
    accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
    seen: fc.boolean(),
  })
  .map(({ index, seen, source, truth, ...rest }) =>
    makeReport({
      ...rest,
      id: makeReportId(`report-${index}`),
      source,
      truth,
      content: seen
        ? { kind: "sighting", nodeId: riverside, travelMode: "foot" }
        : { kind: "no_sighting", nodeId: downtown },
    }),
  );

/** Covers every variant, the two hidden ones included: they are what the projection is for. */
const arbitraryEvent: fc.Arbitrary<GameEvent> = fc.oneof(
  fc
    .tuple(arbitraryTurn, fc.nat())
    .map(
      ([turn, index]) =>
        ({ kind: "eyewitness", turn, reportId: makeReportId(`report-${index}`) }) as const,
    ),
  fc
    .tuple(arbitraryTurn, fc.nat())
    .map(
      ([turn, index]) =>
        ({ kind: "prank_call", turn, reportId: makeReportId(`report-${index}`) }) as const,
    ),
  arbitraryTurn.map((turn) => ({ kind: "civilian_hurt", turn, nodeId: downtown }) as const),
  arbitraryTurn.map((turn) => ({ kind: "nightfall", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "rush_hour", turn }) as const),
);

const arbitraryWorld: fc.Arbitrary<WorldState> = fc
  .record({
    turn: arbitraryTurn,
    reports: fc.array(arbitraryReport, { maxLength: MAX_REPORTS }),
    events: fc.array(arbitraryEvent, { maxLength: MAX_EVENTS }),
  })
  .map((values) => ({
    ...sampleWorld(),
    clock: makeClock(START_HOUR, values.turn),
    reports: values.reports,
    events: values.events,
  }));

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

describe("toHunterView", () => {
  it("copies the parts of the world both sides know", () => {
    const world = sampleWorld();
    const projected = toHunterView(seal(world));

    expect(projected.clock).toEqual(world.clock);
    expect(projected.map).toEqual(world.map);
    expect(projected.hunter).toEqual(world.hunter);
    expect(projected.casualties).toBe(world.casualties);
    expect(projected.outcome).toEqual(world.outcome);
  });

  it("reports the deadline as turns remaining, never as the config it comes from", () => {
    const projected = toHunterView(seal(sampleWorld()));

    expect(projected.turnsRemaining).toBe(MAX_TURNS - TURN);
    expect(Object.keys(projected)).not.toContain("config");
  });

  it("floors turns remaining at zero rather than counting past the deadline", () => {
    const world = { ...sampleWorld(), clock: makeClock(START_HOUR, MAX_TURNS + 1) };

    expect(toHunterView(seal(world)).turnsRemaining).toBe(0);
  });

  it("collapses an eyewitness and a prank call into the same event", () => {
    const world = {
      ...sampleWorld(),
      events: [
        { kind: "eyewitness", turn: TURN, reportId: makeReportId("report-1") },
        { kind: "prank_call", turn: TURN, reportId: makeReportId("report-2") },
      ] as const satisfies readonly GameEvent[],
    };

    expect(toHunterView(seal(world)).events).toEqual([
      { kind: "report_arrived", turn: TURN, reportId: makeReportId("report-1") },
      { kind: "report_arrived", turn: TURN, reportId: makeReportId("report-2") },
    ]);
  });

  it("passes through an event whose information the hunter is meant to have", () => {
    const hurt = { kind: "civilian_hurt", turn: TURN, nodeId: downtown } as const;
    const world = { ...sampleWorld(), events: [hurt] };

    expect(toHunterView(seal(world)).events).toEqual([hurt]);
  });

  it("round-trips through JSON, because the UI receives it across a boundary", () => {
    const projected = toHunterView(seal(sampleWorld()));

    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });

  test.prop([arbitraryWorld])("strips every hidden field from every report", (world) => {
    for (const projected of toHunterView(seal(world)).reports) {
      for (const field of HIDDEN_REPORT_FIELDS) {
        expect(projected).not.toHaveProperty(field);
      }
    }
  });

  test.prop([arbitraryWorld])("shows no report that has not landed yet", (world) => {
    const projected = toHunterView(seal(world));
    const landed = world.reports.filter((report) => report.receivedAtTurn <= world.clock.turn);

    expect(projected.reports.map((report) => report.id)).toEqual(landed.map((report) => report.id));
    for (const report of projected.reports) {
      expect(report.receivedAtTurn).toBeLessThanOrEqual(projected.clock.turn);
    }
  });

  /**
   * The point of the event projection: the feed may say a report landed, never what kind it was.
   * Named literally rather than read off `HIDDEN_EVENT_KINDS`, for the same reason the hidden
   * report fields are - a test that asks the constant what to forbid goes vacuous the moment the
   * constant is the thing that is wrong, which is exactly the mutation this has to catch.
   */
  test.prop([arbitraryWorld])("shows no event that tells a prank from a sighting", (world) => {
    const projected = toHunterView(seal(world));

    for (const event of projected.events) {
      expect(["eyewitness", "prank_call"]).not.toContain(event.kind);
    }
    expect(projected.events).toHaveLength(world.events.length);
  });
});

describe("RevealFrame", () => {
  it("adds the criminal's true position to a hunter view, and nothing else", () => {
    const frame: RevealFrame = { turn: TURN, view, criminalNodeId: airport };
    expect(Object.keys(frame).sort()).toEqual(["criminalNodeId", "turn", "view"]);
  });
});
