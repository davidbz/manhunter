import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { type ActionLogic, createActionLogic } from "./actions";
import { type CriminalAiLogic, type CriminalSituation, createCriminalAiLogic } from "./ai";
import { BALANCE, type Balance } from "./balance";
import { BELIEF_MASS_TOLERANCE, beliefMassAt, createBeliefLogic } from "./belief";
import type { GameConfig, GameSetup } from "./config";
import type { CriminalAction, CriminalState } from "./criminal";
import { makeCriminalState } from "./criminal";
import { createDistrictLogic } from "./districts";
import type { GameEvent } from "./events";
import { createEventLogic, type EventLogic } from "./eventtable";
import { createGameLogic } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import {
  blockedEdgeIdsAt,
  type Containment,
  type HunterAction,
  type HunterActionKind,
  makeHunterState,
} from "./hunter";
import { type EdgeId, makeEdgeId, makeNodeId, makeReportId, type NodeId } from "./ids";
import { createIntelLogic, type IntelLogic } from "./intel";
import { LIMITS } from "./limits";
import { type MapEdge, type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { createMinCutLogic } from "./mincut";
import { makeReport, type Report } from "./report";
import { createRiverLogic } from "./river";
import { createRng, type Rng } from "./rng";
import { seal, unseal } from "./sealed";
import { makeClock, type Turn } from "./time";
import { createTopologyLogic } from "./topology";
import { createTurnLogic, type PlanningRejection, type TurnResult, type TurnTaken } from "./turn";
import { createValidatorLogic } from "./validator";
import { makeWorldState, type WorldState } from "./world";

const rng = createRng();
const graph = createGraphLogic();
const belief = createBeliefLogic({ graph });
const action = createActionLogic({ rng });
const ai = createCriminalAiLogic({ rng, graph });

const SEED = 7;
const NOON = 12;
const MAX_TURNS = 24;
const FIRST_TURN = 0;
const SECOND_TURN = 1;
const START_ACTION_POINTS = 3;
const NO_ACTION_POINTS = 0;
const START_BUDGET = 1000;
const NO_BUDGET = 0;
const NO_COST = 0;
const START_TRUST = 70;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_HEAT = 20;
const START_CASH = 250;
const CALM = 0;
const NO_CASUALTIES = 0;
const FULL_ACCURACY = 1;
const LATE = 2;

const HEAT_DECAY = BALANCE.criminal.heatDecayPerTurn;
const HEAT_PER_SIGHTING = BALANCE.criminal.heatPerSighting;
const DESPERATION_PER_TURN = BALANCE.criminal.desperationPerTurn;
const NO_STAMINA = 0;

const PRESSURE_PER_TURN = BALANCE.hunter.pressurePerTurn;
const PRESSURE_PER_CASUALTY = BALANCE.hunter.pressurePerCasualty;
const PRESSURE_FLOOR = BALANCE.hunter.pressureMin;
const PRESSURE_CEILING = BALANCE.hunter.pressureMax;

/** Below the floor, which only a hand-built world can be: `create` starts inside the range. */
const UNDERWATER_PRESSURE = -50;

/** An upper bound on a hunt, not a length: a real one ends on its own long before this. */
const TURNS_SAMPLED = 60;
const SAMPLE_SEEDS = 5_000;
/** A hunt per run, map generation included, so the count is kept to what stays a fast suite. */
const PROPERTY_RUNS = 12;

const downtown = makeNodeId("downtown");
const park = makeNodeId("park");
const terminal = makeNodeId("terminal");

const city: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(park, "park", { x: 1, y: 0 }),
    makeNode(terminal, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", makeEdgeId("downtown-park"), downtown, park),
    makeEdge("road", makeEdgeId("park-terminal"), park, terminal),
  ],
  exits: [makeExit(terminal, "highway")],
  river: null,
  incidentNodeId: downtown,
};

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: NOON,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

type WorldOptions = {
  readonly turn?: Turn;
  readonly nodeId?: NodeId;
  readonly actionPoints?: number;
  readonly budget?: number;
  readonly trust?: number;
  readonly pressure?: number;
  readonly casualties?: number;
  readonly reports?: readonly Report[];
  readonly containments?: readonly Containment[];
  /** Whatever the criminal needs to be for the test: a meter, a trail, what it already knows. */
  readonly criminal?: Partial<CriminalState>;
  readonly map?: MapGraph;
};

const worldAt = (options: WorldOptions = {}): WorldState => {
  const turn = options.turn ?? FIRST_TURN;
  return {
    ...makeWorldState({
      config,
      rng: rng.seed(SEED),
      clock: makeClock(config.startHour, turn),
      map: options.map ?? city,
      hunter: {
        ...makeHunterState({
          actionPoints: options.actionPoints ?? START_ACTION_POINTS,
          budget: options.budget ?? START_BUDGET,
          trust: options.trust ?? START_TRUST,
          pressure: options.pressure ?? START_PRESSURE,
        }),
        containments: options.containments ?? [],
      },
      criminal: {
        ...makeCriminalState({
          nodeId: options.nodeId ?? downtown,
          travelMode: "foot",
          profile: "amateur",
          stamina: START_STAMINA,
          heat: START_HEAT,
          cash: START_CASH,
          desperation: CALM,
        }),
        ...options.criminal,
      },
    }),
    reports: options.reports ?? [],
    casualties: options.casualties ?? NO_CASUALTIES,
  };
};

const sightingOf = (nodeId: NodeId, observedAtTurn: Turn, deliveryDelayTurns: Turn): Report =>
  makeReport({
    id: makeReportId(`${nodeId}-${observedAtTurn}-${deliveryDelayTurns}`),
    source: "witness",
    observedAtTurn,
    deliveryDelayTurns,
    content: { kind: "sighting", nodeId, travelMode: "foot" },
    truth: "true",
    accuracy: FULL_ACCURACY,
  });

/** A witness who rang in about the wrong place: a sighting, and not a recognition. */
const mistakenOf = (nodeId: NodeId, observedAtTurn: Turn): Report =>
  makeReport({
    id: makeReportId(`mistaken-${nodeId}-${observedAtTurn}`),
    source: "witness",
    observedAtTurn,
    deliveryDelayTurns: FIRST_TURN,
    content: { kind: "sighting", nodeId, travelMode: "foot" },
    truth: "false",
    accuracy: FULL_ACCURACY,
  });

/** Somewhere looked at, nobody found. */
const clearanceOf = (
  nodeId: NodeId,
  observedAtTurn: Turn,
  deliveryDelayTurns: Turn = FIRST_TURN,
): Report =>
  makeReport({
    id: makeReportId(`clear-${nodeId}-${observedAtTurn}`),
    source: "witness",
    observedAtTurn,
    deliveryDelayTurns,
    content: { kind: "no_sighting", nodeId },
    truth: "true",
    accuracy: FULL_ACCURACY,
  });

const eyewitnessOf = (report: Report): GameEvent => ({
  kind: "eyewitness",
  turn: report.observedAtTurn,
  reportId: report.id,
});

const hurtAt = (turn: Turn): GameEvent => ({ kind: "civilian_hurt", turn, nodeId: downtown });

/** A collector that finds nothing and does not roll for it, so a phase can be switched off. */
const NO_INTEL: IntelLogic = { collect: ({ world }) => ({ state: world.rng, value: [] }) };

const NO_EVENTS: EventLogic = { fire: ({ world }) => ({ world, events: [] }) };

/** Files the given reports, and spends a draw doing it, as the real collector does. */
const intelFiling = (reports: readonly Report[]): IntelLogic => ({
  collect: ({ world }) => ({ state: rng.float(world.rng).state, value: reports }),
});

/** Fires the given events and appends them to the feed, which is what the real table does. */
const eventsFiring = (fired: readonly GameEvent[]): EventLogic => ({
  fire: ({ world }) => ({
    world: { ...world, events: [...world.events, ...fired] },
    events: fired,
  }),
});

/**
 * A criminal that has already made its mind up, and does not roll for it - so a test that pins
 * an interaction rule is reading the rule and not the stream. The real chooser draws once per
 * candidate, which the block below pins separately.
 */
