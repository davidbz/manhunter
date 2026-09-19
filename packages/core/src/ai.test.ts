import { describe, expect, it } from "vitest";
import {
  type CriminalAiRequest,
  type CriminalSituation,
  createCriminalAiLogic,
  toCriminalSituation,
} from "./ai";
import type { Balance, CriminalProfileWeights } from "./balance";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import type { CriminalAction, CriminalState } from "./criminal";
import { makeCriminalState } from "./criminal";
import { createDistrictLogic } from "./districts";
import { createGameLogic } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import { makeHunterState } from "./hunter";
import type { EdgeId, NodeId } from "./ids";
import { makeEdgeId, makeNodeId } from "./ids";
import { LIMITS } from "./limits";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import { createMinCutLogic } from "./mincut";
import { createRiverLogic } from "./river";
import type { RngState } from "./rng";
import { createRng } from "./rng";
import { unseal } from "./sealed";
import { makeClock } from "./time";
import { createTopologyLogic } from "./topology";
import { createValidatorLogic } from "./validator";
import { makeWorldState, type WorldState } from "./world";

// Architecture rule 4, mirrored: the hunter may not see the criminal, and the criminal may not
// see the hunter. A `CriminalSituation` that grows one of these members fails `bun run typecheck`
// before any test runs.
type AssertTrue<T extends true> = T;
type KeyAbsent<T, Key extends string> = Key extends keyof T ? false : true;

export type SituationHidesTheHunter = AssertTrue<KeyAbsent<CriminalSituation, "hunter">>;
export type SituationHidesTheReports = AssertTrue<KeyAbsent<CriminalSituation, "reports">>;
export type SituationHidesTheEvents = AssertTrue<KeyAbsent<CriminalSituation, "events">>;
export type SituationHidesTheConfig = AssertTrue<KeyAbsent<CriminalSituation, "config">>;
export type SituationHidesTheRng = AssertTrue<KeyAbsent<CriminalSituation, "rng">>;

const rng = createRng();
const graph = createGraphLogic();
const ai = createCriminalAiLogic({ rng, graph });

const SEED = 11;
const START_HOUR = 9;
const MAX_TURNS = 24;
const TURN = 0;
const START_CASH = 500;
/** Enough seeds for the noise to have turned over several times without making the suite slow. */
const SAMPLE_SEEDS = 60;
const HEAT_MAX = BALANCE.criminal.heatMax;
const CALM = 0;

const yard = makeNodeId("yard");
const gate = makeNodeId("gate");
const park = makeNodeId("park");
const far = makeNodeId("far");
const quiet = makeNodeId("quiet");
const busy = makeNodeId("busy");
const way_out = makeNodeId("way-out");

const roadToGate = makeEdgeId("road-to-gate");

/**
 * Two ways out of the yard. Through the gate is the short one (road 2 + road 2), through the park
 * the long one (footpath 1 + road 2 + road 2), so an unblocked criminal always takes the gate -
 * which is what makes "it took the park instead" a readable answer to a roadblock on the road.
 */
