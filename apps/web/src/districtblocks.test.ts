import { fc, test } from "@fast-check/vitest";
import type { DistrictType, MapNode, Position } from "@manhunter/core";
import { makeNode, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { type DistrictBlock, districtBlocksOf } from "./districtblocks";
import {
  type CellBounds,
  type CellPolygon,
  type DistrictCell,
  districtCellsOf,
  paddedBoundsOf,
} from "./districtcells";
import { LIMITS } from "./limits";

const GAP = 8;
const BOUNDS: CellBounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
const TOLERANCE = 1e-6;

const nodeAt = (index: number, districtType: DistrictType, position: Position): MapNode =>
  makeNode(makeNodeId(`n-${index}`), districtType, position);

const blocksFor = (
  nodes: readonly MapNode[],
  bounds: CellBounds,
  gap: number,
): readonly DistrictBlock[] => {
  const result = districtBlocksOf(nodes, bounds, gap);
  if (result.kind !== "blocks") throw new Error(`expected blocks, got ${result.kind}`);
  return result.blocks;
};

const cellsFor = (nodes: readonly MapNode[], bounds: CellBounds): readonly DistrictCell[] => {
  const result = districtCellsOf(nodes, bounds);
  if (result.kind !== "cells") throw new Error(`expected cells, got ${result.kind}`);
  return result.cells;
};

const xsOf = (polygon: CellPolygon): readonly number[] => polygon.map((point) => point.x);

const areaOf = (polygon: CellPolygon): number =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length] ?? point;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );

/** Whether `point` is inside or on the convex `polygon`, whichever way it winds. */
const convexContains = (polygon: CellPolygon, point: Position): boolean => {
  const sides = polygon.map((vertex, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? vertex;
    const length = Math.hypot(next.x - vertex.x, next.y - vertex.y);
    if (length === 0) return 0;
    return (
      ((next.x - vertex.x) * (point.y - vertex.y) - (next.y - vertex.y) * (point.x - vertex.x)) /
      length
    );
  });
  return sides.every((side) => side >= -TOLERANCE) || sides.every((side) => side <= TOLERANCE);
};

const pairOf = (left: DistrictType, right: DistrictType) => [
  nodeAt(0, left, { x: 50, y: 50 }),
  nodeAt(1, right, { x: 150, y: 50 }),
];

describe("district blocks", () => {
  it("cuts a street exactly the gap wide between two different districts", () => {
    const [left, right] = blocksFor(pairOf("downtown", "park"), BOUNDS, GAP);

    expect(Math.max(...xsOf(left?.polygon ?? []))).toBeCloseTo(100 - GAP / 2);
    expect(Math.min(...xsOf(right?.polygon ?? []))).toBeCloseTo(100 + GAP / 2);
  });

  it("leaves two cells of the same district touching, so they read as one blob", () => {
    const [left, right] = blocksFor(pairOf("residential", "residential"), BOUNDS, GAP);

    expect(Math.max(...xsOf(left?.polygon ?? []))).toBeCloseTo(100);
    expect(Math.min(...xsOf(right?.polygon ?? []))).toBeCloseTo(100);
  });

  it("does not pull a block in from the edge of the plate", () => {
    const [left, right] = blocksFor(pairOf("downtown", "park"), BOUNDS, GAP);

    expect(Math.min(...xsOf(left?.polygon ?? []))).toBeCloseTo(BOUNDS.minX);
    expect(Math.max(...xsOf(right?.polygon ?? []))).toBeCloseTo(BOUNDS.maxX);
  });

  it("keeps each node's id and district type on its block, in node order", () => {
    const nodes = pairOf("industrial", "suburb");

    expect(
      blocksFor(nodes, BOUNDS, GAP).map((block) => [block.nodeId, block.districtType]),
    ).toEqual(nodes.map((node) => [node.id, node.districtType]));
  });

  it("gives a cell narrower than the gap an empty block rather than an inverted one", () => {
    const narrow = [
      nodeAt(0, "downtown", { x: 0, y: 50 }),
      nodeAt(1, "park", { x: 2, y: 50 }),
      nodeAt(2, "downtown", { x: 4, y: 50 }),
    ];

    expect(blocksFor(narrow, BOUNDS, GAP)[1]?.polygon).toEqual([]);
  });

  it("treats two nodes on one point as one cell with no street through it", () => {
    const stacked = [nodeAt(0, "downtown", { x: 50, y: 50 }), nodeAt(1, "park", { x: 50, y: 50 })];

    for (const block of blocksFor(stacked, BOUNDS, GAP)) {
      expect(areaOf(block.polygon)).toBeCloseTo(
        areaOf(cellsFor(stacked, BOUNDS)[0]?.polygon ?? []),
      );
    }
  });

  /** AGENTS.md section 5: the cell cap still binds, and its refusal comes back unchanged. */
  it("passes the cell refusal through for a node list one past the bound", () => {
    const over = Array.from({ length: LIMITS.maxDistrictCellSites + 1 }, (_, index) =>
      nodeAt(index, "downtown", { x: index, y: 0 }),
    );

    expect(districtBlocksOf(over, BOUNDS, GAP)).toEqual({
      kind: "too_many_sites",
      sites: LIMITS.maxDistrictCellSites + 1,
      maxSites: LIMITS.maxDistrictCellSites,
    });
  });
});

const COORDINATE_RANGE = 1000;
const MAX_PROPERTY_SITES = 30;
const PADDING = 24;
const DISTRICT_TYPES: readonly DistrictType[] = ["downtown", "residential", "park", "exit"];

const siteArbitrary = fc.record({
  x: fc.integer({ min: 0, max: COORDINATE_RANGE }),
  y: fc.integer({ min: 0, max: COORDINATE_RANGE }),
  districtType: fc.constantFrom(...DISTRICT_TYPES),
});

const distinctSites = fc.uniqueArray(siteArbitrary, {
  minLength: 1,
  maxLength: MAX_PROPERTY_SITES,
  selector: (site) => `${site.x},${site.y}`,
});

const nodesOf = (
  sites: readonly { readonly x: number; readonly y: number; readonly districtType: DistrictType }[],
): readonly MapNode[] =>
  sites.map((site, index) => nodeAt(index, site.districtType, { x: site.x, y: site.y }));

describe("district block invariants", () => {
  test.prop([distinctSites])("every block lies inside its own cell", (sites) => {
    const nodes = nodesOf(sites);
    const bounds = paddedBoundsOf(
      nodes.map((node) => node.position),
      PADDING,
    );
    const cells = cellsFor(nodes, bounds);

    blocksFor(nodes, bounds, GAP).forEach((block, index) => {
      const cell = cells[index]?.polygon ?? [];
      for (const point of block.polygon) expect(convexContains(cell, point)).toBe(true);
    });
  });

  test.prop([distinctSites])("a city of one district has no streets cut at all", (sites) => {
    const nodes = nodesOf(sites.map((site) => ({ ...site, districtType: "suburb" as const })));
    const bounds = paddedBoundsOf(
      nodes.map((node) => node.position),
      PADDING,
    );
    const cells = cellsFor(nodes, bounds);

    blocksFor(nodes, bounds, GAP).forEach((block, index) => {
      expect(areaOf(block.polygon)).toBeCloseTo(areaOf(cells[index]?.polygon ?? []));
    });
  });
});