const criminalDoing = (chosen: CriminalAction): CriminalAiLogic => ({
  choose: ({ state }) => ({ state, value: chosen }),
});

const STANDS_STILL = criminalDoing({ kind: "wait" });

type StepOptions = {
  readonly rng?: Rng;
  readonly intel?: IntelLogic;
  readonly events?: EventLogic;
  readonly action?: ActionLogic;
  readonly ai?: CriminalAiLogic;
  readonly actions?: readonly HunterAction[];
  readonly balance?: Balance;
};

const stepOnce = (world: WorldState, options: StepOptions = {}): TurnResult =>
  createTurnLogic({
    rng: options.rng ?? rng,
    intel: options.intel ?? NO_INTEL,
    events: options.events ?? NO_EVENTS,
    belief,
    action: options.action ?? action,
    ai: options.ai ?? STANDS_STILL,
    graph,
  }).step({
    world: seal(world),
    actions: options.actions ?? [],
    balance: options.balance ?? BALANCE,
  });

/** Every test below expects a turn to have been taken; the refused queue has its own block. */
const turnOf = (result: TurnResult): TurnTaken => {
  if (result.kind !== "turn") {
    throw new Error(`expected a turn, got ${result.kind}`);
  }
  return result;
};

const worldAfter = (world: WorldState, options: StepOptions = {}): WorldState =>
  unseal(turnOf(stepOnce(world, options)).world);

const rejectionsAfter = (
  world: WorldState,
  options: StepOptions = {},
): readonly PlanningRejection[] => turnOf(stepOnce(world, options)).rejections;

const totalMass = (world: WorldState): number =>
  world.belief.reduce((sum, cell) => sum + cell.mass, 0);

describe("the intel phase", () => {
  it("files what the collector found", () => {
    const report = sightingOf(park, FIRST_TURN, LATE);

    expect(worldAfter(worldAt(), { intel: intelFiling([report]) }).reports).toEqual([report]);
  });

  it("keeps the reports that were already filed", () => {
    const earlier = sightingOf(downtown, FIRST_TURN, LATE);
    const fresh = sightingOf(park, SECOND_TURN, LATE);
    const world = worldAt({ turn: SECOND_TURN, reports: [earlier] });

    expect(worldAfter(world, { intel: intelFiling([fresh]) }).reports).toEqual([earlier, fresh]);
  });

  it("hands the stream on from where the collector left it", () => {
    const world = worldAt();

    expect(worldAfter(world, { intel: intelFiling([]) }).rng).toEqual(rng.float(world.rng).state);
  });

  it("changes nothing in the world but the reports and the stream", () => {
    const world = worldAt();
    // A look that found nobody, filed late: nothing for the heatmap to read this turn and nobody
    // recognised, so what is left is the phase's own work.
    const report = clearanceOf(park, FIRST_TURN, LATE);
    // The collector spends a draw, so the turn it is compared against starts from where it left
    // the stream: anything downstream of the draw is then the same turn twice over.
    const quiet = worldAfter({ ...world, rng: rng.float(world.rng).state });
    const filed = worldAfter(world, { intel: intelFiling([report]) });

    expect(filed).toEqual({ ...quiet, reports: [report] });
  });

  it("does not let a report that has not landed yet move the heatmap", () => {
    const world = worldAt();
    const late = sightingOf(park, FIRST_TURN, LATE);

    expect(worldAfter(world, { intel: intelFiling([late]) }).belief).toEqual(
      worldAfter(world).belief,
    );
  });

  it("lets a report that lands this turn move the heatmap", () => {
    const world = worldAt();
    const now = sightingOf(park, FIRST_TURN, FIRST_TURN);
    const moved = worldAfter(world, { intel: intelFiling([now]) });

    expect(beliefMassAt(moved.belief, park)).toBeGreaterThan(
      beliefMassAt(worldAfter(world).belief, park),
    );
  });

  it("runs before the events phase, so an event can be about a report already filed", () => {
    const report = sightingOf(park, FIRST_TURN, FIRST_TURN);
    let filedWhenFired = -1;
    const watcher: EventLogic = {
      fire: ({ world }) => {
        filedWhenFired = world.reports.length;
        return { world, events: [] };
      },
    };

    stepOnce(worldAt(), { intel: intelFiling([report]), events: watcher });

    expect(filedWhenFired).toBe(1);
  });
});

describe("the events phase", () => {
  it("keeps the feed the table wrote", () => {
    const fired = hurtAt(FIRST_TURN);

    expect(worldAfter(worldAt(), { events: eventsFiring([fired]) }).events).toEqual([fired]);
  });

  it("returns what fired this turn", () => {
    const fired = hurtAt(FIRST_TURN);

    expect(turnOf(stepOnce(worldAt(), { events: eventsFiring([fired]) })).events).toEqual([fired]);
  });

  it("redacts an event that would name a report's nature (architecture rule 4)", () => {
    const report = sightingOf(park, FIRST_TURN, FIRST_TURN);
    const fired = turnOf(stepOnce(worldAt(), { events: eventsFiring([eyewitnessOf(report)]) }));

    expect(fired.events).toEqual([
      { kind: "report_arrived", turn: FIRST_TURN, reportId: report.id },
    ]);
  });

  it("leaves the unredacted feed in the world for the replay to read", () => {
    const report = sightingOf(park, FIRST_TURN, FIRST_TURN);
    const event = eyewitnessOf(report);

    expect(worldAfter(worldAt(), { events: eventsFiring([event]) }).events).toEqual([event]);
  });

  it("changes nothing in the world but the feed and what the feed costs the meters", () => {
    const world = worldAt();
    const fired = { kind: "nightfall", turn: FIRST_TURN } as const;
    const quiet = worldAfter(world);
    const noisy = worldAfter(world, { events: eventsFiring([fired]) });

    expect(noisy).toEqual({ ...quiet, events: [fired] });
  });
});

const ROADBLOCK: HunterAction = { kind: "roadblock", edgeId: makeEdgeId("downtown-park") };
const BRIEFING: HunterAction = { kind: "true_briefing" };
const CANVASS: HunterAction = { kind: "canvass", nodeId: park };
const NOWHERE = makeNodeId("nowhere");
const OFF_THE_MAP: HunterAction = { kind: "canvass", nodeId: NOWHERE };

const ROADBLOCK_BUDGET = BALANCE.actions.roadblock.budgetCost;
const CANVASS_ACTION_POINTS = BALANCE.actions.canvass.actionPointCost;

/**
 * One action of every kind, keyed by kind, so a new `HunterAction` variant is a compile error
 * here until it has a sample - which is what makes the rule-6 block below exhaustive rather than
 * a list somebody has to remember to extend.
 */
const ACTION_SAMPLES: Readonly<Record<HunterActionKind, HunterAction>> = {
  roadblock: ROADBLOCK,
  canvass: CANVASS,
  pull_cctv: { kind: "pull_cctv", nodeId: park },
  true_briefing: BRIEFING,
};

const queueOf = (count: number): readonly HunterAction[] =>
  Array.from({ length: count }, () => BRIEFING);

