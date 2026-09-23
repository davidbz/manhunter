/**
 * Coordinate formatting and segment arithmetic shared by the map's layers (PLAN M6.5). Split out
 * of `maprenderer.tsx` when the actors moved to `mapactors.tsx`, so both format a coordinate the
 * same way without importing each other.
 */

import type { MapNode, Position, River } from "@manhunter/core";
import { type CellBounds, paddedBoundsOf } from "./districtcells";

/** Decimals kept on a coordinate. Positions are jittered floats; two is under a pixel at any zoom. */
const COORDINATE_DECIMALS = 2;

export const MIDPOINT_FRACTION = 0.5;

const DEGREES_PER_HALF_TURN = 180;

export const coordinate = (value: number): number => Number(value.toFixed(COORDINATE_DECIMALS));

export const pointsOf = (points: readonly Position[]): string =>
  points.map((point) => `${coordinate(point.x)},${coordinate(point.y)}`).join(" ");

export const midpointOf = (from: Position, to: Position): Position => ({
  x: (from.x + to.x) * MIDPOINT_FRACTION,
  y: (from.y + to.y) * MIDPOINT_FRACTION,
});

/** The direction from `from` to `to`, in degrees clockwise from the x axis (SVG's `rotate`). */
export const angleOf = (from: Position, to: Position): number =>
  (Math.atan2(to.y - from.y, to.x - from.x) * DEGREES_PER_HALF_TURN) / Math.PI;

export const segmentPathOf = (from: Position, to: Position): string =>
  `M${coordinate(from.x)} ${coordinate(from.y)} L${coordinate(to.x)} ${coordinate(to.y)}`;

/**
 * The map's plate: every node and every river point, padded. It is the renderer's `viewBox` and
 * the rectangle the district cells tile, and the belief contour (PLAN M6.6) clips the same cells
 * from it, so all three agree to the unit.
 */
export const plateBoundsOf = (
  map: { readonly nodes: readonly MapNode[]; readonly river: River | null },
  padding: number,
): CellBounds =>
  paddedBoundsOf(
    [...map.nodes.map((node) => node.position), ...(map.river?.points ?? [])],
    padding,
  );
