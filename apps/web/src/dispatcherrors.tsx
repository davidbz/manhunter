/**
 * The two ways a dispatch can go wrong, and the words for both (PLAN M5.5b).
 *
 * They are separate surfaces because they mean opposite things (PLAN M5.2's note). A
 * `StoreRefusal` means the turn did not happen at all and nothing was recorded, so it is one
 * message about the whole dispatch. A `PlanningRejection` means the turn *did* happen and one row
 * of the queue did not, so it is one message per row, against the row it belongs to.
 *
 * Both unions grow from `core`, so both are narrowed by an exhaustive `switch` with a `never`
 * check: a new refusal or a new rejection reason is a compile error here until it has a sentence.
 *
 * The rows a rejection points at are read from `hunt.recordedActions`, not from the screen's own
 * queue. `PlanningRejection.index` names a position in the queue that was submitted, and that
 * queue is exactly the last turn the store recorded, so the two cannot drift while the screen
 * stages the next turn on top.
 */

import type { ActionRejection, HunterAction, PlanningRejection } from "@manhunter/core";
import { actionSummary } from "./actionqueue";
import type { StoreRefusal } from "./gamestore";
import type { PlaceNames } from "./placenames";

const AT_MOST = ", at most ";
const NEEDS = " needs ";
const HAS = ", has ";

const overBound = (subject: string, value: number, maximum: number): string =>
  `${subject}${value}${AT_MOST}${maximum}`;

const shortfall = (subject: string, required: number, available: number): string =>
  `${subject}${NEEDS}${required}${HAS}${available}`;

const DEADLINE_TOO_LONG_SUBJECT = "That deadline is too long: ";
const TOO_MANY_ACTIONS_SUBJECT = "Too many actions for one turn: ";
const TOO_MANY_RECORDED_TURNS_SUBJECT = "Too many turns recorded for this hunt: ";
const GENERATION_FAILED_PREFIX = "No city could be built for this hunt after ";
const GENERATION_FAILED_SUFFIX = " attempts. Try another seed.";
const HUNT_OVER_MESSAGE = "This hunt is over. No further turn can be taken.";
const NO_HUNT_MESSAGE = "There is no hunt to end. Start one first.";

export const refusalMessage = (refusal: StoreRefusal): string => {
  switch (refusal.kind) {
    case "deadline_too_long":
      return overBound(DEADLINE_TOO_LONG_SUBJECT, refusal.requestedTurns, refusal.maxTurns);
    case "generation_failed":
      return `${GENERATION_FAILED_PREFIX}${refusal.attempts}${GENERATION_FAILED_SUFFIX}`;
    case "too_many_actions":
      return overBound(TOO_MANY_ACTIONS_SUBJECT, refusal.requestedActions, refusal.maxActions);
    case "hunt_over":
      return HUNT_OVER_MESSAGE;
    case "no_hunt":
      return NO_HUNT_MESSAGE;
    case "too_many_recorded_turns":
      return overBound(TOO_MANY_RECORDED_TURNS_SUBJECT, refusal.recordedTurns, refusal.maxTurns);
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
};

const ACTION_POINTS_SUBJECT = "Action points:";
const BUDGET_SUBJECT = "Budget:";
const UNKNOWN_EDGE_PREFIX = "No such road: ";
const UNKNOWN_NODE_PREFIX = "No such district: ";
const EDGE_NOT_BLOCKABLE_PREFIX = "That road cannot be blocked: ";
const EDGE_ALREADY_BLOCKED_PREFIX = "That road is already blocked: ";

export const rejectionMessage = (reason: ActionRejection): string => {
  switch (reason.kind) {
    case "not_enough_action_points":
      return shortfall(ACTION_POINTS_SUBJECT, reason.required, reason.available);
    case "not_enough_budget":
      return shortfall(BUDGET_SUBJECT, reason.required, reason.available);
    case "unknown_edge":
      return `${UNKNOWN_EDGE_PREFIX}${reason.edgeId}`;
    case "unknown_node":
      return `${UNKNOWN_NODE_PREFIX}${reason.nodeId}`;
    case "edge_not_blockable":
      return `${EDGE_NOT_BLOCKABLE_PREFIX}${reason.edgeId}`;
    case "edge_already_blocked":
      return `${EDGE_ALREADY_BLOCKED_PREFIX}${reason.edgeId}`;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

/** A row of the submitted queue that did not happen, ready to draw. */
export type RejectedRow = {
  readonly index: number;
  readonly kind: ActionRejection["kind"];
  readonly action: string;
  readonly message: string;
};

/**
 * A rejection naming a row the submitted queue does not have cannot be drawn against an action,
 * so it is drawn against this instead of being dropped: a reason with no row is still a reason.
 */
const MISSING_ACTION_LABEL = "Queued action";

export const rejectedRows = (
  dispatched: readonly HunterAction[],
  rejections: readonly PlanningRejection[],
  names: PlaceNames,
): readonly RejectedRow[] =>
  rejections.map((rejection) => {
    const action = dispatched[rejection.index];

    return {
      index: rejection.index,
      kind: rejection.reason.kind,
      action: action === undefined ? MISSING_ACTION_LABEL : actionSummary(action, names),
      message: rejectionMessage(rejection.reason),
    };
  });

export const DISPATCH_ERRORS_TEST_ID = "dispatch-errors";
export const DISPATCH_REFUSAL_TEST_ID = "dispatch-refusal";
export const DISPATCH_REJECTION_TEST_ID = "dispatch-rejection";

const ERRORS_LABEL = "Dispatch problems";
const ALERT_ROLE = "alert";

export type DispatchErrorsProps = {
  readonly refusal: StoreRefusal | null;
  /** The queue the last recorded turn was played with, which is what the indices point into. */
  readonly dispatched: readonly HunterAction[];
  readonly rejections: readonly PlanningRejection[];
  /** What each place is called (PLAN M7.1). A rejected row names its target by this. */
  readonly placeNames: PlaceNames;
};

export const DispatchErrors = ({
  refusal,
  dispatched,
  rejections,
  placeNames,
}: DispatchErrorsProps) => {
  const rows = rejectedRows(dispatched, rejections, placeNames);
  if (refusal === null && rows.length === 0) return null;

  return (
    <section aria-label={ERRORS_LABEL} data-testid={DISPATCH_ERRORS_TEST_ID}>
      {refusal === null ? null : (
        <p role={ALERT_ROLE} data-testid={DISPATCH_REFUSAL_TEST_ID} data-refusal={refusal.kind}>
          {refusalMessage(refusal)}
        </p>
      )}
      {rows.length === 0 ? null : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.index}
              data-testid={DISPATCH_REJECTION_TEST_ID}
              data-index={row.index}
              data-rejection={row.kind}
            >
              <span>{row.action}</span>
              <span>{row.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
