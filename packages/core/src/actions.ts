/**
 * What the hunter can do with a turn (DESIGN.md "Hunter actions"), as a table rather than a
 * switch: one entry per `HunterActionKind` holding what the action targets, what it costs, what
 * makes it invalid and what it does to the world. Adding an action is a variant plus an entry,
 * never a new branch in the turn loop (architecture rule 6).
 *
 * Nothing here throws. An action the hunter cannot take comes back as a `rejected` result naming
 * why, and that rejection is the only thing guarding the budget: the bankruptcy end condition was
 * cut precisely because an unaffordable action is never applied, so the balance cannot go below
 * zero (PLAN "Decisions").
 *
 * `validate` and `apply` answer the same question, so `apply` calls `validate` rather than
 * restating it. A caller that wants to grey out a button asks `validate`; a caller that wants the
 * action taken asks `apply` and gets the same rejection if it was going to be refused.
 *
 * Only `apply` draws. Validation is a preview a UI may run on every hover, so it must not touch
 * the world's RNG position; the draws all happen once the action is committed, and they happen
 * whether or not the draw produces anything, so the stream advances the same way either way.
 */

import type { Balance, DistrictProperties } from "./balance";
import { blockedEdgeIdsAt, type HunterAction, type HunterActionKind } from "./hunter";
import type { EdgeId, NodeId } from "./ids";
import type { MapGraph } from "./map";
import {
  makeReport,
  nextReportId,
  type ReportContent,
  type ReportSource,
  sightingAccuracy,
} from "./report";
import type { Rng, RngDraw, RngState } from "./rng";
import { type Hour, type Turn, timeOfDayAt } from "./time";
import type { WorldState } from "./world";

/** What the player has to pick before the action is well formed. Read by the UI (PLAN M5.5). */
export type ActionTargetKind = "edge" | "node" | "global";

export type ActionCost = {
  readonly actionPoints: number;
  readonly budget: number;
};

/** Why an action was refused. Returned, never thrown, and never a user-facing string. */
export type ActionRejection =
  | {
      readonly kind: "not_enough_action_points";
      readonly required: number;
      readonly available: number;
    }
  | { readonly kind: "not_enough_budget"; readonly required: number; readonly available: number }
  | { readonly kind: "unknown_edge"; readonly edgeId: EdgeId }
  | { readonly kind: "unknown_node"; readonly nodeId: NodeId }
  | { readonly kind: "edge_not_blockable"; readonly edgeId: EdgeId }
  | { readonly kind: "edge_already_blocked"; readonly edgeId: EdgeId };

export type ActionValidation =
  | { readonly kind: "allowed"; readonly cost: ActionCost }
  | { readonly kind: "rejected"; readonly reason: ActionRejection };

export type ActionResult =
  | { readonly kind: "applied"; readonly world: WorldState }
  | { readonly kind: "rejected"; readonly reason: ActionRejection };

export type ActionRequest = {
  readonly world: WorldState;
  readonly action: HunterAction;
  readonly balance: Balance;
};

export type ActionLogic = {
  readonly validate: (request: ActionRequest) => ActionValidation;
  readonly apply: (request: ActionRequest) => ActionResult;
};

type ActionDeps = {
  readonly rng: Rng;
};

type ActionOf<Kind extends HunterActionKind> = Extract<HunterAction, { readonly kind: Kind }>;

/** Everything a handler reads, as data. The balance is passed in, never captured (principle 1). */
type ActionContext<Action extends HunterAction> = {
  readonly world: WorldState;
  readonly balance: Balance;
  readonly action: Action;
};

/** `null` is "no objection". Only the action's own rules; the framework checks the resources. */
type ActionCheck<Action extends HunterAction> = (
  context: ActionContext<Action>,
) => ActionRejection | null;

type ActionApply<Action extends HunterAction> = (
  deps: ActionDeps,
  context: ActionContext<Action>,
) => WorldState;

type ActionDefinition<Action extends HunterAction> = {
  readonly target: ActionTargetKind;
  readonly cost: (balance: Balance) => ActionCost;
  /** Signed: containment spends public trust, media buys it (DESIGN.md "Hunter actions"). */
  readonly trustChange: (balance: Balance) => number;
  readonly validate: ActionCheck<Action>;
  /** Runs on a world already charged for the action, so a handler only adds its own effect. */
  readonly apply: ActionApply<Action>;
};

