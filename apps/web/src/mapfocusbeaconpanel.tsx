/**
 * The focus beacon, connected (PLAN M7.2). The same split `beliefoverlaypanel.tsx` makes: the
 * beacon stays a pure function of props, and this is the half that reads the hunt's map off the
 * store. Which node is in focus is not the store's; it is `DispatchScreen`'s presentation state
 * and arrives as a prop.
 *
 * It hands the beacon the same plate the map draws (`plateBoundsOf` with the map theme's
 * padding), so the leader stops at the margin the street index is drawn in.
 */

import type { NodeId } from "@manhunter/core";
import { MapFocusBeacon } from "./mapfocusbeacon";
import { plateBoundsOf } from "./mapgeometry";
import { useGameStore } from "./storecontext";
import { MAP_FOCUS_BEACON_THEME, MAP_THEME } from "./theme";

export type MapFocusBeaconPanelProps = {
  readonly nodeId: NodeId | null;
};

export const MapFocusBeaconPanel = ({ nodeId }: MapFocusBeaconPanelProps) => {
  const map = useGameStore((state) => state.hunt?.view.map ?? null);
  if (!map) return null;

  return (
    <MapFocusBeacon
      nodeId={nodeId}
      nodes={map.nodes}
      bounds={plateBoundsOf(map, MAP_THEME.padding)}
      style={MAP_FOCUS_BEACON_THEME}
    />
  );
};
