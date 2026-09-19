import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { Belief, BeliefEvidence, BeliefObservation } from "./belief";
import {
  BELIEF_MASS_TOLERANCE,
  beliefMassAt,
  createBeliefLogic,
  pointBelief,
  toBeliefEvidence,
  uniformBelief,
} from "./belief";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import { createGraphLogic } from "./graph";
import { type Containment, makeHunterState } from "./hunter";
import { type EdgeId, makeEdgeId, makeNodeId, makeReportId, type NodeId } from "./ids";
import { type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { makeReport, type Report, type ReportSource } from "./report";
import { createRng } from "./rng";
import { seal } from "./sealed";
import { makeClock, type Turn } from "./time";
import { toHunterView } from "./view";
import { makeWorldState, type WorldState } from "./world";

const rng = createRng();
const belief = createBeliefLogic({ graph: createGraphLogic() });

const SEED = 7;
const START_HOUR = 9;
const MAX_TURNS = 24;
const TURN = 3;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;
const ACCURACY = 0.5;
const NOTHING = 0;
const EVERYTHING = 1;
const MAX_REPORTS = 6;
const MAX_OBSERVATIONS = 3;
const DELIVERY_DELAY = 1;
/** Tighter than `toBeCloseTo`'s default, which would pass on a tenth of the difference tested. */
const DIGITS = 10;

const SOURCES = ["witness", "cctv", "tip", "patrol"] as const satisfies readonly ReportSource[];

const downtown = makeNodeId("downtown");
const riverside = makeNodeId("riverside");
const market = makeNodeId("market");
const terminal = makeNodeId("terminal");
const nowhere = makeNodeId("nowhere");

const downtownRiverside = makeEdgeId("downtown-riverside");
const downtownMarket = makeEdgeId("downtown-market");
const riversideTerminal = makeEdgeId("riverside-terminal");

/**
 * Downtown has two ways out that cost different amounts in `balance.map.escapeMode`: the footpath
 * to the market is a turn, the road to the riverside is two. Every spread assertion below is
 * about that difference, so it has to be in the fixture rather than in a generated city.
 */
const city: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(riverside, "park", { x: 1, y: 0 }),
    makeNode(market, "residential", { x: 0, y: 1 }),
    makeNode(terminal, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", downtownRiverside, downtown, riverside),
    makeEdge("footpath", downtownMarket, downtown, market),
    makeEdge("road", riversideTerminal, riverside, terminal),
  ],
  exits: [makeExit(terminal, "highway")],
  river: null,
  incidentNodeId: downtown,
};

/** One district, no way out of it. No generated city is this; the code is. */
const island: MapGraph = {
  nodes: [makeNode(nowhere, "downtown", { x: 0, y: 0 })],
  edges: [],
  exits: [],
  river: null,
  incidentNodeId: nowhere,
};

const emptyQuarter: MapGraph = {
  nodes: [],
  edges: [],
  exits: [],
  river: null,
  incidentNodeId: nowhere,
};

const cityNodeIds = city.nodes.map((node) => node.id);

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const evidenceOf = (overrides: Partial<BeliefEvidence>): BeliefEvidence => ({
  graph: city,
  blockedEdgeIds: new Set<EdgeId>(),
  sightings: [],
  clearances: [],
  ...overrides,
});

const advance = (current: Belief, overrides: Partial<BeliefEvidence>): Belief =>
  belief.advance({ belief: current, evidence: evidenceOf(overrides), balance: BALANCE });

const seen = (nodeId: NodeId, source: ReportSource): BeliefObservation => ({ nodeId, source });

const totalOf = (distribution: Belief): number =>
  distribution.reduce((sum, cell) => sum + cell.mass, NOTHING);

const worldWith = (criminalNodeId: NodeId, overrides: Partial<WorldState> = {}): WorldState => ({
  ...makeWorldState({
    config,
    rng: rng.seed(SEED),
    clock: makeClock(START_HOUR, TURN),
    map: city,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: START_BUDGET,
      trust: START_TRUST,
      pressure: START_PRESSURE,
    }),
    criminal: makeCriminalState({
      nodeId: criminalNodeId,
      travelMode: "foot",
      profile: "amateur",
      stamina: START_STAMINA,
      heat: NOTHING,
      cash: START_CASH,
      desperation: NOTHING,
    }),
  }),
  ...overrides,
});

