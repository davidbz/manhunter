/**
 * The report feed, connected (PLAN M5.4). The same split `mappanel.tsx` makes: one concern, which
 * is reading the view off the store with the narrowest selector that will do, and rendering
 * nothing before a hunt has started.
 *
 * It passes fields rather than the whole view, because that is all a feed needs and it keeps
 * `ReportFeed` testable from a list of reports and a number. The source weights the reliability
 * badges read (PLAN M6.8) are the store's balance, a second non-allocating selector. The place
 * names (PLAN M7.1) are a third, memoised per hunt in `mapnodes.ts`.
 *
 * The focused node (PLAN M7.2) is not the store's: it is the dispatch screen's presentation state,
 * so it arrives as a prop and passes straight through.
 */

import { huntPlaceNamesOf } from "./mapnodes";
import type { NodeFocus } from "./nodefocus";
import { ReportFeed } from "./reportfeed";
import { useGameStore } from "./storecontext";

export type ReportFeedPanelProps = {
  readonly focus?: NodeFocus | undefined;
};

export const ReportFeedPanel = ({ focus }: ReportFeedPanelProps) => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const sourceWeights = useGameStore((state) => state.balance.belief.sourceWeight);
  const placeNames = useGameStore(huntPlaceNamesOf);
  if (!view || !placeNames) return null;

  return (
    <ReportFeed
      reports={view.reports}
      currentTurn={view.clock.turn}
      sourceWeights={sourceWeights}
      placeNames={placeNames}
      focus={focus}
    />
  );
};
