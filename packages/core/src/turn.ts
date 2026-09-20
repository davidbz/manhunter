/**
 * One turn of the hunt, in DESIGN.md's own order ("Turn phases"): the reports the city filed
 * arrive, the world does what it does on its own, the hunter spends their action points, both
 * sides resolve at once, and then the meters and the clock move.
 *
 * All five are implemented: intel, events and consequences touch only the world (PLAN M3.8a),
 * planning spends the hunter's queue (PLAN M3.8b-1), and resolution moves the criminal and
 * settles what the two sides did to each other (PLAN M3.8b-2).
 *
 * `step` takes and returns a `SealedWorld`, like every exported game function (PLAN M3.1b). The
 * events it returns are the hunter's redacted form, because a `GameEvent` names which report is a
 * prank and this is the function `apps/web` calls every turn (PLAN M3.2's decision); the world it
 * returns still carries the unredacted feed, which `sim` reads through `unseal`.
 */

import type { ActionLogic, ActionRejection } from "./actions";
import { type CriminalAiLogic, criminalTraversalOf, toCriminalSituation } from "./ai";
import type { Balance } from "./balance";
import { type Belief, type BeliefLogic, toBeliefEvidence } from "./belief";
import {
  type CriminalAction,
  type CriminalState,
  trailAfter,
  withKnownRoadblock,
} from "./criminal";
import type { GameEvent, GameEventKind } from "./events";
import type { EventLogic, EventResult } from "./eventtable";
import type { GraphLogic, Neighbor } from "./graph";
import { blockedEdgeIdsAt, type HunterAction, type HunterState } from "./hunter";
import type { EdgeId } from "./ids";
import type { IntelLogic } from "./intel";
import { LIMITS } from "./limits";
import type { ReportContent, ReportTruth } from "./report";
import { type SealedWorld, seal, unseal } from "./sealed";
import { makeClock, type Turn } from "./time";
import { type HunterEvent, toHunterEvents, toHunterView } from "./view";
import type { WorldState } from "./world";

export type TurnRequest = {
  readonly world: SealedWorld;
  /** What the hunter wants done this turn, spent in order by the planning phase. */
  readonly actions: readonly HunterAction[];
  readonly balance: Balance;
};

/**
 * An action the hunter asked for and did not get. Carried out of the turn rather than thrown
 * (PLAN M3.3), so a queue of three where the second is unaffordable still plays the first and the
 * third and says what happened to the one in the middle.
 *
 * It names the position in the submitted queue rather than repeating the action: two identical
 * actions can fail for different reasons, so the index is what lets PLAN M5.5 mark the row the
 * player is looking at, and the caller already holds the list it sent.
 *
 * An `ActionRejection` names the hunter's own meters or the target they chose, never anything
 * about the criminal, so this shape is safe to hand to `apps/web` (architecture rule 4).
 */
export type PlanningRejection = {
  readonly index: number;
  readonly reason: ActionRejection;
};

export type TurnTaken = {
  readonly kind: "turn";
  readonly world: SealedWorld;
  /** What happened this turn, in the shape the hunter may see it in. */
  readonly events: readonly HunterEvent[];
  readonly rejections: readonly PlanningRejection[];
};

/**
 * A turn, or the one thing that stops a turn from being taken at all: a queue longer than
 * `LIMITS.maxQueuedActions`. That is a refusal of the request rather than a rejection inside it -
 * nothing about the world is looked at, and no part of the turn runs - which is why it is a
 * variant here and not another `PlanningRejection` (AGENTS.md section 5: oversized input is an
 * error result, never a truncation). Same shape as `GameResult`'s `deadline_too_long`.
 */
export type TurnResult =
  | TurnTaken
  | {
      readonly kind: "too_many_actions";
      readonly requestedActions: number;
      readonly maxActions: number;
    };

export type TurnLogic = {
  readonly step: (request: TurnRequest) => TurnResult;
};

type TurnDeps = {
  readonly intel: IntelLogic;
  readonly events: EventLogic;
  readonly belief: BeliefLogic;
  readonly action: ActionLogic;
  readonly ai: CriminalAiLogic;
  readonly graph: GraphLogic;
};

const ONE_TURN: Turn = 1;

const CASUALTY_EVENT: GameEventKind = "civilian_hurt";

const RECOGNISED: ReportTruth = "true";

const SIGHTING: ReportContent["kind"] = "sighting";

/** Every criminal meter is measured up from nothing; only their ceilings are balance. */
const METER_FLOOR = 0;

const NO_STAMINA_CHANGE = 0;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/**
 * Intel. The calls the city made unasked join the record. When each one becomes readable is the
 * clock's business and not this phase's: a report carries the turn it lands on and `toHunterView`
 * filters by it (PLAN M3.4a), so nothing is held in a queue and moved.
 *
 * `collect` returns reports and no world, so appending them is this phase and nothing else does
 * it (PLAN M3.6).
 */
