/**
 * The turn being planned, as one value (PLAN M7.3): the orders queued, the tool armed, and the
 * last order the queue refused. `DispatchScreen` holds it in a single piece of state, so the board,
 * the map and the queue all read the same plan, and every change to it is a pure function here.
 *
 * **Sticky tools.** Clicking a target the armed tool accepts places the order at once, and the
 * tool stays armed exactly while `canQueue` says the plan could take another of the same kind; a
 * global order has no target, so arming its tool places it. Arming a tile the plan can no longer
 * afford changes nothing, which is the keyboard's path to a tile the board shows disabled.
 *
 * **Narrowing.** A click is taken only if the armed tool accepts its kind of target
 * (`acceptsTarget`) and the map would not dim it (`selectionSelectable`, the absorbed M6.5 Inbox
 * item), so an unblockable or already-closed road is refused here, not by `core` at End Turn.
 *
 * The selection, the focused node and the hovered target are not part of the plan: they are where
 * the player is looking, and none of them is ever turned into an order except by a click.
 */

import {
  type HunterAction,
  type HunterActionKind,
  type MapEdge,
  targetKindOf,
} from "@manhunter/core";
import {
  type ActionTarget,
  acceptsTarget,
  buildAction,
  GLOBAL_TARGET,
  targetOf,
} from "./actiondraft";
import {
  type ActionQueue,
  canQueue,
  EMPTY_QUEUE,
  enqueue,
  type PlanAccount,
  type QueueRefusal,
  removeAt,
} from "./actionqueue";
import type { MapSelection } from "./maprenderer";
import { type MapSelectable, selectionSelectable } from "./mapselectable";

export type DispatchPlan = {
  readonly queue: ActionQueue;
  readonly armed: HunterActionKind | null;
  readonly refusal: QueueRefusal | null;
};

export const EMPTY_PLAN: DispatchPlan = { queue: EMPTY_QUEUE, armed: null, refusal: null };

/** What a map click is judged against: the plan's account, what the tool may target, the edges. */
export type TargetContext = {
  readonly account: PlanAccount;
  readonly selectable: MapSelectable | null;
  readonly edges: readonly MapEdge[];
};

/** Queue `action`, or keep the plan and record why not. The tool stays armed while it can repeat. */
export const placeOrder = (
  plan: DispatchPlan,
  action: HunterAction,
  account: PlanAccount,
): DispatchPlan => {
  const result = enqueue(plan.queue, action, account);
  if (result.kind !== "queue") return { ...plan, refusal: result };

  const armed = canQueue(result.queue, action.kind, account) ? action.kind : null;

  return { queue: result.queue, armed, refusal: null };
};

/** Arm `kind`'s tool; a global order is placed on the spot. Nothing changes if it is unaffordable. */
export const armTool = (
  plan: DispatchPlan,
  kind: HunterActionKind,
  account: PlanAccount,
): DispatchPlan => {
  if (!canQueue(plan.queue, kind, account)) return plan;

  const armed = { ...plan, armed: kind };
  if (targetKindOf(kind) !== GLOBAL_TARGET.kind) return armed;

  const action = buildAction(kind, GLOBAL_TARGET);

  return action === null ? armed : placeOrder(armed, action, account);
};

export const disarmTool = (plan: DispatchPlan): DispatchPlan => ({ ...plan, armed: null });

/** A click on the map while a tool is armed: place the order there, or ignore the click. */
export const clickTarget = (
  plan: DispatchPlan,
  target: MapSelection,
  context: TargetContext,
): DispatchPlan => {
  if (plan.armed === null || !targetAccepted(plan.armed, target, context)) return plan;

  const action = buildAction(plan.armed, target);

  return action === null ? plan : placeOrder(plan, action, context.account);
};

export const removeOrder = (plan: DispatchPlan, index: number): DispatchPlan => ({
  ...plan,
  queue: removeAt(plan.queue, index),
  refusal: null,
});

/** Whether the armed tool would take this target: its kind, and not dimmed on the map. */
export const targetAccepted = (
  kind: HunterActionKind,
  target: MapSelection,
  context: Pick<TargetContext, "selectable" | "edges">,
): boolean =>
  acceptsTarget(kind, target) && selectionSelectable(context.selectable, target, context.edges);

/** The armed tool pointed at the hovered target, when it would take it; the ghost and ready line. */
export type PlanDraft = {
  readonly target: ActionTarget | null;
  readonly draft: HunterAction | null;
};

const NO_DRAFT: PlanDraft = { target: null, draft: null };

export const draftOf = (
  armed: HunterActionKind | null,
  hovered: MapSelection | null,
  context: Pick<TargetContext, "selectable" | "edges">,
): PlanDraft => {
  if (armed === null) return NO_DRAFT;

  const aimed = hovered !== null && targetAccepted(armed, hovered, context) ? hovered : null;
  const target = targetOf(armed, aimed);

  return { target, draft: target === null ? null : buildAction(armed, target) };
};
