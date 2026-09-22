/**
 * How a hunt ends (DESIGN.md "End conditions"). One table of named conditions, checked in order,
 * rather than a chain of branches in the turn loop (architecture rule 6): a new ending is a new
 * entry here, and the consequences phase keeps calling one function.
 *
 * The table is total: capture, escape, trust collapse, casualties and the deadline. Capture was
 * the last to arrive (PLAN M3.11) and is not DESIGN.md's general co-location rule, which stays
 * unreachable while no MVP action puts a hunter unit on a node; it is the checkpoint the criminal
 * walked into, settled in the resolution phase and left on the criminal for this table to read.
 *
 * The conditions take a settings slice rather than the whole `Balance` so that a caller varying
 * one knob does not have to build a balance around it, and so that this file does not import
 * `balance.ts`, which imports `world.ts` for `GameOutcome`.
 */

import { type GameOutcome, IN_PROGRESS, type WorldState } from "./world";

/** Every way a hunt can end, derived so a new `GameOutcome` variant is a key here for free. */
export type EndConditionKind = Exclude<GameOutcome["kind"], "in_progress">;

export type EndConditionSettings = {
  readonly casualtiesToLose: number;
  readonly trustCollapseAt: number;
};

type EndCondition = (world: WorldState, settings: EndConditionSettings) => boolean;

type EndConditionEntry = {
  readonly kind: EndConditionKind;
  readonly holds: EndCondition;
};

/**
 * DESIGN.md "End conditions": in the MVP the only way to take the criminal is a checkpoint it did
 * not know was there. Whether one that was hit took anybody is the resolution phase's draw (PLAN
 * M3.11); what is left here is the fact, so this table holds no probability of its own.
 */
const hasBeenCaught: EndCondition = (world) => world.criminal.inCustody;

/**
 * Standing on an exit node is out (DESIGN.md "criminal escapes via exit"). `ExitSchedule` is not
 * read: no generator emits a `timed` exit yet (PLAN M2.1b), so a closed-for-now branch would be
 * unreachable. Timed exits (PLAN M7) belong here and nowhere else.
 */
const hasEscaped: EndCondition = (world) =>
  world.map.exits.some((exit) => exit.nodeId === world.criminal.nodeId);

/** DESIGN.md "Hunter resources": trust at 0 means removed from the case. */
const trustHasCollapsed: EndCondition = (world, settings) =>
  world.hunter.trust <= settings.trustCollapseAt;

/** DESIGN.md: "casualties >= threshold", so the threshold itself is the losing count. */
const casualtiesAreTooHigh: EndCondition = (world, settings) =>
  world.casualties >= settings.casualtiesToLose;

/**
 * DESIGN.md gives a hunt "at most ~24 turns" and then says nothing about what happens when they
 * run out, which is why this was the last ending to be written (PLAN M4.2a). The deadline is the
 * hunt's own, `config.maxTurns`, not a balance knob: it is the number the player's setup named and
 * the number a replay carries, so a hunt judged against anything else could not be replayed.
 *
 * Checked after the clock has ticked (see `outcomeAfter`), so a hunt with a deadline of `n` gets
 * exactly `n` turns and the stamp reads `n`.
 */
const theDeadlineHasPassed: EndCondition = (world) => world.clock.turn >= world.config.maxTurns;

/**
 * In `GameOutcome`'s own declaration order, which is also the order they are checked in: two
 * conditions can hold on the same turn - a criminal reaching an exit on the turn a bystander is
 * hurt - and the earlier entry names the hunt.
 *
 * `captured` leads, because a criminal in custody is not at large whatever else happened that
 * turn. `timed_out` is last, so every ending with a cause is named by its cause: the clock is what
 * is left when nothing else ended the hunt, and a criminal who walks out on the final turn escaped.
 */
export const END_CONDITIONS: readonly EndConditionEntry[] = [
  { kind: "captured", holds: hasBeenCaught },
  { kind: "escaped", holds: hasEscaped },
  { kind: "trust_collapsed", holds: trustHasCollapsed },
  { kind: "casualties_exceeded", holds: casualtiesAreTooHigh },
  { kind: "timed_out", holds: theDeadlineHasPassed },
];

export const isHuntOver = (outcome: GameOutcome): boolean => outcome.kind !== IN_PROGRESS.kind;

/**
 * The outcome a settled world has earned, stamped with the turn it happened on. It reads only the
 * world it is given, so the caller decides which moment is being judged; the consequences phase
 * asks after the clock has moved, which makes the stamp the number of turns played (PLAN M3.10
 * scores that as "turns taken").
 *
 * A hunt already over is refused by `step` before any phase runs, so this only ever sees a hunt in
 * progress and returns `IN_PROGRESS` when nothing holds rather than preserving `world.outcome`.
 */
export const outcomeAfter = (world: WorldState, settings: EndConditionSettings): GameOutcome => {
  const ended = END_CONDITIONS.find((condition) => condition.holds(world, settings));
  if (!ended) {
    return IN_PROGRESS;
  }
  return { kind: ended.kind, turn: world.clock.turn };
};