const intelPhase = (deps: TurnDeps, world: WorldState, balance: Balance): WorldState => {
  const collected = deps.intel.collect({ world, balance });
  return { ...world, rng: collected.state, reports: [...world.reports, ...collected.value] };
};

/**
 * Events. `fire` owns the world it returns - the feed is appended and the stream advanced there -
 * and hands the list back beside it, so consequences reads what happened rather than diffing the
 * feed (PLAN M3.7a).
 *
 * It runs after intel because an announcement is about a report that is already in the world
 * (PLAN M3.7b).
 */
const eventsPhase = (deps: TurnDeps, world: WorldState, balance: Balance): EventResult =>
  deps.events.fire({ world, balance });

type PlanningResult = {
  readonly world: WorldState;
  readonly rejections: readonly PlanningRejection[];
};

/**
 * One queued action. `apply` validates before it charges and charges before it hands the world to
 * a handler (PLAN M3.3), so this owes neither: what it owes is that a refused action leaves the
 * world exactly as it found it, which is the world it carries forward on the rejected branch.
 *
 * Nothing here reads `action.kind`. Dispatch is `ACTION_TABLE`'s, so a new action is an entry in
 * that table and no branch in this phase (architecture rule 6).
 */
const spend = (
  deps: TurnDeps,
  balance: Balance,
  planned: PlanningResult,
  action: HunterAction,
  index: number,
): PlanningResult => {
  const result = deps.action.apply({ world: planned.world, action, balance });
  if (result.kind === "rejected") {
    return {
      world: planned.world,
      rejections: [...planned.rejections, { index, reason: result.reason }],
    };
  }
  return { world: result.world, rejections: planned.rejections };
};

/**
 * Planning: the hunter spends action points, in the order they queued them (DESIGN.md "Turn
 * phases"). Each action sees what the ones before it did, which is what makes a second roadblock
 * on one edge a refusal rather than a duplicate.
 *
 * The walk does not stop at the first refusal. Running out of action points halfway down a queue
 * is ordinary play, and a hunter who queued four things is owed an answer about all four rather
 * than about the first one that failed.
 *
 * Whether a finished hunt still accepts a queue is **PLAN M3.8c's**, not this phase's: the
 * question is really whether `step` runs at all once `outcome` is set, and a planning phase that
 * refused while intel still filed reports and the clock still ticked would be half an answer.
 * M3.8c is the task that sets an outcome, so it is the task that can test one.
 */
const planningPhase = (
  deps: TurnDeps,
  world: WorldState,
  actions: readonly HunterAction[],
  balance: Balance,
): PlanningResult =>
  actions.reduce<PlanningResult>(
    (planned, action, index) => spend(deps, balance, planned, action, index),
    { world, rejections: [] },
  );

type CriminalMove = Extract<CriminalAction, { readonly kind: "move" }>;

type Resolution = {
  readonly world: WorldState;
  /** What the criminal did with its turn, carried to consequences so the meters know. */
  readonly action: CriminalAction;
};

const cheaper = (best: Neighbor | null, candidate: Neighbor): Neighbor => {
  if (best !== null && best.cost <= candidate.cost) {
    return best;
  }
  return candidate;
};

/**
 * Which edge a move takes, or `null` when the map offers none. The graph searched is the one the
 * criminal planned on - its own travel mode, with the blocks it knows about removed - so the
 * route resolved is the route chosen rather than a second opinion about it. Ties go to the
 * cheapest and then to edge order, which keeps two roads between the same pair deterministic.
 */
const edgeTaken = (
  deps: TurnDeps,
  world: WorldState,
  balance: Balance,
  move: CriminalMove,
): EdgeId | null => {
  const traversal = criminalTraversalOf(balance, toCriminalSituation(world), move.travelMode);
  const taken = deps.graph
    .neighbors(traversal, world.criminal.nodeId)
    .filter((neighbor) => neighbor.nodeId === move.toNodeId)
    .reduce<Neighbor | null>(cheaper, null);
  return taken === null ? null : taken.edgeId;
};

/**
 * The move, against the world as the phase found it. Three ways for it to end: no such edge, so
 * the criminal stays where it is; a checkpoint on it, so the criminal is stopped short and now
 * knows where that checkpoint is; or through, at the cost of the walk.
 *
 * A stopped criminal keeps its travel mode as well as its node. The move did not happen, and the
 * only thing it leaves behind is the knowledge - which is what makes a roadblock surprise the
 * criminal exactly once (DESIGN.md "Criminal AI": it sees the roadblocks it would plausibly know
 * about, and it meets this one by walking into it).
 */
