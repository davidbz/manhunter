/**
 * PLAN M4.1's acceptance criterion - a bot reads `HunterView` and nothing else - is kept by
 * `biome.json` and proved by `tools/biome/architecture-rules.test.ts`, not here. What is here is
 * the behaviour: that each bot plays the strategy its name claims, that the turn loop accepts
 * everything a bot queues, that the caps in `limits.ts` hold, and that a seed and a bot together
 * decide a hunt (architecture rule 2).
 *
 * This file may not name a `SealedWorld` either, so the hunts below hold one only as the value
 * `game.create` returned and read it back through `toHunterView`. That is the bots' own contract,
 * applied to their tests.
 */

import { fc, test } from "@fast-check/vitest";
import {
  BALANCE,
  type Belief,
  type Clock,
  createActionLogic,
  createBeliefLogic,
  createCriminalAiLogic,
  createDistrictLogic,
  createEventLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createIntelLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createTurnLogic,
  createValidatorLogic,
  type EdgeId,
  type GameSetup,
  type HunterAction,
  type HunterView,
  IN_PROGRESS,
  type MapGraph,
  makeClock,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeHunterState,
  makeNode,
  makeNodeId,
  type NodeId,
  type RngState,
  type Traversal,
  toHunterView,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { BOT_KINDS, type BotKind, createBotLogic } from "./bots";

const rng = createRng();
const graph = createGraphLogic();
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
  belief: createBeliefLogic({ graph }),
  action: createActionLogic({ rng }),
  ai: createCriminalAiLogic({ rng, graph }),
  graph,
});
const bots = createBotLogic({ rng, graph });

const MAX_TURNS = 24;
const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: MAX_TURNS,
  difficulty: "standard",
};

const SEED = 20_260_921;
const START_STATE: RngState = rng.seed(SEED);

const startedAt = (seed: number) => {
  const created = game.create({ setup: SETUP, seed, balance: BALANCE });
  if (created.kind !== "game") {
    throw new Error(`expected a game, got ${created.kind}`);
  }
  return created.world;
};

const generatedView = (seed: number): HunterView => toHunterView(startedAt(seed));

/**
 * A whole hunt played by one bot. Feeding each queue straight back into `step` is what proves the
 * queue legal: an empty `rejections` list means planning charged for every action the bot asked
 * for, rather than refusing an unaffordable or ill-targeted one.
 */
type Hunt = {
  readonly queues: readonly (readonly HunterAction[])[];
  readonly rejections: number;
  readonly ending: string;
};

const huntWith = (kind: BotKind, seed: number): Hunt => {
  let world = startedAt(seed);
  let state = rng.fork(rng.seed(seed), kind);
  const queues: (readonly HunterAction[])[] = [];
  let rejections = 0;
  for (let played = 0; played < MAX_TURNS; played += 1) {
    const view = toHunterView(world);
    if (view.outcome.kind !== IN_PROGRESS.kind) {
      return { queues, rejections, ending: view.outcome.kind };
    }
    const decision = bots.plan({ kind, view, balance: BALANCE, state });
    state = decision.state;
    queues.push(decision.value);
    const taken = turn.step({ world, actions: decision.value, balance: BALANCE });
    if (taken.kind !== "turn") {
      return { queues, rejections, ending: taken.kind };
    }
    rejections += taken.rejections.length;
    world = taken.world;
  }
  return { queues, rejections, ending: toHunterView(world).outcome.kind };
};

const NO_RIVER = null;
const ALWAYS = { kind: "always" } as const;
const ORIGIN_CLOCK: Clock = makeClock(0, 0);
const DEEP_POCKETS = 1_000_000;
const CORRIDOR_NODES = 4;

type ViewParts = {
  readonly map: MapGraph;
  readonly belief: Belief;
  readonly actionPoints?: number;
  readonly budget?: number;
};

const makeView = (parts: ViewParts): HunterView => ({
  clock: ORIGIN_CLOCK,
  map: parts.map,
  hunter: makeHunterState({
    actionPoints: parts.actionPoints ?? BALANCE.hunter.actionPointsPerTurn,
    budget: parts.budget ?? BALANCE.hunter.startingBudget,
    trust: BALANCE.hunter.startingTrust,
    pressure: BALANCE.hunter.startingPressure,
  }),
  reports: [],
  events: [],
  belief: parts.belief,
  casualties: 0,
  turnsRemaining: MAX_TURNS,
  outcome: IN_PROGRESS,
});