describe("the planning phase", () => {
  it("spends budget on the actions the hunter can afford", () => {
    const stepped = worldAfter(worldAt(), { actions: [ROADBLOCK, BRIEFING] });

    expect(stepped.hunter.budget).toBe(
      START_BUDGET - ROADBLOCK_BUDGET - BALANCE.actions.trueBriefing.budgetCost,
    );
    expect(stepped.hunter.containments).toHaveLength(1);
    expect(stepped.hunter.briefingTurns).toEqual([FIRST_TURN]);
  });

  it("spends action points until they run out, and refuses what is left", () => {
    const world = worldAt();

    expect(rejectionsAfter(world, { actions: [CANVASS, CANVASS, CANVASS, CANVASS] })).toEqual([
      {
        index: 3,
        reason: {
          kind: "not_enough_action_points",
          required: CANVASS_ACTION_POINTS,
          available: NO_ACTION_POINTS,
        },
      },
    ]);
  });

  it("hands each action the world the ones before it left it in", () => {
    expect(rejectionsAfter(worldAt(), { actions: [ROADBLOCK, ROADBLOCK] })).toEqual([
      { index: 1, reason: { kind: "edge_already_blocked", edgeId: makeEdgeId("downtown-park") } },
    ]);
  });

  it("refuses an action the budget cannot cover, naming both numbers", () => {
    const world = worldAt({ budget: NO_BUDGET });

    expect(rejectionsAfter(world, { actions: [ROADBLOCK] })).toEqual([
      {
        index: 0,
        reason: { kind: "not_enough_budget", required: ROADBLOCK_BUDGET, available: NO_BUDGET },
      },
    ]);
  });

  it("leaves the world exactly as it found it when it refuses", () => {
    const world = worldAt({ actionPoints: NO_ACTION_POINTS });

    expect(worldAfter(world, { actions: [ROADBLOCK, CANVASS, BRIEFING] })).toEqual(
      worldAfter(world),
    );
  });

  it("carries a rejection out of the turn rather than throwing it (PLAN M3.3)", () => {
    const world = worldAt();

    expect(() => stepOnce(world, { actions: [OFF_THE_MAP] })).not.toThrow();
    expect(rejectionsAfter(world, { actions: [OFF_THE_MAP] })).toEqual([
      { index: 0, reason: { kind: "unknown_node", nodeId: NOWHERE } },
    ]);
  });

  it("plays the rest of the queue after a refusal, and says which place failed", () => {
    const result = turnOf(stepOnce(worldAt(), { actions: [ROADBLOCK, OFF_THE_MAP, BRIEFING] }));
    const played = unseal(result.world);

    expect(result.rejections.map((rejection) => rejection.index)).toEqual([1]);
    expect(played.hunter.containments).toHaveLength(1);
    expect(played.hunter.briefingTurns).toEqual([FIRST_TURN]);
  });

  it("has nothing to report when the queue is empty", () => {
    expect(rejectionsAfter(worldAt())).toEqual([]);
  });

  it("returns rejections as plain data (architecture rule 3)", () => {
    const rejections = rejectionsAfter(worldAt({ budget: NO_BUDGET }), { actions: [ROADBLOCK] });

    expect(JSON.parse(JSON.stringify(rejections))).toEqual(rejections);
  });

  it("refuses for reasons that never depend on where the criminal is (rule 4)", () => {
    const actions = [ROADBLOCK, ROADBLOCK, OFF_THE_MAP];
    const here = rejectionsAfter(worldAt({ nodeId: downtown }), { actions });
    const there = rejectionsAfter(worldAt({ nodeId: terminal }), { actions });

    expect(here).not.toEqual([]);
    expect(here).toEqual(there);
  });

  it("runs before consequences, so what an action learned is evidence this turn", () => {
    const landed = sightingOf(park, FIRST_TURN, FIRST_TURN);
    const filing: ActionLogic = {
      validate: () => ({ kind: "allowed", cost: { actionPoints: NO_COST, budget: NO_COST } }),
      apply: ({ world }) => ({
        kind: "applied",
        world: { ...world, reports: [...world.reports, landed] },
      }),
    };

    expect(
      beliefMassAt(worldAfter(worldAt(), { action: filing, actions: [BRIEFING] }).belief, park),
    ).toBeGreaterThan(beliefMassAt(worldAfter(worldAt()).belief, park));
  });
});

describe("planning is a walk over the action table, not a branch (architecture rule 6)", () => {
  for (const [kind, sample] of Object.entries(ACTION_SAMPLES)) {
    it(`spends ${kind} through the table and does nothing else with it`, () => {
      const world = worldAt();
      const direct = action.apply({ world, action: sample, balance: BALANCE });
      if (direct.kind !== "applied") {
        throw new Error(`expected ${kind} to be affordable, got ${direct.reason.kind}`);
      }

      expect(worldAfter(world, { actions: [sample] })).toEqual(worldAfter(direct.world));
      expect(rejectionsAfter(world, { actions: [sample] })).toEqual([]);
    });
  }

  it("never looks at what kind of action it is spending", () => {
    const seen: HunterAction[] = [];
    let validated = 0;
    const recording: ActionLogic = {
      validate: (request) => {
        validated += 1;
        return action.validate(request);
      },
      apply: ({ world, action: queued }) => {
        seen.push(queued);
        return { kind: "applied", world };
      },
    };
    const actions = Object.values(ACTION_SAMPLES);

    stepOnce(worldAt(), { action: recording, actions });

    expect(seen).toEqual(actions);
    expect(validated).toBe(0);
  });
});

describe("the bound on a turn's queue", () => {
  it("takes a queue at the limit", () => {
    expect(stepOnce(worldAt(), { actions: queueOf(LIMITS.maxQueuedActions) }).kind).toBe("turn");
  });

  it("refuses a queue one over the limit, naming both numbers", () => {
    expect(stepOnce(worldAt(), { actions: queueOf(LIMITS.maxQueuedActions + 1) })).toEqual({
      kind: "too_many_actions",
      requestedActions: LIMITS.maxQueuedActions + 1,
      maxActions: LIMITS.maxQueuedActions,
    });
  });

  it("runs no part of the turn it refused", () => {
    let collected = 0;
    let fired = 0;
    const watchingIntel: IntelLogic = {
      collect: ({ world }) => {
        collected += 1;
        return { state: world.rng, value: [] };
      },
    };
    const watchingEvents: EventLogic = {
      fire: ({ world }) => {
        fired += 1;
        return { world, events: [] };
      },
    };

    stepOnce(worldAt(), {
      intel: watchingIntel,
      events: watchingEvents,
      actions: queueOf(LIMITS.maxQueuedActions + 1),
    });

    expect(collected).toBe(0);
    expect(fired).toBe(0);
  });
});

const DOWNTOWN_PARK = makeEdgeId("downtown-park");
const PARK_TERMINAL = makeEdgeId("park-terminal");
const BLOCK_DURATION = BALANCE.actions.roadblock.durationTurns;

const blockOn = (edgeId: EdgeId, placedAt: Turn = FIRST_TURN): Containment => ({
  kind: "roadblock",
  edgeId,
  expiresAt: placedAt + BLOCK_DURATION,
});

const SHORTCUT = makeEdgeId("downtown-park-footpath");

/**
 * The same two districts joined twice, by a road a checkpoint can close and a footpath it cannot,
 * which is the shape `balance.edges` guarantees (DESIGN.md: a checkpoint must never seal the
 * city). On foot the path is the cheaper of the two, so it is the one a move between them takes,
 * and the closed road is how a test can tell which one that was.
 */
const cityWith = (edges: readonly MapEdge[]): MapGraph => ({ ...city, edges });

const pathFirst = cityWith([makeEdge("footpath", SHORTCUT, downtown, park), ...city.edges]);
const roadFirst = cityWith([...city.edges, makeEdge("footpath", SHORTCUT, downtown, park)]);

/** The one move the three-node city offers a criminal standing at the scene of the incident. */
const TO_PARK: CriminalAction = { kind: "move", toNodeId: park, travelMode: "foot" };
const ON_FOOT_TO_PARK = criminalDoing(TO_PARK);

