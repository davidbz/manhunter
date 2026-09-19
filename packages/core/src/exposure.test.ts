import { describe, expect, it } from "vitest";
import type { DistrictProperties } from "./balance";
import { BALANCE } from "./balance";
import { districtPropertiesAt, witnessDensityAt } from "./exposure";
import { makeEdgeId, makeNodeId } from "./ids";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";

const downtown = makeNodeId("downtown");
const meadow = makeNodeId("meadow");
const way_out = makeNodeId("way-out");
const unbuilt = makeNodeId("unbuilt");

const NOON = 12;
const MIDNIGHT = 0;

const map: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(meadow, "park", { x: 1, y: 0 }),
    makeNode(way_out, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("footpath", makeEdgeId("downtown-meadow"), downtown, meadow),
    makeEdge("road", makeEdgeId("meadow-out"), meadow, way_out),
  ],
  exits: [makeExit(way_out, "highway")],
  river: null,
  incidentNodeId: downtown,
};

const propertiesAt = (nodeId: typeof downtown): DistrictProperties =>
  districtPropertiesAt(BALANCE.districts, map, nodeId);

describe("districtPropertiesAt", () => {
  it("reads the properties of the district the node sits in", () => {
    expect(propertiesAt(downtown)).toEqual(BALANCE.districts.downtown);
  });

  it("answers that nobody saw anything for a node the map does not have", () => {
    const nowhere = propertiesAt(unbuilt);
    expect(nowhere.witnessDensity).toBe(0);
    expect(nowhere.cctvCoverage).toBe(0);
    expect(nowhere.hidingSpots).toBe(0);
  });
});

describe("witnessDensityAt", () => {
  it("leaves the district's density alone by day", () => {
    expect(witnessDensityAt(BALANCE.time, propertiesAt(downtown), NOON)).toBe(
      BALANCE.districts.downtown.witnessDensity,
    );
  });

  it("empties a park after dark (DESIGN.md's district table)", () => {
    expect(witnessDensityAt(BALANCE.time, propertiesAt(meadow), MIDNIGHT)).toBe(0);
  });

  it("thins a crowd after dark without emptying it", () => {
    const properties = propertiesAt(downtown);
    const night = witnessDensityAt(BALANCE.time, properties, MIDNIGHT);
    expect(night).toBeGreaterThan(0);
    expect(night).toBeLessThan(properties.witnessDensity);
  });
});
