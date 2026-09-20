/**
 * How a hunt ends (DESIGN.md "End conditions"). One table of named conditions, checked in order,
 * rather than a chain of branches in the turn loop (architecture rule 6): a new ending is a new
 * entry here, and the consequences phase keeps calling one function.
 *
 * Three of the four are implemented: escape, trust collapse and casualties. `captured` is a
 * `GameOutcome` variant with no entry in this table, because the MVP has no hunter position on
 * the map and therefore no way for the two sides to stand on one node (PLAN Inbox, owned by
 * M3.8c). A branch no test can reach is worse than an absent one, so the win condition waits for
 * the design answer; landing it is one entry below, `{ kind: "captured", holds: ... }`, first in
 * the list, and nothing else in this file or in `turn.ts` changes.
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
 * Standing on an exit node is out (DESIGN.md "criminal escapes via exit"). `ExitSchedule` is not
 * read: no generator emits a `timed` exit yet (PLAN M2.1b), so a closed-for-now branch would be
 * unreachable. Timed exits (PLAN M6) belong here and nowhere else.
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
 * In `GameOutcome`'s own declaration order minus the missing one, which is also the order they
 * are checked in: two conditions can hold on the same turn - a criminal reaching an exit on the
 * turn a bystander is hurt - and the earlier entry names the hunt.
 */
export const END_CONDITIONS: readonly EndConditionEntry[] = [
  { kind: "escaped", holds: hasEscaped },
  { kind: "trust_collapsed", holds: trustHasCollapsed },
  { kind: "casualties_exceeded", holds: casualtiesAreTooHigh },
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
