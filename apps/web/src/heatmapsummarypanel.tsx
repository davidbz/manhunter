/**
 * The heatmap's text equivalent, connected (PLAN M6.10). It reads the hunter's view and nothing
 * else - no `SealedWorld`, no replay truth - so what it says during a hunt is exactly what the
 * heatmap shows (architecture rule 4). It hands the summary the same ramp, contour threshold, pin
 * window and staleness tiers the map draws with, so the two cannot disagree.
 */

import { DEFAULT_BELIEF_FIELD, DEFAULT_HEAT_RAMP } from "./beliefoverlay";
import { heatmapSummaryOf } from "./heatmapsummary";
import { HeatmapSummaryList } from "./heatmapsummarylist";
import { LIMITS } from "./limits";
import { useGameStore } from "./storecontext";
import { MAP_THEME } from "./theme";

export const HeatmapSummaryPanel = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  if (!view) return null;

  const summary = heatmapSummaryOf(
    {
      belief: view.belief,
      nodes: view.map.nodes,
      reports: view.reports,
      currentTurn: view.clock.turn,
    },
    {
      ramp: DEFAULT_HEAT_RAMP,
      contourFrom: DEFAULT_BELIEF_FIELD.contourFrom,
      pinWindow: { maxAge: MAP_THEME.reportPin.maxAge, maxPins: LIMITS.maxReportPins },
      staleness: MAP_THEME.reportPin.staleness,
      maxEntries: LIMITS.maxHeatmapSummaryEntries,
    },
  );

  return <HeatmapSummaryList summary={summary} />;
};
