/**
 * The meters, connected (PLAN M5.4). The same split `mappanel.tsx` makes.
 *
 * Two selectors rather than one, so neither subscription allocates: a selector returning a fresh
 * object would make the panel re-render on every store write. The balance is the store's initial
 * state and never moves (PLAN M5.2's note), so the meters are scaled by the numbers the hunt was
 * created with and no second copy can drift from them.
 *
 * **The plan's forecast arrives as a prop, not from the store (PLAN M7.4).** The plan is
 * `DispatchBoard`'s component state (PLAN M7.3's note): it dies with the turn, and the store holds
 * only the turn that was submitted. So the board computes what the plan leaves once and hands the
 * same value to the rail, the meters and the action board.
 */

import { Meters } from "./meters";
import type { PlanResources } from "./plancost";
import { useGameStore } from "./storecontext";

export type MetersPanelProps = {
  readonly remaining?: PlanResources;
};

export const MetersPanel = ({ remaining }: MetersPanelProps) => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const bounds = useGameStore((state) => state.balance.hunter);
  if (!view) return null;

  return <Meters view={view} bounds={bounds} remaining={remaining ?? view.hunter} />;
};
