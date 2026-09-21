/**
 * Scripted hunters (PLAN M4.1): three baselines for PLAN M4.2's batch runner to play hunts with,
 * and for PLAN M4.3 to tune `balance.ts` against.
 *
 * **A bot sees a `HunterView` and nothing else.** That is the acceptance criterion, and two things
 * keep it rather than prose. `BotRequest` names the view, the balance and a stream position, so no
 * world of any kind is in scope. And `biome.json` denies this directory `@manhunter/core`'s hidden
 * state by name - `WorldState`, `SealedWorld`, `unseal` and the rest - with a fixture in
 * `tools/biome/architecture-rules.test.ts` that proves the denial still fires. `sim` at large may
 * `unseal` (PLAN "How `sim` reaches inside a sealed world"); the bots may not, and that narrower
 * rule is also why they live here rather than in `core`, where `WorldState` is a relative import
 * away and no import rule could tell a bot apart from the rules it plays by.
 *
 * They hold nothing. A strategy is handed the view, the balance and the actions already queued this
 * turn, and returns one more action or nothing, so the accumulating queue is data passing through
 * rather than state a bot keeps (AGENTS.md engineering principle 1). Randomness is threaded the way
 * the whole repo threads it - a state in, a state out (architecture rule 2) - so the same seed and
 * the same bot play the same hunt.
 *
 * Adding a fourth bot is an entry in `BOT_KINDS` and a row in `BOT_TABLE`, never a branch
 * (architecture rule 6).
 */

import {
  actionCostOf,
  type Balance,
  type BeliefCell,
  blockedEdgeIdsAt,
  type EdgeId,
  type GraphLogic,
  type HunterAction,
  type HunterView,
  type NodeId,
  type NonEmptyArray,
  type Rng,
  type RngDraw,
  type RngState,
  type Traversal,
} from "@manhunter/core";
import { LIMITS } from "../limits";

/**
 * Every scripted hunter there is. The source of truth for both the type and the table, so PLAN
 * M4.2's `--bot` flag has one list to validate against and cannot drift from what exists.
 */
export const BOT_KINDS = ["random", "greedy_roadblock", "heatmap_chaser"] as const;

export type BotKind = (typeof BOT_KINDS)[number];

export type BotDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

/** Everything a bot may read, and the stream position it draws from. */
export type BotRequest = {
  readonly kind: BotKind;
  readonly view: HunterView;
  readonly balance: Balance;
  readonly state: RngState;
};

/** A whole turn's queue, and the stream position after the draws that built it. */
export type BotDecision = RngDraw<readonly HunterAction[]>;

export type BotLogic = {
  readonly plan: (request: BotRequest) => BotDecision;
};

/**
 * What a strategy is handed. The resources are what is left after the actions already queued, and
 * `queued` is how a strategy avoids repeating itself without keeping anything of its own.
 */
type BotPlan = {
  readonly view: HunterView;
  readonly balance: Balance;
  readonly actionPoints: number;
  readonly budget: number;
  readonly queued: readonly HunterAction[];
};

/** One more action for the turn, or `null` when the strategy has nothing left to ask for. */
type BotStrategy = (deps: BotDeps, plan: BotPlan, state: RngState) => RngDraw<HunterAction | null>;

type NodeActionMaker = (nodeId: NodeId) => HunterAction;

const NO_MASS = 0;

const BRIEFING: HunterAction = { kind: "true_briefing" };

/**
 * Every enumeration a bot makes runs over generated data, so each is capped (AGENTS.md section 5).
 * The surplus is dropped rather than refused, as `core`'s criminal AI drops its own: a map with
 * more candidates than this is a generator bug and not a workload.
 */
const bounded = <T>(items: readonly T[]): readonly T[] => items.slice(0, LIMITS.maxBotCandidates);

/**
 * Uniform over the candidates, or nothing when there are none. Destructuring is what proves the
 * list non-empty, which is what `Rng.pick` asks for, so no cast is needed to call it.
 */
const pickAny = <T>(rng: Rng, state: RngState, items: readonly T[]): RngDraw<T | null> => {
  const [first, ...rest] = items;
  if (first === undefined) {
    return { state, value: null };
  }
  return rng.pick(state, [first, ...rest]);
};

