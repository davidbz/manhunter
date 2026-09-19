import { describe, expect, it } from "vitest";
import type { Balance, DistrictProperties } from "./balance";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import { type CriminalState, makeCriminalState } from "./criminal";
import { createDistrictLogic } from "./districts";
import { createGameLogic } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import { type HunterState, makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId, makeReportId, type NodeId } from "./ids";
import { createIntelLogic } from "./intel";
import { type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { createMinCutLogic } from "./mincut";
import { makeReport, type Report } from "./report";
import { createRiverLogic } from "./river";
import { createRng, type RngState } from "./rng";
import { unseal } from "./sealed";
import { makeClock, type Turn, timeOfDayAt } from "./time";
import { createTopologyLogic } from "./topology";
import { createValidatorLogic } from "./validator";
import { makeWorldState, type WorldState } from "./world";

const rng = createRng();
const graph = createGraphLogic();
const intel = createIntelLogic({ rng, graph });

const SEED = 4;
const START_HOUR = 9;
const NIGHT_HOUR = 23;
const MAX_TURNS = 24;
const FIRST_TURN = 0;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;
const HEAT_MAX = BALANCE.criminal.heatMax;
const CALM = 0;
const REPORTS = BALANCE.reports;
const NO_BRIEFINGS = 0;
const BRIEFINGS_GIVEN = 5;

/**
 * Turns of one hunt's worth of phone calls. Long enough that the tenth of them that are mistaken
 * (`falseReportRate`) and the twentieth that are invented (`basePrankRate`) both show up several
 * times over, which is what lets those branches be tested against the shipped balance rather than
 * against a balance bent to force them.
 */
const TURNS_SAMPLED = 200;

/**
 * A seed on which both the witness and the prank ring in the same turn, so the second call has to
 * be numbered past a report that is not in the world yet. Found by search over the first sixty.
 */
const BOTH_RING_SEED = 11;

const downtown = makeNodeId("downtown");
const sidestreet = makeNodeId("sidestreet");
const terminal = makeNodeId("terminal");
const nowhere = makeNodeId("nowhere");

/**
 * Downtown has exactly one neighbour, so "a mistaken witness names the district next door" has one
 * answer to check rather than a set to sample.
 */
const city: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(sidestreet, "residential", { x: 1, y: 0 }),
    makeNode(terminal, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", makeEdgeId("downtown-sidestreet"), downtown, sidestreet),
    makeEdge("road", makeEdgeId("sidestreet-terminal"), sidestreet, terminal),
  ],
  exits: [makeExit(terminal, "highway")],
  river: null,
  incidentNodeId: downtown,
};

