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
 * **The plan is priced as it grows (PLAN M7.3).** `remainingAfter` is what the hunter would hold
 * once every queued order is paid for, in the order `core` will pay for them, and `enqueue`
 * refuses an order that remainder cannot cover with the same two refusals `core`'s `validate`
 * would return at End Turn - `not_enough_action_points` before `not_enough_budget` - so the
 * player learns it on the click rather than after the turn. The count bound is checked first,
 * because it is the boundary's own limit and holds whatever the meters say.
 *
 * Pure data and pure functions, the way `actiondraft.ts` is: nothing here holds the queue, the
 * screen does. `actionSummary` is the one piece of language, and it reads its label from
 * `ACTION_PRESENTATION` so the queue and the board cannot call the same action two things, and
 * names its target by the hunt's place names (PLAN M7.1), never by id.
 */

import type { Balance, HunterAction, HunterActionKind } from "@manhunter/core";
import { ACTION_PRESENTATION, GLOBAL_TARGET_LABEL } from "./actionpanel";
import { LIMITS } from "./limits";
import { edgeNameOf, nodeNameOf, type PlaceNames } from "./placenames";
import { type PlanResources, planCostOf } from "./plancost";

export type ActionQueue = readonly HunterAction[];

export const EMPTY_QUEUE: ActionQueue = [];

/**
 * Why a row was not taken. The queue is `web`'s own boundary, so this is `web`'s own refusal; the
 * two meter refusals carry `core`'s names and fields, because they are the same question asked a
 * turn earlier.
 */
export type QueueRefusal =
  | {
      readonly kind: "too_many_queued";
      readonly queued: number;
      readonly maxQueued: number;
    }
  | {
      readonly kind: "not_enough_action_points";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly kind: "not_enough_budget";
      readonly required: number;
      readonly available: number;
    };

export type QueueResult = { readonly kind: "queue"; readonly queue: ActionQueue } | QueueRefusal;

/** What a plan is billed against: the meters the hunter holds, and the prices in `balance`. */
export type PlanAccount = {
  readonly resources: PlanResources;
  readonly balance: Balance;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/**
 * What the hunter holds once every order in `queue` is paid for, one order at a time the way
 * `core`'s `charge` does: action points and budget exactly, trust clamped to its bounds after each
 * order. Nothing is refused here, so a queue that overspends reads as a negative remainder rather
 * than a remainder that stops at zero; that is what `enqueue` never lets happen, and what a
 * forecast of a queue built some other way must be able to show.
 */
export const remainingAfter = (
  resources: PlanResources,
  queue: ActionQueue,
  balance: Balance,
): PlanResources =>
  queue.reduce<PlanResources>((held, action) => {
    const cost = planCostOf(action.kind, balance);

    return {
      actionPoints: held.actionPoints - cost.actionPoints,
      budget: held.budget - cost.budget,
      trust: clamp(held.trust + cost.trust, balance.hunter.trustMin, balance.hunter.trustMax),
    };
  }, resources);

/** The meter the plan's remainder cannot cover for one more `kind`, or `null` when it can. */
const shortfallOf = (
  queue: ActionQueue,
  kind: HunterActionKind,
  account: PlanAccount,
): QueueRefusal | null => {
  const remaining = remainingAfter(account.resources, queue, account.balance);
  const cost = planCostOf(kind, account.balance);
  if (cost.actionPoints > remaining.actionPoints) {
    return {
      kind: "not_enough_action_points",
      required: cost.actionPoints,
      available: remaining.actionPoints,
    };
  }
  if (cost.budget > remaining.budget) {
    return { kind: "not_enough_budget", required: cost.budget, available: remaining.budget };
  }

  return null;
};

export const enqueue = (
  queue: ActionQueue,
  action: HunterAction,
  account: PlanAccount,
): QueueResult => {
  if (queue.length >= LIMITS.maxQueuedActions) {
    return { kind: "too_many_queued", queued: queue.length, maxQueued: LIMITS.maxQueuedActions };
  }

  return shortfallOf(queue, action.kind, account) ?? { kind: "queue", queue: [...queue, action] };
};

/** Whether `enqueue` would take one more order of `kind`: the question a sticky tool asks. */
export const canQueue = (
  queue: ActionQueue,
  kind: HunterActionKind,
  account: PlanAccount,
): boolean => queue.length < LIMITS.maxQueuedActions && shortfallOf(queue, kind, account) === null;

/** Drops the row at `index` and nothing else. An index no row has leaves the queue as it was. */
export const removeAt = (queue: ActionQueue, index: number): ActionQueue =>
  queue.filter((_, position) => position !== index);

/**
 * What the place the action points at is called, read by presence rather than by re-deciding its
 * target kind - `actiondraft.ts`'s `ACTION_BUILDS` makes the same call for the same reason.
 */
export const targetNameOf = (action: HunterAction, names: PlaceNames): string => {
  if ("edgeId" in action) return edgeNameOf(names, action.edgeId);
  if ("nodeId" in action) return nodeNameOf(names, action.nodeId);

  return GLOBAL_TARGET_LABEL;
};

const SUMMARY_SEPARATOR = " - ";

/** What one queued row reads as, and what a rejection names when it points at that row. */
export const actionSummary = (action: HunterAction, names: PlaceNames): string =>
  [ACTION_PRESENTATION[action.kind].label, SUMMARY_SEPARATOR, targetNameOf(action, names)].join("");

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
export const queueRows = (queue: ActionQueue, names: PlaceNames): readonly QueueRow[] =>
  queue.map((action, index) => ({ index, action, summary: actionSummary(action, names) }));