/**
 * The call the consequences phase will make once per turn (PLAN M3.8a), written out here so the
 * hidden-information property below runs over the production path rather than over a shortcut:
 * the world is sealed, projected, and only then read for evidence.
 */
const nextBelief = (world: WorldState): Belief =>
  belief.advance({
    belief: world.belief,
    evidence: toBeliefEvidence(toHunterView(seal(world))),
    balance: BALANCE,
  });

const arbitraryTurn = fc.integer({ min: 0, max: MAX_TURNS });
const arbitraryNodeId = fc.constantFrom(...cityNodeIds, nowhere);
const arbitrarySource = fc.constantFrom(...SOURCES);

const arbitraryObservation: fc.Arbitrary<BeliefObservation> = fc
  .tuple(arbitraryNodeId, arbitrarySource)
  .map(([nodeId, source]) => ({ nodeId, source }));

const arbitraryBelief: fc.Arbitrary<Belief> = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: cityNodeIds.length,
    maxLength: cityNodeIds.length,
  })
  .map((masses) =>
    cityNodeIds.map((nodeId, index) => ({ nodeId, mass: masses[index] ?? NOTHING })),
  );

const arbitraryEvidence: fc.Arbitrary<BeliefEvidence> = fc
  .record({
    blocked: fc.subarray([downtownRiverside, downtownMarket, riversideTerminal]),
    sightings: fc.array(arbitraryObservation, { maxLength: MAX_OBSERVATIONS }),
    clearances: fc.array(arbitraryObservation, { maxLength: MAX_OBSERVATIONS }),
  })
  .map(({ blocked, sightings, clearances }) =>
    evidenceOf({ blockedEdgeIds: new Set(blocked), sightings, clearances }),
  );

const arbitraryReport: fc.Arbitrary<Report> = fc
  .record({
    index: fc.nat(),
    observedAtTurn: arbitraryTurn,
    deliveryDelayTurns: fc.integer({ min: 0, max: MAX_TURNS }),
    source: arbitrarySource,
    truth: fc.constantFrom(...(["true", "false", "prank", "planted"] as const)),
    accuracy: fc.double({ min: 0, max: 1, noNaN: true }),
    nodeId: arbitraryNodeId,
    sighted: fc.boolean(),
  })
  .map(({ index, sighted, nodeId, ...rest }) =>
    makeReport({
      ...rest,
      id: makeReportId(`report-${index}`),
      content: sighted
        ? { kind: "sighting", nodeId, travelMode: "foot" }
        : { kind: "no_sighting", nodeId },
    }),
  );

describe("uniformBelief", () => {
  it("knows nothing about anywhere, which is the same mass everywhere", () => {
    const distribution = uniformBelief(cityNodeIds);

    expect(distribution.map((cell) => cell.nodeId)).toEqual(cityNodeIds);
    for (const cell of distribution) {
      expect(cell.mass).toBeCloseTo(EVERYTHING / cityNodeIds.length, DIGITS);
    }
    expect(totalOf(distribution)).toBeCloseTo(EVERYTHING, DIGITS);
  });

  it("holds no mass at all over a map with no districts", () => {
    expect(uniformBelief([])).toEqual([]);
  });
});

describe("pointBelief", () => {
  it("puts everything on the one place the criminal is known to have been", () => {
    const distribution = pointBelief(cityNodeIds, downtown);

    expect(beliefMassAt(distribution, downtown)).toBe(EVERYTHING);
    expect(totalOf(distribution)).toBe(EVERYTHING);
  });

  it("falls back to knowing nothing when the map has no such district", () => {
    expect(pointBelief(cityNodeIds, nowhere)).toEqual(uniformBelief(cityNodeIds));
  });
});

