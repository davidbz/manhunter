/**
 * The heatmap, connected (PLAN M5.3b). The same split `mappanel.tsx` and `meterspanel.tsx` make:
 * the overlay stays a pure function of props, and this is the one half that knows a store exists.
 *
 * It is a sibling of `MapPanel` rather than something inside it, because the overlay layer takes
 * whatever node the screen hands it: PLAN M5.6b draws the criminal's true path over the same
 * heat, and composes by passing both (`overlay={<><BeliefOverlayPanel /><CriminalPath ... /></>}`)
 * rather than by the map growing a second overlay prop.
 *
 * It hands the overlay the same plate the map draws (`plateBoundsOf` with the map theme's
 * padding), so the top-tier contour (PLAN M6.6) is cut from exactly the cells the blocks are.
 */

import { BeliefOverlay } from "./beliefoverlay";
import { plateBoundsOf } from "./mapgeometry";
import { useGameStore } from "./storecontext";
import { MAP_THEME } from "./theme";

export const BeliefOverlayPanel = () => {
  const view = useGameStore((state) => state.hunt?.view ?? null);
  if (!view) return null;

  return (
    <BeliefOverlay
      belief={view.belief}
      nodes={view.map.nodes}
      bounds={plateBoundsOf(view.map, MAP_THEME.padding)}
    />
  );
};
