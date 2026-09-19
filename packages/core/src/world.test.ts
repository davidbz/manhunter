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
import { makeReport } from "./report";
import { createRng } from "./rng";
import { makeClock } from "./time";
import type { GameOutcome, WorldState } from "./world";
import { IN_PROGRESS, makeWorldState } from "./world";

const rng = createRng();

const SEED = 1;
const START_HOUR = 21;
const MAX_TURNS = 24;
const TURN = 3;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;

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

const arbitraryOutcome: fc.Arbitrary<GameOutcome> = fc.oneof(
  fc.constant(IN_PROGRESS),
  arbitraryTurn.map((turn) => ({ kind: "captured", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "escaped", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "trust_collapsed", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "casualties_exceeded", turn }) as const),
);

const arbitraryReport: fc.Arbitrary<Report> = fc
  .record({
    index: fc.nat(),
    observedAtTurn: arbitraryTurn,
    deliveryDelayTurns: fc.integer({ min: 0, max: 3 }),
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

const arbitraryEvent: fc.Arbitrary<GameEvent> = fc.oneof(
  arbitraryTurn.map((turn) => ({ kind: "nightfall", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "rush_hour", turn }) as const),
  arbitraryTurn.map((turn) => ({ kind: "civilian_hurt", turn, nodeId: downtown }) as const),
);

const arbitraryWorld: fc.Arbitrary<WorldState> = fc
  .record({
    seed: fc.integer(),
    turn: arbitraryTurn,
    trust: fc.integer({ min: 0, max: 100 }),
    pressure: fc.integer({ min: 0, max: 100 }),
    budget: fc.integer(),
    casualties: fc.nat({ max: 10 }),
    reports: fc.array(arbitraryReport, { maxLength: 8 }),
    events: fc.array(arbitraryEvent, { maxLength: 8 }),
    outcome: arbitraryOutcome,
  })
  .map((values) => ({
    ...sampleWorld(),
    rng: rng.seed(values.seed),
    clock: makeClock(START_HOUR, values.turn),
    hunter: {
      ...sampleWorld().hunter,
      trust: values.trust,
      pressure: values.pressure,
      budget: values.budget,
      containments: [{ kind: "roadblock", edgeId: makeEdgeId("e1"), expiresAt: values.turn }],
    },
    reports: values.reports,
    events: values.events,
    casualties: values.casualties,
    outcome: values.outcome,
  }));

describe("makeWorldState", () => {
  it("starts with nothing having happened yet", () => {
    const world = sampleWorld();
    expect(world.reports).toEqual([]);
    expect(world.events).toEqual([]);
    expect(world.casualties).toBe(0);
    expect(world.outcome).toEqual(IN_PROGRESS);
  });

  it("carries the rng position, so a stored world resumes the same stream", () => {
    const world = sampleWorld();
    expect(rng.uint32(world.rng)).toEqual(rng.uint32(rng.seed(SEED)));
  });
});

describe("WorldState serialization", () => {
  it("round-trips a sample world through JSON (architecture rule 3)", () => {
    const world = sampleWorld();
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
  });

  test.prop([arbitraryWorld])("round-trips any world through JSON", (world) => {
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
  });

  test.prop([arbitraryWorld])("holds no functions, Maps or Sets", (world) => {
    const values = [
      world.config,
      world.rng,
      world.clock,
      world.map,
      world.hunter,
      world.criminal,
      ...world.reports,
      ...world.events,
      ...world.belief,
      world.outcome,
    ];
    for (const value of values) {
      expect(typeof value).toBe("object");
      expect(value instanceof Map).toBe(false);
      expect(value instanceof Set).toBe(false);
    }
  });
});