describe("beliefMassAt", () => {
  it("reads the mass a district holds", () => {
    expect(beliefMassAt(uniformBelief(cityNodeIds), terminal)).toBeCloseTo(
      EVERYTHING / cityNodeIds.length,
      DIGITS,
    );
  });

  it("suspects a district the distribution has no cell for not at all", () => {
    expect(beliefMassAt(uniformBelief(cityNodeIds), nowhere)).toBe(NOTHING);
  });
});

describe("makeWorldState", () => {
  it("starts the hunt certain of the crime scene and of nowhere else", () => {
    expect(worldWith(riverside).belief).toEqual(pointBelief(cityNodeIds, city.incidentNodeId));
  });
});

describe("toBeliefEvidence", () => {
  /** Every report is a turn late, which is what makes "landed this turn" worth distinguishing. */
  const reportAt = (
    nodeId: NodeId,
    sighted: boolean,
    receivedAtTurn: Turn,
    source: ReportSource,
  ): Report =>
    makeReport({
      id: makeReportId(`report-${nodeId}-${receivedAtTurn}`),
      source,
      observedAtTurn: receivedAtTurn - DELIVERY_DELAY,
      deliveryDelayTurns: DELIVERY_DELAY,
      content: sighted
        ? { kind: "sighting", nodeId, travelMode: "foot" }
        : { kind: "no_sighting", nodeId },
      truth: "true",
      accuracy: ACCURACY,
    });

  it("splits what landed this turn into places named and places cleared", () => {
    const world = worldWith(riverside, {
      reports: [reportAt(market, true, TURN, "cctv"), reportAt(terminal, false, TURN, "patrol")],
    });

    const evidence = toBeliefEvidence(toHunterView(seal(world)));

    expect(evidence.sightings).toEqual([seen(market, "cctv")]);
    expect(evidence.clearances).toEqual([seen(terminal, "patrol")]);
  });

  it("takes no report the hunter read on an earlier turn, which is already in the belief", () => {
    const world = worldWith(riverside, {
      reports: [reportAt(market, true, TURN - DELIVERY_DELAY, "cctv")],
    });

    expect(toBeliefEvidence(toHunterView(seal(world))).sightings).toEqual([]);
  });

  it("carries the map the hunter is looking at", () => {
    expect(toBeliefEvidence(toHunterView(seal(worldWith(riverside)))).graph).toEqual(city);
  });

  it("blocks the edges standing containment has closed, and no expired one", () => {
    const containments: readonly Containment[] = [
      { kind: "roadblock", edgeId: downtownRiverside, expiresAt: TURN + EVERYTHING },
      { kind: "roadblock", edgeId: riversideTerminal, expiresAt: TURN },
    ];
    const world = worldWith(riverside, {
      hunter: { ...worldWith(riverside).hunter, containments },
    });

    expect([...toBeliefEvidence(toHunterView(seal(world))).blockedEdgeIds]).toEqual([
      downtownRiverside,
    ]);
  });
});