const roadblockEdgeIdsIn = (queued: readonly HunterAction[]): readonly EdgeId[] =>
  queued.flatMap((action) => (action.kind === "roadblock" ? [action.edgeId] : []));

/**
 * Edges no further roadblock may use: the ones standing containment has already closed, plus the
 * ones this turn's queue has closed. It feeds `Traversal.blockedEdgeIds`, which is what makes the
 * greedy bot's next search route around the block it has just asked for.
 */
const closedEdgeIds = (plan: BotPlan): ReadonlySet<EdgeId> =>
  new Set([
    ...blockedEdgeIdsAt(plan.view.hunter.containments, plan.view.clock.turn),
    ...roadblockEdgeIdsIn(plan.queued),
  ]);

/** Edges a roadblock could still be placed on: blockable by kind, and not already closed. */
const openBlockableEdgeIds = (plan: BotPlan): ReadonlySet<EdgeId> => {
  const closed = closedEdgeIds(plan);
  return new Set(
    plan.view.map.edges
      .filter((edge) => plan.balance.edges[edge.kind].blockable && !closed.has(edge.id))
      .map((edge) => edge.id),
  );
};

/**
 * Everything the hunter could legally ask for, in a fixed order so the draw over it is a pure
 * function of the stream position. Illegal targets are left out rather than queued and refused:
 * a queue full of rejections would measure the planning phase instead of the strategy.
 */
const candidateActions = (plan: BotPlan): readonly HunterAction[] =>
  bounded([
    BRIEFING,
    ...plan.view.map.nodes.flatMap((node): readonly HunterAction[] => [
      { kind: "canvass", nodeId: node.id },
      { kind: "pull_cctv", nodeId: node.id },
    ]),
    ...[...openBlockableEdgeIds(plan)].map(
      (edgeId): HunterAction => ({ kind: "roadblock", edgeId }),
    ),
  ]);

const randomStrategy: BotStrategy = (deps, plan, state) =>
  pickAny(deps.rng, state, candidateActions(plan));

/**
 * The corridor the hunter is trying to close: the cheapest route from the crime scene to whichever
 * exit is nearest, over the map as standing and queued roadblocks leave it.
 *
 * The crime scene is the origin because it is the one node both sides know the criminal stood on
 * (`MapGraph.incidentNodeId`, which is in the view for that reason), and because DESIGN.md's
 * amateur walks to its nearest exit from exactly there. PLAN M1.4a put `shortestPathToAny` in
 * `core` for this; nothing here re-implements a search.
 */
const escapeCorridorEdgeIds = (deps: BotDeps, plan: BotPlan): readonly EdgeId[] => {
  const traversal: Traversal = {
    graph: plan.view.map,
    balance: plan.balance,
    mode: plan.balance.map.escapeMode,
    blockedEdgeIds: closedEdgeIds(plan),
  };
  const path = deps.graph.shortestPathToAny(
    traversal,
    plan.view.map.incidentNodeId,
    plan.view.map.exits.map((exit) => exit.nodeId),
  );
  return path.kind === "path" ? path.edgeIds : [];
};

/**
 * Every blockable edge on the corridor is equally on it, so the draw is the whole tiebreak. Which
 * one is blocked changes the next corridor, which is how a queue of three tightens a net rather
 * than asking for the same edge three times.
 */
const greedyRoadblockStrategy: BotStrategy = (deps, plan, state) => {
  const blockable = openBlockableEdgeIds(plan);
  const corridor = bounded(escapeCorridorEdgeIds(deps, plan).filter((id) => blockable.has(id)));
  const drawn = pickAny(deps.rng, state, corridor);
  if (drawn.value === null) {
    return { state: drawn.state, value: null };
  }
  return { state: drawn.state, value: { kind: "roadblock", edgeId: drawn.value } };
};

/**
 * What the chaser does when it gets to a district, in order: knock on doors about now, then ask the
 * cameras about the last two turns (DESIGN.md "Intelligence"). A list rather than a branch, so its
 * length is also how many times one node is worth visiting in a turn.
 */
const HEATMAP_ACTIONS: NonEmptyArray<NodeActionMaker> = [
  (nodeId) => ({ kind: "canvass", nodeId }),
  (nodeId) => ({ kind: "pull_cctv", nodeId }),
];

