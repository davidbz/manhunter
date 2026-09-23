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
 *
 * PLAN M6.9 gives the map a sized container (`.mh-replay__map`, the `.mh-frame__map` rule) so it
 * letterboxes into the debrief instead of painting taller than the viewport, and mounts the map's
 * `BeliefLegend` under it, since the heatmap it keys is drawn here too.
 */

import { useRef, useState } from "react";
import { BeliefLegend } from "./belieflegend";
import { BeliefOverlayPanel } from "./beliefoverlaypanel";
import { CriminalPathPanel } from "./criminalpathpanel";
import { HeatmapSummaryPanel } from "./heatmapsummarypanel";
import { MapPanel } from "./mappanel";
import type { MapSelection } from "./maprenderer";
import { ReplayScrubber } from "./replayscrubber";
import { SkipLink } from "./skiplink";
import { useGameStore } from "./storecontext";

export const REPLAY_SCREEN_TEST_ID = "replay-screen";
export const REPLAY_MAP_TEST_ID = "replay-map";

const REPLAY_SCREEN_LABEL = "Replay";
const SKIP_TO_CONTROLS_LABEL = "Skip the map, go to replay controls";
const SKIP_TO_CONTROLS_NAME = "replay-controls";
const FIRST_TURN = 0;
const NO_SELECTION: MapSelection | null = null;
const noSelect = (): void => undefined;

export const ReplayScreen = () => {
  const frameCount = useGameStore((state) => state.hunt?.frames?.length ?? null);
  const [turn, setTurn] = useState(FIRST_TURN);
  const controls = useRef<HTMLDivElement>(null);
  /** `RevealFrame[]` is never empty once it exists (`playback.ts`'s guarantee), so `null` is the
   *  only case to guard against here. */
  if (frameCount === null) return null;

  const maxTurn = frameCount - 1;

  return (
    <section
      className="mh-replay"
      aria-label={REPLAY_SCREEN_LABEL}
      data-testid={REPLAY_SCREEN_TEST_ID}
    >
      <SkipLink name={SKIP_TO_CONTROLS_NAME} label={SKIP_TO_CONTROLS_LABEL} target={controls} />
      <HeatmapSummaryPanel />
      <div className="mh-replay__map" data-testid={REPLAY_MAP_TEST_ID}>
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
      </div>
      <BeliefLegend />
      <ReplayScrubber turn={turn} maxTurn={maxTurn} onScrub={setTurn} controlsRef={controls} />
    </section>
  );
};