describe("the resolution phase", () => {
  it("takes the criminal where its own chooser decided to go", () => {
    const stepped = worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.nodeId).toBe(park);
  });

  it("leaves a criminal that chose to stay exactly where it was", () => {
    const stepped = worldAfter(worldAt({ nodeId: park }));

    expect(stepped.criminal.nodeId).toBe(park);
  });

  it("stops a criminal that walks into a standing checkpoint", () => {
    const world = worldAt({ containments: [blockOn(DOWNTOWN_PARK)] });

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).criminal.nodeId).toBe(downtown);
  });

  it("teaches the criminal the checkpoint it just ran into", () => {
    const world = worldAt({ containments: [blockOn(DOWNTOWN_PARK)] });
    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([DOWNTOWN_PARK]);
  });

  it("teaches it nothing about the checkpoints it never met", () => {
    const world = worldAt({ containments: [blockOn(PARK_TERMINAL)] });
    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([]);
  });

  it("judges the move by the edge it took, not by where it ended up", () => {
    const world = worldAt({ containments: [blockOn(PARK_TERMINAL)] });

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).criminal.nodeId).toBe(park);
  });

  it("is stopped by a checkpoint on the last turn it stands", () => {
    const lastTurn: Containment = {
      kind: "roadblock",
      edgeId: DOWNTOWN_PARK,
      expiresAt: FIRST_TURN + 1,
    };
    const world = worldAt({ containments: [lastTurn] });

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).criminal.nodeId).toBe(downtown);
  });

  it("lets it through a checkpoint that has expired", () => {
    const lifted: Containment = { kind: "roadblock", edgeId: DOWNTOWN_PARK, expiresAt: FIRST_TURN };
    const world = worldAt({ containments: [lifted] });

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).criminal.nodeId).toBe(park);
  });

  it("never proposes crossing a block it already knows about (PLAN M3.5's seam)", () => {
    const world = worldAt({
      criminal: { knowledge: { knownRoadblockEdgeIds: [DOWNTOWN_PARK], heardBriefingTurns: [] } },
      containments: [blockOn(DOWNTOWN_PARK)],
    });

    const stepped = worldAfter(world, { ai });

    expect(stepped.criminal.nodeId).toBe(downtown);
    expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([DOWNTOWN_PARK]);
  });

  it("takes the cheapest of two ways to the same place, listed cheapest first", () => {
    const world = worldAt({ map: pathFirst, containments: [blockOn(DOWNTOWN_PARK)] });
    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.nodeId).toBe(park);
    expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([]);
  });

  it("takes the cheapest of two ways to the same place, listed cheapest last", () => {
    const world = worldAt({ map: roadFirst, containments: [blockOn(DOWNTOWN_PARK)] });
    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.nodeId).toBe(park);
    expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([]);
  });

  it("leaves a criminal that could not have taken that step where it stood", () => {
    const impossible = criminalDoing({ kind: "move", toNodeId: terminal, travelMode: "foot" });

    expect(worldAfter(worldAt(), { ai: impossible }).criminal.nodeId).toBe(downtown);
  });

  it("records the turn just spent at the front of the trail", () => {
    const stepped = worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK });

    expect(stepped.criminal.trail).toEqual([downtown]);
    expect(stepped.criminal.nodeId).toBe(park);
  });

  it("records a turn the criminal spent standing still", () => {
    const stepped = worldAfter(worldAt({ nodeId: park, criminal: { trail: [downtown] } }));

    expect(stepped.criminal.trail).toEqual([park, downtown]);
  });

  it("never lets the trail past LIMITS.maxCriminalTrail", () => {
    const full = Array.from({ length: LIMITS.maxCriminalTrail }, () => park);
    const stepped = worldAfter(worldAt({ criminal: { trail: full } }));

    expect(stepped.criminal.trail).toHaveLength(LIMITS.maxCriminalTrail);
  });

  it("hands the stream on from where the criminal's own chooser left it", () => {
    const world = worldAt();
    const decided = ai.choose({
      situation: { map: world.map, clock: world.clock, criminal: world.criminal },
      balance: BALANCE,
      state: world.rng,
    });

    expect(worldAfter(world, { ai }).rng).toEqual(decided.state);
  });
});

const SLIP_CHANCE = BALANCE.actions.roadblock.slipPastChance;

/** Narrower than any gap these tests need either side of the knob. */
const A_HAIR = 0.000_001;

/**
 * A stream whose next number is the one a test named, advancing exactly as the real one does.
 * Only the turn loop's own draw reads it - intel, the event table and the criminal's chooser each
 * hold an `rng` of their own - so it decides which way an interception went and nothing else.
 */
const drawing = (value: number): Rng => ({
  ...rng,
  float: (state) => ({ state: rng.float(state).state, value }),
});

/** Either side of the knob, so the pair is also where the comparison itself is pinned. */
const SLIPS_PAST = drawing(SLIP_CHANCE - A_HAIR);
const TAKES_THEM = drawing(SLIP_CHANCE);

const withSlipChance = (chance: number): Balance => ({
  ...BALANCE,
  actions: {
    ...BALANCE.actions,
    roadblock: { ...BALANCE.actions.roadblock, slipPastChance: chance },
  },
});

const CERTAIN_CAPTURE = withSlipChance(0);
const CERTAIN_SLIP = withSlipChance(1);

/**
 * PLAN M3.11: the MVP's only capture. A criminal that walks into a checkpoint nobody told it about
 * is taken or gets through, and a block it already knows about never comes to a draw at all.
 */
describe("a checkpoint the criminal did not know about", () => {
  const walkedInto = (): WorldState => worldAt({ containments: [blockOn(DOWNTOWN_PARK)] });

  it("takes the criminal when the draw goes the hunter's way", () => {
    const stepped = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, rng: TAKES_THEM });

    expect(stepped.criminal.inCustody).toBe(true);
    expect(stepped.outcome).toEqual({ kind: "captured", turn: ONE_TURN });
  });

  it("leaves it at large when the draw goes the criminal's way", () => {
    const stepped = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, rng: SLIPS_PAST });

    expect(stepped.criminal.inCustody).toBe(false);
    expect(stepped.outcome).toEqual({ kind: "in_progress" });
  });

  it("stops the move and teaches it the checkpoint either way", () => {
    for (const drawn of [TAKES_THEM, SLIPS_PAST]) {
      const stepped = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, rng: drawn });

      expect(stepped.criminal.nodeId).toBe(downtown);
      expect(stepped.criminal.knowledge.knownRoadblockEdgeIds).toEqual([DOWNTOWN_PARK]);
    }
  });

  /** The chance is the balance the turn was played under, which is what lets PLAN M4.3 sweep it. */
  it("reads the chance off the balance it was handed", () => {
    const taken = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, balance: CERTAIN_CAPTURE });
    const through = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, balance: CERTAIN_SLIP });

    expect(taken.criminal.inCustody).toBe(true);
    expect(through.criminal.inCustody).toBe(false);
  });

  /**
   * Against a chooser that spends nothing, the stream after the turn is the whole record of what
   * the collision cost: one number, so a second draw or a draw taken before the branch would both
   * read differently here.
   */
  it("draws exactly once for the collision", () => {
    const world = walkedInto();

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).rng).toEqual(rng.float(world.rng).state);
  });

  it("draws nothing at all on a turn nobody hit anything", () => {
    const world = worldAt();

    expect(worldAfter(world, { ai: ON_FOOT_TO_PARK }).rng).toEqual(world.rng);
  });

  /**
   * The whole mechanic (PLAN M3.11): a known block is out of the graph the AI searches, so the
   * criminal never proposes crossing it and the draw is never reached. Run against the real
   * chooser with a stream that would take the criminal every time, so what keeps it at large is
   * the routing and not the luck.
   */
  it("can never take a criminal that already knew the block was there", () => {
    const world = worldAt({
      criminal: { knowledge: { knownRoadblockEdgeIds: [DOWNTOWN_PARK], heardBriefingTurns: [] } },
      containments: [blockOn(DOWNTOWN_PARK)],
    });

    const stepped = worldAfter(world, { ai, balance: CERTAIN_CAPTURE });

    expect(stepped.criminal.inCustody).toBe(false);
    expect(stepped.outcome).toEqual({ kind: "in_progress" });
  });

  it("takes nobody at a checkpoint that has expired", () => {
    const lifted: Containment = { kind: "roadblock", edgeId: DOWNTOWN_PARK, expiresAt: FIRST_TURN };
    const world = worldAt({ containments: [lifted] });

    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK, balance: CERTAIN_CAPTURE });

    expect(stepped.criminal.inCustody).toBe(false);
    expect(stepped.criminal.nodeId).toBe(park);
  });

  it("takes nobody on a route that went nowhere near a checkpoint", () => {
    const world = worldAt({ containments: [blockOn(PARK_TERMINAL)] });

    const stepped = worldAfter(world, { ai: ON_FOOT_TO_PARK, balance: CERTAIN_CAPTURE });

    expect(stepped.criminal.inCustody).toBe(false);
    expect(stepped.criminal.nodeId).toBe(park);
  });

  it("refuses another turn once the criminal is in custody", () => {
    const taken = worldAfter(walkedInto(), { ai: ON_FOOT_TO_PARK, rng: TAKES_THEM });

    expect(stepOnce(taken)).toEqual({ kind: "hunt_over", outcome: taken.outcome });
  });
});

