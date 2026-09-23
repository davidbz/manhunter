/**
 * A footprint polygon per map node, derived from node positions alone (PLAN M6.3).
 *
 * Each cell starts as the padded map rectangle and is cut down by the perpendicular bisector
 * between its site and every other site, keeping the side nearer its own site: Sutherland-Hodgman
 * clipping against one half-plane at a time. What survives is the node's Voronoi cell inside the
 * rectangle. Derived here rather than in `core` because `core` keeps the generating grid off
 * `MapGraph` on purpose, and positions are the one thing every generator, today's jittered grid
 * and M8's Voronoi alike, is guaranteed to produce.
 *
 * Pure data in, pure data out; no rendering. The cell carries its node's `districtType` so the
 * renderer can merge neighbouring cells of one type into a district blob.
 */

import type { DistrictType, MapNode, NodeId, Position } from "@manhunter/core";
import { LIMITS } from "./limits";

/** An axis-aligned rectangle in map units, the same space `MapNode.position` is in. */
export type CellBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** A convex polygon, vertices in order. Closed implicitly: the last vertex joins the first. */
export type CellPolygon = readonly Position[];

export type DistrictCell = {
  readonly nodeId: NodeId;
  readonly districtType: DistrictType;
  readonly polygon: CellPolygon;
};

/** Why no cells were produced. The node list is bounded before any clipping runs. */
export type DistrictCellRefusal = {
  readonly kind: "too_many_sites";
  readonly sites: number;
  readonly maxSites: number;
};

export type DistrictCellResult =
  | { readonly kind: "cells"; readonly cells: readonly DistrictCell[] }
  | DistrictCellRefusal;

const MIDPOINT_FRACTION = 0.5;

/** A line through `origin`; points on the `normal` side are outside. */
export type HalfPlane = {
  readonly origin: Position;
  readonly normal: Position;
};

const leastOf = (values: readonly number[]): number =>
  values.reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY);

const greatestOf = (values: readonly number[]): number =>
  values.reduce((greatest, value) => Math.max(greatest, value), Number.NEGATIVE_INFINITY);

/**
 * The rectangle around `points` grown by `padding` on every side. No points gives a
 * padding-sized square at the origin rather than infinite bounds, the same fallback
 * `maprenderer.tsx`'s `viewBox` uses.
 */
export const paddedBoundsOf = (points: readonly Position[], padding: number): CellBounds => {
  if (points.length === 0) {
    return { minX: -padding, minY: -padding, maxX: padding, maxY: padding };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: leastOf(xs) - padding,
    minY: leastOf(ys) - padding,
    maxX: greatestOf(xs) + padding,
    maxY: greatestOf(ys) + padding,
  };
};

const rectangleOf = (bounds: CellBounds): CellPolygon => [
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
];

const signedDistance = (point: Position, plane: HalfPlane): number =>
  (point.x - plane.origin.x) * plane.normal.x + (point.y - plane.origin.y) * plane.normal.y;

const crossingOf = (from: Position, to: Position, fromSide: number, toSide: number): Position => {
  const fraction = fromSide / (fromSide - toSide);

  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
};

/** The vertices one polygon edge contributes: its end, if kept, and where it crosses the line. */
const edgeContribution = (from: Position, to: Position, plane: HalfPlane): readonly Position[] => {
  const fromSide = signedDistance(from, plane);
  const toSide = signedDistance(to, plane);
  const toInside = toSide <= 0;
  if (fromSide <= 0 === toInside) return toInside ? [to] : [];
  const crossing = crossingOf(from, to, fromSide, toSide);

  return toInside ? [crossing, to] : [crossing];
};

/**
 * The part of a convex polygon on the inside of `plane`. Exported for `districtblocks.ts`, which
 * insets a cell by clipping it against its own edges moved inward.
 */
export const clipToHalfPlane = (polygon: CellPolygon, plane: HalfPlane): CellPolygon =>
  polygon.flatMap((to, index) => {
    const from = polygon[(index === 0 ? polygon.length : index) - 1] ?? to;

    return edgeContribution(from, to, plane);
  });

const bisectorBetween = (site: Position, other: Position): HalfPlane => ({
  origin: {
    x: site.x + (other.x - site.x) * MIDPOINT_FRACTION,
    y: site.y + (other.y - site.y) * MIDPOINT_FRACTION,
  },
  normal: { x: other.x - site.x, y: other.y - site.y },
});

const coincide = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

/**
 * Coincident sites have no bisector, so they do not clip each other and each gets the same cell.
 * That keeps every cell containing its own site and drawable, at the cost of those cells
 * overlapping - a map with two nodes on one point has no better answer.
 */
const cellPolygonOf = (site: Position, sites: readonly Position[], rectangle: CellPolygon) =>
  sites
    .filter((other) => !coincide(site, other))
    .reduce((polygon, other) => clipToHalfPlane(polygon, bisectorBetween(site, other)), rectangle);

/**
 * One cell per node, in node order, each clipped from `bounds`. A node outside `bounds` can come
 * back with an empty polygon; bounds from `paddedBoundsOf` over the same nodes never do that.
 */
export const districtCellsOf = (
  nodes: readonly MapNode[],
  bounds: CellBounds,
): DistrictCellResult => {
  if (nodes.length > LIMITS.maxDistrictCellSites) {
    return {
      kind: "too_many_sites",
      sites: nodes.length,
      maxSites: LIMITS.maxDistrictCellSites,
    };
  }
  const rectangle = rectangleOf(bounds);
  const sites = nodes.map((node) => node.position);

  return {
    kind: "cells",
    cells: nodes.map((node) => ({
      nodeId: node.id,
      districtType: node.districtType,
      polygon: cellPolygonOf(node.position, sites, rectangle),
    })),
  };
};
