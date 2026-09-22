/**
 * The heatmap, connected (PLAN M5.3b). The same split `mappanel.tsx` and `meterspanel.tsx` make:
 * the overlay stays a pure function of props, and this is the one half that knows a store exists.
 *
 * It is a sibling of `MapPanel` rather than something inside it, because the overlay layer takes
 * whatever node the screen hands it: PLAN M5.6b draws the criminal's true path over the same
 * heat, and composes by passing both (`overlay={<><BeliefOverlayPanel /><CriminalPath ... /></>}`)
 * rather than by the map growing a second overlay prop.
 */

import { BeliefOverlay } from "./beliefoverlay";
import { useGameStore } from "./storecontext";

export const BeliefOverlayPanel = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  if (!view) return null;

  return <BeliefOverlay belief={view.belief} nodes={view.map.nodes} />;
};
