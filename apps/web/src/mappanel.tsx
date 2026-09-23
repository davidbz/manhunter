/**
 * The map, connected (PLAN M5.3a). One concern: reading the view off the store with the narrowest
 * selector that will do, and rendering nothing before a hunt has started (PLAN M5.2's note, "What
 * M5.3a, M5.4, M5.5 and M5.6b must know").
 *
 * It is separate from `MapRenderer` so the renderer stays a pure function of props: that is what
 * lets it be tested without a store and replaced by another renderer behind the same seam.
 * Selection is not read here either - it is UI state PLAN M5.5's action panel needs as well, so it
 * is owned by the screen that holds both and passes through.
 *
 * The hunt's own `balance.time` is read here too (PLAN M6.4), so the day/night wash turns on the
 * same hours the rules do rather than on a copy of them.
 *
 * `selectableKind` passes through untouched (PLAN M6.5): the screen that owns the armed action is
 * the one that knows what it can target.
 *
 * `onFocusNode` passes through too (PLAN M7.2): the focused node is the dispatch screen's state.
 * So do `onHoverTarget`, `onCancel` and the `plan` layer (PLAN M7.3): the plan is that screen's.
 *
 * The place names (PLAN M7.1) are the hunt's, seeded by its case number and memoised per hunt in
 * `mapnodes.ts`, so the map's labels agree with the feed's and the queue's.
 */

import type { ReactNode } from "react";
import type { MapHoverHandler } from "./maphover";
import { huntPlaceNamesOf } from "./mapnodes";
import { MapRenderer, type MapSelection } from "./maprenderer";
import type { MapSelectable } from "./mapselectable";
import type { NodeFocusHandler } from "./nodefocus";
import { useGameStore } from "./storecontext";

export type MapPanelProps = {
  readonly selection: MapSelection | null;
  readonly onSelect: (selection: MapSelection) => void;
  readonly overlay?: ReactNode;
  readonly selectableKind?: MapSelectable | null;
  readonly onFocusNode?: NodeFocusHandler | undefined;
  readonly onHoverTarget?: MapHoverHandler | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly plan?: ReactNode;
};

export const MapPanel = ({
  selection,
  onSelect,
  overlay,
  selectableKind = null,
  onFocusNode,
  onHoverTarget,
  onCancel,
  plan,
}: MapPanelProps) => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  const daylight = useGameStore((state) => state.balance.time);
  const placeNames = useGameStore(huntPlaceNamesOf);
  if (!view || !placeNames) return null;

  return (
    <MapRenderer
      view={view}
      selection={selection}
      onSelect={onSelect}
      overlay={overlay}
      daylight={daylight}
      selectableKind={selectableKind}
      placeNames={placeNames}
      onFocusNode={onFocusNode}
      onHoverTarget={onHoverTarget}
      onCancel={onCancel}
      plan={plan}
    />
  );
};
