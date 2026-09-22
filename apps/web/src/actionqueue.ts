/**
 * The actions staged for this turn, and the one bound on how many of them there can be
 * (PLAN M5.5b).
 *
 * The queue is built a click at a time, so it is user input and is bounded where it accumulates
 * rather than at the far end: `enqueue` refuses the row that would go over
 * `LIMITS.maxQueuedActions` and returns the queue it was given untouched, never a truncation
 * (AGENTS.md section 5). Handing `core` a queue it would refuse with `too_many_actions` costs the
 * player the whole turn, which is exactly the trade the bound exists to avoid.
 *
 * Pure data and pure functions, the way `actiondraft.ts` is: nothing here holds the queue, the
 * screen does. `actionSummary` is the one piece of language, and it reads its label from
 * `ACTION_PRESENTATION` so the queue and the board cannot call the same action two things.
 */

import type { HunterAction } from "@manhunter/core";
import { ACTION_PRESENTATION, GLOBAL_TARGET_LABEL } from "./actionpanel";
import { LIMITS } from "./limits";

export type ActionQueue = readonly HunterAction[];

export const EMPTY_QUEUE: ActionQueue = [];

/** Why a row was not taken. The queue is `web`'s own boundary, so this is `web`'s own refusal. */
export type QueueRefusal = {
  readonly kind: "too_many_queued";
  readonly queued: number;
  readonly maxQueued: number;
};

export type QueueResult = { readonly kind: "queue"; readonly queue: ActionQueue } | QueueRefusal;

export const enqueue = (queue: ActionQueue, action: HunterAction): QueueResult => {
  if (queue.length >= LIMITS.maxQueuedActions) {
    return { kind: "too_many_queued", queued: queue.length, maxQueued: LIMITS.maxQueuedActions };
  }

  return { kind: "queue", queue: [...queue, action] };
};

/** Drops the row at `index` and nothing else. An index no row has leaves the queue as it was. */
export const removeAt = (queue: ActionQueue, index: number): ActionQueue =>
  queue.filter((_, position) => position !== index);

/**
 * The id the action points at, read by presence rather than by re-deciding its target kind -
 * `actiondraft.ts`'s `ACTION_BUILDS` makes the same call for the same reason.
 */
const targetIdOf = (action: HunterAction): string | null => {
  if ("edgeId" in action) return action.edgeId;
  if ("nodeId" in action) return action.nodeId;

  return null;
};

const SUMMARY_SEPARATOR = " - ";

/** What one queued row reads as, and what a rejection names when it points at that row. */
export const actionSummary = (action: HunterAction): string =>
  [
    ACTION_PRESENTATION[action.kind].label,
    SUMMARY_SEPARATOR,
    targetIdOf(action) ?? GLOBAL_TARGET_LABEL,
  ].join("");

/** One row of the queue, ready to draw. The same data-then-markup split `metersOf` makes. */
export type QueueRow = {
  readonly index: number;
  readonly action: HunterAction;
  readonly summary: string;
};

/**
 * The queue as rows. The position is carried on the row rather than recovered at render time,
 * because it is what `onRemove` names and what a `PlanningRejection` will name once the turn is
 * submitted: an ordered queue has no identity other than where a row sits in it.
 */
export const queueRows = (queue: ActionQueue): readonly QueueRow[] =>
  queue.map((action, index) => ({ index, action, summary: actionSummary(action) }));