const nodeIdOf = (action: HunterAction): NodeId | null =>
  action.kind === "canvass" || action.kind === "pull_cctv" ? action.nodeId : null;

const askedAboutCount = (queued: readonly HunterAction[], nodeId: NodeId): number =>
  queued.filter((action) => nodeIdOf(action) === nodeId).length;

/**
 * The nodes the hunter still suspects, hottest first, with the ones this turn has already worked
 * through dropped. Bounded before it is sorted, per AGENTS.md section 5: the cap is on the work,
 * not on the answer. `toSorted` is stable, so equal masses keep the map's own node order and the
 * draw in the strategy is what separates them - which matters from the first turn, where a hunter
 * who has heard nothing believes the city uniformly.
 */
const hottestCells = (plan: BotPlan): readonly BeliefCell[] =>
  bounded(
    plan.view.belief.filter(
      (cell) =>
        cell.mass > NO_MASS && askedAboutCount(plan.queued, cell.nodeId) < HEATMAP_ACTIONS.length,
    ),
  ).toSorted((left, right) => right.mass - left.mass);

const heatmapChaserStrategy: BotStrategy = (deps, plan, state) => {
  const ranked = hottestCells(plan);
  const hottest = ranked[0];
  if (hottest === undefined) {
    return { state, value: null };
  }
  const tied = ranked.slice(1).filter((cell) => cell.mass === hottest.mass);
  const drawn = deps.rng.pick(state, [hottest, ...tied]);
  const visits = askedAboutCount(plan.queued, drawn.value.nodeId);
  // `hottestCells` keeps that count below the table's length, so the index is in range; the
  // fallback is here only because `noUncheckedIndexedAccess` cannot see that.
  const makeAction = HEATMAP_ACTIONS[visits] ?? HEATMAP_ACTIONS[0];
  return { state: drawn.state, value: makeAction(drawn.value.nodeId) };
};

/**
 * Keyed by kind rather than listed, so a new `BotKind` is a compile error here until it has a
 * strategy (the `ACTION_TABLE` precedent in `core`).
 */
const BOT_TABLE: Readonly<Record<BotKind, BotStrategy>> = {
  random: randomStrategy,
  greedy_roadblock: greedyRoadblockStrategy,
  heatmap_chaser: heatmapChaserStrategy,
};

const costOf = (plan: BotPlan, action: HunterAction) => actionCostOf(action.kind, plan.balance);

const affordable = (plan: BotPlan, action: HunterAction): boolean => {
  const cost = costOf(plan, action);
  return cost.actionPoints <= plan.actionPoints && cost.budget <= plan.budget;
};

const withAction = (plan: BotPlan, action: HunterAction): BotPlan => {
  const cost = costOf(plan, action);
  return {
    ...plan,
    actionPoints: plan.actionPoints - cost.actionPoints,
    budget: plan.budget - cost.budget,
    queued: [...plan.queued, action],
  };
};

/**
 * A turn's queue, built one action at a time. It stops at the first thing the strategy cannot name
 * or the hunter cannot pay for: a bot sticks to its own strategy rather than falling back to a
 * cheaper one, so what PLAN M4.3 measures is the strategy and not the fallback.
 *
 * `LIMITS.maxBotQueue` is what keeps the loop finite. Nothing else does: three action points and a
 * cheapest action of one point is a fact about today's `balance.ts`, and PLAN M4.3's whole job is
 * to change facts like that.
 */
const planTurn = (deps: BotDeps, strategy: BotStrategy, request: BotRequest): BotDecision => {
  let plan: BotPlan = {
    view: request.view,
    balance: request.balance,
    actionPoints: request.view.hunter.actionPoints,
    budget: request.view.hunter.budget,
    queued: [],
  };
  let state = request.state;
  for (let queued = 0; queued < LIMITS.maxBotQueue; queued += 1) {
    const drawn = strategy(deps, plan, state);
    state = drawn.state;
    if (drawn.value === null || !affordable(plan, drawn.value)) {
      return { state, value: plan.queued };
    }
    plan = withAction(plan, drawn.value);
  }
  return { state, value: plan.queued };
};

export const createBotLogic = (deps: BotDeps): BotLogic => ({
  plan: (request) => planTurn(deps, BOT_TABLE[request.kind], request),
});
