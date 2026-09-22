import { fc, test } from "@fast-check/vitest";
import type { MapNode, Position } from "@manhunter/core";
import { makeNode, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type CellBounds,
  type CellPolygon,
  type DistrictCell,
  districtCellsOf,
  paddedBoundsOf,
} from "./districtcells";
import { LIMITS } from "./limits";

const PADDING = 24;
const AREA_TOLERANCE = 1e-6;
const EDGE_TOLERANCE = 1e-9;

const nodeAt = (index: number, position: Position): MapNode =>
  makeNode(makeNodeId(`n-${index}`), index % 2 === 0 ? "downtown" : "park", position);

const nodesAt = (positions: readonly Position[]): readonly MapNode[] =>
  positions.map((position, index) => nodeAt(index, position));

const areaOf = (polygon: CellPolygon): number =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length] ?? point;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );

const boundsArea = (bounds: CellBounds): number =>
  (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

/** Least signed distance from `point` to the inside of every edge; positive is strictly inside. */
const insideMargin = (polygon: CellPolygon, point: Position): number => {
  const orientation = Math.sign(
    polygon.reduce((sum, vertex, index) => {
      const next = polygon[(index + 1) % polygon.length] ?? vertex;
      return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0),
  );
  return polygon.reduce((least, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? vertex;
    const edgeX = next.x - vertex.x;
    const edgeY = next.y - vertex.y;
    const length = Math.hypot(edgeX, edgeY);
    if (length === 0) return least;
    const cross = (edgeX * (point.y - vertex.y) - edgeY * (point.x - vertex.x)) / length;
    return Math.min(least, cross * orientation);
  }, Number.POSITIVE_INFINITY);
};

const containsPoint = (polygon: CellPolygon, point: Position): boolean =>
  polygon.length > 0 && insideMargin(polygon, point) >= -EDGE_TOLERANCE;

const strictlyContains = (polygon: CellPolygon, point: Position): boolean =>
  polygon.length > 0 && insideMargin(polygon, point) > EDGE_TOLERANCE;

const cellsFor = (nodes: readonly MapNode[], bounds: CellBounds): readonly DistrictCell[] => {
  const result = districtCellsOf(nodes, bounds);
  if (result.kind !== "cells") throw new Error(`expected cells, got ${result.kind}`);
  return result.cells;
};

const SQUARE = nodesAt([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 0, y: 100 },
  { x: 100, y: 100 },
]);

describe("padded bounds", () => {
  it("grows the extent of the points by the padding on every side", () => {
    expect(
      paddedBoundsOf(
        SQUARE.map((node) => node.position),
        PADDING,
      ),
    ).toEqual({
      minX: -PADDING,
      minY: -PADDING,
      maxX: 100 + PADDING,
      maxY: 100 + PADDING,
    });
  });

  it("gives a padding-sized square for no points instead of infinite bounds", () => {
    expect(paddedBoundsOf([], PADDING)).toEqual({
      minX: -PADDING,
      minY: -PADDING,
      maxX: PADDING,
      maxY: PADDING,
    });
  });
});

describe("district cells", () => {
  const bounds = paddedBoundsOf(
    SQUARE.map((node) => node.position),
    PADDING,
  );

  it("splits a square of four sites into four equal quadrants", () => {
    const cells = cellsFor(SQUARE, bounds);

    expect(cells.map((cell) => areaOf(cell.polygon))).toEqual([74 * 74, 74 * 74, 74 * 74, 74 * 74]);
  });

  it("keeps each node's id and district type, in node order", () => {
    const cells = cellsFor(SQUARE, bounds);

    expect(cells.map((cell) => [cell.nodeId, cell.districtType])).toEqual(
      SQUARE.map((node) => [node.id, node.districtType]),
    );
  });

  it("is deterministic for a given node list", () => {
    expect(cellsFor(SQUARE, bounds)).toEqual(cellsFor(SQUARE, bounds));
  });

  it("returns no cells for no nodes", () => {
    expect(cellsFor([], paddedBoundsOf([], PADDING))).toEqual([]);
  });

  it("gives a single node the whole padded rectangle", () => {
    const lone = nodesAt([{ x: 40, y: 60 }]);
    const loneBounds = paddedBoundsOf([{ x: 40, y: 60 }], PADDING);

    const [cell] = cellsFor(lone, loneBounds);

    expect(cell?.polygon).toHaveLength(4);
    expect(areaOf(cell?.polygon ?? [])).toBe(boundsArea(loneBounds));
  });

  it("gives coincident nodes the same drawable cell rather than throwing", () => {
    const stacked = nodesAt([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 90, y: 10 },
    ]);
    const stackedBounds = paddedBoundsOf(
      stacked.map((node) => node.position),
      PADDING,
    );

    const [first, second, third] = cellsFor(stacked, stackedBounds);

    expect(first?.polygon).toEqual(second?.polygon);
    expect(areaOf(first?.polygon ?? [])).toBeGreaterThan(0);
    expect(containsPoint(first?.polygon ?? [], { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(third?.polygon ?? [], { x: 90, y: 10 })).toBe(true);
  });

  it("gives every node a cell when all of them share one point", () => {
    const pile = nodesAt([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    const pileBounds = paddedBoundsOf([{ x: 5, y: 5 }], PADDING);

    const cells = cellsFor(pile, pileBounds);

    expect(cells.map((cell) => areaOf(cell.polygon))).toEqual([
      boundsArea(pileBounds),
      boundsArea(pileBounds),
    ]);
  });

  it("clips collinear sites into bands", () => {
    const row = nodesAt([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const rowBounds = paddedBoundsOf(
      row.map((node) => node.position),
      PADDING,
    );

    const areas = cellsFor(row, rowBounds).map((cell) => areaOf(cell.polygon));

    [49 * 48, 50 * 48, 49 * 48].forEach((expected, index) => {
      expect(areas[index]).toBeCloseTo(expected);
    });
  });

  it("clips a cell for every site right up to the bound", () => {
    const full = Array.from({ length: LIMITS.maxDistrictCellSites }, (_, index) =>
      nodeAt(index, { x: index % 16, y: Math.floor(index / 16) }),
    );

    expect(
      cellsFor(
        full,
        paddedBoundsOf(
          full.map((node) => node.position),
          PADDING,
        ),
      ),
    ).toHaveLength(LIMITS.maxDistrictCellSites);
  });

  /** AGENTS.md section 5: one site over the bound is refused before any clipping runs. */
  it("refuses a node list one past the bound", () => {
    const over = Array.from({ length: LIMITS.maxDistrictCellSites + 1 }, (_, index) =>
      nodeAt(index, { x: index, y: 0 }),
    );

    expect(districtCellsOf(over, bounds)).toEqual({
      kind: "too_many_sites",
      sites: LIMITS.maxDistrictCellSites + 1,
      maxSites: LIMITS.maxDistrictCellSites,
    });
  });
});

const COORDINATE_RANGE = 1000;
const MAX_PROPERTY_SITES = 40;
const SAMPLE_COUNT = 20;

const pointArbitrary = fc.record({
  x: fc.integer({ min: 0, max: COORDINATE_RANGE }),
  y: fc.integer({ min: 0, max: COORDINATE_RANGE }),
});

const distinctPoints = fc.uniqueArray(pointArbitrary, {
  minLength: 1,
  maxLength: MAX_PROPERTY_SITES,
  selector: (point) => `${point.x},${point.y}`,
});

describe("district cell invariants", () => {
  test.prop([distinctPoints])("every cell contains its own site", (points) => {
    const nodes = nodesAt(points);
    const cells = cellsFor(nodes, paddedBoundsOf(points, PADDING));

    cells.forEach((cell, index) => {
      expect(containsPoint(cell.polygon, points[index] ?? { x: 0, y: 0 })).toBe(true);
    });
  });

  test.prop([distinctPoints])("cell areas sum to the bounds area", (points) => {
    const bounds = paddedBoundsOf(points, PADDING);
    const total = cellsFor(nodesAt(points), bounds).reduce(
      (sum, cell) => sum + areaOf(cell.polygon),
      0,
    );

    expect(Math.abs(total - boundsArea(bounds))).toBeLessThan(AREA_TOLERANCE * boundsArea(bounds));
  });

  test.prop([distinctPoints, fc.array(pointArbitrary, { maxLength: SAMPLE_COUNT })])(
    "no point lies strictly inside two cells",
    (points, samples) => {
      const cells = cellsFor(nodesAt(points), paddedBoundsOf(points, PADDING));

      for (const sample of samples) {
        const holders = cells.filter((cell) => strictlyContains(cell.polygon, sample));
        expect(holders.length).toBeLessThanOrEqual(1);
      }
    },
  );
});
