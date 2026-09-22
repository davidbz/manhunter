/**
 * The dispatch errors, connected (PLAN M5.5b). The same split `mappanel.tsx` makes.
 *
 * Three selectors rather than one composite, so none of them allocates: a selector returning a
 * fresh object would make the panel re-render on every store write (PLAN M5.4's note).
 */

import type { ActionQueue } from "./actionqueue";
import { EMPTY_QUEUE } from "./actionqueue";
import { DispatchErrors } from "./dispatcherrors";
import type { GameStoreState } from "./gamestore";
import { useGameStore } from "./storecontext";

/**
 * The queue the last recorded turn was played with, which is what `state.rejections` indexes
 * into. Module level and returning the stored array itself, so the selector allocates nothing
 * and Zustand's reference equality still sees through it (PLAN M5.2's note on holding the view).
 */
const lastDispatch = (state: GameStoreState): ActionQueue =>
  state.hunt?.recordedActions.at(-1) ?? EMPTY_QUEUE;

export const DispatchErrorsPanel = () => {
  const refusal = useGameStore((state) => state.refusal);
  const rejections = useGameStore((state) => state.rejections);
  const dispatched = useGameStore(lastDispatch);

  return <DispatchErrors refusal={refusal} dispatched={dispatched} rejections={rejections} />;
};