/** A district with nothing adjacent to confuse it with. No generated city is this; the code is. */
const cutOff: MapGraph = {
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

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const briefingsAt = (count: number): readonly Turn[] =>
  Array.from({ length: count }, (_unused, turn) => turn);

const hunterWith = (overrides: Partial<HunterState>): HunterState => ({
  ...makeHunterState({
    actionPoints: START_ACTION_POINTS,
    budget: START_BUDGET,
    trust: BALANCE.hunter.trustMax,
    pressure: START_PRESSURE,
  }),
  ...overrides,
});

const criminalAt = (nodeId: NodeId, heat: number): CriminalState =>
  makeCriminalState({
    nodeId,
    travelMode: "foot",
    profile: "amateur",
    stamina: START_STAMINA,
    heat,
    cash: START_CASH,
    desperation: 0,
  });

type WorldOptions = {
  readonly map?: MapGraph;
  readonly hunter?: HunterState;
  readonly heat?: number;
  readonly seed?: number;
  readonly startHour?: number;
  readonly reports?: readonly Report[];
};

/**
 * Heat at the top of the meter unless a test says otherwise: an unprompted sighting is somebody
 * recognising a face, so a criminal nobody has heard of produces no feed to measure.
 */
const worldAt = (options: WorldOptions = {}): WorldState => ({
  ...makeWorldState({
    config: { ...config, startHour: options.startHour ?? START_HOUR },
    rng: rng.seed(options.seed ?? SEED),
    clock: makeClock(options.startHour ?? START_HOUR, FIRST_TURN),
    map: options.map ?? city,
    hunter: options.hunter ?? hunterWith({}),
    criminal: criminalAt((options.map ?? city).incidentNodeId, options.heat ?? HEAT_MAX),
  }),
  reports: options.reports ?? [],
});

const withDowntown = (overrides: Partial<DistrictProperties>): Balance => ({
  ...BALANCE,
  districts: {
    ...BALANCE.districts,
    downtown: { ...BALANCE.districts.downtown, ...overrides },
  },
});

/** A density above one, so the phone rings every turn and only what is said in it varies. */
const CERTAIN_DENSITY = 4;

const ALWAYS_SEEN = withDowntown({ witnessDensity: CERTAIN_DENSITY });
/**
 * A density the briefing's multiplier still has room above: at certainty the extra public it
 * brings out has nowhere to show up in the count, and the test would pass on the noise instead.
 */
const ROOM_TO_GROW = withDowntown({ witnessDensity: 0.5 });
/**
 * `reportVolumeMultiplier` is 1.5, thinned by the night hours the run passes through. The margin
 * is what is left of it after the sampling, so dropping the term fails rather than coming up
 * higher half the time.
 */
const MIN_VOLUME_GAIN = 1.3;
const UNWATCHED = withDowntown({ witnessDensity: 0 });
const EMPTIES_AT_NIGHT = withDowntown({
  witnessDensity: CERTAIN_DENSITY,
  nightWitnessMultiplier: 0,
});

/** The world advanced to a turn, with the criminal standing wherever the run puts them. */
const turnOf = (world: WorldState, state: RngState, turn: Turn, nodeId: NodeId): WorldState => ({
  ...world,
  rng: state,
  clock: makeClock(world.config.startHour, turn),
  criminal: { ...world.criminal, nodeId },
});

/** One call per turn of a route, the stream threaded through it the way a turn loop would. */
const feedOver = (world: WorldState, balance: Balance, route: readonly NodeId[]): Report[] => {
  const collected: Report[] = [];
  let state = world.rng;
  for (const [turn, nodeId] of route.entries()) {
    const drawn = intel.collect({ world: turnOf(world, state, turn, nodeId), balance });
    state = drawn.state;
    collected.push(...drawn.value);
  }
  return collected;
};

const standingAt = (nodeId: NodeId, turns: number): readonly NodeId[] =>
  Array.from({ length: turns }, () => nodeId);

const witnessCalls = (reports: readonly Report[]): readonly Report[] =>
  reports.filter((report) => report.source === "witness");

const truthfulCalls = (reports: readonly Report[]): readonly Report[] =>
  reports.filter((report) => report.truth === "true");

const mistakenCalls = (reports: readonly Report[]): readonly Report[] =>
  reports.filter((report) => report.truth === "false");

const prankCalls = (reports: readonly Report[]): readonly Report[] =>
  reports.filter((report) => report.truth === "prank");

const nodeOf = (report: Report): NodeId => report.content.nodeId;

const overADay = (balance: Balance, options: WorldOptions = {}): Report[] =>
  feedOver(worldAt(options), balance, standingAt(downtown, TURNS_SAMPLED));

describe("witness calls", () => {
  it("files what a passer-by saw, where the criminal is standing", () => {
    const truthful = truthfulCalls(overADay(ALWAYS_SEEN));

    expect(truthful.length).toBeGreaterThan(0);
    for (const report of truthful) {
      expect(report.source).toBe("witness");
      expect(report.content).toEqual({ kind: "sighting", nodeId: downtown, travelMode: "foot" });
    }
  });

  it("takes until the next turn to reach the desk, because somebody has to ring it in", () => {
    for (const report of overADay(ALWAYS_SEEN)) {
      expect(report.receivedAtTurn - report.observedAtTurn).toBe(REPORTS.unpromptedDelayTurns);
    }
  });

  it("stays quiet about a face nobody would recognise", () => {
    expect(witnessCalls(overADay(ALWAYS_SEEN, { heat: CALM }))).toEqual([]);
  });

  it("finds nobody on the street to see anything after dark", () => {
    const calls = witnessCalls(overADay(EMPTIES_AT_NIGHT, { startHour: NIGHT_HOUR }));
    const afterDark = calls.filter(
      (report) =>
        timeOfDayAt(BALANCE.time, makeClock(NIGHT_HOUR, report.observedAtTurn).hour) === "night",
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(afterDark).toEqual([]);
  });

  it("rings less often the less the public trusts the hunt", () => {
    const callsAt = (trust: number): number =>
      witnessCalls(overADay(BALANCE, { hunter: hunterWith({ trust }) })).length;

    expect(callsAt(BALANCE.hunter.trustMin)).toBe(0);
    expect(callsAt(BALANCE.hunter.trustMax)).toBeGreaterThan(callsAt(BALANCE.hunter.trustMin));
  });

  it("puts more of the public on the phone once the hunt has been on the news", () => {
    const callsWith = (count: number): number =>
      witnessCalls(
        overADay(ROOM_TO_GROW, { hunter: hunterWith({ briefingTurns: briefingsAt(count) }) }),
      ).length;

    expect(callsWith(1)).toBeGreaterThan(callsWith(NO_BRIEFINGS) * MIN_VOLUME_GAIN);
  });

  it("trusts a witness further the better the hunter's standing with the public", () => {
    const accuraciesAt = (trust: number): readonly number[] =>
      truthfulCalls(overADay(ALWAYS_SEEN, { hunter: hunterWith({ trust }) })).map(
        (report) => report.accuracy,
      );
    const half = BALANCE.hunter.trustMax / 2;

    for (const accuracy of accuraciesAt(BALANCE.hunter.trustMax)) {
      expect(accuracy).toBeCloseTo(REPORTS.baseSightingAccuracy + REPORTS.trustAccuracyWeight);
    }
    for (const accuracy of accuraciesAt(half)) {
      expect(accuracy).toBeCloseTo(REPORTS.baseSightingAccuracy + REPORTS.trustAccuracyWeight / 2);
    }
  });

  it("names the district next door when the witness was looking at somebody else", () => {
    const mistaken = mistakenCalls(overADay(ALWAYS_SEEN));

    expect(mistaken.length).toBeGreaterThan(0);
    for (const report of mistaken) {
      expect(report.source).toBe("witness");
      expect(report.content).toEqual({
        kind: "sighting",
        nodeId: sidestreet,
        travelMode: "unknown",
      });
      expect(report.accuracy).toBe(0);
    }
  });

  it("says nothing at all where there is nowhere next door to be confused with", () => {
    const calls = witnessCalls(
      feedOver(worldAt({ map: cutOff }), ALWAYS_SEEN, standingAt(nowhere, TURNS_SAMPLED)),
    );

    expect(mistakenCalls(calls)).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(TURNS_SAMPLED);
  });
});

describe("prank calls", () => {
  it("invents a sighting where there was nobody to see one", () => {
    const invented = overADay(UNWATCHED);
    const nodeIds = city.nodes.map((node) => node.id);

    expect(invented.length).toBeGreaterThan(0);
    expect(prankCalls(invented)).toEqual(invented);
    for (const report of invented) {
      expect(report.source).toBe("tip");
      expect(report.accuracy).toBe(0);
      expect(report.content).toEqual({
        kind: "sighting",
        nodeId: expect.anything(),
        travelMode: "unknown",
      });
      expect(nodeIds).toContain(nodeOf(report));
    }
  });

  /** A feed whose invented calls all pointed at the criminal would be the opposite of noise. */
  it("rings about the whole city, not about where the criminal happens to be", () => {
    const named = new Set(overADay(UNWATCHED).map(nodeOf));

    expect(named.size).toBeGreaterThan(1);
  });

  it("rings more often the more the hunt has been on the news", () => {
    const pranksWith = (count: number): number =>
      prankCalls(overADay(UNWATCHED, { hunter: hunterWith({ briefingTurns: briefingsAt(count) }) }))
        .length;

    expect(pranksWith(BRIEFINGS_GIVEN)).toBeGreaterThan(pranksWith(NO_BRIEFINGS));
  });

  it("has nothing to invent in a city with nowhere in it", () => {
    const world = worldAt({ map: emptyQuarter });
    const feed = feedOver(world, ALWAYS_SEEN, standingAt(nowhere, TURNS_SAMPLED));

    expect(feed).toEqual([]);
    expect(intel.collect({ world, balance: ALWAYS_SEEN }).state).not.toEqual(world.rng);
  });
});

describe("collect", () => {
  it("advances the stream on a turn nobody rang, so a hunt replays the same way", () => {
    const world = worldAt({ heat: CALM });
    const drawn = intel.collect({ world, balance: UNWATCHED });

    expect(drawn.value).toEqual([]);
    expect(drawn.state).not.toEqual(world.rng);
  });

  it("numbers what it files after the reports the world already holds", () => {
    const filed = makeReport({
      id: makeReportId("report-0"),
      source: "patrol",
      observedAtTurn: FIRST_TURN,
      deliveryDelayTurns: 0,
      content: { kind: "no_sighting", nodeId: terminal },
      truth: "true",
      accuracy: 1,
    });
    const world = worldAt({ reports: [filed], seed: BOTH_RING_SEED });
    const drawn = intel.collect({ world, balance: ALWAYS_SEEN });

    expect(drawn.value.map((report) => report.id)).toEqual(["report-1", "report-2"]);
  });

  it("is a pure function of the world and the stream position", () => {
    const world = worldAt();

    expect(intel.collect({ world, balance: ALWAYS_SEEN })).toEqual(
      intel.collect({ world, balance: ALWAYS_SEEN }),
    );
  });

  it("leaves the world alone: what it draws is what the turn loop files", () => {
    const world = worldAt();
    intel.collect({ world, balance: ALWAYS_SEEN });

    expect(world.reports).toEqual([]);
  });
});

/**
 * The acceptance test for PLAN M3.6, over generated cities rather than the fixtures above: a real
 * district mix, a real set of neighbours, and a criminal walking through all of it.
 *
 * Hard-coded rather than generated: a batch of seeds drawn at run time would make this the one
 * test in the repo that can fail differently on two runs of the same commit, and a failure has to
 * name the seed that broke it so it can be pinned as a regression. The seed is in each test's name
 * for that reason.
 */
describe("a hunt's feed of unprompted calls", () => {
  const generation = createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  });
  const game = createGameLogic({ rng, generation });

  const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
  /**
   * Turns of calls per arm. Sized from the thinner of the two: at `LOW_TRUST` about one turn in
   * twenty produces a witness call, and this leaves between 27 and 57 accuracies to average over
   * these eight seeds, which is enough for the gap to be the balance rather than the sampling.
   */
  const SAMPLE_TURNS = 1000;
  /** Below this an arm is not a sample, it is an anecdote, and a mean over it means nothing. */
  const MIN_SAMPLE = 20;
  const HIGH_TRUST = 90;
  const LOW_TRUST = 10;
  /**
   * The gap the balance implies is `trustAccuracyWeight * (HIGH_TRUST - LOW_TRUST) / trustMax`,
   * less what the tenth of calls that are mistaken take off each arm: 0.29 as shipped, and 0.261
   * to 0.322 as measured over these seeds. The margin is the narrowest of those with room taken
   * off for the thin arm, so a regression that halves the effect fails and a lucky run does not.
   */
  const ACCURACY_MARGIN = 0.2;
  /**
   * `prankRatePerBriefing * BRIEFINGS_GIVEN` is 0.2 of a call per turn as shipped, and 0.180 to
   * 0.220 as measured over these seeds. Half of it is the margin, for the same reason.
   */
  const PRANK_MARGIN = 0.1;

  const worldFor = (seed: number): WorldState => {
    const result = game.create({
      setup: { map: BALANCE.map.defaults, maxTurns: MAX_TURNS, difficulty: "standard" },
      seed,
      balance: BALANCE,
    });
    if (result.kind !== "game") {
      throw new Error(`seed ${seed}: expected a game, got ${result.kind}`);
    }
    return unseal(result.world);
  };

  /** The criminal walks every district in turn, so the feed is not one district's habits. */
  const tourOf = (world: WorldState): readonly NodeId[] => {
    const nodeIds = world.map.nodes.map((node) => node.id);
    const laps = Math.ceil(SAMPLE_TURNS / nodeIds.length);
    return Array.from({ length: laps }, () => nodeIds)
      .flat()
      .slice(0, SAMPLE_TURNS);
  };

  type Arm = {
    readonly trust: number;
    readonly briefings: number;
  };

  const feedFor = (seed: number, arm: Arm): readonly Report[] => {
    const world = worldFor(seed);
    const hunter = hunterWith({ trust: arm.trust, briefingTurns: briefingsAt(arm.briefings) });
    const atFullHeat: WorldState = {
      ...world,
      hunter,
      criminal: { ...world.criminal, heat: HEAT_MAX },
    };
    return feedOver(atFullHeat, BALANCE, tourOf(world));
  };

  const meanAccuracy = (seed: number, reports: readonly Report[]): number => {
    const accuracies = witnessCalls(reports).map((report) => report.accuracy);
    if (accuracies.length < MIN_SAMPLE) {
      throw new Error(`seed ${seed}: ${accuracies.length} witness calls is too few to average`);
    }
    return accuracies.reduce((total, accuracy) => total + accuracy, 0) / accuracies.length;
  };

  const pranksPerTurn = (reports: readonly Report[]): number =>
    prankCalls(reports).length / SAMPLE_TURNS;

  for (const seed of SEEDS) {
    it(`is worth more to a trusted hunt than to a doubted one, on seed ${seed}`, () => {
      const trusted = meanAccuracy(
        seed,
        feedFor(seed, { trust: HIGH_TRUST, briefings: NO_BRIEFINGS }),
      );
      const doubted = meanAccuracy(
        seed,
        feedFor(seed, { trust: LOW_TRUST, briefings: NO_BRIEFINGS }),
      );

      expect(trusted - doubted).toBeGreaterThan(ACCURACY_MARGIN);
    });
  }

  for (const seed of SEEDS) {
    it(`carries more invented calls the more briefings were given, on seed ${seed}`, () => {
      const quiet = pranksPerTurn(feedFor(seed, { trust: HIGH_TRUST, briefings: NO_BRIEFINGS }));
      const loud = pranksPerTurn(feedFor(seed, { trust: HIGH_TRUST, briefings: BRIEFINGS_GIVEN }));

      expect(loud - quiet).toBeGreaterThan(PRANK_MARGIN);
    });
  }
});