/**
 * A corridor: nodes in a line, the crime scene at one end and the only exit at the other, so every
 * edge is on the one escape route and the greedy bot has no choice of corridor to make.
 */
const lineMap = (nodeCount: number, edgeKind: "road" | "footpath"): MapGraph => {
  const ids = Array.from({ length: nodeCount }, (_unused, index) => makeNodeId(`n${index}`));
  const first = ids[0] ?? makeNodeId("n0");
  const last = ids[ids.length - 1] ?? first;
  return {
    nodes: ids.map((id, index) => makeNode(id, "residential", { x: index, y: 0 })),
    edges: ids
      .slice(1)
      .map((id, index) => makeEdge(edgeKind, makeEdgeId(`e${index}`), ids[index] ?? first, id)),
    exits: [makeExit(last, "highway", ALWAYS)],
    river: NO_RIVER,
    incidentNodeId: first,
  };
};

const uniformOver = (map: MapGraph, mass: number): Belief =>
  map.nodes.map((node) => ({ nodeId: node.id, mass }));

const massAt = (map: MapGraph, masses: readonly number[]): Belief =>
  map.nodes.map((node, index) => ({ nodeId: node.id, mass: masses[index] ?? 0 }));

const nodeTargetsIn = (queue: readonly HunterAction[]): readonly NodeId[] =>
  queue.flatMap((action) =>
    action.kind === "canvass" || action.kind === "pull_cctv" ? [action.nodeId] : [],
  );

const edgeTargetsIn = (queue: readonly HunterAction[]): readonly EdgeId[] =>
  queue.flatMap((action) => (action.kind === "roadblock" ? [action.edgeId] : []));

const planOf = (kind: BotKind, view: HunterView): readonly HunterAction[] =>
  bots.plan({ kind, view, balance: BALANCE, state: START_STATE }).value;

const escapeCost = (map: MapGraph, blockedEdgeIds: ReadonlySet<EdgeId>): number => {
  const traversal: Traversal = {
    graph: map,
    balance: BALANCE,
    mode: BALANCE.map.escapeMode,
    blockedEdgeIds,
  };
  const path = graph.shortestPathToAny(
    traversal,
    map.incidentNodeId,
    map.exits.map((exit) => exit.nodeId),
  );
  return path.kind === "path" ? path.cost : Number.POSITIVE_INFINITY;
};

const corridorView = (edgeKind: "road" | "footpath", budget?: number): HunterView => {
  const map = lineMap(CORRIDOR_NODES, edgeKind);
  return makeView({
    map,
    belief: uniformOver(map, 1 / map.nodes.length),
    ...(budget === undefined ? {} : { budget }),
  });
};

describe("every scripted bot", () => {
  for (const kind of BOT_KINDS) {
    it(`${kind} queues only actions the turn loop accepts`, () => {
      const hunt = huntWith(kind, SEED);

      expect(hunt.rejections).toBe(0);
      expect(hunt.queues.length).toBeGreaterThan(0);
    });

    it(`${kind} asks for no more than the turn's action points`, () => {
      const view = generatedView(SEED);

      expect(planOf(kind, view).length).toBeLessThanOrEqual(view.hunter.actionPoints);
    });

    it(`${kind} plans the same turn twice from the same stream position`, () => {
      const view = generatedView(SEED);
      const request = { kind, view, balance: BALANCE, state: START_STATE } as const;

      expect(bots.plan(request)).toEqual(bots.plan(request));
    });
  }
});

describe("random", () => {
  it("spends the whole action point allowance", () => {
    const view = generatedView(SEED);

    expect(planOf("random", view)).toHaveLength(view.hunter.actionPoints);
  });

  it("only ever names targets the map has", () => {
    const view = generatedView(SEED);
    const nodeIds = new Set(view.map.nodes.map((node) => node.id));
    const edgeIds = new Set(view.map.edges.map((edge) => edge.id));

    const queue = planOf("random", view);

    expect(nodeTargetsIn(queue).every((nodeId) => nodeIds.has(nodeId))).toBe(true);
    expect(edgeTargetsIn(queue).every((edgeId) => edgeIds.has(edgeId))).toBe(true);
  });

  it("stops enumerating at the candidate cap", () => {
    const map = lineMap(LIMITS.maxBotCandidates, "footpath");
    const view = makeView({ map, belief: uniformOver(map, 1 / map.nodes.length) });
    const enumerated = new Set(
      map.nodes.slice(0, LIMITS.maxBotCandidates / 2).map((node) => node.id),
    );

    const queue = planOf("random", view);

    expect(queue.length).toBeGreaterThan(0);
    expect(nodeTargetsIn(queue).every((nodeId) => enumerated.has(nodeId))).toBe(true);
  });
});