const movedCriminal = (
  deps: TurnDeps,
  world: WorldState,
  balance: Balance,
  move: CriminalMove,
): CriminalState => {
  const edgeId = edgeTaken(deps, world, balance, move);
  if (edgeId === null) {
    return world.criminal;
  }
  if (blockedEdgeIdsAt(world.hunter.containments, world.clock.turn).has(edgeId)) {
    return { ...world.criminal, knowledge: withKnownRoadblock(world.criminal.knowledge, edgeId) };
  }
  return { ...world.criminal, nodeId: move.toNodeId, travelMode: move.travelMode };
};

/**
 * Where the criminal is when the turn's dust settles, and how it got there. The trail is appended
 * here and nowhere else, for every action rather than only for a move: it counts turns, not
 * places, so a criminal that hid is a criminal that was somewhere for a turn.
 */
const resolvedCriminal = (
  deps: TurnDeps,
  world: WorldState,
  balance: Balance,
  action: CriminalAction,
): CriminalState => {
  const settled =
    action.kind === "move" ? movedCriminal(deps, world, balance, action) : world.criminal;
  return { ...settled, trail: trailAfter(world.criminal) };
};

/**
 * Resolution: the criminal chooses its move from its own knowledge and both sides resolve at once
 * (DESIGN.md "Turn phases").
 *
 * Simultaneity is structural rather than asserted. The decision is taken from
 * `toCriminalSituation(world)` and every rule below reads that same `world` - the one the phase
 * was handed - so there is no half-changed state for either side to read, and the order the two
 * are evaluated in cannot change the answer. The hunter's half of the turn is already in that
 * snapshot: planning spends the queue before resolution runs, which is DESIGN.md's phase order,
 * so a roadblock placed this turn is standing when the criminal walks into it this turn.
 *
 * What the criminal knows and what actually stops it are different things, and keeping them apart
 * is this phase's whole job. A known block is structural - `criminalTraversalOf` takes it out of
 * the graph the AI searches, so the AI needs no rule about it - while an unknown one stops a move
 * that was made in good faith.
 *
 * Capture is not settled here. DESIGN.md's win is both sides standing on one node, and in the MVP
 * the hunter stands on none: a roadblock is an edge, and no MVP action puts a unit anywhere (PLAN
 * M6 owns the ones that do). So the co-location has one side missing, and writing the test for it
 * would be writing a branch nothing can reach. What this phase owes PLAN M3.8c is the criminal's
 * true final position, which the world now carries turn by turn; the rule that reads it is
 * M3.8c's, and the Inbox carries the gap.
 */
const resolutionPhase = (deps: TurnDeps, world: WorldState, balance: Balance): Resolution => {
  const decision = deps.ai.choose({
    situation: toCriminalSituation(world),
    balance,
    state: world.rng,
  });
  return {
    world: {
      ...world,
      rng: decision.state,
      criminal: resolvedCriminal(deps, world, balance, decision.value),
    },
    action: decision.value,
  };
};

/** DESIGN.md "Events": harm is what turns a manhunt into a political problem. */
const harmedThisTurn = (fired: readonly GameEvent[]): number =>
  fired.filter((event) => event.kind === CASUALTY_EVENT).length;

/**
 * Political pressure rises with the clock and jumps when somebody is hurt (DESIGN.md "Hunter
 * resources"). Nothing reads it in the MVP - the override events it would trigger are PLAN M6 -
 * so it exists to be shown, and it is deliberately not a score component, because it tracks turns
 * taken and PLAN M3.10 already scores those.
 *
 * Clamped rather than assumed in range: the jump is balance, and a meter that ran past its top
 * would be a display the UI has to defend itself against.
 */
const nextPressure = (world: WorldState, balance: Balance, fired: readonly GameEvent[]): number =>
  clamp(
    world.hunter.pressure +
      balance.hunter.pressurePerTurn +
      balance.hunter.pressurePerCasualty * harmedThisTurn(fired),
    balance.hunter.pressureMin,
    balance.hunter.pressureMax,
  );

/**
 * Action points are an allowance per turn (DESIGN.md "Hunter resources"), so the end of a turn is
 * where they come back. Spending them belongs to planning (PLAN M3.8b); granting them belongs
 * here, because this is the only phase that knows a turn has ended.
 *
 * Trust is not touched: it moves when an action pays for it (PLAN M3.3), and `actions.ts` clamps
 * it there.
 */
const nextHunter = (
  world: WorldState,
  balance: Balance,
  fired: readonly GameEvent[],
): HunterState => ({
  ...world.hunter,
  actionPoints: balance.hunter.actionPointsPerTurn,
  pressure: nextPressure(world, balance, fired),
});

/**
 * The heatmap's whole statefulness: one turn of spread over this turn's evidence (PLAN M3.6b).
 *
 * The evidence is built out of the hunter's own view and never out of the world directly. The
 * criminal's true position is in scope in this file, and `toBeliefEvidence(toHunterView(...))` is
 * what keeps it out of the hunter's inference (architecture rule 4, PLAN M3.6b's last criterion).
 *
 * It runs before the clock moves, because a report is evidence on the turn it lands.
 */