describe("advance", () => {
  const fraction = BALANCE.belief.spreadFraction;
  const fromDowntown = advance(pointBelief(cityNodeIds, downtown), {});

  it("leaves behind what did not move and hands the rest to the neighbours", () => {
    expect(beliefMassAt(fromDowntown, downtown)).toBeCloseTo(EVERYTHING - fraction, DIGITS);
    expect(beliefMassAt(fromDowntown, riverside)).toBeGreaterThan(NOTHING);
    expect(beliefMassAt(fromDowntown, market)).toBeGreaterThan(NOTHING);
  });

  it("puts more of it down the faster edge", () => {
    expect(beliefMassAt(fromDowntown, market)).toBeGreaterThan(
      beliefMassAt(fromDowntown, riverside),
    );
  });

  it("reaches nowhere two edges away in one turn", () => {
    expect(beliefMassAt(fromDowntown, terminal)).toBe(NOTHING);
  });

  it("moves nothing across a roadblock", () => {
    const blocked = advance(pointBelief(cityNodeIds, downtown), {
      blockedEdgeIds: new Set([downtownRiverside]),
    });

    expect(beliefMassAt(blocked, riverside)).toBe(NOTHING);
    expect(beliefMassAt(blocked, market)).toBeCloseTo(fraction, DIGITS);
  });

  it("keeps everything where it is when there is nowhere to go", () => {
    const distribution = belief.advance({
      belief: pointBelief([nowhere], nowhere),
      evidence: evidenceOf({ graph: island }),
      balance: BALANCE,
    });

    expect(distribution).toEqual([{ nodeId: nowhere, mass: EVERYTHING }]);
  });

  it("takes suspicion off a district that was searched and found empty", () => {
    const cleared = advance(pointBelief(cityNodeIds, downtown), {
      clearances: [seen(market, "patrol")],
    });

    expect(beliefMassAt(cleared, market)).toBeLessThan(beliefMassAt(fromDowntown, market));
  });

  it("pulls the distribution onto a district a report names", () => {
    const sighted = advance(uniformBelief(cityNodeIds), { sightings: [seen(terminal, "cctv")] });

    expect(beliefMassAt(sighted, terminal)).toBeGreaterThan(
      beliefMassAt(advance(uniformBelief(cityNodeIds), {}), terminal),
    );
    for (const cell of sighted) {
      expect(cell.mass).toBeLessThanOrEqual(beliefMassAt(sighted, terminal));
    }
  });

  it("moves more for a source the hunter has more reason to believe", () => {
    const camera = advance(uniformBelief(cityNodeIds), { sightings: [seen(terminal, "cctv")] });
    const telephone = advance(uniformBelief(cityNodeIds), { sightings: [seen(terminal, "tip")] });

    expect(beliefMassAt(camera, terminal)).toBeGreaterThan(beliefMassAt(telephone, terminal));
  });

  it("names every district of the map, in the map's order", () => {
    expect(fromDowntown.map((cell) => cell.nodeId)).toEqual(cityNodeIds);
  });

  it("knows nothing when every district it held mass on is off the map", () => {
    const foreign: Belief = [{ nodeId: nowhere, mass: EVERYTHING }];

    expect(advance(foreign, {})).toEqual(uniformBelief(cityNodeIds));
  });

  it("holds no mass over a map with no districts", () => {
    expect(
      belief.advance({
        belief: [],
        evidence: evidenceOf({ graph: emptyQuarter }),
        balance: BALANCE,
      }),
    ).toEqual([]);
  });

  it("is plain data: it round-trips through JSON and holds no Map or Set", () => {
    expect(JSON.parse(JSON.stringify(fromDowntown))).toEqual(fromDowntown);
    for (const cell of fromDowntown) {
      expect(cell instanceof Map).toBe(false);
      expect(cell instanceof Set).toBe(false);
    }
  });

  test.prop([arbitraryBelief, arbitraryEvidence])(
    "holds exactly the whole of the mass, whatever it is given",
    (current, evidence) => {
      const total = totalOf(belief.advance({ belief: current, evidence, balance: BALANCE }));

      expect(Math.abs(total - EVERYTHING)).toBeLessThanOrEqual(BELIEF_MASS_TOLERANCE);
    },
  );

  test.prop([arbitraryBelief, arbitraryEvidence])(
    "suspects nowhere a negative amount",
    (current, evidence) => {
      for (const cell of belief.advance({ belief: current, evidence, balance: BALANCE })) {
        expect(cell.mass).toBeGreaterThanOrEqual(NOTHING);
      }
    },
  );

  /**
   * Architecture rule 4, and the acceptance criterion this module exists to satisfy: the hunter's
   * inference is built out of what the hunter can see. Two hunts that differ only in where the
   * criminal is standing must produce the same heatmap, or the map is a leak.
   */
  test.prop([
    arbitraryNodeId,
    arbitraryNodeId,
    arbitraryTurn,
    fc.array(arbitraryReport, { maxLength: MAX_REPORTS }),
  ])("infers the same heatmap wherever the criminal actually is", (here, there, turn, reports) => {
    const clock = makeClock(START_HOUR, turn);

    expect(nextBelief(worldWith(here, { clock, reports }))).toEqual(
      nextBelief(worldWith(there, { clock, reports })),
    );
  });
});