/**
 * Keyed by kind rather than listed, so a new `HunterAction` variant is a compile error here until
 * it has an entry, and each entry is checked against its own variant (the annotated-table
 * precedent from M1.3, and `validator.ts`'s `RULES`).
 */
type ActionTable = {
  readonly [Kind in HunterActionKind]: ActionDefinition<ActionOf<Kind>>;
};

const NO_TRUST_CHANGE = 0;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const validateRoadblock: ActionCheck<ActionOf<"roadblock">> = ({ world, balance, action }) => {
  const edge = world.map.edges.find((candidate) => candidate.id === action.edgeId);
  if (edge === undefined) {
    return { kind: "unknown_edge", edgeId: action.edgeId };
  }
  if (!balance.edges[edge.kind].blockable) {
    return { kind: "edge_not_blockable", edgeId: action.edgeId };
  }
  if (blockedEdgeIdsAt(world.hunter.containments, world.clock.turn).has(action.edgeId)) {
    return { kind: "edge_already_blocked", edgeId: action.edgeId };
  }
  return null;
};

/**
 * The containment is appended rather than merged with an expiring one on the same edge:
 * `validateRoadblock` refuses a second block while the first still stands, and one that has
 * already expired is history the consequences phase may want to read (PLAN M3.8a).
 */
const applyRoadblock: ActionApply<ActionOf<"roadblock">> = (_deps, { world, balance, action }) => ({
  ...world,
  hunter: {
    ...world.hunter,
    containments: [
      ...world.hunter.containments,
      {
        kind: "roadblock",
        edgeId: action.edgeId,
        expiresAt: world.clock.turn + balance.actions.roadblock.durationTurns,
      },
    ],
  },
});

/**
 * `true_briefing` has no target to object to, and its effect is still only its cost: PLAN M3.4b
 * adds the report-volume multiplier and the criminal's heat. The table is keyed by
 * `HunterActionKind`, so it cannot be left out and still compile, and what it already does right
 * is charge - the trust gain included, since that is the signed `trustChange` every entry has.
 */
const noObjection = (): null => null;

const unchanged = <Action extends HunterAction>(
  _deps: ActionDeps,
  { world }: ActionContext<Action>,
): WorldState => world;

type NodeAction = ActionOf<"canvass"> | ActionOf<"pull_cctv">;

const validateNodeTarget: ActionCheck<NodeAction> = ({ world, action }) =>
  world.map.nodes.some((node) => node.id === action.nodeId)
    ? null
    : { kind: "unknown_node", nodeId: action.nodeId };

/** A district with no cameras and no witnesses, which is what a node off the map amounts to. */
const NO_DISTRICT: DistrictProperties = {
  witnessDensity: 0,
  nightWitnessMultiplier: 0,
  hidingSpots: 0,
  cctvCoverage: 0,
};

/**
 * The properties of the district a node sits in. The fallback is only reached by a node the map
 * does not have, which `validateNodeTarget` has already refused; it is here so the lookup is
 * total rather than assumed, and it answers "nobody saw anything", which is the honest reading.
 */
const propertiesAt = (balance: Balance, map: MapGraph, nodeId: NodeId): DistrictProperties => {
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  return node === undefined ? NO_DISTRICT : balance.districts[node.districtType];
};

const FULL_TRUST = 1;
const NO_TRUST = 0;

/**
 * The hunter's standing as a fraction of its range. No guard against an empty range: `Balance` is
 * `typeof BALANCE` over an `as const` table, so its trust bounds are literal types and a range
 * with no span is not a value this can be handed. Widening them for a sweep (M4.3) is what would
 * make the division fallible, and that task is where the guard would then belong.
 */
const trustFactorOf = (balance: Balance, trust: number): number =>
  clamp(
    (trust - balance.hunter.trustMin) / (balance.hunter.trustMax - balance.hunter.trustMin),
    NO_TRUST,
    FULL_TRUST,
  );

/** DESIGN.md's district table: a park is watched by nobody after dark, a transit hub always is. */
const witnessDensityAt = (balance: Balance, properties: DistrictProperties, hour: Hour): number =>
  timeOfDayAt(balance.time, hour) === "night"
    ? properties.witnessDensity * properties.nightWitnessMultiplier
    : properties.witnessDensity;

