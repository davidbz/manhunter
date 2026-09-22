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
import { isHuntOver, outcomeAfter } from "./endconditions";
import type { GameEvent, GameEventKind } from "./events";
import type { EventLogic, EventResult } from "./eventtable";
import type { GraphLogic, Neighbor } from "./graph";
import { blockedEdgeIdsAt, type HunterAction, type HunterState } from "./hunter";
import type { EdgeId } from "./ids";
import type { IntelLogic } from "./intel";
import { LIMITS } from "./limits";
import type { ReportContent, ReportTruth } from "./report";
import type { Rng, RngDraw, RngState } from "./rng";
import { type SealedWorld, seal, unseal } from "./sealed";
import { makeClock, type Turn } from "./time";
import { type HunterEvent, toHunterEvents, toHunterView } from "./view";
import type { GameOutcome, WorldState } from "./world";

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
 * A turn, or one of the two things that stop a turn from being taken at all. Both are refusals of
 * the request rather than rejections inside it - no part of the turn runs - which is why they are
 * variants here and not more `PlanningRejection`s. Same shape as `GameResult`'s failures.
 *
 * `too_many_actions` is a queue longer than `LIMITS.maxQueuedActions`, refused without the world
 * being looked at (AGENTS.md section 5: oversized input is an error result, never a truncation).
 *
 * `hunt_over` is a world whose `outcome` is already settled (PLAN M3.8b-1 handed this to M3.8c).
 * The alternative - letting the phases run and having planning refuse the actions - would file
 * reports, draw events and tick the clock on a hunt that had already ended, and would put the
 * end-condition rule in two places. Refusing the whole call instead makes a finished world a fixed
 * point: a replay (PLAN M3.9) that steps past the end gets the same final state as one that stops,
 * however many times the caller asks. The outcome comes back because the caller may be a bot with
 * no view, and `GameOutcome` is hunter-visible (`view.ts`), so it is safe to hand over.
 */
export type TurnResult =
  | TurnTaken
  | {
      readonly kind: "too_many_actions";
      readonly requestedActions: number;
      readonly maxActions: number;
    }
  | {
      readonly kind: "hunt_over";
      readonly outcome: GameOutcome;
    };

export type TurnLogic = {
  readonly step: (request: TurnRequest) => TurnResult;
};

