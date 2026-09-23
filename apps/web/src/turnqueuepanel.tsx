/**
 * The turn queue, connected (PLAN M5.5b). The same split `mappanel.tsx` makes: `TurnQueue` is a
 * pure function of props, and this is the only half that knows there is a store.
 *
 * **The queue is `DispatchScreen`'s state, not this panel's (PLAN M7.3).** The board prices its
 * tiles against what the plan leaves and the map draws the planned orders, so all three read one
 * queue, and it is held where all three are assembled. It is still component state, not store
 * state: it dies with the turn, and the store already holds the turn that was submitted, on
 * `hunt.recordedActions`, which is what the rejections index into. What this panel still owns is
 * the place names the rows are read in, a non-allocating selector (PLAN M7.1).
 */

import type { ActionQueue, QueueRefusal } from "./actionqueue";
import { huntPlaceNamesOf } from "./mapnodes";
import { NO_PLACE_NAMES } from "./placenames";
import { useGameStore } from "./storecontext";
import { type ActionPointPlan, TurnQueue } from "./turnqueue";

export type TurnQueuePanelProps = {
  readonly queue: ActionQueue;
  readonly refusal: QueueRefusal | null;
  readonly onRemove: (index: number) => void;
  readonly onEndTurn: () => void;
  readonly actionPoints: ActionPointPlan;
};

export const TurnQueuePanel = ({
  queue,
  refusal,
  onRemove,
  onEndTurn,
  actionPoints,
}: TurnQueuePanelProps) => {
  const placeNames = useGameStore(huntPlaceNamesOf) ?? NO_PLACE_NAMES;

  return (
    <TurnQueue
      queue={queue}
      refusal={refusal}
      onRemove={onRemove}
      onEndTurn={onEndTurn}
      placeNames={placeNames}
      actionPoints={actionPoints}
    />
  );
};
