import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import type { CriminalKnowledge, CriminalState } from "./criminal";
import {
  EMPTY_CRIMINAL_KNOWLEDGE,
  heatFactorOf,
  makeCriminalState,
  recentNodeIds,
  trailAfter,
  withKnownRoadblock,
} from "./criminal";
import { makeEdgeId, makeNodeId, type NodeId } from "./ids";
import { LIMITS } from "./limits";

const START_STAMINA = 100;
const START_CASH = 250;

const input: Omit<CriminalState, "knowledge" | "trail" | "inCustody"> = {
  nodeId: makeNodeId("downtown"),
  travelMode: "foot",
  profile: "amateur",
  stamina: START_STAMINA,
  heat: 0,
  cash: START_CASH,
  desperation: 0,
};

describe("makeCriminalState", () => {
  it("starts the criminal knowing nothing about the hunt", () => {
    expect(makeCriminalState(input).knowledge).toEqual(EMPTY_CRIMINAL_KNOWLEDGE);
  });

  it("starts the criminal with nowhere behind it", () => {
    expect(makeCriminalState(input).trail).toEqual([]);
  });

  it("starts the criminal at large", () => {
    expect(makeCriminalState(input).inCustody).toBe(false);
  });

  it("keeps every measured value it was given", () => {
    const criminal = makeCriminalState(input);
    expect(criminal.nodeId).toBe(input.nodeId);
    expect(criminal.stamina).toBe(START_STAMINA);
    expect(criminal.cash).toBe(START_CASH);
    expect(criminal.profile).toBe("amateur");
  });

  it("round-trips through JSON (architecture rule 3)", () => {
    const criminal = makeCriminalState(input);
    expect(JSON.parse(JSON.stringify(criminal))).toEqual(criminal);
  });
});

describe("heatFactorOf", () => {
  const bounds = { heatMax: 100 };

  it("reads how recognisable the criminal is as a fraction of the meter", () => {
    expect(heatFactorOf(bounds, 0)).toBe(0);
    expect(heatFactorOf(bounds, bounds.heatMax)).toBe(1);
    expect(heatFactorOf(bounds, bounds.heatMax / 4)).toBeCloseTo(0.25);
  });

  it("never reads outside the meter, whatever it is handed", () => {
    expect(heatFactorOf(bounds, bounds.heatMax * 3)).toBe(1);
    expect(heatFactorOf(bounds, -bounds.heatMax)).toBe(0);
  });
});

const downtown = makeNodeId("downtown");
const park = makeNodeId("park");
const terminal = makeNodeId("terminal");

const at = (nodeId: NodeId, trail: readonly NodeId[]): CriminalState => ({
  ...makeCriminalState(input),
  nodeId,
  trail,
});

describe("trailAfter", () => {
  it("puts the turn just spent at the front", () => {
    expect(trailAfter(at(park, [downtown]))).toEqual([park, downtown]);
  });

  it("records a turn that went nowhere, because it counts turns and not places", () => {
    expect(trailAfter(at(park, [park, park]))).toEqual([park, park, park]);
  });

  it("drops the oldest turn at the cap", () => {
    const full = Array.from({ length: LIMITS.maxCriminalTrail }, () => downtown);

    expect(trailAfter(at(park, full))).toEqual([
      park,
      ...full.slice(0, LIMITS.maxCriminalTrail - 1),
    ]);
  });

  test.prop([fc.array(fc.constantFrom(downtown, park, terminal), { maxLength: 64 })], {
    numRuns: 64,
  })("never grows past LIMITS.maxCriminalTrail, however long the hunt runs", (visited) => {
    let walked: CriminalState = at(downtown, []);
    for (const nodeId of visited) {
      walked = { ...walked, nodeId, trail: trailAfter(walked) };
    }

    expect(walked.trail.length).toBeLessThanOrEqual(LIMITS.maxCriminalTrail);
  });
});

describe("recentNodeIds", () => {
  it("reads the present alone when the look reaches back one turn", () => {
    expect(recentNodeIds(at(park, [downtown]), 1)).toEqual([park]);
  });

  it("reaches as many turns back as it is asked for", () => {
    expect(recentNodeIds(at(terminal, [park, downtown]), 2)).toEqual([terminal, park]);
  });

  it("stops at the start of the hunt rather than inventing a past", () => {
    expect(recentNodeIds(at(park, []), 4)).toEqual([park]);
  });

  it("sees nothing at all when it is asked for no turns", () => {
    expect(recentNodeIds(at(park, [downtown]), 0)).toEqual([]);
  });
});

describe("withKnownRoadblock", () => {
  const first = makeEdgeId("downtown-park");
  const second = makeEdgeId("park-terminal");

  it("learns a checkpoint it has just met", () => {
    expect(withKnownRoadblock(EMPTY_CRIMINAL_KNOWLEDGE, first).knownRoadblockEdgeIds).toEqual([
      first,
    ]);
  });

  it("keeps the ones it already knew", () => {
    const known = withKnownRoadblock(EMPTY_CRIMINAL_KNOWLEDGE, first);

    expect(withKnownRoadblock(known, second).knownRoadblockEdgeIds).toEqual([first, second]);
  });

  it("records a checkpoint once however often it runs into it", () => {
    const known = withKnownRoadblock(EMPTY_CRIMINAL_KNOWLEDGE, first);

    expect(withKnownRoadblock(known, first)).toBe(known);
  });

  it("leaves everything else it knows alone", () => {
    const heard: CriminalKnowledge = { ...EMPTY_CRIMINAL_KNOWLEDGE, heardBriefingTurns: [2] };

    expect(withKnownRoadblock(heard, first).heardBriefingTurns).toEqual([2]);
  });
});