type TurnDeps = {
  /**
   * The loop's own draw, and it has exactly one: whether a checkpoint takes the criminal that
   * walked into it (`intercepted`). Every other phase draws from the stream through the logic it
   * is made of, which is why this dep arrived last (PLAN M3.11).
   */
  readonly rng: Rng;
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
 * A finished hunt never reaches this phase. PLAN M3.8b-1 left the question here and M3.8c
 * answered it at the top of `step`, where refusing costs no half-played turn.
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
 * A criminal walking into a checkpoint nobody told it about: taken, or through by the width of a
 * hair (DESIGN.md "End conditions"). This is the MVP's only capture, because it is the only thing
 * a shipped hunter action can do to the criminal's own turn (PLAN M3.11).
 *
 * **Only a block the criminal did not know about can reach this.** A known one is not in the graph
 * it planned on (`criminalTraversalOf`), so `edgeTaken` never hands that edge back and a checkpoint
 * the criminal has already met can turn it around but can never take it.
 *
 * The draw lives here rather than at the top of the phase, so it is made exactly once per
 * collision and not at all on the turns - almost all of them - where nobody hits anything.
 *
 * Either way the move did not happen, the travel mode is kept, and the block is now known: a
 * checkpoint surprises the criminal exactly once, and a criminal that slipped through one it now
 * knows about routes around it from the next turn on.
 */
const intercepted = (
  deps: TurnDeps,
  criminal: CriminalState,
  balance: Balance,
  edgeId: EdgeId,
  state: RngState,
): RngDraw<CriminalState> => {
  const drawn = deps.rng.float(state);
  const stopped: CriminalState = {
    ...criminal,
    knowledge: withKnownRoadblock(criminal.knowledge, edgeId),
  };
  if (drawn.value < balance.actions.roadblock.slipPastChance) {
    return { state: drawn.state, value: stopped };
  }
  return { state: drawn.state, value: { ...stopped, inCustody: true } };
};

/**
 * The move, against the world as the phase found it. Three ways for it to end: no such edge, so
 * the criminal stays where it is; through, at the cost of the walk; or a checkpoint on it, which
 * is the one ending the hunter can cause and is settled by `intercepted`.
 */
const movedCriminal = (
  deps: TurnDeps,
  world: WorldState,
  balance: Balance,
  move: CriminalMove,
  state: RngState,
): RngDraw<CriminalState> => {
  const edgeId = edgeTaken(deps, world, balance, move);
  if (edgeId === null) {
    return { state, value: world.criminal };
  }
  if (!blockedEdgeIdsAt(world.hunter.containments, world.clock.turn).has(edgeId)) {
    return {
      state,
      value: { ...world.criminal, nodeId: move.toNodeId, travelMode: move.travelMode },
    };
  }
  return intercepted(deps, world.criminal, balance, edgeId, state);
};

/**
 * Where the criminal is when the turn's dust settles, and how it got there. The trail is appended
 * here and nowhere else, for every action rather than only for a move: it counts turns, not
 * places, so a criminal that hid is a criminal that was somewhere for a turn.
 *
 * The stream comes in and goes out because a move can cost a draw and everything else cannot,
 * which is what keeps a turn with no collision in it drawing exactly what it always drew.
 */
const resolvedCriminal = (
  deps: TurnDeps,
  world: WorldState,
  balance: Balance,
  action: CriminalAction,
  state: RngState,
): RngDraw<CriminalState> => {
  const settled =
    action.kind === "move"
      ? movedCriminal(deps, world, balance, action, state)
      : { state, value: world.criminal };
  return { state: settled.state, value: { ...settled.value, trail: trailAfter(world.criminal) } };
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
 * Capture is settled here, and by one rule: a criminal that walks into a checkpoint it did not
 * know about is taken or slips past (`intercepted`, DESIGN.md "End conditions"). Co-location -
 * both sides standing on one node - is still the general win and is still unreachable, because no
 * MVP action puts a hunter unit anywhere (PLAN M6 owns the ones that do). This phase leaves the
 * fact on the criminal; the rule that reads it and ends the hunt is `endconditions.ts`'s.
 *
 * The draw is the only one the loop itself makes, and it is taken from where the criminal's own
 * chooser left the stream, so the whole phase is one continuous position in it.
 */
const resolutionPhase = (deps: TurnDeps, world: WorldState, balance: Balance): Resolution => {
  const decision = deps.ai.choose({
    situation: toCriminalSituation(world),
    balance,
    state: world.rng,
  });
  const settled = resolvedCriminal(deps, world, balance, decision.value, decision.state);
  return {
    world: { ...world, rng: settled.state, criminal: settled.value },
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
 * Consequences: the meters, the clock, and then the end conditions, in DESIGN.md's own order
 * ("meters update, the clock advances, end conditions are checked").
 *
 * The order is load-bearing twice. The conditions read the meters this turn moved, so an exit
 * reached in resolution and a bystander hurt in the events phase are both judged on the turn they
 * happened. And they are asked after the clock has moved, so `outcome.turn` is the number of turns
 * the hunt lasted rather than the index of the last one.
 *
 * Which conditions exist is `endconditions.ts`'s business, not this phase's (architecture rule 6).
 */
const consequencesPhase = (
  deps: TurnDeps,
  resolved: Resolution,
  balance: Balance,
  fired: readonly GameEvent[],
): WorldState => {
  const settled: WorldState = {
    ...resolved.world,
    clock: makeClock(resolved.world.config.startHour, resolved.world.clock.turn + ONE_TURN),
    hunter: nextHunter(resolved.world, balance, fired),
    criminal: nextCriminal(resolved.world, balance, resolved.action),
    belief: nextBelief(deps, resolved.world, balance),
  };

  return { ...settled, outcome: outcomeAfter(settled, balance.endConditions) };
};

/**
 * Both refusals are settled before the turn begins, not when a phase reaches them. They are
 * caller-supplied input (AGENTS.md section 5) and cost a length and a field to check, so refusing
 * after intel has filed reports and the events table has drawn would mean an error result naming a
 * turn that had already half happened.
 *
 * The queue is checked first: it is a bound on the request itself, and a request that breaks it is
 * malformed whether or not the world it names is still running.
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
    const opening = unseal(world);
    if (isHuntOver(opening.outcome)) {
      return { kind: "hunt_over", outcome: opening.outcome };
    }
    const filed = intelPhase(deps, opening, balance);
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