describe("resolution is simultaneous, not a running order", () => {
  it("shows the criminal the world as the phase found it, not one it has already changed", () => {
    const seen: CriminalSituation[] = [];
    const watching: CriminalAiLogic = {
      choose: (request) => {
        seen.push(request.situation);
        return ai.choose(request);
      },
    };
    const world = worldAt({
      criminal: {
        trail: [park],
        knowledge: { knownRoadblockEdgeIds: [PARK_TERMINAL], heardBriefingTurns: [FIRST_TURN] },
      },
    });

    worldAfter(world, { ai: watching, actions: [ROADBLOCK] });

    expect(seen).toEqual([{ map: world.map, clock: world.clock, criminal: world.criminal }]);
  });

  it("resolves a block and a move on one edge the same way whichever side is read first", () => {
    // The hunter's side read first is a block already standing; the criminal's side read first is
    // a block the queue places in the same turn the criminal moves onto that edge. One snapshot
    // means one answer.
    const placedThisTurn = worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK, actions: [ROADBLOCK] });
    const standingAlready = worldAfter(worldAt({ containments: [blockOn(DOWNTOWN_PARK)] }), {
      ai: ON_FOOT_TO_PARK,
    });

    expect(placedThisTurn.criminal).toEqual(standingAlready.criminal);
    expect(placedThisTurn.criminal.nodeId).toBe(downtown);
  });

  it("resolves the same way wherever the block sits in the hunter's queue", () => {
    const first = worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK, actions: [ROADBLOCK, CANVASS] });
    const last = worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK, actions: [CANVASS, ROADBLOCK] });

    expect(first.criminal).toEqual(last.criminal);
  });

  it("settles the criminal's position before the meters read what it did", () => {
    const world = worldAt({ containments: [blockOn(DOWNTOWN_PARK)] });
    const stopped = worldAfter(world, { ai: ON_FOOT_TO_PARK });

    expect(stopped.criminal.nodeId).toBe(downtown);
    expect(stopped.criminal.stamina).toBe(START_STAMINA - BALANCE.criminal.staminaPerMove);
  });
});

describe("the consequences phase", () => {
  it("advances the clock by one turn", () => {
    const stepped = worldAfter(worldAt({ turn: SECOND_TURN }));

    expect(stepped.clock).toEqual(makeClock(config.startHour, SECOND_TURN + 1));
  });

  it("raises political pressure every turn", () => {
    expect(worldAfter(worldAt()).hunter.pressure).toBe(START_PRESSURE + PRESSURE_PER_TURN);
  });

  it("jumps political pressure when a civilian is hurt", () => {
    const stepped = worldAfter(worldAt(), { events: eventsFiring([hurtAt(FIRST_TURN)]) });

    expect(stepped.hunter.pressure).toBe(
      START_PRESSURE + PRESSURE_PER_TURN + PRESSURE_PER_CASUALTY,
    );
  });

  it("counts every casualty of the same turn", () => {
    const events = eventsFiring([hurtAt(FIRST_TURN), hurtAt(FIRST_TURN)]);

    expect(worldAfter(worldAt(), { events }).hunter.pressure).toBe(
      START_PRESSURE + PRESSURE_PER_TURN + PRESSURE_PER_CASUALTY * 2,
    );
  });

  it("never lets pressure past its ceiling", () => {
    const events = eventsFiring([hurtAt(FIRST_TURN)]);
    const stepped = worldAfter(worldAt({ pressure: PRESSURE_CEILING }), { events });

    expect(stepped.hunter.pressure).toBe(PRESSURE_CEILING);
  });

  it("never lets pressure below its floor", () => {
    const stepped = worldAfter(worldAt({ pressure: UNDERWATER_PRESSURE }));

    expect(stepped.hunter.pressure).toBe(PRESSURE_FLOOR);
  });

  it("gives the hunter their action points back", () => {
    const stepped = worldAfter(worldAt({ actionPoints: NO_ACTION_POINTS }));

    expect(stepped.hunter.actionPoints).toBe(BALANCE.hunter.actionPointsPerTurn);
  });

  it("leaves trust, budget and containment to the actions that pay for them", () => {
    const world = worldAt();
    const stepped = worldAfter(world);

    expect(stepped.hunter.trust).toBe(world.hunter.trust);
    expect(stepped.hunter.budget).toBe(world.hunter.budget);
    expect(stepped.hunter.containments).toEqual(world.hunter.containments);
    expect(stepped.hunter.briefingTurns).toEqual(world.hunter.briefingTurns);
  });

  it("cools the criminal's heat every turn nobody recognised it", () => {
    expect(worldAfter(worldAt()).criminal.heat).toBe(START_HEAT - HEAT_DECAY);
  });

  it("raises heat for every report that recognised the criminal this turn", () => {
    const seen = [sightingOf(park, FIRST_TURN, LATE), sightingOf(downtown, FIRST_TURN, FIRST_TURN)];
    const stepped = worldAfter(worldAt(), { intel: intelFiling(seen) });

    expect(stepped.criminal.heat).toBe(START_HEAT - HEAT_DECAY + HEAT_PER_SIGHTING * seen.length);
  });

  it("counts a sighting on the turn it was seen, not the turn the hunter reads it", () => {
    // The older report lands this turn and was seen two turns ago; the fresh one is the other way
    // round. Heat is what the city noticed, so only the fresh one counts.
    const older = sightingOf(park, FIRST_TURN, LATE);
    const fresh = sightingOf(park, SECOND_TURN, LATE);
    const world = worldAt({ turn: SECOND_TURN, reports: [older] });

    expect(worldAfter(world, { intel: intelFiling([fresh]) }).criminal.heat).toBe(
      START_HEAT - HEAT_DECAY + HEAT_PER_SIGHTING,
    );
  });

  it("does not raise heat for a witness who named the wrong place, or for nobody at all", () => {
    const mistaken = mistakenOf(park, FIRST_TURN);
    const nothing = clearanceOf(park, FIRST_TURN);

    expect(worldAfter(worldAt(), { intel: intelFiling([mistaken, nothing]) }).criminal.heat).toBe(
      START_HEAT - HEAT_DECAY,
    );
  });

  it("never cools heat below nothing", () => {
    expect(worldAfter(worldAt({ criminal: { heat: CALM } })).criminal.heat).toBe(CALM);
  });

  it("never raises heat past its ceiling", () => {
    const world = worldAt({ criminal: { heat: BALANCE.criminal.heatMax } });
    const seen = sightingOf(downtown, FIRST_TURN, FIRST_TURN);

    expect(worldAfter(world, { intel: intelFiling([seen]) }).criminal.heat).toBe(
      BALANCE.criminal.heatMax,
    );
  });

  it("spends the criminal's stamina on the turns it travels", () => {
    expect(worldAfter(worldAt(), { ai: ON_FOOT_TO_PARK }).criminal.stamina).toBe(
      START_STAMINA - BALANCE.criminal.staminaPerMove,
    );
  });

  it("buys stamina back on the turns it rests, and never past full", () => {
    const tired = worldAt({ criminal: { stamina: NO_STAMINA } });
    const resting = criminalDoing({ kind: "rest" });

    expect(worldAfter(tired, { ai: resting }).criminal.stamina).toBe(
      BALANCE.criminal.staminaPerRest,
    );
    expect(worldAfter(worldAt(), { ai: resting }).criminal.stamina).toBe(
      BALANCE.criminal.staminaMax,
    );
  });

  it("charges nothing to the legs for a turn spent hiding or waiting", () => {
    const hiding = criminalDoing({ kind: "hide" });

    expect(worldAfter(worldAt(), { ai: hiding }).criminal.stamina).toBe(START_STAMINA);
    expect(worldAfter(worldAt()).criminal.stamina).toBe(START_STAMINA);
  });

  it("makes the criminal more desperate every turn, up to its ceiling", () => {
    expect(worldAfter(worldAt()).criminal.desperation).toBe(CALM + DESPERATION_PER_TURN);

    const spent = worldAt({ criminal: { desperation: BALANCE.criminal.desperationMax } });
    expect(worldAfter(spent).criminal.desperation).toBe(BALANCE.criminal.desperationMax);
  });

  it("leaves the criminal's cash and profile to the actions that would spend them", () => {
    const world = worldAt();
    const stepped = worldAfter(world);

    expect(stepped.criminal.cash).toBe(world.criminal.cash);
    expect(stepped.criminal.profile).toBe(world.criminal.profile);
  });

  it("spreads the heatmap once per turn", () => {
    const world = worldAt();

    expect(worldAfter(world).belief).toEqual(
      belief.advance({
        belief: world.belief,
        evidence: {
          graph: city,
          blockedEdgeIds: new Set(),
          sightings: [],
          clearances: [],
        },
        balance: BALANCE,
      }),
    );
  });

  it("infers from the hunter's view alone, so the criminal's position cannot leak in", () => {
    const report = sightingOf(park, FIRST_TURN, FIRST_TURN);
    const here = worldAfter(worldAt({ nodeId: downtown }), { intel: intelFiling([report]) });
    const there = worldAfter(worldAt({ nodeId: terminal }), { intel: intelFiling([report]) });

    expect(here.belief).toEqual(there.belief);
  });
});