/**
 * What is at the node. This is the one place a hunter-facing producer reads the criminal's true
 * position: the doubt a report carries is its hidden `accuracy`, not a blurred location, and
 * perturbing the reported node by that accuracy is PLAN M3.6's. Seeing nothing is evidence too -
 * `no_sighting` is what M3.6b's heatmap prunes with.
 */
const observationAt = (world: WorldState, nodeId: NodeId): ReportContent =>
  world.criminal.nodeId === nodeId
    ? { kind: "sighting", nodeId, travelMode: world.criminal.travelMode }
    : { kind: "no_sighting", nodeId };

/** Everything an intelligence source reads, derived once. */
type Lookout = {
  readonly world: WorldState;
  readonly balance: Balance;
  readonly properties: DistrictProperties;
};

/**
 * The shape both intelligence actions share: look at one node, maybe learn something, file it
 * late. They differ only in who is looking, how likely they are to see anything at all, how far
 * they can be trusted, and how long the paperwork takes - so those four are the entry, and
 * `gather` is the handler over them. PLAN M3.6 adds the sources the world produces unasked.
 */
type IntelSource = {
  readonly source: ReportSource;
  readonly chance: (lookout: Lookout) => number;
  readonly accuracy: (lookout: Lookout) => number;
  readonly delay: (rng: Rng, lookout: Lookout, state: RngState) => RngDraw<Turn>;
};

/**
 * Reports are filed as `true`: what a canvass or a pull gets wrong it gets wrong by being
 * inaccurate, not by being a lie. Witnesses who are mistaken outright, and calls that were never
 * about the criminal at all, are `balance.reports.falseReportRate` and PLAN M3.6's.
 */
const OBSERVED_TRUTH = "true";

const gather = (rng: Rng, intel: IntelSource, context: ActionContext<NodeAction>): WorldState => {
  const { world, balance, action } = context;
  const lookout: Lookout = {
    world,
    balance,
    properties: propertiesAt(balance, world.map, action.nodeId),
  };
  const rolled = rng.float(world.rng);
  if (rolled.value >= intel.chance(lookout)) {
    return { ...world, rng: rolled.state };
  }
  const delayed = intel.delay(rng, lookout, rolled.state);
  return {
    ...world,
    rng: delayed.state,
    reports: [
      ...world.reports,
      makeReport({
        id: nextReportId(world.reports),
        source: intel.source,
        observedAtTurn: world.clock.turn,
        deliveryDelayTurns: delayed.value,
        content: observationAt(world, action.nodeId),
        truth: OBSERVED_TRUTH,
        accuracy: intel.accuracy(lookout),
      }),
    ],
  };
};

/** Knocking on doors is done in person, so what it learns is known the moment it is learned. */
const CANVASS_DELAY: Turn = 0;

/**
 * How many people talk is the district's witness density scaled by the hunter's standing with
 * the public, which is DESIGN.md's "low trust means fewer witness reports" taken literally; how
 * far they can be trusted is `sightingAccuracy`, which is the "and worse" half.
 */
const CANVASS: IntelSource = {
  source: "witness",
  chance: ({ world, balance, properties }) =>
    witnessDensityAt(balance, properties, world.clock.hour) *
    trustFactorOf(balance, world.hunter.trust),
  accuracy: ({ world, balance }) =>
    sightingAccuracy(balance.reports, trustFactorOf(balance, world.hunter.trust)),
  delay: (_rng, _lookout, state) => ({ state, value: CANVASS_DELAY }),
};

/**
 * DESIGN.md "Reports": reliable, delayed by one to two turns. Whether there is footage at all is
 * the district's `cctvCoverage`, so a pull on a park is money spent on nothing - which is what
 * the CCTV column of DESIGN.md's district table is for, and the hunter can read it before paying.
 * Reliability does not depend on public trust: a camera does not care what anyone thinks.
 */
const PULL_CCTV: IntelSource = {
  source: "cctv",
  chance: ({ properties }) => properties.cctvCoverage,
  accuracy: ({ balance }) => balance.reports.cctvAccuracy,
  delay: (rng, { balance }, state) =>
    rng.int(
      state,
      balance.actions.pullCctv.minDelayTurns,
      balance.actions.pullCctv.maxDelayTurns + 1,
    ),
};

