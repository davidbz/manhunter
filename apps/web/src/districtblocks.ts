/**
 * District blocks: M6.3's cells with ground-coloured street gaps cut between districts (PLAN M6.4).
 *
 * A cell edge shared with a neighbour of the **same** district is left where it is, so the two
 * cells touch and a district reads as one merged blob, which is what M6.3's contiguous regions
 * were grown for. An edge shared with a **different** district is pulled inward by half the
 * street gap on each side, so the two blobs are separated by a gap of exactly `streetGap`. Edges
 * on the plate's border are left alone and the city runs off the edge of the plan.
 *
 * Insetting a convex polygon edge by edge is one more half-plane clip per edge, so this reuses
 * `districtcells.ts`'s Sutherland-Hodgman step rather than a second geometry routine. Merging is
 * visual, not geometric: the output is still one polygon per node, which keeps `data-nodeid` on
 * every footprint and needs no polygon-union algorithm.
 *
 * Pure data in, pure data out. Bounded by `districtCellsOf`'s own site cap, which runs first.
 */

import type { DistrictType, MapNode, Position } from "@manhunter/core";
import {
  type CellBounds,
  type CellPolygon,
  clipToHalfPlane,
  type DistrictCellRefusal,
  districtCellsOf,
} from "./districtcells";

export type DistrictBlock = {
  readonly nodeId: MapNode["id"];
  readonly districtType: DistrictType;
  readonly polygon: CellPolygon;
};

export type DistrictBlockResult =
  | { readonly kind: "blocks"; readonly blocks: readonly DistrictBlock[] }
  | DistrictCellRefusal;

const MIDPOINT_FRACTION = 0.5;

/**
 * How far apart, in map units, two distances may be and still count as equal. A Voronoi edge's
 * midpoint is equidistant from the two sites it separates; the distances are computed from
 * clipped floats, so exact equality would miss real neighbours. Map units are hundreds, and the
 * float error is many orders below this.
 */
const EQUIDISTANT_TOLERANCE = 1e-6;

/** Polygon edges shorter than this are clipping artefacts with no direction to inset along. */
const DEGENERATE_EDGE_LENGTH = 1e-9;

const distanceBetween = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.y - b.y);

const midpointOf = (a: Position, b: Position): Position => ({
  x: a.x + (b.x - a.x) * MIDPOINT_FRACTION,
  y: a.y + (b.y - a.y) * MIDPOINT_FRACTION,
});

/**
 * The district across one cell edge, or `null` for a border edge. The site nearest the edge's
 * midpoint (other than the cell's own) is the neighbour exactly when it is as near as the cell's
 * own site is, which is the definition of a Voronoi edge. A node on the same point as this one is
 * not a neighbour: M6.3 gives the pair one shared cell and no bisector between them.
 */
const districtAcross = (
  midpoint: Position,
  own: MapNode,
  nodes: readonly MapNode[],
): DistrictType | null => {
  const ownDistance = distanceBetween(midpoint, own.position);
  const across = nodes.find(
    (other) =>
      distanceBetween(other.position, own.position) > EQUIDISTANT_TOLERANCE &&
      Math.abs(distanceBetween(midpoint, other.position) - ownDistance) <= EQUIDISTANT_TOLERANCE,
  );

  return across?.districtType ?? null;
};

/** Unit normal of `from -> to`, turned to point away from `site`. */
const outwardNormalOf = (from: Position, to: Position, site: Position): Position | null => {
  const length = distanceBetween(from, to);
  if (length < DEGENERATE_EDGE_LENGTH) return null;
  const normal = { x: (to.y - from.y) / length, y: (from.x - to.x) / length };
  const towardSite = (site.x - from.x) * normal.x + (site.y - from.y) * normal.y;

  return towardSite > 0 ? { x: -normal.x, y: -normal.y } : normal;
};

const insetEdge = (
  polygon: CellPolygon,
  from: Position,
  normal: Position,
  inset: number,
): CellPolygon =>
  clipToHalfPlane(polygon, {
    origin: { x: from.x - normal.x * inset, y: from.y - normal.y * inset },
    normal,
  });

const blockOf = (
  node: MapNode,
  cell: CellPolygon,
  nodes: readonly MapNode[],
  inset: number,
): CellPolygon =>
  cell.reduce((block, to, index) => {
    const from = cell[(index === 0 ? cell.length : index) - 1] ?? to;
    const across = districtAcross(midpointOf(from, to), node, nodes);
    if (across === null || across === node.districtType) return block;
    const normal = outwardNormalOf(from, to, node.position);
    if (normal === null) return block;

    return insetEdge(block, from, normal, inset);
  }, cell);

/**
 * One block per node, in node order: its M6.3 cell inside `bounds`, with every edge that faces a
 * different district pulled in by half of `streetGap`. A cell narrower than the gap comes back
 * with an empty polygon rather than an inverted one, and the renderer draws nothing for it.
 */
export const districtBlocksOf = (
  nodes: readonly MapNode[],
  bounds: CellBounds,
  streetGap: number,
): DistrictBlockResult => {
  const cells = districtCellsOf(nodes, bounds);
  if (cells.kind !== "cells") return cells;
  const inset = streetGap * MIDPOINT_FRACTION;

  return {
    kind: "blocks",
    blocks: cells.cells.flatMap((cell, index) => {
      const node = nodes[index];
      if (node === undefined) return [];

      return [{ ...cell, polygon: blockOf(node, cell.polygon, nodes, inset) }];
    }),
  };
};
