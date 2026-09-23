/**
 * The turn the player is assembling (PLAN M5.5b): the rows staged so far, the button that drops a
 * row again, and the one that ends the turn.
 *
 * Presentational and controlled, like `actionpanel.tsx` and `maprenderer.tsx`. It holds no queue
 * of its own - `dispatchscreen.tsx` owns it, for the same reason it owns the selection - and it
 * decides nothing: `enqueue` and `removeAt` are the logic, and this file is the words and the
 * markup.
 *
 * Ending a turn with an empty queue is a move, not a mistake: a hunter may spend a turn waiting
 * for the reports already in flight, so the button is never disabled on an empty queue.
 *
 * **It reads as a dispatch order form (PLAN M6.8)**: numbered lines, each with the action's
 * stencil icon, a line count against `LIMITS.maxQueuedActions` so the bound is visible before it
 * refuses anything, and End Turn as the form's signature at the foot.
 *
 * **No Add button (PLAN M7.3).** An order joins the queue the moment the armed tool is pointed at
 * a target, so the queue only lists, removes and ends. A whole row removes its order: the Remove
 * button's hit area is stretched over the row in `index.css`, so there is still exactly one
 * control per row for a keyboard or a screen reader, and a click anywhere on the line lands on it.
 *
 * **The head reads the plan in action points (PLAN M7.4)**: one pip per point the hunter holds this
 * turn, filled for each the plan spends, beside "2 of 3 AP planned". The count against the queue's
 * line bound stays, because the two are different limits.
 */

import { ActionIcon } from "./actionicon";
import { type ActionQueue, type QueueRefusal, type QueueRow, queueRows } from "./actionqueue";
import { LIMITS } from "./limits";
import type { PlaceNames } from "./placenames";
import type { PlanResources } from "./plancost";

export const TURN_QUEUE_TEST_ID = "turn-queue";
export const QUEUE_ROW_TEST_ID = "queue-row";
export const QUEUE_REMOVE_TEST_ID = "queue-remove";
export const QUEUE_REFUSAL_TEST_ID = "queue-refusal";
export const END_TURN_TEST_ID = "end-turn";
export const QUEUE_COUNT_TEST_ID = "queue-count";
export const QUEUE_AP_TEST_ID = "queue-ap";
export const QUEUE_AP_PIP_TEST_ID = "queue-ap-pip";

const QUEUE_LABEL = "Turn queue";
const QUEUE_TITLE = "Dispatch order";
const COUNT_SEPARATOR = " / ";
const COUNT_SUFFIX = " lines";
const LINE_NUMBER_DIGITS = 2;
const LINE_NUMBER_PAD = "0";
const REMOVE_LABEL = "Remove";
const END_TURN_LABEL = "End turn";
const EMPTY_QUEUE_MESSAGE = "Nothing queued. Ending the turn waits out the hour.";
const ALERT_ROLE = "alert";
const AP_PLAN_SEPARATOR = " of ";
const AP_PLAN_SUFFIX = " AP planned";

const TOO_MANY_QUEUED_SUBJECT = "The turn is full: ";
const TOO_MANY_QUEUED_SEPARATOR = " actions queued, at most ";
const NOT_ENOUGH_ACTION_POINTS_SUBJECT = "Not enough action points left in the plan: needs ";
const NOT_ENOUGH_BUDGET_SUBJECT = "Not enough budget left in the plan: needs ";
const SHORTFALL_SEPARATOR = ", has ";

/** Lines on an order form count from one, and read as a column when padded. */
export const lineNumberOf = (index: number): string =>
  String(index + 1).padStart(LINE_NUMBER_DIGITS, LINE_NUMBER_PAD);

export const queueCountText = (queued: number, maxQueued: number): string =>
  `${queued}${COUNT_SEPARATOR}${maxQueued}${COUNT_SUFFIX}`;

/** The action points this turn holds, and how many of them the queued plan spends. */
export type ActionPointPlan = {
  readonly planned: number;
  readonly available: number;
};

/** `resources` is what the hunter holds and `remaining` what the plan leaves of it. */
export const actionPointPlanOf = (
  resources: PlanResources,
  remaining: PlanResources,
): ActionPointPlan => ({
  planned: resources.actionPoints - remaining.actionPoints,
  available: resources.actionPoints,
});

export const actionPointPlanText = (plan: ActionPointPlan): string =>
  `${plan.planned}${AP_PLAN_SEPARATOR}${plan.available}${AP_PLAN_SUFFIX}`;

/** One pip, numbered from one like the order's lines, and filled when the plan spends it. */
export type ActionPointPip = {
  readonly point: number;
  readonly filled: boolean;
};

