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
 */

import type { HunterAction } from "@manhunter/core";
import { type ActionQueue, type QueueRefusal, type QueueRow, queueRows } from "./actionqueue";

export const TURN_QUEUE_TEST_ID = "turn-queue";
export const QUEUE_ROW_TEST_ID = "queue-row";
export const QUEUE_ADD_TEST_ID = "queue-add";
export const QUEUE_REMOVE_TEST_ID = "queue-remove";
export const QUEUE_REFUSAL_TEST_ID = "queue-refusal";
export const END_TURN_TEST_ID = "end-turn";

const QUEUE_LABEL = "Turn queue";
const ADD_LABEL = "Add to turn";
const REMOVE_LABEL = "Remove";
const END_TURN_LABEL = "End turn";
const EMPTY_QUEUE_MESSAGE = "Nothing queued. Ending the turn waits out the hour.";
const ALERT_ROLE = "alert";

const TOO_MANY_QUEUED_SUBJECT = "The turn is full: ";
const TOO_MANY_QUEUED_SEPARATOR = " actions queued, at most ";

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
  <li data-testid={QUEUE_ROW_TEST_ID} data-index={row.index} data-action={row.action.kind}>
    <span>{row.summary}</span>
    <button type="button" data-testid={QUEUE_REMOVE_TEST_ID} onClick={() => onRemove(row.index)}>
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
  <section aria-label={QUEUE_LABEL} data-testid={TURN_QUEUE_TEST_ID} data-queued={queue.length}>
    <button type="button" data-testid={QUEUE_ADD_TEST_ID} disabled={draft === null} onClick={onAdd}>
      {ADD_LABEL}
    </button>
    {queue.length === 0 ? (
      <p>{EMPTY_QUEUE_MESSAGE}</p>
    ) : (
      <ol>
        {queueRows(queue).map((row) => (
          <QueuedActionItem key={row.index} row={row} onRemove={onRemove} />
        ))}
      </ol>
    )}
    {refusal === null ? null : (
      <p role={ALERT_ROLE} data-testid={QUEUE_REFUSAL_TEST_ID} data-refusal={refusal.kind}>
        {queueRefusalMessage(refusal)}
      </p>
    )}
    <button type="button" data-testid={END_TURN_TEST_ID} onClick={onEndTurn}>
      {END_TURN_LABEL}
    </button>
  </section>
);
