/**
 * How visible someone standing in a district is right now: DESIGN.md's "District properties"
 * table read at a given hour.
 *
 * Both sides ask it and neither owns it. `actions.ts` asks who was around to see the criminal
 * pass through; `ai.ts` asks how exposed the criminal feels standing there. One copy, because a
 * hunt where the witnesses and the criminal's nerve disagreed about how busy downtown is would
 * be two rules wearing one name.
 *
 * Both functions take the slice of balance they read rather than `Balance` itself, for the reason
 * `timeOfDayAt` takes `DaylightHours`: it keeps the dependency pointing one way and lets a test
 * vary one district without building a whole balance.
 */

import type { DistrictProperties } from "./balance";
import type { NodeId } from "./ids";
import type { DistrictType, MapGraph } from "./map";
import { type DaylightHours, type Hour, timeOfDayAt } from "./time";

export type DistrictTable = Readonly<Record<DistrictType, DistrictProperties>>;

/** A district with no cameras and no witnesses, which is what a node off the map amounts to. */
const NO_DISTRICT: DistrictProperties = {
  witnessDensity: 0,
  nightWitnessMultiplier: 0,
  hidingSpots: 0,
  cctvCoverage: 0,
};

/**
 * The properties of the district a node sits in. The fallback is only reached by a node the map
 * does not have, which every caller has already refused; it is here so the lookup is total rather
 * than assumed, and it answers "nobody saw anything", which is the honest reading.
 */
export const districtPropertiesAt = (
  districts: DistrictTable,
  map: MapGraph,
  nodeId: NodeId,
): DistrictProperties => {
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  return node === undefined ? NO_DISTRICT : districts[node.districtType];
};

/** DESIGN.md's district table: a park is watched by nobody after dark, a transit hub always is. */
export const witnessDensityAt = (
  hours: DaylightHours,
  properties: DistrictProperties,
  hour: Hour,
): number =>
  timeOfDayAt(hours, hour) === "night"
    ? properties.witnessDensity * properties.nightWitnessMultiplier
    : properties.witnessDensity;
