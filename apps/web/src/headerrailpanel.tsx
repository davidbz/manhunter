/**
 * The header rail, connected (PLAN M6.2). The same split `meterspanel.tsx` makes.
 *
 * One selector per value rather than one returning an object, so no subscription allocates and
 * the rail re-renders only when something it shows has moved.
 */

import { HeaderRail, headerRailOf } from "./headerrail";
import { useGameStore } from "./storecontext";

export const HeaderRailPanel = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const seed = useGameStore((state) => state.hunt?.seed ?? null);
  const difficulty = useGameStore((state) => state.hunt?.setup.difficulty ?? null);
  const pressureMax = useGameStore((state) => state.balance.hunter.pressureMax);
  if (view === null || seed === null || difficulty === null) return null;

  return <HeaderRail items={headerRailOf({ seed, difficulty, view, pressureMax })} />;
};
