/**
 * The end screen, connected (PLAN M5.6a). The same split `mappanel.tsx` makes.
 *
 * One selector: `hunt.score` is projected once per transition, the same trade `hunt.view` already
 * makes (`gamestore.ts`'s note on `Hunt`), so reading it here is a reference read and not a
 * computation - nothing is scored on render. Rendering nothing before a hunt exists or while one
 * is still running is `EndScreen`'s own call (its `breakdown.outcome.kind === "in_progress"`
 * guard), not repeated here.
 */

import { EndScreen } from "./endscreen";
import { useGameStore } from "./storecontext";

export const EndScreenPanel = () => {
  const breakdown = useGameStore((state) => state.hunt?.score ?? null);
  if (!breakdown) return null;

  return <EndScreen breakdown={breakdown} />;
};
