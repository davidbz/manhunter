import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { createActionLogic } from "./actions";
import { createCriminalAiLogic } from "./ai";
import { BALANCE } from "./balance";
import { createBeliefLogic } from "./belief";
import type { GameConfig, GameSetup } from "./config";
import { makeCriminalState } from "./criminal";
import { createDistrictLogic } from "./districts";
import type { GameEvent } from "./events";
import { createEventLogic } from "./eventtable";
import { createGameLogic } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import { type Containment, makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId, makeReportId } from "./ids";
import { createIntelLogic } from "./intel";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import { createMinCutLogic } from "./mincut";
import type { Report } from "./report";
import { makeReport } from "./report";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { type SealedWorld, unseal } from "./sealed";
import { makeClock } from "./time";
import { createTopologyLogic } from "./topology";
import { createTurnLogic } from "./turn";
import { createValidatorLogic } from "./validator";
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

/**
 * Architecture rule 3, walked rather than asserted field by field: state is plain, immutable,
 * serializable data, so every value inside a `WorldState` is a primitive, a plain object or an
 * array of them - never a class instance, a `Map`, a `Set`, a `Date` or a function. The PLAN Inbox
 * carried this as review-only until M3.8c, because the shallow list below it only ever looked at
 * the top level of a world nobody had played.
 *
 * Reported as a list of paths rather than a boolean, so a failure names the field.
 */
type Offence = {
  readonly path: string;
  readonly reason: string;
};

const PLAIN_PROTOTYPES: readonly unknown[] = [Object.prototype, Array.prototype, null];

/** A bound rather than a belief: a cyclic world would otherwise recurse until the stack went. */
const MAX_STATE_DEPTH = 12;

const offencesIn = (value: unknown, path: string, depth: number): readonly Offence[] => {
  if (depth > MAX_STATE_DEPTH) {
    return [{ path, reason: `nested deeper than ${MAX_STATE_DEPTH}` }];
  }
  if (typeof value === "function") {
    return [{ path, reason: "a function" }];
  }
  if (value === undefined) {
    return [{ path, reason: "undefined, which JSON drops" }];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (!PLAIN_PROTOTYPES.includes(Object.getPrototypeOf(value))) {
    return [{ path, reason: `an instance of ${value.constructor.name}` }];
  }
  return Object.entries(value).flatMap(([key, member]) =>
    offencesIn(member, `${path}.${key}`, depth + 1),
  );
};

const offencesInWorld = (world: WorldState): readonly Offence[] => offencesIn(world, "world", 0);

const graph = createGraphLogic();
const generation = createGenerationLogic({
  rng: rng,
  topology: createTopologyLogic({ rng: rng, graph }),
  river: createRiverLogic({ rng: rng, graph }),
  districts: createDistrictLogic({ rng: rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});
const game = createGameLogic({ rng: rng, generation });
const turn = createTurnLogic({
  rng,
  intel: createIntelLogic({ rng: rng, graph }),
  events: createEventLogic({ rng: rng }),
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng: rng }),
  ai: createCriminalAiLogic({ rng: rng, graph }),
  graph,
});

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

/** A real hunt, played to whatever ends it, so the walk is over state the game actually built. */
const huntPlayedOut = (seed: number): WorldState => {
  const created = game.create({ setup: SETUP, seed, balance: BALANCE });
  if (created.kind !== "game") {
    throw new Error(`expected a game, got ${created.kind}`);
  }
  let world: SealedWorld = created.world;
  for (let taken = 0; taken < MAX_TURNS; taken += 1) {
    const result = turn.step({ world, actions: [{ kind: "true_briefing" }], balance: BALANCE });
    if (result.kind !== "turn") {
      return unseal(world);
    }
    world = result.world;
  }
  return unseal(world);
};

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

  test.prop([arbitraryWorld])("holds nothing but plain data, however deep", (world) => {
    expect(offencesInWorld(world)).toEqual([]);
  });
});

describe("a world the game actually played (architecture rule 3)", () => {
  const PLAYED_SEEDS: readonly number[] = [1, 7, 42, 512, 4242];

  it("holds nothing but plain data from the first turn to the last", () => {
    for (const seed of PLAYED_SEEDS) {
      expect(offencesInWorld(huntPlayedOut(seed))).toEqual([]);
    }
  });

  it("round-trips through JSON once the hunt is over", () => {
    const played = huntPlayedOut(SEED);

    expect(JSON.parse(JSON.stringify(played))).toEqual(played);
  });

  /** The walk has to be able to fail, or the two tests above say nothing. */
  it("names every kind of thing state may not hold", () => {
    const sample = sampleWorld();
    const planted: WorldState = {
      ...sample,
      map: { ...map, nodes: [...map.nodes, /exit/ as unknown as MapGraph["nodes"][number]] },
      hunter: { ...sample.hunter, containments: new Set() as unknown as readonly Containment[] },
      reports: new Map() as unknown as readonly Report[],
      events: [{ kind: "nightfall", turn: () => TURN } as unknown as GameEvent],
      belief: [{ nodeId: downtown, mass: undefined as unknown as number }],
    };

    expect(offencesInWorld(planted).map((offence) => offence.path)).toEqual([
      "world.map.nodes.3",
      "world.hunter.containments",
      "world.reports",
      "world.events.0.turn",
      "world.belief.0.mass",
    ]);
  });
});
