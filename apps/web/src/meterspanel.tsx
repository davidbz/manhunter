/**
 * The meters, connected (PLAN M5.4). The same split `mappanel.tsx` makes.
 *
 * Two selectors rather than one, so neither subscription allocates: a selector returning a fresh
 * object would make the panel re-render on every store write. The balance is the store's initial
 * state and never moves (PLAN M5.2's note), so the meters are scaled by the numbers the hunt was
 * created with and no second copy can drift from them.
 */

import { Meters } from "./meters";
import { useGameStore } from "./storecontext";

export const MetersPanel = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const bounds = useGameStore((state) => state.balance.hunter);
  if (!view) return null;

  return <Meters view={view} bounds={bounds} />;
};
