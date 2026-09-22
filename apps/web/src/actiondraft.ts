/**
 * The half-built action (PLAN M5.5a): the kind the player has armed, whatever they have picked on
 * the map, and the one place the two become a `HunterAction`.
 *
 * Which target an action accepts is `core`'s answer and only `core`'s. `targetKindOf` is read on
 * every question this module answers, so an action added to `core`'s `ACTION_TABLE` narrows the
 * map here without an edit, and nothing below restates a target kind or a cost.
 *
 * A mismatched pair is unrepresentable rather than merely refused: `HunterAction` has no variant
 * carrying a `nodeId` under `kind: "roadblock"`, so the wrong pair cannot be written at all.
 * `buildAction` returns `null` instead of something malformed, which is what stops a caller
 * skipping the question.
 */

import { type HunterAction, type HunterActionKind, targetKindOf } from "@manhunter/core";
import type { MapSelection } from "./maprenderer";

/** The one `ActionTargetKind` no map selection can produce: a global action points at nothing. */
const GLOBAL = "global";

export type GlobalTarget = { readonly kind: typeof GLOBAL };

/** What an armed action can be pointed at: either of the map's selections, or nothing at all. */
export type ActionTarget = MapSelection | GlobalTarget;

export const GLOBAL_TARGET: GlobalTarget = { kind: GLOBAL };

type ActionOf<Kind extends HunterActionKind> = Extract<HunterAction, { readonly kind: Kind }>;

/**
 * How one action is built from a target it accepts, keyed by kind like `core`'s own `ACTION_TABLE`
 * and `ACTION_CODECS`, so a new `HunterAction` variant is a compile error here until it has a
 * builder.
 *
 * Each entry reads the id it needs by presence rather than by comparing the target's kind: the
 * second would be a second copy of `targetKindOf`'s answer, whereas "a roadblock is built from
 * whatever carries an edge id" is the construction itself. `null` is the branch `buildAction`
 * has already excluded.
 */
type ActionBuild<Action extends HunterAction> = (target: ActionTarget) => Action | null;

type ActionBuildTable = {
  readonly [Kind in HunterActionKind]: ActionBuild<ActionOf<Kind>>;
};

/** A target carrying no id is what an action with nothing to point at is built from. */
const isUntargeted = (target: ActionTarget): boolean => !("edgeId" in target || "nodeId" in target);

const ACTION_BUILDS: ActionBuildTable = {
  roadblock: (target) => ("edgeId" in target ? { kind: "roadblock", edgeId: target.edgeId } : null),
  canvass: (target) => ("nodeId" in target ? { kind: "canvass", nodeId: target.nodeId } : null),
  pull_cctv: (target) => ("nodeId" in target ? { kind: "pull_cctv", nodeId: target.nodeId } : null),
  true_briefing: (target) => (isUntargeted(target) ? { kind: "true_briefing" } : null),
};

/** Whether this action takes this target. `targetKindOf` is the only authority on the answer. */
export const acceptsTarget = (kind: HunterActionKind, target: ActionTarget): boolean =>
  targetKindOf(kind) === target.kind;

/**
 * What the armed action is pointed at, or `null` while it is pointed at nothing yet. An action
 * with no target has one the moment it is armed; every other kind waits for the map, and ignores
 * a selection of the wrong kind rather than carrying it.
 */
export const targetOf = (
  kind: HunterActionKind,
  selection: MapSelection | null,
): ActionTarget | null => {
  if (targetKindOf(kind) === GLOBAL) return GLOBAL_TARGET;
  if (selection === null) return null;

  return acceptsTarget(kind, selection) ? selection : null;
};

/** The one place a draft becomes an action. `null` is "not this target", never a malformed one. */
export const buildAction = (kind: HunterActionKind, target: ActionTarget): HunterAction | null =>
  acceptsTarget(kind, target) ? ACTION_BUILDS[kind](target) : null;
