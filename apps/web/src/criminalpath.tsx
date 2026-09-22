/**
 * The criminal's true path, drawn over the heatmap once a hunt is over (PLAN M5.6b, DESIGN.md
 * "After-action replay": "Replay reveals the criminal's true path over the hunter's heatmap,
 * turn by turn").
 *
 * It is a pure render of `RevealFrame`s and never a `WorldState` (architecture rule 4) - the
 * frames it is handed are the only way it learns where the criminal stood, and it trusts nothing
 * else. It draws into the same overlay layer `beliefoverlay.tsx` does, composed alongside it by
 * whoever renders the map (`M5.3b`'s note: "M5.6b composes by passing both nodes into the one
 * overlay slot"), so this component takes no pointer-events stance of its own.
 *
 * Two things are drawn: the trail, every position the criminal held from turn 0 up to the turn
 * being scrubbed to, and the marker, the one position for that turn - which is the AC's "shows
 * the criminal's position for it". A frame naming a node the map does not have is dropped, the
 * way a stale belief cell is in `beliefoverlay.tsx`.
 */

import type { MapNode, NodeId, Position, RevealFrame, Turn } from "@manhunter/core";
import { positionIndexOf } from "./mapnodes";
import { CRIMINAL_PATH_THEME } from "./theme";

export type CriminalPathTheme = {
  readonly trailStroke: string;
  readonly trailWidth: number;
  readonly markerFill: string;
  readonly markerStroke: string;
  readonly markerStrokeWidth: number;
  readonly markerRadius: number;
};

/**
 * Gold against the map's red heatmap, so the current position reads apart from the trail. The
 * values are `theme.ts`'s `CRIMINAL_PATH_THEME` (PLAN M5.7); this file keeps only the type.
 */
export const DEFAULT_CRIMINAL_PATH_THEME: CriminalPathTheme = CRIMINAL_PATH_THEME;

export type CriminalPathProps = {
  readonly frames: readonly RevealFrame[];
  readonly nodes: readonly MapNode[];
  readonly turn: Turn;
  readonly theme?: CriminalPathTheme;
};

export const CRIMINAL_PATH_TEST_ID = "criminal-path";
export const CRIMINAL_PATH_TRAIL_TEST_ID = "criminal-path-trail";
export const CRIMINAL_PATH_MARKER_TEST_ID = "criminal-path-marker";

const NO_FILL = "none";
const ROUND_CAP = "round";

/** A polyline needs two points to draw a segment; one position is a marker, not a trail. */
const TRAIL_MIN_POINTS = 2;

/** Decimals kept on a rendered number, for the reason `maprenderer.tsx` rounds coordinates. */
const PATH_DECIMALS = 2;

const rounded = (value: number): number => Number(value.toFixed(PATH_DECIMALS));

/**
 * Every position the criminal held from turn 0 up to `turn`, in order. Exported so the mapping
 * is asserted directly rather than fished out of the SVG (AGENTS.md "do not snapshot-test the
 * SVG"), the way `beliefoverlay.tsx`'s `heatOf` is.
 */
export const trailPositionsOf = (
  frames: readonly RevealFrame[],
  positions: ReadonlyMap<NodeId, Position>,
  turn: Turn,
): readonly Position[] =>
  frames
    .filter((frame) => frame.turn <= turn)
    .flatMap((frame) => {
      const position = positions.get(frame.criminalNodeId);
      return position === undefined ? [] : [position];
    });

export type Marker = { readonly nodeId: NodeId; readonly position: Position };

/** The one frame for the scrubbed turn, and where it places the criminal on the map. */
export const markerOf = (
  frames: readonly RevealFrame[],
  positions: ReadonlyMap<NodeId, Position>,
  turn: Turn,
): Marker | null => {
  const frame = frames.find((each) => each.turn === turn);
  if (frame === undefined) return null;

  const position = positions.get(frame.criminalNodeId);
  if (position === undefined) return null;

  return { nodeId: frame.criminalNodeId, position };
};

export const CriminalPath = ({
  frames,
  nodes,
  turn,
  theme = DEFAULT_CRIMINAL_PATH_THEME,
}: CriminalPathProps) => {
  const positions = positionIndexOf(nodes);
  const trail = trailPositionsOf(frames, positions, turn);
  const marker = markerOf(frames, positions, turn);
  if (trail.length === 0 && marker === null) return null;

  return (
    <g data-testid={CRIMINAL_PATH_TEST_ID}>
      {trail.length >= TRAIL_MIN_POINTS ? (
        <polyline
          data-testid={CRIMINAL_PATH_TRAIL_TEST_ID}
          points={trail
            .map((position) => `${rounded(position.x)},${rounded(position.y)}`)
            .join(" ")}
          fill={NO_FILL}
          stroke={theme.trailStroke}
          strokeWidth={theme.trailWidth}
          strokeLinecap={ROUND_CAP}
          strokeLinejoin={ROUND_CAP}
        />
      ) : null}
      {marker === null ? null : (
        <circle
          data-testid={CRIMINAL_PATH_MARKER_TEST_ID}
          data-nodeid={marker.nodeId}
          data-turn={turn}
          cx={rounded(marker.position.x)}
          cy={rounded(marker.position.y)}
          r={theme.markerRadius}
          fill={theme.markerFill}
          stroke={theme.markerStroke}
          strokeWidth={theme.markerStrokeWidth}
        />
      )}
    </g>
  );
};