describe("a turn with nothing in it", () => {
  it("is the clock and the meters that always move, and nothing else", () => {
    const world = worldAt({ actionPoints: NO_ACTION_POINTS });
    const stepped = worldAfter(world);

    expect(stepped).toEqual({
      ...world,
      clock: makeClock(config.startHour, FIRST_TURN + 1),
      hunter: {
        ...world.hunter,
        actionPoints: START_ACTION_POINTS,
        pressure: START_PRESSURE + PRESSURE_PER_TURN,
      },
      // A turn the criminal spent standing still still costs it one: a turn nearer the end of its
      // nerve, a turn further from being recognised, and a turn of the trail.
      criminal: {
        ...world.criminal,
        trail: [world.criminal.nodeId],
        heat: START_HEAT - HEAT_DECAY,
        desperation: CALM + DESPERATION_PER_TURN,
      },
      belief: stepped.belief,
    });
    expect(stepped.reports).toEqual([]);
    expect(stepped.events).toEqual([]);
    expect(stepped.casualties).toBe(0);
    expect(stepped.outcome).toEqual({ kind: "in_progress" });
  });

  it("returns no events to show for it", () => {
    expect(turnOf(stepOnce(worldAt())).events).toEqual([]);
  });

  it("touches the stream for the criminal's decision and nothing else", () => {
    const world = worldAt();

    expect(worldAfter(world).rng).toEqual(world.rng);
    expect(worldAfter(world, { ai }).rng).not.toEqual(world.rng);
  });
});

const TO_TERMINAL: CriminalAction = { kind: "move", toNodeId: terminal, travelMode: "foot" };
const ROADBLOCK_TRUST = BALANCE.actions.roadblock.trustCost;
const NO_TRUST = BALANCE.endConditions.trustCollapseAt;
const CASUALTIES_TO_LOSE = BALANCE.endConditions.casualtiesToLose;
const ONE_TURN: Turn = 1;

/** A criminal whose profile is certain to hurt somebody, so the real table fires every turn. */
const withCertainHarm = (): Balance => ({
  ...BALANCE,
  criminal: {
    ...BALANCE.criminal,
    profiles: {
      ...BALANCE.criminal.profiles,
      amateur: { ...BALANCE.criminal.profiles.amateur, civilianHarmChance: 1 },
    },
  },
});

const repeatedly = (world: WorldState, times: number, options: StepOptions = {}): WorldState => {
  let played = world;
  for (let taken = 0; taken < times; taken += 1) {
    played = worldAfter(played, options);
  }
  return played;
};

describe("the turn that ends the hunt", () => {
  it("leaves a hunt nothing has finished in progress", () => {
    expect(worldAfter(worldAt()).outcome).toEqual({ kind: "in_progress" });
  });

  it("ends the hunt when the criminal walks onto an exit", () => {
    const world = worldAt({ nodeId: park });
    const stepped = worldAfter(world, { ai: criminalDoing(TO_TERMINAL) });

    expect(stepped.criminal.nodeId).toBe(terminal);
    expect(stepped.outcome).toEqual({ kind: "escaped", turn: ONE_TURN });
  });

  it("does not end it for a criminal one node short of the exit", () => {
    const stepped = worldAfter(worldAt(), { ai: criminalDoing(TO_PARK) });

    expect(stepped.outcome).toEqual({ kind: "in_progress" });
  });

  it("ends the hunt when an action spends the last of the public's trust", () => {
    const stepped = worldAfter(worldAt({ trust: ROADBLOCK_TRUST }), { actions: [ROADBLOCK] });

    expect(stepped.hunter.trust).toBe(NO_TRUST);
    expect(stepped.outcome).toEqual({ kind: "trust_collapsed", turn: ONE_TURN });
  });

  it("leaves a hunter with a point of trust left on the case", () => {
    const stepped = worldAfter(worldAt({ trust: ROADBLOCK_TRUST + 1 }), { actions: [ROADBLOCK] });

    expect(stepped.outcome).toEqual({ kind: "in_progress" });
  });

  /**
   * Through the real event table rather than a fake, so what reaches the threshold is the same
   * `civilian_hurt` apply the hunt uses; only the profile's chance of it is turned up.
   */
  it("ends the hunt when the casualties the events did reach the threshold", () => {
    const harmful = { events: createEventLogic({ rng }), balance: withCertainHarm() };
    const played = repeatedly(worldAt(), CASUALTIES_TO_LOSE, harmful);

    expect(played.casualties).toBe(CASUALTIES_TO_LOSE);
    expect(played.outcome).toEqual({ kind: "casualties_exceeded", turn: CASUALTIES_TO_LOSE });
  });

  it("leaves the hunt running one casualty short of the threshold", () => {
    const harmful = { events: createEventLogic({ rng }), balance: withCertainHarm() };
    const played = repeatedly(worldAt(), CASUALTIES_TO_LOSE - 1, harmful);

    expect(played.casualties).toBe(CASUALTIES_TO_LOSE - 1);
    expect(played.outcome).toEqual({ kind: "in_progress" });
  });

  it("names the escape when the criminal reaches an exit on the turn a bystander is hurt", () => {
    const world = worldAt({ nodeId: park, casualties: CASUALTIES_TO_LOSE - 1 });
    const stepped = worldAfter(world, {
      events: createEventLogic({ rng }),
      balance: withCertainHarm(),
      ai: criminalDoing(TO_TERMINAL),
    });

    expect(stepped.casualties).toBe(CASUALTIES_TO_LOSE);
    expect(stepped.outcome).toEqual({ kind: "escaped", turn: ONE_TURN });
  });
});

describe("a hunt that is already over", () => {
  const finished = (): WorldState =>
    worldAfter(worldAt({ trust: ROADBLOCK_TRUST }), { actions: [ROADBLOCK] });

  it("refuses the turn and says how the hunt ended", () => {
    expect(stepOnce(finished())).toEqual({
      kind: "hunt_over",
      outcome: { kind: "trust_collapsed", turn: ONE_TURN },
    });
  });

  /** No phase runs at all: an ended hunt that still filed reports would still be being played. */
  it("runs no phase: no report, no event, no criminal decision, no clock", () => {
    const over = finished();
    const watcher = eventsFiring([hurtAt(ONE_TURN)]);
    const filing = intelFiling([sightingOf(park, ONE_TURN, FIRST_TURN)]);

    expect(stepOnce(over, { intel: filing, events: watcher, ai })).toEqual({
      kind: "hunt_over",
      outcome: over.outcome,
    });
  });

  it("is a fixed point: the same refusal however many times it is asked", () => {
    const over = seal(finished());
    const once = createTurnLogic({
      rng,
      intel: NO_INTEL,
      events: NO_EVENTS,
      belief,
      action,
      ai: STANDS_STILL,
      graph,
    });

    const first = once.step({ world: over, actions: [], balance: BALANCE });
    const tenth = once.step({ world: over, actions: [], balance: BALANCE });

    expect(JSON.stringify(first)).toBe(JSON.stringify(tenth));
  });

  /** The queue is a bound on the request, so it is refused whether or not the hunt is running. */
  it("still refuses an over-long queue first", () => {
    const queue = Array.from({ length: LIMITS.maxQueuedActions + 1 }, () => BRIEFING);

    expect(stepOnce(finished(), { actions: queue })).toMatchObject({ kind: "too_many_actions" });
  });
});

