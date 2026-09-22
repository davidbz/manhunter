/**
 * The replay screen (PLAN M5.6b): the map, the belief heatmap it already carried, and the
 * criminal's true path over it, scrubbable turn by turn. Rendered by `DispatchScreen` alongside
 * `EndScreenPanel` once a hunt is over.
 *
 * It owns `turn`, the one piece of state this feature needs, the way `DispatchScreen` owns
 * `armed` and `selection` (M5.3a's "selection is UI state owned above the map"): both
 * `ReplayScrubber` and `CriminalPathPanel` read it, so it lives in the screen that renders both
 * rather than in either.
 *
 * The map reused here is `MapPanel`, unedited, with `overlay={<><BeliefOverlayPanel />
 * <CriminalPathPanel /></>}` - exactly the composition M5.3b's note reserved this seam for. The
 * heatmap it draws is the hunt's final belief, the one already on the store when the hunt ended;
 * only the criminal's marker moves as the turn is scrubbed. Node and edge selection is inert
 * here - there is no action panel on this screen to read it - so `onSelect` is a no-op.
 */

import { useState } from "react";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { CriminalPathPanel } from "./criminalpathpanel";
import { MapPanel } from "./mappanel";
import type { MapSelection } from "./maprenderer";
import { ReplayScrubber } from "./replayscrubber";
import { useGameStore } from "./storecontext";

export const REPLAY_SCREEN_TEST_ID = "replay-screen";

const REPLAY_SCREEN_LABEL = "Replay";
const FIRST_TURN = 0;
const NO_SELECTION: MapSelection | null = null;
const noSelect = (): void => undefined;

export const ReplayScreen = () => {
  const frameCount = useGameStore((state) => state.hunt?.frames?.length ?? null);
  const [turn, setTurn] = useState(FIRST_TURN);
  /** `RevealFrame[]` is never empty once it exists (`playback.ts`'s guarantee), so `null` is the
   *  only case to guard against here. */
  if (frameCount === null) return null;

  const maxTurn = frameCount - 1;

  return (
    <section aria-label={REPLAY_SCREEN_LABEL} data-testid={REPLAY_SCREEN_TEST_ID}>
      <MapPanel
        selection={NO_SELECTION}
        onSelect={noSelect}
        overlay={
          <>
            <BeliefOverlayPanel />
            <CriminalPathPanel turn={turn} />
          </>
        }
      />
      <ReplayScrubber turn={turn} maxTurn={maxTurn} onScrub={setTurn} />
    </section>
  );
};
