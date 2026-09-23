import { makeNode, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  angleOf,
  coordinate,
  midpointOf,
  plateBoundsOf,
  pointsOf,
  segmentPathOf,
} from "./mapgeometry";

describe("map geometry", () => {
  it("keeps two decimals on a coordinate", () => {
    expect(coordinate(1.23456)).toBe(1.23);
    expect(coordinate(-0.005)).toBe(-0.01);
  });

  it("formats points and segments with the same rounding", () => {
    expect(
      pointsOf([
        { x: 1.004, y: 2 },
        { x: 3, y: 4.567 },
      ]),
    ).toBe("1,2 3,4.57");
    expect(segmentPathOf({ x: 0, y: 0 }, { x: 10.111, y: 5 })).toBe("M0 0 L10.11 5");
  });

  it("finds the midpoint of a segment", () => {
    expect(midpointOf({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 });
  });

  it("measures direction in degrees clockwise from the x axis, as SVG rotates", () => {
    expect(angleOf({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(0);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(90);
    expect(angleOf({ x: 0, y: 0 }, { x: -5, y: 0 })).toBe(180);
  });

  it("bounds the plate round the nodes and the river both, padded", () => {
    const nodes = [makeNode(makeNodeId("n-a"), "downtown", { x: 10, y: 10 })];
    const river = {
      points: [
        { x: -40, y: 20 },
        { x: 60, y: 90 },
      ],
    };

    expect(plateBoundsOf({ nodes, river }, 5)).toEqual({ minX: -45, minY: 5, maxX: 65, maxY: 95 });
    expect(plateBoundsOf({ nodes, river: null }, 5)).toEqual({
      minX: 5,
      minY: 5,
      maxX: 15,
      maxY: 15,
    });
  });
});