const ACTION_TABLE: ActionTable = {
  roadblock: {
    target: "edge",
    cost: (balance) => ({
      actionPoints: balance.actions.roadblock.actionPointCost,
      budget: balance.actions.roadblock.budgetCost,
    }),
    trustChange: (balance) => -balance.actions.roadblock.trustCost,
    validate: validateRoadblock,
    apply: applyRoadblock,
  },
  canvass: {
    target: "node",
    cost: (balance) => ({
      actionPoints: balance.actions.canvass.actionPointCost,
      budget: balance.actions.canvass.budgetCost,
    }),
    trustChange: (balance) => -balance.actions.canvass.trustCost,
    validate: validateNodeTarget,
    apply: (deps, context) => gather(deps.rng, CANVASS, context),
  },
  pull_cctv: {
    target: "node",
    cost: (balance) => ({
      actionPoints: balance.actions.pullCctv.actionPointCost,
      budget: balance.actions.pullCctv.budgetCost,
    }),
    trustChange: () => NO_TRUST_CHANGE,
    validate: validateNodeTarget,
    apply: (deps, context) => gather(deps.rng, PULL_CCTV, context),
  },
  true_briefing: {
    target: "global",
    cost: (balance) => ({
      actionPoints: balance.actions.trueBriefing.actionPointCost,
      budget: balance.actions.trueBriefing.budgetCost,
    }),
    trustChange: (balance) => balance.actions.trueBriefing.trustGain,
    validate: noObjection,
    apply: unchanged,
  },
};

/**
 * The one unchecked step in the table. `ActionTable` types every entry against its own variant,
 * so each handler is written and checked narrowly; what the compiler cannot express is that the
 * entry found under `action.kind` is the entry for `action`, which the table's own keying makes
 * true. The alternative is handing every handler the whole union along with a guard clause none
 * of them can ever take.
 */
const definitionOf = (action: HunterAction): ActionDefinition<HunterAction> =>
  ACTION_TABLE[action.kind] as ActionDefinition<HunterAction>;

/** What the UI has to ask for before an action of this kind is well formed (PLAN M5.5). */
export const targetKindOf = (kind: HunterActionKind): ActionTargetKind => ACTION_TABLE[kind].target;

/**
 * The action's own rules are checked before its price. A malformed action is wrong however rich
 * the hunter is, and the UI wants to refuse an illegal target without the budget having a say.
 */
const validate = ({ world, action, balance }: ActionRequest): ActionValidation => {
  const definition = definitionOf(action);
  const objection = definition.validate({ world, balance, action });
  if (objection !== null) {
    return { kind: "rejected", reason: objection };
  }
  const cost = definition.cost(balance);
  if (cost.actionPoints > world.hunter.actionPoints) {
    return {
      kind: "rejected",
      reason: {
        kind: "not_enough_action_points",
        required: cost.actionPoints,
        available: world.hunter.actionPoints,
      },
    };
  }
  if (cost.budget > world.hunter.budget) {
    return {
      kind: "rejected",
      reason: {
        kind: "not_enough_budget",
        required: cost.budget,
        available: world.hunter.budget,
      },
    };
  }
  return { kind: "allowed", cost };
};

/**
 * Action points and budget are exact - validation has already refused anything that would put
 * either below zero - while trust is clamped, because a cost larger than the meter is a balance
 * setting rather than an illegal action.
 */
const charge = (
  world: WorldState,
  balance: Balance,
  cost: ActionCost,
  trustChange: number,
): WorldState => ({
  ...world,
  hunter: {
    ...world.hunter,
    actionPoints: world.hunter.actionPoints - cost.actionPoints,
    budget: world.hunter.budget - cost.budget,
    trust: clamp(
      world.hunter.trust + trustChange,
      balance.hunter.trustMin,
      balance.hunter.trustMax,
    ),
  },
});

export const createActionLogic = (deps: ActionDeps): ActionLogic => ({
  validate,
  apply: (request) => {
    const validation = validate(request);
    if (validation.kind === "rejected") {
      return validation;
    }
    const { world, action, balance } = request;
    const definition = definitionOf(action);
    const charged = charge(world, balance, validation.cost, definition.trustChange(balance));
    return { kind: "applied", world: definition.apply(deps, { world: charged, balance, action }) };
  },
});
