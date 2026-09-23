/**
 * The plan layer, connected (PLAN M7.3): `MapPlannedOrders` is a pure function of props, and this
 * is the half that reads the map, the balance and the place names off the store, the split
 * `mapfocusbeaconpanel.tsx` makes. The queue and the draft are the dispatch screen's, so they
 * arrive as props.
 */

import type { HunterAction } from "@manhunter/core";
import { type ActionQueue, targetNameOf } from "./actionqueue";
import { plateBoundsOf } from "./mapgeometry";
import { huntPlaceNamesOf, positionIndexOf } from "./mapnodes";
import {
  costTagOf,
  MapPlannedOrders,
  plannedMarksOf,
  planPlaceOf,
  tagSideOf,
} from "./mapplannedorders";
import { planCostOf } from "./plancost";
import { useGameStore } from "./storecontext";
import { MAP_PLAN_THEME, MAP_THEME } from "./theme";

export type MapPlannedOrdersPanelProps = {
  readonly queue: ActionQueue;
  /** The order the armed tool is pointed at; a global one has no place and draws no ghost. */
  readonly draft: HunterAction | null;
  readonly onRemove: (index: number) => void;
};

export const MapPlannedOrdersPanel = ({ queue, draft, onRemove }: MapPlannedOrdersPanelProps) => {
  const map = useGameStore((state) => state.hunt?.view.map ?? null);
  const balance = useGameStore((state) => state.balance);
  const placeNames = useGameStore(huntPlaceNamesOf);
  if (!map || !placeNames) return null;

  const positions = positionIndexOf(map.nodes);
  const place = draft === null ? null : planPlaceOf(draft, positions, map.edges);
  const ghost =
    draft === null || place === null
      ? null
      : {
          action: draft,
          place,
          tag: costTagOf(planCostOf(draft.kind, balance), targetNameOf(draft, placeNames)),
          side: tagSideOf(place.at, plateBoundsOf(map, MAP_THEME.padding)),
        };

  return (
    <MapPlannedOrders
      marks={plannedMarksOf(queue, positions, map.edges)}
      ghost={ghost}
      style={MAP_PLAN_THEME}
      onRemove={onRemove}
    />
  );
};
