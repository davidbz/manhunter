/**
 * The turn queue, connected (PLAN M5.5b). The same split `mappanel.tsx` makes: `TurnQueue` is a
 * pure function of props, and this is the only half that knows there is a store.
 *
 * **The queue is component state, not store state.** It dies with the turn and nothing outside
 * this screen reads it, which is the test PLAN M5.5a's note set for keeping it here; the store
 * already holds the turn that was submitted, on `hunt.recordedActions`, and that is what the
 * rejections index into.
 *
 * **A refused turn keeps the queue.** A `StoreRefusal` means the turn did not happen and nothing
 * was recorded (PLAN M5.2's note), so the staged turn is still the player's; only a turn that
 * played clears it. The handler therefore reads the store back through `useGameStoreApi` after
 * dispatching, because the value this render captured is from before the dispatch.
 */

import type { HunterAction } from "@manhunter/core";
import { useState } from "react";
import { type ActionQueue, EMPTY_QUEUE, enqueue, type QueueRefusal, removeAt } from "./actionqueue";
import { useGameStoreApi } from "./storecontext";
import { TurnQueue } from "./turnqueue";

export type TurnQueuePanelProps = {
  /** The armed action once it has a target it accepts (PLAN M5.5a's seam). */
  readonly draft: HunterAction | null;
  /** Run when the draft has been taken into the queue, or the whole queue has been played. */
  readonly onCommitted: () => void;
};

export const TurnQueuePanel = ({ draft, onCommitted }: TurnQueuePanelProps) => {
  const store = useGameStoreApi();
  const [queue, setQueue] = useState<ActionQueue>(EMPTY_QUEUE);
  const [refusal, setRefusal] = useState<QueueRefusal | null>(null);

  const add = (): void => {
    if (draft === null) return;

    const result = enqueue(queue, draft);
    if (result.kind !== "queue") {
      setRefusal(result);
      return;
    }

    setQueue(result.queue);
    setRefusal(null);
    onCommitted();
  };

  const remove = (index: number): void => {
    setQueue(removeAt(queue, index));
    setRefusal(null);
  };

  const endTurn = (): void => {
    store.getState().endTurn(queue);
    if (store.getState().refusal !== null) return;

    setQueue(EMPTY_QUEUE);
    setRefusal(null);
    onCommitted();
  };

  return (
    <TurnQueue
      queue={queue}
      draft={draft}
      refusal={refusal}
      onAdd={add}
      onRemove={remove}
      onEndTurn={endTurn}
    />
  );
};