/** One pip per point held; a pip is filled when the plan spends that point. */
export const actionPointPipsOf = (plan: ActionPointPlan): readonly ActionPointPip[] =>
  Array.from({ length: Math.max(plan.available, 0) }, (_, index) => ({
    point: index + 1,
    filled: index < plan.planned,
  }));

/** A `switch` with a `never` check, so a new bound on the queue is a compile error here first. */
export const queueRefusalMessage = (refusal: QueueRefusal): string => {
  switch (refusal.kind) {
    case "too_many_queued":
      return `${TOO_MANY_QUEUED_SUBJECT}${refusal.queued}${TOO_MANY_QUEUED_SEPARATOR}${refusal.maxQueued}`;
    case "not_enough_action_points":
      return `${NOT_ENOUGH_ACTION_POINTS_SUBJECT}${refusal.required}${SHORTFALL_SEPARATOR}${refusal.available}`;
    case "not_enough_budget":
      return `${NOT_ENOUGH_BUDGET_SUBJECT}${refusal.required}${SHORTFALL_SEPARATOR}${refusal.available}`;
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
};

export type TurnQueueProps = {
  readonly queue: ActionQueue;
  readonly refusal: QueueRefusal | null;
  readonly onRemove: (index: number) => void;
  readonly onEndTurn: () => void;
  /** What each place is called (PLAN M7.1). A row names its target by this. */
  readonly placeNames: PlaceNames;
  /** The action points the plan spends of what this turn holds (PLAN M7.4). */
  readonly actionPoints: ActionPointPlan;
};

const ActionPointPips = ({ plan }: { readonly plan: ActionPointPlan }) => (
  <span
    className="mh-order__ap"
    data-testid={QUEUE_AP_TEST_ID}
    data-planned={plan.planned}
    data-available={plan.available}
  >
    <span className="mh-order__pips" aria-hidden="true">
      {actionPointPipsOf(plan).map((pip) => (
        <span
          key={pip.point}
          className="mh-order__pip"
          data-testid={QUEUE_AP_PIP_TEST_ID}
          data-filled={pip.filled}
        />
      ))}
    </span>
    {actionPointPlanText(plan)}
  </span>
);

const QueuedActionItem = ({
  row,
  onRemove,
}: {
  readonly row: QueueRow;
  readonly onRemove: (index: number) => void;
}) => (
  <li
    className="mh-order__line"
    data-testid={QUEUE_ROW_TEST_ID}
    data-index={row.index}
    data-action={row.action.kind}
  >
    <span className="mh-order__number">{lineNumberOf(row.index)}</span>
    <ActionIcon kind={row.action.kind} />
    <span className="mh-order__summary">{row.summary}</span>
    <button
      type="button"
      className="mh-button mh-button--quiet mh-order__remove"
      data-testid={QUEUE_REMOVE_TEST_ID}
      onClick={() => onRemove(row.index)}
    >
      {REMOVE_LABEL}
    </button>
  </li>
);

export const TurnQueue = ({
  queue,
  refusal,
  onRemove,
  onEndTurn,
  placeNames,
  actionPoints,
}: TurnQueueProps) => (
  <section
    aria-label={QUEUE_LABEL}
    className="mh-card mh-order"
    data-testid={TURN_QUEUE_TEST_ID}
    data-queued={queue.length}
  >
    <div className="mh-order__head">
      <h2 className="mh-card__title">{QUEUE_TITLE}</h2>
      <ActionPointPips plan={actionPoints} />
      <span className="mh-order__count" data-testid={QUEUE_COUNT_TEST_ID}>
        {queueCountText(queue.length, LIMITS.maxQueuedActions)}
      </span>
    </div>
    {queue.length === 0 ? (
      <p className="mh-card__empty">{EMPTY_QUEUE_MESSAGE}</p>
    ) : (
      <ol className="mh-order__lines">
        {queueRows(queue, placeNames).map((row) => (
          <QueuedActionItem key={row.index} row={row} onRemove={onRemove} />
        ))}
      </ol>
    )}
    {refusal === null ? null : (
      <p
        role={ALERT_ROLE}
        className="mh-alert"
        data-testid={QUEUE_REFUSAL_TEST_ID}
        data-refusal={refusal.kind}
      >
        {queueRefusalMessage(refusal)}
      </p>
    )}
    <button
      type="button"
      className="mh-button mh-button--commit"
      data-testid={END_TURN_TEST_ID}
      onClick={onEndTurn}
    >
      {END_TURN_LABEL}
    </button>
  </section>
);
