/**
 * The header rail, connected (PLAN M6.2). The same split `meterspanel.tsx` makes.
 *
 * One selector per value rather than one returning an object, so no subscription allocates and
 * the rail re-renders only when something it shows has moved.
 *
 * What the plan leaves is a prop, for the reason `meterspanel.tsx` gives (PLAN M7.4).
 */

import { HeaderRail, headerRailOf } from "./headerrail";
import type { PlanResources } from "./plancost";
import { useGameStore } from "./storecontext";

export type HeaderRailPanelProps = {
  readonly remaining?: PlanResources;
};

export const HeaderRailPanel = ({ remaining }: HeaderRailPanelProps) => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const seed = useGameStore((state) => state.hunt?.seed ?? null);
  const difficulty = useGameStore((state) => state.hunt?.setup.difficulty ?? null);
  const pressureMax = useGameStore((state) => state.balance.hunter.pressureMax);
  const trustMax = useGameStore((state) => state.balance.hunter.trustMax);
  if (view === null || seed === null || difficulty === null) return null;

  const bounds = { pressureMax, trustMax };
  const input = { seed, difficulty, view, ...bounds, remaining: remaining ?? view.hunter };

  return <HeaderRail items={headerRailOf(input)} />;
};