describe("greedy_roadblock", () => {
  it("queues roadblocks and nothing else", () => {
    const hunt = huntWith("greedy_roadblock", SEED);

    expect(hunt.queues.flat().every((action) => action.kind === "roadblock")).toBe(true);
  });

  it("makes the escape route it found more expensive", () => {
    const view = corridorView("road");
    const openCost = escapeCost(view.map, new Set());

    const blocked = new Set(edgeTargetsIn(planOf("greedy_roadblock", view)));

    expect(blocked.size).toBeGreaterThan(0);
    expect(escapeCost(view.map, blocked)).toBeGreaterThan(openCost);
  });

  it("never asks for the same edge twice in a turn", () => {
    const edgeIds = edgeTargetsIn(planOf("greedy_roadblock", generatedView(SEED)));

    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it("queues nothing when no edge on the route can be blocked", () => {
    expect(planOf("greedy_roadblock", corridorView("footpath"))).toEqual([]);
  });

  it("queues nothing it cannot pay for", () => {
    const view = corridorView("road", BALANCE.actions.roadblock.budgetCost - 1);

    expect(planOf("greedy_roadblock", view)).toEqual([]);
  });
});

describe("heatmap_chaser", () => {
  const PEAKED = [0.1, 0.7, 0.2, 0];

  it("works the hottest node first, canvass before cameras", () => {
    const map = lineMap(CORRIDOR_NODES, "road");
    const view = makeView({ map, belief: massAt(map, PEAKED) });

    const queue = planOf("heatmap_chaser", view);

    const hottest = map.nodes[1]?.id;
    expect(queue.slice(0, 2)).toEqual([
      { kind: "canvass", nodeId: hottest },
      { kind: "pull_cctv", nodeId: hottest },
    ]);
  });

  it("moves to the next hottest once a node is worked through", () => {
    const map = lineMap(CORRIDOR_NODES, "road");
    const view = makeView({ map, belief: massAt(map, PEAKED) });

    expect(nodeTargetsIn(planOf("heatmap_chaser", view))[2]).toBe(map.nodes[2]?.id);
  });

  it("never asks about a node the heatmap has ruled out", () => {
    const map = lineMap(CORRIDOR_NODES, "road");
    const view = makeView({ map, belief: massAt(map, [0, 0.6, 0.4, 0]) });
    const ruledOut = new Set([map.nodes[0]?.id, map.nodes[3]?.id]);

    const queue = planOf("heatmap_chaser", view);

    expect(queue.length).toBeGreaterThan(0);
    expect(nodeTargetsIn(queue).some((nodeId) => ruledOut.has(nodeId))).toBe(false);
  });

  it("queues nothing when the heatmap is empty", () => {
    const map = lineMap(CORRIDOR_NODES, "road");

    expect(planOf("heatmap_chaser", makeView({ map, belief: massAt(map, []) }))).toEqual([]);
  });

  it("stops at the queue cap when resources would allow more", () => {
    const map = lineMap(LIMITS.maxBotQueue + CORRIDOR_NODES, "road");
    const view = makeView({
      map,
      belief: uniformOver(map, 1 / map.nodes.length),
      actionPoints: DEEP_POCKETS,
      budget: DEEP_POCKETS,
    });

    expect(planOf("heatmap_chaser", view)).toHaveLength(LIMITS.maxBotQueue);
  });
});

const DETERMINISM_RUNS = 25;
const DETERMINISM_TIMEOUT_MS = 30_000;
const MAX_SEED = 2 ** 31 - 1;

describe("a bot played twice", () => {
  test.prop([fc.constantFrom(...BOT_KINDS), fc.integer({ min: 1, max: MAX_SEED })], {
    numRuns: DETERMINISM_RUNS,
  })(
    "plays the same hunt from the same seed",
    (kind, seed) => {
      expect(huntWith(kind, seed)).toEqual(huntWith(kind, seed));
    },
    DETERMINISM_TIMEOUT_MS,
  );
});