const forkedCity: MapGraph = {
  nodes: [
    makeNode(yard, "industrial", { x: 0, y: 0 }),
    makeNode(gate, "residential", { x: 1, y: 0 }),
    makeNode(park, "park", { x: 0, y: 1 }),
    makeNode(far, "suburb", { x: 1, y: 1 }),
    makeNode(way_out, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", roadToGate, yard, gate),
    makeEdge("road", makeEdgeId("gate-out"), gate, way_out),
    makeEdge("footpath", makeEdgeId("yard-park"), yard, park),
    makeEdge("road", makeEdgeId("park-far"), park, far),
    makeEdge("road", makeEdgeId("far-out"), far, way_out),
  ],
  exits: [makeExit(way_out, "highway")],
  river: null,
  incidentNodeId: yard,
};

/**
 * Two ways out of a station concourse, the same distance apart and nothing alike to stand in:
 * an industrial back lot nobody watches, and another concourse everybody does.
 */
const twinCity: MapGraph = {
  nodes: [
    makeNode(gate, "transit_hub", { x: 0, y: 0 }),
    makeNode(quiet, "industrial", { x: 1, y: 0 }),
    makeNode(busy, "transit_hub", { x: 0, y: 1 }),
    makeNode(way_out, "exit", { x: 1, y: 1 }),
  ],
  edges: [
    makeEdge("footpath", makeEdgeId("gate-quiet"), gate, quiet),
    makeEdge("footpath", makeEdgeId("gate-busy"), gate, busy),
    makeEdge("footpath", makeEdgeId("quiet-out"), quiet, way_out),
    makeEdge("footpath", makeEdgeId("busy-out"), busy, way_out),
  ],
  exits: [makeExit(way_out, "highway")],
  river: null,
  incidentNodeId: gate,
};

/** A back lot worth hiding in, with nowhere to run but a station concourse. */
const hideoutCity: MapGraph = {
  nodes: [
    makeNode(yard, "industrial", { x: 0, y: 0 }),
    makeNode(busy, "transit_hub", { x: 1, y: 0 }),
    makeNode(way_out, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("footpath", makeEdgeId("yard-busy"), yard, busy),
    makeEdge("footpath", makeEdgeId("busy-out"), busy, way_out),
  ],
  exits: [makeExit(way_out, "highway")],
  river: null,
  incidentNodeId: yard,
};

type CriminalOptions = {
  readonly nodeId?: NodeId;
  readonly heat?: number;
  readonly stamina?: number;
  readonly knownRoadblockEdgeIds?: readonly EdgeId[];
};

const criminalWith = (map: MapGraph, options: CriminalOptions = {}): CriminalState => {
  const base = makeCriminalState({
    nodeId: options.nodeId ?? map.incidentNodeId,
    travelMode: "foot",
    profile: "amateur",
    stamina: options.stamina ?? BALANCE.criminal.staminaMax,
    heat: options.heat ?? BALANCE.criminal.startingHeat,
    cash: START_CASH,
    desperation: BALANCE.criminal.startingDesperation,
  });
  return {
    ...base,
    knowledge: { ...base.knowledge, knownRoadblockEdgeIds: options.knownRoadblockEdgeIds ?? [] },
  };
};

const situationOn = (
  map: MapGraph,
  options: CriminalOptions = {},
  hour: number = START_HOUR,
): CriminalSituation => ({
  map,
  clock: makeClock(hour, TURN),
  criminal: criminalWith(map, options),
});

const decide = (
  situation: CriminalSituation,
  seed: number = SEED,
  balance: Balance = BALANCE,
): CriminalAction => ai.choose({ situation, balance, state: rng.seed(seed) }).value;

const destinationsOver = (situation: CriminalSituation): readonly (NodeId | "stayed")[] =>
  Array.from({ length: SAMPLE_SEEDS }, (_unused, seed) => {
    const action = decide(situation, seed);
    return action.kind === "move" ? action.toNodeId : "stayed";
  });

const kindsOver = (situation: CriminalSituation): readonly CriminalAction["kind"][] =>
  Array.from({ length: SAMPLE_SEEDS }, (_unused, seed) => decide(situation, seed).kind);

describe("toCriminalSituation", () => {
  const config: GameConfig = {
    criminalProfile: "amateur",
    startHour: START_HOUR,
    maxTurns: MAX_TURNS,
    map: { columns: 8, rows: 6, exitCount: 3 },
    difficulty: "standard",
  };
  const world: WorldState = makeWorldState({
    config,
    rng: rng.seed(SEED),
    clock: makeClock(START_HOUR, TURN),
    map: forkedCity,
    hunter: makeHunterState({
      actionPoints: BALANCE.hunter.actionPointsPerTurn,
      budget: BALANCE.hunter.startingBudget,
      trust: BALANCE.hunter.startingTrust,
      pressure: BALANCE.hunter.startingPressure,
    }),
    criminal: criminalWith(forkedCity),
  });

  it("carries the city, the clock and the criminal, and nothing else", () => {
    expect(Object.keys(toCriminalSituation(world)).toSorted()).toEqual([
      "clock",
      "criminal",
      "map",
    ]);
  });

  it("keeps the criminal's own knowledge, which is all it has of the hunt", () => {
    expect(toCriminalSituation(world).criminal.knowledge).toEqual(world.criminal.knowledge);
  });
});

describe("choosing a move", () => {
  it("heads for the nearest exit by the shortest route", () => {
    expect(destinationsOver(situationOn(forkedCity))).toEqual(
      Array.from({ length: SAMPLE_SEEDS }, () => gate),
    );
  });

  it("never moves through a roadblock it knows about", () => {
    const situation = situationOn(forkedCity, { knownRoadblockEdgeIds: [roadToGate] });
    expect(destinationsOver(situation)).not.toContain(gate);
  });

  it("takes the long way round rather than standing still when the short one is blocked", () => {
    const situation = situationOn(forkedCity, { knownRoadblockEdgeIds: [roadToGate] });
    expect(destinationsOver(situation)).toEqual(Array.from({ length: SAMPLE_SEEDS }, () => park));
  });

  it("prefers the route nobody is watching when it is recognisable", () => {
    const situation = situationOn(twinCity, { heat: HEAT_MAX });
    expect(destinationsOver(situation)).toEqual(Array.from({ length: SAMPLE_SEEDS }, () => quiet));
  });

  it("lets the noise decide between two routes when it has nothing to fear", () => {
    const destinations = new Set(destinationsOver(situationOn(twinCity, { heat: CALM })));
    expect(destinations).toEqual(new Set([quiet, busy]));
  });
});

describe("standing still", () => {
  it("goes to ground in a district full of hiding spots once the heat is up", () => {
    expect(kindsOver(situationOn(hideoutCity, { heat: HEAT_MAX }))).toEqual(
      Array.from({ length: SAMPLE_SEEDS }, () => "hide"),
    );
  });

  it("keeps running while its face is still its own", () => {
    expect(kindsOver(situationOn(hideoutCity))).toEqual(
      Array.from({ length: SAMPLE_SEEDS }, () => "move"),
    );
  });

  it("never hides when the profile's nerve is set past the meter", () => {
    const weights: CriminalProfileWeights = {
      ...BALANCE.criminal.profiles.amateur,
      hideAboveHeat: HEAT_MAX,
    };
    const balance: Balance = {
      ...BALANCE,
      criminal: { ...BALANCE.criminal, profiles: { amateur: weights } },
    };
    const situation = situationOn(hideoutCity, { heat: HEAT_MAX });
    const kinds = Array.from(
      { length: SAMPLE_SEEDS },
      (_unused, seed) => decide(situation, seed, balance).kind,
    );
    expect(kinds).not.toContain("hide");
  });

  it("rests when it has nothing left rather than walking into a crowd", () => {
    const situation = situationOn(hideoutCity, { stamina: 0, heat: HEAT_MAX });
    expect(kindsOver(situation)).toContain("rest");
  });

  it("waits out a turn it has no behaviour for", () => {
    const situation = situationOn(forkedCity);
    const stranger: CriminalSituation = {
      ...situation,
      criminal: { ...situation.criminal, profile: "professional" },
    };
    const state = rng.seed(SEED);
    const decision = ai.choose({ situation: stranger, balance: BALANCE, state });
    expect(decision.value).toEqual({ kind: "wait" });
    expect(decision.state).toEqual(state);
  });
});

describe("determinism (architecture rule 2)", () => {
  const situation = situationOn(forkedCity);

  it("makes the same decision from the same situation and stream position", () => {
    const first = ai.choose({ situation, balance: BALANCE, state: rng.seed(SEED) });
    const second = ai.choose({ situation, balance: BALANCE, state: rng.seed(SEED) });
    expect(second).toEqual(first);
  });

  it("draws once per candidate, whether or not the candidate wins", () => {
    const state = rng.seed(SEED);
    // Three stationary actions plus the two neighbours of the yard.
    const candidates = 5;
    let advanced: RngState = state;
    for (let draw = 0; draw < candidates; draw += 1) {
      advanced = rng.float(advanced).state;
    }
    expect(ai.choose({ situation, balance: BALANCE, state }).state).toEqual(advanced);
  });

  it("stops enumerating candidates at the limit", () => {
    const spokes = Array.from({ length: LIMITS.maxAiCandidates }, (_unused, index) =>
      makeNodeId(`spoke-${index}`),
    );
    // No exit, so no route is searched and the district the criminal stands in is all that is
    // scored: what this measures is the candidate count, one draw at a time.
    const star: MapGraph = {
      nodes: [
        makeNode(yard, "industrial", { x: 0, y: 0 }),
        ...spokes.map((id, index) => makeNode(id, "suburb", { x: index, y: 1 })),
      ],
      edges: spokes.map((id, index) =>
        makeEdge("footpath", makeEdgeId(`spoke-${index}`), yard, id),
      ),
      exits: [],
      river: null,
      incidentNodeId: yard,
    };
    const state = rng.seed(SEED);
    let advanced: RngState = state;
    for (let draw = 0; draw < LIMITS.maxAiCandidates; draw += 1) {
      advanced = rng.float(advanced).state;
    }
    expect(ai.choose({ situation: situationOn(star), balance: BALANCE, state }).state).toEqual(
      advanced,
    );
  });
});

describe("escaping a generated city", () => {
  const generation = createGenerationLogic({
    rng,
    topology: createTopologyLogic({ rng, graph }),
    river: createRiverLogic({ rng, graph }),
    districts: createDistrictLogic({ rng, graph }),
    validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
  });
  const game = createGameLogic({ rng, generation });

  /**
   * Hard-coded rather than generated: a batch of seeds drawn at run time would make this the one
   * test in the repo that can fail differently on two runs of the same commit, and a failure has
   * to name the seed that broke it (the rule M3.6's AC states).
   */
  const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34] as const;
  /**
   * Turns the criminal may take over the length of the shortest route. Foot costs are 1 and 2
   * (`balance.edges`), so a step that gains one turn of ground on a road worth two scores half a
   * turn of progress, and the noise can buy one of those over an optimal step now and then.
   * Measured over 300 default-grid seeds: 298 escaped in exactly the shortest number of steps and
   * two took one extra, so this is the observed worst case with one turn of headroom.
   */
  const SLACK = 2;

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

  const stepsOnFoot = (world: WorldState): number => {
    const route = graph.shortestPathToAny(
      { graph: world.map, balance: BALANCE, mode: BALANCE.map.escapeMode },
      world.criminal.nodeId,
      world.map.exits.map((exit) => exit.nodeId),
    );
    if (route.kind !== "path") {
      throw new Error(`expected a route to an exit, got ${route.kind}`);
    }
    return route.edgeIds.length;
  };

  /** Turns taken to stand on an exit, with no hunter acting, or `null` if it never got there. */
  const turnsToEscape = (world: WorldState, allowed: number): number | null => {
    const exits = new Set(world.map.exits.map((exit) => exit.nodeId));
    let criminal = world.criminal;
    let state = world.rng;
    for (let turn = TURN; turn <= allowed; turn += 1) {
      if (exits.has(criminal.nodeId)) {
        return turn;
      }
      const situation: CriminalSituation = {
        map: world.map,
        clock: makeClock(world.config.startHour, turn),
        criminal,
      };
      const request: CriminalAiRequest = { situation, balance: BALANCE, state };
      const decision = ai.choose(request);
      state = decision.state;
      if (decision.value.kind === "move") {
        criminal = { ...criminal, nodeId: decision.value.toNodeId };
      }
    }
    return null;
  };

  for (const seed of SEEDS) {
    it(`reaches an exit within slack of the shortest route (seed ${seed})`, () => {
      const world = worldFor(seed);
      const allowed = stepsOnFoot(world) + SLACK;
      expect(turnsToEscape(world, allowed)).not.toBeNull();
    });
  }
});
