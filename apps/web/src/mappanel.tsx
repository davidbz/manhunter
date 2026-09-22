/**
 * The map, connected (PLAN M5.3a). One concern: reading the view off the store with the narrowest
 * selector that will do, and rendering nothing before a hunt has started (PLAN M5.2's note, "What
 * M5.3a, M5.4, M5.5 and M5.6b must know").
 *
 * It is separate from `MapRenderer` so the renderer stays a pure function of props: that is what
 * lets it be tested without a store and replaced by another renderer behind the same seam.
 * Selection is not read here either - it is UI state PLAN M5.5's action panel needs as well, so it
 * is owned by the screen that holds both and passes through.
 */

import type { ReactNode } from "react";
import { MapRenderer, type MapSelection } from "./maprenderer";
import { useGameStore } from "./storecontext";

export type MapPanelProps = {
  readonly selection: MapSelection | null;
  readonly onSelect: (selection: MapSelection) => void;
  readonly overlay?: ReactNode;
};

export const MapPanel = ({ selection, onSelect, overlay }: MapPanelProps) => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  if (!view) return null;

  return <MapRenderer view={view} selection={selection} onSelect={onSelect} overlay={overlay} />;
};
