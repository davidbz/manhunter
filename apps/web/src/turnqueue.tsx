/**
 * The turn the player is assembling (PLAN M5.5b): the rows staged so far, the button that takes
 * the armed draft into the queue, the button that drops a row again, and the one that ends the
 * turn.
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
 */

import type { HunterAction } from "@manhunter/core";
import { ActionIcon } from "./actionicon";
import { type ActionQueue, type QueueRefusal, type QueueRow, queueRows } from "./actionqueue";
import { LIMITS } from "./limits";

export const TURN_QUEUE_TEST_ID = "turn-queue";
export const QUEUE_ROW_TEST_ID = "queue-row";
export const QUEUE_ADD_TEST_ID = "queue-add";
export const QUEUE_REMOVE_TEST_ID = "queue-remove";
export const QUEUE_REFUSAL_TEST_ID = "queue-refusal";
export const END_TURN_TEST_ID = "end-turn";
export const QUEUE_COUNT_TEST_ID = "queue-count";

const QUEUE_LABEL = "Turn queue";
const QUEUE_TITLE = "Dispatch order";
const COUNT_SEPARATOR = " / ";
const COUNT_SUFFIX = " lines";
const LINE_NUMBER_DIGITS = 2;
const LINE_NUMBER_PAD = "0";
const ADD_LABEL = "Add to turn";
const REMOVE_LABEL = "Remove";
const END_TURN_LABEL = "End turn";
const EMPTY_QUEUE_MESSAGE = "Nothing queued. Ending the turn waits out the hour.";
const ALERT_ROLE = "alert";

const TOO_MANY_QUEUED_SUBJECT = "The turn is full: ";
const TOO_MANY_QUEUED_SEPARATOR = " actions queued, at most ";

/** Lines on an order form count from one, and read as a column when padded. */
export const lineNumberOf = (index: number): string =>
  String(index + 1).padStart(LINE_NUMBER_DIGITS, LINE_NUMBER_PAD);

export const queueCountText = (queued: number, maxQueued: number): string =>
  `${queued}${COUNT_SEPARATOR}${maxQueued}${COUNT_SUFFIX}`;

/**
 * One variant today, and still a `switch` with a `never` check: the queue is `web`'s own boundary,
 * so a second bound on it would land here and this is what makes that a compile error first.
 */
export const queueRefusalMessage = (refusal: QueueRefusal): string => {
  switch (refusal.kind) {
    case "too_many_queued":
      return `${TOO_MANY_QUEUED_SUBJECT}${refusal.queued}${TOO_MANY_QUEUED_SEPARATOR}${refusal.maxQueued}`;
    default: {
      const exhaustive: never = refusal.kind;
      return exhaustive;
    }
  }
};

export type TurnQueueProps = {
  readonly queue: ActionQueue;
  /** The armed action once it has a target it accepts (PLAN M5.5a's seam). */
  readonly draft: HunterAction | null;
  readonly refusal: QueueRefusal | null;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onEndTurn: () => void;
};

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
      className="mh-button mh-button--quiet"
      data-testid={QUEUE_REMOVE_TEST_ID}
      onClick={() => onRemove(row.index)}
    >
      {REMOVE_LABEL}
    </button>
  </li>
);

export const TurnQueue = ({
  queue,
  draft,
  refusal,
  onAdd,
  onRemove,
  onEndTurn,
}: TurnQueueProps) => (
  <section
    aria-label={QUEUE_LABEL}
    className="mh-card mh-order"
    data-testid={TURN_QUEUE_TEST_ID}
    data-queued={queue.length}
  >
    <div className="mh-order__head">
      <h2 className="mh-card__title">{QUEUE_TITLE}</h2>
      <span className="mh-order__count" data-testid={QUEUE_COUNT_TEST_ID}>
        {queueCountText(queue.length, LIMITS.maxQueuedActions)}
      </span>
    </div>
    <button
      type="button"
      className="mh-button"
      data-testid={QUEUE_ADD_TEST_ID}
      disabled={draft === null}
      onClick={onAdd}
    >
      {ADD_LABEL}
    </button>
    {queue.length === 0 ? (
      <p className="mh-card__empty">{EMPTY_QUEUE_MESSAGE}</p>
    ) : (
      <ol className="mh-order__lines">
        {queueRows(queue).map((row) => (
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