const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});
const game = createGameLogic({ rng, generation });
const turn = createTurnLogic({
  rng,
  intel: createIntelLogic({ rng, graph }),
  events: createEventLogic({ rng }),
  belief,
  action,
  ai,
  graph,
});

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

/** Hard-coded rather than drawn, so a failure names the hunt that failed (PLAN M3.6's rule). */
const ESCAPE_SEEDS: readonly number[] = [1, 2, 3, 7, 11, 101, 4242];

/**
 * A deadline no criminal can beat, which is what makes the clock the only thing that can end the
 * hunts below. Generation refuses a map whose start is adjacent to an exit (DESIGN.md "Generation
 * validity"), so one turn is provably too few; measured, the quickest escape across
 * `ESCAPE_SEEDS` is turn 4, and the quickest over a 2000-seed sweep is turn 3.
 */
const SHORT_DEADLINE = 2;
const SHORT_SETUP: GameSetup = { ...SETUP, maxTurns: SHORT_DEADLINE };

const startedAt = (seed: number, setup: GameSetup = SETUP): WorldState => {
  const result = game.create({ setup, seed, balance: BALANCE });
  if (result.kind !== "game") {
    throw new Error(`expected a game, got ${result.kind}`);
  }
  return unseal(result.world);
};

/** A hunt and how long it lasted. The count is what `turns` means once a hunt can end early. */
type Played = {
  readonly world: WorldState;
  readonly turns: number;
};

/**
 * Plays up to `limit` turns, and stops when the hunt is over - which is what `step` starts saying
 * once an end condition has fired (PLAN M3.8c). A passive hunter loses every seed in a handful of
 * turns, so `limit` is an upper bound here and rarely the number reached.
 */
const playThrough = (
  seed: number,
  limit: number,
  actions: readonly HunterAction[] = [],
  setup: GameSetup = SETUP,
): Played => {
  let world = seal(startedAt(seed, setup));
  for (let taken = 0; taken < limit; taken += 1) {
    const result = turn.step({ world, actions, balance: BALANCE });
    if (result.kind === "hunt_over") {
      return { world: unseal(world), turns: taken };
    }
    world = turnOf(result).world;
  }
  return { world: unseal(world), turns: limit };
};

const play = (seed: number, turns: number, actions: readonly HunterAction[] = []): WorldState =>
  playThrough(seed, turns, actions).world;

/**
 * A hunter that knows exactly where the criminal is standing and closes the roads out of it. No
 * real hunter can do this and no `HunterView` would let one try (architecture rule 4); it is the
 * shortest way to drive a whole generated hunt into the capture, and what the tests under it pin
 * is that the ending is reachable in play, not that anybody could play this well.
 */
const blockadeAround = (world: WorldState): readonly HunterAction[] => {
  const standing = blockedEdgeIdsAt(world.hunter.containments, world.clock.turn);
  return world.map.edges
    .filter((edge) => edge.from === world.criminal.nodeId || edge.to === world.criminal.nodeId)
    .filter((edge) => BALANCE.edges[edge.kind].blockable && !standing.has(edge.id))
    .slice(0, BALANCE.hunter.actionPointsPerTurn)
    .map((edge) => ({ kind: "roadblock", edgeId: edge.id }));
};

/**
 * Two of `ESCAPE_SEEDS`, named apart because closing the corridor ends them differently and both
 * endings are worth a test of their own (PLAN M4.3). Neither was searched for: `TAKEN_SEED` is the
 * first entry in the list and `CONTAINED_SEED` is the seed the rest of this file already runs.
 */
const TAKEN_SEED = 1;
const CONTAINED_SEED = SEED;

/**
 * Half of the seeds, rounded up. It is the floor `packages/sim/src/balance.slow.test.ts` asserts
 * over 400 hunts - a hunter working the criminal's route takes at least half of them - applied to
 * the seven named here, and the blockader below is better informed than the bot that floor was
 * measured on. Not seven of seven: see the test that uses it.
 */
const TAKEN_AT_LEAST = Math.ceil(ESCAPE_SEEDS.length / 2);

/** `playThrough`, with a queue rebuilt each turn from where the criminal has got to. */
const playBlockading = (seed: number, limit: number): Played => {
  let world = seal(startedAt(seed));
  for (let taken = 0; taken < limit; taken += 1) {
    const result = turn.step({
      world,
      actions: blockadeAround(unseal(world)),
      balance: BALANCE,
    });
    if (result.kind === "hunt_over") {
      return { world: unseal(world), turns: taken };
    }
    world = turnOf(result).world;
  }
  return { world: unseal(world), turns: limit };
};

