import { fc, test } from "@fast-check/vitest";
import type { MapNode, NodeId, Position } from "@manhunter/core";
import { makeNode, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { type ContourSegment, contourOf, polygonEdgesOf } from "./beliefcontour";
import {
  type CellBounds,
  type CellPolygon,
  type DistrictCell,
  districtCellsOf,
  paddedBoundsOf,
} from "./districtcells";

/**
 * PLAN M6.6's top-tier contour, on the geometry rather than the drawing. The invariant that matters
 * is the one the property states: every segment kept is on the region's edge, with the region on
 * one side and not on the other; everything else here pins a case the property cannot name.
 */

const PADDING = 24;
const PROBE = 1e-3;
const EDGE_TOLERANCE = 1e-9;

const nodeAt = (index: number, position: Position): MapNode =>
  makeNode(makeNodeId(`n-${index}`), "downtown", position);

const nodesAt = (positions: readonly Position[]): readonly MapNode[] =>
  positions.map((position, index) => nodeAt(index, position));

const cellsFor = (nodes: readonly MapNode[], bounds: CellBounds): readonly DistrictCell[] => {
  const result = districtCellsOf(nodes, bounds);
  if (result.kind !== "cells") throw new Error(`expected cells, got ${result.kind}`);
  return result.cells;
};

const boundsOf = (nodes: readonly MapNode[]): CellBounds =>
  paddedBoundsOf(
    nodes.map((node) => node.position),
    PADDING,
  );

const signedArea = (polygon: CellPolygon): number =>
  polygon.reduce((sum, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? vertex;
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0);

const containsPoint = (polygon: CellPolygon, point: Position): boolean => {
  if (polygon.length === 0) return false;
  const orientation = Math.sign(signedArea(polygon));
  return polygon.every((vertex, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? vertex;
    const cross =
      (next.x - vertex.x) * (point.y - vertex.y) - (next.y - vertex.y) * (point.x - vertex.x);
    return cross * orientation >= -EDGE_TOLERANCE;
  });
};

const inRegion = (cells: readonly DistrictCell[], inside: ReadonlySet<NodeId>, point: Position) =>
  cells.some((cell) => inside.has(cell.nodeId) && containsPoint(cell.polygon, point));

/** The midpoint of a segment nudged `PROBE` off it along its normal, each way. */
const probesOf = (segment: ContourSegment): readonly [Position, Position] => {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const length = Math.hypot(dx, dy);
  const mid = { x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 };
  const normal = { x: (-dy / length) * PROBE, y: (dx / length) * PROBE };
  return [
    { x: mid.x + normal.x, y: mid.y + normal.y },
    { x: mid.x - normal.x, y: mid.y - normal.y },
  ];
};

const lengthOf = (segments: readonly ContourSegment[]): number =>
  segments.reduce(
    (sum, segment) =>
      sum + Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y),
    0,
  );

const GRID = nodesAt([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
  { x: 0, y: 100 },
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 0, y: 200 },
  { x: 100, y: 200 },
  { x: 200, y: 200 },
]);

const idsOf = (...indexes: readonly number[]): ReadonlySet<NodeId> =>
  new Set(indexes.map((index) => makeNodeId(`n-${index}`)));

describe("a polygon's edges", () => {
  it("includes the closing edge", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    expect(polygonEdgesOf(square)).toHaveLength(4);
    expect(polygonEdgesOf(square)[3]).toEqual({ from: { x: 0, y: 10 }, to: { x: 0, y: 0 } });
  });

  it("drops an edge too short to have a direction", () => {
    const repeated = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];

    expect(polygonEdgesOf(repeated)).toHaveLength(3);
  });

  it("has none for an empty polygon", () => {
    expect(polygonEdgesOf([])).toEqual([]);
  });
});

describe("the top-tier contour", () => {
  const cells = cellsFor(GRID, boundsOf(GRID));

  it("outlines a lone cell with every one of its edges", () => {
    const centre = cells[4]?.polygon ?? [];

    expect(contourOf(cells, idsOf(4))).toHaveLength(polygonEdgesOf(centre).length);
  });

  it("drops the edge two cells in the region share, so two neighbours read as one region", () => {
    const pair = contourOf(cells, idsOf(4, 5));
    const bounds = boundsOf(GRID);
    const spanX = bounds.maxX - 50;
    const spanY = 100;

    expect(pair).toHaveLength(6);
    expect(lengthOf(pair)).toBeCloseTo(2 * (spanX + spanY), 6);
  });

  it("outlines the whole plate when every node is in the region", () => {
    const bounds = boundsOf(GRID);
    const perimeter = 2 * (bounds.maxX - bounds.minX + (bounds.maxY - bounds.minY));

    expect(lengthOf(contourOf(cells, idsOf(0, 1, 2, 3, 4, 5, 6, 7, 8)))).toBeCloseTo(perimeter, 6);
  });

  it("is nothing when the region is empty", () => {
    expect(contourOf(cells, new Set())).toEqual([]);
  });

  it("ignores a node the cells do not have", () => {
    expect(contourOf(cells, new Set([makeNodeId("n-off-map")]))).toEqual([]);
  });

  it("returns something drawable for coincident nodes rather than throwing", () => {
    const stacked = nodesAt([
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 150, y: 50 },
    ]);
    const stackedCells = cellsFor(stacked, boundsOf(stacked));

    expect(() => contourOf(stackedCells, idsOf(0, 1, 2))).not.toThrow();
    expect(contourOf(stackedCells, idsOf(0)).length).toBeGreaterThan(0);
  });

  test.prop([
    fc.uniqueArray(
      fc.record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 400 }) }),
      {
        minLength: 2,
        maxLength: 24,
        selector: (point) => `${point.x},${point.y}`,
      },
    ),
    fc.array(fc.boolean(), { minLength: 24, maxLength: 24 }),
  ])("keeps only segments with the region on exactly one side", (points, picks) => {
    const nodes = nodesAt(points);
    const all = cellsFor(nodes, boundsOf(nodes));
    const inside = new Set(nodes.filter((_, index) => picks[index]).map((node) => node.id));

    for (const segment of contourOf(all, inside)) {
      const [left, right] = probesOf(segment);
      expect(inRegion(all, inside, left)).not.toBe(inRegion(all, inside, right));
    }
  });
});