const nextBelief = (deps: TurnDeps, world: WorldState, balance: Balance): Belief =>
  deps.belief.advance({
    belief: world.belief,
    evidence: toBeliefEvidence(toHunterView(seal(world))),
    balance,
  });

/**
 * What a turn costs the legs, by what the criminal spent it on. A table rather than a branch
 * (architecture rule 6): a new `CriminalAction` variant fails to compile here until it says what
 * it costs. A move a checkpoint turned back still costs the walk, because the walking happened.
 */
const STAMINA_CHANGE: Readonly<Record<CriminalAction["kind"], (balance: Balance) => number>> = {
  move: (balance) => -balance.criminal.staminaPerMove,
  rest: (balance) => balance.criminal.staminaPerRest,
  hide: () => NO_STAMINA_CHANGE,
  wait: () => NO_STAMINA_CHANGE,
};

/**
 * How many times the criminal was recognised this turn. A sighting the hunter paid for and a call
 * the city made unasked count alike: what raises heat is having been seen and named, so a witness
 * who named the wrong node, a prank, and a look that found nobody all count for nothing.
 *
 * It reads the reports rather than the criminal's position on purpose. Heat is how recognisable
 * the criminal has become, which is a fact about who saw it and not about where it stood.
 */
const recognitionsThisTurn = (world: WorldState): number =>
  world.reports.filter(
    (report) =>
      report.observedAtTurn === world.clock.turn &&
      report.truth === RECOGNISED &&
      report.content.kind === SIGHTING,
  ).length;

/**
 * The criminal's own meters (DESIGN.md "Criminal AI"). Heat is recognizability, so it cools every
 * turn and jumps for every report that recognised the face; stamina is spent moving and bought
 * back resting; desperation only ever climbs, which is what makes a long hunt a different hunt.
 *
 * They advance here rather than in resolution because they are consequences, and the action they
 * are consequences of is carried out of resolution rather than re-derived from the two positions:
 * a move a roadblock turned back moved nobody and still cost a turn of walking.
 *
 * Clamped for `nextPressure`'s reason: every step is balance, and a sweep (PLAN M4.3) may set any
 * of them past what the meter can hold.
 */
const nextCriminal = (
  world: WorldState,
  balance: Balance,
  action: CriminalAction,
): CriminalState => ({
  ...world.criminal,
  stamina: clamp(
    world.criminal.stamina + STAMINA_CHANGE[action.kind](balance),
    METER_FLOOR,
    balance.criminal.staminaMax,
  ),
  heat: clamp(
    world.criminal.heat -
      balance.criminal.heatDecayPerTurn +
      balance.criminal.heatPerSighting * recognitionsThisTurn(world),
    METER_FLOOR,
    balance.criminal.heatMax,
  ),
  desperation: clamp(
    world.criminal.desperation + balance.criminal.desperationPerTurn,
    METER_FLOOR,
    balance.criminal.desperationMax,
  ),
});

/**
 * Consequences: the meters and the clock. End conditions are checked here too from PLAN M3.8c;
 * nothing in this task can produce a finished world, so the outcome is left as it was found.
 */
const consequencesPhase = (
  deps: TurnDeps,
  resolved: Resolution,
  balance: Balance,
  fired: readonly GameEvent[],
): WorldState => ({
  ...resolved.world,
  clock: makeClock(resolved.world.config.startHour, resolved.world.clock.turn + ONE_TURN),
  hunter: nextHunter(resolved.world, balance, fired),
  criminal: nextCriminal(resolved.world, balance, resolved.action),
  belief: nextBelief(deps, resolved.world, balance),
});

/**
 * The queue is bounded before the turn begins, not when planning reaches it. It is caller-supplied
 * input (AGENTS.md section 5) and the check costs a length, so refusing it after intel has filed
 * reports and the events table has drawn would mean an error result naming a turn that had
 * already half happened.
 */
export const createTurnLogic = (deps: TurnDeps): TurnLogic => ({
  step: ({ world, actions, balance }) => {
    if (actions.length > LIMITS.maxQueuedActions) {
      return {
        kind: "too_many_actions",
        requestedActions: actions.length,
        maxActions: LIMITS.maxQueuedActions,
      };
    }
    const filed = intelPhase(deps, unseal(world), balance);
    const fired = eventsPhase(deps, filed, balance);
    const planned = planningPhase(deps, fired.world, actions, balance);
    const resolved = resolutionPhase(deps, planned.world, balance);
    return {
      kind: "turn",
      world: seal(consequencesPhase(deps, resolved, balance, fired.events)),
      events: toHunterEvents(fired.events),
      rejections: planned.rejections,
    };
  },
});