describe("a hunt wired the way the app wires it", () => {
  it("draws the same turn twice from the same world", () => {
    const world = seal(startedAt(SEED));
    const once = turn.step({ world, actions: [], balance: BALANCE });
    const twice = turn.step({ world, actions: [], balance: BALANCE });

    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("plays the same hunt twice from the same seed (architecture rule 2)", () => {
    expect(JSON.stringify(play(SEED, MAX_TURNS))).toBe(JSON.stringify(play(SEED, MAX_TURNS)));
  });

  it("plays the same hunt twice from the same seed and the same queue", () => {
    const queued: readonly HunterAction[] = [{ kind: "true_briefing" }, { kind: "true_briefing" }];

    expect(JSON.stringify(play(SEED, MAX_TURNS, queued))).toBe(
      JSON.stringify(play(SEED, MAX_TURNS, queued)),
    );
  });

  it("spends a queue it can afford on a generated map", () => {
    const queued: readonly HunterAction[] = [{ kind: "true_briefing" }];
    const played = play(SEED, LATE, queued);

    expect(played.hunter.briefingTurns).toEqual([FIRST_TURN, SECOND_TURN]);
  });

  it("leaves the world it was given alone", () => {
    const world = startedAt(SEED);
    const before = JSON.stringify(world);

    turn.step({ world: seal(world), actions: [], balance: BALANCE });

    expect(JSON.stringify(world)).toBe(before);
  });

  it("returns a world that round-trips through JSON (architecture rule 3)", () => {
    const played = play(SEED, MAX_TURNS);

    expect(JSON.parse(JSON.stringify(played))).toEqual(played);
  });

  it("keeps the clock and the turn count in step", () => {
    const played = playThrough(SEED, MAX_TURNS);

    expect(played.world.clock).toEqual(makeClock(played.world.config.startHour, played.turns));
  });

  /**
   * Pressure climbing to its ceiling took 30 quiet turns, which no real hunt lasts now that the
   * criminal reaching an exit ends it (PLAN M3.8c). The ceiling itself is pinned on a hand-built
   * world above; what a real hunt can still show is that every quiet turn charges for itself.
   */
  it("charges the hunter for every quiet turn it takes", () => {
    const played = playThrough(SEED, MAX_TURNS);

    expect(played.world.hunter.pressure).toBe(START_PRESSURE + PRESSURE_PER_TURN * played.turns);
  });

  /**
   * The AC's "a test that reaches it" for escape, through a whole hunt on a generated map rather
   * than a hand-built one: an amateur walks out in a handful of turns unless something stops it,
   * and in the MVP nothing does (PLAN Inbox, the reachable-capture entry).
   */
  it("ends a hunt the hunter does nothing about, by the exit", () => {
    const played = playThrough(SEED, MAX_TURNS);

    expect(played.world.outcome).toEqual({ kind: "escaped", turn: played.turns });
    expect(played.world.map.exits.map((exit) => exit.nodeId)).toContain(
      played.world.criminal.nodeId,
    );
  });

  /**
   * The AC's "a test that reaches it" for the capture, through a whole hunt on a generated map
   * (PLAN M3.11): the MVP's only win, and the only ending that needs the hunter to have played.
   */
  it("ends a hunt the hunter works the checkpoints in, with the criminal taken", () => {
    const played = playBlockading(TAKEN_SEED, MAX_TURNS);

    expect(played.world.outcome).toEqual({ kind: "captured", turn: played.turns });
    expect(played.world.criminal.inCustody).toBe(true);
  });

  /**
   * The other thing closing the corridor does, and the reason the test above names one seed rather
   * than running the list (PLAN M4.3). A hunter who has the criminal surrounded is not owed the
   * capture: the checkpoint is a draw per surprise, so a hunt can be one the criminal never gets
   * out of and still one the clock ends. This is the stalemate `outcomeBase.timed_out` prices,
   * reached by a hunter who played rather than by running a two-turn deadline out.
   */
  it("holds a criminal it cannot take until the deadline runs out", () => {
    const played = playBlockading(CONTAINED_SEED, MAX_TURNS);

    expect(played.turns).toBe(MAX_TURNS);
    expect(played.world.outcome).toEqual({ kind: "timed_out", turn: MAX_TURNS });
    expect(played.world.criminal.inCustody).toBe(false);
    expect(played.world.map.exits.map((exit) => exit.nodeId)).not.toContain(
      played.world.criminal.nodeId,
    );
  });

  /**
   * What closing the roads is worth over every seed a passive hunter loses by the exit. Two claims,
   * and deliberately not a third. **No criminal walks out past a closed corridor**, which held on
   * all seven at every slip chance measured from 0 to 0.9, and over 200 seeds costs the blockader
   * one escape whatever the knob is set to. **At least half are taken**, which is the balance's own
   * floor (`TAKEN_AT_LEAST`).
   *
   * It is *not* seven captures out of seven, and it was not a claim at the old 0.6 either: an
   * omniscient blockader takes 83% of 200 seeds at 0.6 and 69% at the shipped 0.7, so seven for
   * seven was these seven hunts agreeing at one setting, not something the balance promised (PLAN
   * M4.3). The seed that stopped agreeing did not let the criminal go - it is `CONTAINED_SEED`
   * above, held for the full deadline, and it has a test of its own rather than a band to hide in.
   */
  it("stops the escape on every seed the passive hunter loses, and takes most of them", () => {
    const outcomes = ESCAPE_SEEDS.map((seed) => playBlockading(seed, MAX_TURNS).world.outcome);
    const taken = outcomes.filter((outcome) => outcome.kind === "captured");

    for (const outcome of outcomes) {
      expect(outcome.kind).not.toBe("escaped");
    }
    expect(taken.length).toBeGreaterThanOrEqual(TAKEN_AT_LEAST);
  });

  it("plays the same blockaded hunt twice from the same seed", () => {
    expect(JSON.stringify(playBlockading(SEED, MAX_TURNS))).toBe(
      JSON.stringify(playBlockading(SEED, MAX_TURNS)),
    );
  });

  it("ends every hunt it is given, well inside the deadline", () => {
    for (const seed of ESCAPE_SEEDS) {
      const played = playThrough(seed, MAX_TURNS);

      expect(played.world.outcome).toMatchObject({ kind: "escaped" });
      expect(played.turns).toBeLessThan(MAX_TURNS);
    }
  });

  /**
   * The AC's "a test that reaches it" for the deadline, through a whole hunt on a generated map
   * rather than a hand-built one (PLAN M4.2a). Nothing else can end these hunts: the criminal
   * cannot reach an exit in two turns, a passive hunter spends no trust, and two turns cannot
   * reach the casualty threshold.
   */
  it("ends a hunt whose deadline runs out with the criminal still loose", () => {
    const played = playThrough(SEED, MAX_TURNS, [], SHORT_SETUP);

    expect(played.turns).toBe(SHORT_DEADLINE);
    expect(played.world.outcome).toEqual({ kind: "timed_out", turn: SHORT_DEADLINE });
    expect(played.world.map.exits.map((exit) => exit.nodeId)).not.toContain(
      played.world.criminal.nodeId,
    );
  });

  it("gives every hunt exactly the turns its own setup named, not the balance's", () => {
    for (const seed of ESCAPE_SEEDS) {
      const played = playThrough(seed, MAX_TURNS, [], SHORT_SETUP);

      expect(played.turns).toBe(SHORT_DEADLINE);
      expect(played.world.outcome).toEqual({ kind: "timed_out", turn: SHORT_DEADLINE });
    }
  });

  it("refuses to take another turn once the hunt is over", () => {
    const played = playThrough(SEED, MAX_TURNS);

    expect(turn.step({ world: seal(played.world), actions: [], balance: BALANCE })).toEqual({
      kind: "hunt_over",
      outcome: played.world.outcome,
    });
  });

  it("gets the criminal off the scene of its own incident", () => {
    const played = play(SEED, MAX_TURNS);

    expect(played.criminal.nodeId).not.toBe(played.map.incidentNodeId);
  });

  it("keeps one trail entry behind the criminal for every turn it walked", () => {
    const played = playThrough(SEED, MAX_TURNS);

    expect(played.world.criminal.trail).toHaveLength(
      Math.min(played.turns, LIMITS.maxCriminalTrail),
    );
  });

  test.prop([fc.integer({ min: 1, max: SAMPLE_SEEDS })], { numRuns: PROPERTY_RUNS })(
    "keeps every meter inside its bounds, pressure included",
    (seed) => {
      const played = play(seed, MAX_TURNS);

      expect(played.hunter.pressure).toBeGreaterThanOrEqual(PRESSURE_FLOOR);
      expect(played.hunter.pressure).toBeLessThanOrEqual(PRESSURE_CEILING);
      expect(played.hunter.trust).toBeGreaterThanOrEqual(BALANCE.hunter.trustMin);
      expect(played.hunter.trust).toBeLessThanOrEqual(BALANCE.hunter.trustMax);
      expect(played.criminal.heat).toBeGreaterThanOrEqual(0);
      expect(played.criminal.heat).toBeLessThanOrEqual(BALANCE.criminal.heatMax);
      expect(played.criminal.stamina).toBeGreaterThanOrEqual(0);
      expect(played.criminal.stamina).toBeLessThanOrEqual(BALANCE.criminal.staminaMax);
      expect(played.criminal.desperation).toBeGreaterThanOrEqual(0);
      expect(played.criminal.desperation).toBeLessThanOrEqual(BALANCE.criminal.desperationMax);
      expect(played.casualties).toBeGreaterThanOrEqual(0);
    },
  );

  test.prop([fc.integer({ min: 1, max: SAMPLE_SEEDS })], { numRuns: PROPERTY_RUNS })(
    "never lets the criminal's trail past its cap, whatever ends the hunt",
    (seed) => {
      const played = play(seed, TURNS_SAMPLED);

      expect(played.criminal.trail.length).toBeLessThanOrEqual(LIMITS.maxCriminalTrail);
    },
  );

  test.prop([fc.integer({ min: 1, max: SAMPLE_SEEDS })], { numRuns: PROPERTY_RUNS })(
    "only ever walks the criminal to a node the map joins to the one it was on",
    (seed) => {
      const played = play(seed, MAX_TURNS);
      const previous = played.criminal.trail[0];
      const joined = played.map.edges.some(
        (edge) =>
          (edge.from === previous && edge.to === played.criminal.nodeId) ||
          (edge.to === previous && edge.from === played.criminal.nodeId),
      );

      expect(joined || previous === played.criminal.nodeId).toBe(true);
    },
  );

  test.prop([fc.integer({ min: 1, max: SAMPLE_SEEDS })], { numRuns: PROPERTY_RUNS })(
    "keeps the heatmap a distribution however long the hunt runs",
    (seed) => {
      expect(Math.abs(totalMass(play(seed, MAX_TURNS)) - 1)).toBeLessThan(BELIEF_MASS_TOLERANCE);
    },
  );
});
